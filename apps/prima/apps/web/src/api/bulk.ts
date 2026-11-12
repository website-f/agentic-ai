// K8 / N1 (Fauzan, 11 Nov 2026): the bulk load helper's calls (data manager and file manager).
import type { BulkLoad, BulkDocType, PrimaService } from '@prima/core';

export type BulkBoard = Awaited<ReturnType<PrimaService['bulkManager']['board']>> & { ai: boolean };
export type BulkPlacements = Awaited<ReturnType<PrimaService['bulkManager']['placeFiles']>>;
export type BulkLoadRow = BulkBoard['loads'][number];

export interface BulkClient {
  board(): Promise<BulkBoard>;
  /** Proposals for many files from their names and types only. */
  place(files: { name: string; mime: string }[]): Promise<BulkPlacements>;
  /** People whose file this person keeps, by name or staff number. */
  people(q: string): Promise<{ id: string; label: string }[]>;
  /** One confirmed file onto a person's HR file. */
  file(input: { personId: string; docType: BulkDocType; name: string; data: string }): Promise<{ docId: string; personId: string; companyId: string }>;
  recordFiles(input: { placed: { file: string; personId: string; docType: BulkDocType; docId: string }[]; held: { file: string; reason: string }[]; aiUsed: boolean }): Promise<BulkLoad>;
  recordData(input: Record<string, unknown>): Promise<BulkLoad>;
  /** Arisha AI (switched off until Fauzan's go-ahead): masked headings and value shapes only. */
  aiPlan(input: { fileName: string; columns: { index: number; header: string; samples: string[] }[] }): Promise<{ kind: string | null; matches: { index: number; field: string }[]; source: string }>;
  aiFiles(files: { name: string; mime: string }[]): Promise<{ types: { index: number; type: BulkDocType }[]; source: string }>;
}
