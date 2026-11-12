import { AccessDenied } from "./access";
import { accessClosed } from "./access";
import { sha256Hex } from "./audit";
import { parseItImportTable } from "./it-import";
import { BadRequest } from "./service";
import type { Store } from "./store";
import { dateOf } from "./time";
import type { Company } from "./types";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";


/**
 * Staff directory (Fauzan, 4 Nov 2026): the group's list of office staff and their Microsoft 365 mailboxes, loaded in
 * bulk once and completed by hand afterwards ("we key in app after"). HR prepares a batch from the CSV and the HR
 * Director (Chief of Staff or Deputy) or the CEO approves it, never the person who prepared it; every row goes in, or
 * none does, and the same file is never loaded twice.
 *
 * It is a directory, not access: an entry never creates a sign-in, a grant, a staff record or a Microsoft link. Those
 * keep their own reviewed paths (HR/IT coordination and the audited Entra link). The real list is personal data under
 * PDPA and is entered only through this screen; the repository holds the format only (data/staff-directory).
 */

export type StaffDirectoryGroup =
  | "company"
  | "central_unit"
  | "operations_region";
export const STAFF_DIRECTORY_GROUPS: StaffDirectoryGroup[] = [
  "company",
  "central_unit",
  "operations_region",
];

/** Why an entry needs a fix before the person can use Prima. Worked out each time from the entry, never typed in. */
export type StaffDirectoryIssue =
  | "personal_outlook"
  | "email_used_more_than_once"
  | "no_title"
  | "no_email"
  | "invalid_email"
  | "typo_domain"
  | "status_missing"
  | "company_not_matched";

export const STAFF_DIRECTORY_ISSUE_LABELS: Record<StaffDirectoryIssue, string> =
  {
    personal_outlook:
      "Personal Outlook account: cannot sign in to Prima until IT gives a work account or a guest invite",
    email_used_more_than_once:
      "Mailbox shared with someone else: each person needs their own sign-in",
    no_title: "No job title: HR to confirm the role",
    no_email: "No mailbox",
    invalid_email: "Mailbox address cannot be read",
    typo_domain: "Mailbox domain looks misspelt",
    status_missing: "Account status not given",
    company_not_matched: "Company name does not match a company in Prima",
  };

/** The fields one person's line holds, as HR gives them. */
export interface StaffDirectoryFields {
  group: StaffDirectoryGroup;
  /** Company name, central unit (e.g. UNIT IT) or operations region (e.g. OPERASI JOHOR). */
  orgUnit: string;
  name: string;
  title: string;
  email: string;
  accountType: string;
  entraStatus: string;
  verified: string;
  accountStatus: string;
}

export interface StaffDirectoryEntry extends StaffDirectoryFields {
  id: Id;
  /** The company this line was matched to by its exact name, when the group is 'company'; never guessed. */
  companyId: Id | null;
  /** The approved batch it came in with, or null when HR keyed it in by hand. */
  batchId: Id | null;
  addedById: Id;
  addedAt: IsoDateTime;
  /** For a line keyed in by hand: where HR got it from. */
  sourceNote: string;
}

export interface StaffDirectoryBatch {
  id: Id;
  /** File name or where the rows came from. */
  source: string;
  /** Hash of the rows as read; the same rows are never loaded twice. */
  fingerprint: string;
  rows: (StaffDirectoryFields & { row: number; companyId: Id | null })[];
  /** Rows of the file already in the directory when it was prepared, left out. */
  alreadyIn: number[];
  /**
   * K2 (Fauzan, 11 Nov 2026): rows HR chose to leave out because they could not be read, each with its reasons, so the
   * count of rows in the file, loaded and refused can be given for every load (K10). Missing on older batches.
   */
  refused?: { row: number; reasons: string[] }[];
  preparedById: Id;
  preparedBy: string;
  preparedAt: IsoDateTime;
  status: "waiting" | "approved" | "returned";
  decidedById: Id | null;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  /** The approver's comment (every approver gives one, Fauzan 31 Oct 2026). */
  comment: string;
}

export interface StaffDirectoryPreviewRow extends StaffDirectoryFields {
  row: number;
  companyId: Id | null;
  issues: StaffDirectoryIssue[];
  errors: string[];
  /** Already in the directory: left out of the batch. */
  alreadyIn: boolean;
}

