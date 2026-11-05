import { useState } from 'react';
import { api, type FinCooDesk } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { SUBJECT } from './FinanceDesk';
import { MyDailyCash } from './FinanceDailyCash';

/**
 * The COO's payment approvals (Fauzan, 1 Nov 2026: approval is by subject matter; only the FD, the CEO and the COO
 * approve anything). Finance prepares and reviews payments for the departments the COO monitors; the COO approves or
 * returns them with a comment; Finance then releases them in the bank portal. Nothing else in Finance is open here.
 */

type Pay = FinCooDesk['payments'][number];
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<Pay['status'], [Tone, string]> = {
  prepared: ['neutral', 'With Finance'],
  reviewed: ['warn', 'To approve'],
  approved: ['info', 'Approved, to release'],
  released: ['ok', 'Released'],
  returned: ['crit', 'Returned'],
  cancelled: ['neutral', 'Cancelled'],
};

export function CooPaymentsView() {
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finCooDesk(), [n]);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="payments" />;
  const waiting = data.payments.filter((p) => p.may.includes('approve'));
  const rest = data.payments.filter((p) => !waiting.includes(p));
  const sel = data.payments.find((p) => p.id === open) ?? null;
  const line = (p: Pay) => (
    <button key={p.id} className="list-item" style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }} onClick={() => setOpen(p.id)}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {p.payee} · {rm(p.amount)}
        </div>
        <div className="muted small">
          {p.companyName} · {SUBJECT[p.subject]} · {p.sqlRef} · due {dateLabel(p.dueOn)}
        </div>
      </div>
      <Chip tone={STATUS[p.status][0]}>{STATUS[p.status][1]}</Chip>
    </button>
  );
  return (
    <div className="page">
      <div className="page-head">
        <h1>Payments to approve</h1>
        <p className="muted">
          Payments for the departments you monitor (Operations, IT, Foreign Worker Management, Procurement &amp; Inventory, Transport, Goodwill Empire).
          Finance prepares and reviews them; you approve or return each one with a comment; Finance releases it in the bank portal. The CEO can also
          approve them. Finance payments go to the Finance Director.
        </p>
        <p className="notice" data-tone="info">
          Test data: SQL Account is not connected yet.
        </p>
      </div>
      <MyDailyCash />
      <section className="panel">
        <div className="panel-head">
          <h3>Waiting for you</h3>
          <span className="muted small">{waiting.length}</span>
        </div>
        <div className="list">
          {waiting.length === 0 && <div className="empty">Nothing waiting for you.</div>}
          {waiting.map(line)}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Decided or with Finance (last 60 days)</h3>
        </div>
        <div className="list">
          {rest.length === 0 && <div className="empty">None.</div>}
          {rest.map(line)}
        </div>
      </section>
      {sel && (
        <Decide
          p={sel}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            setN((x) => x + 1);
          }}
        />
      )}
    </div>
  );
}

function Decide({ p, onClose, onDone }: { p: Pay; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [comment, setComment] = useState('');
  const run = async (a: 'approve' | 'return') => {
    const r = await act.run(() => api.finCooStep(p.companyId, p.id, a, { comment }), a === 'approve' ? 'Approved. Finance releases it next.' : 'Returned to Finance.');
    if (r) onDone();
  };
  return (
    <Drawer title={`${p.payee} · ${rm(p.amount)}`} sub={`${p.companyName} · ${p.id}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <section className="panel">
        <div className="list">
          <div className="list-item">
            <span>Status</span>
            <Chip tone={STATUS[p.status][0]}>{STATUS[p.status][1]}</Chip>
          </div>
          <div className="list-item">
            <span>Subject</span>
            <span>{SUBJECT[p.subject]}</span>
          </div>
          <div className="list-item">
            <span>Purpose</span>
            <span>{p.purpose}</span>
          </div>
          <div className="list-item">
            <span>SQL Account document</span>
            <span>{p.sqlRef}</span>
          </div>
          <div className="list-item">
            <span>Due</span>
            <span>{dateLabel(p.dueOn)}</span>
          </div>
          {p.external && (
            <div className="list-item">
              <span>{p.external.system === 'teams' ? 'Teams' : 'SharePoint'} approval</span>
              <span>
                {p.external.requestRef} · {p.external.decisions.map((d) => `${d.approver} ${d.decision}`).join('; ') || 'no decision yet'}
              </span>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Supporting documents</h3>
        </div>
        <ul className="small">
          {p.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Steps</h3>
        </div>
        <div className="list">
          {p.steps.map((s, i) => (
            <div key={i} className="list-item" style={{ flexWrap: 'wrap' }}>
              <span>
                {s.step} by {s.by}
                {s.comment ? `: ${s.comment}` : ''}
              </span>
              <span className="muted small">{dateTimeLabel(s.at)}</span>
            </div>
          ))}
        </div>
      </section>
      {p.may.length > 0 && (
        <section className="panel">
          <label className="field">
            <span>Comment (needed to approve; a return needs at least 10 characters)</span>
            <textarea className="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" disabled={act.busy} onClick={() => run('approve')}>
              Approve
            </button>
            <button className="btn" disabled={act.busy} onClick={() => run('return')}>
              Return
            </button>
          </div>
        </section>
      )}
    </Drawer>
  );
}
