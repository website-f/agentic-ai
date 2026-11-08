import { isActHead } from "./access";
import { isGroupLeader } from "./access";
import { visibleCompanyIds } from "./access";
import { GROUP_EMPLOYER_ID } from "./access";
import { AccessDenied } from "./access";
import { RULES } from "./rules";
import type { Store } from "./store";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";
import { BadRequest } from "./service";
import { NotFound } from "./service";


// ---------- Records ----------

export type RptParty =
  | "director"
  | "shareholder"
  | "family"
  | "group_company"
  | "director_company"
  | "key_staff"
  | "other";
export type RptNature =
  | "rent"
  | "loan"
  | "services"
  | "purchase"
  | "sale"
  | "management_fee"
  | "equipment_rental"
  | "guarantee"
  | "other";
export type RptStatus =
  | "awaiting_review"
  | "questioned"
  | "board_needed"
  | "done"
  | "not_agreed";

export interface RegNote {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

/** A deal between the company and someone close to it. */
export interface RelatedPartyDeal {
  id: Id;
  companyId: Id;
  counterparty: string;
  party: RptParty;
  /** How the counterparty is related, in plain words ("owned by director Ahmad's wife"). */
  relationship: string;
  nature: RptNature;
  description: string;
  /** Total value over the term, in ringgit. */
  amount: number;
  startOn: IsoDate;
  endOn: IsoDate | null;
  /** Why the price is fair: quotes, market rent, the group rate card. */
  fairPriceBasis: string;
  /** Directors who have an interest and must stay out of the decision. */
  interestedDirectors: string[];
  recordedBy: string;
  recordedById: Id;
  at: IsoDateTime;
  status: RptStatus;
  review: (RegNote & { agree: boolean }) | null;
  answers: RegNote[];
  board: {
    resolutionRef: string;
    on: IsoDate;
    interestedStayedOut: true;
    by: string;
    byId: Id;
    at: IsoDateTime;
  } | null;
}

export type InterestKind =
  | "directorship"
  | "shareholding"
  | "family"
  | "business"
  | "other";

/** One director's yearly declaration of interests for one company, collected by the Deputy Chief of Staff. */
export interface DirectorInterest {
  id: Id;
  companyId: Id;
  directorName: string;
  /** Kept for older records; the Deputy Chief of Staff records every declaration from the signed form. */
  directorUserId: Id | null;
  nothingToDeclare: boolean;
  interests: { kind: InterestKind; detail: string }[];
  declaredOn: IsoDate;
  /** The signed declaration form or board minute that records it. */
  formRef: string;
  recordedBy: string;
  recordedById: Id;
  at: IsoDateTime;
  seen: RegNote | null;
  /** Replaced by a newer declaration of the same director in the same company. */
  replacedById: Id | null;
}

export type CommitteeKind =
  | "audit_risk"
  | "remuneration"
  | "nomination"
  | "tender"
  | "other";

export interface BoardCommittee {
  id: Id;
  companyId: Id;
  name: string;
  kind: CommitteeKind;
  members: { name: string; chair: boolean; independent: boolean }[];
  meetEveryMonths: number;
  /** The board resolution or terms of reference that set it up. */
  termsRef: string;
  meetings: {
    on: IsoDate;
    present: number;
    minutesRef: string;
    actionsOpen: number;
    by: string;
    byId: Id;
    at: IsoDateTime;
  }[];
  recordedBy: string;
  recordedById: Id;
  at: IsoDateTime;
}

export type RiskCategory =
  | "strategic"
  | "operational"
  | "financial"
  | "licence"
  | "people"
  | "technology"
  | "legal"
  | "reputation";

export interface RiskEntry {
  id: Id;
  companyId: Id;
  title: string;
  category: RiskCategory;
  ownerName: string;
  likelihood: number;
  impact: number;
  controls: string;
  action: string;
  actionDueOn: IsoDate | null;
  lastReviewedOn: IsoDate;
  reviews: {
    on: IsoDate;
    likelihood: number;
    impact: number;
    note: string;
    by: string;
    byId: Id;
    at: IsoDateTime;
  }[];
  /** The ACT team member the ACT Director gave this risk to, and what to do. */
  assignedToId: Id | null;
  assignedTo: string | null;
  instructions: (RegNote & { toId: Id; to: string })[];
  status: "open" | "closed";
  closed: RegNote | null;
  recordedBy: string;
  recordedById: Id;
  at: IsoDateTime;
}

/** CEO settings for the registers (one row, PWVSB). */
export interface RegSettings {
  id: "registers";
  companyId: Id;
  /** Related-party deals at or above this total value also need a board resolution. Null: not set, no board step. */
  boardApprovalAbove: number | null;
  history: (RegNote & { boardApprovalAbove: number | null })[];
}

// ---------- Labels (English; the screen translates) ----------

export const RPT_PARTY_LABEL: Record<RptParty, string> = {
  director: "A director",
  shareholder: "A shareholder",
  family: "A director's or shareholder's family",
  group_company: "Another PWVSB group company",
  director_company: "A company a director owns or runs",
  key_staff: "A senior manager",
  other: "Other related party",
};
export const RPT_NATURE_LABEL: Record<RptNature, string> = {
  rent: "Rent of premises",
  loan: "Loan",
  services: "Services",
  purchase: "Purchase",
  sale: "Sale",
  management_fee: "Management fee",
  equipment_rental: "Equipment rental",
  guarantee: "Guarantee",
  other: "Other",
};
export const INTEREST_KIND_LABEL: Record<InterestKind, string> = {
  directorship: "Director of another company",
  shareholding: "Shares in another company",
  family: "Family member working with or dealing with the company",
  business: "Business dealing with the company",
  other: "Other interest",
};
export const COMMITTEE_KIND_LABEL: Record<CommitteeKind, string> = {
  audit_risk: "Audit and risk",
  remuneration: "Pay and rewards",
  nomination: "Nomination",
  tender: "Tender",
  other: "Other",
};
export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  strategic: "Strategy",
  operational: "Operations",
  financial: "Finance",
  licence: "Licence and regulator",
  people: "People",
  technology: "IT and data",
  legal: "Legal",
  reputation: "Reputation",
};

