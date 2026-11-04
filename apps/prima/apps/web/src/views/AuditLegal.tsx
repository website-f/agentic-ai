import { useState } from 'react';
import { api, type CorpAuditLegal, type LegalMatterInput } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction } from '../ui';

/**
 * Statutory audit and legal matters (V9). Each company runs its own audit with a panel firm (documents handed over,
 * adjustments agreed by the manager, report signed) and keeps its own lawyers. PWVSB legal opens and follows matters
 * with the company; leadership watches. Prima never signs or files.
 */

type AuditRow = CorpAuditLegal['audits'][number];
type MatterRow = CorpAuditLegal['matters'][number];

const STAGE: Record<AuditRow['stage'], string> = {
  planning: 'Planning not held',
  pbc: 'Documents to hand over',
  adjustments: 'Adjustments to agree',
  to_sign: 'Ready to sign',
  signed: 'Signed',
};
const OPINION = { unmodified: 'Unmodified', qualified: 'Qualified', adverse: 'Adverse', disclaimer: 'Disclaimer of opinion' } as const;
const KIND: Record<LegalMatterInput['kind'], string> = {
  LITIGATION: 'Court case',
  DEMAND: 'Letter of demand',
  LABOUR: 'Labour or industrial',
  REGULATORY: 'Regulator',
  CONTRACT: 'Contract dispute',
  OTHER: 'Other',
};
const rm = (n: number) => `RM ${n.toLocaleString('en-MY')}`;

export function AuditLegalKpis({ data }: { data: CorpAuditLegal }) {
  const k = data.kpis;
  return (
    <div className="kpis">
      <Kpi label="Audits past sign-by" value={k.auditsLate} tone={k.auditsLate ? 'crit' : 'ok'} />
      <Kpi label="Modified opinions" value={k.modified} tone={k.modified ? 'crit' : 'ok'} />
      <Kpi label="Legal matters open" value={k.mattersOpen} note={`${rm(k.exposure)} claimed against us`} />
      <Kpi label={`Dates in ${data.rule.legalSoonDays} days or missed`} value={k.datesSoon} tone={k.datesSoon ? 'warn' : 'ok'} />
    </div>
  );
}

export function AuditPanel({ data }: { data: CorpAuditLegal }) {
  const [all, setAll] = useState(false);
  const rows = data.audits.filter((a) => all || !a.audit.signed || a.tone !== 'ok');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Statutory audit</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide clean signed' : 'Show all'}
        </button>
      </div>
      <p className="muted small">
        The audited accounts are signed within {data.rule.auditSignMonths} months of the year end so they can be circulated and lodged in time (Companies Act
        2016 s.258 and s.259). The company hands over each document, the manager agrees each adjustment, then the auditor signs. A qualified, adverse or
        disclaimer opinion is red.
      </p>
      <div className="list">
        {!rows.length && <div className="empty">Nothing outstanding.</div>}
        {rows.map((r) => (
          <AuditLine key={r.audit.id} r={r} />
        ))}
      </div>
    </section>
  );
}

