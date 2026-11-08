import { AccessDenied } from "./access";
import { GROUP_EMPLOYER_ID } from "./access";
import { isGroupLeader } from "./access";
import { isHrDirector } from "./access";
import { visibleCompanyIds } from "./access";
import { foundationSummary } from "./quality";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import type { ActFinding } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { PurSupplier } from "./types";
import type { User } from "./types";


// ---------- Records ----------

export interface QmsOpsNote {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

export type NcSource =
  | "client_complaint"
  | "site_visit"
  | "case"
  | "internal_check"
  | "audit";
export type NcOutcome = "corrected" | "client_accepted" | "service_stopped";

/** One service fault: the service given was not what the contract or our own procedure says. */
export interface QmsNonconformity {
  id: Id;
  ref: string;
  companyId: Id;
  siteId: Id | null;
  source: NcSource;
  /** A case or complaint reference it came from, if any (typed; Prima does not check it). */
  sourceRef: string;
  what: string;
  detectedOn: IsoDate;
  serious: boolean;
  /** What was done at once to put it right or contain it. */
  correction: string;
  clientTold: boolean;
  clientNote: string;
  /** Earlier faults at the same site within the repeat window, found by Prima when this one was recorded. */
  repeatOf: Id[];
  /** Root cause: needed when serious or a repeat; ACT raises it as a finding. */
  rootCause: {
    findingId: Id;
    findingRef: string;
    by: string;
    at: IsoDateTime;
  } | null;
  status: "open" | "closed";
  close: (QmsOpsNote & { outcome: NcOutcome; clientName: string }) | null;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: QmsOpsNote[];
}

/** One supplier performance rating, kept on the supplier record. Scores 1 (poor) to 5 (very good). */
export interface SupplierRating {
  on: IsoDate;
  quality: number;
  onTime: number;
  paperwork: number;
  issues: string;
  result: "keep" | "watch" | "stop";
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export type QmsItemKind = "objective" | "document" | "review";

/** A group-wide quality item: an objective, a controlled document version, or a management review record. */
export interface QmsItem {
  id: Id;
  kind: QmsItemKind;
  title: string;
  body: string;
  status:
    | "active"
    | "done"
    | "retired"
    | "draft"
    | "approved"
    | "not_agreed"
    | "replaced";
  /** Objective: how it is measured, the target, the owner by job title and the date. */
  measure?: string;
  target?: string;
  ownerTitle?: string;
  dueOn?: IsoDate;
  progress?: {
    on: IsoDate;
    value: string;
    note: string;
    by: string;
    at: IsoDateTime;
  }[];
  /** Document: its code (the same across versions), the link to the file and who uses it. */
  code?: string;
  link?: string;
  audience?: string;
  /** Review: when it was held, who attended, Prima's inputs pack at the time, and the decisions. */
  heldOn?: IsoDate;
  attendees?: string;
  inputs?: { label: string; value: string }[];
  decisions?: { text: string; ownerTitle: string; dueOn: IsoDate }[];
  version: number;
  decision: (QmsOpsNote & { agree: boolean }) | null;
  reviewEveryMonths: number;
  lastReviewedOn: IsoDate;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: QmsOpsNote[];
}

export const NC_SOURCE_LABEL: Record<NcSource, string> = {
  client_complaint: "Client complaint",
  site_visit: "Site visit",
  case: "Case on site",
  internal_check: "Our own check",
  audit: "ACT audit",
};
export const NC_OUTCOME_LABEL: Record<NcOutcome, string> = {
  corrected: "Put right",
  client_accepted: "Client accepted it as it is",
  service_stopped: "Service stopped until put right",
};
export const SUPPLIER_RESULT_LABEL: Record<SupplierRating["result"], string> = {
  keep: "Keep using",
  watch: "Keep, but watch",
  stop: "Stop using",
};
export const QMS_ITEM_LABEL: Record<QmsItemKind, string> = {
  objective: "Quality objectives",
  document: "Controlled documents",
  review: "Management review",
};

// ---------- Who does what ----------

export type OpsRole =
  | "keep"
  | "ceo"
  | "act"
  | "company"
  | "ops"
  | "proc"
  | "view";

/**
 * Roles here. ACT (department audit) keeps the quality items and raises root causes; the Chief of Staff or Deputy also
 * keeps the quality items; the CEO agrees review records and may approve documents; the company manager records
 * service faults for their own company; Operations (OM and up) for the sites they cover;
 * Procurement rates suppliers. Guards, officers and other staff have no role.
 */
export function opsRoleOf(user: User): OpsRole | null {
  if (
    user.integration ||
    user.role === "guard" ||
    user.role === "site_device" ||
    user.role === "supervisor"
  )
    return null;
  if (user.role === "director" || user.opsTier === "ceo") return "ceo";
  if (user.role === "pwvsb_officer" && user.department === "audit")
    return "act";
  if (isHrDirector(user)) return "keep";
  // Admin executives stay off quality screens (staff-ease review, 5 Nov 2026); the company manager records faults.
  if (user.role === "company_manager") return "company";
  if (
    user.role === "pwvsb_officer" &&
    user.department === "operations" &&
    ["om", "regional", "ops_director", "ogm", "coo"].includes(
      user.opsTier ?? "",
    )
  )
    return "ops";
  if (
    user.role === "pwvsb_officer" &&
    user.department === "procurement" &&
    user.procRole !== "storekeeper"
  )
    return "proc";
  if (isGroupLeader(user)) return "view";
  return null;
}

/** Who keeps objectives, documents and review records. */
const keeps = (r: OpsRole | null) => r === "act" || r === "keep";

// ---------- Helpers ----------

const MONTH_DAYS = 30.44;
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const isDate = (v: unknown): v is IsoDate =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v));
const oneOf = <T extends string>(
  v: unknown,
  labels: Record<T, string>,
): T | null =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(labels, v)
    ? (v as T)
    : null;
