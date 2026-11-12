import type { FinSettingsValues } from "./types";
import { AccessDenied } from "./access";
import { isLead } from "./finance";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinActor } from "./finance";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { FinAdvance } from "./types";
import type { FinCard } from "./types";
import type { FinCardLine } from "./types";
import type { FinCardStatement } from "./types";
import type { FinMandate } from "./types";
import type { FinMandatePerson } from "./types";
import type { FinPayment } from "./types";
import type { FinPettyCash } from "./types";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { User } from "./types";


const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
const R = () => RULES.financeCash.value;

export interface FinCashCtx {
  user: User;
  /** Null for someone outside Finance acting on their own advance, card or float. */
  a: FinActor | null;
  today: IsoDate;
  sign: (comment?: string) => FinSign;
  reviewer: boolean;
  senior: boolean;
  /** Prima accounts by id (names, and whether they have left). */
  userById: (id: Id) => User | undefined;
  /** The Finance Director's petty cash limits, when set (Fauzan, 2 Nov 2026). */
  petty?: { voucherMax: number; floatMax: number };
  /** C4 (Fauzan, 11 Nov 2026): the Finance settings in force; each rule number falls back to its rule default. */
  fs?: Partial<FinSettingsValues>;
}
type Out<T> = {
  patch: Partial<FinStatus>;
  action: string;
  summary: string;
  result: T;
};

function money(v: unknown, field: string, allowZero = false): number {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim()
        ? Number(v)
        : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0))
    throw new BadRequest(
      `${field} must be ${allowZero ? "RM0.00 or more" : "more than RM0.00"}.`,
    );
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6)
    throw new BadRequest(`${field} has at most 2 decimal places (sen).`);
  return round2(n);
}
function docs(v: unknown, field: string, min = 1): string[] {
  const list = Array.isArray(v)
    ? v
    : typeof v === "string" && v.trim()
      ? [v]
      : [];
  if (list.length < min)
    throw new BadRequest(
      `Attach ${min === 1 ? "the" : `at least ${min}`} ${field}.`,
    );
  return list
    .slice(0, 20)
    .map((d, i) => noSecrets(text(d, `${field} ${i + 1}`, 2, 300), field));
}
const finance = (ctx: FinCashCtx) => {
  if (!ctx.a || ctx.a.kind === "viewer" || ctx.a.kind === "coo")
    throw new AccessDenied("view", "(Finance staff do this)");
  return ctx.a;
};
const needReviewer = (ctx: FinCashCtx, what: string) => {
  finance(ctx);
  if (!ctx.reviewer)
    throw new AccessDenied(
      "view",
      `(the deputy, the team leader, the Finance Director or the CEO ${what})`,
    );
};
const left = (u: User | undefined, today: IsoDate) =>
  !u || (!!u.accessClosedFrom && u.accessClosedFrom <= today);
const prevMonth = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const nextMonthDay = (p: string, day: number): IsoDate => {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, day));
  return d.toISOString().slice(0, 10);
};

// ---------- Bank mandates ----------

export const FIN_MANDATE_ROLES: FinMandatePerson["role"][] = [
  "signatory",
  "portal_maker",
  "portal_approver",
];

export function finMandateOf(f: FinStatus, bankId: Id): FinMandate | null {
  return (
    (f.mandates ?? []).find(
      (m) => m.bankId === bankId && m.status === "active",
    ) ?? null
  );
}

/** Why a mandate needs looking at now: someone on it left, or a year passed since it was last confirmed with the bank. */
export function finMandateIssues(
  m: FinMandate,
  ctx: Pick<FinCashCtx, "today" | "userById">,
): string[] {
  const out: string[] = [];
  for (const p of m.people)
    if (p.userId && left(ctx.userById(p.userId), ctx.today))
      out.push(
        `${p.name} has left: ask the bank to remove them and record the new mandate`,
      );
  const last = m.reviewed?.at ?? m.checked?.at ?? m.added.at;
  if (daysBetween(last.slice(0, 10), ctx.today) > R().mandateReviewDays)
    out.push(
      `not confirmed with the bank for over ${Math.round(R().mandateReviewDays / 30)} months`,
    );
  return out;
}

function people(v: unknown, ctx: FinCashCtx): FinMandatePerson[] {
  if (!Array.isArray(v) || v.length === 0)
    throw new BadRequest(
      "List everyone on the mandate: signatories and bank portal makers and approvers.",
    );
  const out = v.slice(0, 30).map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const role = FIN_MANDATE_ROLES.find((r) => r === o.role);
    if (!role)
      throw new BadRequest(
        `Person ${i + 1}: role must be one of ${FIN_MANDATE_ROLES.join(", ")}.`,
      );
    const userId = typeof o.userId === "string" && o.userId ? o.userId : null;
    const u = userId ? ctx.userById(userId) : undefined;
    if (userId && !u)
      throw new BadRequest(`Person ${i + 1}: no Prima account ${userId}.`);
    const name =
      u?.name ??
      noSecrets(text(o.name, `Person ${i + 1} name`, 2, 120), "Name");
    const limit =
      o.limit == null || o.limit === ""
        ? null
        : money(o.limit, `${name}'s limit`);
    return { userId, name, role, limit };
  });
  if (!out.some((p) => p.role !== "portal_maker"))
    throw new BadRequest(
      "The mandate needs at least one signatory or portal approver.",
    );
  return out;
}

