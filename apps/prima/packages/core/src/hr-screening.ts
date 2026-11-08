import { AccessDenied } from "./access";
import { isActHead } from "./access";
import { isHrDirector } from "./access";
import { hrKeeps } from "./hr";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";


export type ScreeningSubject =
  | "guard"
  | "officer"
  | "office"
  | "director"
  | "shareholder";
export type ScreeningCheckKind =
  | "application"
  | "interview"
  | "consent"
  | "identity"
  | "kdn_vetting"
  | "police"
  | "references"
  | "qualifications"
  | "medical"
  | "bankruptcy"
  | "company_search";
export type ScreeningCheckStatus =
  | "pending"
  | "clear"
  | "concern"
  | "not_needed";

export interface ScreeningCheck {
  kind: ScreeningCheckKind;
  status: ScreeningCheckStatus;
  /** Who gave the result: KDN eSIMS, PDRM, MDI (Insolvency), SSM, the previous employer, the clinic. */
  authority: string;
  /** Their reference, letter number or the file where the evidence is kept. */
  ref: string;
  resultOn: IsoDate | null;
  note: string;
  /** 'prima' when filled from a record HR already holds; otherwise the person who recorded it. */
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: {
    status: ScreeningCheckStatus;
    note: string;
    by: string;
    at: IsoDateTime;
  }[];
}

export type ScreeningResult = "cleared" | "cleared_pending" | "not_cleared";

export interface ScreeningCase {
  id: Id;
  companyId: Id;
  subject: ScreeningSubject;
  /** Staff and guards: their person record. Directors and shareholders have none. */
  personId: Id | null;
  name: string;
  idMasked: string;
  /** Applicant (first screening) or repeat screening of someone already in post. */
  purpose: "new" | "repeat";
  checks: ScreeningCheck[];
  decision: {
    result: ScreeningResult;
    note: string;
    conditions: string;
    by: string;
    byId: Id;
    at: IsoDateTime;
  } | null;
  repeatDueOn: IsoDate | null;
  status: "open" | "decided" | "withdrawn";
  openedBy: string;
  openedById: Id;
  at: IsoDateTime;
}

export const SCREENING_SUBJECT_LABEL: Record<ScreeningSubject, string> = {
  guard: "Guard",
  officer: "Officer",
  office: "Office staff",
  director: "Director",
  shareholder: "Shareholder",
};
export const SCREENING_CHECK_LABEL: Record<ScreeningCheckKind, string> = {
  application: "Application form",
  interview: "Interview",
  consent: "Written consent to the checks",
  identity: "Identity (IC or passport) seen",
  kdn_vetting: "KDN vetting (eSIMS)",
  police: "Police record check",
  references: "Previous employer references",
  qualifications: "Certificates and qualifications verified",
  medical: "Medical fitness",
  bankruptcy: "Bankruptcy search (MDI)",
  company_search: "SSM search: disqualified or struck-off links",
};
export const SCREENING_RESULT_LABEL: Record<ScreeningResult, string> = {
  cleared: "Cleared",
  cleared_pending: "Cleared to start, KDN vetting pending",
  not_cleared: "Not cleared",
};

/** The checks each kind of person needs (approved by Fauzan, 8 Nov 2026; the PIKM code text may add or change some). */
export const SCREENING_CHECKS: Record<ScreeningSubject, ScreeningCheckKind[]> =
  {
    guard: [
      "application",
      "interview",
      "consent",
      "identity",
      "kdn_vetting",
      "police",
      "references",
      "medical",
    ],
    officer: [
      "application",
      "interview",
      "consent",
      "identity",
      "kdn_vetting",
      "police",
      "references",
      "medical",
    ],
    office: [
      "application",
      "interview",
      "consent",
      "identity",
      "references",
      "qualifications",
    ],
    director: ["consent", "identity", "police", "bankruptcy", "company_search"],
    shareholder: [
      "consent",
      "identity",
      "police",
      "bankruptcy",
      "company_search",
    ],
  };
/** Months until screening is repeated (proposal for approval). */
export const SCREENING_REPEAT_MONTHS: Record<ScreeningSubject, number> = {
  guard: 36,
  officer: 36,
  office: 36,
  director: 12,
  shareholder: 12,
};
const DUE_SOON_DAYS = 60;

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const isDate = (v: unknown): v is IsoDate =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const oneOf = <T extends string>(
  v: unknown,
  labels: Record<T, string>,
): T | null =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(labels, v)
    ? (v as T)
    : null;

