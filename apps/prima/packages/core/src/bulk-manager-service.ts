// K8 / N1: the bulk load helper's server side. It lists the destinations a person may load into, proposes whose file
// each of many files belongs to (matching against only the people whose file this person keeps), files each confirmed
// document on that person's HR file through the same permission check as a hiring paper, and keeps a load record for
// every load: who loaded, the plan, who confirmed or approved, and what went where. The data itself goes in through the
// record's own import (org-import.ts) or the staff directory with HR's approval (staff-directory.ts); this service only
// records those loads after checking the receipt or batch is really this person's.

import { AccessDenied, accessClosed, isOwnerAdmin } from './access';
import { sha256Hex } from './audit';
import { BULK_DOC_TYPES, STAFF_DIRECTORY_KIND, STAFF_DIRECTORY_TARGET, docTypeOf, placeFile, type BulkDocType, type BulkTarget, type FileCandidate } from './bulk-manager';
import { hrKeeps } from './hr';
import { type AlignField } from './import-align';
import { IMPORTABLE_KINDS, importSpec, type ImportKind } from './org-import';
import { isP91Kind, p91MayImport } from './org-import-ops';
import { ITEM_IMPORT_KINDS, type ItemImportKind } from './item-import';
import type { RecordKind } from './records';
import { BadRequest, type ProofInput } from './service';
import type { Store } from './store';
import { dateOf } from './time';
import type { Id, IsoDateTime, Person, User } from './types';

/** One load as the record keeps it. Nothing in it is a value from the file: headings, row numbers and reasons only. */
export interface BulkLoad {
  id: Id;
  kind: 'data' | 'files';
  /** The import kind, 'staffDirectory', or 'personFiles' for many files filed on people's HR files. */
  target: string;
  targetLabel: string;
  fileNames: string[];
  /** The plan the person confirmed: each column heading and the field it went to (null: not used). */
  plan: { header: string; field: string | null }[];
  rowsInFile: number;
  /** Rows saved (for the staff directory: rows sent for the HR Director's approval). */
  loaded: number;
  /** Rows left out, each with its reasons. */
  refused: { row: number; reasons: string[] }[];
  /** For many files: what went where. */
  placed: { file: string; personId: Id; person: string; docType: BulkDocType; docId: Id }[];
  /** For many files: files not filed, with why (held for the person, or left out). */
  held: { file: string; reason: string }[];
  /** Whether Arisha AI suggestions were asked for (they are only suggestions; the person confirmed the plan). */
  aiUsed: boolean;
  receiptId: Id | null;
  batchId: Id | null;
  companyId: Id | null;
  loadedById: Id;
  loadedBy: string;
  /** Who confirmed the plan: the record's keeper (the person loading) or, for staff data, HR who sent it. */
  confirmedBy: string;
  at: IsoDateTime;
}

