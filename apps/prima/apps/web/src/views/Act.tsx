import { useState } from 'react';
import { api, type ActBoard, type ActFindingInput } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { actGuide, type ActGuideCtx, type ActGuideKind } from '../act-guide/guide';

/** Read-only guide card for the task in front of this person (BM with English); names only people on the record. */
function GuideCard({ kind, ctx }: { kind: ActGuideKind | null; ctx: ActGuideCtx }) {
  if (!kind) return null;
  const g = actGuide(kind, ctx);
  return (
    <details className="small" data-testid={`act-guide-${kind}`}>
      <summary>Panduan / Guide: {g.title}</summary>
      <div>Masukkan / Enter:</div>
      <ul style={{ margin: 0, paddingLeft: 20 }}>{g.enter.map((x) => <li key={x}>{x}</li>)}</ul>
      <div>Dokumen / Documents:</div>
      <ul style={{ margin: 0, paddingLeft: 20 }}>{g.documents.map((x) => <li key={x}>{x}</li>)}</ul>
      <div>Di mana / Where: {g.where}</div>
      <div>Tanya / Ask: {g.ask}</div>
    </details>
  );
}

/**
 * ACT, Audit, Compliance and Transformation (Fauzan, 27 Oct and 2 Nov 2026). 1 Director and 2 teams, each with 1
 * Auditor and 1 Enforcement officer. ACT monitors all compliance, audits every workflow, checks discrepancies, finds the
 * solution and leads the improvement. The owner fixes, the Auditor verifies, Enforcement follows up. Overdue findings
 * are shown to the next level, never punished.
 */

type Tab = 'monitor' | 'work' | 'reports' | 'findings' | 'plan' | 'timing' | 'improvements' | 'fraud';
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
const ROLE = { lead: 'Director', auditor: 'Auditor', enforcement: 'Enforcement officer' } as const;
const FOLLOW = { overdue: 'Past the due date', reopened: 'Fix failed the check', no_plan: 'No plan from the owner yet' } as const;
const METHOD = { call: 'Phone call', message: 'Message', email: 'Email', visit: 'Visit', meeting: 'Meeting', memo: 'Memo' } as const;

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
        ...(act ? ([['work', 'Team work']] as [Tab, string][]) : []),
        ['reports', 'Monthly reports'],
        ['findings', 'Findings'],
        ['plan', 'Workflow audits'],
        ['timing', 'Workflow timing'],
        ['improvements', 'Improvements'],
        ...(act && data.job ? ([['fraud', 'Patterns and investigations']] as [Tab, string][]) : []),
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
        {act && data.actRole && (
          <p className="small">
            You are the ACT {ROLE[data.actRole]}
            {data.myTeam ? `, Team ${data.myTeam}` : ''}.
          </p>
        )}
        {data.structure && <Structure data={data} />}
        <p className="notice" data-tone="info">
          Test data. Due dates, escalation steps and audit frequency confirmed by Fauzan, 27 Oct 2026. Both teams cover every workflow (Fauzan, 2 Nov 2026). Follow-up timing is
          a proposal.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Findings open" value={k.open} tone={k.open ? 'warn' : 'ok'} note={`${k.high} high`} />
        <Kpi label="Overdue" value={k.overdue} tone={k.overdue ? 'crit' : 'ok'} />
        <Kpi label="Fixes to check" value={k.toVerify} tone={k.toVerify ? 'warn' : 'ok'} />
        {watch && <Kpi label="Workflows due or never audited" value={k.plansOverdue} tone={k.plansOverdue ? 'warn' : 'ok'} />}
        {watch && <Kpi label="Field checks due or never done" value={k.fieldChecksDue} tone={k.fieldChecksDue ? 'warn' : 'ok'} />}
 {act && <Kpi label="Work given to teams" value={k.workOpen} tone={k.workOverdue ? 'crit' : k.workOpen ? 'info' : 'ok'} note={`${k.workOverdue} overdue`} />}
        {data.canAssign && <Kpi label="Findings to give a team" value={k.toAssign} tone={k.toAssign ? 'warn' : 'ok'} />}
        {watch && <Kpi label="Monthly reports not in" value={k.reportsProblem} tone={k.reportsProblem ? 'warn' : 'ok'} />}
        {act && <Kpi label="Follow-ups due" value={k.followUpsDue} tone={k.followUpsDue ? 'warn' : 'ok'} />}
        {act && data.job && <Kpi label="Patterns not yet checked" value={k.anomaliesOpen} tone={k.anomaliesOpen ? 'warn' : 'ok'} note={`${k.investigationsOpen} investigations open`} />}
        {act && <Kpi label="Signals with no finding" value={k.signalsUncovered} tone={k.signalsUncovered ? 'warn' : 'ok'} />}
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
      {current === 'work' && <Work data={data} />}
      {current === 'reports' && <Reports data={data} />}
      {current === 'findings' && <Findings data={data} prefill={prefill} clearPrefill={() => setPrefill(null)} />}
      {current === 'plan' && <Plan data={data} />}
      {current === 'timing' && <Timing data={data} />}
      {current === 'improvements' && <Improvements data={data} />}
      {current === 'fraud' && <Fraud data={data} />}
    </div>
  );
}

