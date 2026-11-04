import { useState } from 'react';
import { api, type ActBoard, type ActFindingInput } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * ACT, Audit, Compliance and Transformation (Fauzan, 27 Oct 2026). A Lead and a Deputy, each with an Assistant cum
 * Enforcement. ACT monitors all compliance, audits every workflow, checks discrepancies, finds the solution and leads
 * the improvement. The owner fixes and ACT verifies. Overdue findings are shown to the next level, never punished.
 */

type Tab = 'monitor' | 'findings' | 'plan' | 'improvements';
type FindingRow = ActBoard['findings'][number];
type Prefill = Partial<ActFindingInput> | null;

const SEVERITY = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const STATUS: Record<FindingRow['finding']['status'], string> = {
  open: 'Owner to plan the fix',
  planned: 'Owner fixing',
  fixed: 'ACT to check',
  closed: 'Closed',
};
const SOURCE = { monitor: 'Compliance monitor', workflow_audit: 'Workflow audit', speak_up: 'Speak up', manual: 'Other' } as const;
const ROLE = { lead: 'Lead', deputy: 'Deputy', assistant: 'Assistant cum Enforcement' } as const;

export function ActView() {
  const { data, error } = useLoad(() => api.actBoard(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  const [prefill, setPrefill] = useState<Prefill>(null);
  if (error)
    return (
      <div className="page">
        <h1>ACT</h1>
        <p className="muted">No ACT findings or improvements are assigned to you.</p>
      </div>
    );
  if (!data) return <Loading what="ACT" />;
  const act = data.role === 'act';
  const watch = !!data.role;
  const current: Tab = tab ?? (watch ? 'monitor' : 'findings');
  const k = data.kpis;
  const tabs: [Tab, string][] = watch
    ? [
        ['monitor', 'Compliance monitor'],
        ['findings', 'Findings'],
        ['plan', 'Workflow audits'],
        ['improvements', 'Improvements'],
      ]
    : [
        ['findings', 'My findings'],
        ['improvements', 'Improvements'],
      ];
  return (
    <div className="page">
      <div className="page-head">
        <h1>ACT: Audit, Compliance and Transformation</h1>
        <p className="muted">
          {watch
            ? 'ACT watches compliance in every company and department, audits each workflow, records each discrepancy with an owner, checks the fix, and leads the improvement. Overdue findings are shown to the Chief of Staff, then the COO and the CEO. Nothing here is automatic discipline.'
            : 'ACT found these in your area. Give the cause and the fix, do it, then mark it fixed with the proof. ACT checks it before it closes.'}
        </p>
        {act && data.actRole && <p className="small">You are the ACT {ROLE[data.actRole]}.</p>}
        <p className="notice" data-tone="info">
          Test data. Due dates, escalation steps and audit frequency confirmed by Fauzan, 27 Oct 2026.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Findings open" value={k.open} tone={k.open ? 'warn' : 'ok'} note={`${k.high} high`} />
        <Kpi label="Overdue" value={k.overdue} tone={k.overdue ? 'crit' : 'ok'} />
        <Kpi label="Fixes to check" value={k.toVerify} tone={k.toVerify ? 'warn' : 'ok'} />
        {watch && <Kpi label="Workflows due or never audited" value={k.plansOverdue} tone={k.plansOverdue ? 'warn' : 'ok'} />}
      </div>
      <div className="tabbar" role="tablist" aria-label="ACT" style={{ flexWrap: 'wrap' }}>
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {current === 'monitor' && (
        <Monitor
          data={data}
          onRaise={(p) => {
            setPrefill(p);
            setTab('findings');
          }}
        />
      )}
      {current === 'findings' && <Findings data={data} prefill={prefill} clearPrefill={() => setPrefill(null)} />}
      {current === 'plan' && <Plan data={data} />}
      {current === 'improvements' && <Improvements data={data} />}
    </div>
  );
}

function Monitor({ data, onRaise }: { data: ActBoard; onRaise: (p: Prefill) => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Compliance monitor</h3>
      </div>
      <p className="muted small">
        Each line counts records across the group that break a rule today. Open the screen to see them, or raise a finding with an owner.
      </p>
      <div className="list">
        {data.signals.map((s) => (
          <div key={s.key} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div className="muted small">{data.rule.areas.find((a) => a.id === s.area)?.name}</div>
              </div>
              <Chip tone={s.tone}>{s.count === 0 ? 'None' : String(s.count)}</Chip>
            </div>
            {s.count > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <a className="btn btn-sm" href={`#${s.view}`}>
                  Open
                </a>
                {data.role === 'act' && (
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      onRaise({ area: s.area, source: 'monitor', title: s.label, evidence: `${s.count} records on ${new Date().toISOString().slice(0, 10)}` })
                    }
                  >
                    Raise a finding
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Findings({ data, prefill, clearPrefill }: { data: ActBoard; prefill: Prefill; clearPrefill: () => void }) {
  const [all, setAll] = useState(false);
  const [form, setForm] = useState(false);
  const rows = data.findings.filter((r) => all || r.finding.status !== 'closed');
  const showForm = data.role === 'act' && (form || !!prefill);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Findings</h3>
        <div className="row" style={{ gap: 6 }}>
          {data.role === 'act' && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setForm(!showForm);
                clearPrefill();
              }}
            >
              Raise a finding
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? 'Hide closed' : 'Show closed'}
          </button>
        </div>
      </div>
      <p className="muted small">
        Fix within {data.rule.dueDays.high} days for high, {data.rule.dueDays.medium} for medium and {data.rule.dueDays.low} for low. ACT checks every fix; a
        high finding is closed only by the ACT Lead or Deputy.
      </p>
      {showForm && (
        <NewFinding
          key={JSON.stringify(prefill)}
          data={data}
          prefill={prefill}
          onDone={() => {
            setForm(false);
            clearPrefill();
          }}
        />
      )}
      <div className="list">
        {!rows.length && <div className="empty">No open findings.</div>}
        {rows.map((r) => (
          <FindingLine key={r.finding.id} r={r} data={data} />
        ))}
      </div>
    </section>
  );
}

function FindingLine({ r, data }: { r: FindingRow; data: ActBoard }) {
  const act = useAction();
  const f = r.finding;
  const [g, setG] = useState({ rootCause: '', solution: '', targetOn: '', proof: '', note: '' });
  const label = f.status === 'closed' ? 'Closed' : r.overdueDays ? `${r.overdueDays} days overdue` : STATUS[f.status];
  const last = f.checks[f.checks.length - 1];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {f.ref}: {f.title}
          </div>
          <div className="muted small">
            {r.companyName} · {r.areaName} · {SEVERITY[f.severity]} · {SOURCE[f.source]} · raised by {f.raisedBy} {dateLabel(f.raisedAt.slice(0, 10))}
          </div>
          <div className="small">Evidence: {f.evidence}</div>
          {f.detail && <div className="small">{f.detail}</div>}
          <div className="small">
            Owner {f.ownerName} · due {dateLabel(f.dueOn)}
            {r.escalatedTo ? ` · shown to the ${r.escalatedTo}` : ''}
          </div>
          {f.plan && (
            <div className="small">
              Cause: {f.plan.rootCause} · Fix: {f.plan.solution} · by {dateLabel(f.plan.targetOn)}
            </div>
          )}
          {f.fix && (
            <div className="small">
              Marked fixed {dateTimeLabel(f.fix.at)}: {f.fix.proof}
            </div>
          )}
          {last && (
            <div className="small">
              {last.ok ? 'Checked and closed' : 'Check failed'} by {last.by}: {last.note}
            </div>
          )}
        </div>
        <Chip tone={r.tone}>{label}</Chip>
      </div>
      {r.mine && (f.status === 'open' || f.status === 'planned') && (
        <div style={{ display: 'grid', gap: 6 }}>
          {!f.plan || f.status === 'open' ? (
            <>
              <input
                className="input"
                aria-label="Cause"
                placeholder="Why it happened"
                value={g.rootCause}
                onChange={(e) => setG({ ...g, rootCause: e.target.value })}
              />
              <input
                className="input"
                aria-label="Fix"
                placeholder="What you will change"
                value={g.solution}
                onChange={(e) => setG({ ...g, solution: e.target.value })}
              />
              <label className="small">
                Done by
                <input className="input" type="date" value={g.targetOn} onChange={(e) => setG({ ...g, targetOn: e.target.value })} />
              </label>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  act.run(() => api.actFindingStep(f.id, 'plan', { rootCause: g.rootCause, solution: g.solution, targetOn: g.targetOn }), 'Plan saved.')
                }
              >
                Save the plan
              </button>
            </>
          ) : (
            <>
              <input
                className="input"
                aria-label="Proof"
                placeholder="Proof it is fixed (records, photos, new procedure)"
                value={g.proof}
                onChange={(e) => setG({ ...g, proof: e.target.value })}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => act.run(() => api.actFindingStep(f.id, 'fixed', { proof: g.proof }), 'Sent to ACT to check.')}
              >
                Mark fixed
              </button>
            </>
          )}
        </div>
      )}
      {data.role === 'act' && f.status === 'fixed' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="What you checked"
            placeholder="What you checked"
            value={g.note}
            onChange={(e) => setG({ ...g, note: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.actFindingStep(f.id, 'check', { ok: true, note: g.note }), 'Closed.')}
          >
            Fix works, close
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.actFindingStep(f.id, 'check', { ok: false, note: g.note }), 'Sent back to the owner.')}
          >
            Not fixed
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewFinding({ data, prefill, onDone }: { data: ActBoard; prefill: Prefill; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState<ActFindingInput>({
    companyId: null,
    area: prefill?.area ?? data.rule.areas[0].id,
    source: prefill?.source ?? 'workflow_audit',
    title: prefill?.title ?? '',
    detail: '',
    severity: 'medium',
    evidence: prefill?.evidence ?? '',
    ownerUserId: data.owners[0]?.id ?? '',
  });
  const owners = data.owners.filter((o) => !f.companyId || o.companyIds.includes(f.companyId) || !o.companyIds.length);
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <select className="input" aria-label="Company" value={f.companyId ?? ''} onChange={(e) => setF({ ...f, companyId: e.target.value || null })}>
        <option value="">PWVSB department</option>
        {data.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Workflow" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>
        {data.rule.areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input className="input" aria-label="What is wrong" placeholder="What is wrong" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input
        className="input"
        aria-label="Evidence"
        placeholder="What you saw (records, sample, photos)"
        value={f.evidence}
        onChange={(e) => setF({ ...f, evidence: e.target.value })}
      />
      <input
        className="input"
        aria-label="Detail"
        placeholder="More detail (optional)"
        value={f.detail}
        onChange={(e) => setF({ ...f, detail: e.target.value })}
      />
      <select
        className="input"
        aria-label="Severity"
        value={f.severity}
        onChange={(e) => setF({ ...f, severity: e.target.value as ActFindingInput['severity'] })}
      >
        <option value="high">High: fix in {data.rule.dueDays.high} days</option>
        <option value="medium">Medium: fix in {data.rule.dueDays.medium} days</option>
        <option value="low">Low: fix in {data.rule.dueDays.low} days</option>
      </select>
      <select className="input" aria-label="Owner" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.title})
          </option>
        ))}
      </select>
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(() => api.raiseActFinding(f), 'Finding raised and sent to the owner.')
            .then((x) => {
              if (x) onDone();
            })
        }
      >
        Raise finding
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Plan({ data }: { data: ActBoard }) {
  const act = useAction();
  const [f, setF] = useState({ area: data.rule.areas[0].id, companyId: '', doneOn: '', result: 'clean' as 'clean' | 'findings', note: '' });
  const STATE = { never: ['warn', 'Never audited'], overdue: ['crit', 'Audit overdue'], due_soon: ['warn', 'Due soon'], ok: ['ok', 'Audited'] } as const;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Workflow audit plan</h3>
      </div>
      <p className="muted small">
        Every workflow is audited on a cycle: high-risk ones every 6 months, the rest every year. A workflow never audited is not green.
      </p>
      <div className="list">
        {data.plan.map((p) => (
          <div key={p.area.id} className="list-item">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{p.area.name}</div>
              <div className="muted small">
                Every {p.area.months} months · {p.last ? `last ${dateLabel(p.last.doneOn)} by ${p.last.by} (${p.last.result})` : 'no audit yet'}
                {p.dueOn ? ` · next by ${dateLabel(p.dueOn)}` : ''}
                {p.open ? ` · ${p.open} findings open` : ''}
              </div>
            </div>
            <Chip tone={STATE[p.state][0]}>{STATE[p.state][1]}</Chip>
          </div>
        ))}
      </div>
      {data.role === 'act' && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          <div className="label">Record an audit done</div>
          <select className="input" aria-label="Workflow audited" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>
            {data.rule.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Company audited" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">PWVSB or group-wide</option>
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="small">
            Audited on
            <input className="input" type="date" value={f.doneOn} onChange={(e) => setF({ ...f, doneOn: e.target.value })} />
          </label>
          <select className="input" aria-label="Result" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as 'clean' | 'findings' })}>
            <option value="clean">Clean</option>
            <option value="findings">Findings raised</option>
          </select>
          <input
            className="input"
            aria-label="What was checked"
            placeholder="What was checked (sample, period)"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.recordActAudit({ ...f, companyId: f.companyId || null }), 'Audit recorded.')}
          >
            Save audit
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </section>
  );
}

