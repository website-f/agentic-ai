import { useState, type ReactNode } from 'react';
import type { StatutorySettings } from '@prima/core';
import { api } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { tr, useLang } from '../i18n';
import {
  BLANK_OTHER,
  FIELDS,
  SCHEMES,
  appliesText,
  changes,
  draftOf,
  draftProblems,
  fieldProblem,
  glance,
  history,
  monthText,
  nextChange,
  otherDraftOf,
  otherProblems,
  pctText,
  prevMonth,
  rmText,
  schemeViews,
  settingsOf,
  startFor,
  versionFor,
  type Draft,
  type Field,
  type OtherDraft,
  type SchemeId,
  type VersionState,
} from './statutory-model';
import '../styles/salary-calc.css';
import '../styles/statutory.css';

/**
 * Statutory rates (Fauzan, 6 Nov 2026): "Ceo can set ... how salary is set and how the base is set base by the new law
 * that came. Even with socso or epf or add new way." The CEO sets EPF, SOCSO, EIS, LINDUNG and HRD from a month and can
 * add a new contribution; HR, Finance and ACT see what is in force. The day divisor is on the Pay formulas screen.
 *
 * P98 (Fitri, 11 Nov 2026: "not optimized: make it optimized like the salary calculator page"): one card per scheme with
 * a who / employee / employer table (cards on a phone), the summary of what is in force kept in view, the history with
 * what each change changed, and the CEO's change in steps with the boxes checked as typed and a review before saving.
 * Same reads, same save, same server checks (statutory-model.ts says how the numbers are kept).
 */

type Board = Awaited<ReturnType<typeof api.statutoryBoard>>;
type StatOther = StatutorySettings['others'][number];

const STATE: Record<VersionState, [Tone, string]> = {
  in_force: ['ok', 'In force'],
  scheduled: ['info', 'Coming'],
  earlier: ['neutral', 'Earlier'],
  replaced: ['neutral', 'Replaced'],
};

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const toTop = () => document.querySelector('.sr-page')?.scrollIntoView({ block: 'start' });

function Head({ actions }: { actions?: ReactNode }) {
  return (
    <header className="k-head sr-head">
      <div className="k-head-text">
        <h1>Statutory rates</h1>
        <p className="k-head-sub">
          The EPF, SOCSO, EIS, LINDUNG 24 Jam and HRD rates that guard pay and staff payroll use, and any new contribution the law brings. The CEO changes
          them from a month, with a reason and the law reference.
        </p>
      </div>
      {actions && <div className="k-head-actions">{actions}</div>}
    </header>
  );
}

