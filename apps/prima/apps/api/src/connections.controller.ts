import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, UserId, verifiedEntraAssertion } from './auth';
import { SharePointConnections, type ConnectionsActor } from './connections';
import { Db } from './db';
import { connectionRequestInput, requestMarker, sharePointRequestUrl } from './sharepoint-requests';

@Controller('api/connections/sharepoint')
@UseGuards(AuthGuard)
export class ConnectionsController {
  constructor(private readonly db: Db, private readonly sharePoint: SharePointConnections) {}

  private noSelectors(query: Record<string, unknown>, body?: unknown): void {
    if (Object.keys(query ?? {}).length || (body != null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length))) {
      throw new BadRequestException('Only the approved site and library selectors are supported.');
    }
  }

  private actor(uid: string, request: Request): Promise<ConnectionsActor> {
    const assertion = verifiedEntraAssertion(request);
    return this.db.asUser(uid, async (svc, user) => ({ user, visibleCompanyIds: (await svc.visibleCompanies(user)).map(c => c.id), assertion }));
  }

  @Get()
  async status(@UserId() uid: string, @Req() request: Request, @Query() query: Record<string, unknown>) {
    this.noSelectors(query);
    return this.sharePoint.status(await this.actor(uid, request));
  }

  @Post('requests/preview')
  previewRequest(@UserId() uid: string, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.noSelectors(query);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'url')) throw new BadRequestException('Invalid link request.');
    const target = sharePointRequestUrl((body as { url?: unknown }).url);
    return this.db.asUser(uid, async (_svc, user) => ({ serviceId: 'sharepoint' as const, userId: user.id, ...target, status: 'RequestPreview' as const }));
  }

  @Get('requests')
  requests(@UserId() uid: string, @Query() query: Record<string, unknown>) {
    this.noSelectors(query);
    return this.db.asUser(uid, async (svc, user) => {
      const board = await svc.itBoard(user);
      return { serviceId: 'sharepoint' as const, userId: user.id, requests: board.mine.filter(t => t.category === 'M365' && t.title === 'SharePoint connection request' && /^\[sharepoint-request:[0-9a-f-]{36}\]/.test(t.detail)).slice(0,50).map(t => ({ id: t.id, reference: t.ref, status: t.status, requestId: t.detail.slice(20,56), at: t.at })) };
    });
  }

  @Post('requests')
  request(@UserId() uid: string, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.noSelectors(query); const input = connectionRequestInput(body);
    return this.db.asUser(uid, async (svc, user, store) => {
      if (!store.lock) throw new BadRequestException('Setup requests are unavailable.');
      await store.lock('itTickets', `sharepoint-setup:${user.id}`);
      const marker = requestMarker(input.requestId);
      const board = await svc.itBoard(user);
      const existing = board.mine.find(t => t.category === 'M365' && t.title === 'SharePoint connection request' && t.detail.startsWith(marker + '\n'));
      if (existing && !existing.detail.includes('Requested URL: ' + input.canonicalUrl + '\n')) throw new BadRequestException('Request identity already used for a different resource.');
      const ticket = existing ?? await svc.raiseItTicket(user, { category: 'M365', priority: 'P3', title: 'SharePoint connection request', detail: `${marker}\nRequested URL: ${input.canonicalUrl}\nRequested scope: ${input.kind}\nIT must confirm tenant, site, library IDs, company/user scope and approved Microsoft access. This request does not grant access or configure a connection.` });
      return { serviceId: 'sharepoint' as const, userId: user.id, requestId: input.requestId, id: ticket.id, reference: ticket.ref, status: ticket.status, at: ticket.at };
    });
  }

  @Post(':siteKey/check')
  async check(@UserId() uid: string, @Req() request: Request, @Param('siteKey') siteKey: string, @Query() query: Record<string, unknown>, @Body() body?: unknown) {
    this.noSelectors(query, body);
    return this.sharePoint.check(await this.actor(uid, request), siteKey);
  }

  @Get(':siteKey/libraries')
  async libraries(@UserId() uid: string, @Req() request: Request, @Param('siteKey') siteKey: string, @Query() query: Record<string, unknown>) {
    this.noSelectors(query);
    return this.sharePoint.libraries(await this.actor(uid, request), siteKey);
  }

  @Get(':siteKey/libraries/:driveId/items')
  async items(@UserId() uid: string, @Req() request: Request, @Param('siteKey') siteKey: string, @Param('driveId') driveId: string, @Query() query: Record<string, unknown>) {
    this.noSelectors(query);
    return this.sharePoint.items(await this.actor(uid, request), siteKey, driveId);
  }
}