// ---------- Pure helpers ----------

export type RegRole = "company" | "control" | "view";

const isCeo = (u: User) =>
  (u.role === "director" || u.role === "pwvsb_officer") && u.opsTier === "ceo";

/** Committees: the company keeps its own, PWVSB control (CoS, DCoS) keeps PWVSB's, group leaders and legal watch. */
export function regRoleOf(user: User, companyId: Id): RegRole | null {
  if (
    user.integration ||
    user.role === "guard" ||
    user.role === "site_device" ||
    user.role === "supervisor"
  )
    return null;
  if (
    (user.role === "company_manager" || user.role === "admin_exec") &&
    user.companyIds.includes(companyId)
  )
    return "company";
  if (user.role === "company_manager" || user.role === "admin_exec")
    return null;
  if (user.leadership === "cos" || user.leadership === "deputy_cos")
    return "control";
  if (user.role === "pwvsb_officer" && user.department === "legal")
    return "view";
  if (isGroupLeader(user)) return "view";
  return null;
}

export type DeskRole = "record" | "review" | "view";
/** Related-party deals and directors' interests (Fauzan, 5 Nov 2026): DCoS records, CoS reviews, CEO sees. Nobody else. */
export function deskRoleOf(user: User): DeskRole | null {
  if (
    user.integration ||
    (user.role !== "pwvsb_officer" && user.role !== "director")
  )
    return null;
  if (user.leadership === "deputy_cos") return "record";
  if (user.leadership === "cos") return "review";
  if (isCeo(user)) return "view";
  return null;
}

export type RiskRole = "director" | "team" | "view";
/** Risk register (Fauzan, 5 Nov 2026): ACT only. The ACT Director runs it and directs the team; the CEO sees it. */
export function riskRoleOf(user: User): RiskRole | null {
  if (user.integration) return null;
  if (isActHead(user)) return "director";
  if (user.role === "pwvsb_officer" && user.department === "audit")
    return "team";
  if (isCeo(user)) return "view";
  return null;
}

/** May this person add committees or meetings for this company? Companies keep their own; control keeps PWVSB's. */
function keeps(role: RegRole | null, companyId: Id) {
  return (
    role === "company" ||
    (role === "control" && companyId === GROUP_EMPLOYER_ID)
  );
}

