// P81: past attendance from the InfoTech monthly PDF reports (packages/core/src/attendance-reports.ts).
//
// A report is sent in pieces of 1 MB (base64 in JSON): every call to Prima goes through the office, which signs JSON
// bodies of at most 3 MB and waits 30 seconds, so a 2 MB report cannot go in one call, and the pieces give the page a
// real progress bar. The last piece starts reading the PDF here, in the background; the page asks how far it got
// (GET .../uploads/:id) and then for the preview, and saves. Uploads live in this API's memory for 30 minutes (one API
// container, docker-compose.yml prima-api): after a restart the person sends the file again. Every route runs as the
// signed-in person (Db.asUser), so the company wall and the service's own checks decide what they see and save.

import { createHash, randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpException, Injectable, OnModuleDestroy, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AttendanceReportError, type ParsedAttendanceReport } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { parseAttendancePdf, type ParseProgress } from './attendance-pdf';

/** The largest report accepted (the monthly reports so far are under 2 MB). */
export const ATTENDANCE_MAX_BYTES = 25 * 1024 * 1024;
/** One piece of a report, before base64. */
export const ATTENDANCE_CHUNK_BYTES = 1024 * 1024;
const TTL_MS = 30 * 60_000;
const MAX_PER_USER = 6;
const MAX_HELD_BYTES = 200 * 1024 * 1024;
const PARALLEL_PARSES = 2;

type Status = 'uploading' | 'reading' | 'read' | 'failed';

interface Upload {
  id: string;
  userId: string;
  name: string;
  size: number;
  sha256: string;
  chunks: (Buffer | undefined)[];
  received: number;
  status: Status;
  progress: ParseProgress;
  parsed: ParsedAttendanceReport | null;
  error: string | null;
  touched: number;
}

function refuse(message: string, status = 400): never {
  throw new HttpException({ message }, status);
}

/** The uploads in progress, and the background reading of each finished one (at most two at a time). */
@Injectable()
export class AttendanceUploads implements OnModuleDestroy {
  private uploads = new Map<string, Upload>();
  private running = 0;
  private queue: Upload[] = [];
  private timer: NodeJS.Timeout | null = setInterval(() => this.sweep(), 60_000);

