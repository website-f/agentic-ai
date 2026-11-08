// P81: sending an attendance report in pieces and reading it in the background (attendance-reports.controller.ts).
// No database: the upload store only, with the parser replaced where the test needs it. Synthetic bytes only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { ParsedAttendanceReport } from '@prima/core';
import { ATTENDANCE_CHUNK_BYTES, AttendanceUploads } from '../src/attendance-reports.controller';
import { synDay, syntheticReport } from './synthetic-attendance-pdf';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const settle = async (u: AttendanceUploads, user: string, id: string) => {
  for (let i = 0; i < 200; i++) {
    const v = u.view(u.get(user, id));
    if (v.status === 'read' || v.status === 'failed') return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('never settled');
};

function sendAll(u: AttendanceUploads, user: string, bytes: Buffer, name = 'synthetic.pdf') {
  const up = u.start(user, name, bytes.length, sha(bytes));
  for (let i = 0; i * ATTENDANCE_CHUNK_BYTES < bytes.length; i++) u.chunk(user, up.id, i, bytes.subarray(i * ATTENDANCE_CHUNK_BYTES, (i + 1) * ATTENDANCE_CHUNK_BYTES));
  return up;
}

describe('attendance report uploads', () => {
  it('takes a real synthetic report in pieces, checks its fingerprint and reads it with progress', async () => {
    const pdf = Buffer.from(
      syntheticReport({
        company: 'SYNTHETIC GUARD SDN BHD',
        from: '01-04-2026',
        to: '30-04-2026',
        employees: [{ code: 'SYN1', name: 'SYNTHETIC ONE', designation: 'GUARD', days: Array.from({ length: 30 }, (_, i) => synDay(i + 1, '04', '2026')) }],
      }),
    );
    // Padded past one piece so the file is sent in two (the parser ignores bytes after %%EOF).
    const bytes = Buffer.concat([pdf, Buffer.alloc(ATTENDANCE_CHUNK_BYTES + 10 - pdf.length, 0x20)]);
    const u = new AttendanceUploads();
    try {
      const up = sendAll(u, 'u-a', bytes);
      assert.equal(u.view(up).chunks, 2);
      assert.equal(u.view(up).received, bytes.length);
      u.finish('u-a', up.id);
      const v = await settle(u, 'u-a', up.id);
      assert.equal(v.status, 'read', v.error ?? '');
      assert.deepEqual(v.read, { pages: 1, employees: 1, unreadable: 0 });
      assert.deepEqual(v.progress, { page: 1, pages: 1 });
    } finally {
      u.onModuleDestroy();
    }
  });

  it('keeps each upload to its own person and refuses damaged, changed or non-PDF files', async () => {
    const parsed: ParsedAttendanceReport = { title: null, pages: 1, employees: [], unreadable: [], warnings: [] };
    const u = new AttendanceUploads(async () => parsed);
    try {
      const bytes = Buffer.from('%PDF-1.4 synthetic ' + 'x'.repeat(200));
      const up = u.start('u-a', 'march.pdf', bytes.length, sha(bytes));
      assert.throws(() => u.get('u-b', up.id), (e) => status(e) === 404);
      assert.throws(() => u.chunk('u-a', up.id, 0, bytes.subarray(0, 10)), /damaged/);
      assert.throws(() => u.chunk('u-a', up.id, 3, bytes), /out of range/);
      assert.throws(() => u.finish('u-a', up.id), /not arrived/);
      u.chunk('u-a', up.id, 0, Buffer.from(bytes.toString().replace('synthetic', 'SYNTHETIC')));
      assert.equal(u.finish('u-a', up.id).status, 'failed');
      assert.match(u.view(u.get('u-a', up.id)).error ?? '', /changed while it was being sent/);

      const notPdf = Buffer.from('PK synthetic zip ' + 'y'.repeat(200));
      const z = sendAll(u, 'u-a', notPdf, 'report.pdf');
      assert.match(u.view(u.finish('u-a', z.id)).error ?? '', /not a PDF/);

      // A PDF that holds no employee is a failure with a reason, not an empty success.
      const empty = Buffer.from('%PDF-1.4 ' + 'z'.repeat(200));
      const e = sendAll(u, 'u-a', empty, 'empty.pdf');
      u.finish('u-a', e.id);
      const v = await settle(u, 'u-a', e.id);
      assert.equal(v.status, 'failed');
      assert.match(v.error ?? '', /No employee could be read/);

      assert.throws(() => u.start('u-a', 'report.xlsx', 500, 'a'.repeat(64)), /Only PDF/);
      assert.throws(() => u.start('u-a', 'big.pdf', 26 * 1024 * 1024, 'a'.repeat(64)), (x) => status(x) === 413);
      assert.throws(() => u.start('u-a', 'bad.pdf', 500, 'nothex'), /fingerprint/);
      u.drop('u-b', e.id);
      assert.ok(u.get('u-a', e.id), 'someone else cannot cancel it');
      u.drop('u-a', e.id);
      assert.throws(() => u.get('u-a', e.id), (x) => status(x) === 404);
    } finally {
      u.onModuleDestroy();
    }
  });

  it('takes an Excel or CSV timesheet as the rows read on the device, checked field by field (P90)', async () => {
    const u = new AttendanceUploads(async () => {
      throw new Error('the PDF reader is not used for a timesheet');
    });
    try {
      const day = { date: '2026-02-13', weekday: 'Fri', clocks: [], in: '08:00', out: '17:00', shift: 'S01', normalH: 8, lateH: 0, earlyH: 0, actualH: 8, ot: [0, 0, 0, 0], allow: { flat: 0, attendance: 0, shift: 0, meal: 0, transport: 0, other1: 0, other2: 0, health: 0 }, reason: null, page: 2 };
      const report = { title: 'Timesheet', pages: 0, unreadable: [], warnings: [], employees: [{ company: '', empCode: 'SYN1', name: 'SYNTHETIC ONE', designation: null, department: null, periodFrom: '2026-02-01', periodTo: '2026-02-28', pages: [], days: [day], totals: null, monthly: null }] };
      const ok = Buffer.from(JSON.stringify(report));
      const up = u.start('u-a', 'february.xlsx', ok.length, sha(ok), 'table');
      u.chunk('u-a', up.id, 0, ok);
      const v = u.view(u.finish('u-a', up.id));
      assert.equal(v.status, 'read', v.error ?? '');
      assert.equal(v.kind, 'table');
      assert.deepEqual(v.read, { pages: 0, employees: 1, unreadable: 0 });
      // A date that is not on the calendar is refused, never repaired.
      const bad = Buffer.from(JSON.stringify({ ...report, employees: [{ ...report.employees[0], days: [{ ...day, date: '2026-02-30' }] }] }));
      const b = u.start('u-a', 'bad.csv', bad.length, sha(bad), 'table');
      u.chunk('u-a', b.id, 0, bad);
      const bv = u.view(u.finish('u-a', b.id));
      assert.equal(bv.status, 'failed');
      assert.match(bv.error ?? '', /not on the calendar/);
      const junk = Buffer.from(JSON.stringify({ not: 'a timesheet', pad: 'x'.repeat(200) }));
      const j = u.start('u-a', 'junk.csv', junk.length, sha(junk), 'table');
      u.chunk('u-a', j.id, 0, junk);
      assert.equal(u.view(u.finish('u-a', j.id)).status, 'failed');
      assert.throws(() => u.start('u-a', 'sheet.pdf', 500, 'a'.repeat(64), 'table'), /Excel/);
    } finally {
      u.onModuleDestroy();
    }
  });

  it('forgets uploads after 30 minutes untouched', () => {
    let t = 1_000_000;
    const u = new AttendanceUploads(async () => ({ title: null, pages: 0, employees: [], unreadable: [], warnings: [] }), () => t);
    try {
      const b = Buffer.from('%PDF-' + 'q'.repeat(300));
      const up = u.start('u-a', 'a.pdf', b.length, sha(b));
      t += 31 * 60_000;
      u.sweep();
      assert.throws(() => u.get('u-a', up.id), /expired/);
    } finally {
      u.onModuleDestroy();
    }
  });
});