export function finMandateAction(
  ctx: FinCashCtx,
  f: FinStatus,
  action: string,
  input: Record<string, unknown>,
): Out<unknown> {
  const list = f.mandates ?? [];
  if (action === "add") {
    finance(ctx);
    const bank = f.banks.find((b) => b.id === input.bankId);
    if (!bank)
      throw new BadRequest("Choose one of this company's bank accounts.");
    if (list.some((m) => m.bankId === bank.id && m.status === "pending"))
      throw new BadRequest(
        "A new mandate for this account is already waiting to be checked.",
      );
    const rule =
      input.rule === "any_two"
        ? "any_two"
        : input.rule === "any_one"
          ? "any_one"
          : null;
    if (!rule)
      throw new BadRequest(
        "Say what the bank needs: any one approver, or any two together.",
      );
    const twoAbove =
      rule === "any_one" && input.twoAbove != null && input.twoAbove !== ""
        ? money(input.twoAbove, "Two approvers needed above")
        : null;
    const ppl = people(input.people, ctx);
    if (
      rule === "any_two" &&
      ppl.filter((p) => p.role !== "portal_maker").length < 2
    )
      throw new BadRequest("Two approvers are needed, so list at least two.");
    const version = list.filter((m) => m.bankId === bank.id).length + 1;
    const m: FinMandate = {
      id: `mand-${bank.id}-v${version}`,
      bankId: bank.id,
      version,
      rule,
      twoAbove,
      people: ppl,
      docs: docs(input.docs, "board resolution and bank mandate form"),
      status: "pending",
      added: ctx.sign(
        typeof input.comment === "string"
          ? input.comment.trim().slice(0, 300)
          : "",
      ),
      checked: null,
      reviewed: null,
    };
    return {
      patch: { mandates: [...list, m] },
      action: "finance.mandate.added",
      summary: `Bank mandate ${m.id} for ${bank.bank} ${bank.accountMasked} entered: ${rule === "any_two" ? "any two" : "any one"}${twoAbove ? `, two above RM${twoAbove.toFixed(2)}` : ""}; ${ppl.map((p) => `${p.name} (${p.role.replace("_", " ")})`).join(", ")}. Waiting for a second person to check.`,
      result: m,
    };
  }
  const m = list.find((x) => x.id === input.mandateId);
  if (!m) throw new NotFound("Bank mandate");
  if (action === "check") {
    needReviewer(ctx, "checks a bank mandate");
    if (m.status !== "pending") throw new BadRequest("Nothing to check.");
    if (m.added.byId === ctx.user.id)
      throw new AccessDenied("view", "(nobody checks a mandate they entered)");
    if (m.people.some((p) => p.userId === ctx.user.id) && !isLead(ctx.a!))
      throw new AccessDenied(
        "view",
        "(you are on this mandate; someone not on it checks it)",
      );
    const reject = input.decision === "reject";
    const comment = reject
      ? requireReason(input.comment, "reject it")
      : text(
          input.comment,
          "What you checked it against (the bank’s confirmation, the board resolution)",
          5,
          300,
        );
    const next: FinMandate = {
      ...m,
      status: reject ? "rejected" : "active",
      checked: ctx.sign(comment),
      reviewed: reject ? null : ctx.sign(comment),
    };
    const mandates = list.map((x) =>
      x.id === m.id
        ? next
        : !reject && x.bankId === m.bankId && x.status === "active"
          ? { ...x, status: "replaced" as const }
          : x,
    );
    return {
      patch: { mandates },
      action: `finance.mandate.${reject ? "rejected" : "checked"}`,
      summary: `Bank mandate ${m.id} ${reject ? "rejected" : "checked and in force"}: ${comment}`,
      result: next,
    };
  }
  if (action === "review") {
    needReviewer(ctx, "confirms a mandate with the bank");
    if (m.status !== "active")
      throw new BadRequest("Only the mandate in force is reviewed.");
    const gone = m.people.filter(
      (p) => p.userId && left(ctx.userById(p.userId), ctx.today),
    );
    if (gone.length)
      throw new BadRequest(
        `${gone.map((p) => p.name).join(", ")} left: record the new mandate from the bank instead.`,
      );
    const comment = text(
      input.comment,
      "What the bank confirmed (letter, portal user list, date)",
      5,
      300,
    );
    const next: FinMandate = { ...m, reviewed: ctx.sign(comment) };
    return {
      patch: { mandates: list.map((x) => (x.id === m.id ? next : x)) },
      action: "finance.mandate.reviewed",
      summary: `Bank mandate ${m.id} confirmed with the bank: ${comment}`,
      result: next,
    };
  }
  throw new BadRequest("Unknown action.");
}

/**
 * At release: with a checked mandate on the account, whoever records the release must be a portal approver or
 * signatory on it (within their limit), and when two are needed the second approver is named, someone else on it who
 * did not prepare the payment. Accounts with no checked mandate yet are not held (the home asks for one).
 */
export function finMandateRelease(
  f: FinStatus,
  p: FinPayment,
  user: User,
  coApproverId: unknown,
  users: (id: Id) => User | undefined,
  today: IsoDate,
): { co: string | null } {
  const m = finMandateOf(f, p.bankId);
  if (!m) return { co: null };
  const approvers = m.people.filter(
    (x) =>
      x.role !== "portal_maker" && x.userId && !left(users(x.userId), today),
  );
  const me = approvers.find((x) => x.userId === user.id);
  if (!me)
    throw new AccessDenied(
      "view",
      `(you are not an approver on the bank mandate for this account, ${m.id}; someone on it records the release)`,
    );
  const two =
    m.rule === "any_two" ||
    (m.twoAbove != null && p.amount > m.twoAbove) ||
    (me.limit != null && p.amount > me.limit);
  if (!two) return { co: null };
  const preparer = p.steps.find((s) => s.step === "prepared")?.byId;
  const co = approvers.find(
    (x) => x.userId === coApproverId && x.userId !== user.id,
  );
  if (!co)
    throw new BadRequest(
      `The bank mandate needs two approvers for RM${p.amount.toFixed(2)}: name the second approver on mandate ${m.id}.`,
    );
  if (co.userId === preparer)
    throw new BadRequest(
      "The second approver prepared this payment; choose someone else on the mandate.",
    );
  if (
    co.limit != null &&
    p.amount > co.limit &&
    me.limit != null &&
    p.amount > me.limit
  )
    throw new BadRequest(
      "The amount is above both approvers’ limits on the mandate.",
    );
  return { co: co.name };
}

// ---------- Staff cash advances ----------

export function finAdvanceOverdue(
  x: FinAdvance,
  f: FinStatus,
  today: IsoDate,
): boolean {
  if (x.status !== "open") return false;
  const p = (f.payments ?? []).find((y) => y.id === x.paymentId);
  return !!p && p.status === "released" && today > x.settleBy;
}

/** Checks before the advance's payment is prepared; the payment itself goes through createPayment. */
export function finAdvancePrecheck(
  ctx: FinCashCtx,
  f: FinStatus,
  input: Record<string, unknown>,
) {
  finance(ctx);
  const payee = (f.payees ?? []).find((p) => p.id === input.payeeId);
  if (!payee)
    throw new BadRequest(
      "Choose the staff member from this company's payee list (add and verify them first).",
    );
  if (!["payroll", "other"].includes(payee.kind))
    throw new BadRequest(
      `${payee.name} is a ${payee.kind} payee, not a staff member.`,
    );
  const userId =
    typeof input.userId === "string" && input.userId ? input.userId : null;
  const u = userId ? ctx.userById(userId) : undefined;
  if (userId && !u) throw new BadRequest(`No Prima account ${userId}.`);
  if (userId === ctx.user.id)
    throw new AccessDenied("view", "(nobody prepares their own advance)");
  const amount = money(input.amount, "Advance");
  const purpose = noSecrets(
    text(input.purpose, "What it is for (trip, site start-up)", 5, 200),
    "Purpose",
  );
  const settleBy =
    input.settleBy == null || input.settleBy === ""
      ? addDays(ctx.today, ctx.fs?.advanceSettleDays ?? R().advanceSettleDays)
      : isoDate(input.settleBy, "Settle by");
  if (settleBy < ctx.today)
    throw new BadRequest("The settle-by date is in the past.");
  if (daysBetween(ctx.today, settleBy) > R().advanceMaxDays)
    throw new BadRequest(`Settle within ${R().advanceMaxDays} days at most.`);
  const same = (x: FinAdvance) =>
    (userId && x.userId === userId) || norm(x.name) === norm(payee.name);
  const overdue = (f.advances ?? []).filter(
    (x) => same(x) && finAdvanceOverdue(x, f, ctx.today),
  );
  if (overdue.length)
    throw new BadRequest(
      `${payee.name} has not settled advance ${overdue[0].id} due ${overdue[0].settleBy}; settle or recover it before a new one.`,
    );
  return { payee, userId, amount, purpose, settleBy };
}