  constructor(
    private parse: (bytes: Uint8Array, onProgress: (p: ParseProgress) => void) => Promise<ParsedAttendanceReport> = parseAttendancePdf,
    private now: () => number = Date.now,
  ) {
    this.timer?.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Drops uploads nobody touched for 30 minutes. */
  sweep(): void {
    const cut = this.now() - TTL_MS;
    for (const [id, u] of this.uploads) if (u.touched < cut && u.status !== 'reading') this.uploads.delete(id);
  }

  private held(): number {
    let n = 0;
    for (const u of this.uploads.values()) n += u.status === 'uploading' || u.status === 'reading' ? u.size : 0;
    return n;
  }

  start(userId: string, name: string, size: number, sha256: string): Upload {
    this.sweep();
    if (!/\.pdf$/i.test(name)) refuse('Only PDF reports are imported here. Export the attendance report as a PDF.');
    if (!Number.isSafeInteger(size) || size < 100) refuse('This file is empty.');
    if (size > ATTENDANCE_MAX_BYTES) refuse(`This file is larger than ${ATTENDANCE_MAX_BYTES / 1024 / 1024} MB. Export one month at a time.`, 413);
    if (!/^[0-9a-f]{64}$/.test(sha256)) refuse('The file fingerprint is not valid. Choose the file again.');
    const mine = [...this.uploads.values()].filter((u) => u.userId === userId && u.status !== 'failed');
    if (mine.length >= MAX_PER_USER) refuse(`At most ${MAX_PER_USER} reports at a time. Save or cancel one first.`, 429);
    if (this.held() + size > MAX_HELD_BYTES) refuse('Prima is reading many reports right now. Try again in a few minutes.', 503);
    const u: Upload = {
      id: randomUUID(),
      userId,
      name: name.slice(0, 200),
      size,
      sha256,
      chunks: new Array(Math.ceil(size / ATTENDANCE_CHUNK_BYTES)).fill(undefined),
      received: 0,
      status: 'uploading',
      progress: { page: 0, pages: 0 },
      parsed: null,
      error: null,
      touched: this.now(),
    };
    this.uploads.set(u.id, u);
    return u;
  }

  /** The person's own upload; anyone else's is "not found". */
  get(userId: string, id: string): Upload {
    const u = this.uploads.get(id);
    if (!u || u.userId !== userId) refuse('This upload has expired or was never started. Choose the file again.', 404);
    u.touched = this.now();
    return u;
  }

  chunk(userId: string, id: string, index: number, data: Buffer): Upload {
    const u = this.get(userId, id);
    if (u.status !== 'uploading') refuse('This file has already been sent.', 409);
    if (!Number.isInteger(index) || index < 0 || index >= u.chunks.length) refuse('That piece of the file is out of range.');
    const want = index === u.chunks.length - 1 ? u.size - index * ATTENDANCE_CHUNK_BYTES : ATTENDANCE_CHUNK_BYTES;
    if (data.length !== want) refuse('A piece of the file arrived damaged. Send the file again.');
    if (!u.chunks[index]) u.received += data.length;
    u.chunks[index] = data;
    return u;
  }

  /** All pieces in: check the whole file against its fingerprint, then read it in the background. */
  finish(userId: string, id: string): Upload {
    const u = this.get(userId, id);
    if (u.status !== 'uploading') return u;
    if (u.chunks.some((c) => !c)) refuse('Some of the file has not arrived yet.', 409);
    const bytes = Buffer.concat(u.chunks as Buffer[]);
    u.chunks = [];
    if (createHash('sha256').update(bytes).digest('hex') !== u.sha256) return this.fail(u, 'The file changed while it was being sent. Send it again.');
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return this.fail(u, 'This is not a PDF file. Export the attendance report as a PDF.');
    u.status = 'reading';
    this.queue.push(u);
    (u as Upload & { bytes?: Buffer }).bytes = bytes;
    this.pump();
    return u;
  }

  private fail(u: Upload, message: string): Upload {
    u.status = 'failed';
    u.error = message;
    u.chunks = [];
    return u;
  }

  private pump(): void {
    while (this.running < PARALLEL_PARSES && this.queue.length) {
      const u = this.queue.shift()! as Upload & { bytes?: Buffer };
      const bytes = u.bytes!;
      delete u.bytes;
      this.running++;
      this.parse(new Uint8Array(bytes), (p) => {
        u.progress = p;
        u.touched = this.now();
      })
        .then((r) => {
          u.parsed = r;
          u.status = 'read';
          if (!r.employees.length) {
            u.status = 'failed';
            u.error = r.unreadable.length
              ? `No employee could be read from this file (${r.unreadable.length} pages unreadable, for example page ${r.unreadable[0].page}: ${r.unreadable[0].reason})`
              : 'No employee could be read from this file. Is it the "Individual Attendance Report"?';
          }
        })
        .catch((e: unknown) => {
          this.fail(u, e instanceof Error && /PDF|pages/.test(e.message) ? e.message : 'This file could not be read. Export the report again and retry.');
        })
        .finally(() => {
          this.running--;
          u.touched = this.now();
          this.pump();
        });
    }
  }

  drop(userId: string, id: string): void {
    const u = this.uploads.get(id);
    if (u && u.userId === userId) this.uploads.delete(id);
  }

  /** What the page shows while a file is sent and read. */
  view(u: Upload) {
    return {
      id: u.id,
      name: u.name,
      size: u.size,
      sha256: u.sha256,
      status: u.status,
      received: u.status === 'uploading' ? u.received : u.size,
      chunkBytes: ATTENDANCE_CHUNK_BYTES,
      chunks: Math.ceil(u.size / ATTENDANCE_CHUNK_BYTES),
      progress: u.progress,
      error: u.error,
      read: u.parsed ? { pages: u.parsed.pages, employees: u.parsed.employees.length, unreadable: u.parsed.unreadable.length } : null,
    };
  }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** {printed company: Prima company id or null}, from the page's choices. */
function choices(v: unknown): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 100)) {
    if (k.length > 200) continue;
    out[k] = typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(x) ? x : null;
  }
  return out;
}

/** The service's own refusals to HTTP; all else goes to the shared filter. */
async function mapped<R>(p: Promise<R>): Promise<R> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AttendanceReportError) throw new HttpException({ message: e.message }, e.status);
    throw e;
  }
}

@Controller('api/attendance-reports')
@UseGuards(AuthGuard)
export class AttendanceReportsController {
  constructor(
    private db: Db,
    private uploads: AttendanceUploads,
  ) {}

  /** Past attendance from the monthly reports: tiles, monthly trend, company and department breakdowns, who is often late. */
  @Get()
  overview(@UserId() uid: string, @Query('month') month?: string, @Query('companyId') companyId?: string, @Query('department') department?: string, @Query('q') q?: string) {
    const m = str(month, 7);
    if (m && !/^\d{4}-\d{2}$/.test(m)) refuse('The month is written YYYY-MM.');
    return mapped(
      this.db.asUser(uid, (svc, u) => svc.attendanceReports.overview(u, { month: m || null, companyId: str(companyId, 100) || null, department: str(department, 200) || null, q: str(q, 100) })),
    );
  }

