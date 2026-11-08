import { Select } from '../SearchSelect';
import { useState } from 'react';
import { CalendarDotsIcon, FileXIcon, PlusIcon, ScalesIcon, SignatureIcon } from '@phosphor-icons/react';
import { api, type CorpAuditLegal, type LegalMatterInput } from '../api';
import { Card, Empty, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../ui';
import '../styles/gov.css';

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
const STAGE_ORDER: AuditRow['stage'][] = ['planning', 'pbc', 'adjustments', 'to_sign', 'signed'];
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
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toneOf = (t: string) => (t === 'crit' ? 'crit' : t === 'warn' ? 'warn' : undefined);

export function AuditLegalKpis({ data }: { data: CorpAuditLegal }) {
  const k = data.kpis;
  return (
    <Stats>
      <Stat label="Audits past sign-by" value={k.auditsLate} tone={k.auditsLate ? 'crit' : 'ok'} icon={<SignatureIcon size={16} />} />
      <Stat label="Modified opinions" value={k.modified} tone={k.modified ? 'crit' : 'ok'} icon={<FileXIcon size={16} />} />
      <Stat label="Legal matters open" value={k.mattersOpen} note={`${rm(k.exposure)} claimed against us`} icon={<ScalesIcon size={16} />} tone="info" />
      <Stat
        label={`Dates in ${data.rule.legalSoonDays} days or missed`}
        value={k.datesSoon}
        tone={k.datesSoon ? 'warn' : 'ok'}
        icon={<CalendarDotsIcon size={16} />}
      />
    </Stats>
  );
}

export function AuditPanel({ data }: { data: CorpAuditLegal }) {
  const [all, setAll] = useState(false);
  const [form, setForm] = useState(false);
  const rows = data.audits.filter((a) => all || !a.audit.signed || a.tone !== 'ok');
  const canAdd = data.auditCompanies.length > 0;
  return (
    <Card
      title="Statutory audit"
      flush
      actions={
        <>
          <button className="btn btn-sm" aria-pressed={all} onClick={() => setAll(!all)}>
            {all ? 'Hide clean signed' : 'Show all'}
          </button>
          {canAdd && (
            <button className="btn btn-sm btn-primary" onClick={() => setForm(true)}>
              <PlusIcon size={16} /> Register an audit
            </button>
          )}
        </>
      }
    >
      {form && (
        <Drawer title="Register a statutory audit" sub="The year end, the audit firm and the documents the auditor asked for." onClose={() => setForm(false)}>
          <NewAudit data={data} onDone={() => setForm(false)} />
        </Drawer>
      )}
      <p className="gv-card-intro">
        The audited accounts are signed within {data.rule.auditSignMonths} months of the year end so they can be circulated and lodged in time (Companies Act
        2016 s.258 and s.259). The company hands over each document, the manager agrees each adjustment, then the auditor signs. A qualified, adverse or
        disclaimer opinion is red.
      </p>
      {!rows.length && <Empty title="Nothing outstanding.">{canAdd ? 'Register the audit for a year end with "Register an audit".' : undefined}</Empty>}
      <ul className="gv-list">
        {rows.map((r) => (
          <li key={r.audit.id}>
            <AuditLine r={r} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AuditLine({ r }: { r: AuditRow }) {
  const act = useAction();
  const a = r.audit;
  // The company (or the owner) records each step; the manager alone agrees adjustments.
  const company = r.canWork;
  const [on, setOn] = useState('');
  const [adj, setAdj] = useState({ desc: '', amount: '' });
  const [sign, setSign] = useState<{ opinion: keyof typeof OPINION; ref: string }>({ opinion: 'unmodified', ref: '' });
  const label = a.signed
    ? `${OPINION[a.signed.opinion]} opinion`
    : r.daysLeft < 0
      ? `${-r.daysLeft} days past sign-by`
      : `${STAGE[r.stage]}, ${r.daysLeft} days left`;
  const at = STAGE_ORDER.indexOf(r.stage);
  const st = (i: number): StepState => (at > i ? 'done' : at === i ? (a.signed ? 'done' : 'now') : 'todo');
  return (
    <div className="gv-item" data-tone={toneOf(r.tone)}>
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="gv-co">{r.companyName}:</span> year ended {dateLabel(a.fyEnd)}
          </div>
          <div className="gv-item-meta">
            {a.auditorFirm}
            {r.onPanel ? '' : ' (not on the panel)'}
            {a.fee != null ? ` · fee ${rm(a.fee)}` : ''} · sign by {dateLabel(r.signBy)}
            {a.planningOn ? ` · planning ${dateLabel(a.planningOn)}` : ''}
          </div>
          {a.signed && (
            <div className="gv-lines">
              Signed {dateLabel(a.signed.on)}, report {a.signed.ref}
            </div>
          )}
        </div>
        <div className="gv-item-state">
          <Chip tone={r.tone}>{label}</Chip>
        </div>
      </div>
      <Steps
        steps={[
          { label: 'Planning', state: st(0), note: a.planningOn ? dateLabel(a.planningOn) : undefined },
          { label: 'Documents', state: st(1), note: a.pbc.length ? `${a.pbc.length - r.pbcOpen} of ${a.pbc.length} handed over` : undefined },
          { label: 'Adjustments', state: st(2) },
          { label: 'Signed', state: a.signed ? 'done' : st(3), note: `By ${dateLabel(r.signBy)}` },
        ]}
      />
      {a.pbc.length > 0 && (
        <div className="gv-stack-sm">
          <div className="gv-box-title">
            Documents for the auditor ({r.pbcOpen} open{r.pbcLate ? `, ${r.pbcLate} late` : ''})
          </div>
          <ul className="gv-ol">
            {a.pbc.map((p, i) => (
              <li key={i} data-done={p.receivedOn ? 'true' : undefined}>
                <span>
                  {p.item}
                  <span className="gv-ol-sub">{p.receivedOn ? `handed over ${dateLabel(p.receivedOn)}` : `due ${dateLabel(p.dueOn)}`}</span>
                </span>
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
        <div className="gv-stack-sm">
          <div className="gv-box-title">Audit adjustments</div>
          <ul className="gv-ol">
            {a.adjustments.map((x, i) => (
              <li key={i} data-done={x.agreedBy ? 'true' : undefined}>
                <span>
                  {x.desc}: {rm(x.amount)}
                  <span className="gv-ol-sub">{x.agreedBy ? `agreed by ${x.agreedBy}` : 'not agreed'}</span>
                </span>
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
      {!a.signed && company && (
        <div className="gv-box">
          <label className="field">
            <span className="label">Date for the next step</span>
            <input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </label>
          {r.stage === 'planning' && (
            <div className="gv-btns">
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => act.run(() => api.corpAuditStep(a.id, 'planning', { on }), 'Planning meeting recorded.')}
              >
                Planning meeting held
              </button>
            </div>
          )}
          {r.stage !== 'planning' && (
            <div className="gv-form">
              <label className="field">
                <span className="label">Adjustment</span>
                <input
                  className="input"
                  aria-label="Adjustment"
                  placeholder="Adjustment the auditor proposed"
                  value={adj.desc}
                  onChange={(e) => setAdj({ ...adj, desc: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Amount (RM)</span>
                <input
                  className="input"
                  aria-label="Amount"
                  placeholder="Amount (RM)"
                  inputMode="decimal"
                  value={adj.amount}
                  onChange={(e) => setAdj({ ...adj, amount: e.target.value })}
                />
              </label>
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => act.run(() => api.corpAuditStep(a.id, 'add_adjustment', { desc: adj.desc, amount: Number(adj.amount) }), 'Adjustment added.')}
              >
                Add adjustment
              </button>
            </div>
          )}
          {r.stage === 'to_sign' && (
            <div className="gv-form">
              <label className="field">
                <span className="label">Opinion</span>
                <Select
                  className="select"
                  aria-label="Opinion"
                  value={sign.opinion}
                  onChange={(e) => setSign({ ...sign, opinion: e.target.value as keyof typeof OPINION })}
                >
                  {Object.entries(OPINION).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">Report reference</span>
                <input
                  className="input"
                  aria-label="Report reference"
                  placeholder="Report reference"
                  value={sign.ref}
                  onChange={(e) => setSign({ ...sign, ref: e.target.value })}
                />
              </label>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => act.run(() => api.corpAuditStep(a.id, 'signed', { on, opinion: sign.opinion, ref: sign.ref }), 'Signed report recorded.')}
              >
                Report signed
              </button>
            </div>
          )}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

export function LegalPanel({ data }: { data: CorpAuditLegal }) {
  const [form, setForm] = useState(false);
  const [all, setAll] = useState(false);
  const canOpen = data.matterCompanies.length > 0;
  const rows = data.matters.filter((m) => all || m.matter.status === 'open');
  return (
    <Card
      title="Legal matters"
      flush
      actions={
        <>
          <button className="btn btn-sm" aria-pressed={all} onClick={() => setAll(!all)}>
            {all ? 'Hide closed' : 'Show closed'}
          </button>
          {canOpen && (
            <button className="btn btn-sm btn-primary" onClick={() => setForm(true)}>
              <PlusIcon size={16} /> Open a matter
            </button>
          )}
        </>
      }
    >
      <div className="gv-card-intro">
        <p>
          Each company keeps its own lawyers. A missed date is red; a date within {data.rule.legalSoonDays} days, or no update for {data.rule.legalStaleDays}{' '}
          days, needs attention. Fees so far {rm(data.kpis.fees)}.
        </p>
      </div>
      {form && (
        <Drawer title="Open a legal matter" sub="A claim, demand, labour case, regulator matter or contract dispute." onClose={() => setForm(false)}>
          <NewMatter data={data} onDone={() => setForm(false)} />
        </Drawer>
      )}
      {!rows.length && <Empty title="No open matters.">{canOpen ? 'Record a new claim or demand with "Open a matter".' : undefined}</Empty>}
      <ul className="gv-list">
        {rows.map((m) => (
          <li key={m.matter.id}>
            <MatterLine r={m} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MatterLine({ r }: { r: MatterRow }) {
  const act = useAction();
  const m = r.matter;
  const can = r.canWork;
  const [mode, setMode] = useState<'' | 'update' | 'fee' | 'close'>('');
  const [f, setF] = useState({ text: '', nextOn: '', nextWhat: '', amount: '', invoiceRef: '', on: '' });
  const label =
    m.status === 'closed' ? 'Closed' : r.missed ? 'Date missed' : r.soon ? `Due ${dateLabel(m.nextDate!.on)}` : r.stale ? 'No recent update' : 'Open';
  const last = m.updates[m.updates.length - 1];
  const tone = toneOf(r.tone);
  return (
    <div className="gv-item" data-tone={tone}>
      <div className={m.nextDate ? 'gv-item-head gv-with-date' : 'gv-item-head'}>
        {m.nextDate && (
          <span className="gv-date" data-tone={tone} aria-label={`Next date ${dateLabel(m.nextDate.on)}`}>
            <b>{Number(m.nextDate.on.slice(8, 10))}</b>
            <span>{MON[Number(m.nextDate.on.slice(5, 7)) - 1]}</span>
          </span>
        )}
        <div className="gv-item-main">
          <div className="gv-item-title">
            <span className="gv-co mono">{m.ref}:</span> {m.title}
          </div>
          <div className="gv-item-meta">
            {r.companyName} · {KIND[m.kind]} · {m.side === 'respondent' ? 'claim against us by' : 'our claim against'} {m.counterparty}
            {m.exposure != null ? ` · ${rm(m.exposure)}` : ''} · lawyers {m.lawyer}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={r.tone}>{label}</Chip>
        </div>
      </div>
      <div className="gv-lines">
        <div>
          {m.nextDate ? `Next: ${m.nextDate.what}, ${dateLabel(m.nextDate.on)}` : m.status === 'open' ? 'No next date set' : `Outcome: ${m.outcome}`}
          {r.feesTotal ? ` · fees ${rm(r.feesTotal)}` : ''}
        </div>
        {last && (
          <div className="muted">
            Last update {dateTimeLabel(last.at)} by {last.by}: {last.text}
          </div>
        )}
      </div>
      {can && (
        <div className="gv-btns" role="group" aria-label={`Act on ${m.ref}`}>
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
        <div className="gv-box">
          <div className="gv-form">
            <label className="field gv-span">
              <span className="label">What happened</span>
              <input
                className="input"
                aria-label="What happened"
                placeholder="What happened"
                value={f.text}
                onChange={(e) => setF({ ...f, text: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Next date</span>
              <input className="input" type="date" value={f.nextOn} onChange={(e) => setF({ ...f, nextOn: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Next step</span>
              <input
                className="input"
                aria-label="Next step"
                placeholder="Next step (hearing, reply due)"
                value={f.nextWhat}
                onChange={(e) => setF({ ...f, nextWhat: e.target.value })}
              />
            </label>
          </div>
          <div className="gv-form-foot">
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
        </div>
      )}
      {mode === 'fee' && (
        <div className="gv-box">
          <div className="gv-form">
            <label className="field">
              <span className="label">Invoice date</span>
              <input className="input" type="date" aria-label="Invoice date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Amount (RM)</span>
              <input
                className="input"
                aria-label="Amount"
                placeholder="Amount (RM)"
                inputMode="decimal"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Invoice number</span>
              <input
                className="input"
                aria-label="Invoice number"
                placeholder="Invoice number"
                value={f.invoiceRef}
                onChange={(e) => setF({ ...f, invoiceRef: e.target.value })}
              />
            </label>
          </div>
          <div className="gv-form-foot">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() => act.run(() => api.legalMatterStep(m.id, 'fee', { on: f.on, amount: Number(f.amount), invoiceRef: f.invoiceRef }), 'Fee recorded.')}
            >
              Save fee
            </button>
          </div>
        </div>
      )}
      {mode === 'close' && (
        <div className="gv-box">
          <div className="gv-inline">
            <input className="input" aria-label="Outcome" placeholder="Outcome" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() => act.run(() => api.legalMatterStep(m.id, 'close', { text: f.text }), 'Closed.')}
            >
              Close matter
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewMatter({ data, onDone }: { data: CorpAuditLegal; onDone: () => void }) {
  const act = useAction();
  const companies = data.companies.filter((c) => data.matterCompanies.includes(c.id));
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
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
    <div className="gv-box" aria-label="Open a matter">
      <div className="gv-form">
        <label className="field">
          <span className="label">Company</span>
          <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Kind</span>
          <Select className="select" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LegalMatterInput['kind'] })}>
            {Object.entries(KIND).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <label className="field gv-span">
          <span className="label">Matter</span>
          <input className="input" aria-label="Matter" placeholder="What the matter is" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Side</span>
          <select className="select" aria-label="Side" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as LegalMatterInput['side'] })}>
            <option value="respondent">Claim against the company</option>
            <option value="claimant">Company's claim against them</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Other party</span>
          <input
            className="input"
            aria-label="Other party"
            placeholder="Other party"
            value={f.counterparty}
            onChange={(e) => setF({ ...f, counterparty: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Amount at stake</span>
          <input
            className="input"
            aria-label="Amount at stake"
            placeholder="Amount at stake (RM, blank if not money)"
            inputMode="decimal"
            value={f.exposure}
            onChange={(e) => setF({ ...f, exposure: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Lawyers acting</span>
          <input
            className="input"
            aria-label="Lawyers acting"
            placeholder="Lawyers acting"
            value={f.lawyer}
            onChange={(e) => setF({ ...f, lawyer: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Next date</span>
          <input className="input" type="date" value={f.nextOn} onChange={(e) => setF({ ...f, nextOn: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Next step</span>
          <input className="input" aria-label="Next step" placeholder="Next step" value={f.nextWhat} onChange={(e) => setF({ ...f, nextWhat: e.target.value })} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="gv-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !companyId || !f.title.trim() || !f.counterparty.trim() || !f.lawyer.trim()}
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
          {act.busy ? 'Saving...' : 'Open matter'}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Documents an auditor usually asks for; the form starts with these and the company edits them to match the request. */
const PBC_DEFAULT = ['Trial balance and general ledger', 'Bank confirmations', 'Fixed asset register', 'Payroll and statutory contributions', 'Debtor ageing and contracts'];

function NewAudit({ data, onDone }: { data: CorpAuditLegal; onDone: () => void }) {
  const act = useAction();
  const companies = data.companies.filter((c) => data.auditCompanies.includes(c.id));
  const [f, setF] = useState({ companyId: companies[0]?.id ?? '', fyEnd: '', auditorFirm: '', fee: '', pbc: PBC_DEFAULT.join('\n') });
  const pbc = f.pbc
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  const missing = !f.companyId
    ? 'Choose the company.'
    : !f.fyEnd
      ? 'Give the financial year end.'
      : f.auditorFirm.trim().length < 3
        ? 'Name the audit firm.'
        : !pbc.length
          ? 'List at least one document.'
          : '';
  return (
    <div className="gv-stack-sm" aria-label="Register an audit">
      <label className="field">
        <span className="label">Company</span>
        <Select className="select" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span className="label">Financial year end</span>
        <input className="input" type="date" aria-label="Financial year end" value={f.fyEnd} onChange={(e) => setF({ ...f, fyEnd: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Audit firm</span>
        <input
          className="input"
          aria-label="Audit firm"
          placeholder="The firm appointed"
          value={f.auditorFirm}
          onChange={(e) => setF({ ...f, auditorFirm: e.target.value })}
        />
        {data.rule.auditorPanel.length > 0 && <span className="help">On the panel: {data.rule.auditorPanel.join(', ')}.</span>}
      </label>
      <label className="field">
        <span className="label">Audit fee in RM (optional)</span>
        <input className="input" aria-label="Audit fee" inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Documents the auditor asked for, one per line</span>
        <textarea className="textarea" aria-label="Documents" rows={6} value={f.pbc} onChange={(e) => setF({ ...f, pbc: e.target.value })} />
        <span className="help">The first is due 40 days after the year end, each next one a week later.</span>
      </label>
      {missing && <p className="help">{missing}</p>}
      <ErrorNotice error={act.error} />
      <div className="gv-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !!missing}
          onClick={() =>
            act
              .run(
                () => api.addCorpAudit(f.companyId, { fyEnd: f.fyEnd, auditorFirm: f.auditorFirm, fee: f.fee.trim() ? Number(f.fee) : null, pbc }),
                'Audit registered. Record the planning meeting next.',
              )
              .then((x) => {
                if (x) onDone();
              })
          }
        >
          {act.busy ? 'Saving...' : 'Register audit'}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