export interface StaffDirectoryPreview {
  source: string;
  fingerprint: string;
  missingColumns: string[];
  problems: string[];
  rows: StaffDirectoryPreviewRow[];
  /** How many rows would go in (no error, not already in the directory). */
  ready: number;
}

export const STAFF_DIRECTORY_MAX_ROWS = 1000;
export const STAFF_DIRECTORY_MAX_CHARS = 400_000;
const MAX = {
  orgUnit: 120,
  name: 160,
  title: 120,
  email: 254,
  status: 60,
  source: 200,
  note: 300,
  comment: 500,
} as const;

/** Column headings Prima recognises, compared without case, spaces or punctuation. The template's, then the workbook's. */
const HEADINGS: Record<keyof StaffDirectoryFields, string[]> = {
  group: ["group", "kumpulan"],
  orgUnit: ["orgunit", "company", "unit", "namasyarikat", "syarikat"],
  name: ["name", "namakakitanganstaff", "namakakitangan", "nama", "staff"],
  title: ["title", "jobtitle", "jawatan"],
  email: ["email", "emel", "mailbox"],
  accountType: ["accounttype", "jenisakaun"],
  entraStatus: ["entrastatus", "statusentraid"],
  verified: ["verified", "statuspengesahan"],
  accountStatus: ["accountstatus", "statusakaun"],
};
const REQUIRED: (keyof StaffDirectoryFields)[] = ["group", "orgUnit", "name"];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const PERSONAL = /@(outlook+|hotmail|live|msn)\.[a-z.]+$/i;
const TYPO = /@(outlookk|outlok|outloook|hotmial|gmial)\./i;

/** Who sees the directory: central HR, the HR Director, the CEO, and IT (to fix the accounts). */
function role(u: User) {
  const hr = u.department === "hr";
  const director = u.leadership === "cos" || u.leadership === "deputy_cos";
  const ceo =
    (u.role === "director" || u.role === "pwvsb_officer") &&
    u.opsTier === "ceo";
  const it =
    u.role === "pwvsb_officer" &&
    u.department === "it" &&
    ["manager", "lead", "executive"].includes(u.itRole ?? "");
  return {
    hr,
    director,
    ceo,
    it,
    view: hr || director || ceo || it,
    prepare: hr || director,
    approve: director || ceo,
  };
}

/** The key that makes two lines the same person-and-mailbox. */
const key = (f: Pick<StaffDirectoryFields, "orgUnit" | "name" | "email">) =>
  [squash(f.orgUnit), squash(f.name), f.email.toLowerCase()].join("|");

/** Issues of one line; 'email_used_more_than_once' needs the count of each mailbox across the directory. */
export function staffDirectoryIssues(
  f: StaffDirectoryFields & { companyId: Id | null },
  mailboxUses: Map<string, number>,
): StaffDirectoryIssue[] {
  const out: StaffDirectoryIssue[] = [];
  const e = f.email.toLowerCase();
  if (!e) out.push("no_email");
  else if (!EMAIL.test(e)) out.push("invalid_email");
  if (TYPO.test(e)) out.push("typo_domain");
  if (e && PERSONAL.test(e)) out.push("personal_outlook");
  if (e && (mailboxUses.get(e) ?? 0) > 1) out.push("email_used_more_than_once");
  if (!f.title) out.push("no_title");
  if (!f.entraStatus || !f.verified || !f.accountStatus)
    out.push("status_missing");
  if (f.group === "company" && !f.companyId) out.push("company_not_matched");
  return out;
}

/** A company line matches a Prima company only by its exact name, ignoring case, spaces and punctuation. */
function companyFor(orgUnit: string, companies: Company[]): Id | null {
  const want = squash(orgUnit);
  const hits = companies.filter((c) => squash(c.name) === want);
  return hits.length === 1 ? hits[0].id : null;
}