  /** One person's month from a report, day by day, with their other months. */
  @Get('person')
  person(@UserId() uid: string, @Query('importId') importId?: string, @Query('key') key?: string) {
    return mapped(this.db.asUser(uid, (svc, u) => svc.attendanceReports.person(u, str(importId, 100), str(key, 200))));
  }

  /** Employees on the reports that no staff record is matched to yet. */
  @Get('unmatched')
  unmatched(@UserId() uid: string) {
    return mapped(this.db.asUser(uid, (svc, u) => svc.attendanceReports.unmatched(u)));
  }

  /** Staff of one company to match a report employee to (name or staff number). */
  @Get('staff')
  staff(@UserId() uid: string, @Query('companyId') companyId?: string, @Query('q') q?: string) {
    return mapped(this.db.asUser(uid, (svc, u) => svc.attendanceReports.staffSearch(u, str(companyId, 100), str(q, 100))));
  }

  /** Remember which staff record an employee on the reports is, for this and later imports. */
  @Post('match')
  match(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const personId = str(b?.personId, 100) || null;
    return mapped(this.db.asUser(uid, (svc, u) => svc.attendanceReports.match(u, str(b?.companyId, 100), str(b?.key, 200), personId)));
  }

  /** Start sending an attendance report PDF: refused at once for a file already imported or a person who does not import. */
  @Post('uploads')
  async start(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const sha = str(b?.sha256, 64).toLowerCase();
    const known = await mapped(
      this.db.asUser(uid, async (svc, u) => {
        await svc.attendanceReports.assertMayImport(u);
        return svc.attendanceReports.fileKnown(u, sha);
      }),
    );
    if (known) refuse(`This file is already imported (${known.companyName}, ${known.month}, by ${known.by}). The same file is never imported twice.`, 409);
    return this.uploads.view(this.uploads.start(uid, str(b?.name, 300), Number(b?.size), sha));
  }

  /** One piece of the file (base64, 1 MB before encoding). */
  @Post('uploads/:id/chunk')
  chunk(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const data = str(b?.data, 1_500_000);
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) refuse('A piece of the file arrived damaged. Send the file again.');
    return this.uploads.view(this.uploads.chunk(uid, str(id, 60), Number(b?.index), Buffer.from(data, 'base64')));
  }

  /** Every piece is in: check the file and start reading it. */
  @Post('uploads/:id/finish')
  finish(@UserId() uid: string, @Param('id') id: string) {
    return this.uploads.view(this.uploads.finish(uid, str(id, 60)));
  }

  /** How far sending and reading have got. */
  @Get('uploads/:id')
  status(@UserId() uid: string, @Param('id') id: string) {
    return this.uploads.view(this.uploads.get(uid, str(id, 60)));
  }

  private read(uid: string, id: string) {
    const u = this.uploads.get(uid, str(id, 60));
    if (u.status !== 'read' || !u.parsed) refuse(u.error ?? 'The file is still being read.', 409);
    return u as typeof u & { parsed: ParsedAttendanceReport };
  }

  /** What the report holds and where it would go: month, companies, employees, matches, unreadable pages. */
  @Post('uploads/:id/preview')
  preview(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const u = this.read(uid, id);
    return mapped(this.db.asUser(uid, (svc, user) => svc.attendanceReports.preview(user, u.parsed, { sha256: u.sha256 }, choices(b?.companies))));
  }

  /** Save the report. An earlier import of the same month and company is replaced only with replace: true. */
  @Post('uploads/:id/save')
  async save(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const u = this.read(uid, id);
    try {
      const r = await this.db.asUser(uid, (svc, user) =>
        svc.attendanceReports.save(user, u.parsed, { name: u.name, size: u.size, sha256: u.sha256 }, choices(b?.companies), b?.replace === true),
      );
      this.uploads.drop(uid, u.id);
      return { saved: true as const, ...r };
    } catch (e) {
      // Not an error to show: the page asks the person to confirm the replacement and sends replace: true.
      if (e instanceof AttendanceReportError && e.code === 'needs_replace') return { saved: false as const, needsReplace: e.message };
      return mapped(Promise.reject(e));
    }
  }

  /** Forget an upload that will not be saved. */
  @Post('uploads/:id/cancel')
  cancel(@UserId() uid: string, @Param('id') id: string) {
    this.uploads.drop(uid, str(id, 60));
    return { ok: true };
  }
}
