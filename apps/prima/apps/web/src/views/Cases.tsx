import { useState } from 'react';
import { jaOwns, type CaseType, type EscalationLevel, type ProofInput, type Severity } from '@prima/core';
import { api, type CaseDetail, type SignOffOutcome } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Loading, Sev, dateTimeLabel, hhmm, useAction, useLoad } from '../ui';
import { EvidenceCamera, PhotoCard } from './Camera';
import { DocList, ProofPicker } from './Proof';

const LEVEL_SHORT: Record<EscalationLevel, string> = {
  OFFICER: 'With site officer',
  PATROL: 'With patrolling officer',
  OM: 'With Ops Manager',
  ROM: 'With Regional OM',
  HEAD: 'Escalated to head of ops',
  COO: 'Escalated to COO',
  CEO: 'Escalated to CEO',
  DONE: 'Fully resolved',
};

const TYPE_LABEL: Record<CaseType, string> = {
  INCIDENT: 'Incident',
  SOS: 'SOS',
  MISSED_CHECKIN: 'Missed patrol',
  NO_SHOW: 'No-show',
  COMPLAINT: 'Client complaint',
  COMPLIANCE: 'Compliance',
  IDENTITY_CHECK: 'Identity check',
  ARMS: 'Arms',
};
const SLA_TEXT: Record<Severity, string> = { P1: 'respond in 5 minutes', P2: 'respond in 30 minutes', P3: 'respond today', P4: 'respond in 2 working days' };

export function Cases({ openCaseId }: { openCaseId?: string }) {
  const { isGroup, companyId } = useApp();
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [waiting, setWaiting] = useState(false);
  const [scope, setScope] = useState<'company' | 'all'>(isGroup ? 'all' : 'company');
  const [open, setOpen] = useState<string | undefined>(openCaseId);
  const [creating, setCreating] = useState(false);
  const { data: all, error } = useLoad(() => api.cases({ companyId: scope === 'company' ? companyId : undefined, status }), [status, scope, companyId]);
  const mineCount = all?.filter((c) => c.mine === 'own').length ?? 0;
  const data = all && waiting ? all.filter((c) => c.mine) : all;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cases</h1>
          <p>Incidents, complaints and alerts in one place. Each has a response clock by severity. Only the company closes a case.</p>
        </div>
        <div className="row">
          {isGroup && (
            <div className="seg">
              <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                All companies
              </button>
              <button aria-pressed={scope === 'company'} onClick={() => setScope('company')}>
                Selected company
              </button>
            </div>
          )}
          <button className="btn" aria-pressed={waiting} onClick={() => setWaiting(!waiting)}>
            Waiting for me{mineCount ? ` (${mineCount})` : ''}
          </button>
          <div className="seg">
            <button aria-pressed={status === 'active'} onClick={() => setStatus('active')}>
              Open
            </button>
            <button aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
              All
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Raise a case
          </button>
        </div>
      </div>
      <ErrorNotice error={error} />
      <section className="panel">
        {!data && !error && <Loading what="cases" />}
        {data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sev</th>
                  <th>Case</th>
                  <th className="hide-sm">Company and site</th>
                  <th>Opened</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                    <td>
                      <Sev s={c.severity} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.title}</div>
                      <div className="muted small">
                        <span className="mono">{c.ref}</span> · {TYPE_LABEL[c.type]}
                      </div>
                    </td>
                    <td className="hide-sm">
                      <div>{c.companyName}</div>
                      <div className="muted small">{c.siteName ?? 'Company-wide'}</div>
                    </td>
                    <td className="mono small">{dateTimeLabel(c.openedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <Chip tone={c.status === 'resolved' || c.status === 'closed' ? 'ok' : c.status === 'escalated' ? 'warn' : 'neutral'}>{c.status}</Chip>
                        {c.sla === 'breached' && <Chip tone="crit">Response late</Chip>}
                        {c.ladder && c.ladder.level !== 'DONE' && (
                          <Chip tone={c.ladder.overdue ? 'crit' : 'info'}>
                            {LEVEL_SHORT[c.ladder.level]}
                            {c.ladder.overdue ? ', overdue' : ''}
                          </Chip>
                        )}
                        {c.mine === 'own' && <Chip tone="warn">Your turn</Chip>}
                        {c.mine === 'step_in' && <Chip tone="neutral">You may step in</Chip>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length === 0 && <div className="empty">No cases.</div>}
          </div>
        )}
      </section>
      {open && <CaseDrawer caseId={open} onClose={() => setOpen(undefined)} />}
      {creating && <NewCase onClose={() => setCreating(false)} />}
    </div>
  );
}