export function StatutoryRatesView() {
  // The board's single read, as before P98.
  const { data, error, reload } = useLoad(() => api.statutoryBoard(), []);
  const [editing, setEditing] = useState(false);
  if (error)
    return (
      <div className="page sr-page">
        <Head />
        <div className="notice sr-status" data-tone="crit" role="alert">
          <span>The statutory rates could not be loaded. {error}</span>
          <button type="button" className="btn btn-sm" onClick={reload}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="page sr-page">
        <Head />
        <Loading what="statutory rates" />
      </div>
    );
  if (editing && data.canSet)
    return (
      <Editor
        data={data}
        onClose={() => {
          setEditing(false);
          toTop();
        }}
      />
    );
  return (
    <RatesBoard
      data={data}
      onChange={() => {
        setEditing(true);
        toTop();
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the rates
// ---------------------------------------------------------------------------------------------------------------------

function RateTable({ rows }: { rows: { key: string; who: string; note?: string; ee: string; er: string; now?: boolean }[] }) {
  return (
    <div className="sr-table-wrap">
      <table className="sr-table">
        <thead>
          <tr>
            <th scope="col">Who</th>
            <th scope="col" className="sr-num">
              Employee pays
            </th>
            <th scope="col" className="sr-num">
              Employer pays
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-now={r.now || undefined}>
              <th scope="row">
                <span className="sr-who">{r.who}</span>
                {r.note && <span className="sr-who-note">{r.note}</span>}
              </th>
              <td className="sr-num">{r.ee}</td>
              <td className="sr-num">{r.er}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SchemeCard({ id, short, name, malay, children }: { id: string; short: string; name: string; malay: string; children: ReactNode }) {
  return (
    <section className="sr-card" id={`sr-${id}`} aria-labelledby={`sr-${id}-h`}>
      <header className="sr-card-head">
        {malay && (
          <span className="sr-badge" title={malay}>
            {malay}
          </span>
        )}
        <div className="sr-card-title">
          <h2 id={`sr-${id}-h`}>{short}</h2>
          <p>{name}</p>
        </div>
      </header>
      <div className="sr-card-body">{children}</div>
    </section>
  );
}

function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="sr-facts">
      {items.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OthersTable({ others }: { others: StatOther[] }) {
  return (
    <div className="sr-table-wrap">
      <table className="sr-table sr-wide">
        <thead>
          <tr>
            <th scope="col">Contribution</th>
            <th scope="col" className="sr-num">
              Employee pays
            </th>
            <th scope="col" className="sr-num">
              Employer pays
            </th>
            <th scope="col">Wage cap</th>
            <th scope="col">Applies to</th>
            <th scope="col">Paid to</th>
          </tr>
        </thead>
        <tbody>
          {others.map((o) => (
            <tr key={o.code}>
              <th scope="row">
                <span className="sr-who">{o.name}</span>
                <span className="sr-who-note">
                  <span data-no-translate>{o.code}</span> · {o.includeOt ? 'Overtime counts' : 'Not on overtime'}
                </span>
              </th>
              <td className="sr-num">{pctText(o.eeRate)}</td>
              <td className="sr-num">{pctText(o.erRate)}</td>
              <td>{o.wageCap != null ? rmText(o.wageCap) : 'No cap'}</td>
              <td>{appliesText(o)}</td>
              <td data-no-translate>{o.payee}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatesBoard({ data, onChange }: { data: Board; onChange: () => void }) {
  const s = data.inForce;
  const views = schemeViews(s, data.month);
  const rows = history(data.versions, data.month);
  const now = versionFor(data.versions, data.month);
  const next = nextChange(data.versions, data.month);
  const jumps: [string, string][] = [...views.map((v) => [v.id, v.short] as [string, string]), ...(s.others.length ? [['others', 'New contributions'] as [string, string]] : []), ['history', 'Changes']];
  return (
    <div className="page sr-page">
      <Head
        actions={
          data.canSet && (
            <button type="button" className="btn btn-primary" onClick={onChange}>
              Change rates
            </button>
          )
        }
      />
      {!data.on && (
        <div className="notice" data-tone="warn">
          Not switched on in this database yet: pay uses the law as at November 2026 until the guard pay module is installed with approval.
        </div>
      )}
      <nav className="sr-jump" aria-label="Go to">
        {jumps.map(([id, label]) => (
          <button key={id} type="button" onClick={() => jump(`sr-${id}`)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="sr-layout">
        <aside className="sr-summary" aria-labelledby="sr-sum-h">
          <div className="sr-sum-card">
            <h2 id="sr-sum-h" className="sr-sum-title">
              In force for
            </h2>
            <p className="sr-sum-month">{monthText(data.month)}</p>
            <div className="sr-sum-source">
              {now ? (
                <>
                  <span>
                    <span>Changed from</span> <b>{monthText(now.effectiveFrom)}</b>
                  </span>
                  <span className="sr-sum-by">
                    <span data-no-translate>{now.setBy}</span> · {dateTimeLabel(now.setAt)}
                  </span>
                </>
              ) : (
                <span>The law as at November 2026 (built in)</span>
              )}
            </div>
            <div className="sr-glance" role="table" aria-label="Rates at a glance">
              <div className="sr-glance-head" role="row">
                <span role="columnheader">Scheme</span>
                <span role="columnheader">Employee</span>
                <span role="columnheader">Employer</span>
              </div>
              {glance(s, data.month).map((g) => (
                <div key={g.key} className="sr-glance-row" role="row">
                  <span role="rowheader" data-no-translate>
                    {g.label}
                  </span>
                  <span role="cell">{g.ee}</span>
                  <span role="cell">{g.er}</span>
                </div>
              ))}
            </div>
            <p className="sr-sum-note">EPF employer: wages up to the limit. LINDUNG: this month&apos;s rate.</p>
            {next && (
              <div className="sr-sum-next" role="status">
                <span>Next change</span> <b>{monthText(next.effectiveFrom)}</b>
              </div>
            )}
            {data.canSet && (
              <button type="button" className="btn btn-primary sr-sum-btn" onClick={onChange}>
                Change rates
              </button>
            )}
            <p className="sr-sum-foot">Each pay run reads the rates in force for its own month.</p>
          </div>
        </aside>

        <div className="sr-main">
          {views.map((v) => (
            <SchemeCard key={v.id} id={v.id} short={v.short} name={v.name} malay={v.malay}>
              <RateTable rows={v.rows} />
              <Facts items={v.facts} />
            </SchemeCard>
          ))}

          {s.others.length > 0 && (
            <SchemeCard id="others" short="New contributions" name="Added by the CEO when the law brought them" malay="">
              <OthersTable others={s.others} />
            </SchemeCard>
          )}

          <section className="sr-card sr-elsewhere" aria-labelledby="sr-else-h">
            <header className="sr-card-head">
              <div className="sr-card-title">
                <h2 id="sr-else-h">Set on other screens</h2>
                <p>Not changed here, so each has one place.</p>
              </div>
            </header>
            <div className="sr-card-body">
              <div className="sr-links">
                <div className="sr-link">
                  <span className="sr-link-text">
                    <b>PCB (income tax)</b>
                    <span>From LHDN&apos;s e-PCB. The salary calculator shows an estimate.</span>
                  </span>
                  <a className="btn btn-sm" href="#salarycalc">
                    Salary calculator
                  </a>
                </div>
                <div className="sr-link">
                  <span className="sr-link-text">
                    <b>Minimum wage, day divisor, overtime and public holiday rates</b>
                    <span>The pay law and each site&apos;s pay formula.</span>
                  </span>
                  <a className="btn btn-sm" href="#payformulas">
                    Pay formulas
                  </a>
                </div>
              </div>
            </div>
          </section>

          <section className="sr-card" id="sr-history" aria-labelledby="sr-history-h">
            <header className="sr-card-head">
              <div className="sr-card-title">
                <h2 id="sr-history-h">Changes</h2>
                <p>Newest first. Each shows who set it, why, the law, and what it changed.</p>
              </div>
            </header>
            <div className="sr-card-body">
              {rows.length ? (
                <ol className="sr-history">
                  {rows.map(({ v, state, changes: ch }) => (
                    <li key={v.id} className="sr-version" data-state={state}>
                      <div className="sr-version-head">
                        <span className="sr-version-month">
                          <span>From</span> <b>{monthText(v.effectiveFrom)}</b>
                        </span>
                        <Chip tone={STATE[state][0]}>{STATE[state][1]}</Chip>
                      </div>
                      <div className="sr-version-by">
                        <span data-no-translate>{v.setBy}</span> · {dateTimeLabel(v.setAt)}
                      </div>
                      <p className="sr-version-why" data-no-translate>
                        {v.reason}
                      </p>
                      <p className="sr-version-law">
                        <span className="sr-version-k">Law</span> <span data-no-translate>{v.settings.lawRef}</span>
                      </p>
                      {ch.length > 0 ? (
                        <details className="sr-version-diff">
                          <summary>
                            <span>What changed</span> <span className="sr-count">{ch.length}</span>
                          </summary>
                          <ChangeTable rows={ch} before="Before" after="After" />
                        </details>
                      ) : (
                        <p className="sr-version-same">Rates unchanged: the law reference and reason were recorded.</p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="sr-empty">
                  <b>No change yet</b>
                  <span>The law as at November 2026 applies.</span>
                </div>
              )}
              <p className="sr-law">
                <span className="sr-version-k">Law in force</span> <span data-no-translate>{s.lawRef}</span>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ChangeTable({ rows, before, after }: { rows: { key: string; scheme: string; label: string; before: string; after: string }[]; before: string; after: string }) {
  return (
    <div className="sr-table-wrap">
      <table className="sr-table sr-diff">
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">{before}</th>
            <th scope="col">{after}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.key}>
              <th scope="row">
                <span className="sr-who-note" data-no-translate>
                  {c.scheme}
                </span>
                <span className="sr-who">{c.label}</span>
              </th>
              <td className="sr-was">{c.before}</td>
              <td className="sr-new">{c.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The CEO's change: steps, checked as typed, then a review before saving
// ---------------------------------------------------------------------------------------------------------------------

function Step({ n, id, title, help, children }: { n: number; id: string; title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="sc-step sr-step" aria-labelledby={`${id}-h`} id={id}>
      <header className="sc-step-head">
        <span className="sc-step-no" aria-hidden="true">
          {n}
        </span>
        <div className="sc-step-title">
          <h2 id={`${id}-h`}>{title}</h2>
          {help && <p>{help}</p>}
        </div>
      </header>
      <div className="sc-step-body">{children}</div>
    </section>
  );
}

const SCHEME_HELP: Record<SchemeId, string> = {
  epf: 'Never on overtime. Foreign workers pay the foreign rates at every age.',
  socso: 'On wages up to the cap.',
  eis: 'On wages up to the cap, for the ages below.',
  lindung: 'Paid by the employee only. Malaysians may opt out with a form on file.',
  hrd: 'Paid by the employer only.',
};

function Editor({ data, onClose }: { data: Board; onClose: () => void }) {
  const { lang } = useLang();
  const act = useAction();
  const earliest = prevMonth(data.month);
  const [from, setFrom] = useState(data.month);
  const [base, setBase] = useState<StatutorySettings>(() => startFor(data.versions, data.month));
  const [d, setD] = useState<Draft>(() => draftOf(startFor(data.versions, data.month)));
  const [others, setOthers] = useState<OtherDraft[]>(() => startFor(data.versions, data.month).others.map(otherDraftOf));
  const [lawRef, setLawRef] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState(false);

  const fresh = JSON.stringify(d) === JSON.stringify(draftOf(base)) && JSON.stringify(others) === JSON.stringify(base.others.map(otherDraftOf));
  const after = settingsOf(base, d, others, lawRef.trim() || base.lawRef);
  // What changed so far, counting only boxes that read well (a box still to fix shows as unchanged until fixed).
  const baseDraft = draftOf(base);
  const readable = Object.fromEntries(FIELDS.map((f) => [f.key, fieldProblem(f, d[f.key] ?? '', d) ? baseDraft[f.key] : d[f.key]]));
  const diff = changes(base, settingsOf(base, readable, others.filter((o, i) => !Object.keys(otherProblems(o, others, i)).length), after.lawRef));
  const problems = draftProblems(base, d, others, lawRef, reason, from, earliest);
  const sameMonth = data.versions.find((v) => !v.replacedBy && v.effectiveFrom === from);
  const touch = (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const showAll = () => setTouched(Object.fromEntries([...FIELDS.map((f) => [f.key, true]), ['lawRef', true], ['reason', true], ...others.flatMap((_, i) => Object.keys(BLANK_OTHER).map((k) => [`o${i}.${k}`, true]))]));

  // A new month: the boxes start from what is in force that month, unless something was already typed.
  const pickMonth = (m: string) => {
    setFrom(m);
    if (!/^\d{4}-\d{2}$/.test(m) || !fresh) return;
    const s = startFor(data.versions, m);
    setBase(s);
    setD(draftOf(s));
    setOthers(s.others.map(otherDraftOf));
  };
  const close = () => {
    if (!fresh || lawRef.trim() || reason.trim()) {
      if (!window.confirm(tr('Leave without saving? What you typed is not kept.', lang))) return;
    }
    onClose();
  };
  const goReview = () => {
    showAll();
    if (problems.length) {
      // After the boxes show their problems: bring the first one into view.
      window.setTimeout(() => document.querySelector('.sr-page [aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    setReview(true);
    toTop();
  };
  const save = async () => {
    const r = await act.run(
      () =>
        api.setStatutory({
          effectiveFrom: from,
          reason,
          settings: settingsOf(base, d, others, lawRef),
        }),
      'Saved. Pay prepared for that month onwards uses the new settings; recalculate any draft month.',
    );
    if (r !== undefined) onClose();
  };

  const field = (f: Field) => {
    const id = `sr-f-${f.key.replace('.', '-')}`;
    const typed = d[f.key] ?? '';
    const was = baseDraft[f.key];
    if (f.kind === 'flag')
      return (
        <label key={f.key} className="sc-check sr-flag" data-changed={typed !== was || undefined}>
          <input type="checkbox" checked={typed === 'yes'} onChange={(e) => setD({ ...d, [f.key]: e.target.checked ? 'yes' : 'no' })} />
          <span>{f.label}</span>
        </label>
      );
    const problem = touched[f.key] || typed !== was ? fieldProblem(f, typed, d) : null;
    const nowText = f.kind === 'optRate' && was === '' ? 'Dated rule' : f.kind === 'money' ? rmText(Number(was)) : f.kind === 'age' ? was : `${was}%`;
    return (
      <div key={f.key} className="sc-field sr-field" data-changed={typed !== was || undefined}>
        <label htmlFor={id} className="sc-label">
          {f.label}
        </label>
        <div className="sc-money" data-invalid={problem ? '' : undefined}>
          {f.kind === 'money' && (
            <span className="sc-unit" aria-hidden="true">
              RM
            </span>
          )}
          <input
            id={id}
            className="sc-input sc-num"
            type="text"
            inputMode={f.kind === 'age' ? 'numeric' : 'decimal'}
            autoComplete="off"
            enterKeyHint="next"
            value={typed}
            placeholder={f.kind === 'optRate' ? 'Rule' : undefined}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setD({ ...d, [f.key]: e.target.value })}
            onFocus={(e) => e.target.select()}
            onBlur={() => touch(f.key)}
          />
          {(f.kind === 'rate' || f.kind === 'optRate' || f.kind === 'age') && (
            <span className="sc-unit sc-unit-after" aria-hidden="true">
              {f.kind === 'age' ? 'years' : '%'}
            </span>
          )}
        </div>
        <span id={`${id}-hint`} className={problem ? 'sc-error' : 'sc-hint'} role={problem ? 'alert' : undefined}>
          {problem ?? (
            <>
              <span className="sr-now">
                <span>{typed !== was ? 'Was' : 'Now'}</span> <b>{nowText}</b>
              </span>
              {f.hint && <span className="sr-field-hint">{f.hint}</span>}
            </>
          )}
        </span>
      </div>
    );
  };

  const setOther = (i: number, patch: Partial<OtherDraft>) => setOthers((o) => o.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const otherBox = (i: number, k: keyof OtherDraft, label: string, opts: { unit?: string; before?: string; mode?: 'decimal' | 'numeric' | 'text'; hint?: string; upper?: boolean } = {}) => {
    const o = others[i];
    const id = `sr-o${i}-${k}`;
    const p = otherProblems(o, others, i)[k];
    const show = p && (touched[`o${i}.${k}`] || String(o[k]) !== '') ? p : null;
    return (
      <div className="sc-field">
        <label htmlFor={id} className="sc-label">
          {label}
        </label>
        <div className="sc-money" data-invalid={show ? '' : undefined}>
          {opts.before && (
            <span className="sc-unit" aria-hidden="true">
              {opts.before}
            </span>
          )}
          <input
            id={id}
            className={`sc-input${opts.mode === 'text' ? '' : ' sc-num'}`}
            type="text"
            inputMode={opts.mode ?? 'text'}
            autoComplete="off"
            value={String(o[k])}
            aria-invalid={show ? true : undefined}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setOther(i, { [k]: opts.upper ? e.target.value.toUpperCase() : e.target.value } as Partial<OtherDraft>)}
            onBlur={() => touch(`o${i}.${k}`)}
          />
          {opts.unit && (
            <span className="sc-unit sc-unit-after" aria-hidden="true">
              {opts.unit}
            </span>
          )}
        </div>
        <span id={`${id}-hint`} className={show ? 'sc-error' : 'sc-hint'} role={show ? 'alert' : undefined}>
          {show ?? opts.hint ?? ''}
        </span>
      </div>
    );
  };

  const bar = (
    <div className="sc-bar sr-bar" role="region" aria-label="Your change">
      <div className="sc-bar-main">
        <span className="sc-bar-label">From</span>
        <strong className="sr-bar-month">{/^\d{4}-\d{2}$/.test(from) ? monthText(from) : '–'}</strong>
      </div>
      <div className="sc-bar-sub">
        <span>
          <span>Changes</span> <b>{diff.length}</b>
        </span>
        <span data-tone={problems.length ? 'warn' : undefined}>
          <span>To fix</span> <b>{problems.length}</b>
        </span>
      </div>
      {review ? (
        <button type="button" className="btn btn-primary btn-sm sr-bar-go" disabled={act.busy} onClick={save}>
          Save
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-sm sr-bar-go" onClick={goReview}>
          Review
        </button>
      )}
    </div>
  );

  if (review)
    return (
      <div className="page sr-page sc-page">
        <Head />
        <div className="sr-layout sr-layout-review">
          <div className="sr-main">
            <Step n={1} id="sr-review" title="Check before saving" help="Nothing is saved until you press Save. Pay prepared for that month onwards uses these rates; recalculate any draft month.">
              <dl className="sr-review-facts">
                <div>
                  <dt>Starts</dt>
                  <dd>{monthText(from)}</dd>
                </div>
                <div>
                  <dt>Law or gazette reference</dt>
                  <dd data-no-translate>{lawRef}</dd>
                </div>
                <div>
                  <dt>Why it changes</dt>
                  <dd data-no-translate>{reason}</dd>
                </div>
              </dl>
              {sameMonth && (
                <div className="notice" data-tone="warn">
                  A change from this month is already saved. Saving replaces it; it stays in the history as replaced.
                </div>
              )}
              {diff.length ? (
                <ChangeTable rows={diff} before="Now" after="New" />
              ) : (
                <div className="notice" data-tone="info">
                  No rate changes: this records the law reference and the reason from that month.
                </div>
              )}
              <ErrorNotice error={act.error} />
              <div className="sr-actions">
                <button type="button" className="btn" disabled={act.busy} onClick={() => setReview(false)}>
                  Back to edit
                </button>
                <button type="button" className="btn btn-primary" disabled={act.busy} onClick={save}>
                  {act.busy ? 'Saving…' : 'Save from ' + monthText(from)}
                </button>
              </div>
            </Step>
          </div>
        </div>
        {bar}
      </div>
    );

  let n = 1;
  return (
    <div className="page sr-page sc-page">
      <Head
        actions={
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
        }
      />
      <div className="sr-layout sr-layout-edit">
        <div className="sr-main">
          <Step n={n++} id="sr-when" title="When it starts" help="From last month at the earliest. Pay prepared for that month onwards uses the new rates.">
            <div className="sc-grid sc-grid-2">
              <div className="sc-field">
                <label htmlFor="sr-from" className="sc-label">
                  From month<span className="sc-req">Required</span>
                </label>
                <input
                  id="sr-from"
                  className="input sr-month"
                  type="month"
                  min={earliest}
                  value={from}
                  aria-invalid={from < earliest || undefined}
                  onChange={(e) => pickMonth(e.target.value)}
                />
                <span className={from && from < earliest ? 'sc-error' : 'sc-hint'}>
                  {from && from < earliest ? (
                    'A change can start from last month at the earliest.'
                  ) : (
                    <span>
                      <span>The boxes start from the rates in force for</span> <b>{/^\d{4}-\d{2}$/.test(from) ? monthText(from) : '–'}</b>
                    </span>
                  )}
                </span>
              </div>
            </div>
            {sameMonth && (
              <div className="notice small" data-tone="warn">
                A change from this month is already saved. Saving replaces it; it stays in the history as replaced.
              </div>
            )}
          </Step>

          {SCHEMES.map((sc) => {
            const fs = FIELDS.filter((f) => f.scheme === sc.id);
            const groups = [...new Set(fs.map((f) => f.group))];
            return (
              <Step key={sc.id} n={n++} id={`sr-e-${sc.id}`} title={`${sc.short} (${sc.malay})`} help={SCHEME_HELP[sc.id]}>
                {groups.map((g) => (
                  <div key={g} className="sc-group" role="group" aria-label={g}>
                    {groups.length > 1 && <span className="sc-group-title">{g}</span>}
                    <div className="sc-grid sr-grid">{fs.filter((f) => f.group === g).map(field)}</div>
                  </div>
                ))}
              </Step>
            );
          })}

          <Step n={n++} id="sr-e-others" title="New contributions" help="Only when the law brings a new fund or levy. Up to 10.">
            {others.length === 0 && <p className="sr-empty-line">None. Add one only when a new law needs it.</p>}
            {others.map((o, i) => (
              <div key={i} className="sr-other" role="group" aria-label={o.name || o.code || 'New contribution'}>
                <div className="sr-other-head">
                  <b data-no-translate={o.code ? true : undefined}>{o.code || 'New contribution'}</b>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOthers((x) => x.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                </div>
                <div className="sc-grid sr-grid">
                  {otherBox(i, 'code', 'Code', { mode: 'text', upper: true, hint: 'Short, in capitals' })}
                  {otherBox(i, 'name', 'Name', { mode: 'text' })}
                  {otherBox(i, 'eeRate', 'Employee', { unit: '%', mode: 'decimal' })}
                  {otherBox(i, 'erRate', 'Employer', { unit: '%', mode: 'decimal' })}
                  {otherBox(i, 'wageCap', 'Wage cap', { before: 'RM', mode: 'decimal', hint: 'Empty: no cap' })}
                  {otherBox(i, 'maxAge', 'Stops at age', { unit: 'years', mode: 'numeric', hint: 'Empty: all ages' })}
                  {otherBox(i, 'payee', 'Paid to', { mode: 'text' })}
                  <div className="sc-field">
                    <span className="sc-label" id={`sr-o${i}-to`}>
                      Applies to
                    </span>
                    <div className="seg sc-seg" role="group" aria-labelledby={`sr-o${i}-to`}>
                      {(
                        [
                          ['all', 'Everyone'],
                          ['malaysian', 'Malaysians'],
                          ['foreign', 'Foreign workers'],
                        ] as const
                      ).map(([v, label]) => (
                        <button key={v} type="button" aria-pressed={o.appliesTo === v} onClick={() => setOther(i, { appliesTo: v })}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <label className="sc-check">
                  <input type="checkbox" checked={o.includeOt} onChange={(e) => setOther(i, { includeOt: e.target.checked })} />
                  <span>Overtime counts as wages for it</span>
                </label>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-sm" disabled={others.length >= 10} onClick={() => setOthers((x) => [...x, { ...BLANK_OTHER }])}>
                Add a contribution
              </button>
            </div>
          </Step>

          <Step n={n++} id="sr-e-why" title="Why it changes" help="Both are kept with the change and shown in the history.">
            <div className="sc-grid sc-grid-2">
              <div className="sc-field">
                <label htmlFor="sr-law" className="sc-label">
                  Law or gazette reference<span className="sc-req">Required</span>
                </label>
                <input
                  id="sr-law"
                  className="input"
                  value={lawRef}
                  maxLength={300}
                  aria-invalid={touched.lawRef && lawRef.trim().length < 5 ? true : undefined}
                  onChange={(e) => setLawRef(e.target.value)}
                  onBlur={() => touch('lawRef')}
                />
                <span className={touched.lawRef && lawRef.trim().length < 5 ? 'sc-error' : 'sc-hint'}>
                  {touched.lawRef && lawRef.trim().length < 5 ? 'Give the law or gazette reference.' : 'For example the act, schedule or gazette and its date.'}
                </span>
              </div>
              <div className="sc-field">
                <label htmlFor="sr-reason" className="sc-label">
                  Why it changes<span className="sc-req">Required</span>
                </label>
                <textarea
                  id="sr-reason"
                  className="input sr-reason"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  aria-invalid={touched.reason && reason.trim().length < 5 ? true : undefined}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => touch('reason')}
                />
                <span className={touched.reason && reason.trim().length < 5 ? 'sc-error' : 'sc-hint'}>
                  {touched.reason && reason.trim().length < 5 ? 'Say why the rates change.' : 'At least 5 letters.'}
                </span>
              </div>
            </div>
          </Step>
        </div>

        <aside className="sr-summary sr-summary-edit" aria-labelledby="sr-edit-h">
          <div className="sr-sum-card">
            <h2 id="sr-edit-h" className="sr-sum-title">
              Your change
            </h2>
            <p className="sr-sum-month">
              <span>From</span> {/^\d{4}-\d{2}$/.test(from) ? monthText(from) : '–'}
            </p>
            {diff.length ? (
              <ul className="sr-sum-changes">
                {diff.slice(0, 8).map((c) => (
                  <li key={c.key}>
                    <span className="sr-sum-ch-label">
                      <span data-no-translate>{c.scheme}</span> · {c.label}
                    </span>
                    <span className="sr-sum-ch-val">
                      <s>{c.before}</s> <b>{c.after}</b>
                    </span>
                  </li>
                ))}
                {diff.length > 8 && (
                  <li className="sr-sum-more">
                    <span>And more</span> <b>{diff.length - 8}</b>
                  </li>
                )}
              </ul>
            ) : (
              <p className="sr-sum-none">No rate changed yet.</p>
            )}
            {problems.length > 0 && (touched.lawRef || touched.reason || Object.keys(touched).length > 2) && (
              <div className="sr-sum-fix" role="status">
                <b>To fix before review</b>
                <ul>
                  {problems.slice(0, 5).map((p, i) => (
                    <li key={i}>
                      {p.where && (
                        <span className="sr-fix-where" data-no-translate={p.whereRaw || undefined}>
                          {p.where}
                        </span>
                      )}
                      {p.label && <span className="sr-fix-where">{p.label}</span>}
                      <span>{p.text}</span>
                    </li>
                  ))}
                  {problems.length > 5 && (
                    <li>
                      <span>And more</span> <b>{problems.length - 5}</b>
                    </li>
                  )}
                </ul>
              </div>
            )}
            <button type="button" className="btn btn-primary sr-sum-btn" onClick={goReview}>
              Review and save
            </button>
            <button type="button" className="btn btn-ghost sr-sum-btn" onClick={close}>
              Cancel
            </button>
            <p className="sr-sum-foot">Only the CEO saves a change. The server checks it again.</p>
          </div>
        </aside>
      </div>
      {bar}
    </div>
  );
}
