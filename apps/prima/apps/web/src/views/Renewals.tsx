import { useState } from 'react';
import { api, type RenewalAction, type RenewalBoard, type RenewalBody } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';

/**
 * Renewals and compliance calendar (Central Admin 5C, Fauzan 2 Nov 2026). Each company renews its own licences,
 * registrations and certificates; Central Admin (the Deputy Chief of Staff) monitors them all and confirms each new
 * expiry. The app lodges and pays nothing: it lists what is due, keeps the papers and steps, and steps up what is late.
 */

type Row = RenewalBoard['rows'][number];

const STAGE: Record<Row['stage'], ['crit' | 'warn' | 'info' | 'ok' | 'neutral', string]> = {
  ok: ['ok', 'In date'],
  unknown: ['warn', 'No expiry on file'],
  due: ['warn', 'Due: open the renewal'],
  papers: ['info', 'Getting the papers'],
  to_sign: ['info', 'Company manager to sign'],
  fee: ['info', 'Fee through Finance'],
  to_submit: ['info', 'Ready to submit'],
  with_agency: ['info', 'With the agency'],
  to_confirm: ['info', 'Central Admin to confirm'],
};

export function RenewalsView() {
  const { data, error } = useLoad(() => api.renewalBoard(), []);
  const [all, setAll] = useState(false);
  const [company, setCompany] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="renewals" />;
  const rows = data.rows.filter((r) => (all || r.stage !== 'ok') && (!company || r.licence.companyId === company));
  const sum = (k: 'overdue' | 'due' | 'unknown' | 'inProgress') => data.companies.reduce((n, c) => n + c[k], 0);
  const expired = data.companies.filter((c) => c.kdnExpired);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Renewals</h1>
        <p className="muted">
          Every licence, registration and certificate each company holds: KDN, MOF and vendor panels, council licences, ISO, fire certificate, insurance and
          SSM. Each company renews its own; Central Admin monitors and confirms the new expiry. The app never lodges or pays.
        </p>
        <p className="notice" data-tone="info">
          Test data. Lead times and paper lists are starting proposals; the agency's current form decides.
        </p>
      </div>
      <CentralAdminGuide view="renewals" />
      <div className="kpis">
        <Kpi label="Expired" value={sum('overdue')} tone={sum('overdue') ? 'crit' : 'ok'} />
        <Kpi label="Due" value={sum('due')} tone={sum('due') ? 'warn' : 'ok'} />
        <Kpi label="No expiry on file" value={sum('unknown')} tone={sum('unknown') ? 'warn' : 'ok'} />
        <Kpi label="Being renewed" value={sum('inProgress')} tone="info" />
      </div>
      {expired.length > 0 && (
        <p className="notice" data-tone="warn">
          KDN licence past its expiry, renewal is urgent: {expired.map((c) => c.name).join(', ')}.
        </p>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Renewals</h3>
          <div className="row">
            {data.companies.length > 1 && (
              <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-sm" onClick={() => setAll(!all)}>
              {all ? 'Hide in date' : 'Show in date'}
            </button>
          </div>
        </div>
        <div className="list">
          {rows.length === 0 && <p className="muted">Nothing due.</p>}
          {rows.map((r) => (
            <RenewalRow key={r.licence.id} r={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RenewalRow({ r }: { r: Row }) {
  const act = useAction();
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [newExp, setNewExp] = useState('');
  const [paper, setPaper] = useState('');
  const step = (a: RenewalAction, body: RenewalBody, done: string) => act.run(() => api.renewalStep(r.licence.id, a, body), done);
  const c = r.can;
  const rc = r.licence.renewal;
  const [tone, label] = r.status === 'OVERDUE' ? (['crit', 'Expired'] as const) : STAGE[r.stage];
  return (
    <div className="item">
      <div className="item-main">
        <strong>
          {r.label}
          {r.licence.title ? `: ${r.licence.title}` : ''}
        </strong>
        <div className="muted small">
          {r.companyName} · {r.licence.reference}
          {r.licence.issuer ? ` · ${r.licence.issuer}` : ''} ·{' '}
          {r.licence.expiresOn
            ? `expires ${dateLabel(r.licence.expiresOn)}${r.daysLeft !== null ? ` (${r.daysLeft < 0 ? `${-r.daysLeft} days ago` : `${r.daysLeft} days`})` : ''}`
            : 'no expiry on file'}{' '}
          · opens {r.leadDays} days before
          {r.escalatedTo ? ` · now with the ${r.escalatedTo}` : ''}
        </div>
        {rc && (
          <ul className="small">
            {rc.papers.map((p, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={!!p.done} disabled={!c.papers || act.busy} onChange={() => step('paper', { index: i }, 'Updated.')} />{' '}
                  {p.name}
                  {p.done ? ` · ${p.done.by}` : ''}
                </label>
              </li>
            ))}
            {rc.signed && <li>Signed by {rc.signed.by}</li>}
            {rc.fee && (
              <li>
                Fee: {rc.fee.ref}
                {rc.fee.amount != null ? `, RM${rc.fee.amount}` : ''}
              </li>
            )}
            {rc.submitted && (
              <li>
                Submitted {dateLabel(rc.submitted.on)}, reference {rc.submitted.ref}
              </li>
            )}
            {rc.agencyNotes.map((n, i) => (
              <li key={`a${i}`}>
                Agency: {n.note} ({n.by})
              </li>
            ))}
            {rc.returns.map((n, i) => (
              <li key={`r${i}`}>
                Sent back: {n.note} ({n.by})
              </li>
            ))}
            {rc.renewed && (
              <li>
                Renewed to {dateLabel(rc.renewed.newExpiresOn)}, certificate {rc.renewed.certificateRef} ({rc.renewed.by})
              </li>
            )}
          </ul>
        )}
        {act.error && <p className="error small">{act.error.message}</p>}
        <div className="row">
          {c.open && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('open', {}, 'Renewal opened.')}>
              Open renewal
            </button>
          )}
          {c.papers && (
            <>
              <input aria-label="Another paper" placeholder="Another paper the agency asks for" value={paper} onChange={(e) => setPaper(e.target.value)} />
              <button className="btn btn-sm" disabled={act.busy || paper.trim().length < 3} onClick={() => step('addPaper', { name: paper }, 'Paper added.')}>
                Add paper
              </button>
            </>
          )}
          {c.sign && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('sign', {}, 'Signed.')}>
              Sign the application
            </button>
          )}
          {(c.fee || c.submit || c.renewed || c.agency || c.returnIt || c.confirm) && (
            <input
              aria-label="Reference"
              placeholder={c.fee ? 'Finance payment ref, or "no fee"' : c.renewed ? 'New certificate ref' : 'Reference'}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          )}
          {c.fee && (
            <>
              <input aria-label="Fee in RM" placeholder="Fee RM" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button className="btn btn-sm" disabled={act.busy} onClick={() => step('fee', { ref, amount: amount ? Number(amount) : null }, 'Fee recorded.')}>
                Record fee
              </button>
            </>
          )}
          {c.submit && r.stage === 'to_submit' && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('submit', { ref }, 'Submitted.')}>
              Record submission
            </button>
          )}
          {c.renewed && (
            <>
              <input type="date" aria-label="New expiry" value={newExp} onChange={(e) => setNewExp(e.target.value)} />
              <button className="btn btn-sm" disabled={act.busy} onClick={() => step('renewed', { newExpiresOn: newExp, ref }, 'Renewal recorded.')}>
                Record new certificate
              </button>
            </>
          )}
          {(c.agency || c.returnIt || c.confirm) && (
            <input aria-label="Note" placeholder="Note or reason" value={note} onChange={(e) => setNote(e.target.value)} />
          )}
          {c.agency && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('agency', { note }, 'Note added.')}>
              Agency note
            </button>
          )}
          {c.returnIt && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('return', { note }, 'Sent back.')}>
              Send back
            </button>
          )}
          {c.confirm && (
            <>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => step('confirm', { note, ok: true }, 'Confirmed.')}>
                Confirm new expiry
              </button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => step('confirm', { note, ok: false }, 'Queried.')}>
                Query it
              </button>
            </>
          )}
        </div>
      </div>
      <Chip tone={tone}>{label}</Chip>
    </div>
  );
}
