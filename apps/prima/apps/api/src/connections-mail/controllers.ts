
import { BadRequestException, ForbiddenException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, UserId } from '../auth';
import { Db } from '../db';
import { delegatedActor, noBody, noQuery, record } from './delegated';
import { denyAllJobEmailAccess, JobEmail, type JobEmailAccess } from './job-email';
import { MemoryJobEmailStore, type JobEmailStore } from './job-email-store';
import { MemoryEmailLedger, type StaffEmailLedger } from './ledger';
import { StaffEmail } from './staff-email';
import { PgJobEmailStore } from './pg-job-email-store';
import { itJobEmailRule } from './it-job-access';
import type { DelegatedActor } from './delegated';

@Controller('api/connections/mail')
@UseGuards(AuthGuard)
export class MailConnectionsController {
  constructor(private readonly db: Db, private readonly email: StaffEmail) {}

  @Get()
  async status(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>) {
    noQuery(q); return this.email.status(await delegatedActor(this.db, uid, req));
  }
  @Post(':resourceKey/check')
  async check(@UserId() uid: string, @Req() req: Request, @Param('resourceKey') key: string, @Query() q: Record<string, unknown>, @Body() body?: unknown) {
    noQuery(q); noBody(body); return this.email.check(await delegatedActor(this.db, uid, req), key);
  }
  @Post('drafts')
  async create(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q); return this.email.create(await delegatedActor(this.db, uid, req), body);
  }
  @Get('drafts')
  async list(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>) {
    noQuery(q); return this.email.list(await delegatedActor(this.db, uid, req));
  }
  @Get('drafts/:id')
  async get(@UserId() uid: string, @Req() req: Request, @Param('id') id: string, @Query() q: Record<string, unknown>) {
    noQuery(q); return this.email.get(await delegatedActor(this.db, uid, req), id);
  }
  @Post('drafts/:id/edit')
  async edit(@UserId() uid: string, @Req() req: Request, @Param('id') id: string, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q); return this.email.edit(await delegatedActor(this.db, uid, req), id, body);
  }
  @Post('drafts/:id/discard')
  async discard(@UserId() uid: string, @Req() req: Request, @Param('id') id: string, @Query() q: Record<string, unknown>, @Body() body?: unknown) {
    noQuery(q); noBody(body); return this.email.discard(await delegatedActor(this.db, uid, req), id);
  }
  @Post('drafts/:id/send')
  async send(@UserId() uid: string, @Req() req: Request, @Param('id') id: string, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q); return this.email.send(await delegatedActor(this.db, uid, req), id, body);
  }
  @Post('drafts/:id/resolve')
  async resolve(@UserId() uid: string, @Req() req: Request, @Param('id') id: string, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q); return this.email.resolveUncertain(await delegatedActor(this.db, uid, req), id, body);
  }
}

/**
 * Registration for the Connections owner (not applied here). The in-memory ledger keeps Mail NotConfigured;
 * pass `new PgEmailLedger(pool)` only after ledger-v1.sql has been reviewed and migrated; Mail still stays NotConfigured until its readiness gate passes.
 */
export const mailConnectionsModule = (ledger: StaffEmailLedger = new MemoryEmailLedger()) => ({
  controllers: [MailConnectionsController],
  providers: [{ provide: StaffEmail, useFactory: () => new StaffEmail(ledger) }],
});

/** Attach one Outlook email to a job (read-only, the person's own mailbox, by their explicit action). */
@Controller('api/connections/mail/jobs')
@UseGuards(AuthGuard)
export class JobEmailController {
  constructor(private readonly db: Db, private readonly email: JobEmail) {}