export function riskScore(r: Pick<RiskEntry, "likelihood" | "impact">) {
  return r.likelihood * r.impact;
}
export function riskLevel(score: number): "high" | "medium" | "low" {
  const rule = RULES.registers.value;
  return score >= rule.highRiskScore
    ? "high"
    : score >= rule.mediumRiskScore
      ? "medium"
      : "low";
}
export function riskReviewDue(r: RiskEntry): IsoDate {
  const rule = RULES.registers.value;
  const months =
    riskLevel(riskScore(r)) === "high"
      ? rule.highRiskReviewMonths
      : rule.otherRiskReviewMonths;
  return addDays(r.lastReviewedOn, Math.round(months * 30.44));
}
export function interestDue(d: DirectorInterest): IsoDate {
  return addDays(
    d.declaredOn,
    Math.round(RULES.registers.value.interestEveryMonths * 30.44),
  );
}
export function committeeState(c: BoardCommittee, today: IsoDate) {
  const last =
    [...c.meetings].sort((a, b) => b.on.localeCompare(a.on))[0] ?? null;
  const nextDue = last
    ? addDays(last.on, Math.round(c.meetEveryMonths * 30.44))
    : null;
  const state: "unknown" | "overdue" | "due_soon" | "ok" = !last
    ? "unknown"
    : nextDue! < today
      ? "overdue"
      : daysBetween(today, nextDue!) <=
          Math.min(
            RULES.registers.value.dueSoonDays,
            Math.round((c.meetEveryMonths * 30.44) / 4),
          )
        ? "due_soon"
        : "ok";
  const independent = c.members.filter((m) => m.independent).length;
  return {
    last,
    nextDue,
    state,
    hasChair: c.members.some((m) => m.chair),
    // Listing practice only: an audit committee with a majority of independent members. Shown as a note, not a block.
    independentNote:
      c.kind === "audit_risk" && independent * 2 <= c.members.length,
  };
}
/** Does a deal's counterparty match something a director declared? Plain word match, shown to help, never decisive. */
export function declaredLinks(
  deal: Pick<RelatedPartyDeal, "companyId" | "counterparty">,
  declarations: DirectorInterest[],
) {
  const words = deal.counterparty
    .toLowerCase()
    .replace(/sdn\.?\s*bhd\.?|berhad|bhd\.?|\(mock\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  if (!words.length) return [];
  return declarations
    .filter(
      (d) =>
        d.companyId === deal.companyId &&
        !d.replacedById &&
        d.interests.some((i) =>
          words.some((w) => i.detail.toLowerCase().includes(w)),
        ),
    )
    .map((d) => d.directorName);
}

const MONEY_MAX = 1_000_000_000;
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
const score = (v: unknown) => {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 5 ? n : null;
};

// ---------- Service ----------

export class BoardRegisterService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
  ) {}

  private now() {
    return this.clock();
  }
  private today(): IsoDate {
    return this.clock().slice(0, 10);
  }

  /** Companies this PWVSB person may see today (their grants) plus PWVSB itself. */
  private async groupCompanies(user: User): Promise<Id[]> {
    if (user.role !== "director" && user.role !== "pwvsb_officer") return [];
    return [
      ...new Set([
        ...visibleCompanyIds(
          user,
          await this.store.list("grants", {}),
          this.today(),
        ),
        GROUP_EMPLOYER_ID,
      ]),
    ];
  }

  /** Companies whose committees this person sees. */
  private async committeeCompanies(user: User): Promise<Id[]> {
    if (user.role === "company_manager" || user.role === "admin_exec")
      return user.companyIds.filter((id) => regRoleOf(user, id));
    return (await this.groupCompanies(user)).filter((id) =>
      regRoleOf(user, id),
    );
  }

  async settings(): Promise<RegSettings> {
    return (
      (await this.store.get("regSettings", "registers")) ?? {
        id: "registers",
        companyId: GROUP_EMPLOYER_ID,
        boardApprovalAbove: null,
        history: [],
      }
    );
  }

  /** The registers this person may see, worst first. A register they may not see comes back as null. */
  async board(user: User) {
    const desk = deskRoleOf(user);
    const riskRole = riskRoleOf(user);
    const comIds = await this.committeeCompanies(user);
    if (!desk && !riskRole && !comIds.length)
      throw new AccessDenied("view", "(governance registers)");
    await this.mustBeReady();
    const today = this.today();
    const rule = RULES.registers.value;
    const groupIds = desk || riskRole ? await this.groupCompanies(user) : [];
    const allIds = [...new Set([...groupIds, ...comIds])];
    const [settings, deals, declarations, committees, risks, companies, users] =
      await Promise.all([
        this.settings(),
        desk
          ? this.store.list("regRelatedParties", { companyId: groupIds })
          : Promise.resolve([] as RelatedPartyDeal[]),
        desk
          ? this.store.list("regInterests", { companyId: groupIds })
          : Promise.resolve([] as DirectorInterest[]),
        comIds.length
          ? this.store.list("regCommittees", { companyId: comIds })
          : Promise.resolve([] as BoardCommittee[]),
        riskRole
          ? this.store.list("regRisks", { companyId: groupIds })
          : Promise.resolve([] as RiskEntry[]),
        allIds.length
          ? this.store.list("companies", { id: allIds })
          : Promise.resolve([]),
        riskRole === "director"
          ? this.store.list("users", {})
          : Promise.resolve([] as User[]),
      ]);
    const name = (id: Id) =>
      id === GROUP_EMPLOYER_ID
        ? "PWVSB (group)"
        : (companies.find((c) => c.id === id)?.name ?? id);
    const limit = settings.boardApprovalAbove;
    const companyList = (ids: Id[]) =>
      ids
        .map((id) => ({ id, name: name(id) }))
        .sort(
          (x, y) =>
            Number(y.id === GROUP_EMPLOYER_ID) -
              Number(x.id === GROUP_EMPLOYER_ID) ||
            x.name.localeCompare(y.name),
        );

    let dealSection = null;
    let interestSection = null;
    if (desk) {
      const dealRank: Record<RptStatus, number> = {
        questioned: 0,
        awaiting_review: 1,
        board_needed: 2,
        not_agreed: 3,
        done: 4,
      };
      const rows = deals
        .map((d) => ({
          deal: d,
          companyName: name(d.companyId),
          needsBoard: limit !== null && d.amount >= limit,
          linkedDeclarations: declaredLinks(d, declarations),
          age: daysBetween(d.at.slice(0, 10), today),
          canReview:
            d.status === "awaiting_review" &&
            desk === "review" &&
            this.mayReview(user, d),
          canAnswer: d.status === "questioned" && desk === "record",
          canRecordBoard: d.status === "board_needed" && desk === "record",
        }))
        .sort(
          (a, b) =>
            Number(b.canReview || b.canAnswer || b.canRecordBoard) -
              Number(a.canReview || a.canAnswer || a.canRecordBoard) ||
            dealRank[a.deal.status] - dealRank[b.deal.status] ||
            b.deal.amount - a.deal.amount,
        );
      dealSection = {
        role: desk,
        canRecord: desk === "record",
        companies: desk === "record" ? companyList(groupIds) : [],
        canSetLimit: isCeo(user),
        boardApprovalAbove: limit,
        limitHistory: settings.history.slice(-5).reverse(),
        rows,
        toReview: rows.filter((d) => d.canReview).length,
        open: rows.filter((d) =>
          ["awaiting_review", "questioned", "board_needed"].includes(
            d.deal.status,
          ),
        ).length,
        valueThisYear: deals
          .filter(
            (d) =>
              d.status !== "not_agreed" &&
              d.startOn.slice(0, 4) === today.slice(0, 4),
          )
          .reduce((s, d) => s + d.amount, 0),
      };
      const year = today.slice(0, 4);
      const current = declarations.filter((d) => !d.replacedById);
      const iRows = current
        .map((d) => {
          const dueOn = interestDue(d);
          const state: "overdue" | "due_soon" | "ok" =
            dueOn < today
              ? "overdue"
              : daysBetween(today, dueOn) <= rule.dueSoonDays
                ? "due_soon"
                : "ok";
          return {
            declaration: d,
            companyName: name(d.companyId),
            dueOn,
            state,
            doneThisYear: d.declaredOn.slice(0, 4) === year,
            canSee: !d.seen && desk === "review" && d.recordedById !== user.id,
            canRenew: desk === "record",
            history: declarations.filter(
              (x) =>
                x.companyId === d.companyId &&
                x.directorName === d.directorName &&
                x.id !== d.id,
            ).length,
          };
        })
        .sort(
          (a, b) =>
            ({ overdue: 0, due_soon: 1, ok: 2 })[a.state] -
              { overdue: 0, due_soon: 1, ok: 2 }[b.state] ||
            a.companyName.localeCompare(b.companyName),
        );
      // A company with no declaration on file is Unknown, never clear.
      const none = groupIds
        .filter((id) => !current.some((d) => d.companyId === id))
        .map((id) => ({ companyId: id, companyName: name(id) }));
      interestSection = {
        role: desk,
        canRecord: desk === "record",
        companies: desk === "record" ? companyList(groupIds) : [],
        rows: iRows,
        noDeclarations: none,
        toRead: iRows.filter((r) => r.canSee).length,
        due: iRows.filter((r) => r.state === "overdue").length + none.length,
        doneThisYear: iRows.filter((r) => r.doneThisYear).length,
      };
    }

    const cRows = committees
      .map((c) => ({
        committee: c,
        companyName: name(c.companyId),
        canRecord: keeps(regRoleOf(user, c.companyId), c.companyId),
        ...committeeState(c, today),
      }))
      .sort(
        (a, b) =>
          ({ overdue: 0, unknown: 1, due_soon: 2, ok: 3 })[a.state] -
          { overdue: 0, unknown: 1, due_soon: 2, ok: 3 }[b.state],
      );
    const committeeSection = comIds.length
      ? {
          companies: companyList(
            comIds.filter((id) => keeps(regRoleOf(user, id), id)),
          ),
          rows: cRows,
          overdue: cRows.filter(
            (c) => c.state === "overdue" || c.state === "unknown",
          ).length,
        }
      : null;

    let riskSection = null;
    if (riskRole) {
      const rows = risks
        .map((r) => {
          const s = riskScore(r);
          const reviewDue = riskReviewDue(r);
          const mine = r.assignedToId === user.id;
          return {
            risk: r,
            companyName: name(r.companyId),
            score: s,
            level: riskLevel(s),
            reviewDue,
            reviewLate: r.status === "open" && reviewDue < today,
            actionLate:
              r.status === "open" && !!r.actionDueOn && r.actionDueOn < today,
            mine,
            canUpdate:
              r.status === "open" &&
              (riskRole === "director" || (riskRole === "team" && mine)),
            canAssign: r.status === "open" && riskRole === "director",
            canClose: r.status === "open" && riskRole === "director",
          };
        })
        .sort(
          (a, b) =>
            Number(a.risk.status === "closed") -
              Number(b.risk.status === "closed") ||
            Number(b.mine) - Number(a.mine) ||
            Number(b.reviewLate) - Number(a.reviewLate) ||
            b.score - a.score,
        );
      const open = rows.filter((r) => r.risk.status === "open");
      const heat: number[][] = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
      for (const r of open) heat[r.risk.likelihood - 1][r.risk.impact - 1]++;
      riskSection = {
        role: riskRole,
        canAdd: riskRole === "director",
        companies: riskRole === "director" ? companyList(groupIds) : [],
        team: users
          .filter((u) => riskRoleOf(u) === "team" && !u.accessClosedFrom)
          .map((u) => ({ id: u.id, name: u.name, title: u.title })),
        rows,
        heat,
        high: open.filter((r) => r.level === "high").length,
        reviewLate: open.filter((r) => r.reviewLate).length,
        mine: open.filter((r) => r.mine).length,
      };
    }

    return {
      rule: { ...rule, boardApprovalAbove: limit },
      deals: dealSection,
      interests: interestSection,
      committees: committeeSection,
      risks: riskSection,
    };
  }

  /** Nobody reviews a deal they recorded or have an interest in. */
  private mayReview(user: User, d: RelatedPartyDeal) {
    if (d.recordedById === user.id) return false;
    const me = user.name.toLowerCase();
    return (
      !d.interestedDirectors.some((n) => n.toLowerCase() === me) &&
      !d.counterparty.toLowerCase().includes(me)
    );
  }

  private async mustBeReady() {
    if (this.store.registersReady && !(await this.store.registersReady()))
      throw new BadRequest(
        "Governance registers are not switched on yet. The database part waits for the CEO to approve it.",
      );
  }

  private who(user: User) {
    return { by: user.name, byId: user.id, at: this.now() };
  }

  private async mustDesk(user: User, need: DeskRole, companyId?: Id) {
    if (deskRoleOf(user) !== need)
      throw new AccessDenied(
        "view",
        need === "record"
          ? "(the Deputy Chief of Staff records this)"
          : "(the Chief of Staff reviews this)",
      );
    if (
      companyId !== undefined &&
      !(await this.groupCompanies(user)).includes(companyId)
    )
      throw new AccessDenied("view", companyId);
  }

  private async mustKeepCommittee(user: User, companyId: Id) {
    const allowed = await this.committeeCompanies(user);
    if (
      !allowed.includes(companyId) ||
      !keeps(regRoleOf(user, companyId), companyId)
    )
      throw new AccessDenied(
        "view",
        companyId === GROUP_EMPLOYER_ID
          ? "(PWVSB control keeps the group committees)"
          : "(the company keeps its own committees)",
      );
  }

  private mustRisk(user: User, need: "director" | "update", r?: RiskEntry) {
    const role = riskRoleOf(user);
    if (
      need === "director"
        ? role !== "director"
        : !(
            role === "director" ||
            (role === "team" && r?.assignedToId === user.id)
          )
    )
      throw new AccessDenied(
        "view",
        need === "director"
          ? "(the ACT Director decides this)"
          : "(the ACT Director gives this risk to a team member)",
      );
  }

  private reason(v: unknown, what = "Say why") {
    const n = text(v, 400);
    if (n.length < 3) throw new BadRequest(`${what}: give a short reason.`);
    return n;
  }

  /** One entry point for the screen and the API: every action checks the person again here. */
  async act(user: User, action: string, b: Record<string, unknown>) {
    await this.mustBeReady();
    switch (action) {
      case "addDeal":
        return this.addDeal(user, b);
      case "reviewDeal":
        return this.reviewDeal(user, text(b.id, 160), b.agree === true, b.note);
      case "answerDeal":
        return this.answerDeal(user, text(b.id, 160), b);
      case "boardDeal":
        return this.boardDeal(user, text(b.id, 160), b);
      case "setBoardLimit":
        return this.setBoardLimit(user, b);
      case "declare":
        return this.declare(user, b);
      case "seeDeclaration":
        return this.seeDeclaration(user, text(b.id, 160), b.note);
      case "addCommittee":
        return this.addCommittee(user, b);
      case "addMeeting":
        return this.addMeeting(user, text(b.id, 160), b);
      case "addRisk":
        return this.addRisk(user, b);
      case "reviewRisk":
        return this.reviewRisk(user, text(b.id, 160), b);
      case "assignRisk":
        return this.assignRisk(user, text(b.id, 160), b);
      case "closeRisk":
        return this.closeRisk(user, text(b.id, 160), b.note);
      default:
        throw new BadRequest("Unknown register action.");
    }
  }

  // ----- Related-party deals -----

  async addDeal(user: User, b: Record<string, unknown>) {
    const companyId = text(b.companyId, 80);
    await this.mustDesk(user, "record", companyId);
    const party = oneOf(b.party, RPT_PARTY_LABEL);
    const nature = oneOf(b.nature, RPT_NATURE_LABEL);
    const counterparty = text(b.counterparty, 120);
    const relationship = text(b.relationship, 200);
    const fairPriceBasis = text(b.fairPriceBasis, 400);
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!counterparty) throw new BadRequest("Name the other party.");
    if (!party || !nature)
      throw new BadRequest(
        "Choose who the other party is and what the deal is.",
      );
    if (!relationship)
      throw new BadRequest("Say how the other party is related.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > MONEY_MAX)
      throw new BadRequest("Give the total value in ringgit.");
    if (!isDate(b.startOn)) throw new BadRequest("Give the start date.");
    const endOn = isDate(b.endOn) ? b.endOn : null;
    if (endOn && endOn < b.startOn)
      throw new BadRequest("The end date is before the start date.");
    if (fairPriceBasis.length < 10)
      throw new BadRequest(
        "Say why the price is fair: quotes, market rent or the group rate.",
      );
    const interestedDirectors = (
      Array.isArray(b.interestedDirectors) ? b.interestedDirectors : []
    )
      .map((n) => text(n, 80))
      .filter(Boolean)
      .slice(0, 10);
    const w = this.who(user);
    const deal: RelatedPartyDeal = {
      id: `rpt-${companyId}-${Date.parse(w.at).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      companyId,
      counterparty,
      party,
      relationship,
      nature,
      description: text(b.description, 400),
      amount,
      startOn: b.startOn,
      endOn,
      fairPriceBasis,
      interestedDirectors,
      recordedBy: w.by,
      recordedById: w.byId,
      at: w.at,
      status: "awaiting_review",
      review: null,
      answers: [],
      board: null,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert("regRelatedParties", deal);
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId,
        action: "register.deal.add",
        entity: "related_party_deal",
        entityId: deal.id,
        summary: `${RPT_NATURE_LABEL[nature]} with ${counterparty} (${RPT_PARTY_LABEL[party].toLowerCase()}), RM${amount.toLocaleString("en-MY")}.`,
      });
      return deal;
    });
  }

  async reviewDeal(user: User, id: Id, agree: boolean, note: unknown) {
    await this.mustDesk(user, "review");
    const reason = this.reason(
      note,
      agree ? "Say why the deal is fair" : "Say what is wrong",
    );
    const limit = (await this.settings()).boardApprovalAbove;
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regRelatedParties", id);
      const d = await tx.get("regRelatedParties", id);
      if (!d || !(await this.groupCompanies(user)).includes(d.companyId))
        throw new NotFound("Deal");
      if (!this.mayReview(user, d))
        throw new BadRequest(
          "You recorded this deal or have an interest in it. Another reviewer decides.",
        );
      if (d.status !== "awaiting_review")
        throw new BadRequest("This deal is not waiting for review.");
      const w = this.who(user);
      const status: RptStatus = !agree
        ? "questioned"
        : limit !== null && d.amount >= limit
          ? "board_needed"
          : "done";
      await tx.update("regRelatedParties", id, {
        status,
        review: { ...w, note: reason, agree },
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: d.companyId,
        action: agree ? "register.deal.agree" : "register.deal.question",
        entity: "related_party_deal",
        entityId: id,
        summary: `${d.counterparty}: ${agree ? "agreed" : "questioned"} (${reason})${status === "board_needed" ? "; board resolution needed" : ""}.`,
      });
      return (await tx.get("regRelatedParties", id))!;
    });
  }

  /** The Deputy Chief of Staff answers a question: explains, or drops the deal. */
  async answerDeal(user: User, id: Id, b: Record<string, unknown>) {
    await this.mustDesk(user, "record");
    const drop = b.drop === true;
    const note = this.reason(
      b.note,
      drop ? "Say why the deal is dropped" : "Answer the question",
    );
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regRelatedParties", id);
      const d = await tx.get("regRelatedParties", id);
      if (!d || !(await this.groupCompanies(user)).includes(d.companyId))
        throw new NotFound("Deal");
      if (d.status !== "questioned")
        throw new BadRequest("There is no open question on this deal.");
      const basis = text(b.fairPriceBasis, 400);
      const w = this.who(user);
      await tx.update("regRelatedParties", id, {
        status: drop ? "not_agreed" : "awaiting_review",
        fairPriceBasis: basis.length >= 10 ? basis : d.fairPriceBasis,
        answers: [...d.answers, { ...w, note }],
        review: drop ? d.review : null,
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: d.companyId,
        action: drop ? "register.deal.drop" : "register.deal.answer",
        entity: "related_party_deal",
        entityId: id,
        summary: `${d.counterparty}: ${drop ? "dropped" : "answered and sent back for review"} (${note}).`,
      });
      return (await tx.get("regRelatedParties", id))!;
    });
  }

  /** Above the CEO's limit: the Deputy Chief of Staff records the board resolution, interested directors out of the vote. */
  async boardDeal(user: User, id: Id, b: Record<string, unknown>) {
    await this.mustDesk(user, "record");
    const ref = text(b.resolutionRef, 80);
    if (!ref) throw new BadRequest("Give the board resolution reference.");
    if (!isDate(b.on) || b.on > this.today())
      throw new BadRequest(
        "Give the date of the board resolution, not in the future.",
      );
    if (b.interestedStayedOut !== true)
      throw new BadRequest(
        "Confirm the interested directors stayed out of the decision. If they did not, the board must decide again.",
      );
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regRelatedParties", id);
      const d = await tx.get("regRelatedParties", id);
      if (!d || !(await this.groupCompanies(user)).includes(d.companyId))
        throw new NotFound("Deal");
      if (d.status !== "board_needed")
        throw new BadRequest("This deal is not waiting for the board.");
      const w = this.who(user);
      await tx.update("regRelatedParties", id, {
        status: "done",
        board: {
          resolutionRef: ref,
          on: b.on as IsoDate,
          interestedStayedOut: true,
          ...w,
        },
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: d.companyId,
        action: "register.deal.board",
        entity: "related_party_deal",
        entityId: id,
        summary: `${d.counterparty}: board resolution ${ref} on ${b.on}, interested directors stayed out.`,
      });
      return (await tx.get("regRelatedParties", id))!;
    });
  }

  /** The CEO sets (or clears) the deal value that also needs a board resolution. Applies to deals reviewed from now on. */
  async setBoardLimit(user: User, b: Record<string, unknown>) {
    if (!isCeo(user) || user.integration)
      throw new AccessDenied("view", "(only the CEO sets this limit)");
    const raw = b.boardApprovalAbove;
    const value =
      raw === null || raw === "" || raw === undefined
        ? null
        : Math.round(Number(raw));
    if (
      value !== null &&
      !(Number.isFinite(value) && value > 0 && value <= MONEY_MAX)
    )
      throw new BadRequest(
        "Give the limit in ringgit, or leave it empty for no board step.",
      );
    const note = this.reason(b.note, "Say why");
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regSettings", "registers");
      const cur = await tx.get("regSettings", "registers");
      const entry = { ...w, note, boardApprovalAbove: value };
      if (cur)
        await tx.update("regSettings", "registers", {
          boardApprovalAbove: value,
          history: [...cur.history, entry],
        });
      else
        await tx.insert("regSettings", {
          id: "registers",
          companyId: GROUP_EMPLOYER_ID,
          boardApprovalAbove: value,
          history: [entry],
        });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: GROUP_EMPLOYER_ID,
        action: "register.settings.board_limit",
        entity: "register_settings",
        entityId: "registers",
        summary:
          value === null
            ? `Board step for related-party deals switched off (${note}).`
            : `Related-party deals from RM${value.toLocaleString("en-MY")} need a board resolution (${note}).`,
      });
      return (await tx.get("regSettings", "registers"))!;
    });
  }

  // ----- Directors' interests -----

  /** The Deputy Chief of Staff records a director's signed yearly declaration (collected by hand) and marks it done. */
  async declare(user: User, b: Record<string, unknown>) {
    const companyId = text(b.companyId, 80);
    await this.mustDesk(user, "record", companyId);
    const directorName = text(b.directorName, 100);
    if (!directorName) throw new BadRequest("Give the director's name.");
    if (!isDate(b.declaredOn) || b.declaredOn > this.today())
      throw new BadRequest("Give the date it was declared, not in the future.");
    const formRef = text(b.formRef, 100);
    if (!formRef) throw new BadRequest("Give the signed form reference.");
    const nothingToDeclare = b.nothingToDeclare === true;
    const interests = (Array.isArray(b.interests) ? b.interests : [])
      .map((i) => {
        const r = (i ?? {}) as Record<string, unknown>;
        const kind = oneOf(r.kind, INTEREST_KIND_LABEL);
        const detail = text(r.detail, 200);
        return kind && detail ? { kind, detail } : null;
      })
      .filter((i): i is { kind: InterestKind; detail: string } => !!i)
      .slice(0, 20);
    if (nothingToDeclare && interests.length)
      throw new BadRequest(
        "Either list the interests or tick nothing to declare, not both.",
      );
    if (!nothingToDeclare && !interests.length)
      throw new BadRequest(
        "List at least one interest, or tick nothing to declare.",
      );
    const w = this.who(user);
    const d: DirectorInterest = {
      id: `dir-${companyId}-${Date.parse(w.at).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      companyId,
      directorName,
      directorUserId: null,
      nothingToDeclare,
      interests,
      declaredOn: b.declaredOn,
      formRef,
      recordedBy: w.by,
      recordedById: w.byId,
      at: w.at,
      seen: null,
      replacedById: null,
    };
    return this.store.transaction(async (tx) => {
      const older = (await tx.list("regInterests", { companyId })).filter(
        (x) =>
          !x.replacedById &&
          x.directorName.toLowerCase() === directorName.toLowerCase(),
      );
      await tx.insert("regInterests", d);
      for (const o of older)
        await tx.update("regInterests", o.id, { replacedById: d.id });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId,
        action: "register.interest.declare",
        entity: "director_interest",
        entityId: d.id,
        summary: `${directorName}: ${nothingToDeclare ? "nothing to declare" : `${interests.length} interest(s)`} on ${d.declaredOn} (${formRef}).`,
      });
      return d;
    });
  }

  /** The Chief of Staff reads a declaration, with a comment. */
  async seeDeclaration(user: User, id: Id, note: unknown) {
    await this.mustDesk(user, "review");
    const reason = this.reason(note, "Add a comment");
    return this.store.transaction(async (tx) => {
      const d = await tx.get("regInterests", id);
      if (!d || !(await this.groupCompanies(user)).includes(d.companyId))
        throw new NotFound("Declaration");
      if (d.recordedById === user.id)
        throw new BadRequest("Someone else reads a declaration you recorded.");
      if (d.seen) throw new BadRequest("Already read.");
      const w = this.who(user);
      await tx.update("regInterests", id, { seen: { ...w, note: reason } });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: d.companyId,
        action: "register.interest.seen",
        entity: "director_interest",
        entityId: id,
        summary: `${d.directorName}: declaration read (${reason}).`,
      });
      return (await tx.get("regInterests", id))!;
    });
  }

  // ----- Committees -----

  async addCommittee(user: User, b: Record<string, unknown>) {
    const companyId = text(b.companyId, 80);
    await this.mustKeepCommittee(user, companyId);
    const kind = oneOf(b.kind, COMMITTEE_KIND_LABEL);
    const name = text(b.name, 100);
    if (!name || !kind)
      throw new BadRequest("Give the committee name and kind.");
    const members = (Array.isArray(b.members) ? b.members : [])
      .map((m) => {
        const r = (m ?? {}) as Record<string, unknown>;
        const n = text(r.name, 80);
        return n
          ? {
              name: n,
              chair: r.chair === true,
              independent: r.independent === true,
            }
          : null;
      })
      .filter(
        (m): m is { name: string; chair: boolean; independent: boolean } => !!m,
      )
      .slice(0, 15);
    if (members.length < 2)
      throw new BadRequest("A committee needs at least two members.");
    if (members.filter((m) => m.chair).length !== 1)
      throw new BadRequest("Mark exactly one member as chair.");
    const every = Math.round(Number(b.meetEveryMonths));
    if (!(every >= 1 && every <= 12))
      throw new BadRequest("Say how often it meets, every 1 to 12 months.");
    const termsRef = text(b.termsRef, 100);
    if (!termsRef)
      throw new BadRequest("Give the board resolution or terms of reference.");
    const w = this.who(user);
    const c: BoardCommittee = {
      id: `com-${companyId}-${Date.parse(w.at).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      companyId,
      name,
      kind,
      members,
      meetEveryMonths: every,
      termsRef,
      meetings: [],
      recordedBy: w.by,
      recordedById: w.byId,
      at: w.at,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert("regCommittees", c);
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId,
        action: "register.committee.add",
        entity: "board_committee",
        entityId: c.id,
        summary: `${name}: ${members.length} members, meets every ${every} months (${termsRef}).`,
      });
      return c;
    });
  }

  async addMeeting(user: User, id: Id, b: Record<string, unknown>) {
    if (!isDate(b.on) || b.on > this.today())
      throw new BadRequest("Give the meeting date, not in the future.");
    const minutesRef = text(b.minutesRef, 100);
    if (!minutesRef) throw new BadRequest("Give the minutes reference.");
    const present = Math.round(Number(b.present));
    const actionsOpen = Math.max(0, Math.round(Number(b.actionsOpen) || 0));
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regCommittees", id);
      const c = await tx.get("regCommittees", id);
      if (!c) throw new NotFound("Committee");
      if (!keeps(regRoleOf(user, c.companyId), c.companyId))
        throw new AccessDenied(
          "view",
          "(the company records its own meetings)",
        );
      if (!(present >= 2 && present <= c.members.length))
        throw new BadRequest(
          `Say how many members were present (2 to ${c.members.length}).`,
        );
      if (c.meetings.some((m) => m.on === b.on))
        throw new BadRequest("A meeting on this date is already recorded.");
      const w = this.who(user);
      await tx.update("regCommittees", id, {
        meetings: [
          ...c.meetings,
          { on: b.on as IsoDate, present, minutesRef, actionsOpen, ...w },
        ],
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: c.companyId,
        action: "register.committee.meeting",
        entity: "board_committee",
        entityId: id,
        summary: `${c.name} met on ${b.on}: ${present} present, minutes ${minutesRef}, ${actionsOpen} actions open.`,
      });
      return (await tx.get("regCommittees", id))!;
    });
  }

  // ----- Risks (ACT only) -----

  async addRisk(user: User, b: Record<string, unknown>) {
    this.mustRisk(user, "director");
    const companyId = text(b.companyId, 80);
    if (!(await this.groupCompanies(user)).includes(companyId))
      throw new AccessDenied("view", companyId);
    const title = text(b.title, 160);
    const category = oneOf(b.category, RISK_CATEGORY_LABEL);
    const ownerName = text(b.ownerName, 100);
    const likelihood = score(b.likelihood);
    const impact = score(b.impact);
    const controls = text(b.controls, 400);
    const action = text(b.action, 400);
    if (!title || !category)
      throw new BadRequest("Give the risk and its kind.");
    if (!ownerName) throw new BadRequest("Name who owns the risk.");
    if (!likelihood || !impact)
      throw new BadRequest("Score likelihood and impact from 1 to 5.");
    if (!controls)
      throw new BadRequest("Say what is already in place to control it.");
    const actionDueOn = isDate(b.actionDueOn) ? b.actionDueOn : null;
    if (riskLevel(likelihood * impact) === "high" && (!action || !actionDueOn))
      throw new BadRequest("A high risk needs an action and a due date.");
    const w = this.who(user);
    const today = this.today();
    const r: RiskEntry = {
      id: `risk-${companyId}-${Date.parse(w.at).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      companyId,
      title,
      category,
      ownerName,
      likelihood,
      impact,
      controls,
      action,
      actionDueOn,
      lastReviewedOn: today,
      reviews: [{ on: today, likelihood, impact, note: "First entry", ...w }],
      assignedToId: null,
      assignedTo: null,
      instructions: [],
      status: "open",
      closed: null,
      recordedBy: w.by,
      recordedById: w.byId,
      at: w.at,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert("regRisks", r);
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId,
        action: "register.risk.add",
        entity: "risk",
        entityId: r.id,
        summary: `${title}: ${likelihood}x${impact}=${likelihood * impact}, owner ${ownerName}.`,
      });
      return r;
    });
  }

  /** The ACT Director, or the team member given the risk, records a review with the new scores. */
  async reviewRisk(user: User, id: Id, b: Record<string, unknown>) {
    const likelihood = score(b.likelihood);
    const impact = score(b.impact);
    if (!likelihood || !impact)
      throw new BadRequest("Score likelihood and impact from 1 to 5.");
    const note = this.reason(
      b.note,
      "Say what changed or why it stays the same",
    );
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regRisks", id);
      const r = await tx.get("regRisks", id);
      if (!r || !(await this.groupCompanies(user)).includes(r.companyId))
        throw new NotFound("Risk");
      this.mustRisk(user, "update", r);
      if (r.status !== "open") throw new BadRequest("This risk is closed.");
      const action = text(b.action, 400) || r.action;
      const actionDueOn = isDate(b.actionDueOn) ? b.actionDueOn : r.actionDueOn;
      if (
        riskLevel(likelihood * impact) === "high" &&
        (!action || !actionDueOn)
      )
        throw new BadRequest("A high risk needs an action and a due date.");
      const w = this.who(user);
      const today = this.today();
      await tx.update("regRisks", id, {
        likelihood,
        impact,
        action,
        actionDueOn,
        lastReviewedOn: today,
        reviews: [...r.reviews, { on: today, likelihood, impact, note, ...w }],
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: r.companyId,
        action: "register.risk.review",
        entity: "risk",
        entityId: id,
        summary: `${r.title}: ${r.likelihood}x${r.impact} -> ${likelihood}x${impact} (${note}).`,
      });
      return (await tx.get("regRisks", id))!;
    });
  }

  /** The ACT Director gives a risk to an ACT team member and says what to do. */
  async assignRisk(user: User, id: Id, b: Record<string, unknown>) {
    this.mustRisk(user, "director");
    const toId = text(b.toId, 80);
    const note = this.reason(b.note, "Say what the team member should do");
    const to = toId ? await this.store.get("users", toId) : undefined;
    if (!to || riskRoleOf(to) !== "team" || to.accessClosedFrom)
      throw new BadRequest("Choose a member of the ACT team.");
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regRisks", id);
      const r = await tx.get("regRisks", id);
      if (!r || !(await this.groupCompanies(user)).includes(r.companyId))
        throw new NotFound("Risk");
      if (r.status !== "open") throw new BadRequest("This risk is closed.");
      const w = this.who(user);
      await tx.update("regRisks", id, {
        assignedToId: to.id,
        assignedTo: to.name,
        instructions: [
          ...r.instructions,
          { ...w, note, toId: to.id, to: to.name },
        ],
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: r.companyId,
        action: "register.risk.assign",
        entity: "risk",
        entityId: id,
        summary: `${r.title}: given to ${to.name} (${note}).`,
      });
      return (await tx.get("regRisks", id))!;
    });
  }

  /** Only the ACT Director settles (closes) a risk. */
  async closeRisk(user: User, id: Id, noteIn: unknown) {
    this.mustRisk(user, "director");
    const note = this.reason(noteIn, "Say why the risk is settled");
    return this.store.transaction(async (tx) => {
      await tx.lock?.("regRisks", id);
      const r = await tx.get("regRisks", id);
      if (!r || !(await this.groupCompanies(user)).includes(r.companyId))
        throw new NotFound("Risk");
      if (r.status !== "open") throw new BadRequest("Already closed.");
      const w = this.who(user);
      await tx.update("regRisks", id, {
        status: "closed",
        closed: { ...w, note },
      });
      await tx.audit({
        at: w.at,
        actor: w.by,
        companyId: r.companyId,
        action: "register.risk.close",
        entity: "risk",
        entityId: id,
        summary: `${r.title}: settled and closed (${note}).`,
      });
      return (await tx.get("regRisks", id))!;
    });
  }

  // ----- Home -----

  /** What each person should act on today. */
  async homeItems(user: User, companyId?: Id) {
    let b;
    try {
      b = await this.board(user);
    } catch {
      return [];
    }
    const only = <T>(rows: T[], cid: (r: T) => Id) =>
      companyId ? rows.filter((r) => cid(r) === companyId) : rows;
    const items: {
      tone: "crit" | "warn" | "info";
      tag: string;
      title: string;
      detail: string;
      go: { view: "registers"; companyId?: Id };
    }[] = [];
    const tag = "Governance registers";
    if (b.deals) {
      const deals = only(b.deals.rows, (r) => r.deal.companyId);
      const review = deals.filter((d) => d.canReview);
      if (review.length)
        items.push({
          tone: "warn",
          tag,
          title: `${review.length} related-party deal${review.length === 1 ? "" : "s"} to review`,
          detail: review
            .slice(0, 3)
            .map((d) => `${d.companyName}: ${d.deal.counterparty}`)
            .join(", "),
          go: { view: "registers" },
        });
      for (const d of deals.filter((x) => x.canAnswer || x.canRecordBoard))
        items.push({
          tone: "warn",
          tag,
          title: `${d.deal.counterparty}: ${d.canAnswer ? "the Chief of Staff asked a question" : "record the board resolution"}`,
          detail: `${d.companyName} · RM${d.deal.amount.toLocaleString("en-MY")}`,
          go: { view: "registers" },
        });
    }
    if (b.interests && !companyId) {
      if (b.interests.canRecord && b.interests.due)
        items.push({
          tone: "warn",
          tag,
          title: "Directors' declarations due",
          detail: `${b.interests.due} to collect this year`,
          go: { view: "registers" },
        });
      if (b.interests.toRead)
        items.push({
          tone: "info",
          tag,
          title: `${b.interests.toRead} directors' declarations to read`,
          detail: "Recorded by the Deputy Chief of Staff",
          go: { view: "registers" },
        });
    }
    if (b.committees)
      for (const c of only(
        b.committees.rows,
        (r) => r.committee.companyId,
      ).filter((c) => c.canRecord && c.state === "overdue"))
        items.push({
          tone: "warn",
          tag,
          title: `${c.committee.name}: meeting overdue`,
          detail: `${c.companyName} · last met ${c.last?.on ?? "never"}`,
          go: { view: "registers" },
        });
    if (b.risks && b.risks.role !== "view" && !companyId) {
      const late = b.risks.rows.filter(
        (r) =>
          r.canUpdate &&
          (b.risks!.role === "director" || r.mine) &&
          (r.reviewLate || r.actionLate) &&
          r.level !== "low",
      );
      if (late.length)
        items.push({
          tone: late.some((r) => r.level === "high") ? "crit" : "warn",
          tag,
          title: `${late.length} risk${late.length === 1 ? "" : "s"} to review`,
          detail: late
            .slice(0, 3)
            .map((r) => r.risk.title)
            .join(", "),
          go: { view: "registers" },
        });
    }
    return items;
  }
}