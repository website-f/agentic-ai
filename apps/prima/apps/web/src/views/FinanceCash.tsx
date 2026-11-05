import { useState } from "react";
import { api, type FinControls, type FinDesk } from "../api";
import { Chip, ErrorNotice, dateLabel, useAction, useLoad } from "../ui";

/**
 * Bank mandates, staff advances, petty cash and company cards (Fauzan, 2 Nov 2026: yes to suggestions 6, 7, 8 and 14).
 * Every entry is checked by a second person; staff explain their own advance, card lines and petty cash vouchers from
 * My work. The server enforces who may do each step; this screen only offers them.
 */

type Co = FinDesk["companies"][number];
type Cash = FinControls["cash"];
const rm = (n: number | null | undefined) =>
  n == null
    ? "–"
    : `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ROLE: Record<string, string> = {
  signatory: "Cheque signatory",
  portal_maker: "Bank portal maker",
  portal_approver: "Bank portal approver",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function useGo(companyId: string) {
  const act = useAction();
  const go = (
    area: "mandates" | "advances" | "petty" | "cards",
    action: string,
    input: Record<string, unknown>,
    msg: string,
  ) => act.run(() => api.finControlAction(companyId, area, action, input), msg);
  return { act, go };
}
function Ask({
  label,
  button,
  onGo,
  min = 5,
}: {
  label: string;
  button: string;
  onGo: (text: string) => void;
  min?: number;
}) {
  const [t, setT] = useState("");
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <input
        className="input"
        style={{ flex: 1, minWidth: 180 }}
        placeholder={label}
        value={t}
        onChange={(e) => setT(e.target.value)}
      />
      <button
        className="btn btn-sm"
        disabled={t.trim().length < min}
        onClick={() => onGo(t)}
      >
        {button}
      </button>
    </div>
  );
}
function People({
  cash,
  value,
  onChange,
}: {
  cash: Cash;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose</option>
      {cash.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {p.title}
        </option>
      ))}
    </select>
  );
}
const banks = (v: FinControls) => v.statements.map((s) => s.bank);

// ---------- Bank mandates ----------

export function Mandates({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useGo(v.companyId);
  const [adding, setAdding] = useState<string | null>(null);
  const [f, setF] = useState<{
    rule: string;
    twoAbove: string;
    docs: string;
    people: { userId: string; name: string; role: string; limit: string }[];
  }>({
    rule: "any_one",
    twoAbove: "",
    docs: "",
    people: [{ userId: "", name: "", role: "portal_approver", limit: "" }],
  });
  const setP = (i: number, k: string, val: string) =>
    setF((x) => ({
      ...x,
      people: x.people.map((p, j) => (j === i ? { ...p, [k]: val } : p)),
    }));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Bank mandates: who signs and approves</h3>
      </div>
      <p className="muted small" style={{ padding: "0 12px" }}>
        Record each account's mandate as the bank holds it (board resolution and
        mandate form). A second person checks it. Once checked, whoever records
        a release must be on it, and the second approver is named when the bank
        needs two. Reviewed every year and whenever someone on it leaves.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {v.cash.mandates.map((m) => (
          <div
            key={m.bank.id}
            className="list-item"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
          >
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <strong>
                {m.bank.bank} {m.bank.accountMasked}
              </strong>
              <span className="row" style={{ gap: 4 }}>
                {m.inForce ? (
                  <Chip tone={m.issues.length ? "crit" : "ok"}>
                    {m.issues.length
                      ? "Review needed"
                      : `In force (v${m.inForce.version})`}
                  </Chip>
                ) : (
                  <Chip tone="warn">No mandate recorded</Chip>
                )}
                {m.pending && (
                  <Chip tone="warn">New version waiting for check</Chip>
                )}
              </span>
            </div>
            {m.inForce && (
              <div className="muted small">
                {m.inForce.rule === "any_two"
                  ? "Any two together"
                  : `Any one${m.inForce.twoAbove != null ? `, two above ${rm(m.inForce.twoAbove)}` : ""}`}{" "}
                ·{" "}
                {m.inForce.people
                  .map(
                    (p) =>
                      `${p.name} (${ROLE[p.role]}${p.limit != null ? ` up to ${rm(p.limit)}` : ""})`,
                  )
                  .join(", ")}{" "}
                · last confirmed{" "}
                {dateLabel(
                  (
                    m.inForce.reviewed?.at ??
                    m.inForce.checked?.at ??
                    m.inForce.added.at
                  ).slice(0, 10),
                )}
              </div>
            )}
            {m.issues.map((i) => (
              <div
                key={i}
                className="notice"
                data-tone={m.inForce ? "crit" : "info"}
              >
                {i}
              </div>
            ))}
            {m.pending && co.canAct && (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="small">
                  Waiting:{" "}
                  {m.pending.people
                    .map((p) => `${p.name} (${ROLE[p.role]})`)
                    .join(", ")}{" "}
                  · entered by {m.pending.added.by} ·{" "}
                  {m.pending.docs.join(", ")}
                </div>
                <Ask
                  label="What you checked it against (bank confirmation, board resolution)"
                  button="Check"
                  onGo={(t) =>
                    go(
                      "mandates",
                      "check",
                      { mandateId: m.pending!.id, comment: t },
                      "Mandate checked and in force.",
                    )
                  }
                />
                <Ask
                  label="Why it is wrong"
                  button="Reject"
                  min={10}
                  onGo={(t) =>
                    go(
                      "mandates",
                      "check",
                      {
                        mandateId: m.pending!.id,
                        decision: "reject",
                        comment: t,
                      },
                      "Mandate rejected.",
                    )
                  }
                />
              </div>
            )}
            {m.inForce && co.canAct && !m.pending && (
              <Ask
                label="What the bank confirmed (letter, portal user list, date)"
                button="Confirmed with the bank"
                onGo={(t) =>
                  go(
                    "mandates",
                    "review",
                    { mandateId: m.inForce!.id, comment: t },
                    "Recorded.",
                  )
                }
              />
            )}
            {co.canAct && !m.pending && (
              <button
                className="btn btn-sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() =>
                  setAdding(adding === m.bank.id ? null : m.bank.id)
                }
              >
                {adding === m.bank.id
                  ? "Close"
                  : m.inForce
                    ? "Record a new mandate"
                    : "Record the mandate"}
              </button>
            )}
            {adding === m.bank.id && (
              <div style={{ display: "grid", gap: 6 }}>
                <Field label="What the bank needs">
                  <select
                    className="select"
                    value={f.rule}
                    onChange={(e) =>
                      setF((x) => ({ ...x, rule: e.target.value }))
                    }
                  >
                    <option value="any_one">Any one approver</option>
                    <option value="any_two">Any two together</option>
                  </select>
                </Field>
                {f.rule === "any_one" && (
                  <Field label="Two approvers needed above (RM, blank if never)">
                    <input
                      className="input"
                      inputMode="decimal"
                      value={f.twoAbove}
                      onChange={(e) =>
                        setF((x) => ({ ...x, twoAbove: e.target.value }))
                      }
                    />
                  </Field>
                )}
                {f.people.map((p, i) => (
                  <div
                    key={i}
                    className="row"
                    style={{ gap: 6, flexWrap: "wrap" }}
                  >
                    <People
                      cash={v.cash}
                      value={p.userId}
                      onChange={(val) => setP(i, "userId", val)}
                    />
                    {!p.userId && (
                      <input
                        className="input"
                        placeholder="Or name (outside director)"
                        value={p.name}
                        onChange={(e) => setP(i, "name", e.target.value)}
                      />
                    )}
                    <select
                      className="select"
                      value={p.role}
                      onChange={(e) => setP(i, "role", e.target.value)}
                    >
                      {Object.entries(ROLE).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      style={{ width: 140 }}
                      placeholder="Own limit RM"
                      inputMode="decimal"
                      value={p.limit}
                      onChange={(e) => setP(i, "limit", e.target.value)}
                    />
                  </div>
                ))}
                <button
                  className="btn btn-sm"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() =>
                    setF((x) => ({
                      ...x,
                      people: [
                        ...x.people,
                        {
                          userId: "",
                          name: "",
                          role: "portal_approver",
                          limit: "",
                        },
                      ],
                    }))
                  }
                >
                  Add a person
                </button>
                <Field label="Board resolution and bank mandate form, one per line">
                  <textarea
                    className="textarea"
                    rows={2}
                    value={f.docs}
                    onChange={(e) =>
                      setF((x) => ({ ...x, docs: e.target.value }))
                    }
                  />
                </Field>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={async () => {
                    const r = await go(
                      "mandates",
                      "add",
                      {
                        bankId: m.bank.id,
                        rule: f.rule,
                        twoAbove: f.twoAbove,
                        people: f.people.map((p) => ({
                          userId: p.userId || null,
                          name: p.name,
                          role: p.role,
                          limit: p.limit,
                        })),
                        docs: f.docs
                          .split("\n")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      },
                      "Saved. A second person checks it next.",
                    );
                    if (r) setAdding(null);
                  }}
                >
                  Save for checking
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Staff cash advances ----------

export function Advances({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useGo(v.companyId);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const STATUS: Record<
    string,
    ["ok" | "warn" | "crit" | "info" | "neutral", string]
  > = {
    open: ["info", "Not settled"],
    submitted: ["warn", "Settlement to check"],
    settled: ["ok", "Settled"],
    recovered: ["neutral", "Recovered"],
    cancelled: ["neutral", "Cancelled"],
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Staff cash advances</h3>
        {co.canAct && (
          <button className="btn btn-sm" onClick={() => setAdding((x) => !x)}>
            {adding ? "Close" : "New advance"}
          </button>
        )}
      </div>
      <p className="muted small" style={{ padding: "0 12px" }}>
        Paid as a normal payment (review and approval as usual). The staff
        member settles with receipts by the settle-by date (
        {v.cash.rules.advanceSettleDays} days unless set), from My work; someone
        else checks. Overdue ones show to Finance and HR, and nobody gets a new
        advance while one is overdue.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div style={{ padding: 12, display: "grid", gap: 6 }}>
          <Field label="Staff member as a payee (verified)">
            <select
              className="select"
              value={f.payeeId ?? ""}
              onChange={set("payeeId")}
            >
              <option value="">Choose</option>
              {v.payees
                .filter((p) => p.kind === "payroll" || p.kind === "other")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Their Prima account (so they can settle it from My work)">
            <People
              cash={v.cash}
              value={f.userId ?? ""}
              onChange={(val) => setF((x) => ({ ...x, userId: val }))}
            />
          </Field>
          <Field label="What it is for">
            <input
              className="input"
              value={f.purpose ?? ""}
              onChange={set("purpose")}
            />
          </Field>
          <Field label="Amount (RM)">
            <input
              className="input"
              inputMode="decimal"
              value={f.amount ?? ""}
              onChange={set("amount")}
            />
          </Field>
          <Field
            label={`Settle by (blank = ${v.cash.rules.advanceSettleDays} days)`}
          >
            <input
              className="input"
              type="date"
              value={f.settleBy ?? ""}
              onChange={set("settleBy")}
            />
          </Field>
          <Field label="Pay from">
            <select
              className="select"
              value={f.bankId ?? ""}
              onChange={set("bankId")}
            >
              <option value="">Choose</option>
              {banks(v).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bank} {b.accountMasked}
                </option>
              ))}
            </select>
          </Field>
          <Field label="SQL Account document number">
            <input
              className="input"
              value={f.sqlRef ?? ""}
              onChange={set("sqlRef")}
            />
          </Field>
          <Field label="Advance form and approval, one per line">
            <textarea
              className="textarea"
              rows={2}
              value={f.evidence ?? ""}
              onChange={set("evidence")}
            />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              const r = await go(
                "advances",
                "add",
                {
                  ...f,
                  userId: f.userId || null,
                  amount: Number(f.amount),
                  evidence: (f.evidence ?? "")
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
                "Advance recorded and its payment prepared for review.",
              );
              if (r) setAdding(false);
            }}
          >
            Prepare the advance
          </button>
        </div>
      )}
      <div className="list">
        {v.cash.advances.length === 0 && (
          <div className="empty">No advances.</div>
        )}
        {v.cash.advances.map((x) => (
          <div
            key={x.id}
            className="list-item"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
          >
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span>
                <strong>{x.name}</strong> · {rm(x.amount)} · {x.purpose}
              </span>
              <span className="row" style={{ gap: 4 }}>
                {x.overdue && <Chip tone="crit">Overdue</Chip>}
                <Chip tone={STATUS[x.status][0]}>{STATUS[x.status][1]}</Chip>
              </span>
            </div>
            <div className="muted small">
              Settle by {dateLabel(x.settleBy)} · payment {x.paymentId} (
              {x.paymentStatus ?? "–"})
              {x.settlement &&
                ` · spent ${rm(x.settlement.spent)} (${x.settlement.receipts.length} receipt(s)), paid back ${rm(x.settlement.returned)}${x.settlement.returnRef ? ` (${x.settlement.returnRef})` : ""}${x.settlement.extra ? `, ${rm(x.settlement.extra)} more to claim` : ""}`}
              {x.checked &&
                ` · checked by ${x.checked.by}: ${x.checked.comment}`}
              {x.recovered &&
                ` · ${x.recovered.how.replace("_", " ")} (${x.recovered.ref}) by ${x.recovered.by}`}
            </div>
            {x.status === "submitted" && co.canAct && (
              <>
                <Ask
                  label="What you checked (receipts, cash seen in the bank)"
                  button="Check"
                  onGo={(t) =>
                    go(
                      "advances",
                      "check",
                      { advanceId: x.id, comment: t },
                      "Settlement checked.",
                    )
                  }
                />
                <Ask
                  label="What is wrong"
                  button="Return"
                  min={10}
                  onGo={(t) =>
                    go(
                      "advances",
                      "check",
                      { advanceId: x.id, decision: "return", comment: t },
                      "Returned to the staff member.",
                    )
                  }
                />
              </>
            )}
            {x.overdue && co.canAct && (
              <Recover
                onGo={(input) =>
                  go(
                    "advances",
                    "recover",
                    { advanceId: x.id, ...input },
                    "Recorded.",
                  )
                }
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Recover({ onGo }: { onGo: (input: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ how: "payroll", ref: "", comment: "" });
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <select
        className="select"
        value={f.how}
        onChange={(e) => setF((x) => ({ ...x, how: e.target.value }))}
      >
        <option value="payroll">Deduct from salary</option>
        <option value="repaid">Repaid</option>
        <option value="written_off">Write off (Finance Director or CEO)</option>
      </select>
      <input
        className="input"
        placeholder="Payroll month, bank ref or approval"
        value={f.ref}
        onChange={(e) => setF((x) => ({ ...x, ref: e.target.value }))}
      />
      <input
        className="input"
        placeholder="Why (at least 10 characters)"
        value={f.comment}
        onChange={(e) => setF((x) => ({ ...x, comment: e.target.value }))}
      />
      <button
        className="btn btn-sm"
        disabled={f.comment.trim().length < 10 || f.ref.trim().length < 3}
        onClick={() => onGo(f)}
      >
        Record
      </button>
    </div>
  );
}

// ---------- Petty cash ----------

export function PettyCash({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useGo(v.companyId);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [cash, setCash] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Petty cash</h3>
        {co.canAct && (
          <button className="btn btn-sm" onClick={() => setAdding((x) => !x)}>
            {adding ? "Close" : "New float"}
          </button>
        )}
      </div>
      <p className="muted small" style={{ padding: "0 12px" }}>
        One float per office, kept by one custodian who records each voucher
        with its receipt (up to {rm(v.cash.rules.pettyVoucherMax)}) from My
        work. The top-up is a normal payment for exactly the vouchers spent.
        Someone other than the custodian counts the cash every month.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div style={{ padding: 12, display: "grid", gap: 6 }}>
          <Field label="Office">
            <input
              className="input"
              value={f.office ?? ""}
              onChange={set("office")}
            />
          </Field>
          <Field label="Custodian">
            <People
              cash={v.cash}
              value={f.custodianId ?? ""}
              onChange={(val) => setF((x) => ({ ...x, custodianId: val }))}
            />
          </Field>
          <Field label="Custodian as a payee (top-ups are paid to them)">
            <select
              className="select"
              value={f.payeeId ?? ""}
              onChange={set("payeeId")}
            >
              <option value="">Choose</option>
              {v.payees
                .filter((p) => p.kind === "payroll" || p.kind === "other")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Top-ups paid from">
            <select
              className="select"
              value={f.bankId ?? ""}
              onChange={set("bankId")}
            >
              <option value="">Choose</option>
              {banks(v).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bank} {b.accountMasked}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`Float (RM, at most ${rm(v.cash.rules.pettyFloatMax)})`}
          >
            <input
              className="input"
              inputMode="decimal"
              value={f.float ?? ""}
              onChange={set("float")}
            />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              const r = await go(
                "petty",
                "add",
                { ...f, float: Number(f.float) },
                "Saved. A second person checks it next.",
              );
              if (r) setAdding(false);
            }}
          >
            Save for checking
          </button>
        </div>
      )}
      <div className="list">
        {v.cash.pettyCash.length === 0 && (
          <div className="empty">No petty cash.</div>
        )}
        {v.cash.pettyCash.map((p) => {
          const last = p.counts[p.counts.length - 1];
          return (
            <div
              key={p.id}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  <strong>{p.office}</strong> · kept by {p.custodian} · float{" "}
                  {rm(p.float)}
                </span>
                <Chip
                  tone={
                    p.status === "active"
                      ? "ok"
                      : p.status === "pending"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {p.status === "pending" ? "To check" : p.status}
                </Chip>
              </div>
              <div className="muted small">
                Should be in the box: {rm(p.expected)} · vouchers waiting for a
                top-up: {rm(p.waiting)}
                {last
                  ? ` · last count ${dateLabel(last.on)} by ${last.by}: ${rm(last.cash)}${last.diff ? ` (${rm(last.diff)} out: ${last.comment})` : ", agreed"}`
                  : " · not counted yet"}
              </div>
              {p.status === "pending" && co.canAct && (
                <Ask
                  label="What you checked"
                  button="Check"
                  onGo={(t) =>
                    go(
                      "petty",
                      "check",
                      { pettyId: p.id, comment: t },
                      "Float checked.",
                    )
                  }
                />
              )}
              {p.status === "active" && co.canAct && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    style={{ width: 130 }}
                    inputMode="decimal"
                    placeholder="Cash counted RM"
                    value={cash[p.id] ?? ""}
                    onChange={(e) =>
                      setCash((x) => ({ ...x, [p.id]: e.target.value }))
                    }
                  />
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 160 }}
                    placeholder="Why it differs (if it does)"
                    value={why[p.id] ?? ""}
                    onChange={(e) =>
                      setWhy((x) => ({ ...x, [p.id]: e.target.value }))
                    }
                  />
                  <button
                    className="btn btn-sm"
                    disabled={!cash[p.id]}
                    onClick={() =>
                      go(
                        "petty",
                        "count",
                        {
                          pettyId: p.id,
                          cash: Number(cash[p.id]),
                          comment: why[p.id],
                        },
                        "Count recorded.",
                      )
                    }
                  >
                    Record count
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={!p.waiting || act.busy}
                    onClick={() =>
                      go(
                        "petty",
                        "topup",
                        { pettyId: p.id },
                        "Top-up prepared as a payment for review.",
                      )
                    }
                  >
                    Prepare top-up {p.waiting ? rm(p.waiting) : ""}
                  </button>
                </div>
              )}
              {p.vouchers.length > 0 && (
                <details>
                  <summary className="small">
                    Vouchers ({p.vouchers.length})
                  </summary>
                  {p.vouchers.map((x) => (
                    <div key={x.id} className="small">
                      {dateLabel(x.date)} · {rm(x.amount)} · {x.purpose} ·{" "}
                      {x.receipt}{" "}
                      {x.topUpId ? `· topped up by ${x.topUpId}` : ""}
                    </div>
                  ))}
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Company cards ----------

export function Cards({ v, co }: { v: FinControls; co: Co }) {
  const { act, go } = useGo(v.companyId);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({ kind: "credit" });
  const [st, setSt] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Company credit and fuel cards</h3>
        {co.canAct && (
          <button className="btn btn-sm" onClick={() => setAdding((x) => !x)}>
            {adding ? "Close" : "Add card"}
          </button>
        )}
      </div>
      <p className="muted small" style={{ padding: "0 12px" }}>
        Finance loads each month's statement. The holder gives a receipt and
        purpose for every line, or marks it personal, from My work. Personal use
        is paid back. Someone other than the holder reviews the statement before
        the close.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div style={{ padding: 12, display: "grid", gap: 6 }}>
          <Field label="Type">
            <select className="select" value={f.kind} onChange={set("kind")}>
              <option value="credit">Credit card</option>
              <option value="fuel">Fuel card</option>
            </select>
          </Field>
          <Field label="Bank or fuel company">
            <input
              className="input"
              value={f.issuer ?? ""}
              onChange={set("issuer")}
            />
          </Field>
          <Field label="Last 4 digits only">
            <input
              className="input"
              inputMode="numeric"
              maxLength={4}
              value={f.last4 ?? ""}
              onChange={set("last4")}
            />
          </Field>
          <Field label="Holder">
            <People
              cash={v.cash}
              value={f.holderId ?? ""}
              onChange={(val) => setF((x) => ({ ...x, holderId: val }))}
            />
          </Field>
          <Field label="Card limit (RM)">
            <input
              className="input"
              inputMode="decimal"
              value={f.limit ?? ""}
              onChange={set("limit")}
            />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              const r = await go(
                "cards",
                "add",
                { ...f, limit: Number(f.limit) },
                "Saved. A second person checks it next.",
              );
              if (r) setAdding(false);
            }}
          >
            Save for checking
          </button>
        </div>
      )}
      <div className="list">
        {v.cash.cards.length === 0 && <div className="empty">No cards.</div>}
        {v.cash.cards.map((c) => (
          <div
            key={c.id}
            className="list-item"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
          >
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span>
                <strong>
                  {c.issuer} ****{c.last4}
                </strong>{" "}
                · {c.kind} · {c.holder} · limit {rm(c.limit)}
              </span>
              <Chip
                tone={
                  c.status === "active"
                    ? "ok"
                    : c.status === "pending"
                      ? "warn"
                      : "neutral"
                }
              >
                {c.status === "pending" ? "To check" : c.status}
              </Chip>
            </div>
            {c.status === "pending" && co.canAct && (
              <Ask
                label="What you checked it against (bank letter, card application)"
                button="Check"
                onGo={(t) =>
                  go(
                    "cards",
                    "check",
                    { cardId: c.id, comment: t },
                    "Card checked.",
                  )
                }
              />
            )}
            {c.statements.map((s) => (
              <div
                key={s.id}
                style={{
                  borderTop: "1px solid var(--line, #ddd)",
                  paddingTop: 6,
                }}
              >
                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span className="small">
                    {s.period} · {rm(s.total)} · {s.lines.length} line(s)
                  </span>
                  <Chip tone={s.reviewed ? "ok" : s.open ? "warn" : "info"}>
                    {s.reviewed
                      ? `Reviewed by ${s.reviewed.by}`
                      : s.open
                        ? `${s.open} line(s) for the holder to explain`
                        : "Ready for review"}
                  </Chip>
                </div>
                {s.lines.map((l) => (
                  <div
                    key={l.id}
                    className="small row"
                    style={{
                      gap: 6,
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>
                      {dateLabel(l.date)} · {l.merchant} · {rm(l.amount)} ·{" "}
                      {l.personal
                        ? `personal${l.recovered ? `, paid back (${l.recovered.how}, ${l.recovered.ref})` : ", not paid back yet"}`
                        : l.purpose
                          ? `${l.purpose} (${l.receipt})`
                          : "not explained"}
                    </span>
                    {co.canAct && l.personal && !l.recovered && (
                      <RecoverLine
                        onGo={(input) =>
                          go(
                            "cards",
                            "recover",
                            {
                              cardId: c.id,
                              statementId: s.id,
                              lineId: l.id,
                              ...input,
                            },
                            "Recorded.",
                          )
                        }
                      />
                    )}
                  </div>
                ))}
                {!s.reviewed && !s.open && co.canAct && (
                  <Ask
                    label="What you checked (receipts against the lines)"
                    button="Review"
                    onGo={(t) =>
                      go(
                        "cards",
                        "review",
                        { cardId: c.id, statementId: s.id, comment: t },
                        "Statement reviewed.",
                      )
                    }
                  />
                )}
              </div>
            ))}
            {c.status === "active" && co.canAct && (
              <button
                className="btn btn-sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setLoading(loading === c.id ? null : c.id)}
              >
                {loading === c.id ? "Close" : "Load a statement"}
              </button>
            )}
            {loading === c.id && (
              <div style={{ display: "grid", gap: 6 }}>
                <Field label="Month (YYYY-MM)">
                  <input
                    className="input"
                    placeholder="2026-10"
                    value={st.period ?? ""}
                    onChange={(e) =>
                      setSt((x) => ({ ...x, period: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Statement total (RM)">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={st.total ?? ""}
                    onChange={(e) =>
                      setSt((x) => ({ ...x, total: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Statement file">
                  <input
                    className="input"
                    value={st.doc ?? ""}
                    onChange={(e) =>
                      setSt((x) => ({ ...x, doc: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Lines: date, merchant, amount (one per line; refunds as minus)">
                  <textarea
                    className="textarea"
                    rows={4}
                    value={st.lines ?? ""}
                    onChange={(e) =>
                      setSt((x) => ({ ...x, lines: e.target.value }))
                    }
                  />
                </Field>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={async () => {
                    const r = await go(
                      "cards",
                      "statement",
                      {
                        cardId: c.id,
                        period: st.period,
                        total: Number(st.total),
                        doc: st.doc,
                        lines: st.lines,
                      },
                      "Statement loaded. The holder explains each line next.",
                    );
                    if (r) setLoading(null);
                  }}
                >
                  Load
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RecoverLine({
  onGo,
}: {
  onGo: (input: Record<string, unknown>) => void;
}) {
  const [how, setHow] = useState("payroll");
  const [ref, setRef] = useState("");
  return (
    <span className="row" style={{ gap: 4 }}>
      <select
        className="select"
        value={how}
        onChange={(e) => setHow(e.target.value)}
      >
        <option value="payroll">From salary</option>
        <option value="repaid">Repaid</option>
      </select>
      <input
        className="input"
        style={{ width: 130 }}
        placeholder="Payroll month or ref"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
      />
      <button
        className="btn btn-sm"
        disabled={ref.trim().length < 3}
        onClick={() => onGo({ how, ref })}
      >
        Paid back
      </button>
    </span>
  );
}

// ---------- My work: my advances, cards and petty cash (anyone) ----------

export function MyCash() {
  const { data } = useLoad(() => api.finCashMine(), []);
  const act = useAction();
  if (!data || data.length === 0) return null;
  const go = (
    companyId: string,
    area: "advances" | "petty" | "cards",
    action: string,
    input: Record<string, unknown>,
    msg: string,
  ) => act.run(() => api.finControlAction(companyId, area, action, input), msg);
  return (
    <section className="panel">
      <h3>My advances, cards and petty cash</h3>
      <ErrorNotice error={act.error} />
      {data.map((row) => (
        <div key={row.companyId} className="list">
          {row.advances.map((x) => (
            <div
              key={x.id}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <div
                className="row"
                style={{ justifyContent: "space-between", gap: 6 }}
              >
                <span>
                  Advance {rm(x.amount)} · {x.purpose}
                </span>
                <Chip
                  tone={
                    x.overdue ? "crit" : x.status === "settled" ? "ok" : "info"
                  }
                >
                  {x.overdue
                    ? `Overdue since ${dateLabel(x.settleBy)}`
                    : x.status === "open"
                      ? `Settle by ${dateLabel(x.settleBy)}`
                      : x.status}
                </Chip>
              </div>
              {x.status === "open" && x.paid && (
                <SettleForm
                  amount={x.amount}
                  onGo={(input) =>
                    go(
                      row.companyId,
                      "advances",
                      "settle",
                      { advanceId: x.id, ...input },
                      "Sent to Finance to check.",
                    )
                  }
                />
              )}
            </div>
          ))}
          {row.petty.map((p) => (
            <div
              key={p.id}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <span>
                Petty cash {p.office}: {rm(p.expected)} should be in the box
                (float {rm(p.float)})
              </span>
              <VoucherForm
                max={p.max}
                onGo={(input) =>
                  go(
                    row.companyId,
                    "petty",
                    "voucher",
                    { pettyId: p.id, ...input },
                    "Voucher recorded.",
                  )
                }
              />
            </div>
          ))}
          {row.cards.flatMap((c) =>
            c.statements.map((s) => (
              <div
                key={s.id}
                className="list-item"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 6,
                }}
              >
                <span>
                  {c.issuer} ****{c.last4} {s.period}:{" "}
                  {s.open
                    ? `${s.open} line(s) to explain by ${dateLabel(s.explainBy)}`
                    : "all explained, waiting for review"}
                </span>
                {s.lines
                  .filter(
                    (l) =>
                      l.amount > 0 && !l.personal && !(l.receipt && l.purpose),
                  )
                  .map((l) => (
                    <CardLineForm
                      key={l.id}
                      label={`${dateLabel(l.date)} ${l.merchant} ${rm(l.amount)}`}
                      onGo={(input) =>
                        go(
                          row.companyId,
                          "cards",
                          "explain",
                          {
                            cardId: c.id,
                            statementId: s.id,
                            lineId: l.id,
                            ...input,
                          },
                          "Saved.",
                        )
                      }
                    />
                  ))}
              </div>
            )),
          )}
        </div>
      ))}
    </section>
  );
}

function SettleForm({
  amount,
  onGo,
}: {
  amount: number;
  onGo: (input: Record<string, unknown>) => void;
}) {
  const [f, setF] = useState({
    spent: "",
    returned: "",
    returnRef: "",
    receipts: "",
  });
  const spent = Number(f.spent || 0);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ width: 130 }}
          inputMode="decimal"
          placeholder="Spent RM"
          value={f.spent}
          onChange={(e) =>
            setF((x) => ({
              ...x,
              spent: e.target.value,
              returned:
                Number(e.target.value) <= amount
                  ? String(
                      Math.round((amount - Number(e.target.value || 0)) * 100) /
                        100,
                    )
                  : "0",
            }))
          }
        />
        <input
          className="input"
          style={{ width: 130 }}
          inputMode="decimal"
          placeholder="Paid back RM"
          value={f.returned}
          onChange={(e) => setF((x) => ({ ...x, returned: e.target.value }))}
        />
        {Number(f.returned) > 0 && (
          <input
            className="input"
            placeholder="Bank ref or receipt no. for the cash paid back"
            value={f.returnRef}
            onChange={(e) => setF((x) => ({ ...x, returnRef: e.target.value }))}
          />
        )}
      </div>
      <textarea
        className="textarea"
        rows={2}
        placeholder="Receipts, one per line"
        value={f.receipts}
        onChange={(e) => setF((x) => ({ ...x, receipts: e.target.value }))}
      />
      {spent > amount && (
        <div className="muted small">
          You spent {rm(spent - amount)} more than the advance: claim it as a
          normal staff claim after Finance checks this.
        </div>
      )}
      <button
        className="btn btn-sm btn-primary"
        style={{ alignSelf: "flex-start" }}
        disabled={!f.spent}
        onClick={() =>
          onGo({
            spent: Number(f.spent),
            returned: Number(f.returned || 0),
            returnRef: f.returnRef,
            receipts: f.receipts
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          })
        }
      >
        Settle
      </button>
    </div>
  );
}

function VoucherForm({
  max,
  onGo,
}: {
  max: number;
  onGo: (input: Record<string, unknown>) => void;
}) {
  const [f, setF] = useState({ amount: "", purpose: "", receipt: "" });
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <input
        className="input"
        style={{ width: 110 }}
        inputMode="decimal"
        placeholder={`RM (max ${max})`}
        value={f.amount}
        onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))}
      />
      <input
        className="input"
        placeholder="What for"
        value={f.purpose}
        onChange={(e) => setF((x) => ({ ...x, purpose: e.target.value }))}
      />
      <input
        className="input"
        placeholder="Receipt (file or number)"
        value={f.receipt}
        onChange={(e) => setF((x) => ({ ...x, receipt: e.target.value }))}
      />
      <button
        className="btn btn-sm"
        disabled={!f.amount || !f.receipt || !f.purpose}
        onClick={() =>
          onGo({
            amount: Number(f.amount),
            purpose: f.purpose,
            receipt: f.receipt,
          })
        }
      >
        Record voucher
      </button>
    </div>
  );
}

function CardLineForm({
  label,
  onGo,
}: {
  label: string;
  onGo: (input: Record<string, unknown>) => void;
}) {
  const [f, setF] = useState({ receipt: "", purpose: "" });
  return (
    <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
      <span style={{ minWidth: 160 }}>{label}</span>
      <input
        className="input"
        placeholder="Receipt"
        value={f.receipt}
        onChange={(e) => setF((x) => ({ ...x, receipt: e.target.value }))}
      />
      <input
        className="input"
        placeholder="Business purpose"
        value={f.purpose}
        onChange={(e) => setF((x) => ({ ...x, purpose: e.target.value }))}
      />
      <button
        className="btn btn-sm"
        disabled={!f.receipt || f.purpose.trim().length < 3}
        onClick={() => onGo(f)}
      >
        Save
      </button>
      <button
        className="btn btn-sm"
        onClick={() =>
          onGo({ personal: true, purpose: "Personal, I will pay it back" })
        }
      >
        It was personal
      </button>
    </div>
  );
}

/** Overdue staff advances across the companies, for HR (Fauzan, 2 Nov 2026: unsettled ones shown to HR and Finance). */
export function AdvancesOverdue() {
  const { data } = useLoad(() => api.finAdvancesOverdue().catch(() => []), []);
  if (!data || data.length === 0) return null;
  return (
    <section className="panel">
      <h3>Staff advances not settled</h3>
      <p className="muted small" style={{ padding: "0 12px" }}>
        Past the settle-by date with no receipts. Finance chases them; a
        recovery from salary is recorded by Finance and shows on the payroll
        line.
      </p>
      <div className="list">
        {data.map((x) => (
          <div key={x.id} className="list-item">
            <span>
              {x.name} · {rm(x.amount)} · {x.purpose}
            </span>
            <Chip tone="crit">{x.days} day(s) overdue</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}