export function finAdvanceAdd(
  ctx: FinCashCtx,
  f: FinStatus,
  pre: ReturnType<typeof finAdvancePrecheck>,
  paymentId: Id,
): Out<FinAdvance> {
  const list = f.advances ?? [];
  const x: FinAdvance = {
    id: `adv-${f.companyId}-${String(list.length + 1).padStart(3, "0")}`,
    userId: pre.userId,
    name: pre.payee.name,
    purpose: pre.purpose,
    amount: pre.amount,
    paymentId,
    settleBy: pre.settleBy,
    status: "open",
    added: ctx.sign(),
    settlement: null,
    checked: null,
    recovered: null,
  };
  return {
    patch: { advances: [...list, x] },
    action: "finance.advance.added",
    summary: `Staff advance ${x.id}: RM${x.amount.toFixed(2)} to ${x.name} for ${x.purpose}, settle by ${x.settleBy}; paid by payment ${paymentId} (review and approval as usual).`,
    result: x,
  };
}

export function finAdvanceAction(
  ctx: FinCashCtx,
  f: FinStatus,
  action: string,
  input: Record<string, unknown>,
): Out<unknown> {
  const list = f.advances ?? [];
  const x = list.find((y) => y.id === input.advanceId);
  if (!x) throw new NotFound("Advance");
  const save = (n: FinAdvance) => ({
    advances: list.map((y) => (y.id === n.id ? n : y)),
  });
  const pay = (f.payments ?? []).find((y) => y.id === x.paymentId);
  if (action === "settle") {
    // The staff member settles their own; Finance may enter it for them from the paper form.
    const own = !!x.userId && x.userId === ctx.user.id;
    if (!own) finance(ctx);
    if (x.status !== "open") throw new BadRequest(`It is ${x.status}.`);
    if (pay?.status !== "released")
      throw new BadRequest("The advance has not been paid out yet.");
    const spent = money(input.spent, "Spent", true);
    const returned = money(input.returned ?? 0, "Cash paid back", true);
    const receipts = spent > 0 ? docs(input.receipts, "receipts") : [];
    const extra = round2(Math.max(0, spent - x.amount));
    if (extra > 0 && returned > 0)
      throw new BadRequest(
        "More was spent than advanced, so nothing is paid back.",
      );
    if (extra === 0 && Math.abs(round2(spent + returned) - x.amount) >= 0.005)
      throw new BadRequest(
        `Spent RM${spent.toFixed(2)} + paid back RM${returned.toFixed(2)} must equal the RM${x.amount.toFixed(2)} advanced.`,
      );
    const returnRef =
      returned > 0
        ? noSecrets(
            text(
              input.returnRef,
              "Where the cash was paid back (bank reference or receipt number)",
              3,
              60,
            ),
            "Reference",
          )
        : null;
    const n: FinAdvance = {
      ...x,
      status: "submitted",
      settlement: {
        ...ctx.sign(),
        spent,
        receipts,
        returned,
        returnRef,
        extra,
      },
    };
    return {
      patch: save(n),
      action: "finance.advance.settled",
      summary: `Advance ${x.id} (${x.name}) settled: spent RM${spent.toFixed(2)} with ${receipts.length} receipt(s), paid back RM${returned.toFixed(2)}${extra ? `, RM${extra.toFixed(2)} more to claim as a staff claim` : ""}. Waiting for a second person to check.`,
      result: n,
    };
  }
  if (action === "check") {
    finance(ctx);
    if (x.status !== "submitted" || !x.settlement)
      throw new BadRequest("Nothing to check.");
    if (x.settlement.byId === ctx.user.id || x.userId === ctx.user.id)
      throw new AccessDenied(
        "view",
        "(someone other than the staff member and whoever entered the settlement checks it)",
      );
    if (input.decision === "return") {
      const why = requireReason(input.comment, "return it");
      const n: FinAdvance = { ...x, status: "open", settlement: null };
      return {
        patch: save(n),
        action: "finance.advance.returned",
        summary: `Advance ${x.id} settlement returned: ${why}`,
        result: n,
      };
    }
    const comment = text(
      input.comment,
      "What you checked (receipts against the amounts, cash seen in the bank)",
      5,
      300,
    );
    const n: FinAdvance = {
      ...x,
      status: "settled",
      checked: ctx.sign(comment),
    };
    return {
      patch: save(n),
      action: "finance.advance.checked",
      summary: `Advance ${x.id} (${x.name}) settlement checked: ${comment}`,
      result: n,
    };
  }
  if (action === "recover") {
    const a = finance(ctx);
    if (!finAdvanceOverdue(x, f, ctx.today))
      throw new BadRequest(
        "Only an overdue advance that was not settled is recovered.",
      );
    const how = (["payroll", "repaid", "written_off"] as const).find(
      (h) => h === input.how,
    );
    if (!how)
      throw new BadRequest(
        "How: deducted from salary (payroll), repaid, or written off.",
      );
    if (how === "written_off" ? !isLead(a) : !ctx.senior)
      throw new AccessDenied(
        "view",
        how === "written_off"
          ? "(only the Finance Director or the CEO writes an advance off)"
          : "(the team leader, the Finance Director or the CEO records the recovery)",
      );
    if (x.added.byId === ctx.user.id)
      throw new AccessDenied(
        "view",
        "(you prepared this advance; someone else records its recovery)",
      );
    const why = requireReason(input.comment, "record it");
    const ref = noSecrets(
      text(
        input.ref,
        how === "payroll"
          ? "Payroll month and line"
          : how === "repaid"
            ? "Bank reference"
            : "Approval reference",
        3,
        80,
      ),
      "Reference",
    );
    const n: FinAdvance = {
      ...x,
      status: "recovered",
      recovered: { ...ctx.sign(why), how, ref },
    };
    return {
      patch: save(n),
      action: "finance.advance.recovered",
      summary: `Advance ${x.id} (${x.name}) RM${x.amount.toFixed(2)} not settled: ${how.replace("_", " ")} (${ref}): ${why}`,
      result: n,
    };
  }
  throw new BadRequest("Unknown action.");
}

