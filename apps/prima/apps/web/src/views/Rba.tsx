import { useState } from 'react';
import { api, type EthicsBoard, type RbaBoard, type RbaTraceBoard, type WorkerFilesBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, useAction, useLoad, type Tone } from '../ui';

/**
 * RBA readiness (Fauzan, 8 Nov 2026, after the RBA Code v8.0 checklist review): the monthly dashboard, red items that
 * go to ACT, the Chief of Staff and the COO the same day, the OM's monthly site safety check, the yearly committee the
 * CoS names, ACT's trace review, the worker master file and the yearly ethics declaration. Discipline appeals are the
 * HR appeal step (HR-APPEAL, IWAY). Prima keeps the
 * records; it is not an RBA certificate, and nothing is shown green until there is something to count.
 */

type Tab = 'dashboard' | 'red' | 'sites' | 'committee' | 'trace' | 'files' | 'ethics';
const KPI_TONE: Record<'green' | 'red' | 'unknown', Tone> = { green: 'ok', red: 'crit', unknown: 'unknown' };
const FOLDER: Record<'ok' | 'missing' | 'in_ja' | 'na', { t: string; tone: Tone }> = {
  ok: { t: 'On file', tone: 'ok' },
  missing: { t: 'Missing', tone: 'crit' },
  in_ja: { t: 'In JA', tone: 'info' },
  na: { t: 'Not needed', tone: 'neutral' },
};
const ROLE_LABEL: Record<string, string> = {
  act: 'ACT',
  leader: 'Group leadership',
  hr: 'HR',
  fwm: 'FWM',
  committee: 'RBA committee',
  company: 'Company office',
  ops: 'Operations',
};

