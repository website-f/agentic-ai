import { useState } from 'react';
import { api, type FinCooDesk } from '../api';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { SUBJECT } from './FinanceDesk';
import { MyDailyCash } from './FinanceDailyCash';
import { ArrowUUpLeftIcon, HourglassMediumIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import '../styles/finance.css';

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
  const toRelease = data.payments.filter((p) => p.status === 'approved').length;
  const returned = data.payments.filter((p) => p.status === 'returned').length;
  const line = (p: Pay) => (
    <div key={p.id} className="fin-pay" data-tone={p.may.includes('approve') ? 'warn' : undefined}>
      <button type="button" className="fin-pay-main" onClick={() => setOpen(p.id)}>
        <span className="fin-pay-text">
          <span className="fin-pay-payee">{p.payee}</span>
          <span className="muted small">
            {p.companyName} · {SUBJECT[p.subject]} · {p.sqlRef} · due {dateLabel(p.dueOn)}
          </span>
        </span>
        <span className="fin-pay-amount">{rm(p.amount)}</span>
        <span className="fin-chips fin-pay-tags">
          <Chip tone={STATUS[p.status][0]}>{STATUS[p.status][1]}</Chip>
        </span>
      </button>
    </div>
  );
  return (
    <div className="page fin">
      <PageHead
        title="Payments to approve"
        sub={
          <>
            Payments for the departments you monitor (Operations, IT, Foreign Worker Management, Procurement &amp; Inventory, Transport, Goodwill Empire).
            Finance prepares and reviews them; you approve or return each one with a comment; Finance releases it in the bank portal. The CEO can also
            approve them. Finance payments go to the Finance Director.
          </>
        }
      >
        <p className="notice" data-tone="info">
          Test data: SQL Account is not connected yet.
        </p>
      </PageHead>
      <Stats>
        <Stat label="Waiting for you" value={waiting.length} tone={waiting.length ? 'warn' : 'ok'} icon={<HourglassMediumIcon size={18} />} />
        <Stat label="Approved, to release" value={toRelease} tone={toRelease ? 'info' : 'ok'} note="Finance releases in the bank portal" icon={<PaperPlaneTiltIcon size={18} />} />
        <Stat label="Returned" value={returned} tone={returned ? 'crit' : 'ok'} note="Back with Finance" icon={<ArrowUUpLeftIcon size={18} />} />
      </Stats>
      <MyDailyCash />
      <Card title="Waiting for you" sub={`${waiting.length} payment${waiting.length === 1 ? '' : 's'}`} flush>
        {waiting.length === 0 ? <Empty title="Nothing waiting for you." /> : <div className="fin-pays">{waiting.map(line)}</div>}
      </Card>
      <Card title="Decided or with Finance" sub="Last 60 days" flush>
        {rest.length === 0 ? <Empty title="None." /> : <div className="fin-pays">{rest.map(line)}</div>}
      </Card>
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
        <div className="list fin-dl">
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
      <Card title="Supporting documents">
        <ul className="small fin-doclist">
          {p.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Card>
      <Card title="Steps" flush>
        <ol className="fin-trail">
          {p.steps.map((s, i) => (
            <li key={i}>
              <span>
                <span className="fin-strong">{s.step}</span> by {s.by}
                {s.comment ? `: ${s.comment}` : ''}
              </span>
              <span className="muted small fin-nowrap">{dateTimeLabel(s.at)}</span>
            </li>
          ))}
        </ol>
      </Card>
      {p.may.length > 0 && (
        <section className="fin-actions">
          <label className="field">
            <span>Comment (needed to approve; a return needs at least 10 characters)</span>
            <textarea className="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div className="row">
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