// ---------- Petty cash ----------

/** Cash that should be in the box: the float less vouchers not yet paid back by a released top-up. */
export function finPettyExpected(
  pc: FinPettyCash,
  f: FinStatus,
): { expected: number; unpaid: number; waiting: number } {
  const released = new Set(
    (f.payments ?? []).filter((p) => p.status === "released").map((p) => p.id),
  );
  const unpaid = round2(
    pc.vouchers
      .filter((v) => !v.topUpId || !released.has(v.topUpId))
      .reduce((n, v) => n + v.amount, 0),
  );
  const waiting = round2(
    pc.vouchers.filter((v) => !v.topUpId).reduce((n, v) => n + v.amount, 0),
  );
  return { expected: round2(pc.float - unpaid), unpaid, waiting };
}

export function finPettyAction(
  ctx: FinCashCtx,
  f: FinStatus,
  action: string,
  input: Record<string, unknown>,
): Out<unknown> {
  const list = f.pettyCash ?? [];
  const save = (n: FinPettyCash) => ({
    pettyCash: list.some((y) => y.id === n.id)
      ? list.map((y) => (y.id === n.id ? n : y))
      : [...list, n],
  });
  if (action === "add") {
    finance(ctx);
    const office = noSecrets(text(input.office, "Office", 2, 120), "Office");
    const u =
      typeof input.custodianId === "string"
        ? ctx.userById(input.custodianId)
        : undefined;
    if (!u || left(u, ctx.today))
      throw new BadRequest("Choose the custodian’s Prima account.");
    const payee = (f.payees ?? []).find((p) => p.id === input.payeeId);
    if (!payee || !["payroll", "other"].includes(payee.kind))
      throw new BadRequest(
        "Choose the custodian as a staff payee (add and verify them first); top-ups are paid to them.",
      );
    if (!f.banks.some((b) => b.id === input.bankId))
      throw new BadRequest("Choose the account top-ups are paid from.");
    const float = money(input.float, "Float");
    const floatMax = ctx.petty?.floatMax ?? R().pettyFloatMax;
    if (float > floatMax)
      throw new BadRequest(
        `A float above RM${floatMax.toFixed(2)} is too much cash to keep; use payments.`,
      );
    if (
      list.some((p) => p.status !== "closed" && norm(p.office) === norm(office))
    )
      throw new BadRequest("This office already has petty cash.");
    const pc: FinPettyCash = {
      id: `petty-${f.companyId}-${String(list.length + 1).padStart(2, "0")}`,
      office,
      custodianId: u.id,
      custodian: u.name,
      payeeId: payee.id,
      bankId: input.bankId as Id,
      float,
      status: "pending",
      added: ctx.sign(),
      checked: null,
      vouchers: [],
      topUps: [],
      counts: [],
    };
    return {
      patch: save(pc),
      action: "finance.petty.added",
      summary: `Petty cash ${pc.id} for ${office}: float RM${float.toFixed(2)} kept by ${u.name}. Waiting for a second person to check.`,
      result: pc,
    };
  }
  const pc = list.find((y) => y.id === input.pettyId);
  if (!pc) throw new NotFound("Petty cash");
  const custodian = pc.custodianId === ctx.user.id;
  if (action === "check") {
    needReviewer(ctx, "checks a petty cash float");
    if (pc.status !== "pending") throw new BadRequest("Nothing to check.");
    if (pc.added.byId === ctx.user.id || custodian)
      throw new AccessDenied(
        "view",
        "(someone other than whoever entered it and the custodian checks it)",
      );
    const n: FinPettyCash = {
      ...pc,
      status: "active",
      checked: ctx.sign(text(input.comment, "What you checked", 5, 300)),
    };
    return {
      patch: save(n),
      action: "finance.petty.checked",
      summary: `Petty cash ${pc.id} (${pc.office}) checked.`,
      result: n,
    };
  }
  if (pc.status !== "active")
    throw new BadRequest(
      pc.status === "pending"
        ? "A second person checks the float first."
        : "It is closed.",
    );
  if (action === "voucher") {
    if (!custodian)
      throw new AccessDenied(
        "view",
        `(only the custodian, ${pc.custodian}, pays from the float)`,
      );
    const amount = money(input.amount, "Amount");
    const voucherMax = ctx.petty?.voucherMax ?? R().pettyVoucherMax;
    if (amount > voucherMax)
      throw new BadRequest(
        `Petty cash is for RM${voucherMax.toFixed(2)} or less; ask Finance for a payment.`,
      );
    const date = isoDate(input.date ?? ctx.today, "Date");
    if (date > ctx.today)
      throw new BadRequest("The date cannot be in the future.");
    const { expected } = finPettyExpected(pc, f);
    if (amount > expected + 0.005)
      throw new BadRequest(
        `Only RM${expected.toFixed(2)} should be left in the float; ask for a top-up.`,
      );
    const v = {
      id: `${pc.id}-v${pc.vouchers.length + 1}`,
      date,
      amount,
      purpose: noSecrets(
        text(input.purpose, "What it was for", 3, 200),
        "Purpose",
      ),
      receipt: docs(input.receipt, "receipt")[0],
      by: ctx.user.name,
      byId: ctx.user.id,
      at: ctx.sign().at,
      topUpId: null,
    };
    const n: FinPettyCash = { ...pc, vouchers: [...pc.vouchers, v] };
    return {
      patch: save(n),
      action: "finance.petty.voucher",
      summary: `Petty cash ${pc.office}: RM${amount.toFixed(2)} for ${v.purpose} (${v.receipt}).`,
      result: v,
    };
  }
  if (action === "count") {
    finance(ctx);
    if (custodian)
      throw new AccessDenied(
        "view",
        "(someone other than the custodian counts the cash)",
      );
    const cash = money(input.cash, "Cash counted", true);
    const on = isoDate(input.on ?? ctx.today, "Count date");
    if (on > ctx.today)
      throw new BadRequest("The count date cannot be in the future.");
    const { expected } = finPettyExpected(pc, f);
    const diff = round2(cash - expected);
    const comment =
      Math.abs(diff) >= 0.005
        ? requireReason(
            input.comment,
            `explain the RM${diff.toFixed(2)} difference`,
          )
        : typeof input.comment === "string"
          ? input.comment.trim().slice(0, 300)
          : "";
    const n: FinPettyCash = {
      ...pc,
      counts: [
        ...pc.counts,
        { ...ctx.sign(comment), on, cash, expected, diff },
      ],
    };
    return {
      patch: save(n),
      action: "finance.petty.counted",
      summary: `Petty cash ${pc.office} counted on ${on}: RM${cash.toFixed(2)} against RM${expected.toFixed(2)} expected${diff ? ` (difference RM${diff.toFixed(2)}: ${comment})` : ""}.`,
      result: n,
    };
  }
  if (action === "close") {
    finance(ctx);
    if (!ctx.senior)
      throw new AccessDenied(
        "view",
        "(the team leader, the Finance Director or the CEO closes a float)",
      );
    if (pc.vouchers.some((v) => !v.topUpId))
      throw new BadRequest(
        "Top up (or cancel) the vouchers not yet paid back first.",
      );
    const why = requireReason(input.comment, "close it (where the cash went)");
    const n: FinPettyCash = { ...pc, status: "closed" };
    return {
      patch: save(n),
      action: "finance.petty.closed",
      summary: `Petty cash ${pc.id} (${pc.office}) closed: ${why}`,
      result: n,
    };
  }
  throw new BadRequest("Unknown action.");
}