export function screeningRole(user: User): "hr" | "decide" | "view" | null {
  if (user.integration) return null;
  if (isHrDirector(user)) return "decide";
  if (hrKeeps(user)) return "hr";
  if (
    user.opsTier === "ceo" ||
    isActHead(user) ||
    (user.role === "pwvsb_officer" && user.department === "audit")
  )
    return "view";
  return null;
}

/** What a decision may be, given the checks. Prima only says what is still open; a person decides. */
export function screeningReadiness(
  c: Pick<ScreeningCase, "subject" | "checks">,
) {
  const open = c.checks.filter((k) => k.status === "pending");
  const concerns = c.checks.filter((k) => k.status === "concern");
  const field = c.subject === "guard" || c.subject === "officer";
  return {
    open: open.map((k) => k.kind),
    concerns: concerns.map((k) => k.kind),
    canClear: open.length === 0,
    // Fauzan, 24 Oct 2026: a guard may work while KDN vetting is pending once it is submitted in eSIMS.
    canClearPending:
      field &&
      open.length === 1 &&
      open[0].kind === "kdn_vetting" &&
      !!open[0].ref,
  };
}

export class ScreeningService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
  ) {}
  private today(): IsoDate {
    return this.clock().slice(0, 10);
  }
  private async mustBeReady() {
    if (this.store.screeningReady && !(await this.store.screeningReady()))
      throw new BadRequest(
        "Screening is not switched on yet. The database part waits for the CEO to approve it.",
      );
  }

  async board(user: User) {
    const role = screeningRole(user);
    if (!role) throw new AccessDenied("hr.monitor", "(screening)");
    await this.mustBeReady();
    const today = this.today();
    const [cases, companies] = await Promise.all([
      this.store.list("hrScreenings", {}),
      this.store.list("companies", {}),
    ]);
    const rows = cases
      .map((c) => {
        const ready = screeningReadiness(c);
        const repeatState =
          c.repeatDueOn && c.status === "decided"
            ? c.repeatDueOn < today
              ? "overdue"
              : daysBetween(today, c.repeatDueOn) <= DUE_SOON_DAYS
                ? "due_soon"
                : "ok"
            : null;
        return {
          case: c,
          companyName:
            companies.find((x) => x.id === c.companyId)?.name ?? c.companyId,
          ...ready,
          repeatState,
          canWork: c.status === "open" && (role === "hr" || role === "decide"),
          canDecide:
            c.status === "open" &&
            role === "decide" &&
            c.openedById !== user.id,
          canRepeat:
            c.status === "decided" &&
            (role === "hr" || role === "decide") &&
            repeatState !== "ok" &&
            !cases.some(
              (x) =>
                x.status === "open" &&
                x.name === c.name &&
                x.companyId === c.companyId &&
                x.id !== c.id,
            ),
        };
      })
      .sort(
        (a, b) =>
          Number(b.case.status === "open") - Number(a.case.status === "open") ||
          (a.repeatState === "overdue" ? -1 : 0) -
            (b.repeatState === "overdue" ? -1 : 0) ||
          b.case.at.localeCompare(a.case.at),
      );
    return {
      role,
      rows,
      companies: companies.map((c) => ({ id: c.id, name: c.name })),
      kpis: {
        open: rows.filter((r) => r.case.status === "open").length,
        readyToDecide: rows.filter(
          (r) => r.case.status === "open" && (r.canClear || r.canClearPending),
        ).length,
        vettingPending: rows.filter(
          (r) => r.case.decision?.result === "cleared_pending",
        ).length,
        repeatDue: rows.filter(
          (r) => r.repeatState === "overdue" || r.repeatState === "due_soon",
        ).length,
      },
    };
  }

  async act(user: User, action: string, b: Record<string, unknown>) {
    await this.mustBeReady();
    switch (action) {
      case "open":
        return this.open(user, b);
      case "check":
        return this.check(user, b);
      case "decide":
        return this.decide(user, b);
      case "withdraw":
        return this.withdraw(user, b);
      default:
        throw new BadRequest("Unknown action.");
    }
  }

  /** HR opens a case. For staff and guards, Prima fills in what HR already holds; only the missing checks need work. */
  private async open(
    user: User,
    b: Record<string, unknown>,
    repeatOf?: ScreeningCase,
  ) {
    const role = screeningRole(user);
    if (role !== "hr" && role !== "decide")
      throw new AccessDenied("hr.monitor", "(HR opens screening cases)");
    const subject = oneOf(b.subject, SCREENING_SUBJECT_LABEL);
    if (!subject) throw new BadRequest("Choose who is being screened.");
    const at = this.clock();
    let companyId = text(b.companyId, 80);
    let personId: Id | null = null;
    let name = text(b.name, 120);
    let idMasked = text(b.idMasked, 40);
    const credentials: {
      type: string;
      number: string;
      issuedOn: IsoDate;
      expiresOn: IsoDate | null;
    }[] = [];
    if (subject === "director" || subject === "shareholder") {
      if (!(await this.store.get("companies", companyId)))
        throw new BadRequest("Choose the company.");
      if (name.length < 3)
        throw new BadRequest("Give the name as on the IC or passport.");
      if (idMasked.length < 4)
        throw new BadRequest(
          "Give the masked IC or passport number (last 4 digits).",
        );
    } else {
      // HR picks the person by record or types the staff number from the file.
      const staffNo = text(b.staffNo, 40);
      const p = text(b.personId, 80)
        ? await this.store.get("people", text(b.personId, 80))
        : staffNo
          ? (await this.store.list("people", { staffNo })).find(
              (x) => x.status === "active",
            )
          : undefined;
      if (!p) throw new NotFound("Staff member");
      const expected =
        p.role === "office"
          ? "office"
          : p.role === "guard"
            ? "guard"
            : "officer";
      if (expected !== subject)
        throw new BadRequest(
          `This person is recorded as ${SCREENING_SUBJECT_LABEL[expected].toLowerCase()}.`,
        );
      personId = p.id;
      companyId = p.companyId;
      name = p.name;
      idMasked = p.idMasked;
      credentials.push(
        ...(await this.store.list("credentials", { personId: p.id })),
      );
    }
    const purpose = repeatOf
      ? "repeat"
      : b.purpose === "repeat"
        ? "repeat"
        : "new";
    const today = this.today();
    const checks: ScreeningCheck[] = SCREENING_CHECKS[subject].map((kind) => {
      const base: ScreeningCheck = {
        kind,
        status: "pending",
        authority: "",
        ref: "",
        resultOn: null,
        note: "",
        by: user.name,
        byId: user.id,
        at,
        history: [],
      };
      if (kind === "kdn_vetting") {
        // Reuse the licence records: a valid KDN guard card is the authority's clearance; a submitted vetting stays pending.
        const card = credentials.find(
          (c) =>
            c.type === "KDN_GUARD_CARD" &&
            (!c.expiresOn || c.expiresOn >= today),
        );
        const sub = credentials.find((c) => c.type === "KDN_VETTING");
        if (card)
          return {
            ...base,
            status: "clear",
            authority: "KDN",
            ref: card.number,
            resultOn: card.issuedOn,
            note: "From the licence record",
            by: "Prima (licence record)",
            byId: "prima",
          };
        if (sub)
          return {
            ...base,
            authority: "KDN eSIMS",
            ref: sub.number,
            note: `Submitted ${sub.issuedOn}, from the licence record`,
            by: "Prima (licence record)",
            byId: "prima",
          };
      }
      if (kind === "identity" && idMasked)
        return { ...base, note: `On file: ${idMasked}. Check the original.` };
      return base;
    });
    const c: ScreeningCase = {
      id: `scr-${companyId}-${Date.parse(at).toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`,
      companyId,
      subject,
      personId,
      name,
      idMasked,
      purpose,
      checks,
      decision: null,
      repeatDueOn: null,
      status: "open",
      openedBy: user.name,
      openedById: user.id,
      at,
    };
    return this.store.transaction(async (tx) => {
      const open = (await tx.list("hrScreenings", { companyId })).find(
        (x) =>
          x.status === "open" &&
          (personId
            ? x.personId === personId
            : x.name.toLowerCase() === name.toLowerCase()),
      );
      if (open)
        throw new BadRequest(
          "There is already an open screening case for this person.",
        );
      await tx.insert("hrScreenings", c);
      await tx.audit({
        at,
        actor: user.name,
        companyId,
        action: "hr.screening.open",
        entity: "hr_screening",
        entityId: c.id,
        summary: `Screening opened: ${name} (${SCREENING_SUBJECT_LABEL[subject].toLowerCase()}, ${purpose === "repeat" ? "repeat" : "new"}).`,
      });
      return c;
    });
  }

  /** Record one check's result. A concern or "not needed" needs a reason; the authority's reference is kept. */
  private async check(user: User, b: Record<string, unknown>) {
    const role = screeningRole(user);
    if (role !== "hr" && role !== "decide")
      throw new AccessDenied("hr.monitor", "(HR records checks)");
    const kind = oneOf(b.kind, SCREENING_CHECK_LABEL);
    const status =
      b.status === "clear" ||
      b.status === "concern" ||
      b.status === "not_needed" ||
      b.status === "pending"
        ? b.status
        : null;
    if (!kind || !status)
      throw new BadRequest("Choose the check and its result.");
    const note = text(b.note, 400);
    const ref = text(b.ref, 160);
    const authority = text(b.authority, 80);
    if ((status === "concern" || status === "not_needed") && note.length < 5)
      throw new BadRequest(
        "Say why: a concern or a check not needed needs a reason.",
      );
    const resultOn = isDate(b.resultOn)
      ? b.resultOn
      : status === "pending"
        ? null
        : this.today();
    if (resultOn && resultOn > this.today())
      throw new BadRequest("The result date cannot be in the future.");
    const at = this.clock();
    const id = text(b.id, 160);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("hrScreenings", id);
      const c = await tx.get("hrScreenings", id);
      if (!c) throw new NotFound("Screening case");
      if (c.status !== "open") throw new BadRequest("This case is closed.");
      const old = c.checks.find((k) => k.kind === kind);
      if (!old) throw new BadRequest("This check is not part of this case.");
      // A reference already on file (the KDN vetting number filled from the licence record) counts.
      if (
        status === "clear" &&
        !ref &&
        !old.ref &&
        kind !== "interview" &&
        kind !== "identity"
      )
        throw new BadRequest(
          "Give the reference: the letter, result number or where the evidence is filed.",
        );
      const updated: ScreeningCheck = {
        ...old,
        status,
        authority: authority || old.authority,
        ref: ref || old.ref,
        resultOn,
        note: note || (status === old.status ? old.note : ""),
        by: user.name,
        byId: user.id,
        at,
        history: [
          ...old.history,
          { status: old.status, note: old.note, by: old.by, at: old.at },
        ].slice(-20),
      };
      await tx.update("hrScreenings", id, {
        checks: c.checks.map((k) => (k.kind === kind ? updated : k)),
      });
      await tx.audit({
        at,
        actor: user.name,
        companyId: c.companyId,
        action: "hr.screening.check",
        entity: "hr_screening",
        entityId: id,
        summary: `${c.name}: ${SCREENING_CHECK_LABEL[kind]} ${status.replace("_", " ")}${ref ? ` (${ref})` : ""}.`,
      });
      return (await tx.get("hrScreenings", id))!;
    });
  }

  /** The HR Director decides, with a reason, never on a case they opened. Concerns need written conditions to clear. */
  private async decide(user: User, b: Record<string, unknown>) {
    if (screeningRole(user) !== "decide")
      throw new AccessDenied(
        "hr.monitor",
        "(the HR Director decides screening)",
      );
    const result = oneOf(b.result, SCREENING_RESULT_LABEL);
    if (!result) throw new BadRequest("Choose the decision.");
    const note = text(b.note, 600);
    if (note.length < 5)
      throw new BadRequest("Give the reason for the decision.");
    const conditions = text(b.conditions, 400);
    const at = this.clock();
    const id = text(b.id, 160);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("hrScreenings", id);
      const c = await tx.get("hrScreenings", id);
      if (!c) throw new NotFound("Screening case");
      if (c.status !== "open")
        throw new BadRequest("This case is already decided.");
      if (c.openedById === user.id)
        throw new BadRequest(
          "You opened this case. The other HR Director decides.",
        );
      const r = screeningReadiness(c);
      if (result === "cleared" && !r.canClear)
        throw new BadRequest(
          `Still open: ${r.open.map((k) => SCREENING_CHECK_LABEL[k]).join(", ")}.`,
        );
      if (result === "cleared_pending" && !r.canClearPending)
        throw new BadRequest(
          "Only for a guard or officer whose KDN vetting has been submitted and every other check is done.",
        );
      if (
        result !== "not_cleared" &&
        r.concerns.length &&
        conditions.length < 5
      )
        throw new BadRequest(
          "There is a concern on file. Write the conditions for clearing, or decide not cleared.",
        );
      const repeatDueOn =
        result === "not_cleared"
          ? null
          : addDays(
              this.today(),
              Math.round(SCREENING_REPEAT_MONTHS[c.subject] * 30.44),
            );
      await tx.update("hrScreenings", id, {
        status: "decided",
        decision: {
          result,
          note,
          conditions,
          by: user.name,
          byId: user.id,
          at,
        },
        repeatDueOn,
      });
      await tx.audit({
        at,
        actor: user.name,
        companyId: c.companyId,
        action: "hr.screening.decide",
        entity: "hr_screening",
        entityId: id,
        summary: `${c.name}: ${SCREENING_RESULT_LABEL[result]} (${note})${conditions ? `; conditions: ${conditions}` : ""}.`,
      });
      return (await tx.get("hrScreenings", id))!;
    });
  }

  private async withdraw(user: User, b: Record<string, unknown>) {
    const role = screeningRole(user);
    if (role !== "hr" && role !== "decide")
      throw new AccessDenied("hr.monitor", "(HR withdraws screening cases)");
    const note = text(b.note, 300);
    if (note.length < 5)
      throw new BadRequest(
        "Say why the case is withdrawn (applicant withdrew, post filled).",
      );
    const at = this.clock();
    const id = text(b.id, 160);
    return this.store.transaction(async (tx) => {
      const c = await tx.get("hrScreenings", id);
      if (!c) throw new NotFound("Screening case");
      if (c.status !== "open")
        throw new BadRequest("Only an open case can be withdrawn.");
      await tx.update("hrScreenings", id, {
        status: "withdrawn",
        decision: null,
      });
      await tx.audit({
        at,
        actor: user.name,
        companyId: c.companyId,
        action: "hr.screening.withdraw",
        entity: "hr_screening",
        entityId: id,
        summary: `${c.name}: withdrawn (${note}).`,
      });
      return (await tx.get("hrScreenings", id))!;
    });
  }

  /** Repeat screening: a new case for the same person, prefilled the same way. */
  async repeat(user: User, id: Id) {
    await this.mustBeReady();
    const c = await this.store.get("hrScreenings", id);
    if (!c || c.status !== "decided")
      throw new NotFound("Decided screening case");
    // Repeat when it falls due (60 days ahead) or after a "not cleared"; never twice at once (open() refuses that).
    if (
      c.decision?.result !== "not_cleared" &&
      c.repeatDueOn &&
      daysBetween(this.today(), c.repeatDueOn) > DUE_SOON_DAYS
    )
      throw new BadRequest(
        `Repeat screening is due on ${c.repeatDueOn}; it can start ${DUE_SOON_DAYS} days before.`,
      );
    return this.open(
      user,
      {
        subject: c.subject,
        personId: c.personId,
        companyId: c.companyId,
        name: c.name,
        idMasked: c.idMasked,
        purpose: "repeat",
      },
      c,
    );
  }

  /** One grouped line each: HR for repeat screening due, the HR Director for cases ready to decide. */
  async homeItems(user: User) {
    const role = screeningRole(user);
    if (role !== "hr" && role !== "decide") return [];
    try {
      const b = await this.board(user);
      const items: {
        tone: "warn" | "info";
        tag: string;
        title: string;
        detail: string;
        go: { view: "hr" };
      }[] = [];
      const ready = b.rows.filter(
        (r) => r.canDecide && (r.canClear || r.canClearPending),
      );
      if (role === "decide" && ready.length)
        items.push({
          tone: "warn",
          tag: "Screening",
          title: `${ready.length} screening case${ready.length === 1 ? "" : "s"} ready for your decision`,
          detail: ready
            .slice(0, 3)
            .map((r) => r.case.name)
            .join(", "),
          go: { view: "hr" },
        });
      const due = b.rows.filter(
        (r) => r.repeatState === "overdue" || r.repeatState === "due_soon",
      );
      if (due.length)
        items.push({
          tone: "info",
          tag: "Screening",
          title: `${due.length} repeat screening${due.length === 1 ? "" : "s"} due`,
          detail: due
            .slice(0, 3)
            .map((r) => r.case.name)
            .join(", "),
          go: { view: "hr" },
        });
      return items;
    } catch {
      return [];
    }
  }
}