function Structure({ data }: { data: ActBoard }) {
  const s = data.structure!;
  return (
    <div className="list" style={{ marginTop: 8 }}>
      <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
        <div style={{ fontWeight: 600 }}>Director: {s.director?.name ?? 'not assigned'}</div>
        <div className="muted small">Covers every workflow, closes high findings, reports to the CEO.</div>
      </div>
      {s.teams.map((t) => (
        <div key={t.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
          <div style={{ fontWeight: 600 }}>{t.name}</div>
          <div className="small">
            Auditor: {t.auditor?.name ?? 'not assigned'} · Enforcement: {t.enforcement?.name ?? 'not assigned'}
          </div>
          <div className="muted small">Covers every workflow; keeps each finding it raises until it closes.</div>
        </div>
      ))}
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
        Each line counts records across the group that break a rule today, read straight from what each department already keeps. Open the
        screen to see them, or raise a finding with an owner: the count and date are filled in for you.
      </p>
      <div className="list">
        {data.signals.map((s) => (
          <div key={s.key} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div className="muted small">
                  {data.rule.areas.find((a) => a.id === s.area)?.name}
                  {s.coveredBy.length ? ` · followed in ${s.coveredBy.join(', ')}` : ''}
                </div>
              </div>
              <Chip tone={s.tone}>{s.count === 0 ? 'None' : String(s.count)}</Chip>
            </div>
            {s.count > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <a className="btn btn-sm" href={`#${s.view}`}>
                  Open
                </a>
                {data.canRaise && !s.coveredBy.length && (
                  <button
                    className="btn btn-sm"
                    onClick={() => onRaise({ area: s.area, source: 'monitor', title: s.label, evidence: '', signalKey: s.key })}
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
  const [teamOnly, setTeamOnly] = useState(!!data.myTeam);
  const rows = data.findings.filter((r) => (all || r.finding.status !== 'closed') && (!teamOnly || !data.myTeam || !r.team || r.team === data.myTeam));
  const showForm = data.canRaise && (form || !!prefill);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Findings</h3>
        <div className="row" style={{ gap: 6 }}>
          {!!data.myTeam && (
            <button className="btn btn-sm" onClick={() => setTeamOnly(!teamOnly)}>
              {teamOnly ? 'Show both teams' : 'My team only'}
            </button>
          )}
          {data.canRaise && (
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
        Fix within {data.rule.dueDays.high} days for high, {data.rule.dueDays.medium} for medium and {data.rule.dueDays.low} for low. The Auditor checks every fix;
        a high finding is closed only by the ACT Director. Enforcement follows up owners who are late.
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
  const [g, setG] = useState({ rootCause: '', solution: '', targetOn: '', proof: '', note: '', method: 'call', followNote: '', nextOn: '' });
  const follows = f.followUps ?? [];
  // Auditors and Enforcement act only on their own team's findings; the Director on any (server enforces the same).
  const onTeam = data.job === 'director' || (!!r.team && r.team === data.myTeam);
  const highForDirector = f.severity === 'high' && !data.canCloseHigh;
  const label = f.status === 'closed' ? 'Closed' : r.overdueDays ? `${r.overdueDays} days overdue` : STATUS[f.status];
  const last = f.checks[f.checks.length - 1];
  const live = f.status === 'open' || f.status === 'planned';
  const guideKind: ActGuideKind | null =
    r.mine && live
      ? !f.plan || f.status === 'open' ? 'owner_plan' : 'owner_fix'
      : data.canCheck && onTeam && f.status === 'fixed'
        ? 'act_check'
        : data.canRaise && onTeam && live && (r.followUp || data.job === 'enforcement')
          ? 'act_follow'
          : null;
  const guideCtx: ActGuideCtx = {
    ref: f.ref,
    owner: f.ownerName,
    raisedBy: f.raisedBy,
    team: r.team ?? null,
    director: data.structure?.director?.name ?? null,
    evidence: f.evidence,
    screen: r.areaName,
  };
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {f.ref}: {f.title}
          </div>
          <div className="muted small">
            {r.companyName} · {r.areaName}{r.team ? ` · Team ${r.team}` : ''} · {SEVERITY[f.severity]} · {SOURCE[f.source]} · raised by {f.raisedBy} {dateLabel(f.raisedAt.slice(0, 10))}
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
          {follows.length > 0 && (
            <div className="small">
              {follows.length} follow-up{follows.length > 1 ? 's' : ''}; last {METHOD[follows[follows.length - 1].method].toLowerCase()} by{' '}
              {follows[follows.length - 1].by} {dateTimeLabel(follows[follows.length - 1].at)}: {follows[follows.length - 1].note}
              {follows[follows.length - 1].nextOn ? ` · next ${dateLabel(follows[follows.length - 1].nextOn!)}` : ''}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {r.followUp && <Chip tone="warn">Follow up: {FOLLOW[r.followUp]}</Chip>}
          <Chip tone={r.tone}>{label}</Chip>
        </div>
      </div>
      <GuideCard kind={guideKind} ctx={guideCtx} />
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
      {data.canAssign && f.status !== 'closed' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="small">{r.team ? `With Team ${r.team}.` : 'Not yet given to a team.'}</span>
          {([1, 2] as const)
            .filter((t) => t !== r.team)
            .map((t) => (
              <button
                key={t}
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => act.run(() => api.actFindingStep(f.id, 'assign', { team: t }), `Given to Team ${t}.`)}
              >
                Give to Team {t}
              </button>
            ))}
        </div>
      )}
      {data.canRaise && onTeam && (f.status === 'open' || f.status === 'planned') && (r.followUp || data.job === 'enforcement') && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="input" aria-label="How you followed up" value={g.method} onChange={(e) => setG({ ...g, method: e.target.value })}>
            {Object.entries(METHOD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            className="input"
            aria-label="What the owner said"
            placeholder="What the owner said or promised"
            value={g.followNote}
            onChange={(e) => setG({ ...g, followNote: e.target.value })}
          />
          <label className="small">
            Next follow-up
            <input className="input" type="date" value={g.nextOn} onChange={(e) => setG({ ...g, nextOn: e.target.value })} />
          </label>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () => api.actFindingStep(f.id, 'follow_up', { method: g.method, note: g.followNote, nextOn: g.nextOn || undefined }),
                'Follow-up recorded.',
              )
            }
          >
            Record follow-up
          </button>
        </div>
      )}
      {data.canCheck && onTeam && f.status === 'fixed' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {highForDirector && <span className="small">High finding: you can send it back, but only the ACT Director closes it.</span>}
          <input
            className="input"
            aria-label="What you checked"
            placeholder="What you checked"
            value={g.note}
            onChange={(e) => setG({ ...g, note: e.target.value })}
          />
          {!highForDirector && (
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() => act.run(() => api.actFindingStep(f.id, 'check', { ok: true, note: g.note }), 'Closed.')}
            >
              Fix works, close
            </button>
          )}
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
    ownerUserId: data.owners.find((o) => o.central)?.id ?? '',
    signalKey: prefill?.signalKey ?? null,
  });
  const owners = data.owners.filter((o) => o.central || (!!f.companyId && o.companyIds.includes(f.companyId)));
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <select
        className="input"
        aria-label="Company"
        value={f.companyId ?? ''}
        onChange={(e) => {
          const companyId = e.target.value || null;
          const fits = data.owners.filter((o) => o.central || (!!companyId && o.companyIds.includes(companyId)));
          setF({ ...f, companyId, ownerUserId: fits.some((o) => o.id === f.ownerUserId) ? f.ownerUserId : (fits[0]?.id ?? '') });
        }}
      >
        <option value="">PWVSB department</option>
        {data.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {f.signalKey && <p className="small muted">From the compliance monitor: the workflow, today's count and date are added by the system.</p>}
      <select
        className="input"
        aria-label="Workflow"
        value={f.area}
        disabled={!!f.signalKey}
        onChange={(e) => setF({ ...f, area: e.target.value })}
      >
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
        placeholder={f.signalKey ? 'Anything else you saw (optional)' : 'What you saw (records, sample, photos)'}
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
                {p.assignedTo ? ` · given to Team ${p.assignedTo.team}, due ${dateLabel(p.assignedTo.dueOn ?? '')}` : ''}
              </div>
            </div>
            <Chip tone={STATE[p.state][0]}>{STATE[p.state][1]}</Chip>
          </div>
        ))}
      </div>
      {data.canCheck && (
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
        {data.canRaise && (
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

type WorkRow = ActBoard['work'][number];
type ReportRow = ActBoard['reports'][number];
const REPORT_STATUS: Record<ReportRow['status'], ['ok' | 'warn' | 'crit' | 'info', string]> = {
  on_time: ['ok', 'On time'],
  late: ['warn', 'Late'],
  missing: ['crit', 'Missing'],
  unknown: ['info', 'Not on the app yet'],
  not_due: ['info', 'Not due'],
  no_report: ['warn', 'No monthly report set'],
  incomplete: ['warn', 'Incomplete'],
};

/** The Director distributes audits and report reviews to the two teams; each team's Auditor records them done. */
function Work({ data }: { data: ActBoard }) {
  const [mineOnly, setMineOnly] = useState(!!data.myTeam);
  const rows = data.work.filter((w) => !mineOnly || w.mine);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Work given to the teams</h3>
        {!!data.myTeam && (
          <button className="btn btn-sm" onClick={() => setMineOnly(!mineOnly)}>
            {mineOnly ? 'Show both teams' : 'My team only'}
          </button>
        )}
      </div>
      <p className="muted small">
        Both teams cover every workflow. The ACT Director decides who does what: workflow audits, monthly report reviews and findings. The
        team&apos;s Auditor records the work done; anything wrong becomes a finding.
      </p>
      {data.canAssign && <AssignWork data={data} />}
      <div className="list">
        {!rows.length && <div className="empty">No open work.</div>}
        {rows.map((w) => (
          <WorkLine key={w.audit.id} w={w} data={data} />
        ))}
      </div>
    </section>
  );
}

function WorkLine({ w, data }: { w: WorkRow; data: ActBoard }) {
  const act = useAction();
  const [g, setG] = useState({ doneOn: '', result: 'clean' as 'clean' | 'findings', note: '' });
  const canDo = data.canAssign || (data.canCheck && w.mine);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{w.label}</div>
          <div className="muted small">
            Team {w.audit.team} · due {dateLabel(w.audit.dueOn ?? '')} · given by {w.audit.assigned?.by}
            {w.audit.assigned?.note ? ` · ${w.audit.assigned.note}` : ''}
          </div>
        </div>
        <Chip tone={w.overdue ? 'crit' : 'info'}>{w.overdue ? 'Overdue' : 'Open'}</Chip>
      </div>
      <GuideCard
        kind={canDo ? (w.audit.kind === 'report_review' ? 'report_review' : 'audit') : null}
        ctx={{ ref: w.label, team: w.audit.team ?? null, director: data.structure?.director?.name ?? null }}
      />
      {canDo && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <label className="small">
            Done on
            <input className="input" type="date" value={g.doneOn} onChange={(e) => setG({ ...g, doneOn: e.target.value })} />
          </label>
          <select className="input" aria-label="Result" value={g.result} onChange={(e) => setG({ ...g, result: e.target.value as 'clean' | 'findings' })}>
            <option value="clean">Clean</option>
            <option value="findings">Findings raised</option>
          </select>
          <input
            className="input"
            aria-label="What was checked"
            placeholder="What was checked (sample, figures compared)"
            value={g.note}
            onChange={(e) => setG({ ...g, note: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () => api.recordActAudit({ area: w.audit.area, companyId: w.audit.companyId, doneOn: g.doneOn, result: g.result, note: g.note, assignmentId: w.audit.id }),
                'Recorded.',
              )
            }
          >
            Record done
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AssignWork({ data, preset, onDone }: { data: ActBoard; preset?: Partial<Parameters<typeof api.assignActWork>[0]>; onDone?: () => void }) {
  const act = useAction();
  const reports = data.reports.filter((r) => r.defId && r.period);
  const [f, setF] = useState({
    kind: (preset?.kind ?? 'workflow') as 'workflow' | 'report_review',
    team: preset?.team ?? 1,
    area: preset?.area ?? data.rule.areas[0].id,
    companyId: preset?.companyId ?? '',
    reportKey: reports[0]?.key ?? '',
    dueOn: '',
    note: '',
  });
  const report = reports.find((r) => r.key === f.reportKey);
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <div className="label">Give work to a team</div>
      <select className="input" aria-label="Kind of work" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>
        <option value="workflow">Workflow audit</option>
        <option value="report_review">Monthly report review</option>
      </select>
      {f.kind === 'workflow' ? (
        <>
          <select className="input" aria-label="Workflow" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>
            {data.rule.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">PWVSB or group-wide</option>
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <select className="input" aria-label="Report" value={f.reportKey} onChange={(e) => setF({ ...f, reportKey: e.target.value })}>
          {reports.map((r) => (
            <option key={r.key} value={r.key}>
              {r.sender}: {r.report} ({r.period})
            </option>
          ))}
        </select>
      )}
      <select className="input" aria-label="Team" value={f.team} onChange={(e) => setF({ ...f, team: Number(e.target.value) })}>
        <option value={1}>Team 1</option>
        <option value={2}>Team 2</option>
      </select>
      <label className="small">
        Due (blank: {data.rule.assignDays} days)
        <input className="input" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} />
      </label>
      <input className="input" aria-label="Instruction" placeholder="Instruction to the team (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(
              () =>
                api.assignActWork(
                  f.kind === 'workflow'
                    ? { kind: 'workflow', team: f.team, area: f.area, companyId: f.companyId || null, dueOn: f.dueOn || null, note: f.note }
                    : { kind: 'report_review', team: f.team, defId: report?.defId ?? null, period: report?.period ?? null, companyId: report?.companyId ?? null, dueOn: f.dueOn || null, note: f.note },
                ),
              `Given to Team ${f.team}.`,
            )
            .then((x) => {
              if (x && onDone) onDone();
            })
        }
      >
        Give to Team {f.team}
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Monthly reports of every department and company, read from the Director Office list; ACT checks each one. */
function Reports({ data }: { data: ActBoard }) {
  const [kind, setKind] = useState<'department' | 'company'>('department');
  const rows = data.reports.filter((r) => r.senderKind === kind);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Monthly reports</h3>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" aria-pressed={kind === 'department'} onClick={() => setKind('department')}>
            Departments
          </button>
          <button className="btn btn-sm" aria-pressed={kind === 'company'} onClick={() => setKind('company')}>
            Companies
          </button>
        </div>
      </div>
      <p className="muted small">
        Each department sends its monthly report once, through the Director Office report list; ACT reads it here, nothing is sent twice. ACT
        checks it is on time, complete and true against the records in Prima. A department with no monthly report set is not green. Due on
        the {data.standardForm.dueDay}th of the next month.
      </p>
      {kind === 'department' && <Forms data={data} />}
      <div className="list">
        {!rows.length && <div className="empty">No monthly reports set.</div>}
        {rows.map((r) => {
          const [tone, label] = REPORT_STATUS[r.status];
          return (
            <div key={r.key} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.sender}</div>
                  <div className="muted small">
                    {r.report}
                    {r.period ? ` · ${r.period}, due ${dateLabel(r.due ?? '')}` : ''}
                    {r.sent ? ` · sent by ${r.sent.by} ${dateTimeLabel(r.sent.at)}` : ''}
                  </div>
                  {r.form && (
                    <div className="small">
                      Form: {r.form.covered} of {r.form.total} sections
                      {r.form.missing.length ? ` · missing: ${r.form.missing.join('; ')}` : ''}
                    </div>
                  )}
                  <div className="small">
                    ACT review:{' '}
                    {!r.review
                      ? 'not given to a team'
                      : r.review.status === 'assigned'
                        ? `with Team ${r.review.team}, due ${dateLabel(r.review.dueOn ?? '')}`
                        : `${r.review.result === 'clean' ? 'clean' : 'findings raised'} (${r.review.by}): ${r.review.note}`}
                  </div>
                </div>
                <Chip tone={tone}>{label}</Chip>
              </div>
              {data.canAssign && r.defId && !r.review && (
                <div className="row" style={{ gap: 6 }}>
                  {([1, 2] as const).map((t) => (
                    <QuickAssign key={t} team={t} r={r} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function QuickAssign({ team, r }: { team: 1 | 2; r: ReportRow }) {
  const act = useAction();
  return (
    <>
      <button
        className="btn btn-sm"
        disabled={act.busy}
        onClick={() =>
          act.run(
            () => api.assignActWork({ kind: 'report_review', team, defId: r.defId, period: r.period, companyId: r.companyId, dueOn: null, note: '' }),
            `Review given to Team ${team}.`,
          )
        }
      >
        Review: Team {team}
      </button>
      <ErrorNotice error={act.error} />
    </>
  );
}

/** The ACT Director decides what each department's monthly report covers, starting from the proposed standard form. */
function Forms({ data }: { data: ActBoard }) {
  const [open, setOpen] = useState<string | null>(null);
  const depts = [...new Set(data.reports.filter((r) => r.senderKind === 'department').map((r) => r.department!))];
  return (
    <details style={{ marginBottom: 8 }}>
      <summary className="small" style={{ cursor: 'pointer' }}>
        Monthly report forms ({data.reportForms.length} departments){data.canAssign ? ': the Director decides what each must cover' : ''}
      </summary>
      <div className="list">
        {depts.map((d) => {
          const f = data.reportForms.find((x) => x.department === d);
          const name = data.reports.find((r) => r.department === d)?.sender ?? d;
          return (
            <div key={d} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div className="muted small">
                    {f ? `${f.sections.length} sections, ${f.checks.length} ACT checks${f.formBy ? ` · set by ${f.formBy.by}` : ' · proposed form'}` : 'No monthly report set'}
                  </div>
                </div>
                {data.canAssign && (
                  <button className="btn btn-sm" onClick={() => setOpen(open === d ? null : d)}>
                    {f ? 'Change form' : 'Set the form'}
                  </button>
                )}
              </div>
              {open === d && (
                <FormEditor
                  department={d}
                  sections={f?.sections.length ? f.sections : data.standardForm.sections}
                  checks={f?.checks.length ? f.checks : (data.standardForm.checks[d] ?? [])}
                  onDone={() => setOpen(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function FormEditor({ department, sections, checks, onDone }: { department: string; sections: string[]; checks: string[]; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ sections: sections.join('\n'), checks: checks.join('\n'), note: '' });
  const lines = (x: string) => x.split('\n').map((y) => y.trim()).filter(Boolean);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label className="small">
        Sections the report must cover (one per line)
        <textarea className="input" rows={6} value={f.sections} onChange={(e) => setF({ ...f, sections: e.target.value })} />
      </label>
      <label className="small">
        Figures ACT compares with Prima (one per line)
        <textarea className="input" rows={3} value={f.checks} onChange={(e) => setF({ ...f, checks: e.target.value })} />
      </label>
      <input className="input" aria-label="Why" placeholder="Why the form is set or changed" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(() => api.setActReportForm({ department, sections: lines(f.sections), checks: lines(f.checks), note: f.note }), 'Form saved.')
            .then((x) => {
              if (x) onDone();
            })
        }
      >
        Save form
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

type PlanRow = ActBoard['plan'][number];
const FIELD_STATE = { never: ['warn', 'Never checked in the field'], overdue: ['crit', 'Field check overdue'], due_soon: ['warn', 'Field check due soon'], ok: ['ok', 'Field checked'] } as const;
const unitLabel = (n: number, u: 'hours' | 'days') => `${n} ${u === 'hours' ? (n === 1 ? 'hour' : 'hours') : n === 1 ? 'working day' : 'working days'}`;

/**
 * Workflow timing (Fauzan, 2 Nov 2026): after reviewing a workflow, the ACT Director sets the time each step may take;
 * ACT sees every step, a walk-through of how it should run, and checks in the field every 6 months what really happens.
 */
function Timing({ data }: { data: ActBoard }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Workflow timing</h3>
      </div>
      <p className="muted small">
        After ACT reviews a workflow, the ACT Director sets how often it is audited and the time each step may take, timed from when the work
        reaches the person. The walk-through shows when each step falls due on a working day ({data.rule.workDay.start} to {data.rule.workDay.end},
        Monday to Friday). Every {data.rule.fieldCheckMonths} months ACT checks in the field what actually happens. A workflow with no timing or
        no field check is not green.
      </p>
      <div className="list">
        {data.plan.map((p) => (
          <TimingLine key={p.area.id} p={p} data={data} />
        ))}
      </div>
    </section>
  );
}

function TimingLine({ p, data }: { p: PlanRow; data: ActBoard }) {
  const [open, setOpen] = useState<'edit' | 'field' | null>(null);
  const t = p.timing;
  const f = p.field;
  const last = f.last;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{p.area.name}</div>
          <div className="muted small">
            {t
              ? `Audit every ${t.auditMonths} months (default ${t.defaultMonths}) · ${t.segments.length} steps timed · set by ${t.setBy} ${dateLabel(t.setOn ?? '')}: ${t.reason}`
              : 'No timing set yet: steps are not timed.'}
          </div>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <Chip tone={t ? 'ok' : 'warn'}>{t ? 'Timed' : 'Not timed'}</Chip>
          <Chip tone={FIELD_STATE[f.state][0]}>{FIELD_STATE[f.state][1]}</Chip>
        </div>
      </div>
      {p.walkthrough.length > 0 && (
        <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
          {p.walkthrough.map((w, i) => (
            <li key={i}>
              {w.step}: {unitLabel(w.target, w.unit)} · if work arrives {w.startsAt.replace('T', ' ')}, due {w.dueAt.replace('T', ' ')}
              {t?.segments[i]?.key ? ` · key ${t.segments[i].key}` : ''}
            </li>
          ))}
        </ol>
      )}
      {last && (
        <div className="small">
          Field check {dateLabel(last.doneOn)} at {last.where} by {last.by} ({last.result === 'clean' ? 'clean' : 'findings raised'}):{' '}
          {last.observed
            .map((o) => `${o.step} ${unitLabel(o.actual, o.unit)}${o.target != null ? (o.actual > o.target ? ` (slower than ${o.target})` : ' (within time)') : ' (no timing)'}`)
            .join('; ')}
          {f.dueOn ? ` · next by ${dateLabel(f.dueOn)}` : ''}
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {data.canAssign && (
          <button className="btn btn-sm" onClick={() => setOpen(open === 'edit' ? null : 'edit')}>
            {t ? 'Change timing' : 'Set timing'}
          </button>
        )}
        {data.canRaise && (
          <button className="btn btn-sm" onClick={() => setOpen(open === 'field' ? null : 'field')}>
            Record field check
          </button>
        )}
      </div>
      {open && <GuideCard kind={open === 'edit' ? 'timing' : 'field_check'} ctx={{ ref: p.area.name, director: data.structure?.director?.name ?? null }} />}
      {open === 'edit' && <TimingEditor p={p} data={data} onDone={() => setOpen(null)} />}
      {open === 'field' && <FieldCheckForm p={p} onDone={() => setOpen(null)} />}
    </div>
  );
}

type Seg = { step: string; target: string; unit: 'hours' | 'days'; key: string };

function TimingEditor({ p, data, onDone }: { p: PlanRow; data: ActBoard; onDone: () => void }) {
  const act = useAction();
  const reviews = data.reviews.filter((r) => r.area === p.area.id).sort((a, b) => b.doneOn.localeCompare(a.doneOn));
  const [months, setMonths] = useState(String(p.timing?.auditMonths ?? p.area.months));
  const [reviewId, setReviewId] = useState(reviews[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [segs, setSegs] = useState<Seg[]>(
    p.timing?.segments.map((x) => ({ step: x.step, target: String(x.target), unit: x.unit, key: x.key ?? '' })) ?? [{ step: '', target: '', unit: 'hours', key: '' }],
  );
  const put = (i: number, patch: Partial<Seg>) => setSegs(segs.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  if (!reviews.length) return <p className="small">Review this workflow first: record a finished ACT audit of it, then set its timing.</p>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label className="small">
        Based on the review
        <select className="input" value={reviewId} onChange={(e) => setReviewId(e.target.value)}>
          {reviews.map((r) => (
            <option key={r.id} value={r.id}>
              {dateLabel(r.doneOn)} by {r.by} ({r.result})
            </option>
          ))}
        </select>
      </label>
      <label className="small">
        Audit every (months)
        <input className="input" type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} />
      </label>
      {segs.map((x, i) => (
        <div key={i} className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <input className="input" aria-label={`Step ${i + 1}`} placeholder={`Step ${i + 1}`} value={x.step} onChange={(e) => put(i, { step: e.target.value })} />
          <input className="input" aria-label="Time" type="number" min={0.1} step={0.5} style={{ width: 90 }} value={x.target} onChange={(e) => put(i, { target: e.target.value })} />
          <select className="input" aria-label="Unit" value={x.unit} onChange={(e) => put(i, { unit: e.target.value as Seg['unit'] })}>
            <option value="hours">hours</option>
            <option value="days">working days</option>
          </select>
          <input className="input" aria-label="Work key (optional)" placeholder="Work key (optional)" style={{ width: 160 }} value={x.key} onChange={(e) => put(i, { key: e.target.value })} />
          <button className="btn btn-sm" onClick={() => setSegs(segs.filter((_, n) => n !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setSegs([...segs, { step: '', target: '', unit: 'hours', key: '' }])}>
        Add a step
      </button>
      <input className="input" aria-label="Why" placeholder="Why this timing (what the review showed)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(
              () =>
                api.setActTiming({
                  area: p.area.id,
                  auditMonths: Number(months),
                  reviewId,
                  reason,
                  segments: segs.filter((x) => x.step.trim()).map((x) => ({ step: x.step, target: Number(x.target), unit: x.unit, key: x.key.trim() || null })),
                }),
              'Timing saved.',
            )
            .then((r) => {
              if (r) onDone();
            })
        }
      >
        Save timing
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function FieldCheckForm({ p, onDone }: { p: PlanRow; onDone: () => void }) {
  const act = useAction();
  const steps = p.timing?.segments ?? [];
  const [g, setG] = useState({ doneOn: '', where: '', note: '', result: 'clean' as 'clean' | 'findings' });
  const [obs, setObs] = useState(
    (steps.length ? steps : [{ step: '', unit: 'hours' as const }]).map((x) => ({ step: x.step, actual: '', unit: x.unit as 'hours' | 'days', note: '' })),
  );
  const put = (i: number, patch: Partial<(typeof obs)[number]>) => setObs(obs.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label className="small">
        Visited on
        <input className="input" type="date" value={g.doneOn} onChange={(e) => setG({ ...g, doneOn: e.target.value })} />
      </label>
      <input className="input" aria-label="Where" placeholder="Where (site, branch or office)" value={g.where} onChange={(e) => setG({ ...g, where: e.target.value })} />
      {obs.map((o, i) => (
        <div key={i} className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <input className="input" aria-label={`Step ${i + 1}`} placeholder="Step" value={o.step} onChange={(e) => put(i, { step: e.target.value })} />
          <input className="input" aria-label="Time seen" type="number" min={0} step={0.5} style={{ width: 90 }} placeholder="Seen" value={o.actual} onChange={(e) => put(i, { actual: e.target.value })} />
          <select className="input" aria-label="Unit" value={o.unit} onChange={(e) => put(i, { unit: e.target.value as 'hours' | 'days' })}>
            <option value="hours">hours</option>
            <option value="days">working days</option>
          </select>
          <input className="input" aria-label="What you saw" placeholder="What you saw" value={o.note} onChange={(e) => put(i, { note: e.target.value })} />
        </div>
      ))}
      <button className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setObs([...obs, { step: '', actual: '', unit: 'hours', note: '' }])}>
        Add a step
      </button>
      <select className="input" aria-label="Result" value={g.result} onChange={(e) => setG({ ...g, result: e.target.value as 'clean' | 'findings' })}>
        <option value="clean">Works as timed</option>
        <option value="findings">Findings raised</option>
      </select>
      <input className="input" aria-label="Summary" placeholder="What actually happens, in short" value={g.note} onChange={(e) => setG({ ...g, note: e.target.value })} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(
              () =>
                api.recordActFieldCheck({
                  area: p.area.id,
                  doneOn: g.doneOn,
                  where: g.where,
                  note: g.note,
                  result: g.result,
                  observed: obs.filter((o) => o.step.trim() && o.actual !== '').map((o) => ({ step: o.step, actual: Number(o.actual), unit: o.unit, note: o.note })),
                }),
              'Field check recorded.',
            )
            .then((r) => {
              if (r) onDone();
            })
        }
      >
        Save field check
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Record patterns (fraud-risk checks) and investigations (masterplan item 241, Fauzan 3 Nov 2026) ----------

type Inv = ActBoard['investigations'][number];
const OUTCOME = { substantiated: 'Substantiated', not_substantiated: 'Not substantiated', referred: 'Referred' } as const;

function readFile(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(f);
  });
}

function Fraud({ data }: { data: ActBoard }) {
  const act = useAction();
  const canOpen = data.job === 'director' || data.job === 'auditor';
  const [team, setTeam] = useState<1 | 2>(1);
  return (
    <div className="card">
      <h2>Record patterns to check</h2>
      <p className="small muted">
        Fixed checks on records Prima already keeps (rule {data.fraudRule.id}; dated checks look back {data.fraudRule.value.lookBackDays} days). A match or pattern is a
        reason for a person in ACT to check the records, never proof and never an accusation. Only ACT sees this tab. Prima makes no decision about any person; any
        outcome is a human decision after verification.
      </p>
      {canOpen && data.job === 'director' && (
        <label className="small">
          New investigations go to{' '}
          <select className="input" aria-label="Team for new investigations" value={team} onChange={(e) => setTeam(Number(e.target.value) as 1 | 2)}>
            <option value={1}>Team 1</option>
            <option value={2}>Team 2</option>
          </select>
        </label>
      )}
      <div className="list">
        {data.anomalies.map((r) => (
          <div key={r.key} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div className="small muted">{r.why}</div>
              </div>
              <Chip tone={r.items.length ? 'warn' : 'ok'}>{r.items.length ? `${r.items.length} found` : 'None found'}</Chip>
            </div>
            {r.items.map((i) => (
              <div key={i.key} className="row small" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <span>
                  {dateLabel(i.at)}: {i.text} <span className="muted">({i.ref})</span>
                </span>
                {i.investigation ? (
                  <Chip tone="info">
                    {i.investigation.ref} {i.investigation.state}
                  </Chip>
                ) : (
                  canOpen && (
                    <button
                      className="btn btn-sm"
                      disabled={act.busy}
                      onClick={() =>
                        act.run(
                          () => api.openActInvestigation({ title: r.title, note: i.text, anomalyKey: i.key, team: data.job === 'director' ? team : undefined }),
                          'Investigation opened.',
                        )
                      }
                    >
                      Open investigation
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <ErrorNotice error={act.error} />
      <h2 style={{ marginTop: 16 }}>Investigations</h2>
      <p className="small muted">
        Seen only by the ACT Director and the team it is given to. Evidence is kept with its SHA-256 and checked again each time it is opened; every open, add, view and close
        is in the custody log. Only the Director closes, with a reason; a referral goes to HR or Legal, who decide any action.
      </p>
      {canOpen && <NewInvestigation team={data.job === 'director' ? team : undefined} />}
      <div className="list">
        {data.investigations.length === 0 && <p className="muted small">No investigations.</p>}
        {data.investigations.map((v) => (
          <InvestigationLine key={v.id} v={v} data={data} />
        ))}
      </div>
    </div>
  );
}

function NewInvestigation({ team }: { team?: 1 | 2 }) {
  const act = useAction();
  const [g, setG] = useState({ title: '', note: '' });
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      <input className="input" aria-label="Investigation title" placeholder="Title (no names needed)" value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} />
      <input className="input" aria-label="What started it" placeholder="What started it" value={g.note} onChange={(e) => setG({ ...g, note: e.target.value })} />
      <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.openActInvestigation({ title: g.title, note: g.note, team }), 'Investigation opened.')}>
        Open investigation
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function InvestigationLine({ v, data }: { v: Inv; data: ActBoard }) {
  const act = useAction();
  const [g, setG] = useState({ note: '', source: '', outcome: 'not_substantiated' as 'substantiated' | 'not_substantiated' | 'referred', conclusion: '', referredTo: '' });
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [shown, setShown] = useState<{ name: string; intact: boolean } | null>(null);
  const open = v.state === 'open';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {v.ref}: {v.title}
          </div>
          <div className="small muted">
            {v.team ? `Team ${v.team}` : 'Not yet given to a team'} · {v.basis.note}
          </div>
        </div>
        <Chip tone={open ? 'warn' : 'ok'}>{open ? 'Open' : `Closed: ${OUTCOME[v.conclusion!.outcome]}`}</Chip>
      </div>
      <GuideCard kind={open ? 'investigation' : null} ctx={{ ref: v.ref, team: v.team, director: data.structure?.director?.name ?? null, evidence: v.basis.note }} />
      {v.conclusion && (
        <div className="small">
          Conclusion by {v.conclusion.by} {dateTimeLabel(v.conclusion.at)}: {v.conclusion.summary}
          {v.conclusion.referredTo ? ` · referred to ${v.conclusion.referredTo}` : ''}
        </div>
      )}
      {v.evidence.map((e) => (
        <div key={e.id} className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span>
            {e.name} · {Math.round(e.bytes / 1024)} KB · SHA-256 {e.sha256.slice(0, 16)}… · from {e.source} · added by {e.addedBy}
          </span>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() =>
              act.run(async () => {
                const r = await api.actEvidence(v.id, e.id);
                setShown({ name: r.evidence.name, intact: r.intact });
                const a = document.createElement('a');
                a.href = r.evidence.data;
                a.download = r.evidence.name;
                a.click();
              }, 'Opened; the viewing is logged.')
            }
          >
            Open file
          </button>
        </div>
      ))}
      {shown && <Chip tone={shown.intact ? 'ok' : 'crit'}>{shown.intact ? `${shown.name}: hash matches` : `${shown.name}: HASH DOES NOT MATCH`}</Chip>}
      {v.notes.map((n, i) => (
        <div key={i} className="small">
          {dateTimeLabel(n.at)} {n.by}: {n.text}
        </div>
      ))}
      <details className="small">
        <summary>Custody log ({v.custody.length})</summary>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {v.custody.map((c, i) => (
            <li key={i}>
              {dateTimeLabel(c.at)} · {c.by} · {c.action.replace('_', ' ')} · {c.detail}
            </li>
          ))}
        </ul>
      </details>
      {open && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              className="input"
              type="file"
              aria-label="Evidence file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setFile({ name: f.name, data: await readFile(f) });
              }}
            />
            <input className="input" aria-label="Where it came from" placeholder="Where it came from" value={g.source} onChange={(e) => setG({ ...g, source: e.target.value })} />
            <button
              className="btn btn-sm"
              disabled={act.busy || !file}
              onClick={() => act.run(() => api.addActEvidence(v.id, { name: file!.name, data: file!.data, source: g.source }), 'Evidence added.')}
            >
              Add evidence
            </button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input className="input" aria-label="Note" placeholder="Working note" value={g.note} onChange={(e) => setG({ ...g, note: e.target.value })} />
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.actInvestigationStep(v.id, { action: 'note', text: g.note }), 'Note added.')}>
              Add note
            </button>
          </div>
          {data.canAssign && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {([1, 2] as const)
                .filter((t) => t !== v.team)
                .map((t) => (
                  <button key={t} className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.actInvestigationStep(v.id, { action: 'assign', team: t }), `Given to Team ${t}.`)}>
                    Give to Team {t}
                  </button>
                ))}
              <select className="input" aria-label="Outcome" value={g.outcome} onChange={(e) => setG({ ...g, outcome: e.target.value as typeof g.outcome })}>
                {Object.entries(OUTCOME).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              {g.outcome === 'referred' && (
                <input className="input" aria-label="Referred to" placeholder="Referred to (e.g. HR or Legal)" value={g.referredTo} onChange={(e) => setG({ ...g, referredTo: e.target.value })} />
              )}
              <input className="input" aria-label="Conclusion" placeholder="Conclusion and reason" value={g.conclusion} onChange={(e) => setG({ ...g, conclusion: e.target.value })} />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  act.run(() => api.actInvestigationStep(v.id, { action: 'close', outcome: g.outcome, text: g.conclusion, referredTo: g.referredTo || null }), 'Investigation closed.')
                }
              >
                Close investigation
              </button>
            </div>
          )}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
