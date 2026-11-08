import { useState } from 'react';
import {
  COMP_KIND_LABEL,
  COMP_METHOD_LABEL,
  COMP_ROLE_LABEL,
  COMP_STATE_LABEL,
  QMS_EVIDENCE_LABEL,
  QMS_FOUNDATION_LABEL,
  type QmsFoundationKind,
  QMS_STATE_LABEL,
  type CompMethod,
  type CompState,
  type QmsEvidenceKind,
  type QmsState,
} from '@prima/core';
import { api, type CompMatrix, type QmsBoard, type QmsFoundationBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';
import { Faults, Items, Suppliers } from './QualityOps';

/**
 * Quality and compliance (Fauzan, 5 Nov 2026). One requirements and evidence register for ISO 9001:2015 and the
 * SIRIM/PIKM code (ACT keeps it; the company manager links evidence for their own company), and the role competency
 * matrix (HR keeps the role profiles; managers and officers assess). Prima never declares a company compliant.
 */

type Tab = 'register' | 'foundation' | 'matrix' | 'faults' | 'suppliers' | 'objectives' | 'documents' | 'review';
type Tone = 'ok' | 'warn' | 'crit' | 'info';
const STATE_TONE: Record<QmsState, Tone> = {
  awaiting_text: 'info',
  not_applicable: 'info',
  gap: 'crit',
  unknown: 'warn',
  not_checked: 'warn',
  review_due: 'warn',
  checked: 'ok',
};
const COMP_TONE: Record<CompState, Tone> = { met: 'ok', due_soon: 'warn', expired: 'crit', not_yet: 'crit', missing: 'warn' };
const col = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 } as const;
const line = { flexDirection: 'column', alignItems: 'stretch', gap: 4 } as const;
const head = { justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } as const;

