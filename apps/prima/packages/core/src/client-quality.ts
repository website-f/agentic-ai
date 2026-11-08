import { AccessDenied } from "./access";
import { actRole } from "./access";
import { isGroupLeader } from "./access";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import type { ClientAccount } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { Post } from "./types";
import type { Site } from "./types";
import type { User } from "./types";


export type DiligenceCheckKind =
  | "identity"
  | "authority"
  | "purpose"
  | "credit"
  | "conflict"
  | "site_risk"
  | "pdpa";
export type DiligenceCheckStatus =
  | "pending"
  | "clear"
  | "concern"
  | "not_needed";
export type DiligenceResult = "accepted" | "accepted_conditions" | "declined";

export interface DiligenceCheck {
  kind: DiligenceCheckKind;
  status: DiligenceCheckStatus;
  ref: string;
  note: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export interface ClientDiligence {
  /** 1 for the first review; each yearly or renewal review adds one. */
  round: number;
  openedBy: string;
  openedById: Id;
  at: IsoDateTime;
  checks: DiligenceCheck[];
  decision: {
    result: DiligenceResult;
    note: string;
    conditions: string;
    by: string;
    byId: Id;
    at: IsoDateTime;
  } | null;
  /** When it must be reviewed again (12 months after the decision, proposal), or at renewal, whichever first. */
  reviewDueOn: IsoDate | null;
  /** Earlier rounds, kept. */
  past: {
    round: number;
    decision: ClientDiligence["decision"];
    checks: DiligenceCheck[];
  }[];
}

export const DILIGENCE_CHECK_LABEL: Record<DiligenceCheckKind, string> = {
  identity: "Who the client is: SSM search, or the government agency confirmed",
  authority:
    "The person signing has authority (letter, board resolution or officer of the agency)",
  purpose:
    "Lawful purpose: what we guard and why, nothing unlawful at the site",
  credit: "Able to pay: payment record, credit check or deposit",
  conflict:
    "No conflict of interest with our directors, staff or other clients",
  site_risk: "Site risk assessed, armed or unarmed decided",
  pdpa: "Client data and CCTV we handle, and the PDPA notice",
};
export const DILIGENCE_RESULT_LABEL: Record<DiligenceResult, string> = {
  accepted: "Accepted",
  accepted_conditions: "Accepted with conditions",
  declined: "Declined",
};
const DILIGENCE_ORDER: DiligenceCheckKind[] = [
  "identity",
  "authority",
  "purpose",
  "credit",
  "conflict",
  "site_risk",
  "pdpa",
];
/** Months until due diligence is reviewed again (proposal for approval). */
export const DILIGENCE_REVIEW_MONTHS = 12;

export interface AssignmentInstructions {
  version: number;
  /** Site-wide routine: access control, patrols, keys, logbooks. */
  general: string;
  posts: { postId: Id; postName: string; duties: string }[];
  /** Police, Bomba, hospital, the client's duty manager, our control room. */
  emergency: string;
  /** Who the guards report to, and how incidents are reported. */
  reporting: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** The client's signature on this version. A material change clears it. */
  clientSigned: {
    name: string;
    role: string;
    on: IsoDate;
    ref: string;
    by: string;
    at: IsoDateTime;
  } | null;
  history: {
    version: number;
    at: IsoDateTime;
    by: string;
    note: string;
    clientSigned: AssignmentInstructions["clientSigned"];
  }[];
}

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const isDate = (v: unknown): v is IsoDate =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Where due diligence stands for a client today. Prima only says what is still open; the company manager decides. */
export function diligenceState(
  acct: Pick<ClientAccount, "diligence"> | null | undefined,
  today: IsoDate,
) {
  const d = acct?.diligence ?? null;
  if (!d)
    return {
      ok: false,
      state: "none" as const,
      detail: "Client due diligence not started. Open it in the client file.",
    };
  if (!d.decision) {
    const open = d.checks.filter((k) => k.status === "pending").length;
    return {
      ok: false,
      state: "open" as const,
      detail: open
        ? `Client due diligence: ${open} check${open === 1 ? "" : "s"} still to do.`
        : "Client due diligence waits for the company manager to decide.",
    };
  }
  if (d.decision.result === "declined")
    return {
      ok: false,
      state: "declined" as const,
      detail: "The company manager declined this client.",
    };
  if (d.reviewDueOn && d.reviewDueOn < today)
    return {
      ok: false,
      state: "due" as const,
      detail: `Client due diligence was due for review on ${d.reviewDueOn}.`,
    };
  return {
    ok: true,
    state: "accepted" as const,
    detail: `${DILIGENCE_RESULT_LABEL[d.decision.result]} by ${d.decision.by}.`,
  };
}

/** Whether every site has instructions covering each post, signed by the client on the current version. */
export function instructionsState(
  sites: Pick<Site, "id" | "name" | "instructions">[],
  posts: Pick<Post, "id" | "siteId" | "name">[],
) {
  if (!sites.length)
    return {
      ok: false,
      detail: "No site on this contract yet.",
      missing: [] as string[],
    };
  const missing: string[] = [];
  for (const s of sites) {
    const ins = s.instructions;
    const sitePosts = posts.filter((p) => p.siteId === s.id);
    if (!ins) missing.push(`${s.name}: not written`);
    else if (
      sitePosts.some(
        (p) =>
          !ins.posts.some((x) => x.postId === p.id && x.duties.length >= 10),
      )
    )
      missing.push(`${s.name}: a post has no duties`);
    else if (!ins.clientSigned)
      missing.push(
        `${s.name}: version ${ins.version} not signed by the client`,
      );
  }
  return {
    ok: missing.length === 0,
    missing,
    detail: missing.length
      ? missing.join("; ")
      : `Signed by the client for ${sites.length} site${sites.length === 1 ? "" : "s"}.`,
  };
}

export class ClientQualityService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    /** Operations works only the sites in its own area (the same coverage as Contracts). */
    private opsCovers?: (
      user: User,
      companyId: Id,
      siteIds: Id[],
    ) => Promise<boolean>,
  ) {}
  private isOps(user: User) {
    return user.role === "pwvsb_officer" && user.department === "operations";
  }
  /** Operations sees a client or site only in its own area; everyone else as their role allows. */
  private async inArea(user: User, companyId: Id, siteIds: Id[]) {
    if (!this.isOps(user) || isGroupLeader(user) || !this.opsCovers)
      return true;
    return this.opsCovers(user, companyId, siteIds);
  }
  private today(): IsoDate {
    return this.clock().slice(0, 10);
  }

  /** The company manager decides; admin executives work the checks; Operations OM and up, group leaders and ACT read. */
  diligenceRole(user: User, companyId: Id): "decide" | "work" | "view" | null {
    if (user.integration) return null;
    if (user.role === "company_manager" && user.companyIds.includes(companyId))
      return "decide";
    if (user.role === "admin_exec" && user.companyIds.includes(companyId))
      return "work";
    if (isGroupLeader(user) || actRole(user)) return "view";
    if (
      user.role === "pwvsb_officer" &&
      user.department === "operations" &&
      ["om", "regional", "ogm", "ops_director"].includes(user.opsTier ?? "")
    )
      return "view";
    return null;
  }

  /** Who writes a site's assignment instructions: Operations OM and up, and the company office. Group leaders and ACT read. */
  instructionsRole(user: User, companyId: Id): "write" | "view" | null {
    if (user.integration) return null;
    if (
      (user.role === "company_manager" || user.role === "admin_exec") &&
      user.companyIds.includes(companyId)
    )
      return "write";
    if (
      user.role === "pwvsb_officer" &&
      user.department === "operations" &&
      ["om", "regional", "ogm", "ops_director"].includes(user.opsTier ?? "")
    )
      return "write";
    if (isGroupLeader(user) || actRole(user)) return "view";
    return null;
  }

  async diligence(user: User, accountId: Id) {
    const a = await this.store.get("clientAccounts", accountId);
    if (!a) throw new NotFound("Client");
    const role = this.diligenceRole(user, a.companyId);
    if (!role || !(await this.inArea(user, a.companyId, a.siteIds)))
      throw new AccessDenied("view", "(client due diligence)");
    const today = this.today();
    const d = a.diligence ?? null;
    const st = diligenceState(a, today);
    const open =
      d && !d.decision
        ? d.checks.filter((k) => k.status === "pending").map((k) => k.kind)
        : [];
    const concerns = d
      ? d.checks.filter((k) => k.status === "concern").map((k) => k.kind)
      : [];
    const reviewSoon =
      !!d?.decision &&
      d.decision.result !== "declined" &&
      !!d.reviewDueOn &&
      d.reviewDueOn <= addDays(today, 60);
    return {
      role,
      accountId: a.id,
      name: a.name,
      diligence: d,
      state: st,
      open,
      concerns,
      reviewSoon,
      can: {
        start:
          (role === "decide" || role === "work") &&
          (!d ||
            (!!d.decision && (reviewSoon || d.decision.result === "declined"))),
        work: (role === "decide" || role === "work") && !!d && !d.decision,
        decide: role === "decide" && !!d && !d.decision,
      },
    };
  }

  async diligenceAct(user: User, action: string, b: Record<string, unknown>) {
    const id = text(b.accountId, 80);
    const at = this.clock();
    const today = this.today();
    return this.store.transaction(async (tx) => {
      await tx.lock?.("clientAccounts", id);
      const a = await tx.get("clientAccounts", id);
      if (!a) throw new NotFound("Client");
      const role = this.diligenceRole(user, a.companyId);
      const works = role === "decide" || role === "work";
      const d = a.diligence ?? null;
      let next: ClientDiligence;
      let summary: string;
      if (action === "start") {
        if (!works)
          throw new AccessDenied(
            "view",
            "(the company office does client due diligence)",
          );
        if (d && !d.decision)
          throw new BadRequest(
            "Due diligence is already open for this client.",
          );
        // An accepted client is reviewed again only when the review falls due (60 days ahead), so a live contract never
        // loses its accepted diligence by accident.
        if (
          d?.decision &&
          d.decision.result !== "declined" &&
          d.reviewDueOn &&
          d.reviewDueOn > addDays(today, 60)
        )
          throw new BadRequest(
            `Due diligence was accepted; the next review is due on ${d.reviewDueOn}.`,
          );
        const blank = (kind: DiligenceCheckKind): DiligenceCheck => ({
          kind,
          status: "pending",
          ref: "",
          note: "",
          by: user.name,
          byId: user.id,
          at,
        });
        next = {
          round: (d?.round ?? 0) + 1,
          openedBy: user.name,
          openedById: user.id,
          at,
          checks: DILIGENCE_ORDER.map(blank),
          decision: null,
          reviewDueOn: null,
          past: d
            ? [
                ...d.past,
                { round: d.round, decision: d.decision, checks: d.checks },
              ].slice(-5)
            : [],
        };
        summary = `Client due diligence opened (round ${next.round}).`;
      } else if (action === "check") {
        if (!works)
          throw new AccessDenied(
            "view",
            "(the company office records the checks)",
          );
        if (!d || d.decision) throw new BadRequest("Open due diligence first.");
        const kind = DILIGENCE_ORDER.find((k) => k === b.kind);
        const status =
          b.status === "clear" ||
          b.status === "concern" ||
          b.status === "not_needed" ||
          b.status === "pending"
            ? b.status
            : null;
        if (!kind || !status)
          throw new BadRequest("Choose the check and its result.");
        const ref = text(b.ref, 160);
        const note = text(b.note, 400);
        if (
          (status === "concern" || status === "not_needed") &&
          note.length < 5
        )
          throw new BadRequest(
            "Say why: a concern or a check not needed needs a reason.",
          );
        if (status === "clear" && !ref)
          throw new BadRequest(
            "Give the reference: the search result, letter or where the evidence is filed.",
          );
        next = {
          ...d,
          checks: d.checks.map((k) =>
            k.kind === kind
              ? {
                  ...k,
                  status,
                  ref: ref || k.ref,
                  note: note || k.note,
                  by: user.name,
                  byId: user.id,
                  at,
                }
              : k,
          ),
        };
        summary = `Client due diligence: ${DILIGENCE_CHECK_LABEL[kind]} ${status.replace("_", " ")}${ref ? ` (${ref})` : ""}.`;
      } else if (action === "decide") {
        if (role !== "decide")
          throw new AccessDenied(
            "commercial.approve",
            "(the company manager decides on a client)",
          );
        if (!d || d.decision) throw new BadRequest("Nothing to decide.");
        const result =
          b.result === "accepted" ||
          b.result === "accepted_conditions" ||
          b.result === "declined"
            ? b.result
            : null;
        if (!result) throw new BadRequest("Choose the decision.");
        const note = text(b.note, 600);
        if (note.length < 5)
          throw new BadRequest("Give the reason for the decision.");
        const conditions = text(b.conditions, 400);
        const open = d.checks.filter((k) => k.status === "pending");
        const concerns = d.checks.filter((k) => k.status === "concern");
        if (result !== "declined" && open.length)
          throw new BadRequest(
            `Still open: ${open.map((k) => DILIGENCE_CHECK_LABEL[k.kind]).join("; ")}.`,
          );
        if (result === "accepted" && concerns.length)
          throw new BadRequest(
            "There is a concern on file. Accept with conditions, or decline.",
          );
        if (result === "accepted_conditions" && conditions.length < 5)
          throw new BadRequest("Write the conditions.");
        const due = addDays(today, Math.round(DILIGENCE_REVIEW_MONTHS * 30.44));
        const reviewDueOn =
          result === "declined"
            ? null
            : a.contractEndsOn &&
                a.contractEndsOn > today &&
                a.contractEndsOn < due
              ? a.contractEndsOn
              : due;
        next = {
          ...d,
          decision: {
            result,
            note,
            conditions: result === "accepted_conditions" ? conditions : "",
            by: user.name,
            byId: user.id,
            at,
          },
          reviewDueOn,
        };
        summary = `Client due diligence: ${DILIGENCE_RESULT_LABEL[result]} (${note})${conditions && result === "accepted_conditions" ? `; conditions: ${conditions}` : ""}.`;
      } else throw new BadRequest("Unknown action.");
      await tx.update("clientAccounts", id, { diligence: next });
      await tx.audit({
        at,
        actor: user.name,
        companyId: a.companyId,
        action: `client.diligence.${action}`,
        entity: "client_account",
        entityId: id,
        summary: `${a.name}: ${summary}`,
      });
      return this.diligence(user, id);
    });
  }

  async siteInstructions(user: User, siteId: Id) {
    const s = await this.store.get("sites", siteId);
    if (!s) throw new NotFound("Site");
    const role = this.instructionsRole(user, s.companyId);
    if (!role || !(await this.inArea(user, s.companyId, [s.id])))
      throw new AccessDenied("view", "(assignment instructions)");
    const posts = await this.store.list("posts", { siteId });
    const st = instructionsState([s], posts);
    return {
      role,
      site: {
        id: s.id,
        name: s.name,
        code: s.code,
        companyId: s.companyId,
        armed: s.armed,
        risk: s.risk,
      },
      posts: posts.map((p) => ({ id: p.id, name: p.name })),
      instructions: s.instructions ?? null,
      state: st,
    };
  }

  async instructionsAct(
    user: User,
    action: string,
    b: Record<string, unknown>,
  ) {
    const siteId = text(b.siteId, 80);
    const at = this.clock();
    return this.store.transaction(async (tx) => {
      await tx.lock?.("sites", siteId);
      const s = await tx.get("sites", siteId);
      if (!s) throw new NotFound("Site");
      if (
        this.instructionsRole(user, s.companyId) !== "write" ||
        !(await this.inArea(user, s.companyId, [s.id]))
      )
        throw new AccessDenied(
          "view",
          "(Operations or the company office write assignment instructions)",
        );
      const old = s.instructions ?? null;
      let next: AssignmentInstructions;
      let summary: string;
      if (action === "save") {
        const posts = await tx.list("posts", { siteId });
        const given = Array.isArray(b.posts)
          ? (b.posts as unknown[]).slice(0, 60)
          : [];
        const duties = posts.map((p) => {
          const g = given.find(
            (x) => (x as { postId?: unknown })?.postId === p.id,
          ) as { duties?: unknown } | undefined;
          return {
            postId: p.id,
            postName: p.name,
            duties: text(g?.duties, 2000),
          };
        });
        const general = text(b.general, 4000);
        const emergency = text(b.emergency, 2000);
        const reporting = text(b.reporting, 2000);
        if (general.length < 20)
          throw new BadRequest(
            "Write the site routine: access control, patrols, keys and logbooks.",
          );
        if (emergency.length < 10)
          throw new BadRequest(
            "Give the emergency contacts: police, Bomba, hospital and the client.",
          );
        if (reporting.length < 10)
          throw new BadRequest(
            "Say who the guards report to and how incidents are reported.",
          );
        const short = duties.filter((d) => d.duties.length < 10);
        if (short.length)
          throw new BadRequest(
            `Write the duties for: ${short.map((d) => d.postName).join(", ")}.`,
          );
        const material = !old || b.material !== false;
        const note =
          text(b.note, 300) ||
          (old
            ? material
              ? "New version"
              : "Small correction"
            : "First version");
        next = {
          version: (old?.version ?? 0) + 1,
          general,
          posts: duties,
          emergency,
          reporting,
          by: user.name,
          byId: user.id,
          at,
          clientSigned: material ? null : (old?.clientSigned ?? null),
          history: old
            ? [
                ...old.history,
                {
                  version: old.version,
                  at: old.at,
                  by: old.by,
                  note,
                  clientSigned: old.clientSigned,
                },
              ].slice(-20)
            : [],
        };
        summary = `Assignment instructions version ${next.version}${material ? "" : " (small correction, client signature kept)"}.`;
      } else if (action === "client_signed") {
        if (!old) throw new BadRequest("Write the instructions first.");
        if (old.clientSigned)
          throw new BadRequest(
            `Version ${old.version} is already signed by the client.`,
          );
        const name = text(b.name, 120);
        const role = text(b.role, 80);
        const ref = text(b.ref, 160);
        const on = isDate(b.on) ? b.on : null;
        if (name.length < 3 || !role)
          throw new BadRequest(
            "Give the name and position of the client's signatory.",
          );
        if (!on || on > this.today())
          throw new BadRequest(
            "Give the date the client signed (not in the future).",
          );
        if (on < old.at.slice(0, 10))
          throw new BadRequest(
            `The client signs version ${old.version}, written on ${old.at.slice(0, 10)}: give a date on or after it.`,
          );
        if (ref.length < 3)
          throw new BadRequest("Give where the signed copy is filed.");
        next = {
          ...old,
          clientSigned: { name, role, on, ref, by: user.name, at },
        };
        summary = `Assignment instructions version ${old.version} signed by ${name} (${role}) on ${on}, ${ref}.`;
      } else throw new BadRequest("Unknown action.");
      await tx.update("sites", siteId, { instructions: next });
      await tx.audit({
        at,
        actor: user.name,
        companyId: s.companyId,
        action: `site.instructions.${action}`,
        entity: "site",
        entityId: siteId,
        summary: `${s.name}: ${summary}`,
      });
      return this.siteInstructions(user, siteId);
    });
  }
}