  @Get('status')
  async status(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>) {
    noQuery(q); const result=await this.email.status(await delegatedActor(this.db, uid, req));
    const setupRequest=await this.db.asUser(uid,async(_svc,user,store)=>{const ticket=(await store.list('itTickets',{})).find(t=>t.raisedById===user.id&&t.category==='M365'&&t.title==='Outlook job-email setup request'&&['open','in_progress'].includes(t.status));return ticket?{ticketId:ticket.id,ticketRef:ticket.ref,status:ticket.status}:null;});
    return {...result,setupRequest};
  }
  /** Request setup only: no mailbox link, ID, body or provider call is accepted or stored. */
  @Post('setup')
  async setup(@UserId() uid: string, @Req() req: Request, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q);
    if (!record(body) || Object.keys(body).length !== 1 || typeof body.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.requestId))
      throw new BadRequestException('Send a setup request ID only.');
    const actor = await delegatedActor(this.db, uid, req);
    if (!actor.assertion || actor.assertion.userId !== uid || actor.user.integration || actor.user.role === 'site_device'
      || !actor.user.entraOid || actor.user.entraOid.toLowerCase() !== actor.assertion.oid.toLowerCase())
      throw new ForbiddenException('Sign in with your linked Microsoft account to request setup.');
    const requestId = body.requestId;
    return this.db.asUser(uid, async (svc, user, store) => {
      if (user.integration || user.role === 'site_device' || !user.entraOid || user.entraOid.toLowerCase() !== actor.assertion!.oid.toLowerCase())
        throw new ForbiddenException('Sign in again before requesting setup.');
      if(!store.lock)throw new BadRequestException('Mailbox setup requests are unavailable.');
      await store.lock('itTickets', `job-email-setup:${uid}`);
      const marker = `[job-email-setup:${requestId}]`;
      const own=(await store.list('itTickets',{})).filter(t=>t.raisedById===uid&&t.category==='M365'&&t.title==='Outlook job-email setup request');
      const previous=own.find(t=>t.detail.includes(marker));
      const open=previous??own.find(t=>['open','in_progress'].includes(t.status));
      let ticket=open;
      if(open&&!previous){
        if(open.detail.length>12_000)throw new BadRequestException('Review the existing mailbox setup ticket with IT.');
        ticket=await store.update('itTickets',open.id,{detail:open.detail+'\n'+marker});
        await store.audit({at:new Date().toISOString(),actor:user.name,companyId:null,action:'connections.mail.setup_request_reused',entity:'itTickets',entityId:open.id,summary:'An additional own-mailbox setup request identity reuses the existing open ticket.'});
      }
      ticket??=await svc.raiseItTicket(user,{category:'M365',priority:'P3',title:'Outlook job-email setup request',
        detail:`Request setup for my own Outlook mailbox: explicit preview and attach of a selected email to an authorised IT job. No mailbox scanning, attachments or sending. Copies expire after 30 days; retained metadata and backups follow policy. ${marker}`});
      return { serviceId: 'mail' as const, userId: uid, requestId, ticketId: ticket.id, ticketRef: ticket.ref, replayed: !!open };
    });
  }

  @Post(':jobId/emails/preview')
  async preview(@UserId() uid: string, @Req() req: Request, @Param('jobId') jobId: string, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q); return this.email.preview(await delegatedActor(this.db, uid, req), jobId, body);
  }
  @Post(':jobId/emails')
  async attach(@UserId() uid: string, @Req() req: Request, @Param('jobId') jobId: string, @Query() q: Record<string, unknown>, @Body() body: unknown) {
    noQuery(q); return this.email.attach(await delegatedActor(this.db, uid, req), jobId, body);
  }
  @Get(':jobId/emails')
  async list(@UserId() uid: string, @Req() req: Request, @Param('jobId') jobId: string, @Query() q: Record<string, unknown>) {
    noQuery(q); return this.email.list(await delegatedActor(this.db, uid, req), jobId);
  }
  @Post(':jobId/emails/:id/remove')
  async remove(@UserId() uid: string, @Req() req: Request, @Param('jobId') jobId: string, @Param('id') id: string, @Query() q: Record<string, unknown>, @Body() body?: unknown) {
    noQuery(q); noBody(body); return this.email.remove(await delegatedActor(this.db, uid, req), jobId, id);
  }
}

/**
 * Registration for the owner (not applied here): pass `new PgJobEmailStore(pool)` after job-email-v2.sql is
 * migrated, and a JobEmailAccess wired to the core job rules. Defaults keep it NotConfigured and deny every job.
 */
export const jobEmailModule = (store: JobEmailStore = new MemoryJobEmailStore(), access: JobEmailAccess = denyAllJobEmailAccess) => ({
  controllers: [JobEmailController],
  providers: [{ provide: JobEmail, useFactory: () => new JobEmail(store, access) }],
});

/** Fresh actor/role/job lookup per check. Never capture a request's PgStore in a singleton. */
export function requestScopedJobEmailAccess(db: Db): JobEmailAccess {
  const check = (actor: DelegatedActor, jobId: string, need: 'attach' | 'view') => db.asUser(actor.user.id, async (_svc, current, store) => {
    if (!actor.assertion || actor.assertion.userId !== current.id || !current.entraOid
      || current.entraOid.toLowerCase() !== actor.assertion.oid.toLowerCase()) return false;
    const job = await store.get('itJobs', jobId);
    return itJobEmailRule(current, job ?? null, need, new Date());
  });
  return { canAttach: (a, j) => check(a, j, 'attach'), canView: (a, j) => check(a, j, 'view') };
}

/** Shared AppModule registers this module ONLY. Never register the legacy MailConnectionsController/StaffEmail. */
export const jobEmailRuntimeModule = () => ({
  controllers: [JobEmailController],
  providers: [{ provide: JobEmail, inject: [Db], useFactory: (db: Db) => new JobEmail(new PgJobEmailStore(db.pool), requestScopedJobEmailAccess(db)) }],
});
