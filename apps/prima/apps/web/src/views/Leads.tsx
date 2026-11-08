import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type SalesLeadInput, type SalesLeads } from '../api';
import { PlusIcon } from '@phosphor-icons/react';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Sales leads before quoting (V3 CRM). Research the prospect (SSM search, payment record, current provider, risks) and
 * survey the site before pricing. A slow or unknown payer needs the company manager to accept the risk. A lead another
 * group company is also chasing shows as a conflict.
 */

type Row = SalesLeads['leads'][number];

const SECTOR: Record<SalesLeadInput['sector'], string> = {
  GOVERNMENT: 'Government',
  BANK: 'Bank',
  INDUSTRIAL: 'Industrial',
  COMMERCIAL: 'Commercial',
  RESIDENTIAL: 'Residential',
  EDUCATION: 'Education',
  HEALTH: 'Health',
  OTHER: 'Other',
};
const STAGE: Record<Row['lead']['stage'], string> = {
  new: 'New',
  researched: 'Researched',
  surveyed: 'Surveyed',
  proposal: 'Quotation with client',
  won: 'Won',
  lost: 'Lost',
  dropped: 'Dropped',
};
const PAYMENT = { good: 'Pays on time', slow: 'Slow payer', unknown: 'Payment record unknown' } as const;
const rm = (n: number) => `RM ${n.toLocaleString('en-MY')}`;

