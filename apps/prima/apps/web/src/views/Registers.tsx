import { Select } from '../SearchSelect';
import { useState } from "react";
import {
  COMMITTEE_KIND_LABEL,
  INTEREST_KIND_LABEL,
  RISK_CATEGORY_LABEL,
  RPT_NATURE_LABEL,
  RPT_PARTY_LABEL,
  type CommitteeKind,
  type InterestKind,
  type RiskCategory,
  type RptNature,
  type RptParty,
  type RptStatus,
} from "@prima/core";
import { api, type RegBoard } from "../api";
import {
  Chip,
  ErrorNotice,
  Kpi,
  Loading,
  dateLabel,
  useAction,
  useLoad,
} from "../ui";

/**
 * Governance registers (Fauzan, 5 Nov 2026). The group does not list, but keeps four light registers the way a listed
 * group would. Related-party deals and directors' declarations: the Deputy Chief of Staff records, the Chief of Staff
 * reviews, only they and the CEO see them. Committees: each company keeps its own. Risks: ACT only; the ACT Director
 * runs them and gives work to the team. Each person sees only the registers that are theirs.
 */

type Tab = "deals" | "interests" | "committees" | "risks";
type Deals = NonNullable<RegBoard["deals"]>;
type Interests = NonNullable<RegBoard["interests"]>;
type Committees = NonNullable<RegBoard["committees"]>;
type Risks = NonNullable<RegBoard["risks"]>;
type DealRow = Deals["rows"][number];
type RiskRow = Risks["rows"][number];
type Company = { id: string; name: string };

const DEAL_STATUS: Record<
  RptStatus,
  ["warn" | "info" | "crit" | "ok", string]
> = {
  awaiting_review: ["warn", "Waiting for the Chief of Staff"],
  questioned: ["crit", "The Chief of Staff asked a question"],
  board_needed: ["warn", "Board resolution needed"],
  done: ["ok", "Recorded and reviewed"],
  not_agreed: ["info", "Dropped"],
};
const STATE: Record<
  "unknown" | "overdue" | "due_soon" | "ok",
  ["warn" | "crit" | "ok" | "info", string]
> = {
  unknown: ["warn", "Unknown"],
  overdue: ["crit", "Overdue"],
  due_soon: ["warn", "Due soon"],
  ok: ["ok", "Up to date"],
};
const LEVEL: Record<
  "high" | "medium" | "low",
  ["crit" | "warn" | "ok", string]
> = { high: ["crit", "High"], medium: ["warn", "Medium"], low: ["ok", "Low"] };
const rm = (n: number) => `RM${n.toLocaleString("en-MY")}`;
const col = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 8,
} as const;
const line = {
  flexDirection: "column",
  alignItems: "stretch",
  gap: 4,
} as const;
const head = {
  justifyContent: "space-between",
  gap: 6,
  flexWrap: "wrap",
} as const;