/** Checks before a top-up payment is prepared: someone other than the custodian, exactly the vouchers not yet paid back. */
export function finPettyTopUpPrecheck(
  ctx: FinCashCtx,
  f: FinStatus,
  pettyId: unknown,
) {
  finance(ctx);
  const pc = (f.pettyCash ?? []).find((y) => y.id === pettyId);
  if (!pc) throw new NotFound("Petty cash");
  if (pc.status !== "active") throw new BadRequest("The float is not in use.");
  if (pc.custodianId === ctx.user.id)
    throw new AccessDenied(
      "view",
      "(the custodian does not prepare their own top-up)",
    );
  const vouchers = pc.vouchers.filter((v) => !v.topUpId);
  if (!vouchers.length) throw new BadRequest("No vouchers to pay back.");
  const amount = round2(vouchers.reduce((n, v) => n + v.amount, 0));
  return { pc, vouchers, amount };
}

export function finPettyTopUpLink(
  f: FinStatus,
  pre: ReturnType<typeof finPettyTopUpPrecheck>,
  paymentId: Id,
  at: string,
): Out<{ paymentId: Id; amount: number }> {
  const ids = new Set(pre.vouchers.map((v) => v.id));
  const pettyCash = (f.pettyCash ?? []).map((p) =>
    p.id !== pre.pc.id
      ? p
      : {
          ...p,
          vouchers: p.vouchers.map((v) =>
            ids.has(v.id) ? { ...v, topUpId: paymentId } : v,
          ),
          topUps: [
            ...p.topUps,
            { paymentId, voucherIds: [...ids], amount: pre.amount, at },
          ],
        },
  );
  return {
    patch: { pettyCash },
    action: "finance.petty.topup",
    summary: `Petty cash ${pre.pc.office}: top-up of RM${pre.amount.toFixed(2)} for ${ids.size} voucher(s) prepared as payment ${paymentId}.`,
    result: { paymentId, amount: pre.amount },
  };
}

/** A cancelled or returned-and-cancelled top-up frees its vouchers for the next top-up. */
export function finPettyFreeTopUp(
  f: FinStatus,
  paymentId: Id,
): FinPettyCash[] | undefined {
  if (
    !(f.pettyCash ?? []).some((p) =>
      p.topUps.some((t) => t.paymentId === paymentId),
    )
  )
    return undefined;
  return (f.pettyCash ?? []).map((p) => ({
    ...p,
    vouchers: p.vouchers.map((v) =>
      v.topUpId === paymentId ? { ...v, topUpId: null } : v,
    ),
    topUps: p.topUps.filter((t) => t.paymentId !== paymentId),
  }));
}

// ---------- Company cards ----------

/** Reads pasted card statement lines: date, merchant, amount (tab or comma separated; refunds as minus). */
export function parseCardLines(
  v: unknown,
): { date: IsoDate; merchant: string; amount: number }[] {
  if (Array.isArray(v))
    return v.slice(0, 500).map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        date: isoDate(o.date, `Line ${i + 1} date`),
        merchant: noSecrets(
          text(o.merchant, `Line ${i + 1} merchant`, 2, 120),
          "Merchant",
        ),
        amount: signed(o.amount, i),
      };
    });
  const rows = (typeof v === "string" ? v : "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!rows.length)
    throw new BadRequest("Paste the statement lines: date, merchant, amount.");
  return rows.slice(0, 500).map((l, i) => {
    const parts = (
      l.includes("\t") ? l.split("\t") : l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    ).map((s) => s.replace(/^"|"$/g, "").trim());
    if (parts.length < 3)
      throw new BadRequest(
        `Line ${i + 1}: date, merchant and amount are needed.`,
      );
    const amount = parts[parts.length - 1];
    return {
      date: isoDate(parts[0], `Line ${i + 1} date`),
      merchant: noSecrets(
        text(parts.slice(1, -1).join(" "), `Line ${i + 1} merchant`, 2, 120),
        "Merchant",
      ),
      amount: signed(amount, i),
    };
  });
}
function signed(v: unknown, i: number): number {
  const n =
    typeof v === "number"
      ? v
      : Number(String(v ?? "").replace(/[,\sRM]/gi, ""));
  if (!Number.isFinite(n) || n === 0)
    throw new BadRequest(`Line ${i + 1}: the amount is not a number.`);
  return round2(n);
}

const lineDone = (l: FinCardLine) => l.personal || (!!l.receipt && !!l.purpose);