function Improvements({ data }: { data: ActBoard }) {
  const [form, setForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Improvements</h3>
        {data.role === 'act' && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            Propose an improvement
          </button>
        )}
      </div>
      <p className="muted small">
        ACT finds the cause and leads the change. The COO or CEO approves, the owner carries out each step, and ACT records whether the benefit came.
      </p>
      {form && <NewImprovement data={data} onDone={() => setForm(false)} />}
      <div className="list">
        {!data.improvements.length && <div className="empty">No improvements yet.</div>}
        {data.improvements.map((r) => (
          <ImprovementLine key={r.improvement.id} r={r} data={data} />
        ))}
      </div>
    </section>
  );
}

function ImprovementLine({ r, data }: { r: ActBoard['improvements'][number]; data: ActBoard }) {
  const act = useAction();
  const i = r.improvement;
  const [note, setNote] = useState('');
  const canTick = !!i.approved && !i.result && (r.mine || data.role === 'act');
  const tone = i.result ? 'ok' : r.late ? 'crit' : !i.approved ? 'warn' : 'info';
  const label = i.result ? 'Done' : r.late ? 'Past target' : !i.approved ? 'Waiting for approval' : `${r.done} of ${i.steps.length} steps`;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {i.ref}: {i.title}
          </div>
          <div className="muted small">
            Benefit: {i.benefit} · owner {i.ownerName} · led by {i.ledBy} · target {dateLabel(i.targetOn)}
            {i.approved ? ` · approved by ${i.approved.by}` : ''}
          </div>
          {i.result && <div className="small">Result: {i.result.note}</div>}
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
        {i.steps.map((s, n) => (
          <li key={n}>
            {s.text}: {s.doneOn ? `done ${dateLabel(s.doneOn)} by ${s.by}` : 'to do'}{' '}
            {!s.doneOn && canTick && (
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => act.run(() => api.actImprovementStep(i.id, 'step', { index: n }), 'Step done.')}
              >
                Done
              </button>
            )}
          </li>
        ))}
      </ol>
      {!i.approved && data.canApprove && (
        <button
          className="btn btn-sm btn-primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={act.busy}
          onClick={() => act.run(() => api.actImprovementStep(i.id, 'approve', {}), 'Approved.')}
        >
          Approve
        </button>
      )}
      {data.role === 'act' && !i.result && r.done === i.steps.length && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Result" placeholder="What changed and the benefit seen" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.actImprovementStep(i.id, 'result', { note }), 'Result recorded.')}
          >
            Record result
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewImprovement({ data, onDone }: { data: ActBoard; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ title: '', benefit: '', ownerUserId: data.owners[0]?.id ?? '', targetOn: '', steps: '', findingIds: [] as string[] });
  const open = data.findings.filter((r) => r.finding.status !== 'closed');
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <input className="input" aria-label="Improvement" placeholder="The improvement" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input
        className="input"
        aria-label="Benefit"
        placeholder="Benefit expected"
        value={f.benefit}
        onChange={(e) => setF({ ...f, benefit: e.target.value })}
      />
      <select className="input" aria-label="Owner" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}>
        {data.owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.title})
          </option>
        ))}
      </select>
      <label className="small">
        Target date
        <input className="input" type="date" value={f.targetOn} onChange={(e) => setF({ ...f, targetOn: e.target.value })} />
      </label>
      <textarea
        className="input"
        aria-label="Steps"
        placeholder="Steps, one per line"
        rows={3}
        value={f.steps}
        onChange={(e) => setF({ ...f, steps: e.target.value })}
      />
      {open.length > 0 && (
        <select
          className="input"
          aria-label="From findings"
          multiple
          value={f.findingIds}
          onChange={(e) => setF({ ...f, findingIds: [...e.target.selectedOptions].map((o) => o.value) })}
        >
          {open.map((r) => (
            <option key={r.finding.id} value={r.finding.id}>
              {r.finding.ref} {r.finding.title}
            </option>
          ))}
        </select>
      )}
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(() => api.addActImprovement({ ...f, steps: f.steps.split('\n') }), 'Proposed. The COO or CEO approves it.')
            .then((x) => {
              if (x) onDone();
            })
        }
      >
        Propose
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}