export function RbaView() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const board = useLoad(() => api.rbaBoard(companyId), [companyId]);
  // Everyone in the office signs the yearly ethics declaration, even without an RBA role.
  if (board.error)
    return (
      <div className="page">
        <div className="page-head">
          <h1>RBA readiness</h1>
        </div>
        <EthicsTab companyId={null} />
      </div>
    );
  if (!board.data)
    return (
      <div className="page">
        <Loading what="RBA readiness" />
      </div>
    );
  const b = board.data;
  const cid = b.companyId;
  const tabs: [Tab, string][] = [
    ...(b.role !== 'ops' ? ([['dashboard', 'Dashboard'], ['red', `Red items (${b.red.length})`]] as [Tab, string][]) : []),
    ['sites', `Site checks (${b.siteChecks.filter((s) => s.overdue).length} due)`],
    ['committee', 'Committee'],
    ...(b.role !== 'ops' && b.role !== 'fwm' ? ([['trace', 'Trace review']] as [Tab, string][]) : []),
    ...(b.can.files ? ([['files', 'Worker files']] as [Tab, string][]) : []),
    ['ethics', 'Ethics declaration'],
  ];
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0];
  return (
    <div className="page">
      <div className="page-head">
        <h1>RBA readiness</h1>
        {b.companies.length > 1 && (
          <select className="select" aria-label="Company" value={cid ?? ''} onChange={(e) => setCompanyId(e.target.value)}>
            {b.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <span className="muted small">
        You see this as {ROLE_LABEL[b.role] ?? b.role}. Records for the RBA Code v8.0 checklist; this is not a certificate. Unknown means nothing to count yet, never green.
      </span>
      <div className="tabbar" role="tablist" aria-label="RBA" style={{ flexWrap: 'wrap' }}>
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {current === 'dashboard' && <Dashboard b={b} />}
      {current === 'red' && <RedItems b={b} />}
      {current === 'sites' && <SiteChecks b={b} />}
      {current === 'committee' && <Committee b={b} />}
      {current === 'trace' && cid && <TraceTab companyId={cid} />}
      {current === 'files' && cid && <FilesTab companyId={cid} />}
      {current === 'ethics' && <EthicsTab companyId={b.role === 'company' ? cid : null} />}
    </div>
  );
}

function Dashboard({ b }: { b: RbaBoard }) {
  if (!b.dashboard.length) return <div className="empty">Choose a company to see its monthly targets.</div>;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Monthly targets</h3>
      </div>
      <div className="kpis">
        {b.dashboard.map((k) => (
          <Kpi key={k.key} label={k.label} value={k.value == null ? 'UNKNOWN' : k.unit === 'pct' ? `${k.value}%` : k.value} note={`${k.unit === 'pct' ? `Target ${k.target}%` : `Target ${k.target}`} · ${k.detail}`} tone={KPI_TONE[k.state]} />
        ))}
      </div>
    </section>
  );
}

function RedItems({ b }: { b: RbaBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Red items</h3>
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        A gap graded red on a site's RBA list goes the same day to ACT, the Chief of Staff and the COO. It clears when the item is checked again as met.
      </span>
      <div className="list">
        {!b.red.length && <div className="empty">No red items.</div>}
        {b.red.map((x) => (
          <div key={`${x.codeId}-${x.reqCode}`} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>
                {x.site}: {x.reqCode} {x.text}
              </strong>
              <Chip tone="crit">Red</Chip>
            </div>
            <span className="muted small">
              {x.codeName} · graded by {x.by} on {x.at.slice(0, 10)} · {x.note}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SiteChecks({ b }: { b: RbaBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Monthly site safety check</h3>
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        The OM who covers the site does the site inspection on the site's client requirements page (Sites, then the site). Sites with an RBA list are checked every 30 days unless the list says otherwise.
      </span>
      <div className="list">
        {!b.siteChecks.length && <div className="empty">No site has a client list with a regular site check.</div>}
        {b.siteChecks.map((s) => (
          <div key={s.codeId} className="list-item">
            <span>
              <strong>{s.site}</strong>
              <span className="muted small"> · {s.codeName} · every {s.everyDays} days</span>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span className="muted small">{s.lastOn ? `Last ${s.lastOn}, due ${s.dueOn}` : 'Never checked'}</span>
              <Chip tone={s.overdue ? 'crit' : 'ok'}>{s.overdue ? 'Due' : 'Done'}</Chip>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Committee({ b }: { b: RbaBoard }) {
  const c = b.committee;
  const act = useAction();
  const [edit, setEdit] = useState(false);
  const [picked, setPicked] = useState<string[]>(c.current?.members.filter((m) => m.userId).map((m) => m.userId!) ?? []);
  const [others, setOthers] = useState('');
  const [note, setNote] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>RBA committee {c.year}</h3>
        {c.canName && !edit && (
          <button className="btn btn-sm" onClick={() => setEdit(true)}>
            {c.current ? 'Change members' : 'Name the committee'}
          </button>
        )}
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        The Operations Director and a few company heads; the Chief of Staff chooses the members every year (Fauzan, 7 Nov 2026). Each company head sees their own company here; the Operations Director sees every company.
      </span>
      <ErrorNotice error={act.error} />
      {!edit && (
        <div className="list">
          {!c.current && <div className="empty">Not named yet for {c.year}.</div>}
          {c.current?.members.map((m, i) => (
            <div key={i} className="list-item">
              <span>{m.name}</span>
              <Chip tone="neutral">{m.seat === 'ops_director' ? 'Operations Director' : m.seat === 'company_head' ? 'Company head' : 'Member'}</Chip>
            </div>
          ))}
          {c.current && (
            <div className="muted small" style={{ padding: 12 }}>
              Named by {c.current.namedBy} on {c.current.at.slice(0, 10)}
              {c.current.note ? ` · ${c.current.note}` : ''}
            </div>
          )}
        </div>
      )}
      {edit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
          {c.candidates.map((u) => (
            <label key={u.userId} className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={picked.includes(u.userId)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.userId] : picked.filter((x) => x !== u.userId))} />
              <span>
                {u.name} <span className="muted small">({u.seat === 'ops_director' ? 'Operations Director' : `Company head${u.company ? `, ${u.company}` : ''}`})</span>
              </span>
            </label>
          ))}
          <input className="input" aria-label="Other members" placeholder="Other members without a sign-in, separated by commas (optional)" value={others} onChange={(e) => setOthers(e.target.value)} />
          <input className="input" aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !picked.length}
              onClick={async () => {
                const r = await act.run(
                  () => api.nameRbaCommittee({ memberUserIds: picked, others: others.split(',').map((x) => ({ name: x.trim() })).filter((x) => x.name), note }),
                  'Committee named.',
                );
                if (r) setEdit(false);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setEdit(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function TraceTab({ companyId }: { companyId: string }) {
  const board = useLoad(() => api.rbaTraceBoard(companyId), [companyId]);
  const act = useAction();
  const lastMonth = (() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const [period, setPeriod] = useState(lastMonth);
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="trace reviews" />;
  const t: RbaTraceBoard = board.data;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Trace review: {t.company.name}</h3>
      </div>
      <span className="muted small" style={{ padding: '0 12px' }}>
        ACT takes {t.rule.value.traceSampleSize} workers for a month, foreign workers first, and checks the roster, the clock, the pay line and the bank proof agree. Guard pay is still in trial, so JA keeps the bank proof.
      </span>
      <ErrorNotice error={act.error} />
      {t.canRun && (
        <div className="row" style={{ gap: 6, padding: 12 }}>
          <input className="input" type="month" aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={act.busy || !period} onClick={() => act.run(() => api.runRbaTrace(companyId, period), 'Trace review done.')}>
            Run the trace
          </button>
        </div>
      )}
      {!t.reviews.length && <div className="empty">No trace review yet.</div>}
      {t.reviews.map((r) => (
        <div key={r.id} className="panel" style={{ margin: 12, padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>
              {r.ref} · {r.period}
            </strong>
            <span className="muted small">
              {r.rows.length} workers · {r.rows.filter((x) => x.mismatches.length).length} with a mismatch · by {r.by.name}
            </span>
          </div>
          <div className="list">
            {r.rows.map((x) => (
              <TraceRowItem key={x.personId} reviewId={r.id} row={x} canSettle={t.canRun} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function TraceRowItem({ reviewId, row: x, canSettle }: { reviewId: string; row: RbaTraceBoard['reviews'][number]['rows'][number]; canSettle: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const open = x.mismatches.length > 0 && (!x.outcome || x.outcome.kind === 'finding');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>
          <strong>{x.staffNo}</strong> {x.name} <span className="muted small">({x.nationality})</span>
        </span>
        <span className="muted small">
          Roster {x.rosterHours}h · clock {x.clockedHours}h · paid days {x.payDays ?? 'none'} · {x.paid.replace('_', ' ')}
        </span>
        <Chip tone={!x.mismatches.length ? 'ok' : x.outcome && x.outcome.kind !== 'finding' ? 'neutral' : 'crit'}>
          {!x.mismatches.length ? 'Agrees' : x.outcome ? x.outcome.kind : 'Mismatch'}
        </Chip>
      </div>
      {x.mismatches.map((m, i) => (
        <span key={i} className="small">
          · {m}
        </span>
      ))}
      {x.outcome && (
        <span className="muted small">
          {x.outcome.by}: {x.outcome.note}
        </span>
      )}
      <ErrorNotice error={act.error} />
      {canSettle && open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="What was found" placeholder="What was found and what was done" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          {(x.outcome?.kind === 'finding' ? (['corrected'] as const) : (['explained', 'corrected', 'finding'] as const)).map((k) => (
            <button key={k} className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => act.run(() => api.settleRbaTraceRow(reviewId, x.personId, { kind: k, note }), 'Recorded.')}>
              {k === 'explained' ? 'Explained' : k === 'corrected' ? 'Corrected' : 'Finding'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilesTab({ companyId }: { companyId: string }) {
  const board = useLoad(() => api.workerFiles(companyId), [companyId]);
  const [open, setOpen] = useState<string | null>(null);
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="worker files" />;
  const f: WorkerFilesBoard = board.data;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Foreign worker files: {f.company.name}</h3>
        </div>
        <span className="muted small" style={{ padding: '0 12px' }}>
          Nine folders per worker, from the records Prima keeps. "In JA" means the JA Group app keeps it while guards stay there.
        </span>
        <div className="list">
          {!f.rows.length && <div className="empty">No foreign workers in this company.</div>}
          {f.rows.map((r) => (
            <div key={r.personId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <button className="row btn-ghost" style={{ justifyContent: 'space-between', gap: 8, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(open === r.personId ? null : r.personId)}>
                <span>
                  <strong>{r.staffNo}</strong> {r.name} <span className="muted small">({r.status})</span>
                </span>
                <Chip tone={r.missing ? 'crit' : 'ok'}>{r.missing ? `${r.missing} missing` : 'Complete'}</Chip>
              </button>
              {open === r.personId &&
                r.folders.map((x) => (
                  <div key={x.key} className="row" style={{ justifyContent: 'space-between', gap: 8, paddingLeft: 12 }}>
                    <span className="small">
                      {x.label} <span className="muted">· {x.detail}</span>
                    </span>
                    <Chip tone={FOLDER[x.state].tone}>{FOLDER[x.state].t}</Chip>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>
      {f.contractsMissing && (
        <section className="panel">
          <div className="panel-head">
            <h3>Guards with no signed contract on file ({f.contractsMissing.length})</h3>
          </div>
          <div className="list">
            {!f.contractsMissing.length && <div className="empty">Every guard and officer has a signed agreement on file.</div>}
            {f.contractsMissing.map((p) => (
              <div key={p.personId} className="list-item">
                <span>
                  <strong>{p.staffNo}</strong> {p.name}
                </span>
                <span className="muted small">{p.nationality}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function EthicsTab({ companyId }: { companyId: string | null }) {
  const board = useLoad(() => api.ethicsBoard(companyId), [companyId]);
  const act = useAction();
  const [ticked, setTicked] = useState<string[]>([]);
  const [interests, setInterests] = useState('');
  const [none, setNone] = useState(false);
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="ethics declaration" />;
  const e: EthicsBoard = board.data;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>My {e.year} ethics declaration</h3>
        </div>
        <ErrorNotice error={act.error} />
        {e.mine ? (
          <div style={{ padding: 12 }}>
            <Chip tone="ok">Signed {e.mine.at.slice(0, 10)}</Chip>
            <div className="muted small" style={{ marginTop: 6 }}>
              {e.mine.interestsNone ? 'No interests declared.' : `Interests: ${e.mine.interests}`}
              {e.mine.review ? ` · ACT: ${e.mine.review.action === 'managed' ? 'managed' : 'no conflict'}` : ''}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
            {e.statements.map((s) => (
              <label key={s.key} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={ticked.includes(s.key)} onChange={(ev) => setTicked(ev.target.checked ? [...ticked, s.key] : ticked.filter((x) => x !== s.key))} />
                <span>{s.text}</span>
              </label>
            ))}
            <textarea className="input" aria-label="Interests" rows={3} placeholder="Interests that could conflict with your work, such as a relative at a supplier or a side business" value={interests} disabled={none} onChange={(ev) => setInterests(ev.target.value)} />
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={none} onChange={(ev) => setNone(ev.target.checked)} />
              <span>I have no such interests</span>
            </label>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || ticked.length < e.statements.length || (!none && interests.trim().length < 10)}
              onClick={() => act.run(() => api.signEthicsDeclaration({ statements: ticked, interests: none ? '' : interests, interestsNone: none }), 'Declaration signed.')}
            >
              Sign
            </button>
          </div>
        )}
      </section>
      {e.list && (
        <section className="panel">
          <div className="panel-head">
            <h3>
              {e.year}: {e.list.signed.length} signed, {e.list.missing.length} not yet
            </h3>
          </div>
          <div className="list">
            {e.list.signed
              .filter((d) => !d.interestsNone)
              .map((d) => (
                <InterestRow key={d.id} d={d} canReview={e.canReview} />
              ))}
            {e.list.missing.map((m) => (
              <div key={m.userId} className="list-item">
                <span>
                  {m.name} <span className="muted small">{m.title}</span>
                </span>
                <Chip tone="warn">Not signed</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function InterestRow({ d, canReview }: { d: NonNullable<EthicsBoard['list']>['signed'][number]; canReview: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span>
          <strong>{d.name}</strong> declared: {d.interests}
        </span>
        <Chip tone={d.review ? 'ok' : 'warn'}>{d.review ? (d.review.action === 'managed' ? 'Managed' : 'No conflict') : 'For ACT review'}</Chip>
      </div>
      {d.review && <span className="muted small">{d.review.by}: {d.review.note}</span>}
      <ErrorNotice error={act.error} />
      {canReview && !d.review && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Review note" placeholder="Reason, and what was put in place if managed" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => act.run(() => api.reviewEthicsInterests(d.id, { action: 'no_conflict', note }), 'Recorded.')}>
            No conflict
          </button>
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => act.run(() => api.reviewEthicsInterests(d.id, { action: 'managed', note }), 'Recorded.')}>
            Managed
          </button>
        </div>
      )}
    </div>
  );
}