export function finCardAction(
  ctx: FinCashCtx,
  f: FinStatus,
  action: string,
  input: Record<string, unknown>,
): Out<unknown> {
  const list = f.cards ?? [];
  const save = (n: FinCard) => ({
    cards: list.some((y) => y.id === n.id)
      ? list.map((y) => (y.id === n.id ? n : y))
      : [...list, n],
  });
  if (action === "add") {
    finance(ctx);
    const kind =
      input.kind === "fuel"
        ? "fuel"
        : input.kind === "credit"
          ? "credit"
          : null;
    if (!kind) throw new BadRequest("Type: credit card or fuel card.");
    const last4 = typeof input.last4 === "string" ? input.last4.trim() : "";
    if (!/^\d{4}$/.test(last4))
      throw new BadRequest("Give only the last 4 digits of the card.");
    const u =
      typeof input.holderId === "string"
        ? ctx.userById(input.holderId)
        : undefined;
    if (!u || left(u, ctx.today))
      throw new BadRequest("Choose the card holder's Prima account.");
    const issuer = noSecrets(
      text(input.issuer, "Bank or fuel company", 2, 80),
      "Issuer",
    );
    if (
      list.some(
        (c) =>
          c.status !== "cancelled" &&
          c.last4 === last4 &&
          norm(c.issuer) === norm(issuer),
      )
    )
      throw new BadRequest("This card is already on the list.");
    const c: FinCard = {
      id: `card-${f.companyId}-${String(list.length + 1).padStart(2, "0")}`,
      kind,
      issuer,
      last4,
      holderId: u.id,
      holder: u.name,
      limit: money(input.limit, "Card limit"),
      status: "pending",
      added: ctx.sign(),
      checked: null,
      statements: [],
    };
    return {
      patch: save(c),
      action: "finance.card.added",
      summary: `${kind === "fuel" ? "Fuel" : "Credit"} card ${issuer} ****${last4} for ${u.name}, limit RM${c.limit.toFixed(2)}. Waiting for a second person to check.`,
      result: c,
    };
  }
  const c = list.find((y) => y.id === input.cardId);
  if (!c) throw new NotFound("Card");
  const holder = c.holderId === ctx.user.id;
  if (action === "check") {
    needReviewer(ctx, "checks a company card");
    if (c.status !== "pending") throw new BadRequest("Nothing to check.");
    if (c.added.byId === ctx.user.id || holder)
      throw new AccessDenied(
        "view",
        "(someone other than whoever entered it and the holder checks it)",
      );
    const n: FinCard = {
      ...c,
      status: "active",
      checked: ctx.sign(
        text(
          input.comment,
          "What you checked it against (bank letter, card application)",
          5,
          300,
        ),
      ),
    };
    return {
      patch: save(n),
      action: "finance.card.checked",
      summary: `Card ${c.issuer} ****${c.last4} (${c.holder}) checked.`,
      result: n,
    };
  }
  if (action === "cancel") {
    finance(ctx);
    if (!ctx.senior)
      throw new AccessDenied(
        "view",
        "(the team leader, the Finance Director or the CEO cancels a card)",
      );
    const why = requireReason(input.comment, "cancel it");
    const n: FinCard = { ...c, status: "cancelled" };
    return {
      patch: save(n),
      action: "finance.card.cancelled",
      summary: `Card ${c.issuer} ****${c.last4} (${c.holder}) cancelled: ${why}`,
      result: n,
    };
  }
  if (c.status === "pending")
    throw new BadRequest("A second person checks the card first.");
  if (action === "statement") {
    finance(ctx);
    if (holder)
      throw new AccessDenied(
        "view",
        "(Finance loads the statement, not the holder)",
      );
    const period =
      typeof input.period === "string" && /^\d{4}-\d{2}$/.test(input.period)
        ? input.period
        : null;
    if (!period || period >= ctx.today.slice(0, 7))
      throw new BadRequest("Month must be a past month (YYYY-MM).");
    const old = c.statements.find((s) => s.period === period);
    if (old?.reviewed)
      throw new BadRequest(
        `The ${period} statement is reviewed; it is not replaced.`,
      );
    const lines = parseCardLines(input.lines);
    const total = money(input.total, "Statement total", true);
    const sum = round2(lines.reduce((n, l) => n + l.amount, 0));
    if (Math.abs(sum - total) >= 0.005)
      throw new BadRequest(
        `The lines add up to RM${sum.toFixed(2)}, not the RM${total.toFixed(2)} total. Check every line was pasted.`,
      );
    const st: FinCardStatement = {
      id: `${c.id}-${period}`,
      period,
      total,
      doc: docs(input.doc, "card statement")[0],
      lines: lines.map((l, i) => {
        // Lines already explained on a replaced statement keep their explanation.
        const was = old?.lines.find(
          (o) =>
            o.date === l.date &&
            o.amount === l.amount &&
            norm(o.merchant) === norm(l.merchant),
        );
        return was
          ? { ...was, id: `${c.id}-${period}-${i + 1}` }
          : {
              id: `${c.id}-${period}-${i + 1}`,
              ...l,
              receipt: null,
              purpose: null,
              personal: false,
              explained: null,
              recovered: null,
            };
      }),
      loaded: ctx.sign(),
      reviewed: null,
    };
    const n: FinCard = {
      ...c,
      statements: [...c.statements.filter((s) => s.period !== period), st].sort(
        (x, y) => x.period.localeCompare(y.period),
      ),
    };
    return {
      patch: save(n),
      action: "finance.card.statement",
      summary: `Card ${c.issuer} ****${c.last4} ${period} statement loaded: ${lines.length} line(s), RM${total.toFixed(2)}.`,
      result: st,
    };
  }
  const st = c.statements.find((s) => s.id === input.statementId);
  if (!st) throw new NotFound("Card statement");
  const saveSt = (s: FinCardStatement) =>
    save({
      ...c,
      statements: c.statements.map((x) => (x.id === s.id ? s : x)),
    });
  if (action === "explain") {
    // The holder explains each line. Finance can only mark a line personal (never give it a business purpose).
    if (!holder) finance(ctx);
    if (st.reviewed) throw new BadRequest("The statement is reviewed.");
    const l = st.lines.find((x) => x.id === input.lineId);
    if (!l) throw new NotFound("Card line");
    const personal = input.personal === true;
    if (!holder && !personal)
      throw new AccessDenied(
        "view",
        `(only the holder, ${c.holder}, gives the receipt and purpose)`,
      );
    const n: FinCardLine = personal
      ? {
          ...l,
          personal: true,
          receipt: l.receipt,
          purpose:
            typeof input.purpose === "string" && input.purpose.trim()
              ? input.purpose.trim().slice(0, 200)
              : "Personal",
          explained: ctx.sign(),
        }
      : {
          ...l,
          personal: false,
          receipt: docs(input.receipt, "receipt")[0],
          purpose: noSecrets(
            text(input.purpose, "What it was for", 3, 200),
            "Purpose",
          ),
          explained: ctx.sign(),
        };
    return {
      patch: saveSt({
        ...st,
        lines: st.lines.map((x) => (x.id === l.id ? n : x)),
      }),
      action: "finance.card.explained",
      summary: `Card ****${c.last4} ${st.period}: ${l.merchant} RM${l.amount.toFixed(2)} ${personal ? "marked personal (to be paid back)" : `for ${n.purpose}`}.`,
      result: n,
    };
  }
  if (action === "recover") {
    finance(ctx);
    if (holder)
      throw new AccessDenied(
        "view",
        "(Finance records the repayment, not the holder)",
      );
    const l = st.lines.find((x) => x.id === input.lineId);
    if (!l || !l.personal)
      throw new BadRequest("Only a personal line is paid back.");
    if (l.recovered) throw new BadRequest("Already recorded.");
    const how =
      input.how === "payroll"
        ? "payroll"
        : input.how === "repaid"
          ? "repaid"
          : null;
    if (!how)
      throw new BadRequest(
        "How it was paid back: deducted from salary (payroll) or repaid.",
      );
    const n: FinCardLine = {
      ...l,
      recovered: {
        ...ctx.sign(),
        how,
        ref: noSecrets(
          text(
            input.ref,
            how === "payroll" ? "Payroll month" : "Bank reference",
            3,
            80,
          ),
          "Reference",
        ),
      },
    };
    return {
      patch: saveSt({
        ...st,
        lines: st.lines.map((x) => (x.id === l.id ? n : x)),
      }),
      action: "finance.card.recovered",
      summary: `Card ****${c.last4}: personal ${l.merchant} RM${l.amount.toFixed(2)} paid back by ${how} (${n.recovered!.ref}).`,
      result: n,
    };
  }
  if (action === "review") {
    needReviewer(ctx, "reviews a card statement");
    if (holder)
      throw new AccessDenied(
        "view",
        "(the holder does not review their own card)",
      );
    if (st.reviewed) throw new BadRequest("Already reviewed.");
    const open = st.lines.filter((l) => l.amount > 0 && !lineDone(l));
    if (open.length)
      throw new BadRequest(
        `${open.length} line(s) have no receipt and purpose, and are not marked personal.`,
      );
    const comment = text(
      input.comment,
      "What you checked (receipts against the lines, business use)",
      5,
      300,
    );
    const n: FinCardStatement = { ...st, reviewed: ctx.sign(comment) };
    return {
      patch: saveSt(n),
      action: "finance.card.reviewed",
      summary: `Card ${c.issuer} ****${c.last4} (${c.holder}) ${st.period} statement reviewed: ${comment}`,
      result: n,
    };
  }
  throw new BadRequest("Unknown action.");
}