function AuditLine({ r }: { r: AuditRow }) {
  const act = useAction();
  const a = r.audit;
  const company = r.role === 'manager' || r.role === 'staff';
  const [on, setOn] = useState('');
  const [adj, setAdj] = useState({ desc: '', amount: '' });
  const [sign, setSign] = useState<{ opinion: keyof typeof OPINION; ref: string }>({ opinion: 'unmodified', ref: '' });
  const label = a.signed
    ? `${OPINION[a.signed.opinion]} opinion`
    : r.daysLeft < 0
      ? `${-r.daysLeft} days past sign-by`
      : `${STAGE[r.stage]}, ${r.daysLeft} days left`;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {r.companyName}: year ended {dateLabel(a.fyEnd)}
          </div>
          <div className="muted small">
            {a.auditorFirm}
            {r.onPanel ? '' : ' (not on the panel)'}
            {a.fee != null ? ` · fee ${rm(a.fee)}` : ''} · sign by {dateLabel(r.signBy)}
            {a.planningOn ? ` · planning ${dateLabel(a.planningOn)}` : ''}
          </div>
          {a.signed && (
            <div className="small">
              Signed {dateLabel(a.signed.on)}, report {a.signed.ref}
            </div>
          )}
        </div>
        <Chip tone={r.tone}>{label}</Chip>
      </div>
      {!a.signed && company && (
        <label className="small">
          Date for the next step
          <input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
      )}
      {!a.signed && company && r.stage === 'planning' && (
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          disabled={act.busy}
          onClick={() => act.run(() => api.corpAuditStep(a.id, 'planning', { on }), 'Planning meeting recorded.')}
        >
          Planning meeting held
        </button>
      )}
      {a.pbc.length > 0 && (
        <div className="small">
          <div style={{ fontWeight: 600 }}>
            Documents for the auditor ({r.pbcOpen} open{r.pbcLate ? `, ${r.pbcLate} late` : ''})
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.pbc.map((p, i) => (
              <li key={i}>
                {p.item}: {p.receivedOn ? `handed over ${dateLabel(p.receivedOn)}` : `due ${dateLabel(p.dueOn)}`}{' '}
                {!p.receivedOn && company && !a.signed && (
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() => act.run(() => api.corpAuditStep(a.id, 'pbc_received', { index: i, on }), 'Handed over.')}
                  >
                    Handed over
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.adjustments.length > 0 && (
        <div className="small">
          <div style={{ fontWeight: 600 }}>Audit adjustments</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.adjustments.map((x, i) => (
              <li key={i}>
                {x.desc}: {rm(x.amount)} · {x.agreedBy ? `agreed by ${x.agreedBy}` : 'not agreed'}{' '}
                {!x.agreedBy && r.role === 'manager' && !a.signed && (
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() => act.run(() => api.corpAuditStep(a.id, 'agree_adjustment', { index: i }), 'Adjustment agreed.')}
                  >
                    Agree
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!a.signed && company && r.stage !== 'planning' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="Adjustment"
            placeholder="Adjustment the auditor proposed"
            value={adj.desc}
            onChange={(e) => setAdj({ ...adj, desc: e.target.value })}
          />
          <input
            className="input"
            aria-label="Amount"
            placeholder="Amount (RM)"
            inputMode="decimal"
            value={adj.amount}
            onChange={(e) => setAdj({ ...adj, amount: e.target.value })}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.corpAuditStep(a.id, 'add_adjustment', { desc: adj.desc, amount: Number(adj.amount) }), 'Adjustment added.')}
          >
            Add adjustment
          </button>
        </div>
      )}
      {!a.signed && company && r.stage === 'to_sign' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select
            className="input"
            aria-label="Opinion"
            value={sign.opinion}
            onChange={(e) => setSign({ ...sign, opinion: e.target.value as keyof typeof OPINION })}
          >
            {Object.entries(OPINION).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            className="input"
            aria-label="Report reference"
            placeholder="Report reference"
            value={sign.ref}
            onChange={(e) => setSign({ ...sign, ref: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.corpAuditStep(a.id, 'signed', { on, opinion: sign.opinion, ref: sign.ref }), 'Signed report recorded.')}
          >
            Report signed
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

export function LegalPanel({ data }: { data: CorpAuditLegal }) {
  const [form, setForm] = useState(false);
  const [all, setAll] = useState(false);
  const canOpen = data.roles.includes('legal') || data.roles.includes('manager');
  const rows = data.matters.filter((m) => all || m.matter.status === 'open');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Legal matters</h3>
        <div className="row" style={{ gap: 6 }}>
          {canOpen && (
            <button className="btn btn-sm" onClick={() => setForm(!form)}>
              Open a matter
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? 'Hide closed' : 'Show closed'}
          </button>
        </div>
      </div>
      <p className="muted small">
        Each company keeps its own lawyers. A missed date is red; a date within {data.rule.legalSoonDays} days, or no update for {data.rule.legalStaleDays}{' '}
        days, needs attention. Fees so far {rm(data.kpis.fees)}.
      </p>
      {form && <NewMatter data={data} onDone={() => setForm(false)} />}
      <div className="list">
        {!rows.length && <div className="empty">No open matters.</div>}
        {rows.map((m) => (
          <MatterLine key={m.matter.id} r={m} />
        ))}
      </div>
    </section>
  );
}

function MatterLine({ r }: { r: MatterRow }) {
  const act = useAction();
  const m = r.matter;
  const can = (r.role === 'legal' || r.role === 'manager') && m.status === 'open';
  const [mode, setMode] = useState<'' | 'update' | 'fee' | 'close'>('');
  const [f, setF] = useState({ text: '', nextOn: '', nextWhat: '', amount: '', invoiceRef: '', on: '' });
  const label =
    m.status === 'closed' ? 'Closed' : r.missed ? 'Date missed' : r.soon ? `Due ${dateLabel(m.nextDate!.on)}` : r.stale ? 'No recent update' : 'Open';
  const last = m.updates[m.updates.length - 1];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {m.ref}: {m.title}
          </div>
          <div className="muted small">
            {r.companyName} · {KIND[m.kind]} · {m.side === 'respondent' ? 'claim against us by' : 'our claim against'} {m.counterparty}
            {m.exposure != null ? ` · ${rm(m.exposure)}` : ''} · lawyers {m.lawyer}
          </div>
          <div className="small">
            {m.nextDate ? `Next: ${m.nextDate.what}, ${dateLabel(m.nextDate.on)}` : m.status === 'open' ? 'No next date set' : `Outcome: ${m.outcome}`}
            {r.feesTotal ? ` · fees ${rm(r.feesTotal)}` : ''}
          </div>
          {last && (
            <div className="muted small">
              Last update {dateTimeLabel(last.at)} by {last.by}: {last.text}
            </div>
          )}
        </div>
        <Chip tone={r.tone}>{label}</Chip>
      </div>
      {can && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['update', 'Add update'],
              ['fee', 'Add fee'],
              ['close', 'Close'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className="btn btn-sm" aria-pressed={mode === k} onClick={() => setMode(mode === k ? '' : k)}>
              {l}
            </button>
          ))}
        </div>
      )}
      {mode === 'update' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            className="input"
            aria-label="What happened"
            placeholder="What happened"
            value={f.text}
            onChange={(e) => setF({ ...f, text: e.target.value })}
          />
          <label className="small">
            Next date
            <input className="input" type="date" value={f.nextOn} onChange={(e) => setF({ ...f, nextOn: e.target.value })} />
          </label>
          <input
            className="input"
            aria-label="Next step"
            placeholder="Next step (hearing, reply due)"
            value={f.nextWhat}
            onChange={(e) => setF({ ...f, nextWhat: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(() => api.legalMatterStep(m.id, 'update', { text: f.text, nextOn: f.nextOn || undefined, nextWhat: f.nextWhat }), 'Update saved.')
            }
          >
            Save update
          </button>
        </div>
      )}
      {mode === 'fee' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" type="date" aria-label="Invoice date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          <input
            className="input"
            aria-label="Amount"
            placeholder="Amount (RM)"
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
          <input
            className="input"
            aria-label="Invoice number"
            placeholder="Invoice number"
            value={f.invoiceRef}
            onChange={(e) => setF({ ...f, invoiceRef: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.legalMatterStep(m.id, 'fee', { on: f.on, amount: Number(f.amount), invoiceRef: f.invoiceRef }), 'Fee recorded.')}
          >
            Save fee
          </button>
        </div>
      )}
      {mode === 'close' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Outcome" placeholder="Outcome" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.legalMatterStep(m.id, 'close', { text: f.text }), 'Closed.')}
          >
            Close matter
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewMatter({ data, onDone }: { data: CorpAuditLegal; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(data.companies[0]?.id ?? '');
  const [f, setF] = useState({
    title: '',
    kind: 'DEMAND' as LegalMatterInput['kind'],
    counterparty: '',
    side: 'respondent' as LegalMatterInput['side'],
    exposure: '',
    lawyer: '',
    nextOn: '',
    nextWhat: '',
  });
  return (
    <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      <select className="input" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
        {data.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Matter" placeholder="What the matter is" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <select className="input" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LegalMatterInput['kind'] })}>
        {Object.entries(KIND).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Side" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as LegalMatterInput['side'] })}>
        <option value="respondent">Claim against the company</option>
        <option value="claimant">Company's claim against them</option>
      </select>
      <input
        className="input"
        aria-label="Other party"
        placeholder="Other party"
        value={f.counterparty}
        onChange={(e) => setF({ ...f, counterparty: e.target.value })}
      />
      <input
        className="input"
        aria-label="Amount at stake"
        placeholder="Amount at stake (RM, blank if not money)"
        inputMode="decimal"
        value={f.exposure}
        onChange={(e) => setF({ ...f, exposure: e.target.value })}
      />
      <input
        className="input"
        aria-label="Lawyers acting"
        placeholder="Lawyers acting"
        value={f.lawyer}
        onChange={(e) => setF({ ...f, lawyer: e.target.value })}
      />
      <label className="small">
        Next date
        <input className="input" type="date" value={f.nextOn} onChange={(e) => setF({ ...f, nextOn: e.target.value })} />
      </label>
      <input className="input" aria-label="Next step" placeholder="Next step" value={f.nextWhat} onChange={(e) => setF({ ...f, nextWhat: e.target.value })} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy}
        onClick={() =>
          act
            .run(
              () => api.addLegalMatter(companyId, { ...f, exposure: f.exposure.trim() ? Number(f.exposure) : null, nextOn: f.nextOn || null }),
              'Matter opened.',
            )
            .then((x) => {
              if (x) onDone();
            })
        }
      >
        Open matter
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}