export function RegistersView() {
  const { data, error } = useLoad(() => api.registerBoard(), []);
  const [pick, setPick] = useState<Tab | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="governance registers" />;
  const tabs = (
    [
      ["deals", "Related-party deals", !!data.deals],
      ["interests", "Directors' interests", !!data.interests],
      ["committees", "Committees", !!data.committees],
      ["risks", "Risks", !!data.risks],
    ] as [Tab, string, boolean][]
  ).filter(([, , ok]) => ok);
  const tab = pick && tabs.some(([t]) => t === pick) ? pick : tabs[0]?.[0];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Governance registers</h1>
        <p className="muted">
          Simple registers a well-run group keeps. You see only the registers
          that are yours. Prima records and reminds; it never approves for the
          board.
        </p>
        <p className="notice" data-tone="info">
          Test data.
        </p>
      </div>
      <div className="kpis">
        {data.deals && (
          <Kpi
            label={
              data.deals.role === "review"
                ? "Deals for you to review"
                : "Related-party deals open"
            }
            value={
              data.deals.role === "review"
                ? data.deals.toReview
                : data.deals.open
            }
            tone={
              (
                data.deals.role === "review"
                  ? data.deals.toReview
                  : data.deals.open
              )
                ? "warn"
                : "ok"
            }
          />
        )}
        {data.deals && (
          <Kpi
            label="Related-party deals this year"
            value={rm(data.deals.valueThisYear)}
          />
        )}
        {data.interests && (
          <Kpi
            label="Declarations due or missing"
            value={data.interests.due}
            tone={data.interests.due ? "warn" : "ok"}
          />
        )}
        {data.committees && (
          <Kpi
            label="Committees overdue to meet"
            value={data.committees.overdue}
            tone={data.committees.overdue ? "warn" : "ok"}
          />
        )}
        {data.risks && (
          <Kpi
            label="High risks"
            value={data.risks.high}
            tone={data.risks.high ? "crit" : "ok"}
            note={
              data.risks.reviewLate
                ? `${data.risks.reviewLate} review late`
                : undefined
            }
          />
        )}
        {data.risks?.role === "team" && (
          <Kpi
            label="Risks given to you"
            value={data.risks.mine}
            tone={data.risks.mine ? "warn" : "ok"}
          />
        )}
      </div>
      {tabs.length > 1 && (
        <div
          className="tabbar"
          role="tablist"
          aria-label="Governance registers"
        >
          {tabs.map(([t, l]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setPick(t)}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {tab === "deals" && data.deals && <DealsPanel d={data.deals} />}
      {tab === "interests" && data.interests && (
        <InterestsPanel d={data.interests} rule={data.rule} />
      )}
      {tab === "committees" && data.committees && (
        <CommitteesPanel d={data.committees} />
      )}
      {tab === "risks" && data.risks && (
        <RisksPanel d={data.risks} rule={data.rule} />
      )}
    </div>
  );
}

function CompanyPick({
  companies,
  value,
  onChange,
}: {
  companies: Company[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (companies.length < 2) return null;
  return (
    <Select
      className="select"
      aria-label="Company"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

// ---------- Related-party deals ----------

function DealsPanel({ d }: { d: Deals }) {
  const [form, setForm] = useState(false);
  const [all, setAll] = useState(false);
  const rows = d.rows.filter((r) => all || r.deal.status !== "done");
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Related-party deals</h3>
        <div className="row" style={{ gap: 6 }}>
          {d.canRecord && (
            <button className="btn btn-sm" onClick={() => setForm(!form)}>
              Record a deal
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? "Hide finished" : "Show finished"}
          </button>
        </div>
      </div>
      <p className="muted small">
        Any rent, loan, purchase, fee or rental between a group company and a
        director, a shareholder, their family, their companies or another PWVSB
        company. The Deputy Chief of Staff records it and the Chief of Staff
        reviews it with a reason.
      </p>
      <p className="muted small">
        {d.boardApprovalAbove === null
          ? "Board resolution: no limit set by the CEO yet, so no board step."
          : `Board resolution needed from ${rm(d.boardApprovalAbove)} (set by the CEO), with the interested directors out of the vote.`}
      </p>
      {d.canSetLimit && <BoardLimit d={d} />}
      {form && (
        <DealForm companies={d.companies} onDone={() => setForm(false)} />
      )}
      <div className="list">
        {!rows.length && <div className="empty">Nothing open.</div>}
        {rows.map((r) => (
          <DealLine key={r.deal.id} row={r} />
        ))}
      </div>
    </section>
  );
}

function BoardLimit({ d }: { d: Deals }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(
    d.boardApprovalAbove === null ? "" : String(d.boardApprovalAbove),
  );
  const [note, setNote] = useState("");
  return (
    <div style={col}>
      <button className="btn btn-sm" onClick={() => setOpen(!open)}>
        Set the board limit
      </button>
      {open && (
        <>
          <input
            className="input"
            inputMode="numeric"
            aria-label="Board limit"
            placeholder="Deal value (RM) that needs the board. Empty: no board step"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <input
            className="input"
            aria-label="Reason"
            placeholder="Reason (needed)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() =>
              act
                .run(
                  () =>
                    api.registerAction("setBoardLimit", {
                      boardApprovalAbove: value.trim()
                        ? Number(value.replace(/,/g, ""))
                        : null,
                      note,
                    }),
                  "Board limit saved.",
                )
                .then((r) => r && setOpen(false))
            }
          >
            Save
          </button>
          {d.limitHistory.map((h) => (
            <div key={h.at} className="muted small">
              {dateLabel(h.at)} · {h.by} ·{" "}
              {h.boardApprovalAbove === null
                ? "no board step"
                : rm(h.boardApprovalAbove)}{" "}
              · {h.note}
            </div>
          ))}
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function DealLine({ row }: { row: DealRow }) {
  const act = useAction();
  const [note, setNote] = useState("");
  const [basis, setBasis] = useState("");
  const [ref, setRef] = useState("");
  const [on, setOn] = useState("");
  const [out, setOut] = useState(false);
  const d = row.deal;
  const [tone, label] = DEAL_STATUS[d.status];
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {RPT_NATURE_LABEL[d.nature]} · {d.counterparty}
          </div>
          <div className="muted small">
            {rm(d.amount)} · {RPT_PARTY_LABEL[d.party]} ({d.relationship}) ·
            from {dateLabel(d.startOn)}
            {d.endOn ? ` to ${dateLabel(d.endOn)}` : ""} · recorded by{" "}
            {d.recordedBy}
          </div>
          <div className="muted small">Fair price: {d.fairPriceBasis}</div>
          {d.interestedDirectors.length > 0 && (
            <div className="muted small">
              Interested directors: {d.interestedDirectors.join(", ")}
            </div>
          )}
          {row.linkedDeclarations.length > 0 && (
            <div className="muted small">
              Matches the declared interest of{" "}
              {row.linkedDeclarations.join(", ")}
            </div>
          )}
          {d.review && (
            <div className="muted small">
              PWVSB: {d.review.by} {d.review.agree ? "agreed" : "asked"}:{" "}
              {d.review.note}
            </div>
          )}
          {d.answers.map((a) => (
            <div key={a.at} className="muted small">
              {`Answer from ${a.by}: ${a.note}`}
            </div>
          ))}
          {d.board && (
            <div className="muted small">
              Board {d.board.resolutionRef} on {dateLabel(d.board.on)},
              interested directors stayed out
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {row.needsBoard && <Chip tone="info">Board decides</Chip>}
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      {row.canReview && (
        <>
          <input
            className="input"
            aria-label="Reason"
            placeholder="Reason (needed)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () =>
                    api.registerAction("reviewDeal", {
                      id: d.id,
                      agree: true,
                      note,
                    }),
                  "Agreed.",
                )
              }
            >
              Price is fair
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () =>
                    api.registerAction("reviewDeal", {
                      id: d.id,
                      agree: false,
                      note,
                    }),
                  "Question sent to the Deputy Chief of Staff.",
                )
              }
            >
              Ask a question
            </button>
          </div>
        </>
      )}
      {row.canAnswer && (
        <>
          <input
            className="input"
            aria-label="Answer"
            placeholder="Your answer (needed)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            className="input"
            aria-label="Fair price"
            placeholder="Updated reason the price is fair (optional)"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () =>
                    api.registerAction("answerDeal", {
                      id: d.id,
                      note,
                      fairPriceBasis: basis,
                    }),
                  "Sent back for review.",
                )
              }
            >
              Send answer
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () =>
                    api.registerAction("answerDeal", {
                      id: d.id,
                      note,
                      drop: true,
                    }),
                  "Deal dropped.",
                )
              }
            >
              Drop the deal
            </button>
          </div>
        </>
      )}
      {row.canRecordBoard && (
        <>
          <input
            className="input"
            aria-label="Resolution"
            placeholder="Board resolution reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <input
            className="input"
            type="date"
            aria-label="Resolution date"
            value={on}
            onChange={(e) => setOn(e.target.value)}
          />
          <label className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={out}
              onChange={(e) => setOut(e.target.checked)}
            />
            The interested directors stayed out of the decision
          </label>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !ref.trim() || !on || !out}
            onClick={() =>
              act.run(
                () =>
                  api.registerAction("boardDeal", {
                    id: d.id,
                    resolutionRef: ref,
                    on,
                    interestedStayedOut: out,
                  }),
                "Board resolution recorded.",
              )
            }
          >
            Record board resolution
          </button>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function DealForm({
  companies,
  onDone,
}: {
  companies: Company[];
  onDone: () => void;
}) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0].id);
  const [counterparty, setCounterparty] = useState("");
  const [party, setParty] = useState<RptParty>("director");
  const [relationship, setRelationship] = useState("");
  const [nature, setNature] = useState<RptNature>("rent");
  const [amount, setAmount] = useState("");
  const [startOn, setStartOn] = useState("");
  const [endOn, setEndOn] = useState("");
  const [basis, setBasis] = useState("");
  const [interested, setInterested] = useState("");
  return (
    <div style={col}>
      <CompanyPick
        companies={companies}
        value={companyId}
        onChange={setCompanyId}
      />
      <input
        className="input"
        aria-label="Other party"
        placeholder="Other party (person or company)"
        value={counterparty}
        onChange={(e) => setCounterparty(e.target.value)}
      />
      <Select
        className="select"
        aria-label="Who they are"
        value={party}
        onChange={(e) => setParty(e.target.value as RptParty)}
      >
        {(Object.keys(RPT_PARTY_LABEL) as RptParty[]).map((x) => (
          <option key={x} value={x}>
            {RPT_PARTY_LABEL[x]}
          </option>
        ))}
      </Select>
      <input
        className="input"
        aria-label="How related"
        placeholder="How they are related"
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
      />
      <Select
        className="select"
        aria-label="Kind of deal"
        value={nature}
        onChange={(e) => setNature(e.target.value as RptNature)}
      >
        {(Object.keys(RPT_NATURE_LABEL) as RptNature[]).map((x) => (
          <option key={x} value={x}>
            {RPT_NATURE_LABEL[x]}
          </option>
        ))}
      </Select>
      <input
        className="input"
        inputMode="decimal"
        aria-label="Total value"
        placeholder="Total value (RM)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <label className="small muted">Start date</label>
      <input
        className="input"
        type="date"
        aria-label="Start date"
        value={startOn}
        onChange={(e) => setStartOn(e.target.value)}
      />
      <label className="small muted">End date (optional)</label>
      <input
        className="input"
        type="date"
        aria-label="End date"
        value={endOn}
        onChange={(e) => setEndOn(e.target.value)}
      />
      <textarea
        className="input"
        aria-label="Fair price"
        placeholder="Why the price is fair: quotes, market rent, group rate"
        value={basis}
        onChange={(e) => setBasis(e.target.value)}
      />
      <input
        className="input"
        aria-label="Interested directors"
        placeholder="Directors with an interest, separated by commas (optional)"
        value={interested}
        onChange={(e) => setInterested(e.target.value)}
      />
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || !counterparty.trim() || !amount || !startOn}
        onClick={() =>
          act
            .run(
              () =>
                api.registerAction("addDeal", {
                  companyId,
                  counterparty,
                  party,
                  relationship,
                  nature,
                  amount: Number(amount.replace(/,/g, "")),
                  startOn,
                  endOn: endOn || null,
                  fairPriceBasis: basis,
                  interestedDirectors: interested
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
              "Deal recorded; sent to the Chief of Staff for review.",
            )
            .then((r) => r && onDone())
        }
      >
        Save
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Directors' interests ----------

function InterestsPanel({ d, rule }: { d: Interests; rule: RegBoard["rule"] }) {
  const [form, setForm] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Directors' interests</h3>
        {d.canRecord && (
          <button
            className="btn btn-sm"
            onClick={() => setForm(form === null ? "" : null)}
          >
            Record a declaration
          </button>
        )}
      </div>
      <p className="muted small">
        {`Each director declares other directorships, shareholdings, family links and business with the company once every ${rule.interestEveryMonths} months (Companies Act 2016 s.221). The Deputy Chief of Staff collects the signed forms and marks each director done for the year; the Chief of Staff reads them. No declaration on file shows as Unknown, never as clear.`}
      </p>
      {form !== null && (
        <InterestForm
          companies={d.companies}
          director={form}
          onDone={() => setForm(null)}
        />
      )}
      <div className="list">
        {d.noDeclarations.map((n) => (
          <div key={n.companyId} className="list-item">
            <div style={{ fontWeight: 600 }}>
              {n.companyName}: no declaration on file
            </div>
            <Chip tone="warn">Unknown</Chip>
          </div>
        ))}
        {d.rows.map((r) => (
          <InterestLine
            key={r.declaration.id}
            row={r}
            onRenew={() => setForm(r.declaration.directorName)}
          />
        ))}
      </div>
    </section>
  );
}

function InterestLine({
  row,
  onRenew,
}: {
  row: Interests["rows"][number];
  onRenew: () => void;
}) {
  const act = useAction();
  const [note, setNote] = useState("");
  const d = row.declaration;
  const [tone, label] = STATE[row.state];
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {d.directorName}
          </div>
          <div className="muted small">
            Declared {dateLabel(d.declaredOn)} ({d.formRef}) · next by{" "}
            {dateLabel(row.dueOn)}
            {row.history ? ` · ${row.history} earlier` : ""}
          </div>
          {d.nothingToDeclare ? (
            <div className="muted small">Nothing to declare</div>
          ) : (
            d.interests.map((i, n) => (
              <div key={n} className="muted small">
                {INTEREST_KIND_LABEL[i.kind]}: {i.detail}
              </div>
            ))
          )}
          {d.seen && (
            <div className="muted small">
              Read by {d.seen.by}: {d.seen.note}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {row.doneThisYear && <Chip tone="ok">Done this year</Chip>}
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      {row.canSee && (
        <div className="row" style={{ gap: 6 }}>
          <input
            className="input"
            aria-label="Comment"
            placeholder="Comment (needed)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() =>
              act.run(
                () => api.registerAction("seeDeclaration", { id: d.id, note }),
                "Marked as read.",
              )
            }
          >
            Read
          </button>
        </div>
      )}
      {row.canRenew && row.state !== "ok" && (
        <button className="btn btn-sm" onClick={onRenew}>
          Record a new declaration
        </button>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function InterestForm({
  companies,
  director,
  onDone,
}: {
  companies: Company[];
  director: string;
  onDone: () => void;
}) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0].id);
  const [directorName, setDirectorName] = useState(director);
  const [declaredOn, setDeclaredOn] = useState("");
  const [formRef, setFormRef] = useState("");
  const [none, setNone] = useState(false);
  const [items, setItems] = useState<{ kind: InterestKind; detail: string }[]>([
    { kind: "directorship", detail: "" },
  ]);
  const filled = items.filter((i) => i.detail.trim());
  return (
    <div style={col}>
      <CompanyPick
        companies={companies}
        value={companyId}
        onChange={setCompanyId}
      />
      <input
        className="input"
        aria-label="Director"
        placeholder="Director's name"
        value={directorName}
        onChange={(e) => setDirectorName(e.target.value)}
      />
      <label className="small muted">Date declared</label>
      <input
        className="input"
        type="date"
        aria-label="Date declared"
        value={declaredOn}
        onChange={(e) => setDeclaredOn(e.target.value)}
      />
      <input
        className="input"
        aria-label="Form"
        placeholder="Signed form reference"
        value={formRef}
        onChange={(e) => setFormRef(e.target.value)}
      />
      <label className="row small" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={none}
          onChange={(e) => setNone(e.target.checked)}
        />
        Nothing to declare
      </label>
      {!none &&
        items.map((it, n) => (
          <div key={n} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Select
              className="select"
              aria-label="Kind of interest"
              value={it.kind}
              onChange={(e) =>
                setItems(
                  items.map((x, j) =>
                    j === n
                      ? { ...x, kind: e.target.value as InterestKind }
                      : x,
                  ),
                )
              }
            >
              {(Object.keys(INTEREST_KIND_LABEL) as InterestKind[]).map((x) => (
                <option key={x} value={x}>
                  {INTEREST_KIND_LABEL[x]}
                </option>
              ))}
            </Select>
            <input
              className="input"
              aria-label="Interest"
              placeholder="Company or person, and what"
              value={it.detail}
              onChange={(e) =>
                setItems(
                  items.map((x, j) =>
                    j === n ? { ...x, detail: e.target.value } : x,
                  ),
                )
              }
            />
          </div>
        ))}
      {!none && (
        <button
          className="btn btn-sm"
          onClick={() =>
            setItems([...items, { kind: "directorship", detail: "" }])
          }
        >
          Add another interest
        </button>
      )}
      <button
        className="btn btn-primary btn-sm"
        disabled={
          act.busy ||
          !directorName.trim() ||
          !declaredOn ||
          !formRef.trim() ||
          (!none && !filled.length)
        }
        onClick={() =>
          act
            .run(
              () =>
                api.registerAction("declare", {
                  companyId,
                  directorName,
                  declaredOn,
                  formRef,
                  nothingToDeclare: none,
                  interests: none ? [] : filled,
                }),
              "Declaration recorded.",
            )
            .then((r) => r && onDone())
        }
      >
        Save
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Committees ----------

function CommitteesPanel({ d }: { d: Committees }) {
  const [form, setForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Board committees</h3>
        {d.companies.length > 0 && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            Add a committee
          </button>
        )}
      </div>
      <p className="muted small">
        Who sits on each committee, how often it meets, and the minutes of each
        meeting. A committee with no meeting on file shows as Unknown.
      </p>
      {form && (
        <CommitteeForm companies={d.companies} onDone={() => setForm(false)} />
      )}
      <div className="list">
        {!d.rows.length && <div className="empty">No committees recorded.</div>}
        {d.rows.map((c) => (
          <CommitteeLine key={c.committee.id} row={c} />
        ))}
      </div>
    </section>
  );
}

function CommitteeLine({ row }: { row: Committees["rows"][number] }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState("");
  const [present, setPresent] = useState("");
  const [minutesRef, setMinutesRef] = useState("");
  const [actionsOpen, setActionsOpen] = useState("");
  const c = row.committee;
  const [tone, label] = STATE[row.state];
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {c.name}
          </div>
          <div className="muted small">
            {COMMITTEE_KIND_LABEL[c.kind]} · meets every {c.meetEveryMonths}{" "}
            month{c.meetEveryMonths === 1 ? "" : "s"} · {c.termsRef}
          </div>
          <div className="muted small">
            {c.members
              .map(
                (m) =>
                  `${m.name}${m.chair ? " (chair)" : ""}${m.independent ? " (independent)" : ""}`,
              )
              .join(", ")}
          </div>
          <div className="muted small">
            {row.last
              ? `Last met ${dateLabel(row.last.on)}, ${row.last.present} present, minutes ${row.last.minutesRef}, ${row.last.actionsOpen} actions open`
              : "No meeting on file"}
            {row.nextDue ? ` · next by ${dateLabel(row.nextDue)}` : ""}
          </div>
          {row.independentNote && (
            <div className="muted small">
              Listed groups keep most audit committee members independent. A
              note only; not required here.
            </div>
          )}
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {row.canRecord && (
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>
          Record a meeting
        </button>
      )}
      {open && (
        <div style={col}>
          <input
            className="input"
            type="date"
            aria-label="Meeting date"
            value={on}
            onChange={(e) => setOn(e.target.value)}
          />
          <input
            className="input"
            inputMode="numeric"
            aria-label="Present"
            placeholder="Members present"
            value={present}
            onChange={(e) => setPresent(e.target.value)}
          />
          <input
            className="input"
            aria-label="Minutes"
            placeholder="Minutes reference"
            value={minutesRef}
            onChange={(e) => setMinutesRef(e.target.value)}
          />
          <input
            className="input"
            inputMode="numeric"
            aria-label="Actions open"
            placeholder="Actions still open (optional)"
            value={actionsOpen}
            onChange={(e) => setActionsOpen(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !on || !present || !minutesRef.trim()}
            onClick={() =>
              act
                .run(
                  () =>
                    api.registerAction("addMeeting", {
                      id: c.id,
                      on,
                      present: Number(present),
                      minutesRef,
                      actionsOpen: Number(actionsOpen) || 0,
                    }),
                  "Meeting recorded.",
                )
                .then((r) => r && setOpen(false))
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function CommitteeForm({
  companies,
  onDone,
}: {
  companies: Company[];
  onDone: () => void;
}) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0].id);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CommitteeKind>("audit_risk");
  const [every, setEvery] = useState("3");
  const [termsRef, setTermsRef] = useState("");
  const [members, setMembers] = useState([
    { name: "", chair: true, independent: false },
    { name: "", chair: false, independent: false },
  ]);
  const set = (n: number, patch: Partial<(typeof members)[number]>) =>
    setMembers(
      members.map((m, j) =>
        j === n ? { ...m, ...patch } : patch.chair ? { ...m, chair: false } : m,
      ),
    );
  return (
    <div style={col}>
      <CompanyPick
        companies={companies}
        value={companyId}
        onChange={setCompanyId}
      />
      <input
        className="input"
        aria-label="Committee name"
        placeholder="Committee name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Select
        className="select"
        aria-label="Kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as CommitteeKind)}
      >
        {(Object.keys(COMMITTEE_KIND_LABEL) as CommitteeKind[]).map((x) => (
          <option key={x} value={x}>
            {COMMITTEE_KIND_LABEL[x]}
          </option>
        ))}
      </Select>
      <input
        className="input"
        inputMode="numeric"
        aria-label="Meets every"
        placeholder="Meets every how many months"
        value={every}
        onChange={(e) => setEvery(e.target.value)}
      />
      <input
        className="input"
        aria-label="Terms"
        placeholder="Board resolution or terms of reference"
        value={termsRef}
        onChange={(e) => setTermsRef(e.target.value)}
      />
      {members.map((m, n) => (
        <div key={n} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            className="input"
            aria-label="Member"
            placeholder="Member's name"
            value={m.name}
            onChange={(e) => set(n, { name: e.target.value })}
          />
          <label className="row small" style={{ gap: 4 }}>
            <input
              type="radio"
              name="chair"
              checked={m.chair}
              onChange={() => set(n, { chair: true })}
            />
            Chair
          </label>
          <label className="row small" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={m.independent}
              onChange={(e) => set(n, { independent: e.target.checked })}
            />
            Independent
          </label>
        </div>
      ))}
      <button
        className="btn btn-sm"
        onClick={() =>
          setMembers([
            ...members,
            { name: "", chair: false, independent: false },
          ])
        }
      >
        Add a member
      </button>
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || !name.trim() || !termsRef.trim()}
        onClick={() =>
          act
            .run(
              () =>
                api.registerAction("addCommittee", {
                  companyId,
                  name,
                  kind,
                  meetEveryMonths: Number(every),
                  termsRef,
                  members: members.filter((m) => m.name.trim()),
                }),
              "Committee added.",
            )
            .then((r) => r && onDone())
        }
      >
        Save
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Risks ----------

function RisksPanel({ d, rule }: { d: Risks; rule: RegBoard["rule"] }) {
  const [form, setForm] = useState(false);
  const [all, setAll] = useState(false);
  const rows = d.rows.filter((r) => all || r.risk.status === "open");
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Risk register</h3>
        <div className="row" style={{ gap: 6 }}>
          {d.canAdd && (
            <button className="btn btn-sm" onClick={() => setForm(!form)}>
              Add a risk
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? "Hide closed" : "Show closed"}
          </button>
        </div>
      </div>
      <p className="muted small">
        {`ACT only. The ACT Director scores each risk 1 to 5 for how likely it is and how bad it would be, gives the work to the ACT team and settles it. ${rule.highRiskScore} or more is high and is reviewed every ${rule.highRiskReviewMonths} months; others every ${rule.otherRiskReviewMonths}.`}
      </p>
      <Heat heat={d.heat} rule={rule} />
      {form && (
        <RiskForm companies={d.companies} onDone={() => setForm(false)} />
      )}
      <div className="list">
        {!rows.length && <div className="empty">No risks recorded.</div>}
        {rows.map((r) => (
          <RiskLine key={r.risk.id} row={r} team={d.team} />
        ))}
      </div>
    </section>
  );
}

function Heat({ heat, rule }: { heat: number[][]; rule: RegBoard["rule"] }) {
  const tone = (s: number) =>
    s >= rule.highRiskScore
      ? "crit"
      : s >= rule.mediumRiskScore
        ? "warn"
        : "ok";
  return (
    <div style={{ overflowX: "auto", marginBottom: 8 }}>
      <table
        className="table small"
        aria-label="Open risks by likelihood and impact"
      >
        <thead>
          <tr>
            <th>Likelihood ↓ / Impact →</th>
            {[1, 2, 3, 4, 5].map((i) => (
              <th key={i}>{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[5, 4, 3, 2, 1].map((l) => (
            <tr key={l}>
              <th>{l}</th>
              {[1, 2, 3, 4, 5].map((i) => (
                <td key={i}>
                  {heat[l - 1][i - 1] ? (
                    <Chip tone={tone(l * i)}>{heat[l - 1][i - 1]}</Chip>
                  ) : (
                    <span className="muted">·</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskLine({ row, team }: { row: RiskRow; team: Risks["team"] }) {
  const act = useAction();
  const [mode, setMode] = useState<"review" | "assign" | "close" | null>(null);
  const [toId, setToId] = useState(row.risk.assignedToId ?? team[0]?.id ?? "");
  const [l, setL] = useState(String(row.risk.likelihood));
  const [i, setI] = useState(String(row.risk.impact));
  const [note, setNote] = useState("");
  const [action, setAction] = useState("");
  const [due, setDue] = useState("");
  const r = row.risk;
  const [tone, label] = LEVEL[row.level];
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {r.title}
          </div>
          <div className="muted small">
            {RISK_CATEGORY_LABEL[r.category]} · owner {r.ownerName} · likelihood{" "}
            {r.likelihood} × impact {r.impact} = {row.score}
          </div>
          <div className="muted small">In place: {r.controls}</div>
          {r.action && (
            <div className="muted small">
              Action: {r.action}
              {r.actionDueOn ? ` by ${dateLabel(r.actionDueOn)}` : ""}
              {row.actionLate ? " (late)" : ""}
            </div>
          )}
          <div className="muted small">
            Last reviewed {dateLabel(r.lastReviewedOn)} · next by{" "}
            {dateLabel(row.reviewDue)}
            {row.reviewLate ? " (late)" : ""}
          </div>
          {r.assignedTo && (
            <div className="muted small">{`Given to ${r.assignedTo}`}</div>
          )}
          {r.instructions.map((c) => (
            <div key={c.at} className="muted small">
              {`ACT Director to ${c.to}: ${c.note}`}
            </div>
          ))}
          {r.closed && (
            <div className="muted small">
              Closed by {r.closed.by}: {r.closed.note}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {row.mine && <Chip tone="info">Given to you</Chip>}
          {row.reviewLate && <Chip tone="warn">Review late</Chip>}
          <Chip tone={r.status === "closed" ? "info" : tone}>
            {r.status === "closed" ? "Closed" : label}
          </Chip>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {row.canUpdate && (
          <button
            className="btn btn-sm"
            onClick={() => setMode(mode === "review" ? null : "review")}
          >
            Review
          </button>
        )}
        {row.canAssign && team.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => setMode(mode === "assign" ? null : "assign")}
          >
            Give to the team
          </button>
        )}
        {row.canClose && (
          <button
            className="btn btn-sm"
            onClick={() => setMode(mode === "close" ? null : "close")}
          >
            Settle and close
          </button>
        )}
      </div>
      {mode === "review" && (
        <div style={col}>
          <div className="row" style={{ gap: 6 }}>
            <Score label="Likelihood" value={l} onChange={setL} />
            <Score label="Impact" value={i} onChange={setI} />
          </div>
          <input
            className="input"
            aria-label="Action"
            placeholder="Updated action (optional)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
          <input
            className="input"
            type="date"
            aria-label="Action due"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
      )}
      {mode === "assign" && (
        <Select
          className="select"
          aria-label="Team member"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
        >
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}
      {mode && (
        <>
          <input
            className="input"
            aria-label="Reason"
            placeholder={
              mode === "review"
                ? "What changed, or why it stays (needed)"
                : mode === "close"
                  ? "Why the risk is settled (needed)"
                  : "What the team member should do (needed)"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || note.trim().length < 3}
            onClick={() =>
              act
                .run(
                  () =>
                    mode === "review"
                      ? api.registerAction("reviewRisk", {
                          id: r.id,
                          likelihood: Number(l),
                          impact: Number(i),
                          note,
                          action,
                          actionDueOn: due || null,
                        })
                      : mode === "close"
                        ? api.registerAction("closeRisk", { id: r.id, note })
                        : api.registerAction("assignRisk", {
                            id: r.id,
                            toId,
                            note,
                          }),
                  mode === "review"
                    ? "Review recorded."
                    : mode === "close"
                      ? "Risk settled and closed."
                      : "Given to the team member.",
                )
                .then((x) => x && setMode(null))
            }
          >
            Save
          </button>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Score({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      className="small"
      style={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      {label}
      <Select
        className="select"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </label>
  );
}

function RiskForm({
  companies,
  onDone,
}: {
  companies: Company[];
  onDone: () => void;
}) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0].id);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RiskCategory>("operational");
  const [ownerName, setOwnerName] = useState("");
  const [l, setL] = useState("3");
  const [i, setI] = useState("3");
  const [controls, setControls] = useState("");
  const [action, setAction] = useState("");
  const [due, setDue] = useState("");
  return (
    <div style={col}>
      <CompanyPick
        companies={companies}
        value={companyId}
        onChange={setCompanyId}
      />
      <input
        className="input"
        aria-label="Risk"
        placeholder="What could go wrong"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Select
        className="select"
        aria-label="Kind of risk"
        value={category}
        onChange={(e) => setCategory(e.target.value as RiskCategory)}
      >
        {(Object.keys(RISK_CATEGORY_LABEL) as RiskCategory[]).map((x) => (
          <option key={x} value={x}>
            {RISK_CATEGORY_LABEL[x]}
          </option>
        ))}
      </Select>
      <input
        className="input"
        aria-label="Owner"
        placeholder="Who owns it"
        value={ownerName}
        onChange={(e) => setOwnerName(e.target.value)}
      />
      <div className="row" style={{ gap: 6 }}>
        <Score label="Likelihood" value={l} onChange={setL} />
        <Score label="Impact" value={i} onChange={setI} />
      </div>
      <textarea
        className="input"
        aria-label="Controls"
        placeholder="What is already in place"
        value={controls}
        onChange={(e) => setControls(e.target.value)}
      />
      <input
        className="input"
        aria-label="Action"
        placeholder="What more will be done (needed for a high risk)"
        value={action}
        onChange={(e) => setAction(e.target.value)}
      />
      <label className="small muted">Action due</label>
      <input
        className="input"
        type="date"
        aria-label="Action due"
        value={due}
        onChange={(e) => setDue(e.target.value)}
      />
      <button
        className="btn btn-primary btn-sm"
        disabled={
          act.busy || !title.trim() || !ownerName.trim() || !controls.trim()
        }
        onClick={() =>
          act
            .run(
              () =>
                api.registerAction("addRisk", {
                  companyId,
                  title,
                  category,
                  ownerName,
                  likelihood: Number(l),
                  impact: Number(i),
                  controls,
                  action,
                  actionDueOn: due || null,
                }),
              "Risk added.",
            )
            .then((r) => r && onDone())
        }
      >
        Save
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}
