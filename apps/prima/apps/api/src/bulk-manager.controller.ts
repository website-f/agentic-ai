// K8 / N1 (Fauzan, 11 Nov 2026): the bulk load helper (data manager and file manager). Every route runs as the signed-in
// person (Db.asUser): the core service and the database walls decide what they see and where they may load.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, HttpException, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { bulkAiRequest, fileAiRequest, parseBulkAiAnswer, parseFileAiAnswer, type BulkAiRequest, type BulkTarget } from '@prima/core';
import { ArishaBusy, ArishaUnavailable, IdentityToken, askArisha, askArishaOn } from './arisha';
import { arishaProvider, officeModel } from './arisha-office';
import { AuthGuard, UserId, type AuthedRequest } from './auth';
import { Db } from './db';

/**
 * The AI part stays off unless PRIMA_BULK_AI_ENABLED=true AND Arisha AI itself is on (Azure OpenAI, Fauzan's go-ahead
 * needed, D7). The rule-based matcher in the browser does the whole job without it.
 */
export const bulkAiOn = (env: NodeJS.ProcessEnv = process.env) => env.PRIMA_BULK_AI_ENABLED?.trim() === 'true' && !!arishaProvider(env);
const bulkAiToken = new IdentityToken();

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * What is sent to the AI for a data file, built here from whatever the browser sent: headings masked to known words and
 * shapes, at most three value shapes per column, the file name masked. A changed browser cannot get a value through.
 */
export function bulkAiPlanPayload(body: Record<string, unknown> | undefined, targets: BulkTarget[]): BulkAiRequest {
  const raw = Array.isArray(body?.columns) ? body.columns.slice(0, 40) : [];
  const columns = raw
    .map((c) => c as Record<string, unknown>)
    .filter((c) => Number.isInteger(c?.index) && (c.index as number) >= 0 && (c.index as number) < 300)
    .map((c) => ({ index: c.index as number, header: str(c.header, 60), samples: (Array.isArray(c.samples) ? c.samples.slice(0, 3) : []).map((s) => str(s, 40)) }));
  return bulkAiRequest({ fileName: str(body?.fileName, 160), columns }, targets);
}

/** What is sent to the AI for many files: masked names and file types only. */
export function bulkAiFilesPayload(body: Record<string, unknown> | undefined): BulkAiRequest {
  const files = (Array.isArray(body?.files) ? body.files.slice(0, 100) : []).map((f) => ({ name: str((f as Record<string, unknown>)?.name, 160), mime: str((f as Record<string, unknown>)?.mime, 60) }));
  return fileAiRequest(files);
}

@Controller('api/bulk')
@UseGuards(AuthGuard)
export class BulkManagerController {
  constructor(private readonly db: Db) {}

  /** The screen: destinations this person may load into, document types, their load records, whether AI is on. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async board(@UserId() uid: string) {
    const b = await this.db.asUser(uid, (svc, u) => svc.bulkManager.board(u));
    return { ...b, ai: bulkAiOn() };
  }

  /** Proposals for many files (names and types only): document type and whose file. Changes nothing. */
  @Post('files/place')
  @Header('Cache-Control', 'no-store')
  place(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const files = (Array.isArray(b?.files) ? b.files.slice(0, 201) : []).map((f) => ({ name: str((f as Record<string, unknown>)?.name, 200), mime: str((f as Record<string, unknown>)?.mime, 80) }));
    return this.db.asUser(uid, (svc, u) => svc.bulkManager.placeFiles(u, files));
  }

  /** People whose file this person keeps, by name or staff number (to place a held file). */
  @Get('people')
  @Header('Cache-Control', 'no-store')
  people(@UserId() uid: string, @Query('q') q?: string) {
    return this.db.asUser(uid, (svc, u) => svc.bulkManager.findPeople(u, str(q, 60)));
  }

  /** One confirmed file, filed on the person's HR file (the hiring paper's permission check). */
  @Post('files/file')
  file(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.bulkManager.fileOne(u, { personId: str(b?.personId, 80), docType: str(b?.docType, 20), name: str(b?.name, 160), data: str(b?.data, 1_000_000) }),
    );
  }

  /** The load record for many files. */
  @Post('loads/files')
  loadFiles(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.bulkManager.recordFiles(u, b ?? {}));
  }

  /** The load record for a data file, after the import or the staff directory send. */
  @Post('loads/data')
  loadData(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.bulkManager.recordData(u, b));
  }

  /** Arisha AI's suggestion for a data file's destination and columns, from masked headings and shapes only. */
  @Post('ai/plan')
  async aiPlan(@UserId() uid: string, @Body() b: Record<string, unknown>, @Req() req: AuthedRequest) {
    if (!bulkAiOn()) throw new ServiceUnavailableException('The AI part of the bulk load is not switched on here.');
    const targets = await this.db.asUser(uid, (svc, u) => svc.bulkManager.targets(u));
    if (!targets.length) throw new ForbiddenException('You do not keep any record that loads in bulk.');
    const input = bulkAiPlanPayload(b, targets);
    const answer = await this.ask(uid, req, input);
    const columns = (Array.isArray(b?.columns) ? b.columns.slice(0, 40) : []).map((c) => (c as Record<string, unknown>)?.index).filter((i): i is number => Number.isInteger(i));
    return { ...parseBulkAiAnswer(answer, targets, columns), source: 'Arisha AI (masked column headings and value shapes only; no values were sent)' };
  }

  /** Arisha AI's suggestion for many files' document types, from masked names and file types only. */
  @Post('ai/files')
  async aiFiles(@UserId() uid: string, @Body() b: Record<string, unknown>, @Req() req: AuthedRequest) {
    if (!bulkAiOn()) throw new ServiceUnavailableException('The AI part of the bulk load is not switched on here.');
    const board = await this.db.asUser(uid, (svc, u) => svc.bulkManager.board(u));
    if (!board.can.files) throw new ForbiddenException('You do not file documents on people’s HR files.');
    const input = bulkAiFilesPayload(b);
    const count = Math.min(100, Array.isArray(b?.files) ? b.files.length : 0);
    return { types: parseFileAiAnswer(await this.ask(uid, req, input), count), source: 'Arisha AI (masked file names and types only)' };
  }

  private async ask(uid: string, req: AuthedRequest, input: BulkAiRequest): Promise<string> {
    const provider = arishaProvider();
    if (!provider) throw new ServiceUnavailableException('Arisha is not switched on.');
    try {
      if (provider.kind === 'azure') return (await askArisha(provider.azure, () => bulkAiToken.get(), input)).text;
      if (req.office?.via !== 'person') throw new ForbiddenException('Open Prima from the office to use the AI helper.');
      return (await askArishaOn(officeModel(provider.office, uid), input)).text;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      if (e instanceof ArishaBusy) throw new HttpException(e.message, 429);
      if (e instanceof ArishaUnavailable) throw new ServiceUnavailableException(e.message);
      console.error('Bulk load AI request failed'); // Never log the brief or the answer.
      throw new ServiceUnavailableException('The AI helper could not answer. Use the plan Prima made; it works without the AI.');
    }
  }
}
