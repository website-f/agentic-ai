import { Fragment, useState } from "react";
import { api } from "../api";
import type { TenderCounter } from "../api/types";
import { ErrorNotice, Loading, useLoad } from "../ui";

type Row = TenderCounter["companies"][number];

const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const monthLabel = (key: string) =>
  `${MONTH[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * The tender counter (Fauzan, 4 Nov 2026): tenders entered each month and won each six months, quotations and
 * proposals sent and accepted, and what each staff member completed. The Director Office Administrator monitors every
 * company; a company sees its own. Counts only, not a ranking.
 */
export function TenderCounterPanel({ companyId }: { companyId?: string }) {
  const { data, error } = useLoad(() => api.tenderCounter(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [half, setHalf] = useState<number | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="tender counter" />;
  const rows = companyId
    ? data.companies.filter((c) => c.companyId === companyId)
    : data.companies;
  if (!rows.length) return null;
  const h = half ?? data.halves.length - 1;
  const thisMonth = data.months.length - 1;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          {companyId
            ? "Tender and quotation counter"
            : "Tender and quotation counter, every company"}
        </h3>
        <select
          value={h}
          onChange={(e) => setHalf(Number(e.target.value))}
          aria-label="Six-month period"
        >
          {data.halves.map((x, i) => (
            <option key={x.key} value={i}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        Entered = bid lodged with the slip. Won and accepted are counted in the
        six months the result was recorded. Counts only, not a ranking.
      </p>
      {companyId ? (
        <CompanyDetail row={rows[0]} data={data} h={h} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Tenders this month</th>
                <th className="num">
                  Tenders entered ({data.halves[h].label})
                </th>
                <th className="num">Tenders won</th>
                <th className="num hide-sm">Quotations this month</th>
                <th className="num hide-sm">
                  Quotations sent ({data.halves[h].label})
                </th>
                <th className="num hide-sm">Quotations accepted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.companyId}>
                  <tr
                    className="list-button"
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      setOpen(open === r.companyId ? null : r.companyId)
                    }
                  >
                    <td>
                      {open === r.companyId ? "▾ " : "▸ "}
                      {r.companyName}
                    </td>
                    <td className="num">{r.entered[thisMonth]}</td>
                    <td className="num">{r.enteredHalf[h]}</td>
                    <td className="num">{r.wonHalf[h]}</td>
                    <td className="num hide-sm">
                      {r.quotations.sent[thisMonth]}
                    </td>
                    <td className="num hide-sm">{r.quotations.sentHalf[h]}</td>
                    <td className="num hide-sm">
                      {r.quotations.acceptedHalf[h]}
                    </td>
                  </tr>
                  {open === r.companyId && (
                    <tr>
                      <td colSpan={7}>
                        <CompanyDetail row={r} data={data} h={h} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CompanyDetail({
  row,
  data,
  h,
}: {
  row: Row;
  data: TenderCounter;
  h: number;
}) {
  const q = row.quotations;
  const notes = [
    row.awaitingResult
      ? `${row.awaitingResult} tender(s) lodged, result not recorded yet`
      : "",
    q.awaitingAnswer
      ? `${q.awaitingAnswer} quotation(s) sent, client has not answered yet`
      : "",
    row.datedByClosing
      ? `${row.datedByClosing} older tender(s) dated by closing date`
      : "",
    q.estimatedDates
      ? `${q.estimatedDates} older quotation(s) dated by approval date`
      : "",
  ].filter(Boolean);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Each month</th>
              {data.months.map((m) => (
                <th key={m} className="num">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Tenders entered</td>
              {row.entered.map((v, i) => (
                <td key={i} className="num">
                  {v}
                </td>
              ))}
              <td className="num">{sum(row.entered)}</td>
            </tr>
            <tr>
              <td>Quotations / proposals sent</td>
              {q.sent.map((v, i) => (
                <td key={i} className="num">
                  {v}
                </td>
              ))}
              <td className="num">{sum(q.sent)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Each six months</th>
              {data.halves.map((x) => (
                <th key={x.key} className="num">
                  {x.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Tenders entered", row.enteredHalf],
                ["Tenders won", row.wonHalf],
                ["Quotations / proposals sent", q.sentHalf],
                ["Quotations / proposals accepted", q.acceptedHalf],
              ] as const
            ).map(([label, vals]) => (
              <tr key={label}>
                <td>{label}</td>
                {vals.map((v, i) => (
                  <td key={i} className="num">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <StaffTable row={row} data={data} h={h} />
      {notes.length > 0 && (
        <div className="muted small">{notes.join(" · ")}</div>
      )}
    </div>
  );
}

function StaffTable({
  row,
  data,
  h,
}: {
  row: Row;
  data: TenderCounter;
  h: number;
}) {
  const thisMonth = data.months.length - 1;
  const people = new Map<
    string,
    {
      name: string;
      t?: Row["staff"][number];
      q?: Row["quotations"]["staff"][number];
    }
  >();
  for (const s of row.staff) people.set(s.userId, { name: s.name, t: s });
  for (const s of row.quotations.staff)
    people.set(s.userId, {
      ...(people.get(s.userId) ?? { name: s.name }),
      q: s,
    });
  const list = [...people.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              {row.staffScope === "all" ? "Each staff member" : "Your own work"}
            </th>
            <th className="num">Tenders completed this month</th>
            <th className="num">Tenders completed ({data.halves[h].label})</th>
            <th className="num hide-sm">Tenders verified as manager</th>
            <th className="num">Quotations sent this month</th>
            <th className="num">Quotations sent ({data.halves[h].label})</th>
            <th className="num hide-sm">Accepted</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                Nothing completed yet.
              </td>
            </tr>
          )}
          {list.map((p) => (
            <tr key={p.name + (p.t?.userId ?? p.q?.userId)}>
              <td>{p.name}</td>
              <td className="num">{p.t?.completed[thisMonth] ?? 0}</td>
              <td className="num">{p.t?.completedHalf[h] ?? 0}</td>
              <td className="num hide-sm">{p.t?.verifiedHalf[h] ?? 0}</td>
              <td className="num">{p.q?.sent[thisMonth] ?? 0}</td>
              <td className="num">{p.q?.sentHalf[h] ?? 0}</td>
              <td className="num hide-sm">{p.q?.acceptedHalf[h] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted small">
        A tender counts for the person who signed it as preparer once it is
        lodged; a quotation for the person who prepared it once it is sent.
      </div>
    </div>
  );
}
