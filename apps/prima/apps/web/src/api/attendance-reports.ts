// P81: past attendance from the InfoTech monthly PDF reports (apps/api/src/attendance-reports.controller.ts).
// Server only: the preview (demo) build has no reports to read, so the screen says so instead.
import type { AttendancePreview, AttendanceReportService, Id } from '@prima/core';

export type AttendanceOverviewView = Awaited<ReturnType<AttendanceReportService['overview']>>;
export type AttendancePersonView = Awaited<ReturnType<AttendanceReportService['person']>>;
/** P112: one person's attendance over a period of days. */
export type AttendancePersonPeriodView = Awaited<ReturnType<AttendanceReportService['personPeriod']>>;
export type AttendanceUnmatched = Awaited<ReturnType<AttendanceReportService['unmatched']>>;
export type AttendanceStaffHit = Awaited<ReturnType<AttendanceReportService['staffSearch']>>[number];
export type { AttendancePreview };

export interface AttendanceUploadView {
  id: string;
  /** P90: 'table' is an Excel or CSV timesheet read on this device and sent as its rows. */
  kind?: 'pdf' | 'table';
  name: string;
  size: number;
  sha256: string;
  status: 'uploading' | 'reading' | 'read' | 'failed';
  received: number;
  chunkBytes: number;
  chunks: number;
  progress: { page: number; pages: number };
  error: string | null;
  read: { pages: number; employees: number; unreadable: number } | null;
}

export type AttendanceSaveResult =
  | {
      saved: true;
      imports: { id: Id; companyId: Id; companyName: string; employees: number; days: number; matched: number; unmatched: number; replacedId: Id | null }[];
      skipped: { source: string; reason: string }[];
    }
  | { saved: false; needsReplace: string };

export interface AttendanceReportsClient {
  overview(f: { month?: string | null; from?: string | null; to?: string | null; companyId?: string | null; department?: string | null; q?: string }): Promise<AttendanceOverviewView>;
  person(importId: string, key: string): Promise<AttendancePersonView>;
  /** P112: GET /attendance-reports/person-period (from, to: YYYY-MM-DD). */
  personPeriod(importId: string, key: string, from: string, to: string): Promise<AttendancePersonPeriodView>;
  unmatched(): Promise<AttendanceUnmatched>;
  staff(companyId: string, q: string): Promise<AttendanceStaffHit[]>;
  match(companyId: string, key: string, personId: string): Promise<{ ok: boolean }>;
  start(file: { name: string; size: number; sha256: string; kind?: 'pdf' | 'table' }): Promise<AttendanceUploadView>;
  chunk(id: string, index: number, data: string): Promise<AttendanceUploadView>;
  finish(id: string): Promise<AttendanceUploadView>;
  status(id: string): Promise<AttendanceUploadView>;
  preview(id: string, companies: Record<string, string | null>): Promise<AttendancePreview>;
  save(id: string, companies: Record<string, string | null>, replace: boolean): Promise<AttendanceSaveResult>;
  cancel(id: string): Promise<{ ok: boolean }>;
}

/** The query string for the overview: only what is set. */
export function overviewQuery(f: Parameters<AttendanceReportsClient['overview']>[0]): string {
  const p = new URLSearchParams();
  if (f.month) p.set('month', f.month);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.companyId) p.set('companyId', f.companyId);
  if (f.department) p.set('department', f.department);
  if (f.q?.trim()) p.set('q', f.q.trim());
  const s = p.toString();
  return s ? `?${s}` : '';
}
