import { useState } from 'react';
import {
  SOCSO_STATUS_LABEL,
  SOCSO_TYPE_DETAIL,
  SOCSO_TYPE_LABEL,
  SOCSO_RESTRICTION_LABEL,
  socsoTriage,
  type SocsoRestrictionKind,
  type Nationality,
  type ProofInput,
  type SocsoCaseType,
  type SocsoStatus,
} from '@prima/core';
import { api, type GuardProfile, type SocsoClaimDetail, type SocsoClaims } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';

/**
 * SOCSO (PERKESO) claims (Fauzan, 26 Oct 2026: "Find out about how to claim socso, the sop, the cases that can claim.
 * Put it in hr. And give every staff profile have button on socso claim submittion."). PERKESO has no API: HR submits
 * Form 34 in ASSIST and records the reference here; the app keeps the papers, the deadlines and the payroll effect.
 */

const TYPES: SocsoCaseType[] = ['WORK_ACCIDENT', 'COMMUTING', 'EMERGENCY', 'OCCUPATIONAL_DISEASE', 'NON_WORK_ACCIDENT', 'INVALIDITY', 'DEATH'];

const STATUS_TONE: Record<SocsoStatus, Tone> = {
  DRAFT: 'warn',
  REPORTED: 'info',
  DOCS_COMPLETE: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'ok',
  REJECTED: 'crit',
  APPEAL: 'warn',
  CLOSED: 'neutral',
};

type Form34 = SocsoClaimDetail['form34'];

function Form34Chip({ f }: { f: Form34 }) {
  if (f.state === 'done') return <Chip tone="ok">Form 34 sent</Chip>;
  if (f.state === 'overdue') return <Chip tone="crit">Form 34 overdue by {Math.abs(f.hoursLeft)} h</Chip>;
  return <Chip tone={f.state === 'reminder' ? 'warn' : 'info'}>Form 34 due in {f.hoursLeft} h</Chip>;
}

/** Local time in Malaysia as the value of a datetime-local field. */
function nowLocal(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16);
}