const stamp = (at: IsoDateTime) =>
  `${Date.parse(at).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const score = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
};

/** The supplier's rating state: never rated, due again, or the latest result. */
export function supplierRatingState(
  s: Pick<PurSupplier, "blocked"> & { performance?: SupplierRating[] },
  today: IsoDate,
) {
  const last = (s.performance ?? []).at(-1) ?? null;
  const dueOn = last
    ? addDays(last.on, RULES.qualityOps.value.supplierRateEveryDays)
    : null;
  const state: "not_rated" | "due" | SupplierRating["result"] = !last
    ? "not_rated"
    : dueOn! < today && !s.blocked
      ? "due"
      : last.result;
  return {
    last,
    dueOn,
    state,
    average: last
      ? Math.round(((last.quality + last.onTime + last.paperwork) / 3) * 10) /
        10
      : null,
  };
}

type RaiseFinding = (
  user: User,
  input: {
    companyId: Id | null;
    area: string;
    source: ActFinding["source"];
    title: string;
    detail: string;
    severity: ActFinding["severity"];
    evidence: string;
    ownerUserId: Id;
    origin?: "quality";
  },
) => Promise<ActFinding>;
/** Operations coverage for one company, loaded once: which of its sites this person covers. */
type OpsCoverage = (
  user: User,
  companyId: Id,
) => Promise<(siteIds: Id[]) => boolean>;

/** Actions handled here; the rest of the quality actions go to the register service. */
export const QUALITY_OPS_ACTIONS: readonly string[] = [
  "recordFault",
  "closeFault",
  "rootCause",
  "rateSupplier",
  "saveItem",
  "progress",
  "decideItem",
  "reviewItem",
  "retireItem",
];

// ---------- Service ----------

export class QualityOpsService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private raiseFinding: RaiseFinding,
    private opsCoverage: OpsCoverage,
  ) {}

  private today(): IsoDate {
    return this.clock().slice(0, 10);
  }
  private who(user: User) {
    return { by: user.name, byId: user.id, at: this.clock() };
  }
  private reason(v: unknown, what = "Say why") {
    const n = text(v, 400);
    if (n.length < 3) throw new BadRequest(`${what}: give a short reason.`);
    return n;
  }
  private async mustBeReady() {
    if (this.store.qualityReady && !(await this.store.qualityReady()))
      throw new BadRequest(
        "Quality and compliance is not switched on yet. The database part waits for the CEO to approve it.",
      );
  }

  /** Companies this person works with here. */
  private async companiesFor(user: User): Promise<Id[]> {
    if (user.role === "company_manager") return user.companyIds;
    if (user.role !== "director" && user.role !== "pwvsb_officer") return [];
    return visibleCompanyIds(
      user,
      await this.store.list("grants", {}),
      this.today(),
    ).filter((id) => id !== GROUP_EMPLOYER_ID);
  }

  /** May this person record or close a fault for this company and site? */
  private async mayRecord(
    user: User,
    companyId: Id,
    siteId: Id | null,
  ): Promise<boolean> {
    const role = opsRoleOf(user);
    if (!(await this.companiesFor(user)).includes(companyId)) return false;
    if (role === "company" || role === "act") return true;
    if (role === "ops")
      return siteId
        ? (await this.opsCoverage(user, companyId))([siteId])
        : false;
    return false;
  }

  // ----- Board -----

  /** Everything this person sees here, in one load. */
  async board(user: User, opts: { companyId?: Id } = {}) {
    const role = opsRoleOf(user);
    if (!role) throw new AccessDenied("view", "(quality operations)");
    await this.mustBeReady();
    const today = this.today();
    const companies = await this.companiesFor(user);
    const companyRows = (await this.store.list("companies", {})).filter((c) =>
      companies.includes(c.id),
    );
    const companyId =
      opts.companyId && companies.includes(opts.companyId)
        ? opts.companyId
        : (companies[0] ?? null);
    const rule = RULES.qualityOps.value;

    // Service faults: the chosen company only (Operations: only sites they cover).
    let faults: ReturnType<QualityOpsService["faultRow"]>[] = [];
    let sites: { id: Id; name: string }[] = [];
    if (companyId && role !== "proc") {
      const [rows, siteRows] = await Promise.all([
        this.store.list("qmsNonconformities", { companyId }),
        this.store.list("sites", { companyId }),
      ]);
      // Coverage is worked out once per load, not per row (an OM can cover hundreds of sites).
      const covers =
        role === "ops" ? await this.opsCoverage(user, companyId) : () => true;
      const shown = rows.filter(
        (r) => role !== "ops" || (!!r.siteId && covers([r.siteId])),
      );
      const siteName = new Map(siteRows.map((s) => [s.id, s.name]));
      faults = shown
        .map((r) =>
          this.faultRow(user, role, r, siteName.get(r.siteId ?? "") ?? null),
        )
        .sort(
          (a, b) =>
            Number(b.open) - Number(a.open) ||
            b.nc.detectedOn.localeCompare(a.nc.detectedOn),
        );
      sites = siteRows
        .filter((s) => covers([s.id]))
        .map((s) => ({ id: s.id, name: s.name }));
    }

    // Suppliers: Procurement sees every company it buys for; company managers their own; ACT and leaders watch.
    let suppliers: {
      id: Id;
      name: string;
      companyId: Id;
      companyName: string;
      blocked: boolean;
      rating: ReturnType<typeof supplierRatingState>;
      history: SupplierRating[];
      canRate: boolean;
    }[] = [];
    if (
      role === "proc" ||
      role === "company" ||
      role === "act" ||
      role === "view" ||
      role === "ceo" ||
      role === "keep"
    ) {
      const ids = role === "proc" ? null : companies;
      const all = ids
        ? ids.length
          ? await this.store.list("purSuppliers", { companyId: ids })
          : []
        : await this.store.list("purSuppliers", {});
      const cname = new Map(
        (await this.store.list("companies", {})).map((c) => [c.id, c.name]),
      );
      suppliers = all
        .map((s) => {
          const perf =
            (s as PurSupplier & { performance?: SupplierRating[] })
              .performance ?? [];
          return {
            id: s.id,
            name: s.name,
            companyId: s.companyId,
            companyName: cname.get(s.companyId) ?? s.companyId,
            blocked: !!s.blocked,
            rating: supplierRatingState(
              { blocked: s.blocked, performance: perf },
              today,
            ),
            history: perf.slice(-5).reverse(),
            canRate:
              !s.blocked &&
              (role === "proc" ||
                (user.role === "company_manager" &&
                  user.companyIds.includes(s.companyId))),
          };
        })
        .sort(
          (a, b) =>
            Number(b.rating.state === "due" || b.rating.state === "not_rated") -
              Number(
                a.rating.state === "due" || a.rating.state === "not_rated",
              ) || a.name.localeCompare(b.name),
        );
    }

    // Group items: objectives, documents, reviews. Company managers see what is in force; drafts and reviews stay with
    // the keepers and the CEO.
    const items =
      role === "proc" ? [] : await this.store.list("qmsItems", {});
    const inner = keeps(role) || role === "ceo";
    // A document with a new version waiting cannot get another one until that is decided.
    const waitingCodes = new Set(
      items
        .filter(
          (i) =>
            i.kind === "document" &&
            (i.status === "draft" || i.status === "not_agreed"),
        )
        .map((i) => i.code ?? ""),
    );
    const shownItems = items
      .filter((i) => inner || i.kind !== "review")
      .filter(
        (i) =>
          inner ||
          i.status === "active" ||
          i.status === "approved" ||
          i.status === "done",
      )
      .filter((i) => i.status !== "replaced" || inner)
      .map((i) => this.itemRow(user, role, i, today, waitingCodes))
      .sort(
        (a, b) =>
          Number(b.late) - Number(a.late) ||
          (b.item.at ?? "").localeCompare(a.item.at ?? ""),
      );

    const needRootCause = faults.filter(
      (f) => f.needsRootCause && !f.nc.rootCause,
    ).length;
    return {
      role,
      companies: companyRows.map((c) => ({ id: c.id, name: c.name })),
      companyId,
      sites,
      faults,
      suppliers,
      items: shownItems,
      actAreas:
        role === "act"
          ? RULES.act.value.areas.map((a) => ({ id: a.id, name: a.name }))
          : [],
      owners:
        role === "act" && companyId
          ? (await this.store.list("users", {}))
              .filter(
                (u) =>
                  u.role === "company_manager" &&
                  u.companyIds.includes(companyId),
              )
              .map((u) => ({ id: u.id, name: u.name }))
          : [],
      pack: inner ? await this.reviewPack(user) : null,
      kpis: {
        faultsOpen: faults.filter((f) => f.open).length,
        needRootCause,
        suppliersDue: suppliers.filter(
          (s) => s.rating.state === "due" || s.rating.state === "not_rated",
        ).length,
        suppliersWatch: suppliers.filter((s) => s.rating.state === "watch")
          .length,
        objectivesLate: shownItems.filter(
          (r) => r.item.kind === "objective" && r.late,
        ).length,
        documentsToApprove: shownItems.filter(
          (r) => r.canDecide && r.item.kind === "document",
        ).length,
      },
      rule: {
        repeatDays: rule.repeatDays,
        supplierRateEveryDays: rule.supplierRateEveryDays,
      },
    };
  }

  private faultRow(
    user: User,
    role: OpsRole,
    nc: QmsNonconformity,
    siteName: string | null,
  ) {
    const needsRootCause = nc.serious || nc.repeatOf.length > 0;
    return {
      nc,
      siteName,
      open: nc.status === "open",
      needsRootCause,
      canClose:
        nc.status === "open" &&
        role !== "view" &&
        role !== "ceo" &&
        role !== "keep",
      canRaise: role === "act" && needsRootCause && !nc.rootCause,
    };
  }

  private itemRow(
    user: User,
    role: OpsRole | null,
    i: QmsItem,
    today: IsoDate,
    waitingCodes: Set<string> = new Set(),
  ) {
    const reviewDueOn = addDays(
      i.lastReviewedOn,
      Math.round(i.reviewEveryMonths * MONTH_DAYS),
    );
    const live = i.status === "active" || i.status === "approved";
    const late =
      i.kind === "objective"
        ? i.status === "active" && !!i.dueOn && i.dueOn < today
        : i.kind === "document"
          ? live && reviewDueOn < today
          : false;
    const keeper = keeps(role);
    return {
      item: i,
      reviewDueOn,
      late,
      canEdit:
        keeper &&
        (i.kind === "objective"
          ? i.status === "active"
          : i.kind === "document"
            ? (i.status === "approved" && !waitingCodes.has(i.code ?? "")) ||
              (i.byId === user.id &&
                (i.status === "draft" || i.status === "not_agreed"))
            : i.byId === user.id &&
              (i.status === "draft" || i.status === "not_agreed")),
      canProgress: keeper && i.kind === "objective" && i.status === "active",
      canDecide:
        i.status === "draft" &&
        i.byId !== user.id &&
        !i.history.some((h) => h.byId === user.id) &&
        (i.kind === "review" ? role === "ceo" : role === "ceo" || keeper),
      canReview: keeper && i.kind === "document" && i.status === "approved",
      canRetire:
        keeper &&
        ((i.kind === "objective" && i.status === "active") ||
          (i.kind === "document" && i.status === "approved")),
    };
  }

  // ----- Actions -----

  async act(user: User, action: string, b: Record<string, unknown>) {
    await this.mustBeReady();
    switch (action) {
      case "recordFault":
        return this.recordFault(user, b);
      case "closeFault":
        return this.closeFault(user, b);
      case "rootCause":
        return this.rootCause(user, b);
      case "rateSupplier":
        return this.rateSupplier(user, b);
      case "saveItem":
        return this.saveItem(user, b);
      case "progress":
        return this.progress(user, b);
      case "decideItem":
        return this.decideItem(user, text(b.id, 160), b.agree === true, b.note);
      case "reviewItem":
        return this.reviewItem(user, b);
      case "retireItem":
        return this.retireItem(user, b);
      default:
        throw new BadRequest("Unknown quality action.");
    }
  }

  private async recordFault(user: User, b: Record<string, unknown>) {
    const companyId = text(b.companyId, 80);
    const siteId = text(b.siteId, 80) || null;
    const source = oneOf(b.source, NC_SOURCE_LABEL);
    const what = text(b.what, 1000);
    const correction = text(b.correction, 600);
    if (!source) throw new BadRequest("Say where it came from.");
    if (what.length < 10) throw new BadRequest("Say what happened.");
    if (correction.length < 5)
      throw new BadRequest(
        "Say what was done at once to put it right or stop it getting worse.",
      );
    const detectedOn = isDate(b.detectedOn) ? b.detectedOn : this.today();
    if (detectedOn > this.today())
      throw new BadRequest("The date cannot be in the future.");
    if (siteId) {
      const site = await this.store.get("sites", siteId);
      if (!site || site.companyId !== companyId)
        throw new BadRequest("Choose a site of this company.");
    }
    if (!(await this.mayRecord(user, companyId, siteId)))
      throw new AccessDenied(
        "view",
        opsRoleOf(user) === "ops" && !siteId
          ? "(choose a site you cover)"
          : "(service faults of this company)",
      );
    const clientTold = b.clientTold === true;
    const clientNote = text(b.clientNote, 300);
    if (source === "client_complaint" && !clientTold)
      throw new BadRequest(
        "The client raised it, so record how and when they were answered.",
      );
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      const all = await tx.list("qmsNonconformities", { companyId });
      const from = addDays(detectedOn, -RULES.qualityOps.value.repeatDays);
      const repeatOf = siteId
        ? all
            .filter(
              (x) =>
                x.siteId === siteId &&
                x.detectedOn >= from &&
                x.detectedOn <= detectedOn,
            )
            .map((x) => x.id)
        : [];
      const nc: QmsNonconformity = {
        id: `nc-${companyId}-${stamp(w.at)}`,
        ref: `SF-${String(all.length + 1).padStart(4, "0")}`,
        companyId,
        siteId,
        source,
        sourceRef: text(b.sourceRef, 60),
        what,
        detectedOn,
        serious: b.serious === true,
        correction,
        clientTold,
        clientNote,
        repeatOf,
        rootCause: null,
        status: "open",
        close: null,
        by: w.by,
        byId: w.byId,
        at: w.at,
        history: [],
      };
      await tx.insert("qmsNonconformities", nc);
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId,
        action: "quality.fault",
        entity: "qms_nonconformity",
        entityId: nc.id,
        summary: `${nc.ref} recorded (${NC_SOURCE_LABEL[source]}${nc.serious ? ", serious" : ""}${repeatOf.length ? `, repeat at this site` : ""}).`,
      });
      return nc;
    });
  }

  private async closeFault(user: User, b: Record<string, unknown>) {
    const id = text(b.id, 160);
    const outcome = oneOf(b.outcome, NC_OUTCOME_LABEL);
    if (!outcome) throw new BadRequest("Say how it ended.");
    const note = this.reason(b.note, "Say what was done");
    const clientName = text(b.clientName, 120);
    if (outcome === "client_accepted" && clientName.length < 3)
      throw new BadRequest("Name the client person who accepted it.");
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("qmsNonconformities", id);
      const nc = await tx.get("qmsNonconformities", id);
      if (!nc) throw new NotFound("Service fault");
      if (!(await this.mayRecord(user, nc.companyId, nc.siteId)))
        throw new AccessDenied("view", "(service faults of this company)");
      if (nc.status !== "open") throw new BadRequest("This is already closed.");
      await tx.update("qmsNonconformities", id, {
        status: "closed",
        close: { ...w, note, outcome, clientName },
        history: [
          ...nc.history,
          { ...w, note: `Closed: ${NC_OUTCOME_LABEL[outcome]}. ${note}` },
        ],
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: nc.companyId,
        action: "quality.fault.close",
        entity: "qms_nonconformity",
        entityId: id,
        summary: `${nc.ref} closed: ${NC_OUTCOME_LABEL[outcome]} (${note}).`,
      });
      return (await tx.get("qmsNonconformities", id))!;
    });
  }

  /** ACT raises the root cause of a serious or repeated fault as an ACT finding, owned by the company manager. */
  private async rootCause(user: User, b: Record<string, unknown>) {
    if (opsRoleOf(user) !== "act")
      throw new AccessDenied("view", "(ACT looks for the root cause)");
    const id = text(b.id, 160);
    // Hold the fault for the whole request first, so a double click cannot raise two ACT findings.
    await this.store.lock?.("qmsNonconformities", id);
    const nc0 = await this.store.get("qmsNonconformities", id);
    if (!nc0) throw new NotFound("Service fault");
    if (!(await this.companiesFor(user)).includes(nc0.companyId))
      throw new AccessDenied("view", "(service faults of this company)");
    if (nc0.rootCause)
      throw new BadRequest(`Already raised as ${nc0.rootCause.findingRef}.`);
    if (!nc0.serious && !nc0.repeatOf.length)
      throw new BadRequest(
        "Only serious or repeated faults go for a root cause.",
      );
    const owner = await this.store.get("users", text(b.ownerUserId, 80));
    if (
      !owner ||
      owner.role !== "company_manager" ||
      !owner.companyIds.includes(nc0.companyId)
    )
      throw new BadRequest("Choose the company's manager as the owner.");
    const area = RULES.act.value.areas.some((a) => a.id === b.area)
      ? String(b.area)
      : "PATROL";
    const finding = await this.raiseFinding(user, {
      companyId: nc0.companyId,
      area,
      source: "workflow_audit",
      title:
        `Service fault ${nc0.ref}${nc0.repeatOf.length ? " (repeat)" : ""}: ${nc0.what}`.slice(
          0,
          160,
        ),
      detail: `Done at once: ${nc0.correction}`.slice(0, 1000),
      severity: nc0.serious ? "high" : "medium",
      evidence:
        `Service fault ${nc0.ref}, recorded by ${nc0.by} on ${nc0.detectedOn}${nc0.repeatOf.length ? `; ${nc0.repeatOf.length} earlier at the same site` : ""}.`.slice(
          0,
          500,
        ),
      ownerUserId: owner.id,
      origin: "quality",
    });
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("qmsNonconformities", id);
      const nc = (await tx.get("qmsNonconformities", id))!;
      if (nc.rootCause)
        throw new BadRequest(`Already raised as ${nc.rootCause.findingRef}.`);
      await tx.update("qmsNonconformities", id, {
        rootCause: {
          findingId: finding.id,
          findingRef: finding.ref,
          by: w.by,
          at: w.at,
        },
        history: [
          ...nc.history,
          { ...w, note: `Root cause raised as ${finding.ref}` },
        ],
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: nc.companyId,
        action: "quality.fault.root_cause",
        entity: "qms_nonconformity",
        entityId: id,
        summary: `${nc.ref}: root cause raised as ${finding.ref}.`,
      });
      return { nc: (await tx.get("qmsNonconformities", id))!, finding };
    });
  }

  private async rateSupplier(user: User, b: Record<string, unknown>) {
    const id = text(b.id, 160);
    const quality = score(b.quality);
    const onTime = score(b.onTime);
    const paperwork = score(b.paperwork);
    if (!quality || !onTime || !paperwork)
      throw new BadRequest("Give each score from 1 (poor) to 5 (very good).");
    const result = oneOf(b.result, SUPPLIER_RESULT_LABEL);
    if (!result) throw new BadRequest("Choose keep, watch or stop.");
    const issues = text(b.issues, 500);
    if (result !== "keep" && issues.length < 5)
      throw new BadRequest("Say what went wrong.");
    if (Math.min(quality, onTime, paperwork) <= 2 && issues.length < 5)
      throw new BadRequest(
        "A low score needs a short note on what went wrong.",
      );
    const role = opsRoleOf(user);
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("purSuppliers", id);
      const s = (await tx.get("purSuppliers", id)) as
        | (PurSupplier & { performance?: SupplierRating[] })
        | undefined;
      if (!s) throw new NotFound("Supplier");
      if (
        !(
          role === "proc" ||
          (user.role === "company_manager" &&
            user.companyIds.includes(s.companyId))
        )
      )
        throw new AccessDenied(
          "view",
          "(Procurement or the company manager rates suppliers)",
        );
      if (s.blocked)
        throw new BadRequest(
          "This supplier is blocked. Finance unblocks it first.",
        );
      const rating: SupplierRating = {
        on: this.today(),
        quality,
        onTime,
        paperwork,
        issues,
        result,
        ...w,
      };
      const patch: Partial<PurSupplier> & { performance: SupplierRating[] } = {
        performance: [...(s.performance ?? []), rating].slice(-20),
      };
      // "Stop" is the decision itself: the supplier is blocked in the same step; only Finance can unblock.
      if (result === "stop")
        patch.blocked = {
          by: w.by,
          at: w.at,
          note: `Stopped after performance rating: ${issues}`.slice(0, 300),
        };
      await tx.update("purSuppliers", id, patch as Partial<PurSupplier>);
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: s.companyId,
        action: "quality.supplier.rate",
        entity: "pur_supplier",
        entityId: id,
        summary: `${s.name} rated ${quality}/${onTime}/${paperwork}: ${SUPPLIER_RESULT_LABEL[result]}${issues ? ` (${issues})` : ""}.`,
      });
      return (await tx.get("purSuppliers", id))!;
    });
  }

  private async saveItem(user: User, b: Record<string, unknown>) {
    if (!keeps(opsRoleOf(user)))
      throw new AccessDenied(
        "view",
        "(ACT or the Chief of Staff keeps the quality list)",
      );
    const kind = oneOf(b.kind, QMS_ITEM_LABEL);
    if (!kind) throw new BadRequest("Choose what you are recording.");
    const title = text(b.title, 160);
    if (title.length < 3) throw new BadRequest("Give it a title.");
    const body = text(b.body, 4000);
    const months = Math.round(
      Number(b.reviewEveryMonths ?? (kind === "document" ? 24 : 12)),
    );
    if (!Number.isFinite(months) || months < 1 || months > 36)
      throw new BadRequest("Review every 1 to 36 months.");
    let fields: Partial<QmsItem> = { title, body, reviewEveryMonths: months };
    if (kind === "objective") {
      const measure = text(b.measure, 200);
      const target = text(b.target, 120);
      const ownerTitle = text(b.ownerTitle, 120);
      if (!measure || !target || !ownerTitle)
        throw new BadRequest(
          "Give the measure, the target and the owner by job title.",
        );
      if (!isDate(b.dueOn))
        throw new BadRequest("Give the date it should be reached.");
      fields = { ...fields, measure, target, ownerTitle, dueOn: b.dueOn };
    } else if (kind === "document") {
      const code = text(b.code, 40).toUpperCase();
      const ownerTitle = text(b.ownerTitle, 120);
      const link = text(b.link, 500);
      if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(code))
        throw new BadRequest(
          "Give the document code (letters, numbers and dashes).",
        );
      if (!ownerTitle)
        throw new BadRequest("Name the document owner by job title.");
      if (link && !/^https:\/\/[^\s]+$/.test(link))
        throw new BadRequest("The link must start with https://");
      fields = {
        ...fields,
        code,
        ownerTitle,
        link,
        audience: text(b.audience, 200),
      };
    } else {
      if (!isDate(b.heldOn) || b.heldOn > this.today())
        throw new BadRequest(
          "Give the date the review was held, not in the future.",
        );
      const attendees = text(b.attendees, 400);
      if (attendees.length < 3) throw new BadRequest("Say who attended.");
      const decisions = (Array.isArray(b.decisions) ? b.decisions : [])
        .map((d) =>
          d && typeof d === "object" ? (d as Record<string, unknown>) : {},
        )
        .map((d) => ({
          text: text(d.text, 300),
          ownerTitle: text(d.ownerTitle, 120),
          dueOn: isDate(d.dueOn) ? d.dueOn : "",
        }))
        .filter((d) => d.text)
        .slice(0, 30);
      if (decisions.some((d) => !d.ownerTitle || !d.dueOn))
        throw new BadRequest("Each decision needs an owner and a date.");
      fields = {
        ...fields,
        heldOn: b.heldOn,
        attendees,
        decisions: decisions as QmsItem["decisions"],
      };
    }
    const w = this.who(user);
    const id = text(b.id, 160);
    const note = text(b.note, 300) || "Updated";
    const pack =
      kind === "review" ? (await this.reviewPack(user)).items : undefined;
    return this.store.transaction(async (tx) => {
      if (id) {
        await tx.lock?.("qmsItems", id);
        const old = await tx.get("qmsItems", id);
        if (!old || old.kind !== kind) throw new NotFound("Item");
        if (kind === "objective") {
          if (old.status !== "active")
            throw new BadRequest("This objective is closed.");
          await tx.update("qmsItems", id, {
            ...fields,
            history: [...old.history, { ...w, note }],
          });
        } else if (kind === "document" && old.status === "approved") {
          if (fields.code !== old.code)
            throw new BadRequest("The code stays the same across versions.");
          const chain = await tx.list("qmsItems", {
            kind: "document",
            code: old.code,
          });
          if (
            chain.some((x) => x.status === "draft" || x.status === "not_agreed")
          )
            throw new BadRequest(
              "A new version of this document is already waiting.",
            );
          const v = Math.max(...chain.map((x) => x.version)) + 1;
          const draft: QmsItem = {
            ...old,
            ...fields,
            id: `qi-doc-${old.code}-v${v}`,
            version: v,
            status: "draft",
            decision: null,
            lastReviewedOn: this.today(),
            by: w.by,
            byId: w.byId,
            at: w.at,
            history: [{ ...w, note }],
          };
          await tx.insert("qmsItems", draft);
          await tx.audit({
            at: w.at,
            actor: w.by,
            companyId: null,
            action: "quality.item.draft",
            entity: "qms_item",
            entityId: draft.id,
            summary: `Document ${old.code} version ${v} drafted (${note}).`,
          });
          return draft;
        } else {
          if (old.status !== "draft" && old.status !== "not_agreed")
            throw new BadRequest("Only a draft can be changed.");
          if (old.byId !== user.id)
            throw new BadRequest(
              "Another person wrote this draft. Ask them to change it.",
            );
          if (kind === "document" && fields.code !== old.code)
            throw new BadRequest("The code stays the same across versions.");
          await tx.update("qmsItems", id, {
            ...fields,
            ...(pack ? { inputs: pack } : {}),
            status: "draft",
            decision: null,
            history: [...old.history, { ...w, note }],
          });
        }
        await tx.audit({
          at: w.at,
          actor: w.by,
          companyId: null,
          action: "quality.item.edit",
          entity: "qms_item",
          entityId: id,
          summary: `${QMS_ITEM_LABEL[kind]}: ${title} updated (${note}).`,
        });
        return (await tx.get("qmsItems", id))!;
      }
      let itemId = `qi-${kind}-${stamp(w.at)}`;
      if (kind === "document") {
        const chain = await tx.list("qmsItems", {
          kind: "document",
          code: fields.code,
        });
        if (chain.length)
          throw new BadRequest(
            "A document with this code exists. Change it to make a new version.",
          );
        itemId = `qi-doc-${fields.code}-v1`;
      }
      const item: QmsItem = {
        id: itemId,
        kind,
        title,
        body,
        ...fields,
        ...(kind === "objective" ? { progress: [] } : {}),
        ...(pack ? { inputs: pack } : {}),
        status: kind === "objective" ? "active" : "draft",
        version: 1,
        decision: null,
        reviewEveryMonths: months,
        lastReviewedOn: this.today(),
        by: w.by,
        byId: w.byId,
        at: w.at,
        history: [],
      } as QmsItem;
      await tx.insert("qmsItems", item);
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: null,
        action: "quality.item.add",
        entity: "qms_item",
        entityId: item.id,
        summary: `${QMS_ITEM_LABEL[kind]}: ${title}${kind === "objective" ? "" : " drafted"}.`,
      });
      return item;
    });
  }

  private async progress(user: User, b: Record<string, unknown>) {
    if (!keeps(opsRoleOf(user)))
      throw new AccessDenied(
        "view",
        "(ACT or the Chief of Staff records progress)",
      );
    const id = text(b.id, 160);
    const value = text(b.value, 80);
    if (!value) throw new BadRequest("Give the figure now.");
    const note = text(b.note, 300);
    const done = b.done === true;
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("qmsItems", id);
      const it = await tx.get("qmsItems", id);
      if (!it || it.kind !== "objective") throw new NotFound("Objective");
      if (it.status !== "active")
        throw new BadRequest("This objective is closed.");
      if (done && note.length < 3)
        throw new BadRequest("Say why it is reached.");
      await tx.update("qmsItems", id, {
        progress: [
          ...(it.progress ?? []),
          { on: this.today(), value, note, by: w.by, at: w.at },
        ].slice(-60),
        status: done ? "done" : "active",
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: null,
        action: done ? "quality.objective.done" : "quality.objective.progress",
        entity: "qms_item",
        entityId: id,
        summary: `${it.title}: ${value}${done ? " (reached)" : ""}.`,
      });
      return (await tx.get("qmsItems", id))!;
    });
  }

  /** A document version: a second keeper or the CEO approves. A review record: the CEO agrees. Never on one's own draft. */
  private async decideItem(
    user: User,
    id: Id,
    agree: boolean,
    noteIn: unknown,
  ) {
    const role = opsRoleOf(user);
    const note = this.reason(
      noteIn,
      agree ? "Say why it is right" : "Say what to change",
    );
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("qmsItems", id);
      const it = await tx.get("qmsItems", id);
      if (!it || it.kind === "objective") throw new NotFound("Item");
      if (
        it.kind === "review" ? role !== "ceo" : role !== "ceo" && !keeps(role)
      )
        throw new AccessDenied(
          "view",
          it.kind === "review"
            ? "(the CEO agrees the review record)"
            : "(a second person approves a document)",
        );
      if (it.status !== "draft")
        throw new BadRequest("This is not waiting for a decision.");
      if (it.byId === user.id || it.history.some((h) => h.byId === user.id))
        throw new BadRequest(
          "You wrote or changed this version. Another person decides it.",
        );
      if (agree && it.kind === "document")
        for (const old of await tx.list("qmsItems", {
          kind: "document",
          code: it.code,
          status: "approved",
        }))
          await tx.update("qmsItems", old.id, { status: "replaced" });
      await tx.update("qmsItems", id, {
        status: agree ? "approved" : "not_agreed",
        decision: { ...w, note, agree },
        lastReviewedOn: this.today(),
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: null,
        action: agree ? "quality.item.approve" : "quality.item.return",
        entity: "qms_item",
        entityId: id,
        summary: `${QMS_ITEM_LABEL[it.kind]}: ${it.title}${it.kind === "document" ? ` version ${it.version}` : ""} ${agree ? "agreed" : "sent back"} (${note}).`,
      });
      return (await tx.get("qmsItems", id))!;
    });
  }

  private async reviewItem(user: User, b: Record<string, unknown>) {
    if (!keeps(opsRoleOf(user)))
      throw new AccessDenied(
        "view",
        "(ACT or the Chief of Staff reviews documents)",
      );
    const id = text(b.id, 160);
    const note = this.reason(b.note, "Say what you looked at");
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("qmsItems", id);
      const it = await tx.get("qmsItems", id);
      if (!it || it.kind !== "document" || it.status !== "approved")
        throw new NotFound("Document in force");
      await tx.update("qmsItems", id, {
        lastReviewedOn: this.today(),
        history: [
          ...it.history,
          { ...w, note: `Reviewed, no change: ${note}` },
        ],
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: null,
        action: "quality.item.review",
        entity: "qms_item",
        entityId: id,
        summary: `Document ${it.code} reviewed, no change (${note}).`,
      });
      return (await tx.get("qmsItems", id))!;
    });
  }

  private async retireItem(user: User, b: Record<string, unknown>) {
    if (!keeps(opsRoleOf(user)))
      throw new AccessDenied(
        "view",
        "(ACT or the Chief of Staff keeps the quality list)",
      );
    const id = text(b.id, 160);
    const note = this.reason(b.note, "Say why it is withdrawn");
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("qmsItems", id);
      const it = await tx.get("qmsItems", id);
      if (
        !it ||
        !(
          (it.kind === "objective" && it.status === "active") ||
          (it.kind === "document" && it.status === "approved")
        )
      )
        throw new NotFound("Item in force");
      await tx.update("qmsItems", id, {
        status: "retired",
        history: [...it.history, { ...w, note: `Withdrawn: ${note}` }],
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: null,
        action: "quality.item.retire",
        entity: "qms_item",
        entityId: id,
        summary: `${QMS_ITEM_LABEL[it.kind]}: ${it.title} withdrawn (${note}).`,
      });
      return (await tx.get("qmsItems", id))!;
    });
  }

  // ----- Management review inputs -----

  /**
   * The inputs pack for management review (ISO 9001 9.3.2), from Prima's own figures for the companies this person
   * may see. These are counts at the time, not checked conclusions, and never a "compliant" statement.
   */
  async reviewPack(user: User) {
    const role = opsRoleOf(user);
    if (!keeps(role) && role !== "ceo")
      throw new AccessDenied("view", "(management review)");
    const today = this.today();
    const yearAgo = addDays(today, -365);
    const companies = await this.companiesFor(user);
    const [
      faults,
      findings,
      audits,
      suppliers,
      items,
      foundation,
      entries,
      assessments,
    ] = await Promise.all([
      companies.length
        ? this.store.list("qmsNonconformities", { companyId: companies })
        : Promise.resolve([] as QmsNonconformity[]),
      this.store.list("actFindings", {}),
      this.store.list("actAudits", {}),
      companies.length
        ? this.store.list("purSuppliers", { companyId: companies })
        : Promise.resolve([] as PurSupplier[]),
      this.store.list("qmsItems", {}),
      this.store.list("qmsFoundation", {}),
      companies.length
        ? this.store.list("qmsEntries", { companyId: companies })
        : Promise.resolve([]),
      companies.length
        ? this.store.list("compAssessments", { companyId: companies })
        : Promise.resolve([]),
    ]);
    const inScope = (c: Id | null) => c === null || companies.includes(c);
    const myFindings = findings.filter((f) => inScope(f.companyId));
    const yearFaults = faults.filter((f) => f.detectedOn >= yearAgo);
    const lastReview = items
      .filter((i) => i.kind === "review" && i.status === "approved")
      .sort((a, b) => (b.heldOn ?? "").localeCompare(a.heldOn ?? ""))[0];
    const objectives = items.filter(
      (i) => i.kind === "objective" && i.status !== "retired",
    );
    const docs = items.filter(
      (i) => i.kind === "document" && i.status === "approved",
    );
    const rated = suppliers.map((s) =>
      supplierRatingState(
        {
          blocked: s.blocked,
          performance: (s as PurSupplier & { performance?: SupplierRating[] })
            .performance,
        },
        today,
      ),
    );
    const n = (x: number, one: string, many = `${one}s`) =>
      `${x} ${x === 1 ? one : many}`;
    const list = [
      {
        label: "Actions from the last review",
        value: lastReview
          ? `${n(lastReview.decisions?.length ?? 0, "decision")} from ${lastReview.heldOn}; ${(lastReview.decisions ?? []).filter((d) => d.dueOn < today).length} past their date (check each)`
          : "No earlier review recorded",
      },
      {
        label: "Scope, policy, issues and processes",
        value: foundationSummary(foundation, today),
      },
      {
        label: "Client feedback and complaints (12 months)",
        value: `${n(yearFaults.filter((f) => f.source === "client_complaint").length, "client complaint")} recorded as service faults`,
      },
      {
        label: "Quality objectives",
        value: `${objectives.filter((o) => o.status === "done").length} reached, ${objectives.filter((o) => o.status === "active" && o.dueOn && o.dueOn < today).length} past their date, ${objectives.filter((o) => o.status === "active" && (!o.dueOn || o.dueOn >= today)).length} on the way`,
      },
      {
        label: "Service faults (12 months)",
        value: `${yearFaults.length} recorded, ${yearFaults.filter((f) => f.serious).length} serious, ${yearFaults.filter((f) => f.repeatOf.length).length} repeats at the same site, ${faults.filter((f) => f.status === "open").length} still open`,
      },
      {
        label: "Corrective actions (ACT findings)",
        value: `${myFindings.filter((f) => f.status !== "closed").length} open (${myFindings.filter((f) => f.status !== "closed" && f.dueOn < today).length} late), ${myFindings.filter((f) => f.status === "closed" && f.raisedAt.slice(0, 10) >= yearAgo).length} closed in 12 months, ${myFindings.filter((f) => f.checks.some((c) => !c.ok)).length} reopened after a failed check`,
      },
      {
        label: "Audit results (12 months)",
        value: `${audits.filter((a) => a.doneOn != null && a.doneOn >= yearAgo && inScope(a.companyId)).length} workflow audits, ${audits.filter((a) => a.doneOn != null && a.doneOn >= yearAgo && inScope(a.companyId) && a.result === "findings").length} with findings`,
      },
      {
        label: "Supplier performance",
        value: `${rated.filter((r) => r.state !== "not_rated").length} of ${suppliers.length} suppliers rated, ${rated.filter((r) => r.state === "watch").length} on watch, ${rated.filter((r) => r.state === "stop").length} stopped, ${rated.filter((r) => r.state === "due" || r.state === "not_rated").length} due`,
      },
      {
        label: "Competence (people)",
        value: `${assessments.filter((a) => a.assessedOn >= yearAgo).length} assessments in 12 months, ${assessments.filter((a) => a.assessedOn >= yearAgo && a.result === "not_yet").length} not yet able`,
      },
      {
        label: "Requirements register",
        value: `${entries.filter((e) => e.evidence.some((x) => x.check?.ok)).length} requirement entries with checked evidence, ${entries.filter((e) => e.applies && !e.evidence.length).length} with no evidence yet`,
      },
      {
        label: "Controlled documents",
        value: `${docs.length} in force, ${docs.filter((d) => addDays(d.lastReviewedOn, Math.round(d.reviewEveryMonths * MONTH_DAYS)) < today).length} past their review date, ${items.filter((i) => i.kind === "document" && i.status === "draft").length} waiting for approval`,
      },
    ];
    return {
      asOf: today,
      items: list.map((x) => ({
        label: x.label,
        value: x.value.slice(0, 300),
      })),
      note: "Figures from Prima at this date. They are counts, not checked conclusions.",
    };
  }

  // ----- Home -----

  async homeItems(user: User) {
    const items: {
      tone: "crit" | "warn" | "info";
      tag: string;
      title: string;
      detail: string;
      go: { view: "quality" };
    }[] = [];
    const tag = "Quality and compliance";
    const role = opsRoleOf(user);
    try {
      if (
        !role ||
        (this.store.qualityReady && !(await this.store.qualityReady()))
      )
        return [];
      if (role === "act") {
        const companies = await this.companiesFor(user);
        const faults = companies.length
          ? await this.store.list("qmsNonconformities", {
              companyId: companies,
            })
          : [];
        const n = faults.filter(
          (f) => (f.serious || f.repeatOf.length) && !f.rootCause,
        ).length;
        if (n)
          items.push({
            tone: "warn",
            tag,
            title: `${n} service fault${n === 1 ? "" : "s"} need a root cause`,
            detail: "Serious or repeated at the same site",
            go: { view: "quality" },
          });
      }
      if (role === "ceo" || keeps(role)) {
        const d = (
          await this.store.list("qmsItems", { status: "draft" })
        ).filter(
          (x) =>
            x.byId !== user.id &&
            !x.history.some((h) => h.byId === user.id) &&
            (x.kind === "review" ? role === "ceo" : true),
        );
        if (d.length)
          items.push({
            tone: "warn",
            tag,
            title: `${d.length} quality ${d.length === 1 ? "record" : "records"} to decide`,
            detail: d
              .map((x) =>
                x.kind === "document" ? `${x.code} v${x.version}` : x.title,
              )
              .join(", ")
              .slice(0, 160),
            go: { view: "quality" },
          });
      }
      if (role === "proc") {
        const today = this.today();
        const due = (await this.store.list("purSuppliers", {})).filter((s) => {
          const st = supplierRatingState(
            {
              blocked: s.blocked,
              performance: (
                s as PurSupplier & { performance?: SupplierRating[] }
              ).performance,
            },
            today,
          ).state;
          return !s.blocked && (st === "due" || st === "not_rated");
        }).length;
        if (due)
          items.push({
            tone: "info",
            tag: "Suppliers",
            title: `${due} supplier${due === 1 ? "" : "s"} to rate`,
            detail: "Quality, time and paperwork",
            go: { view: "quality" },
          });
      }
    } catch {
      return [];
    }
    return items;
  }
}