/** Check one line's values; returns the cleaned fields and what is wrong. */
function checkFields(raw: Record<keyof StaffDirectoryFields, string>): {
  fields: StaffDirectoryFields;
  errors: string[];
} {
  const errors: string[] = [];
  const v = Object.fromEntries(
    Object.entries(raw).map(([k, x]) => [k, tidy(x ?? "")]),
  ) as Record<keyof StaffDirectoryFields, string>;
  for (const [k, x] of Object.entries(raw))
    if (CONTROL.test(x ?? "")) errors.push(`${k} holds a control character.`);
  const group = v.group.toLowerCase().replace(/[\s-]+/g, "_");
  if (!v.group)
    errors.push(
      "Group is missing: company, central_unit or operations_region.",
    );
  else if (!STAFF_DIRECTORY_GROUPS.includes(group as StaffDirectoryGroup))
    errors.push(
      `Group "${v.group}" is not company, central_unit or operations_region.`,
    );
  if (!v.orgUnit) errors.push("Company, unit or region is missing.");
  if (!v.name) errors.push("Name is missing.");
  const long: [keyof StaffDirectoryFields, number][] = [
    ["orgUnit", MAX.orgUnit],
    ["name", MAX.name],
    ["title", MAX.title],
    ["email", MAX.email],
    ["accountType", MAX.status],
    ["entraStatus", MAX.status],
    ["verified", MAX.status],
    ["accountStatus", MAX.status],
  ];
  for (const [k, n] of long)
    if (v[k].length > n) errors.push(`${k} is longer than ${n} characters.`);
  return {
    fields: {
      ...v,
      group: group as StaffDirectoryGroup,
      email: v.email.toLowerCase(),
    },
    errors,
  };
}

export class StaffDirectoryService {
  constructor(
    private readonly store: Store,
    private readonly clock: () => IsoDateTime,
  ) {}

  /** The signed-in person as stored now: open, a person (not a system feed or site device), and allowed to view. */
  private async actor(user: User, tx: Store = this.store) {
    const u = await tx.get("users", user.id);
    if (
      !u ||
      u.integration ||
      u.role === "site_device" ||
      accessClosed(u, dateOf(this.clock()))
    )
      throw new AccessDenied("view", "(staff directory)");
    const r = role(u);
    if (!r.view)
      throw new AccessDenied(
        "view",
        "(staff directory: HR, the HR Director, the CEO and IT only)",
      );
    return { u, r };
  }

  /** What is missing in the database for the directory; empty when ready. */
  async problems(): Promise<string[]> {
    return (await this.store.staffDirectoryProblems?.()) ?? [];
  }

  private async ready(tx: Store) {
    const p = (await tx.staffDirectoryProblems?.()) ?? [];
    if (p.length)
      throw new BadRequest(
        "The staff directory is not set up in the database yet.",
      );
  }