/** The HR page: what SOCSO covers, how to claim, and every claim the user may follow. */
export function SocsoView() {
  const { data, error } = useLoad(() => api.socsoClaims(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="SOCSO claims" />;
  const rows = data.rows.filter((r) => filter === 'all' || r.claim.status !== 'CLOSED');
  const due = data.rows.filter((r) => r.form34.state === 'reminder' || r.form34.state === 'overdue').length;
  const missing = data.rows.filter((r) => r.claim.status !== 'CLOSED' && r.missing > 0).length;
  const checkIns = data.rows.filter((r) => r.checkIn?.overdue).length;
  return (
    <div className="page">
      <div className="page-head">
        <h1>SOCSO claims</h1>
        <p className="muted">
          Start a claim from the person's profile (Guards, then the SOCSO tab). HR submits Form 34 in PERKESO ASSIST and records the reference here.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Open claims" value={data.rows.filter((r) => r.claim.status !== 'CLOSED').length} />
        <Kpi label="Form 34 due or late" value={due} tone={due ? 'crit' : 'ok'} note="Due 48 hours after the company was told" />
        <Kpi label="Papers missing" value={missing} tone={missing ? 'warn' : 'ok'} />
        <Kpi label="Check-ins overdue" value={checkIns} tone={checkIns ? 'warn' : 'ok'} note="Officer calls weekly while the person is off" />
      </div>
      <SocsoSop />
      <section className="panel">
        <div className="panel-head">
          <h2>Claims</h2>
          <div className="tabbar" role="tablist" aria-label="Which claims">
            <button role="tab" aria-selected={filter === 'open'} onClick={() => setFilter('open')}>
              Open
            </button>
            <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </button>
          </div>
        </div>
        <div className="list">
          {rows.length === 0 && <div className="empty">{data.canSeeAny ? 'No claim.' : 'You do not follow SOCSO claims for any company.'}</div>}
          {rows.map((r) => (
            <button key={r.claim.id} className="list-item" style={{ textAlign: 'left', width: '100%' }} onClick={() => setOpen(r.claim.id)}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.person?.name ?? 'Unknown person'} · {r.typeLabel}
                </div>
                <div className="muted small">
                  {r.person?.staffNo} · {r.companyName} · {dateTimeLabel(r.claim.incidentAt)}
                  {r.claim.perkesoRef ? ` · PERKESO ${r.claim.perkesoRef}` : ''}
                  {r.missing ? ` · ${r.missing} paper(s) missing` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {r.claim.status === 'DRAFT' && <Form34Chip f={r.form34} />}
                <Chip tone={STATUS_TONE[r.claim.status]}>{r.statusLabel}</Chip>
              </div>
            </button>
          ))}
        </div>
      </section>
      {open && (
        <Drawer title="SOCSO claim" onClose={() => setOpen(null)}>
          <SocsoClaimBody id={open} />
        </Drawer>
      )}
    </div>
  );
}

/** The SOP in short (SOCSO Claims SOP, 26 Oct 2026). */
export function SocsoSop() {
  return (
    <section className="panel" style={{ padding: 12 }}>
      <h2>How to claim (SOP)</h2>
      <details className="protocol-section">
        <summary>What SOCSO pays for</summary>
        <div className="list">
          {TYPES.map((t) => (
            <div key={t} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ fontWeight: 600 }}>{SOCSO_TYPE_LABEL[t]}</div>
              <div className="muted small">{SOCSO_TYPE_DETAIL[t]}</div>
            </div>
          ))}
          <div className="list-item muted small">
            Not SOCSO: ordinary illness (sick leave), clinic visits (panel or the foreign worker medical ledger), hospital bills of foreign workers (SPIKPA),
            and job loss (EIS, claimed by the worker).
          </div>
        </div>
      </details>
      <details className="protocol-section">
        <summary>Steps and deadlines</summary>
        <ol className="small" style={{ margin: '6px 0', paddingLeft: 20 }}>
          <li>The guard or officer tells the OM straight away. Get treatment first: any panel clinic or government hospital.</li>
          <li>The OM or HR starts the claim on the person's profile, with when it happened and when the company was told.</li>
          <li>HR submits Form 34 in PERKESO ASSIST within 48 hours of being told, and records the reference. A reminder shows at 24 hours.</li>
          <li>HR adds the papers on the checklist. Medical papers are seen by HR only.</li>
          <li>Mark documents complete, then under PERKESO review. Record PERKESO's decision.</li>
          <li>Rejected: appeal to the Appellate Board within 90 days, or close. Approved: record the amount paid and close.</li>
          <li>Permanent disablement: claim within 12 months of the last MC day.</li>
        </ol>
      </details>
      <details className="protocol-section">
        <summary>How the MC days are paid</summary>
        <p className="small">
          Basic pay only (Fauzan, 26 Oct 2026). Three MC days or fewer: company sick leave. Four days or more on an accepted claim: PERKESO pays temporary
          disablement and the company does not pay those days (Employment Act s.60F(4)). While PERKESO decides, the days are held, then settled.
        </p>
      </details>
    </section>
  );
}

/** The SOCSO tab on a staff profile: the Start button for the OM and HR, and the person's claims. */
export function SocsoTab({ d, personId }: { d: GuardProfile; personId: string }) {
  const s = d.socso;
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (open)
    return (
      <>
        <div>
          <button className="btn btn-sm" onClick={() => setOpen(null)}>
            Back to claims
          </button>
        </div>
        <SocsoClaimBody id={open} />
      </>
    );
  return (
    <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="small">SOCSO no. {d.person.socsoNo ?? 'not on record'}</span>
        {d.person.nationality === 'MY' && (
          <Chip tone={s.lindung === 'covered' ? 'ok' : s.lindung === 'opted_out' ? 'warn' : 'unknown'}>
            LINDUNG 24 Jam: {s.lindung === 'covered' ? 'covered' : s.lindung === 'opted_out' ? 'opted out' : 'unknown'}
          </Chip>
        )}
      </div>
      {s.canStart && !starting && (
        <div>
          <button className="btn btn-primary btn-sm" onClick={() => setStarting(true)}>
            Start SOCSO claim
          </button>
        </div>
      )}
      {starting && (
        <StartSocsoForm
          personId={personId}
          nationality={d.person.nationality}
          optedOut={s.lindung === 'opted_out'}
          onDone={(id) => {
            setStarting(false);
            if (id) setOpen(id);
          }}
        />
      )}
      <section>
        <h3>Claims</h3>
        <div className="list">
          {s.claims.length === 0 && <div className="empty">No SOCSO claim.</div>}
          {s.claims.map((c) => (
            <button key={c.id} className="list-item" style={{ textAlign: 'left', width: '100%' }} onClick={() => setOpen(c.id)}>
              <div>
                <div>
                  {c.typeLabel} · {dateTimeLabel(c.incidentAt)}
                </div>
                <div className="muted small">{c.perkesoRef ? `PERKESO ${c.perkesoRef}` : 'Not yet reported to PERKESO'}</div>
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {c.status === 'DRAFT' && <Form34Chip f={c.form34} />}
                <Chip tone={STATUS_TONE[c.status]}>{c.statusLabel}</Chip>
              </div>
            </button>
          ))}
        </div>
      </section>
      {!s.canStart && <p className="muted small">To claim, tell your OM or the HR office. They start the claim and submit it to PERKESO.</p>}
    </>
  );
}