// ---------- Close, home and screens ----------

/** What keeps a month's close open: overdue advances, a float not counted or not agreeing, card statements not reviewed. */
export function finCashExceptions(
  f: FinStatus,
  period: string,
  today: IsoDate,
  s?: Partial<FinSettingsValues>,
): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const end = nextMonthDay(period, 0);
  for (const x of f.advances ?? [])
    if (
      x.status === "open" &&
      x.settleBy <= end &&
      finAdvanceOverdue(x, f, today)
    )
      out.push({
        key: `advance:${x.id}`,
        text: `Staff advance ${x.id} to ${x.name} RM${x.amount.toFixed(2)} was due to be settled by ${x.settleBy}`,
      });
  for (const pc of f.pettyCash ?? []) {
    if (
      pc.status !== "active" ||
      (pc.checked?.at.slice(0, 7) ?? "9999") > period
    )
      continue;
    const counts = pc.counts.filter(
      (k) =>
        k.on.slice(0, 7) === period ||
        k.on.slice(0, 7) === nextMonthDay(period, 1).slice(0, 7),
    );
    const last = counts
      .filter((k) => k.on <= nextMonthDay(period, s?.pettyCountByDay ?? R().pettyCountByDay))
      .slice(-1)[0];
    if (!last)
      out.push({
        key: `petty:${pc.id}:${period}`,
        text: `Petty cash ${pc.office} was not counted for ${period} (by someone other than ${pc.custodian})`,
      });
    else if (Math.abs(last.diff) >= 0.005)
      out.push({
        key: `petty:${pc.id}:${period}`,
        text: `Petty cash ${pc.office} count on ${last.on} was RM${last.diff.toFixed(2)} out (${last.comment})`,
      });
  }
  for (const c of f.cards ?? []) {
    if (c.status === "pending") continue;
    const st = c.statements.find((s) => s.period === period);
    if (!st) {
      if (
        c.status === "active" &&
        (c.checked?.at.slice(0, 7) ?? "9999") <= period
      )
        out.push({
          key: `card:${c.id}:${period}`,
          text: `Card ${c.issuer} ****${c.last4} (${c.holder}): the ${period} statement is not loaded`,
        });
      continue;
    }
    if (!st.reviewed)
      out.push({
        key: `card:${c.id}:${period}`,
        text: `Card ${c.issuer} ****${c.last4} (${c.holder}) ${period} statement is not reviewed`,
      });
    const unpaid = st.lines.filter((l) => l.personal && !l.recovered);
    if (unpaid.length)
      out.push({
        key: `cardpersonal:${c.id}:${period}`,
        text: `Card ****${c.last4} (${c.holder}): ${unpaid.length} personal line(s) RM${round2(unpaid.reduce((n, l) => n + l.amount, 0)).toFixed(2)} not paid back`,
      });
  }
  return out;
}

export function finCashHome(
  f: FinStatus,
  a: FinActor,
  ctx: Pick<FinCashCtx, "today" | "userById"> & { userId: Id },
) {
  const reviewer = isLead(a) || a.kind === "leader" || a.kind === "deputy";
  const c = {
    mandateMissing: 0,
    mandateIssues: [] as string[],
    mandateToCheck: 0,
    advOverdue: 0,
    advToCheck: 0,
    pettyToCheck: 0,
    pettyCount: 0,
    pettyTopUp: 0,
    cardToCheck: 0,
    cardToReview: 0,
    cardLoad: 0,
  };
  const today = ctx.today;
  const lastMonth = prevMonth(today.slice(0, 7));
  for (const b of f.banks) {
    const m = finMandateOf(f, b.id);
    if (!m) c.mandateMissing += 1;
    else
      for (const i of finMandateIssues(m, ctx))
        c.mandateIssues.push(`${b.bank} ${b.accountMasked}: ${i}`);
  }
  for (const m of f.mandates ?? [])
    if (m.status === "pending" && reviewer && m.added.byId !== ctx.userId)
      c.mandateToCheck += 1;
  for (const x of f.advances ?? []) {
    if (finAdvanceOverdue(x, f, today)) c.advOverdue += 1;
    if (
      x.status === "submitted" &&
      x.settlement?.byId !== ctx.userId &&
      x.userId !== ctx.userId
    )
      c.advToCheck += 1;
  }
  for (const pc of f.pettyCash ?? []) {
    if (
      pc.status === "pending" &&
      reviewer &&
      pc.added.byId !== ctx.userId &&
      pc.custodianId !== ctx.userId
    )
      c.pettyToCheck += 1;
    if (pc.status !== "active") continue;
    // The month's count is due from the 25th; one missing for last month shows until it is done.
    const countedThisMonth = pc.counts.some(
      (k) => k.on.slice(0, 7) === today.slice(0, 7),
    );
    const countedLastMonth = pc.counts.some((k) => k.on >= `${lastMonth}-01`);
    if (
      pc.custodianId !== ctx.userId &&
      ((!countedThisMonth && Number(today.slice(8)) >= 25) ||
        !countedLastMonth) &&
      (pc.checked?.at.slice(0, 7) ?? "9999") <= lastMonth
    )
      c.pettyCount += 1;
    const { waiting } = finPettyExpected(pc, f);
    if (waiting >= pc.float * 0.5 && pc.custodianId !== ctx.userId)
      c.pettyTopUp += 1;
  }
  for (const card of f.cards ?? []) {
    if (
      card.status === "pending" &&
      reviewer &&
      card.added.byId !== ctx.userId &&
      card.holderId !== ctx.userId
    )
      c.cardToCheck += 1;
    if (card.status !== "active") continue;
    if (
      !card.statements.some((s) => s.period === lastMonth) &&
      (card.checked?.at.slice(0, 7) ?? "9999") <= lastMonth
    )
      c.cardLoad += 1;
    if (reviewer && card.holderId !== ctx.userId)
      c.cardToReview += card.statements.filter(
        (s) =>
          !s.reviewed && s.lines.every((l) => l.amount <= 0 || lineDone(l)),
      ).length;
  }
  return c;
}