  async board(user: User) {
    const { u, r } = await this.actor(user);
    const [entries, batches, companies] = await Promise.all([
      this.store.list("staffDirectory", {}),
      this.store.list("staffDirectoryBatches", {}),
      this.store.list("companies", {}),
    ]);
    const uses = new Map<string, number>();
    for (const e of entries)
      if (e.email) uses.set(e.email, (uses.get(e.email) ?? 0) + 1);
    const names = new Map(companies.map((c) => [c.id, c.name]));
    const rows = entries
      .map((e) => ({
        ...e,
        companyName: e.companyId ? (names.get(e.companyId) ?? null) : null,
        issues: staffDirectoryIssues(e, uses),
      }))
      .sort(
        (a, b) =>
          a.group.localeCompare(b.group) ||
          a.orgUnit.localeCompare(b.orgUnit) ||
          a.name.localeCompare(b.name),
      );
    const counts: Partial<Record<StaffDirectoryIssue, number>> = {};
    for (const e of rows)
      for (const i of e.issues) counts[i] = (counts[i] ?? 0) + 1;
    return {
      userId: u.id,
      can: { prepare: r.prepare, approve: r.approve, addOne: r.prepare },
      entries: rows,
      issueCounts: counts,
      batches: batches
        .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))
        .map((b) => ({
          id: b.id,
          source: b.source,
          rows: b.rows.length,
          alreadyIn: b.alreadyIn.length,
          // K2/K10: the counts for the load log: rows in the file, loaded (on approval) and refused with reasons.
          inFile: b.rows.length + b.alreadyIn.length + (b.refused?.length ?? 0),
          refused: b.refused ?? [],
          preparedBy: b.preparedBy,
          preparedAt: b.preparedAt,
          status: b.status,
          decidedBy: b.decidedBy,
          decidedAt: b.decidedAt,
          comment: b.comment,
          canDecide:
            b.status === "waiting" && r.approve && b.preparedById !== u.id,
          ownBatch: b.preparedById === u.id,
        })),
    };
  }

  /** Read the rows and check them; changes nothing. */
  async preview(
    user: User,
    input: { text: string; source: string },
    tx: Store = this.store,
  ): Promise<StaffDirectoryPreview> {
    const { r } = await this.actor(user, tx);
    if (!r.prepare)
      throw new AccessDenied(
        "view",
        "(staff directory: only HR prepares the list)",
      );
    if (typeof input.text !== "string" || !input.text.trim())
      throw new BadRequest(
        "Choose the CSV file or paste the rows with their heading row.",
      );
    if (input.text.length > STAFF_DIRECTORY_MAX_CHARS)
      throw new BadRequest("This is too much for one batch. Split it.");
    const source = tidy(typeof input.source === "string" ? input.source : "");
    if (source.length < 3 || source.length > MAX.source)
      throw new BadRequest(
        `Say where the rows come from (3 to ${MAX.source} characters), for example the file name.`,
      );
    const table = parseItImportTable(input.text);
    const problems = [...table.problems];
    const [head, ...body] = table.records;
    const cols = (head?.cells ?? []).map(squash);
    const at: Partial<Record<keyof StaffDirectoryFields, number>> = {};
    for (const k of Object.keys(HEADINGS) as (keyof StaffDirectoryFields)[]) {
      const i = cols.findIndex((c) => HEADINGS[k].includes(c));
      if (i >= 0) at[k] = i;
    }
    const missingColumns = REQUIRED.filter((k) => at[k] === undefined);
    if (body.length > STAFF_DIRECTORY_MAX_ROWS)
      throw new BadRequest(
        `One batch takes at most ${STAFF_DIRECTORY_MAX_ROWS} rows. Split it.`,
      );
    const [entries, companies] = await Promise.all([
      tx.list("staffDirectory", {}),
      tx.list("companies", {}),
    ]);
    const existing = new Set(entries.map(key));
    const seen = new Map<string, number>();
    const uses = new Map<string, number>();
    const rows: StaffDirectoryPreviewRow[] = body.map((rec) => {
      const raw = Object.fromEntries(
        (Object.keys(HEADINGS) as (keyof StaffDirectoryFields)[]).map((k) => [
          k,
          at[k] === undefined ? "" : (rec.cells[at[k]!] ?? ""),
        ]),
      ) as Record<keyof StaffDirectoryFields, string>;
      const { fields, errors } = checkFields(raw);
      errors.unshift(...rec.errors);
      const k = key(fields);
      const first = seen.get(k);
      if (first !== undefined) errors.push(`Repeats row ${first}.`);
      else seen.set(k, rec.row);
      const companyId =
        fields.group === "company"
          ? companyFor(fields.orgUnit, companies)
          : null;
      return {
        ...fields,
        row: rec.row,
        companyId,
        issues: [],
        errors,
        alreadyIn: existing.has(k),
      };
    });
    for (const e of entries)
      if (e.email) uses.set(e.email, (uses.get(e.email) ?? 0) + 1);
    for (const x of rows)
      if (x.email && !x.errors.length && !x.alreadyIn)
        uses.set(x.email, (uses.get(x.email) ?? 0) + 1);
    for (const x of rows) x.issues = staffDirectoryIssues(x, uses);
    const canonical = rows.map((x) => [
      x.row,
      x.group,
      x.orgUnit,
      x.name,
      x.title,
      x.email,
      x.accountType,
      x.entraStatus,
      x.verified,
      x.accountStatus,
    ]);
    const fingerprint = sha256Hex(JSON.stringify(canonical));
    return {
      source,
      fingerprint,
      missingColumns,
      problems,
      rows,
      ready: rows.filter((x) => !x.errors.length && !x.alreadyIn).length,
    };
  }

  /**
   * HR sends a checked batch for approval. Refused while any row has an error, so what is approved is the whole file
   * less the rows already in the directory. The same rows cannot be sent again unless the earlier batch was returned.
   * K2 (Fauzan, 11 Nov 2026: "turn on" the bulk load, a bad row refused with a reason): with `leaveOutBad` HR sends the
   * good rows and the rows with errors are left out, each kept on the batch with its reasons for the approver to see.
   */
  async submit(
    user: User,
    input: { text: string; source: string; fingerprint: string; leaveOutBad?: boolean },
  ) {
    return this.store.transaction(async (tx) => {
      await this.ready(tx);
      await tx.lock?.("staffDirectoryBatches", "staff-directory");
      const { u } = await this.actor(user, tx);
      const p = await this.preview(u, input, tx);
      if (p.fingerprint !== input.fingerprint)
        throw new BadRequest(
          "The rows changed since your preview. Preview again and check them.",
        );
      if (p.problems.length) throw new BadRequest(p.problems.join(" "));
      if (p.missingColumns.length)
        throw new BadRequest(
          `These columns are missing: ${p.missingColumns.join(", ")}.`,
        );
      const bad = p.rows.filter((x) => x.errors.length);
      if (bad.length && input.leaveOutBad !== true)
        throw new BadRequest(
          `Fix row ${bad.map((x) => x.row).join(", ")} first, or leave ${bad.length === 1 ? "it" : "them"} out: ${bad
            .slice(0, 5)
            .map((x) => `row ${x.row}: ${x.errors.join(" ")}`)
            .join("; ")}`,
        );
      if (!p.ready)
        throw new BadRequest(
          "Every row is already in the directory. Nothing to send.",
        );
      const batches = await tx.list("staffDirectoryBatches", {});
      const same = batches.find(
        (b) => b.fingerprint === p.fingerprint && b.status !== "returned",
      );
      if (same)
        throw new BadRequest(
          same.status === "approved"
            ? "These rows were already loaded."
            : "These rows are already waiting for approval.",
        );
      const at = this.clock();
      const batch: StaffDirectoryBatch = {
        id: `sdb-${p.fingerprint.slice(0, 16)}-${batches.length + 1}`,
        source: p.source,
        fingerprint: p.fingerprint,
        rows: p.rows
          .filter((x) => !x.alreadyIn && !x.errors.length)
          .map(({ issues: _i, errors: _e, alreadyIn: _a, ...f }) => f),
        alreadyIn: p.rows.filter((x) => x.alreadyIn).map((x) => x.row),
        ...(bad.length
          ? { refused: bad.map((x) => ({ row: x.row, reasons: x.errors.slice(0, 6) })) }
          : {}),
        preparedById: u.id,
        preparedBy: u.name,
        preparedAt: at,
        status: "waiting",
        decidedById: null,
        decidedBy: null,
        decidedAt: null,
        comment: "",
      };
      await tx.insert("staffDirectoryBatches", batch);
      await tx.audit({
        at,
        actor: u.name,
        companyId: null,
        action: "staff_directory.batch.submit",
        entity: "staff_directory_batch",
        entityId: batch.id,
        summary: `Staff directory batch of ${batch.rows.length} rows from ${batch.source} sent for approval; ${batch.alreadyIn.length} rows already in; ${bad.length} rows left out with their reasons. Fingerprint ${p.fingerprint.slice(0, 12)}.`,
      });
      return {
        id: batch.id,
        rows: batch.rows.length,
        alreadyIn: batch.alreadyIn.length,
        refused: bad.length,
      };
    });
  }

  /**
   * The HR Director or the CEO approves or returns a waiting batch, with a comment, never their own. Approving adds
   * every row in one step; a row that has reached the directory meanwhile stops the whole approval.
   */
  async decide(
    user: User,
    input: { batchId: string; approve: boolean; comment: string },
  ) {
    return this.store.transaction(async (tx) => {
      await this.ready(tx);
      await tx.lock?.("staffDirectoryBatches", "staff-directory");
      const { u, r } = await this.actor(user, tx);
      if (!r.approve)
        throw new AccessDenied(
          "view",
          "(staff directory: only the HR Director or the CEO approves)",
        );
      const b =
        typeof input.batchId === "string"
          ? await tx.get("staffDirectoryBatches", input.batchId)
          : undefined;
      if (!b) throw new BadRequest("Batch not found.");
      if (b.status !== "waiting")
        throw new BadRequest(`This batch was already ${b.status}.`);
      if (b.preparedById === u.id)
        throw new BadRequest(
          "Someone other than the person who prepared the batch approves it.",
        );
      const comment = tidy(
        typeof input.comment === "string" ? input.comment : "",
      );
      if (
        comment.length < 3 ||
        comment.length > MAX.comment ||
        CONTROL.test(comment)
      )
        throw new BadRequest(
          `Give a comment (3 to ${MAX.comment} characters).`,
        );
      const at = this.clock();
      if (input.approve === true) {
        const entries = await tx.list("staffDirectory", {});
        const existing = new Set(entries.map(key));
        const clash = b.rows.filter((x) => existing.has(key(x)));
        if (clash.length)
          throw new BadRequest(
            `Row ${clash.map((x) => x.row).join(", ")} reached the directory after this batch was prepared. Return it so HR prepares it again.`,
          );
        for (const x of b.rows) {
          const { row, ...f } = x;
          const entry: StaffDirectoryEntry = {
            ...f,
            id: `sd-${b.id.slice(4)}-${row}`,
            batchId: b.id,
            addedById: u.id,
            addedAt: at,
            sourceNote: `${b.source}, row ${row}`,
          };
          await tx.insert("staffDirectory", entry);
        }
      }
      const decided = {
        status:
          input.approve === true
            ? ("approved" as const)
            : ("returned" as const),
        decidedById: u.id,
        decidedBy: u.name,
        decidedAt: at,
        comment,
      };
      await tx.update("staffDirectoryBatches", b.id, decided);
      await tx.audit({
        at,
        actor: u.name,
        companyId: null,
        action: `staff_directory.batch.${decided.status}`,
        entity: "staff_directory_batch",
        entityId: b.id,
        summary: `Staff directory batch from ${b.source} ${decided.status}${input.approve === true ? `: ${b.rows.length} entries added` : ""}. Comment: ${comment}`,
      });
      return {
        id: b.id,
        status: decided.status,
        added: input.approve === true ? b.rows.length : 0,
      };
    });
  }

  /** HR keys in one person missing from the list. Routine work: no second approval, but recorded with where it came from. */
  async addOne(user: User, input: Record<string, unknown>) {
    return this.store.transaction(async (tx) => {
      await this.ready(tx);
      await tx.lock?.("staffDirectoryBatches", "staff-directory");
      const { u, r } = await this.actor(user, tx);
      if (!r.prepare)
        throw new AccessDenied(
          "view",
          "(staff directory: only HR keys in staff)",
        );
      const s = (k: string) =>
        typeof input[k] === "string" ? (input[k] as string) : "";
      const { fields, errors } = checkFields({
        group: s("group"),
        orgUnit: s("orgUnit"),
        name: s("name"),
        title: s("title"),
        email: s("email"),
        accountType: s("accountType"),
        entraStatus: s("entraStatus"),
        verified: s("verified"),
        accountStatus: s("accountStatus"),
      });
      const note = tidy(s("sourceNote"));
      if (note.length < 3 || note.length > MAX.note || CONTROL.test(note))
        errors.push(
          `Say where the details come from (3 to ${MAX.note} characters).`,
        );
      if (errors.length) throw new BadRequest(errors.join(" "));
      const entries = await tx.list("staffDirectory", {});
      if (entries.some((e) => key(e) === key(fields)))
        throw new BadRequest(
          "This person with this mailbox is already in the directory.",
        );
      const at = this.clock();
      const companyId =
        fields.group === "company"
          ? companyFor(fields.orgUnit, await tx.list("companies", {}))
          : null;
      const entry: StaffDirectoryEntry = {
        ...fields,
        id: `sd-manual-${entries.length + 1}-${sha256Hex(key(fields) + at).slice(0, 8)}`,
        companyId,
        batchId: null,
        addedById: u.id,
        addedAt: at,
        sourceNote: note,
      };
      await tx.insert("staffDirectory", entry);
      await tx.audit({
        at,
        actor: u.name,
        companyId,
        action: "staff_directory.add",
        entity: "staff_directory",
        entityId: entry.id,
        summary: `Staff directory entry added by hand for ${fields.orgUnit}. Source: ${note}`,
      });
      return { id: entry.id };
    });
  }

  /** One entry point for the screen's actions. */
  async act(user: User, action: string, i: Record<string, unknown>) {
    const str = (k: string, n: number) =>
      typeof i[k] === "string" ? (i[k] as string).slice(0, n) : "";
    switch (action) {
      case "preview":
        return this.preview(user, {
          text: str("text", STAFF_DIRECTORY_MAX_CHARS + 1),
          source: str("source", MAX.source + 1),
        });
      case "submit":
        return this.submit(user, {
          text: str("text", STAFF_DIRECTORY_MAX_CHARS + 1),
          source: str("source", MAX.source + 1),
          fingerprint: str("fingerprint", 64),
          leaveOutBad: i.leaveOutBad === true,
        });
      case "decide":
        return this.decide(user, {
          batchId: str("batchId", 120),
          approve: i.approve === true,
          comment: str("comment", MAX.comment + 1),
        });
      case "addOne":
        return this.addOne(user, i);
      default:
        throw new BadRequest("Unknown staff directory action.");
    }
  }
}

export type StaffDirectoryBoard = Awaited<
  ReturnType<StaffDirectoryService["board"]>
>;