export const BULK_FILES_TARGET = 'personFiles';
const MAX = { name: 160, header: 80, reason: 240, reasons: 6, rows: 1000, files: 200 } as const;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const tidy = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** The narrow part of PrimaService this service uses (each with the screen's own permission check). */
export interface BulkDeps {
  recordKindsFor(user: User): RecordKind[];
  itemImportAllowed?(user: User, kind: ItemImportKind, partyId: Id | null): Promise<boolean>;
  bulkFilePeople(user: User): Promise<Person[]>;
  fileBulkDoc(user: User, personId: Id, caption: string, proof: ProofInput[]): Promise<{ docId: Id; personId: Id; companyId: Id }>;
}

/** Who sees every load record (oversight): directors, the CEO and COO, group leadership and ACT. Others see their own. */
export function bulkLoadOverseer(u: User): boolean {
  return u.role === 'director' || u.opsTier === 'ceo' || u.opsTier === 'coo' || !!u.leadership || u.department === 'audit';
}

/** Whether the menu offers Bulk load: people who keep a record that loads in bulk, and oversight (a hint for the menu). */
export function bulkLoadInMenu(u: User): boolean {
  if (u.integration || ['guard', 'site_device', 'supervisor'].includes(u.role)) return false;
  if (u.role !== 'pwvsb_officer') return true;
  if (u.department === 'fwm') return u.fwmRole !== 'despatch';
  return (
    bulkLoadOverseer(u) ||
    ['hr', 'it', 'procurement', 'legal', 'pdpa', 'transport', 'arms_control'].includes(u.department ?? '') ||
    ['om', 'regional'].includes(u.opsTier ?? '') ||
    (u.department === 'finance' && u.financeRole === 'leader')
  );
}

/** Who may file documents on people's HR files at all (the server checks each person again). */
export function bulkFilesRole(u: User): boolean {
  return u.role === 'director' || u.role === 'company_manager' || u.role === 'admin_exec' || u.department === 'hr' || (u.department === 'fwm' && u.fwmRole !== 'despatch');
}

/** The extra import kinds' keepers (a hint for the proposals; each row is checked again by the record's own save). */
function extraMay(u: User, kind: string): boolean {
  const ops = u.role === 'pwvsb_officer' && u.department === 'operations' && ['om', 'regional'].includes(u.opsTier ?? '');
  switch (kind) {
    case 'client':
      return u.role === 'company_manager' || ops;
    case 'contract':
    case 'branch':
      return u.role === 'company_manager';
    case 'leaveEntitlement':
    case 'publicHoliday':
      return hrKeeps(u);
    case 'fwWorker':
    case 'fwPaper':
      return u.department === 'fwm' && u.fwmRole !== 'despatch';
    case 'purSupplier':
      return u.department === 'procurement';
    case 'itAsset':
      return u.department === 'it';
    case 'tender':
    case 'corpAudit':
      return u.role === 'company_manager' || u.role === 'admin_exec';
    case 'finBankAccount':
      return u.department === 'finance' && u.financeRole === 'leader';
    case 'corpFiling':
      return u.leadership === 'deputy_cos';
    case 'legalMatter':
      return u.department === 'legal' || u.role === 'company_manager';
    case 'bcmSystem':
      return u.department === 'it';
    case 'grcObligation':
      return u.department === 'audit' || isOwnerAdmin(u);
    case 'pdpaRegisterItem':
    case 'pdpaProduct':
      return u.department === 'pdpa';
    case 'regRisk':
      return u.department === 'audit' && u.actRole === 'lead';
    default:
      return false;
  }
}

/** A destination from an import kind's spec, as the matcher reads it (choices as their labels). */
export function bulkTargetOf(kind: ImportKind): BulkTarget {
  const spec = importSpec(kind);
  return {
    kind,
    label: spec.label,
    screen: spec.screen,
    keptBy: spec.keptBy,
    confirmBy: `${spec.keptBy} (the person loading checks every row before it is saved)`,
    companyScoped: spec.companyScoped,
    fields: spec.fields.map(
      (f): AlignField => ({
        key: f.key,
        label: f.label,
        type: f.type as AlignField['type'],
        required: !!f.required,
        options: f.type === 'select' ? (f.options ?? []).map(([, l]): [string, string] => [l, l]) : undefined,
        words: (f as { words?: string[] }).words,
      }),
    ),
  };
}

export class BulkManagerService {
  constructor(
    private readonly store: Store,
    private readonly clock: () => IsoDateTime,
    private readonly deps: BulkDeps,
  ) {}

  /** The signed-in person: a person (not a feed, device, guard or site officer) with open access. */
  private actor(u: User): User {
    if (!u || u.integration || ['site_device', 'guard', 'supervisor'].includes(u.role) || accessClosed(u, dateOf(this.clock())))
      throw new AccessDenied('view', '(bulk load: office staff who keep records only)');
    return u;
  }

  /** Every destination this person may load into: the records they may add by hand, and the staff directory for HR. */
  async targets(user: User): Promise<BulkTarget[]> {
    const u = this.actor(user);
    const records = new Set<string>(this.deps.recordKindsFor(u));
    const out: BulkTarget[] = [];
    for (const k of IMPORTABLE_KINDS) {
      let ok: boolean;
      if (records.has(k)) ok = true;
      else if (isP91Kind(k)) ok = p91MayImport(u, k);
      else if ((ITEM_IMPORT_KINDS as readonly string[]).includes(k)) ok = (await this.deps.itemImportAllowed?.(u, k as ItemImportKind, null).catch(() => false)) ?? false;
      else ok = extraMay(u, k);
      if (ok) out.push(bulkTargetOf(k));
    }
    if (u.department === 'hr' || u.leadership === 'cos' || u.leadership === 'deputy_cos') out.unshift(STAFF_DIRECTORY_TARGET);
    return out;
  }

  /** The screen: destinations, document types, whether files can be filed, and the load records this person sees. */
  async board(user: User) {
    const u = this.actor(user);
    const targets = await this.targets(u);
    return {
      targets,
      docTypes: BULK_DOC_TYPES.map((d) => ({ key: d.key, label: d.label, ms: d.ms })),
      can: { data: targets.length > 0, files: bulkFilesRole(u) },
      loads: await this.loads(u),
    };
  }

  /** The load records this person sees, newest first, with the staff directory approval as it stands now. */
  async loads(user: User) {
    const u = this.actor(user);
    const all = (await this.store.list('bulkLoads', {})).filter((l) => l.loadedById === u.id || bulkLoadOverseer(u));
    const batches = all.some((l) => l.batchId) ? await this.store.list('staffDirectoryBatches', {}).catch(() => []) : [];
    const byId = new Map(batches.map((b) => [b.id, b]));
    return all
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 200)
      .map((l) => {
        const b = l.batchId ? byId.get(l.batchId) : undefined;
        const approval = l.target === STAFF_DIRECTORY_KIND ? (b ? { status: b.status, by: b.decidedBy, at: b.decidedAt, comment: b.comment } : { status: 'unknown' as const, by: null, at: null, comment: '' }) : null;
        return { ...l, approval };
      });
  }

  /** The people this person keeps files for, as candidates for the matcher (identifiers stay on the server). */
  private async candidates(u: User): Promise<{ list: FileCandidate[]; people: Person[] }> {
    const people = await this.deps.bulkFilePeople(u);
    return {
      people,
      list: people.map((p) => ({ id: p.id, label: `${p.name} (${p.staffNo})`, name: p.name, keys: [p.staffNo, p.idFull ?? ''].filter((k) => !!k && k.length >= 4) })),
    };
  }

  /** Proposals for many files from their names and types: the document type and whose file. Changes nothing. */
  async placeFiles(user: User, files: { name: string; mime: string }[]) {
    const u = this.actor(user);
    if (!bulkFilesRole(u)) throw new AccessDenied('view', '(bulk files: HR, FWM and company HR keepers only)');
    if (!Array.isArray(files) || !files.length) throw new BadRequest('Choose the files first.');
    if (files.length > MAX.files) throw new BadRequest(`At most ${MAX.files} files at a time.`);
    const { list } = await this.candidates(u);
    const label = new Map(list.map((c) => [c.id, c.label]));
    const out = files.map((f) => {
      const name = tidy(f?.name, MAX.name);
      const mime = tidy(f?.mime, 60);
      const doc = docTypeOf(name, mime);
      const who = placeFile(name, list);
      return { name, doc, who: { ...who, label: who.personId ? label.get(who.personId) ?? null : null, others: who.others.map((id) => ({ id, label: label.get(id) ?? id })) } };
    });
    return { files: out, people: list.length };
  }

  /** People this person keeps files for whose name or staff number contains the words typed (for placing a held file). */
  async findPeople(user: User, q: string) {
    const u = this.actor(user);
    if (!bulkFilesRole(u)) throw new AccessDenied('view', '(bulk files: HR, FWM and company HR keepers only)');
    const words = tidy(q, 60).toLowerCase().split(' ').filter(Boolean);
    if (!words.length || words.join('').length < 2) return [];
    const { list } = await this.candidates(u);
    return list
      .filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
      .slice(0, 20)
      .map((c) => ({ id: c.id, label: c.label }));
  }

  /** File one confirmed document on a person's HR file (the hiring paper's own permission check). */
  async fileOne(user: User, input: { personId: string; docType: string; name: string; data: string }) {
    const u = this.actor(user);
    if (!bulkFilesRole(u)) throw new AccessDenied('view', '(bulk files: HR, FWM and company HR keepers only)');
    const type = BULK_DOC_TYPES.find((d) => d.key === input.docType);
    if (!type) throw new BadRequest('Choose the document type.');
    const name = tidy(input.name, 120);
    if (!name || CONTROL.test(name)) throw new BadRequest('The file has no name.');
    return this.deps.fileBulkDoc(u, tidy(input.personId, 80), `${type.label} (bulk load)`, [{ kind: 'document', name, data: typeof input.data === 'string' ? input.data : '', caption: `${type.label} (bulk load)` }]);
  }

  /** The load record for many files: each filed document checked to be on that person's file, filed by this person. */
  async recordFiles(user: User, input: { placed?: unknown; held?: unknown; aiUsed?: unknown }) {
    const u = this.actor(user);
    if (!bulkFilesRole(u)) throw new AccessDenied('view', '(bulk files: HR, FWM and company HR keepers only)');
    const placedIn = Array.isArray(input.placed) ? input.placed.slice(0, MAX.files) : [];
    const heldIn = Array.isArray(input.held) ? input.held.slice(0, MAX.files) : [];
    if (!placedIn.length && !heldIn.length) throw new BadRequest('Nothing was filed or held.');
    const placed: BulkLoad['placed'] = [];
    for (const x of placedIn as Record<string, unknown>[]) {
      const docId = tidy(x?.docId, 80);
      const personId = tidy(x?.personId, 80);
      const docType = tidy(x?.docType, 20) as BulkDocType;
      const doc = docId ? await this.store.get('evidenceDocs', docId) : undefined;
      if (!doc || doc.hrPersonId !== personId || doc.uploadedBy !== u.name) throw new BadRequest('A filed document is not on that person’s file. Load the files again.');
      if (!BULK_DOC_TYPES.some((d) => d.key === docType)) throw new BadRequest('Choose the document type.');
      const person = await this.store.get('people', personId);
      placed.push({ file: tidy(x?.file, MAX.name) || doc.name, personId, person: person ? `${person.name} (${person.staffNo})` : personId, docType, docId });
    }
    const held = (heldIn as Record<string, unknown>[]).map((x) => ({ file: tidy(x?.file, MAX.name), reason: tidy(x?.reason, MAX.reason) || 'Held for the person to place.' })).filter((x) => x.file);
    const at = this.clock();
    const fingerprint = sha256Hex(JSON.stringify([u.id, placed.map((p) => p.docId), held.map((h) => h.file), at]));
    const load: BulkLoad = {
      id: `bl-f-${fingerprint.slice(0, 16)}`,
      kind: 'files',
      target: BULK_FILES_TARGET,
      targetLabel: 'People’s HR files',
      fileNames: [...placed.map((p) => p.file), ...held.map((h) => h.file)],
      plan: [],
      rowsInFile: placed.length + held.length,
      loaded: placed.length,
      refused: [],
      placed,
      held,
      aiUsed: input.aiUsed === true,
      receiptId: null,
      batchId: null,
      companyId: null,
      loadedById: u.id,
      loadedBy: u.name,
      confirmedBy: u.name,
      at,
    };
    return this.save(u, load, `${placed.length} file${placed.length === 1 ? '' : 's'} filed on people's HR files, ${held.length} held`);
  }

  /**
   * The load record for a data file, after the import or the staff directory send. The receipt or batch must be this
   * person's own; counts come from it, never from the browser. The plan is headings and fields only.
   */
  async recordData(user: User, input: Record<string, unknown>) {
    const u = this.actor(user);
    const fileName = tidy(input.fileName, MAX.name);
    if (!fileName) throw new BadRequest('Say which file was loaded.');
    const plan = (Array.isArray(input.plan) ? input.plan.slice(0, 300) : []).map((x) => {
      const r = x as Record<string, unknown>;
      return { header: tidy(r?.header, MAX.header), field: tidy(r?.field, 60) || null };
    });
    const refusedIn = (Array.isArray(input.refused) ? input.refused.slice(0, MAX.rows) : []).map((x) => {
      const r = x as Record<string, unknown>;
      return { row: Number(r?.row), reasons: (Array.isArray(r?.reasons) ? r.reasons.slice(0, MAX.reasons) : []).map((s) => tidy(s, MAX.reason)).filter(Boolean) };
    });
    const rowsInFile = Number(input.rowsInFile);
    if (!Number.isInteger(rowsInFile) || rowsInFile < 0 || rowsInFile > 100_000) throw new BadRequest('Rows in the file must be a whole number.');
    let load: BulkLoad;
    const base = { kind: 'data' as const, fileNames: [fileName], plan, rowsInFile, placed: [], held: [], aiUsed: input.aiUsed === true, loadedById: u.id, loadedBy: u.name, confirmedBy: u.name, at: this.clock() };
    if (input.via === 'staffDirectory') {
      const batchId = tidy(input.batchId, 120);
      const b = batchId ? await this.store.get('staffDirectoryBatches', batchId) : undefined;
      if (!b || b.preparedById !== u.id) throw new BadRequest('That staff directory batch is not one you sent.');
      const left = new Set(refusedIn.map((r) => r.row));
      load = { ...base, id: `bl-${b.id}`, target: STAFF_DIRECTORY_KIND, targetLabel: STAFF_DIRECTORY_TARGET.label, loaded: b.rows.length, refused: refusedIn.filter((r) => Number.isInteger(r.row) && r.row > 1 && left.has(r.row)), receiptId: null, batchId: b.id, companyId: null };
    } else {
      const receiptId = tidy(input.receiptId, 120);
      const r = receiptId ? await this.store.get('orgImports', receiptId) : undefined;
      if (!r || r.byId !== u.id) throw new BadRequest('That import is not one you made.');
      const skipped = new Set(r.skippedRows ?? []);
      const refused = refusedIn.filter((x) => skipped.has(x.row));
      for (const row of skipped) if (!refused.some((x) => x.row === row)) refused.push({ row, reasons: ['Left out by the person loading.'] });
      refused.sort((a, b) => a.row - b.row);
      let label = r.kind as string;
      try {
        label = importSpec(r.kind).label;
      } catch {
        /* a kind no longer importable keeps its key */
      }
      load = { ...base, id: `bl-${r.id}`, target: r.kind, targetLabel: label, loaded: r.rows, refused, receiptId: r.id, batchId: null, companyId: r.companyId };
    }
    return this.save(u, load, `${load.loaded} row${load.loaded === 1 ? '' : 's'} of ${fileName} to ${load.targetLabel}, ${load.refused.length} left out`);
  }

  private async save(u: User, load: BulkLoad, summary: string) {
    return this.store.transaction(async (tx) => {
      if (await tx.get('bulkLoads', load.id)) throw new BadRequest('This load is already recorded.');
      await tx.insert('bulkLoads', load);
      await tx.audit({ at: load.at, actor: u.name, companyId: load.companyId, action: 'bulk.load', entity: 'bulk_load', entityId: load.id, summary: `Bulk load recorded: ${summary}.` });
      return load;
    });
  }
}