/** Start a claim: the kind of case (or "Not sure" questions), when it happened and when the company was told. */
export function StartSocsoForm({
  personId,
  nationality,
  optedOut,
  onDone,
}: {
  personId: string;
  nationality: Nationality;
  optedOut: boolean;
  onDone: (id: string | null) => void;
}) {
  const [type, setType] = useState<SocsoCaseType | ''>('');
  const [unsure, setUnsure] = useState(false);
  const [q, setQ] = useState({ onDuty: false, commuting: false, outsideWorkInMalaysia: false, illness: false, permanent: false });
  const [incidentAt, setIncidentAt] = useState(nowLocal());
  const [toldAt, setToldAt] = useState(nowLocal());
  const [place, setPlace] = useState('');
  const [description, setDescription] = useState('');
  const [witnesses, setWitnesses] = useState('');
  const act = useAction();
  const triage = socsoTriage(q, nationality);
  const types = TYPES.filter((t) => t !== 'NON_WORK_ACCIDENT' || nationality !== 'MY' || !optedOut);
  const check = (k: keyof typeof q, label: string) => (
    <label className="row small" style={{ gap: 6 }}>
      <input type="checkbox" checked={q[k]} onChange={(e) => setQ({ ...q, [k]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="field">
        <span className="label">Kind of case</span>
        <select className="select" aria-label="Kind of case" value={type} onChange={(e) => setType(e.target.value as SocsoCaseType | '')}>
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {SOCSO_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {type && <span className="muted small">{SOCSO_TYPE_DETAIL[type]}</span>}
      {!unsure && (
        <div>
          <button className="link-button small" onClick={() => setUnsure(true)}>
            Not sure which kind?
          </button>
        </div>
      )}
      {unsure && (
        <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {check('illness', 'It is an illness, not an accident')}
          {q.illness && check('permanent', 'It leaves the person permanently unable to work')}
          {!q.illness && check('onDuty', 'Hurt while on duty')}
          {!q.illness && !q.onDuty && check('commuting', 'Hurt on the direct trip between home and work')}
          {!q.illness && !q.onDuty && !q.commuting && check('outsideWorkInMalaysia', 'An accident outside work, in Malaysia')}
          <div className="small" style={{ marginTop: 4 }}>
            {triage.advice}
            {triage.type === 'NON_WORK_ACCIDENT' && nationality === 'MY' && optedOut ? ' This person opted out, so it is not covered.' : ''}
          </div>
          {triage.type && triage.type !== type && types.includes(triage.type) && (
            <div>
              <button className="btn btn-sm" onClick={() => setType(triage.type!)}>
                Use {SOCSO_TYPE_LABEL[triage.type]}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="grid-2">
        <label className="field">
          <span className="label">When it happened</span>
          <input className="input" type="datetime-local" aria-label="When it happened" value={incidentAt} onChange={(e) => setIncidentAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">When the company was told</span>
          <input className="input" type="datetime-local" aria-label="When the company was told" value={toldAt} onChange={(e) => setToldAt(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="label">Where</span>
        <input className="input" aria-label="Where" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Site and spot, or the road" />
      </label>
      <label className="field">
        <span className="label">What happened and the injury</span>
        <textarea className="input" rows={3} aria-label="What happened" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Witnesses</span>
        <input className="input" aria-label="Witnesses" value={witnesses} onChange={(e) => setWitnesses(e.target.value)} placeholder="Names, if any" />
      </label>
      <span className="muted small">Form 34 is due in PERKESO ASSIST 48 hours after the company was told.</span>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || !type || description.trim().length < 10}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.startSocsoClaim(personId, {
                  type: type as SocsoCaseType,
                  incidentAt: `${incidentAt}:00+08:00`,
                  toldAt: `${toldAt}:00+08:00`,
                  place,
                  description,
                  witnesses,
                }),
              'Claim started. Submit Form 34 in ASSIST and record the reference.',
            );
            if (r) onDone(r.id);
          }}
        >
          Start claim
        </button>
        <button className="btn" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** One claim: deadlines, the paper checklist, the payroll effect, the next step and the history. */
export function SocsoClaimBody({ id }: { id: string }) {
  const { data, error } = useLoad(() => api.socsoClaim(id), [id]);
  const [view, setView] = useState<'claim' | 'rehab'>('claim');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="claim" />;
  const c = data.claim;
  const p = data.person;
  const openRestrictions = data.rehab.restrictions.filter((r) => !r.clearedAt).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }}>
          {p.name} · {data.typeLabel}
        </div>
        <div className="muted small">
          {p.staffNo} · {p.nationality === 'MY' ? 'Malaysian' : 'Foreign worker'} · SOCSO no. {p.socsoNo ?? 'not on record'}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          <Chip tone={STATUS_TONE[c.status]}>{data.statusLabel}</Chip>
          <Form34Chip f={data.form34} />
          {c.perkesoRef && <Chip tone="neutral">PERKESO {c.perkesoRef}</Chip>}
          {data.checkIn && (
            <Chip tone={data.checkIn.overdue ? 'warn' : 'info'}>Check-in {data.checkIn.overdue ? 'overdue' : `due ${dateLabel(data.checkIn.due)}`}</Chip>
          )}
        </div>
      </div>
      <div className="tabbar" role="tablist" aria-label="Claim sections">
        <button role="tab" aria-selected={view === 'claim'} onClick={() => setView('claim')}>
          Claim
        </button>
        <button role="tab" aria-selected={view === 'rehab'} onClick={() => setView('rehab')}>
          Rehabilitation
          {openRestrictions > 0 && <span className="tab-count">{openRestrictions}</span>}
        </button>
      </div>
      {view === 'rehab' && <RehabPanel d={data} />}
      {view === 'claim' && (
        <>
          <section>
            <h3>What happened</h3>
            <div className="small">{c.description}</div>
            <div className="muted small">
              {dateTimeLabel(c.incidentAt)}
              {c.place ? ` · ${c.place}` : ''} · company told {dateTimeLabel(c.toldAt)}
              {c.witnesses ? ` · witnesses: ${c.witnesses}` : ''}
            </div>
            <div className="muted small">
              Started by {c.openedBy}, {dateTimeLabel(c.openedAt)}. Form 34 due {dateTimeLabel(data.form34.due)}.
            </div>
          </section>
          {data.payroll && (
            <section>
              <h3>Pay for the MC days</h3>
              <div className="small">{data.payroll.text}</div>
            </section>
          )}
          {(data.later.permanentBy || data.later.appealBy) && (
            <div className="muted small">
              {data.later.permanentBy ? `Permanent disablement claim by ${dateLabel(data.later.permanentBy)}. ` : ''}
              {data.later.appealBy ? `Appeal by ${dateLabel(data.later.appealBy)}.` : ''}
            </div>
          )}
          <section>
            <h3>Papers</h3>
            <div className="list">
              {data.items.map((i) => (
                <PaperRow key={i.id} claimId={c.id} item={i} canManage={data.can.manage} canIncident={data.can.addIncident} closed={c.status === 'CLOSED'} />
              ))}
            </div>
            {!data.can.manage && <p className="muted small">Medical papers are kept by HR and are not shown here.</p>}
          </section>
          {(data.prefill.shifts.length > 0 || data.prefill.attendance.length > 0) && (
            <section>
              <h3>From the app: roster and clock-in</h3>
              <div className="list">
                {data.prefill.shifts.map((s, k) => (
                  <div key={`s${k}`} className="list-item small">
                    Rostered {dateLabel(s.date)} {hhmm(s.start)}–{hhmm(s.end)} · {s.site}
                  </div>
                ))}
                {data.prefill.attendance.map((a, k) => (
                  <div key={`a${k}`} className="list-item small">
                    Clocked in {a.clockIn ? `${dateLabel(a.clockIn.slice(0, 10))} ${hhmm(a.clockIn)}` : '-'}
                    {a.clockOut ? `, out ${hhmm(a.clockOut)}` : ', no clock-out'} · {a.site}
                  </div>
                ))}
              </div>
              {data.prefill.wages && (
                <p className="muted small">
                  Basic pay RM{data.prefill.wages.basic.toLocaleString()} a month for the wage schedule. {data.prefill.wages.note}
                </p>
              )}
            </section>
          )}
          {data.can.manage && <NextStep d={data} />}
          {c.decision && (
            <section>
              <h3>PERKESO's decision</h3>
              <div className="small">
                {c.decision.outcome === 'APPROVED' ? 'Approved' : 'Rejected'} on {dateLabel(c.decision.on)}: {c.decision.note}
              </div>
              {c.amountPaid != null && data.can.manage && <div className="small">Paid RM{c.amountPaid.toLocaleString()}</div>}
              {c.returnToWork && <div className="small">Back at work {dateLabel(c.returnToWork)}</div>}
            </section>
          )}
          <section>
            <h3>History</h3>
            <div className="list">
              {[...c.history].reverse().map((h, k) => (
                <div key={k} className="list-item small" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div>{h.what}</div>
                  <div className="muted">
                    {h.by}, {dateTimeLabel(h.at)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PaperRow({
  claimId,
  item,
  canManage,
  canIncident,
  closed,
}: {
  claimId: string;
  item: SocsoClaimDetail['items'][number];
  canManage: boolean;
  canIncident: boolean;
  closed: boolean;
}) {
  const [mode, setMode] = useState<'add' | 'skip' | null>(null);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  const mayAdd = !closed && !item.fromApp && (canManage || (canIncident && item.id === 'INCIDENT'));
  const isMc = item.id === 'MC';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div>{item.label}</div>
          <div className="muted small">
            {item.fromApp ? 'From the app' : item.required ? 'Required' : 'If any'}
            {item.medical ? ' · HR only' : ''}
            {item.override ? ` · going ahead without: ${item.override.reason} (${item.override.by})` : ''}
          </div>
        </div>
        <Chip tone={item.done ? 'ok' : item.required ? 'warn' : 'neutral'}>
          {item.done ? (item.override ? 'Waived' : 'Done') : item.required ? 'Missing' : 'Optional'}
        </Chip>
      </div>
      <DocList docs={item.docs} />
      {mayAdd && !mode && (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setMode('add')}>
            {item.docs.length ? 'Add more' : 'Add paper'}
          </button>
          {canManage && item.required && !item.done && (
            <button className="btn btn-sm" onClick={() => setMode('skip')}>
              Go ahead without
            </button>
          )}
        </div>
      )}
      {mode === 'add' && (
        <>
          {isMc && (
            <div className="grid-2">
              <label className="field">
                <span className="label">MC from</span>
                <input className="input" type="date" aria-label="MC from" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">MC to</span>
                <input className="input" type="date" aria-label="MC to" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
          <ProofPicker site={null} refText="SOCSO" items={proof} onChange={setProof} documentsOnly required />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length || (isMc && (!from || !to))}
              onClick={async () => {
                const r = await act.run(() => api.addSocsoDoc(claimId, item.id, proof, isMc ? { from, to } : undefined), 'Paper added.');
                if (r) {
                  setMode(null);
                  setProof([]);
                }
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {mode === 'skip' && (
        <>
          <input
            className="input"
            aria-label="Why go ahead without it"
            placeholder="Why the claim goes ahead without it"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || reason.trim().length < 5}
              onClick={async () => {
                const r = await act.run(() => api.overrideSocsoDoc(claimId, item.id, reason), 'Noted.');
                if (r) setMode(null);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const NEXT: Record<SocsoStatus, { to: SocsoStatus; label: string }[]> = {
  DRAFT: [{ to: 'REPORTED', label: 'Form 34 submitted in ASSIST' }],
  REPORTED: [{ to: 'DOCS_COMPLETE', label: 'All papers sent to PERKESO' }],
  DOCS_COMPLETE: [{ to: 'UNDER_REVIEW', label: 'PERKESO is reviewing' }],
  UNDER_REVIEW: [
    { to: 'APPROVED', label: 'PERKESO approved' },
    { to: 'REJECTED', label: 'PERKESO rejected' },
  ],
  REJECTED: [
    { to: 'APPEAL', label: 'Appeal lodged' },
    { to: 'CLOSED', label: 'Close without appeal' },
  ],
  APPEAL: [
    { to: 'APPROVED', label: 'Appeal approved' },
    { to: 'REJECTED', label: 'Appeal rejected' },
  ],
  APPROVED: [{ to: 'CLOSED', label: 'Paid, close the claim' }],
  CLOSED: [],
};

/** HR moves the claim on, with what each step needs. */
function NextStep({ d }: { d: SocsoClaimDetail }) {
  const c = d.claim;
  const [to, setTo] = useState<SocsoStatus | null>(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [on, setOn] = useState(nowLocal().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [back, setBack] = useState('');
  const act = useAction();
  const moves = NEXT[c.status];
  if (!moves.length) return null;
  const needsNote = to === 'APPROVED' || to === 'REJECTED' || to === 'APPEAL';
  const needsAmount = to === 'CLOSED' && c.status === 'APPROVED';
  const ready = to && (to !== 'REPORTED' || ref.trim().length >= 4) && (!needsNote || note.trim().length >= 3) && (!needsAmount || amount !== '');
  return (
    <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0 }}>Next step</h3>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {moves.map((m) => (
          <button key={m.to} className={`btn btn-sm${to === m.to ? ' btn-primary' : ''}`} onClick={() => setTo(m.to)}>
            {m.label}
          </button>
        ))}
      </div>
      {to === 'REPORTED' && (
        <label className="field">
          <span className="label">PERKESO reference from ASSIST</span>
          <input className="input" aria-label="PERKESO reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      )}
      {needsNote && (
        <label className="field">
          <span className="label">{to === 'APPEAL' ? 'What the appeal is about' : "PERKESO's decision, in short"}</span>
          <input className="input" aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      {(to === 'APPROVED' || to === 'REJECTED') && (
        <label className="field">
          <span className="label">Date of the decision letter</span>
          <input className="input" type="date" aria-label="Decision date" value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
      )}
      {to === 'CLOSED' && (
        <div className="grid-2">
          {c.status === 'APPROVED' && (
            <label className="field">
              <span className="label">Amount PERKESO paid (RM)</span>
              <input className="input" type="number" min={0} step="0.01" aria-label="Amount paid" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span className="label">Back at work on</span>
            <input className="input" type="date" aria-label="Back at work" value={back} onChange={(e) => setBack(e.target.value)} />
          </label>
        </div>
      )}
      {to === 'DOCS_COMPLETE' && d.items.some((i) => i.required && !i.done) && (
        <span className="muted small">Some required papers are missing. Add them, or choose "Go ahead without" and say why.</span>
      )}
      <ErrorNotice error={act.error} />
      {to && (
        <div>
          <button
            className="btn btn-primary btn-sm"
            disabled={!ready || act.busy}
            onClick={async () => {
              const r = await act.run(
                () =>
                  api.advanceSocsoClaim(c.id, to, {
                    perkesoRef: to === 'REPORTED' ? ref : undefined,
                    note: needsNote ? note : undefined,
                    on: to === 'APPROVED' || to === 'REJECTED' ? on : undefined,
                    amountPaid: needsAmount ? Number(amount) : null,
                    returnToWork: to === 'CLOSED' && back ? back : null,
                  }),
                `Claim is now: ${SOCSO_STATUS_LABEL[to].toLowerCase()}.`,
              );
              if (r) setTo(null);
            }}
          >
            Save
          </button>
        </div>
      )}
    </section>
  );
}

const RESTRICTIONS: SocsoRestrictionKind[] = ['NO_DUTY', 'NO_PATROL', 'NO_ARMED', 'NO_NIGHT'];

/**
 * Rehabilitation and return to work (SOP rehabilitation section). HR keeps the PERKESO Return to Work referral, the
 * plan, appointments and work restrictions; open restrictions stop the roster placing the person on unsuitable posts.
 * The officer checks in every week while the person is off and for the first month back.
 */
function RehabPanel({ d }: { d: SocsoClaimDetail }) {
  const r = d.rehab;
  const c = d.claim;
  const manage = d.can.manage && c.status !== 'CLOSED';
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    rtwRequestedOn: r.rtwRequestedOn ?? '',
    referralOn: r.referralOn ?? '',
    cmName: r.caseManager?.name ?? '',
    cmPhone: r.caseManager?.phone ?? '',
    plan: r.plan,
    targetReturn: r.targetReturn ?? '',
  });
  const [appt, setAppt] = useState({ at: '', what: '' });
  const [rs, setRs] = useState<{ kind: SocsoRestrictionKind; note: string; from: string; until: string }>({
    kind: 'NO_PATROL',
    note: '',
    from: nowLocal().slice(0, 10),
    until: '',
  });
  const [clearing, setClearing] = useState<string | null>(null);
  const [clearNote, setClearNote] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const act = useAction();
  const field = (k: keyof typeof form, label: string, type = 'text') => (
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" type={type} aria-label={label} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </label>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!d.rtwOffered && (
        <div className="panel small" style={{ padding: 10 }}>
          PERKESO gives foreign workers appliances only (such as crutches or a prosthesis), not the Return to Work programme. Foreign Worker Management keeps
          the work pass valid during a long MC.
        </div>
      )}
      <section>
        <h3>Return to work</h3>
        {!edit && (
          <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {d.rtwOffered && (
              <div>
                Referral: {r.rtwRequestedOn ? `asked ${dateLabel(r.rtwRequestedOn)}` : 'not asked yet'}
                {r.referralOn ? `, referred ${dateLabel(r.referralOn)}` : ''}
              </div>
            )}
            {d.rtwOffered && (
              <div>
                PERKESO case manager: {r.caseManager ? `${r.caseManager.name}${r.caseManager.phone ? `, ${r.caseManager.phone}` : ''}` : 'not known yet'}
              </div>
            )}
            <div>Target return: {r.targetReturn ? dateLabel(r.targetReturn) : 'not set'}</div>
            {r.plan && <div>Plan: {r.plan}</div>}
          </div>
        )}
        {manage && !edit && (
          <div style={{ marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => setEdit(true)}>
              Update
            </button>
          </div>
        )}
        {edit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.rtwOffered && (
              <div className="grid-2">
                {field('rtwRequestedOn', 'Return to Work asked on', 'date')}
                {field('referralOn', 'PERKESO referred on', 'date')}
              </div>
            )}
            {d.rtwOffered && (
              <div className="grid-2">
                {field('cmName', 'Case manager name')}
                {field('cmPhone', 'Case manager phone', 'tel')}
              </div>
            )}
            {field('targetReturn', 'Target return date', 'date')}
            <label className="field">
              <span className="label">Plan</span>
              <textarea className="input" rows={2} aria-label="Plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
            </label>
            <ErrorNotice error={act.error} />
            <div className="row" style={{ gap: 6 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy}
                onClick={async () => {
                  const ok = await act.run(
                    () =>
                      api.setSocsoRehab(c.id, {
                        ...(d.rtwOffered
                          ? {
                              rtwRequestedOn: form.rtwRequestedOn || null,
                              referralOn: form.referralOn || null,
                              caseManager: form.cmName.trim() ? { name: form.cmName, phone: form.cmPhone } : null,
                            }
                          : {}),
                        plan: form.plan,
                        targetReturn: form.targetReturn || null,
                      }),
                    'Saved.',
                  );
                  if (ok) setEdit(false);
                }}
              >
                Save
              </button>
              <button className="btn btn-sm" onClick={() => setEdit(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3>Work restrictions</h3>
        <p className="muted small">The roster will not place the person against an open restriction until HR clears it.</p>
        <div className="list">
          {r.restrictions.length === 0 && <div className="empty">No restriction.</div>}
          {r.restrictions.map((x) => (
            <div key={x.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                <div>
                  <div>{SOCSO_RESTRICTION_LABEL[x.kind]}</div>
                  <div className="muted small">
                    From {dateLabel(x.from)}
                    {x.until ? `, doctor's date ${dateLabel(x.until)}` : ''}
                    {x.note ? ` · ${x.note}` : ''} · set by {x.setBy}
                  </div>
                  {x.clearedAt && (
                    <div className="muted small">
                      Cleared by {x.clearedBy}, {dateTimeLabel(x.clearedAt)}: {x.clearNote}
                    </div>
                  )}
                </div>
                <Chip tone={x.clearedAt ? 'neutral' : 'warn'}>{x.clearedAt ? 'Cleared' : 'Open'}</Chip>
              </div>
              {manage && !x.clearedAt && clearing !== x.id && (
                <div>
                  <button className="btn btn-sm" onClick={() => setClearing(x.id)}>
                    Clear
                  </button>
                </div>
              )}
              {clearing === x.id && (
                <>
                  <input
                    className="input"
                    aria-label="Why it is cleared"
                    placeholder="Why, such as the fitness to work certificate"
                    value={clearNote}
                    onChange={(e) => setClearNote(e.target.value)}
                  />
                  <ErrorNotice error={act.error} />
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={act.busy || clearNote.trim().length < 5}
                      onClick={async () => {
                        const ok = await act.run(() => api.clearSocsoRestriction(c.id, x.id, clearNote), 'Restriction cleared.');
                        if (ok) {
                          setClearing(null);
                          setClearNote('');
                        }
                      }}
                    >
                      Save
                    </button>
                    <button className="btn btn-sm" onClick={() => setClearing(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        {manage && (
          <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label className="field">
              <span className="label">New restriction</span>
              <select
                className="select"
                aria-label="Restriction"
                value={rs.kind}
                onChange={(e) => setRs({ ...rs, kind: e.target.value as SocsoRestrictionKind })}
              >
                {RESTRICTIONS.map((k) => (
                  <option key={k} value={k}>
                    {SOCSO_RESTRICTION_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid-2">
              <label className="field">
                <span className="label">From</span>
                <input className="input" type="date" aria-label="Restriction from" value={rs.from} onChange={(e) => setRs({ ...rs, from: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Doctor's last day</span>
                <input
                  className="input"
                  type="date"
                  aria-label="Restriction until"
                  value={rs.until}
                  onChange={(e) => setRs({ ...rs, until: e.target.value })}
                />
              </label>
            </div>
            <input
              className="input"
              aria-label="Restriction note"
              placeholder="From the doctor's note"
              value={rs.note}
              onChange={(e) => setRs({ ...rs, note: e.target.value })}
            />
            <div>
              <button
                className="btn btn-sm"
                disabled={act.busy || !rs.from}
                onClick={() =>
                  act.run(() => api.addSocsoRestriction(c.id, { kind: rs.kind, note: rs.note, from: rs.from, until: rs.until || null }), 'Restriction added.')
                }
              >
                Add restriction
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3>Appointments</h3>
        <div className="list">
          {r.appointments.length === 0 && <div className="empty">No appointment.</div>}
          {r.appointments.map((a) => (
            <div key={a.id} className="list-item small">
              {dateTimeLabel(a.at)} · {a.what}
            </div>
          ))}
        </div>
        {manage && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <input
              className="input"
              type="datetime-local"
              aria-label="Appointment time"
              value={appt.at}
              onChange={(e) => setAppt({ ...appt, at: e.target.value })}
            />
            <input
              className="input"
              aria-label="Appointment for"
              placeholder="Clinic review, physiotherapy…"
              value={appt.what}
              onChange={(e) => setAppt({ ...appt, what: e.target.value })}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || !appt.at || appt.what.trim().length < 3}
              onClick={async () => {
                const ok = await act.run(() => api.addSocsoAppointment(c.id, { at: `${appt.at}:00+08:00`, what: appt.what }), 'Appointment added.');
                if (ok) setAppt({ at: '', what: '' });
              }}
            >
              Add
            </button>
          </div>
        )}
      </section>

      <section>
        <h3>Weekly check-ins</h3>
        <p className="muted small">
          The officer calls every week while the person is off, and for the first month back.
          {d.checkIn ? ` Next one ${d.checkIn.overdue ? 'is overdue since' : 'due'} ${dateLabel(d.checkIn.due)}.` : ''}
        </p>
        <div className="list">
          {r.checkIns.length === 0 && <div className="empty">No check-in yet.</div>}
          {[...r.checkIns].reverse().map((k, i) => (
            <div key={i} className="list-item small" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div>{k.note}</div>
              <div className="muted">
                {k.by}, {dateTimeLabel(k.at)}
              </div>
            </div>
          ))}
        </div>
        {d.can.addIncident && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input
              className="input"
              aria-label="Check-in note"
              placeholder="How the person is doing"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || checkIn.trim().length < 5}
              onClick={async () => {
                const ok = await act.run(() => api.addSocsoCheckIn(c.id, checkIn), 'Check-in recorded.');
                if (ok) setCheckIn('');
              }}
            >
              Record
            </button>
          </div>
        )}
      </section>
      <ErrorNotice error={!edit && !clearing ? act.error : null} />
    </div>
  );
}