function CaseDrawer({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api.caseDetail(caseId), [caseId]);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const c = data?.case;
  const done = c?.status === 'closed';
  const doIt = async (action: 'acknowledge' | 'escalate' | 'resolve' | 'close' | 'note', msg: string) => {
    const r = await act.run(() => api.updateCase(caseId, action, note, action === 'resolve' ? proof : []), msg);
    if (r) {
      setNote('');
      if (action === 'resolve') setProof([]);
    }
  };
  return (
    <Drawer title={c?.title ?? 'Case'} sub={c ? `${c.ref} · ${c.companyName}${c.siteName ? ` · ${c.siteName}` : ''}` : undefined} onClose={onClose}>
      <ErrorNotice error={error} />
      {!data && !error && <Loading what="case" />}
      {c && data && (
        <>
          <div className="row">
            <Sev s={c.severity} />
            <Chip tone="neutral">{c.status}</Chip>
            {c.sla === 'breached' ? (
              <Chip tone="crit">First response was due {hhmm(c.slaDueAt)}</Chip>
            ) : c.status === 'open' ? (
              <Chip tone="info">
                Due {hhmm(c.slaDueAt)} ({SLA_TEXT[c.severity]})
              </Chip>
            ) : null}
          </div>
          <p>{c.description || <span className="muted">No description.</span>}</p>
          {data.ladder && <Ladder data={data} caseId={caseId} />}
          <CasePhotos data={data} caseId={caseId} />
          <section>
            <h3>History</h3>
            <ol className="timeline">
              {c.events.map((e, i) => (
                <li key={i}>
                  <time>{hhmm(e.at)}</time>
                  <div>
                    <strong>{e.action}</strong> by {e.by}
                    {e.note && <div className="muted">{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
          {!done && data.can.update && (
            <section className="field">
              <label className="label" htmlFor="case-note">
                Note
              </label>
              <textarea id="case-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done or decided" />
              {c.status !== 'resolved' && !c.siteId && <ProofPicker site={null} refText={c.ref} items={proof} onChange={setProof} />}
              <div className="row">
                {c.status === 'open' && (
                  <button className="btn btn-primary" disabled={act.busy} onClick={() => doIt('acknowledge', 'Case acknowledged.')}>
                    Acknowledge
                  </button>
                )}
                {c.status !== 'resolved' && !c.siteId && (
                  <>
                    <button className="btn" disabled={act.busy} onClick={() => doIt('escalate', 'Case escalated.')}>
                      Escalate
                    </button>
                    <button className="btn" disabled={act.busy || !proof.length} onClick={() => doIt('resolve', 'Case resolved.')} title="Needs proof">
                      Resolve
                    </button>
                  </>
                )}
                <button className="btn btn-ghost" disabled={act.busy || !note.trim()} onClick={() => doIt('note', 'Note added.')}>
                  Add note
                </button>
                {c.status === 'resolved' && data.can.close && (
                  <button className="btn btn-primary" disabled={act.busy} onClick={() => doIt('close', 'Case closed.')}>
                    Close case
                  </button>
                )}
              </div>
              {c.status === 'resolved' && !data.can.close && (
                <p className="muted small">Only the company closes a case. It is waiting for the Company Manager.</p>
              )}
              <ErrorNotice error={act.error} />
            </section>
          )}
          {!data.can.update && <p className="muted small">You can see this case but not change it.</p>}
        </>
      )}
    </Drawer>
  );
}

function NewCase({ onClose }: { onClose: () => void }) {
  const { companyId, me } = useApp();
  const sites = useLoad(() => api.sites(companyId), [companyId]);
  const [form, setForm] = useState({
    siteId: '',
    type: (jaOwns('incidents') ? 'COMPLAINT' : 'INCIDENT') as CaseType,
    severity: 'P3' as Severity,
    title: '',
    description: '',
  });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const company = me.companies.find((c) => c.id === companyId);
  const site = sites.data?.find((s) => s.site.id === form.siteId)?.site ?? null;
  return (
    <Drawer title="Raise a case" sub={company?.name} onClose={onClose}>
      <div className="field">
        <label className="label" htmlFor="nc-site">
          Site
        </label>
        <select id="nc-site" className="select" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
          <option value="">Company-wide (no site)</option>
          {sites.data?.map((s) => (
            <option key={s.site.id} value={s.site.id}>
              {s.site.code} · {s.site.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="nc-type">
            Type
          </label>
          <select id="nc-type" className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CaseType })}>
            {/* Incidents are reported in the JA Group app while it owns them (rule SYS-JA-OWNS). */}
            {Object.entries(TYPE_LABEL)
              .filter(([k]) => k !== 'INCIDENT' || !jaOwns('incidents'))
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-sev">
            Severity
          </label>
          <select id="nc-sev" className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
            {(['P1', 'P2', 'P3', 'P4'] as Severity[]).map((s) => (
              <option key={s} value={s}>
                {s}: {SLA_TEXT[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="nc-title">
          Title
        </label>
        <input id="nc-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short summary" />
      </div>
      <div className="field">
        <label className="label" htmlFor="nc-desc">
          What happened
        </label>
        <textarea id="nc-desc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <ProofPicker
        site={site}
        refText={form.title || 'New case'}
        items={proof.filter((p) => site || p.kind === 'document')}
        onChange={setProof}
        required={form.type !== 'SOS'}
      />
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || !form.title.trim() || (form.type !== 'SOS' && !proof.some((p) => site || p.kind === 'document'))}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.raiseCase({
                  companyId,
                  siteId: form.siteId || null,
                  type: form.type,
                  severity: form.severity,
                  title: form.title,
                  description: form.description,
                  proof: proof.filter((p) => site || p.kind === 'document'),
                }),
              (c) => `Case ${c.ref} raised.`,
            );
            if (r) onClose();
          }}
        >
          Raise case
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}

/** Proof on a case (Fauzan, 25 Oct 2026): stamped, geo-tagged photos and supporting documents. */
function CasePhotos({ data, caseId }: { data: CaseDetail; caseId: string }) {
  const [taking, setTaking] = useState(false);
  const site = data.site;
  const none = !data.photos.length && !data.docs.length;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>
          Proof ({data.photos.length} photo{data.photos.length === 1 ? '' : 's'}, {data.docs.length} document{data.docs.length === 1 ? '' : 's'})
        </h3>
        {data.can.photo && site && !taking && (
          <button className="btn btn-sm" onClick={() => setTaking(true)}>
            Take photo
          </button>
        )}
      </div>
      {taking && site && <EvidenceCamera site={site} refText={data.case.ref} onSend={(p) => api.addCasePhoto(caseId, p)} onDone={() => setTaking(false)} />}
      {none && !taking && (
        <div className="notice" data-tone={data.case.type === 'SOS' ? 'info' : 'warn'}>
          {data.case.type === 'SOS'
            ? 'No proof yet. An SOS goes out without proof; the first sign-off adds it.'
            : 'No proof on record. Every case needs a photo or a document (rule CASE-PROOF).'}
        </div>
      )}
      {data.photos.map((p) => (
        <PhotoCard key={p.id} p={p} />
      ))}
      <DocList docs={data.docs} />
    </section>
  );
}

/** Verify, resolve and confirm only with proof (rule CASE-PROOF); send back and escalate need a reason. */
const NEEDS_PROOF: SignOffOutcome[] = ['verified', 'resolved', 'confirmed'];

const BUTTON_LABEL: Record<SignOffOutcome, string> = {
  verified: 'Verify, pass up',
  resolved: 'Resolved, pass up',
  sent_back: 'Send back',
  confirmed: 'Confirm fully resolved',
  escalated: 'Escalate higher',
};

const OUTCOME_LABEL: Record<SignOffOutcome, string> = {
  verified: 'Verified',
  resolved: 'Resolved',
  sent_back: 'Sent back',
  confirmed: 'Confirmed fully resolved',
  escalated: 'Escalated',
};

/**
 * Escalation until fully resolved (Fauzan, 25 Oct 2026): site officer (where stationed), patrolling officer,
 * Operations Manager, then the Regional OM confirms. Above the ROM only big matters, escalated by decision: the OGM
 * (government site) or Operations Director (private site), then the COO, then the CEO.
 */
function Ladder({ data, caseId }: { data: CaseDetail; caseId: string }) {
  const c = data.case;
  const l = data.ladder!;
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const level = c.ladder?.level ?? 'DONE';
  const at = l.steps.findIndex((s) => s.level === level);
  const top = level === 'ROM' || l.steps.some((s) => s.level === level && s.onlyIfEscalated);
  const reached = new Set((c.signOffs ?? []).map((x) => x.level));
  const hiddenFrom = l.steps.findIndex((s) => s.onlyIfEscalated && s.level !== level && !reached.has(s.level));
  const sign = (o: SignOffOutcome) =>
    act
      .run(() => api.signOffCase(caseId, o, note, NEEDS_PROOF.includes(o) ? proof : []), `${OUTCOME_LABEL[o]}.`)
      .then((r) => {
        if (r) {
          setNote('');
          setProof([]);
        }
      });
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Escalation until fully resolved</h3>
      {c.reporter && (
        <div className="row" style={{ gap: 6 }}>
          <span className="small">
            Reported by {c.reporter.name} ({c.reporter.staffNo})
          </span>
          <Chip tone={c.reporter.face === 'confirmed' ? 'ok' : 'crit'}>{c.reporter.face === 'confirmed' ? 'Face confirmed' : 'Face not confirmed'}</Chip>
        </div>
      )}
      <ol className="timeline">
        {l.steps.map((s, i) => {
          const signs = (c.signOffs ?? []).filter((x) => x.level === s.level);
          const here = level === s.level;
          const passed = level === 'DONE' ? reached.has(s.level) : i < at;
          // Levels above the ROM show only when the case went there; the rest are named once.
          if (s.onlyIfEscalated && !here && !reached.has(s.level)) {
            if (i !== hiddenFrom) return null;
            return (
              <li key={s.level} className="muted">
                <time>·</time>
                <div className="small">
                  Only if escalated as a big matter:{' '}
                  {l.steps
                    .slice(i)
                    .map((x) => `${x.label} (${x.person})`)
                    .join(', then ')}
                </div>
              </li>
            );
          }
          return (
            <li key={s.level}>
              <time>{passed ? '✓' : here ? '●' : '○'}</time>
              <div>
                <strong>{s.label}</strong> · {s.person}
                {here && c.ladder?.dueAt && (
                  <div>
                    <Chip tone={c.ladder.overdue ? 'crit' : 'info'}>
                      {c.ladder.overdue
                        ? top
                          ? `Overdue since ${dateTimeLabel(c.ladder.dueAt)}`
                          : `Overdue since ${dateTimeLabel(c.ladder.dueAt)}; next level may step in`
                        : `Waiting, due ${dateTimeLabel(c.ladder.dueAt)}`}
                    </Chip>
                  </div>
                )}
                {signs.map((x, j) => (
                  <div key={j} className="muted small">
                    {OUTCOME_LABEL[x.outcome]} by {x.by}
                    {x.stepIn ? ' (stepped in)' : ''}, {dateTimeLabel(x.at)}: {x.note}
                    {x.proofIds?.length ? ` · ${x.proofIds.length} proof` : NEEDS_PROOF.includes(x.outcome) ? ' · no proof on record' : ''}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {level === 'DONE' && <Chip tone="ok">Fully resolved. The company closes the case.</Chip>}
      {l.actions.length > 0 && (
        <div className="field">
          <label className="label" htmlFor="ladder-note">
            Your sign-off as {l.myLabel}
            {l.myLevel !== level ? ` (stepping in for ${l.steps.find((s) => s.level === level)?.label ?? level})` : ''}
          </label>
          <textarea
            id="ladder-note"
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={top ? 'What was done, or why this is a big matter that needs a higher level' : 'What you checked or what was done'}
          />
          <ProofPicker site={data.site ?? null} refText={c.ref} items={proof} onChange={setProof} />
          <div className="row">
            {l.actions.map((o) => (
              <button
                key={o}
                className={`btn ${o === 'confirmed' || o === 'resolved' ? 'btn-primary' : ''}`}
                disabled={act.busy || (NEEDS_PROOF.includes(o) && !proof.length)}
                title={NEEDS_PROOF.includes(o) ? 'Needs proof: a photo or a document' : undefined}
                onClick={() => sign(o)}
              >
                {o === 'resolved' && top ? 'Resolved, fully resolved' : BUTTON_LABEL[o]}
              </button>
            ))}
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </section>
  );
}