export function QualityView() {
  const [companyId, setCompanyId] = useState<string | undefined>(undefined);
  const [standard, setStandard] = useState<'ISO9001' | 'PIKM' | undefined>(undefined);
  const reg = useLoad(() => api.qualityRegister({ companyId, standard }), [companyId, standard]);
  const mat = useLoad(() => api.qualityMatrix({ companyId }), [companyId]);
  const fnd = useLoad(() => api.qualityFoundation(), []);
  const ops = useLoad(() => api.qualityOps({ companyId }), [companyId]);
  const o = ops.data;
  const inner = o?.role === 'act' || o?.role === 'keep' || o?.role === 'ceo';
  const hasReg = !!reg.data;
  const hasFnd = !!fnd.data;
  const hasMat = !!mat.data;
  const [tabPick, setTab] = useState<Tab | null>(null);
  const tabs = (
    [
      ['register', 'Requirements register', hasReg],
      ['faults', 'Service faults', !!o && o.role !== 'proc'],
      ['suppliers', 'Supplier ratings', !!o && o.role !== 'ops'],
      ['objectives', 'Objectives', !!o && o.role !== 'proc'],
      ['documents', 'Documents', !!o && o.role !== 'proc'],
      ['review', 'Management review', !!o && inner],
      ['foundation', 'QMS foundation', hasFnd],
      ['matrix', 'Competency matrix', hasMat],
    ] as [Tab, string, boolean][]
  ).filter((t) => t[2]);
  const tab: Tab = tabPick && tabs.some((t) => t[0] === tabPick) ? tabPick : (tabs[0]?.[0] ?? 'foundation');
  if (!reg.data && !mat.data && !fnd.data && !o) {
    if (reg.error && mat.error && fnd.error && ops.error) return <ErrorNotice error={mat.error} />;
    return <Loading what="quality and compliance" />;
  }
  const opsTab = tab === 'faults' || tab === 'suppliers' || tab === 'objectives' || tab === 'documents' || tab === 'review';
  const companies = (opsTab ? (o?.companies ?? []) : (reg.data?.companies ?? mat.data?.companies ?? [])).filter((c) => c.id !== 'pwvsb' || tab === 'register');
  const current = tab === 'register' ? reg.data?.companyId : opsTab ? (o?.companyId ?? undefined) : mat.data?.companyId;
  // Procurement only rates suppliers: a plain screen with no standards or clauses.
  if (o?.role === 'proc' && !hasReg && !hasFnd && !hasMat)
    return (
      <div className="page">
        <div className="page-head">
          <h1>Supplier ratings</h1>
          <p className="muted">Rate each supplier on quality, time and paperwork. Prima reminds you when a rating is due.</p>
        </div>
        <Suppliers data={o} />
      </div>
    );
  // Officers only assess their guards (staff-usability rule, Fauzan 5 Nov 2026): they never see standards or clauses.
  if (!hasReg && !hasFnd && !o && mat.data)
    return (
      <div className="page">
        <div className="page-head">
          <h1>Guard skills</h1>
          <p className="muted">Check that each guard can do the job at their post. Prima reminds you when a check is due.</p>
        </div>
        {companies.length > 1 && (
          <select className="select" aria-label="Company" value={current} onChange={(e) => setCompanyId(e.target.value)} style={{ maxWidth: 360, marginBottom: 8 }}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <Matrix data={mat.data} />
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <h1>Quality and compliance</h1>
        <p className="muted">
          One list of what ISO 9001 and the PIKM code ask for, with the Prima records that show it is done, and what each role needs to be competent. Staff do
          their normal work once; Prima links it here. Prima never says a company is compliant: a person checks the evidence.
        </p>
        <p className="notice" data-tone="info">
          Test data. PIKM rows follow the 2022 draft code; Part 2 waits for its text. Review and refresher periods approved by the CEO, 8 Nov 2026.
        </p>
      </div>
      {companies.length > 1 && tab !== 'foundation' && tab !== 'suppliers' && tab !== 'objectives' && tab !== 'documents' && tab !== 'review' && (
        <select className="select" aria-label="Company" value={current} onChange={(e) => setCompanyId(e.target.value)} style={{ maxWidth: 360, marginBottom: 8 }}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {tabs.length > 1 && (
        <div className="tabbar" role="tablist" aria-label="Quality and compliance">
          {tabs.map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </div>
      )}
      {tab === 'register' && reg.data && <Register data={reg.data} standard={standard} setStandard={setStandard} />}
      {tab === 'matrix' && mat.data && <Matrix data={mat.data} />}
      {tab === 'foundation' && fnd.data && <Foundation data={fnd.data} />}
      {tab === 'faults' && o && <Faults data={o} />}
      {tab === 'suppliers' && o && <Suppliers data={o} />}
      {tab === 'objectives' && o && <Items data={o} kind="objective" />}
      {tab === 'documents' && o && <Items data={o} kind="document" />}
      {tab === 'review' && o && <Items data={o} kind="review" />}
    </div>
  );
}

// ---------- Register ----------

function Register({ data, standard, setStandard }: { data: QmsBoard; standard?: 'ISO9001' | 'PIKM'; setStandard: (s: 'ISO9001' | 'PIKM' | undefined) => void }) {
  const k = data.kpis;
  const act = useAction();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const rows = data.rows.filter((r) => filter === 'all' || !['checked', 'not_applicable'].includes(r.state));
  return (
    <>
      <div className="kpis">
        <Kpi label="Unknown: no evidence" value={k.unknown} tone={k.unknown ? 'warn' : 'ok'} />
        <Kpi label="Evidence to check" value={k.toCheck} tone={k.toCheck ? 'warn' : 'ok'} />
        <Kpi label="Gaps being fixed" value={k.gaps} tone={k.gaps ? 'crit' : 'ok'} />
        <Kpi label="Review due" value={k.reviewDue} tone={k.reviewDue ? 'warn' : 'ok'} />
        <Kpi label="Evidence checked" value={k.checked} />
        <Kpi label="Waiting for the code text" value={k.awaitingText} tone={k.awaitingText ? 'info' : 'ok'} />
      </div>
      {data.role !== 'company' && data.summary.length > 1 && (
        <details className="panel">
          <summary>All companies at a glance</summary>
          <div className="list">
            {data.summary.map((s) => (
              <div key={s.companyId} className="list-item row" style={head}>
                <span>{s.companyName}</span>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {s.counts.gap > 0 && <Chip tone="crit">{s.counts.gap} gaps</Chip>}
                  <Chip tone={s.counts.unknown ? 'warn' : 'ok'}>{s.counts.unknown} unknown</Chip>
                  {s.counts.not_checked > 0 && <Chip tone="warn">{s.counts.not_checked} not checked</Chip>}
                  <Chip tone="ok">{s.counts.checked} checked</Chip>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>{data.companyName}</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select className="select" aria-label="Standard" value={standard ?? ''} onChange={(e) => setStandard((e.target.value || undefined) as 'ISO9001' | 'PIKM' | undefined)}>
              <option value="">Both standards</option>
              <option value="ISO9001">ISO 9001:2015</option>
              <option value="PIKM">PIKM code</option>
            </select>
            <button className="btn btn-sm" onClick={() => setFilter(filter === 'open' ? 'all' : 'open')}>
              {filter === 'open' ? 'Show all' : 'Show open only'}
            </button>
            {data.role === 'act' && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.qualityAction('loadStarter', {}), (r) => `${(r as { added: number }).added} requirements added.`)}>
                Load starter list
              </button>
            )}
          </div>
        </div>
        <ErrorNotice error={act.error} />
        {data.role === 'act' && <RequirementForm data={data} />}
        <div className="list">
          {!data.rows.length && <div className="empty">No requirements yet. ACT loads the starter list.</div>}
          {data.rows.length > 0 && !rows.length && <div className="empty">Nothing open.</div>}
          {rows.map((r) => (
            <RequirementLine key={r.requirement.id} row={r} data={data} />
          ))}
        </div>
      </section>
    </>
  );
}

type RegRow = QmsBoard['rows'][number];

function RequirementLine({ row, data }: { row: RegRow; data: QmsBoard }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QmsEvidenceKind>('prima_record');
  const [label, setLabel] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState('');
  const r = row.requirement;
  const base = { requirementId: r.id, companyId: data.companyId };
  const evidence = row.entry?.evidence ?? [];
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {r.standard === 'ISO9001' ? 'ISO 9001' : 'PIKM'} {r.ref}: {r.title}
          </div>
          <div className="muted small">
            Owner: {r.ownerTitle}
            {r.workflow ? ` · Where in Prima: ${r.workflow}` : ''}
            {row.reviewDueOn ? ` · review by ${dateLabel(row.reviewDueOn)}` : ''}
          </div>
          {row.signal && <div className="muted small">Prima figures: {row.signal}</div>}
          {row.entry?.appliesNote && !row.entry.applies && <div className="muted small">Does not apply: {row.entry.appliesNote.note} ({row.entry.appliesNote.by})</div>}
          {row.gaps.map((g) => (
            <div key={g.findingId} className="muted small">
              Gap {g.findingRef} ({g.status}): {g.note}
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <Chip tone={STATE_TONE[row.state]}>{QMS_STATE_LABEL[row.state]}</Chip>
          <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Close' : 'Open'}
          </button>
        </div>
      </div>
      {open && (
        <div style={col}>
          {evidence.length === 0 && <div className="muted small">No evidence linked.</div>}
          {evidence.map((e) => (
            <div key={e.id} className="row small" style={{ ...head, borderTop: '1px solid var(--line, #ddd)', paddingTop: 4 }}>
              <div style={{ minWidth: 0 }}>
                <div>
                  {QMS_EVIDENCE_LABEL[e.kind]}: {e.label}
                </div>
                <div className="muted">
                  {e.ref} · linked by {e.linkedBy}
                  {e.check ? ` · ${e.check.ok ? 'checked' : 'not accepted'} by ${e.check.by}: ${e.check.note}` : ''}
                </div>
              </div>
              {e.check ? <Chip tone={e.check.ok ? 'ok' : 'crit'}>{e.check.ok ? 'Checked' : 'Not accepted'}</Chip> : <Chip tone="warn">Not checked yet</Chip>}
              {row.checkable.includes(e.id) && (
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-primary btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.qualityAction('checkEvidence', { ...base, evidenceId: e.id, ok: true, note }), 'Evidence checked.')}>
                    Evidence is right
                  </button>
                  <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.qualityAction('checkEvidence', { ...base, evidenceId: e.id, ok: false, note }), 'Evidence not accepted.')}>
                    Not accepted
                  </button>
                </div>
              )}
            </div>
          ))}
          {row.canLink && (
            <>
              <select className="select" aria-label="Kind of evidence" value={kind} onChange={(e) => setKind(e.target.value as QmsEvidenceKind)}>
                {(Object.keys(QMS_EVIDENCE_LABEL) as QmsEvidenceKind[])
                  .filter((x) => x !== 'prima_signal' || r.signal !== 'none')
                  .map((x) => (
                    <option key={x} value={x}>
                      {QMS_EVIDENCE_LABEL[x]}
                    </option>
                  ))}
              </select>
              {kind !== 'prima_signal' && (
                <>
                  <input className="input" aria-label="What it is" placeholder="What it is" value={label} onChange={(e) => setLabel(e.target.value)} />
                  <input className="input" aria-label="Reference" placeholder="Record number, document reference or link" value={ref} onChange={(e) => setRef(e.target.value)} />
                </>
              )}
              {kind === 'prima_signal' && <div className="muted small">Prima fills in today's figures. ACT still checks them.</div>}
              <button
                className="btn btn-sm"
                disabled={act.busy || (kind !== 'prima_signal' && label.trim().length < 3)}
                onClick={() =>
                  act.run(() => api.qualityAction('linkEvidence', { ...base, kind, label, ref }), 'Evidence linked. ACT will check it.').then((x) => {
                    if (x) {
                      setLabel('');
                      setRef('');
                    }
                  })
                }
              >
                Link evidence
              </button>
            </>
          )}
          {row.canDecide && (
            <>
              <input className="input" aria-label="Reason" placeholder="Reason (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3 || !evidence.some((e) => e.check?.ok)} onClick={() => act.run(() => api.qualityAction('review', { ...base, note }), 'Review recorded.')}>
                  Record review
                </button>
                <button
                  className="btn btn-sm"
                  disabled={act.busy || note.trim().length < 3}
                  onClick={() => act.run(() => api.qualityAction('setApplies', { ...base, applies: !(row.entry?.applies ?? true), note }), 'Saved.')}
                >
                  {row.entry && !row.entry.applies ? 'Applies again' : 'Does not apply'}
                </button>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <select className="select" aria-label="Who fixes it" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Who fixes the gap</option>
                  {data.owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.title})
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm"
                  disabled={act.busy || note.trim().length < 3 || !owner}
                  onClick={() => act.run(() => api.qualityAction('raiseGap', { ...base, note, ownerUserId: owner }), (x) => `Gap raised as ${(x as { finding: { ref: string } }).finding.ref}.`)}
                >
                  Raise gap as ACT finding
                </button>
              </div>
            </>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function RequirementForm({ data }: { data: QmsBoard }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [std, setStd] = useState('ISO9001');
  const [ref, setRef] = useState('');
  const [title, setTitle] = useState('');
  const [ownerTitle, setOwnerTitle] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [area, setArea] = useState('CORPORATE');
  if (!open)
    return (
      <button className="btn btn-sm" style={{ marginBottom: 8 }} onClick={() => setOpen(true)}>
        Add a requirement
      </button>
    );
  return (
    <div style={col}>
      <select className="select" aria-label="Standard" value={std} onChange={(e) => setStd(e.target.value)}>
        {data.standards.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name} ({s.edition})
          </option>
        ))}
      </select>
      <input className="input" aria-label="Clause" placeholder="Clause or section reference" value={ref} onChange={(e) => setRef(e.target.value)} />
      <input className="input" aria-label="Summary" placeholder="What is needed, in your own words" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input" aria-label="Owner" placeholder="Owner by job title" value={ownerTitle} onChange={(e) => setOwnerTitle(e.target.value)} />
      <input className="input" aria-label="Where in Prima" placeholder="Where in Prima the evidence comes from" value={workflow} onChange={(e) => setWorkflow(e.target.value)} />
      <select className="select" aria-label="ACT area" value={area} onChange={(e) => setArea(e.target.value)}>
        {data.actAreas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ref.trim() || !title.trim()}
          onClick={() =>
            act.run(() => api.qualityAction('addRequirement', { standard: std, ref, title, ownerTitle, workflow, actArea: area }), 'Requirement added.').then((x) => x && setOpen(false))
          }
        >
          Save requirement
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Competency matrix ----------

function Matrix({ data }: { data: CompMatrix }) {
  const k = data.kpis;
  const [onlyGaps, setOnlyGaps] = useState(true);
  const act = useAction();
  const rows = data.rows.filter((r) => !onlyGaps || r.gaps || r.dueSoon);
  const proposed = data.profiles.filter((p) => p.status === 'proposed');
  return (
    <>
      <div className="kpis">
        <Kpi label="Staff" value={k.people} />
        <Kpi label="With gaps" value={k.withGaps} tone={k.withGaps ? 'warn' : 'ok'} />
        <Kpi label="Refresher or licence due soon" value={k.dueSoon} tone={k.dueSoon ? 'warn' : 'ok'} />
        <Kpi label="Training worked" value={`${k.trainingWorked} of ${k.trainingChecks}`} note="Checked by reassessment after the course" />
        <Kpi label="Assessed this month" value={k.assessedThisMonth} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>By role</h3>
          {data.canProposeProfile && !data.profiles.length && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.qualityAction('loadStarter', {}), 'Starter role profiles sent to the HR Director.')}>
              Load starter profiles
            </button>
          )}
        </div>
        <ErrorNotice error={act.error} />
        <div className="list">
          {data.byRole
            .filter((r) => r.people)
            .map((r) => (
              <div key={r.role} className="list-item row" style={head}>
                <span>{COMP_ROLE_LABEL[r.role]}</span>
                <span className="row" style={{ gap: 4 }}>
                  <Chip tone={r.withGaps ? 'warn' : 'ok'}>
                    {r.withGaps} of {r.people} with gaps
                  </Chip>
                  {r.dueSoon > 0 && <Chip tone="warn">{r.dueSoon} due soon</Chip>}
                </span>
              </div>
            ))}
        </div>
      </section>
      {(proposed.length > 0 || data.canProposeProfile) && <Profiles data={data} />}
      <section className="panel">
        <div className="panel-head">
          <h3>People</h3>
          <button className="btn btn-sm" onClick={() => setOnlyGaps(!onlyGaps)}>
            {onlyGaps ? 'Show everyone' : 'Show gaps only'}
          </button>
        </div>
        <p className="muted small">
          Licences and certificates come from HR records; nobody types them again here. Skills are assessed by a manager or officer, never by the person themselves.
        </p>
        <div className="list">
          {!rows.length && <div className="empty">Nothing open.</div>}
          {rows.slice(0, 100).map((r) => (
            <PersonLine key={r.person.id} row={r} data={data} />
          ))}
          {rows.length > 100 && <div className="muted small">Showing 100 of {rows.length}.</div>}
        </div>
      </section>
    </>
  );
}

type MatRow = CompMatrix['rows'][number];

function PersonLine({ row, data }: { row: MatRow; data: CompMatrix }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [result, setResult] = useState<'competent' | 'not_yet'>('competent');
  const [method, setMethod] = useState<CompMethod>('observation');
  const [note, setNote] = useState('');
  const [course, setCourse] = useState('');
  const profile = data.profiles.find((p) => p.id === row.profileId);
  const label = (id: string) => profile?.items.find((i) => i.id === id)?.label ?? id;
  const assessable = (profile?.items ?? []).filter((i) => i.kind !== 'credential');
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.person.name} · {row.person.staffNo}
          </div>
          <div className="muted small">{row.person.jobTitle ?? COMP_ROLE_LABEL[row.person.role]}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {row.gaps > 0 ? <Chip tone="warn">{row.gaps} gaps</Chip> : <Chip tone="ok">All met</Chip>}
          <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Close' : 'Open'}
          </button>
        </div>
      </div>
      {open && (
        <div style={col}>
          {row.items.map((i) => (
            <div key={i.itemId} className="row small" style={head}>
              <span>
                {label(i.itemId)}
                <span className="muted"> · {i.detail}</span>
                {i.dueOn ? <span className="muted"> · {dateLabel(i.dueOn)}</span> : null}
              </span>
              <Chip tone={COMP_TONE[i.state]}>{COMP_STATE_LABEL[i.state]}</Chip>
            </div>
          ))}
          {row.canAssess && assessable.length > 0 && (
            <>
              <select className="select" aria-label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Choose what you assessed</option>
                {assessable.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
              <select className="select" aria-label="Result" value={result} onChange={(e) => setResult(e.target.value as 'competent' | 'not_yet')}>
                <option value="competent">Competent</option>
                <option value="not_yet">Not yet competent</option>
              </select>
              <select className="select" aria-label="How" value={method} onChange={(e) => setMethod(e.target.value as CompMethod)}>
                {(Object.keys(COMP_METHOD_LABEL) as CompMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {COMP_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
              <input className="input" aria-label="What you saw" placeholder="What you saw (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
              <input className="input" aria-label="Course" placeholder="Course just attended, if any (optional)" value={course} onChange={(e) => setCourse(e.target.value)} />
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !itemId || note.trim().length < 3}
                onClick={() =>
                  act.run(() => api.qualityAction('assess', { personId: row.person.id, itemId, result, method, note, afterTraining: course }), 'Assessment saved.').then((x) => {
                    if (x) {
                      setNote('');
                      setCourse('');
                    }
                  })
                }
              >
                Save assessment
              </button>
            </>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function Profiles({ data }: { data: CompMatrix }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Role profiles</h3>
      </div>
      <p className="muted small">What each role needs. HR proposes a change; the HR Director decides with a reason, because it changes who counts as qualified.</p>
      <div className="list">
        {data.profiles.map((p) => (
          <div key={p.id} className="list-item" style={line}>
            <div className="row" style={head}>
              <span style={{ fontWeight: 600 }}>
                {p.name}, version {p.version}
              </span>
              <Chip tone={p.status === 'approved' ? 'ok' : p.status === 'proposed' ? 'warn' : 'info'}>
                {p.status === 'approved' ? 'In use' : p.status === 'proposed' ? 'Waiting for the HR Director' : 'Not agreed'}
              </Chip>
            </div>
            <div className="muted small">
              {p.items.map((i) => `${i.label} (${COMP_KIND_LABEL[i.kind].toLowerCase()}${i.refreshMonths ? `, every ${i.refreshMonths} months` : ''})`).join(' · ')}
            </div>
            <div className="muted small">
              Proposed by {p.proposed.by}: {p.proposed.note}
              {p.decision ? ` · ${p.decision.agree ? 'Agreed' : 'Not agreed'} by ${p.decision.by}: ${p.decision.note}` : ''}
            </div>
            {p.status === 'proposed' && data.canDecideProfile && p.proposed.byId !== undefined && (
              <>
                <input className="input" aria-label="Reason" placeholder="Reason (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-primary btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.qualityAction('decideProfile', { id: p.id, agree: true, note }), 'Profile in use.')}>
                    Agree
                  </button>
                  <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.qualityAction('decideProfile', { id: p.id, agree: false, note }), 'Sent back to HR.')}>
                    Not agreed
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}

// ---------- QMS foundation ----------

type FndRow = QmsFoundationBoard['rows'][number];
const FND_STATUS: Record<FndRow['item']['status'], [Tone, string]> = {
  draft: ['warn', 'Waiting for the CEO'],
  approved: ['ok', 'In force'],
  replaced: ['info', 'Replaced'],
  not_agreed: ['crit', 'Sent back'],
  active: ['ok', 'In use'],
  retired: ['info', 'Retired'],
};

function Foundation({ data }: { data: QmsFoundationBoard }) {
  const k = data.kpis;
  const [kind, setKind] = useState<QmsFoundationKind | null>(null);
  return (
    <>
      <div className="kpis">
        <Kpi label="Scope" value={k.scopeApproved ? 'Agreed' : 'Not agreed yet'} tone={k.scopeApproved ? 'ok' : 'warn'} />
        <Kpi label="Quality policy" value={k.policyApproved ? 'Agreed' : 'Not agreed yet'} tone={k.policyApproved ? 'ok' : 'warn'} />
        <Kpi label="Waiting for the CEO" value={k.drafts} tone={k.drafts ? 'warn' : 'ok'} />
        <Kpi label="Processes" value={k.processes} note={k.processesNoOwner ? `${k.processesNoOwner} without an owner` : undefined} />
        <Kpi label="Past review date" value={k.reviewLate} tone={k.reviewLate ? 'warn' : 'ok'} />
      </div>
      <p className="muted small">
        The base of the quality system: what it covers, the policy, what affects the business, who we serve and the main processes with their owners. ACT or
        the Chief of Staff keeps it; the CEO agrees the scope and the policy.
      </p>
      {(Object.keys(QMS_FOUNDATION_LABEL) as QmsFoundationKind[]).map((kd) => {
        const rows = data.rows.filter((r) => r.item.kind === kd && r.item.status !== 'replaced' && r.item.status !== 'retired');
        return (
          <section key={kd} className="panel">
            <div className="panel-head">
              <h3>{QMS_FOUNDATION_LABEL[kd]}</h3>
              {data.role === 'keep' && (
                <button className="btn btn-sm" onClick={() => setKind(kind === kd ? null : kd)}>
                  {kind === kd ? 'Cancel' : 'Add'}
                </button>
              )}
            </div>
            {kind === kd && <FoundationForm data={data} kind={kd} onDone={() => setKind(null)} />}
            <div className="list">
              {!rows.length && <div className="empty">Nothing recorded.</div>}
              {rows.map((r) => (
                <FoundationLine key={r.item.id} row={r} data={data} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function FoundationLine({ row, data }: { row: FndRow; data: QmsFoundationBoard }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState(false);
  const i = row.item;
  const [tone, label] = FND_STATUS[i.status];
  return (
    <div className="list-item" style={line}>
      <div className="row" style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {i.title}
            {i.kind === 'scope' || i.kind === 'policy' ? `, version ${i.version}` : ''}
            {i.side ? ` (${i.side === 'internal' ? 'inside' : 'outside'})` : ''}
          </div>
          {i.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{i.body}</div>}
          {i.needs && <div className="muted small">Needs: {i.needs}</div>}
          {i.monitor && <div className="muted small">How we keep track: {i.monitor}</div>}
          {i.ownerTitle && (
            <div className="muted small">
              Owner: {i.ownerTitle}
              {i.inputs ? ` · In: ${i.inputs}` : ''}
              {i.outputs ? ` · Out: ${i.outputs}` : ''}
            </div>
          )}
          {(i.measures || i.risks) && (
            <div className="muted small">
              {i.measures ? `Measured by: ${i.measures}` : ''}
              {i.measures && i.risks ? ' · ' : ''}
              {i.risks ? `Main risk: ${i.risks}` : ''}
            </div>
          )}
          {i.kind === 'process' && <div className="muted small">Requirements: {row.requirements.length ? row.requirements.map((r) => r.label).join(', ') : 'none linked'}</div>}
          {i.decision && (
            <div className="muted small">
              {i.decision.agree ? 'Agreed' : 'Sent back'} by {i.decision.by}: {i.decision.note}
            </div>
          )}
          <div className="muted small">Review by {dateLabel(row.reviewDueOn)}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {row.reviewLate && <Chip tone="warn">Review due</Chip>}
          <Chip tone={tone}>{label}</Chip>
        </div>
      </div>
      {(row.canDecide || row.canReview) && (
        <input className="input" aria-label="Reason" placeholder="Reason (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {row.canDecide && (
          <>
            <button className="btn btn-primary btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.qualityAction('decideFoundation', { id: i.id, agree: true, note }), 'Agreed.')}>
              Agree
            </button>
            <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.qualityAction('decideFoundation', { id: i.id, agree: false, note }), 'Sent back.')}>
              Send back
            </button>
          </>
        )}
        {row.canReview && (
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.qualityAction('reviewFoundation', { id: i.id, note }), 'Review recorded.')}>
            Record review
          </button>
        )}
        {row.canEdit && (
          <button className="btn btn-sm" onClick={() => setEdit(!edit)}>
            {edit ? 'Cancel' : 'Change'}
          </button>
        )}
      </div>
      {edit && <FoundationForm data={data} kind={i.kind} item={i} onDone={() => setEdit(false)} />}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function FoundationForm({ data, kind, item, onDone }: { data: QmsFoundationBoard; kind: QmsFoundationKind; item?: FndRow['item']; onDone: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [side, setSide] = useState<'internal' | 'external'>(item?.side ?? 'external');
  const [needs, setNeeds] = useState(item?.needs ?? '');
  const [monitor, setMonitor] = useState(item?.monitor ?? '');
  const [ownerTitle, setOwnerTitle] = useState(item?.ownerTitle ?? '');
  const [inputs, setInputs] = useState(item?.inputs ?? '');
  const [outputs, setOutputs] = useState(item?.outputs ?? '');
  const [measures, setMeasures] = useState(item?.measures ?? '');
  const [risks, setRisks] = useState(item?.risks ?? '');
  const [reqIds, setReqIds] = useState<string[]>(item?.requirementIds ?? []);
  const [note, setNote] = useState('');
  const versioned = kind === 'scope' || kind === 'policy';
  return (
    <div style={col}>
      <input className="input" aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      {kind !== 'party' && (
        <textarea className="input" aria-label="Text" rows={versioned ? 5 : 2} placeholder={versioned ? 'The text' : 'What it is'} value={body} onChange={(e) => setBody(e.target.value)} />
      )}
      {kind === 'issue' && (
        <select className="select" aria-label="Inside or outside" value={side} onChange={(e) => setSide(e.target.value as 'internal' | 'external')}>
          <option value="external">Outside the business</option>
          <option value="internal">Inside the business</option>
        </select>
      )}
      {kind === 'party' && (
        <>
          <input className="input" aria-label="Needs" placeholder="What they need from us" value={needs} onChange={(e) => setNeeds(e.target.value)} />
          <input className="input" aria-label="How we keep track" placeholder="How we keep track of it" value={monitor} onChange={(e) => setMonitor(e.target.value)} />
        </>
      )}
      {kind === 'process' && (
        <>
          <input className="input" aria-label="Owner" placeholder="Owner by job title" value={ownerTitle} onChange={(e) => setOwnerTitle(e.target.value)} />
          <input className="input" aria-label="In" placeholder="What goes in" value={inputs} onChange={(e) => setInputs(e.target.value)} />
          <input className="input" aria-label="Out" placeholder="What comes out" value={outputs} onChange={(e) => setOutputs(e.target.value)} />
          <input className="input" aria-label="Measured by" placeholder="How it is measured" value={measures} onChange={(e) => setMeasures(e.target.value)} />
          <input className="input" aria-label="Main risk" placeholder="Main risk" value={risks} onChange={(e) => setRisks(e.target.value)} />
          <select
            className="select"
            multiple
            aria-label="Requirements"
            value={reqIds}
            onChange={(e) => setReqIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
            style={{ minHeight: 120 }}
          >
            {data.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </>
      )}
      {item && <input className="input" aria-label="What changed" placeholder="What changed" value={note} onChange={(e) => setNote(e.target.value)} />}
      {versioned && item?.status === 'approved' && <div className="muted small">Saving makes a new version for the CEO. The current one stays in force until then.</div>}
      <button
        className="btn btn-primary btn-sm"
        disabled={act.busy || title.trim().length < 3}
        onClick={() =>
          act
            .run(
              () =>
                api.qualityAction('saveFoundation', {
                  id: item?.id,
                  kind,
                  title,
                  body,
                  side,
                  needs,
                  monitor,
                  ownerTitle,
                  inputs,
                  outputs,
                  measures,
                  risks,
                  requirementIds: reqIds,
                  note,
                }),
              versioned ? 'Sent to the CEO.' : 'Saved.',
            )
            .then((x) => x && onDone())
        }
      >
        {versioned ? 'Save and send to the CEO' : 'Save'}
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}