export function LeadsPanel({ companyId }: { companyId: string }) {
  const { data, error } = useLoad(() => api.salesLeads(companyId), [companyId]);
  const [form, setForm] = useState(false);
  const [all, setAll] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="leads" />;
  const k = data.kpis;
  const rows = data.leads.filter((r) => all || r.open);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Leads and client research</h3>
        <div className="row" style={{ gap: 6 }}>
          {data.can.prepare && (
            <button className="btn btn-sm btn-primary" onClick={() => setForm(true)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              New lead
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? 'Hide closed' : 'Show closed'}
          </button>
        </div>
      </div>
      <p className="muted small">
        Before pricing, search SSM that the prospect is live, check how it pays, note the current provider and risks, then survey the site. A slow or unknown
        payer needs the company manager to accept the risk. A lead with no next step for {data.rule.staleDays} days is stale.
      </p>
      <div className="kpis">
        <Kpi label="Open leads" value={k.open} note={`${rm(k.pipeline)} a month`} />
        <Kpi label="Stale or overdue" value={k.stale} tone={k.stale ? 'warn' : 'ok'} />
        <Kpi label="Also chased by a group company" value={k.conflicts} tone={k.conflicts ? 'warn' : 'ok'} />
        <Kpi label="Won in 90 days" value={k.won90} note={`of ${k.closed90} closed`} />
      </div>
      {form && (
        <Drawer title="New lead" sub="Research the prospect and survey the site before pricing it." onClose={() => setForm(false)}>
          <NewLead companyId={companyId} onDone={() => setForm(false)} />
        </Drawer>
      )}
      <div className="list">
        {!rows.length && (
          <div className="empty">
            {all ? 'No leads yet.' : 'No open leads.'} {data.can.prepare ? 'Use New lead to record a prospect.' : 'The company admin team records leads here.'}
          </div>
        )}
        {rows.map((r) => (
          <LeadLine key={r.lead.id} r={r} data={data} />
        ))}
      </div>
    </section>
  );
}

function LeadLine({ r, data }: { r: Row; data: SalesLeads }) {
  const act = useAction();
  const l = r.lead;
  const can = data.can.prepare && r.open;
  const [mode, setMode] = useState<'' | 'research' | 'survey' | 'risk' | 'quotation' | 'note' | 'close'>('');
  const [f, setF] = useState({
    ssmRegNo: l.research?.ssmRegNo ?? '',
    ssmActive: l.research?.ssmActive ?? true,
    ssmCheckedOn: l.research?.ssmCheckedOn ?? '',
    payment: (l.research?.payment ?? 'unknown') as 'good' | 'slow' | 'unknown',
    currentProvider: l.research?.currentProvider ?? '',
    risks: l.research?.risks ?? '',
    armed: l.research?.armed ?? false,
    on: '',
    guardsNeeded: String(l.guardsEst),
    hoursPerDay: 12 as 8 | 12,
    note: '',
    quotationId: data.quotations[0]?.id ?? '',
    text: '',
    nextOn: '',
    nextWhat: '',
  });
  const label = r.open
    ? l.research && !l.research.ssmActive
      ? 'Not live on SSM'
      : r.overdue
        ? 'Next step overdue'
        : r.stale
          ? 'Stale'
          : STAGE[l.stage]
    : STAGE[l.stage];
  const steps: [typeof mode, string][] = [];
  if (can) {
    steps.push(['research', l.research ? 'Redo research' : 'Research']);
    if (l.research && l.stage !== 'proposal') steps.push(['survey', l.survey ? 'Redo survey' : 'Site survey']);
    if (r.riskNeedsManager && data.isManager) steps.push(['risk', 'Accept payment risk']);
    if (l.stage === 'surveyed' && !r.riskNeedsManager) steps.push(['quotation', 'Link quotation']);
    steps.push(['note', 'Note or next step'], ['close', 'Close']);
  }
  const next = { nextOn: f.nextOn || undefined, nextWhat: f.nextWhat };
  const nextInputs = (
    <>
      <label className="small">
        Next step date
        <input className="input" type="date" value={f.nextOn} onChange={(e) => setF({ ...f, nextOn: e.target.value })} />
      </label>
      <input className="input" aria-label="Next step" placeholder="Next step" value={f.nextWhat} onChange={(e) => setF({ ...f, nextWhat: e.target.value })} />
    </>
  );
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {l.ref}: {l.prospect}
          </div>
          <div className="muted small">
            {SECTOR[l.sector]} · {l.source} · about {l.guardsEst} guards{l.estMonthly ? `, ${rm(l.estMonthly)} a month` : ''} · {l.owner}
          </div>
          {l.research && (
            <div className="small">
              SSM {l.research.ssmRegNo} {l.research.ssmActive ? 'live' : 'NOT live'} ({dateLabel(l.research.ssmCheckedOn)}) · {PAYMENT[l.research.payment]} ·
              now with {l.research.currentProvider}
              {l.research.armed ? ' · armed work' : ''} · risks: {l.research.risks}
            </div>
          )}
          {l.survey && (
            <div className="small">
              Survey {dateLabel(l.survey.on)} by {l.survey.by}: {l.survey.guardsNeeded} guards, {l.survey.hoursPerDay}-hour shifts
              {l.survey.note ? `, ${l.survey.note}` : ''}
            </div>
          )}
          {l.riskAcceptedBy && <div className="small">Payment risk accepted by {l.riskAcceptedBy}</div>}
          {r.quotation && (
            <div className="small">
              Quotation {r.quotation.ref}: {rm(r.quotation.monthlyTotal)} a month, {r.quotation.status.replace('_', ' ')}
            </div>
          )}
          {r.conflicts.length > 0 && <div className="small">Also chased by {r.conflicts.join(', ')}. Agree with them who leads.</div>}
          <div className="muted small">
            {l.closed
              ? `Closed ${dateLabel(l.closed.on)} by ${l.closed.by}: ${l.closed.reason}`
              : l.nextAction
                ? `Next: ${l.nextAction.what}, ${dateLabel(l.nextAction.on)}`
                : `Waiting: ${r.waiting}`}
          </div>
          {l.notes.length > 0 && (
            <div className="muted small">
              Last note {dateTimeLabel(l.notes[l.notes.length - 1].at)}: {l.notes[l.notes.length - 1].text}
            </div>
          )}
        </div>
        <Chip tone={r.tone}>{label}</Chip>
      </div>
      {steps.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {steps.map(([k, t]) => (
            <button key={k} className="btn btn-sm" aria-pressed={mode === k} onClick={() => setMode(mode === k ? '' : k)}>
              {t}
            </button>
          ))}
          {l.stage === 'proposal' && r.quotation?.status === 'accepted' && (
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() => act.run(() => api.salesLeadStep(l.id, 'won', {}), 'Won. Open client onboarding next.')}
            >
              Mark won
            </button>
          )}
        </div>
      )}
      {mode === 'research' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            className="input"
            aria-label="SSM number"
            placeholder="SSM registration number"
            value={f.ssmRegNo}
            onChange={(e) => setF({ ...f, ssmRegNo: e.target.value })}
          />
          <label className="small">
            SSM searched on
            <input className="input" type="date" value={f.ssmCheckedOn} onChange={(e) => setF({ ...f, ssmCheckedOn: e.target.value })} />
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={f.ssmActive} onChange={(e) => setF({ ...f, ssmActive: e.target.checked })} /> SSM shows the company is live
          </label>
          <Select className="input" aria-label="Payment record" value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value as typeof f.payment })}>
            {Object.entries(PAYMENT).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <input
            className="input"
            aria-label="Current provider"
            placeholder="Current security provider (or none)"
            value={f.currentProvider}
            onChange={(e) => setF({ ...f, currentProvider: e.target.value })}
          />
          <input className="input" aria-label="Risks" placeholder="Risks found" value={f.risks} onChange={(e) => setF({ ...f, risks: e.target.value })} />
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={f.armed} onChange={(e) => setF({ ...f, armed: e.target.checked })} /> Needs armed guards
          </label>
          {nextInputs}
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () =>
                  api.salesLeadStep(l.id, 'research', {
                    ssmRegNo: f.ssmRegNo,
                    ssmActive: f.ssmActive,
                    ssmCheckedOn: f.ssmCheckedOn,
                    payment: f.payment,
                    currentProvider: f.currentProvider,
                    risks: f.risks,
                    armed: f.armed,
                    ...next,
                  }),
                'Research saved.',
              )
            }
          >
            Save research
          </button>
        </div>
      )}
      {mode === 'survey' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <label className="small">
            Surveyed on
            <input className="input" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          </label>
          <input
            className="input"
            aria-label="Guards needed"
            placeholder="Guards needed"
            inputMode="numeric"
            value={f.guardsNeeded}
            onChange={(e) => setF({ ...f, guardsNeeded: e.target.value })}
          />
          <select
            className="input"
            aria-label="Shift length"
            value={f.hoursPerDay}
            onChange={(e) => setF({ ...f, hoursPerDay: Number(e.target.value) as 8 | 12 })}
          >
            <option value={12}>12-hour shifts</option>
            <option value={8}>8-hour shifts</option>
          </select>
          <input
            className="input"
            aria-label="Survey notes"
            placeholder="Posts, gates, patrols"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
          {nextInputs}
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () => api.salesLeadStep(l.id, 'survey', { on: f.on, guardsNeeded: Number(f.guardsNeeded), hoursPerDay: f.hoursPerDay, note: f.note, ...next }),
                'Survey saved.',
              )
            }
          >
            Save survey
          </button>
        </div>
      )}
      {mode === 'risk' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="Why acceptable"
            placeholder="Why acceptable (deposit, terms)"
            value={f.text}
            onChange={(e) => setF({ ...f, text: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.salesLeadStep(l.id, 'accept_risk', { text: f.text }), 'Risk accepted.')}
          >
            Accept
          </button>
        </div>
      )}
      {mode === 'quotation' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {data.quotations.length ? (
            <Select className="input" aria-label="Quotation" value={f.quotationId} onChange={(e) => setF({ ...f, quotationId: e.target.value })}>
              {data.quotations.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.ref} {q.client} ({q.status.replace('_', ' ')})
                </option>
              ))}
            </Select>
          ) : (
            <span className="muted small">Make the quotation first with New quotation.</span>
          )}
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !f.quotationId}
            onClick={() => act.run(() => api.salesLeadStep(l.id, 'quotation', { quotationId: f.quotationId, ...next }), 'Quotation linked.')}
          >
            Link
          </button>
        </div>
      )}
      {mode === 'note' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input className="input" aria-label="Note" placeholder="What happened" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          {nextInputs}
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.salesLeadStep(l.id, 'note', { text: f.text, ...next }), 'Saved.')}
          >
            Save
          </button>
        </div>
      )}
      {mode === 'close' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Reason" placeholder="Reason" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.salesLeadStep(l.id, 'lost', { text: f.text }), 'Marked lost.')}>
            Lost to another
          </button>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.salesLeadStep(l.id, 'dropped', { text: f.text }), 'Dropped.')}>
            We dropped it
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewLead({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    prospect: '',
    sector: 'COMMERCIAL' as SalesLeadInput['sector'],
    source: '',
    guardsEst: '',
    estMonthly: '',
    nextOn: '',
    nextWhat: '',
    branchId: '',
  });
  // Masterplan 147: a branch may originate a lead; the licensed company still contracts.
  const branches = useLoad(
    () =>
      api
        .branchBoard()
        .then((b) => b.rows.filter((r) => r.branch.companyId === companyId && ['active', 'step_in'].includes(r.status)).map((r) => r.branch))
        .catch(() => []),
    [companyId],
  );
  const [tried, setTried] = useState(false);
  const guardsOk = /^\d+$/.test(f.guardsEst.trim()) && Number(f.guardsEst) >= 1 && Number(f.guardsEst) <= 1000;
  const errors = {
    prospect: f.prospect.trim() ? '' : 'Name the prospect.',
    guardsEst: guardsOk ? '' : 'Estimate the guards needed, 1 to 1,000.',
    estMonthly: !f.estMonthly.trim() || Number(f.estMonthly) > 0 ? '' : 'An amount in RM, or leave it empty.',
  };
  const err = (k: keyof typeof errors) => (tried && errors[k] ? <span className="bz-field-err">{errors[k]}</span> : null);
  const save = () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    act
      .run(
        () =>
          api.addSalesLead(companyId, {
            ...f,
            guardsEst: Number(f.guardsEst),
            estMonthly: f.estMonthly.trim() ? Number(f.estMonthly) : null,
            nextOn: f.nextOn || null,
            branchId: f.branchId || null,
          }),
        'Lead opened. Research the prospect next.',
      )
      .then((x) => {
        if (x) onDone();
      });
  };
  return (
    <>
      <div className="bz-form">
        <label className="field bz-span">
          <span className="label">Prospect</span>
          <input
            className="input"
            placeholder="Company or body"
            value={f.prospect}
            aria-invalid={tried && !!errors.prospect ? true : undefined}
            onChange={(e) => setF({ ...f, prospect: e.target.value })}
          />
          {err('prospect')}
        </label>
        <label className="field">
          <span className="label">Sector</span>
          <Select className="select" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value as SalesLeadInput['sector'] })}>
            {Object.entries(SECTOR).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Where it came from (optional)</span>
          <input className="input" placeholder="Referral, branch, walk-in" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
        </label>
        {(branches.data ?? []).length > 0 && (
          <label className="field bz-span">
            <span className="label">Branch that found it</span>
            <Select className="select" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              <option value="">Head office (no branch)</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="field">
          <span className="label">Guards needed (estimate)</span>
          <input
            className="input num"
            inputMode="numeric"
            value={f.guardsEst}
            aria-invalid={tried && !!errors.guardsEst ? true : undefined}
            onChange={(e) => setF({ ...f, guardsEst: e.target.value })}
          />
          {err('guardsEst')}
        </label>
        <label className="field">
          <span className="label">Value a month, RM (optional)</span>
          <input
            className="input num"
            inputMode="decimal"
            value={f.estMonthly}
            aria-invalid={tried && !!errors.estMonthly ? true : undefined}
            onChange={(e) => setF({ ...f, estMonthly: e.target.value })}
          />
          {err('estMonthly')}
        </label>
        <label className="field">
          <span className="label">Next step date (optional)</span>
          <input className="input" type="date" value={f.nextOn} onChange={(e) => setF({ ...f, nextOn: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Next step (optional)</span>
          <input className="input" placeholder="Research the prospect" value={f.nextWhat} onChange={(e) => setF({ ...f, nextWhat: e.target.value })} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button className="btn btn-primary" disabled={act.busy} onClick={save}>
          {act.busy ? 'Saving…' : 'Open lead'}
        </button>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </>
  );
}