/** What one person (any staff member) has to do on their own advances, cards and float. */
export function finCashMine(f: FinStatus, userId: Id, today: IsoDate, s?: Partial<FinSettingsValues>) {
  const advances = (f.advances ?? [])
    .filter(
      (x) =>
        x.userId === userId &&
        x.status !== "recovered" &&
        !(
          x.status === "settled" &&
          daysBetween(x.checked?.at.slice(0, 10) ?? today, today) > 60
        ),
    )
    .map((x) => ({
      ...x,
      paid: (f.payments ?? []).some(
        (p) => p.id === x.paymentId && p.status === "released",
      ),
      overdue: finAdvanceOverdue(x, f, today),
    }));
  const cards = (f.cards ?? [])
    .filter((c) => c.holderId === userId && c.status === "active")
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      issuer: c.issuer,
      last4: c.last4,
      statements: c.statements.filter((s) => !s.reviewed),
      explainBy: (p: string) => nextMonthDay(p, s?.cardExplainByDay ?? R().cardExplainByDay),
    }))
    .map(({ explainBy, ...c }) => ({
      ...c,
      statements: c.statements.map((s) => ({
        ...s,
        explainBy: explainBy(s.period),
        open: s.lines.filter((l) => l.amount > 0 && !lineDone(l)).length,
      })),
    }));
  const petty = (f.pettyCash ?? [])
    .filter((p) => p.custodianId === userId && p.status === "active")
    .map((p) => ({
      id: p.id,
      office: p.office,
      float: p.float,
      ...finPettyExpected(p, f),
      max: R().pettyVoucherMax,
      vouchers: p.vouchers.slice(-20),
    }));
  return { companyId: f.companyId, advances, cards, petty };
}

export function finCashView(
  f: FinStatus,
  ctx: Pick<FinCashCtx, "today" | "userById">,
) {
  return {
    mandates: f.banks.map((b) => {
      const m = finMandateOf(f, b.id);
      return {
        bank: { id: b.id, bank: b.bank, accountMasked: b.accountMasked },
        inForce: m,
        issues: m
          ? finMandateIssues(m, ctx)
          : [
              "No checked mandate recorded yet: releases from this account are not checked against it",
            ],
        pending:
          (f.mandates ?? []).find(
            (x) => x.bankId === b.id && x.status === "pending",
          ) ?? null,
        history: (f.mandates ?? [])
          .filter(
            (x) =>
              x.bankId === b.id && ["replaced", "rejected"].includes(x.status),
          )
          .map((x) => ({
            id: x.id,
            version: x.version,
            status: x.status,
            checked: x.checked,
          })),
      };
    }),
    advances: [...(f.advances ?? [])]
      .reverse()
      .slice(0, 100)
      .map((x) => {
        const p = (f.payments ?? []).find((y) => y.id === x.paymentId);
        return {
          ...x,
          paymentStatus: p?.status ?? null,
          overdue: finAdvanceOverdue(x, f, ctx.today),
        };
      }),
    pettyCash: (f.pettyCash ?? []).map((p) => ({
      ...p,
      vouchers: p.vouchers.slice(-40),
      counts: p.counts.slice(-6),
      ...finPettyExpected(p, f),
    })),
    cards: (f.cards ?? []).map((c) => ({
      ...c,
      statements: c.statements
        .slice(-6)
        .map((s) => ({
          ...s,
          open: s.lines.filter((l) => l.amount > 0 && !lineDone(l)).length,
        })),
    })),
    rules: R(),
  };
}

// ---------- Duplicate supplier invoices across companies (suggestion 9) ----------

const sameSupplier = (
  x: { payee: string; payeeBank?: FinPayment["payeeBank"] },
  name: string,
  bank: { accountLast4: string; accountName: string } | null,
) =>
  norm(x.payee) === norm(name) ||
  (!!bank &&
    !!x.payeeBank &&
    x.payeeBank.accountLast4 === bank.accountLast4 &&
    norm(x.payeeBank.accountName) === norm(bank.accountName));

/**
 * Looks across every company's payments the person can see for the same supplier (same name, or the same bank account)
 * with the same invoice number (always refused), or the same amount within the duplicate window (refused unless the
 * preparer says why it is not a duplicate). Regular payments for different months of the same entry are not duplicates.
 */
export function finDuplicateAcross(
  rows: FinStatus[],
  p: {
    companyId: Id;
    payee: string;
    payeeId: Id;
    amount: number;
    dueOn: IsoDate;
    invoiceNo: string | null;
    regularId?: Id | null;
    regularPeriod?: string | null;
  },
  except: Id | null,
): { hard: string | null; soft: string | null } {
  const own = rows.find((f) => f.companyId === p.companyId);
  const payee = (own?.payees ?? []).find((x) => x.id === p.payeeId);
  const bank = payee
    ? { accountLast4: payee.accountLast4, accountName: payee.accountName }
    : null;
  const inv = p.invoiceNo ? norm(p.invoiceNo) : "";
  let hard: string | null = null;
  let soft: string | null = null;
  for (const f of rows)
    for (const x of f.payments ?? []) {
      if (x.id === except || x.status === "cancelled") continue;
      if (!sameSupplier(x, p.payee, bank)) continue;
      const where = f.companyId === p.companyId ? "" : ` in ${f.companyId}`;
      if (inv.length >= 3 && x.invoiceNo && norm(x.invoiceNo) === inv)
        hard ??= `Invoice ${p.invoiceNo} from ${p.payee} is already paid or being paid by ${x.id}${where} (${x.status}).`;
      if (
        p.regularId &&
        x.regularId === p.regularId &&
        x.regularPeriod !== p.regularPeriod
      )
        continue;
      if (
        Math.abs(x.amount - p.amount) < 0.005 &&
        Math.abs(daysBetween(x.dueOn, p.dueOn)) <= R().duplicateDays &&
        x.status !== "returned"
      )
        soft ??= `${x.id}${where} pays ${x.payee} the same RM${x.amount.toFixed(2)} (due ${x.dueOn}, ${x.status}${x.invoiceNo ? `, invoice ${x.invoiceNo}` : ""}).`;
    }
  return { hard, soft };
}