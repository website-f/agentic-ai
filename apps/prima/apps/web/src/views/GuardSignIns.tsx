// J5 (P100, Fauzan 11 Nov 2026): guard sign-ins made in bulk with a review step. HR, the company office or the
// Operations Manager picks the company's active guards who have no sign-in yet and sends them for approval; another
// person (HR, the company manager, the OGM or Operations Director, or the Chief of Staff) approves with a comment and the
// sign-ins are made at once. The guard phone itself stays switched off until the CEO's go-ahead.
import { useMemo, useState } from 'react';
import { CheckSquareIcon, IdentificationBadgeIcon } from '@phosphor-icons/react';
import type { User } from '@prima/core';
import { Select } from '../SearchSelect';
import { api } from '../api';
import type { GuardSignInBoard } from '../api/p100-newb';
import { Card, Empty, Facts, Search, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { FilterChips, TabIntro, hasText } from './nb-shared';
import '../styles/items.css';
import '../styles/p100-newb.css';

/** Who sees the button (the server decides per company). */
export function mayGuardSignIns(u: User): boolean {
  if (u.integration) return false;
  if (u.role === 'company_manager' || u.role === 'admin_exec') return true;
  return u.role === 'pwvsb_officer' && (u.department === 'hr' || ['om', 'regional', 'ogm', 'ops_director'].includes(u.opsTier ?? '') || u.leadership === 'cos' || u.leadership === 'deputy_cos');
}

type Batch = GuardSignInBoard['batches'][number];
const STATUS: Record<Batch['status'], [Tone, string]> = {
  prepared: ['warn', 'Waiting for approval'],
  approved: ['info', 'Approved'],
  created: ['ok', 'Sign-ins made'],
  returned: ['neutral', 'Returned'],
  cancelled: ['neutral', 'Cancelled'],
};

export function GuardSignInsButton({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  if (!mayGuardSignIns(user)) return null;
  return (
    <>
      <button className="btn" type="button" onClick={() => setOpen(true)}>
        <IdentificationBadgeIcon size={16} aria-hidden="true" /> Guard sign-ins (bulk)
      </button>
      {open && (
        <Drawer title="Guard sign-ins in bulk" sub="Prepared by one person, approved by another" onClose={() => setOpen(false)}>
          <GuardSignInsPanel />
        </Drawer>
      )}
    </>
  );
}

export function GuardSignInsPanel() {
  const [companyId, setCompanyId] = useState<string | undefined>(undefined);
  const { data, error } = useLoad(() => api.guardSignInBoard(companyId), [companyId]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="guard sign-ins" />;
  const chosen = data.companies.find((c) => c.id === data.companyId)!;
  return (
    <div className="it-stack">
      <TabIntro
        title="Guard sign-ins"
        sub="Each guard needs their own sign-in for the guard phone. Choose the company's active guards who have none yet and send them for approval; someone else approves with a comment and the sign-ins are made at once. The guard phone stays switched off until the CEO's go-ahead."
      />
      {data.companies.length > 1 && (
        <label className="isc-field">
          Company
          <Select className="input" value={data.companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {chosen.prepare && <Prepare data={data} />}
      <Batches data={data} />
    </div>
  );
}

function Prepare({ data }: { data: GuardSignInBoard }) {
  const act = useAction();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const list = useMemo(() => data.candidates.filter((c) => hasText(q, c.staffNo, c.name)), [data.candidates, q]);
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  return (
    <Card title="Guards without a sign-in" sub={`${data.candidates.length} active guard${data.candidates.length === 1 ? '' : 's'} in this company have none yet. At most ${data.max} in one batch.`} flush>
      {!data.candidates.length ? (
        <Empty title="Every active guard has a sign-in." />
      ) : (
        <>
          <div className="it-pad">
            <Toolbar end={<button className="btn btn-sm" type="button" onClick={() => setPicked(new Set(list.slice(0, data.max).map((c) => c.personId)))}><CheckSquareIcon size={14} aria-hidden="true" /> Choose all shown</button>}>
              <Search value={q} onChange={setQ} placeholder="Search staff number or name" />
            </Toolbar>
          </div>
          <ul className="it-rows it-rows-tight" style={{ maxHeight: 360, overflow: 'auto' }}>
            {list.slice(0, 300).map((c) => (
              <li key={c.personId}>
                <label className="it-row isc-choice" style={{ justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' }}>
                  <input type="checkbox" checked={picked.has(c.personId)} onChange={() => toggle(c.personId)} />
                  <span className="it-row-main">
                    <strong>{c.name}</strong>
                    <span className="muted">{c.staffNo}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="it-pad">
            {list.length > 300 && <p className="muted small">Showing 300 of {list.length}. Search to find others.</p>}
            <label className="isc-field">
              Note for the approver (optional)
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="nb-actions">
              <button className="btn" type="button" disabled={!picked.size} onClick={() => setPicked(new Set())}>
                Clear
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={act.busy || !picked.size || picked.size > data.max}
                onClick={async () => {
                  const r = await act.run(() => api.prepareGuardSignIns(data.companyId, [...picked], note), `${picked.size} sent for approval.`);
                  if (r) (setPicked(new Set()), setNote(''));
                }}
              >
                {`Send ${picked.size} for approval`}
              </button>
            </div>
            <ErrorNotice error={act.error} />
          </div>
        </>
      )}
    </Card>
  );
}

function Batches({ data }: { data: GuardSignInBoard }) {
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [open, setOpen] = useState<string | null>(null);
  const list = data.batches.filter((b) => (show === 'open' ? b.status === 'prepared' : true));
  const b = data.batches.find((x) => x.id === open) ?? null;
  return (
    <Card title="Batches" flush>
      <div className="it-pad">
        <FilterChips
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            ['open', 'Waiting', data.batches.filter((x) => x.status === 'prepared').length],
            ['all', 'All', data.batches.length],
          ]}
        />
      </div>
      {!list.length ? (
        <Empty title="No batches here." />
      ) : (
        <ul className="it-rows">
          {list.map((x) => (
            <li key={x.id}>
              <button className="it-row it-row-btn" type="button" data-tone={x.canDecide ? 'warn' : undefined} onClick={() => setOpen(x.id)}>
                <span className="it-row-main">
                  <strong>
                    {x.ref} · {x.rows.length} guard{x.rows.length === 1 ? '' : 's'}
                  </strong>
                  <span className="muted">
                    {x.companyName} · {x.preparedBy}, {dateLabel(x.preparedAt.slice(0, 10))}
                  </span>
                  {x.canDecide && <span className="nb-due">For you to approve</span>}
                </span>
                <Chip tone={STATUS[x.status][0]}>{STATUS[x.status][1]}</Chip>
              </button>
            </li>
          ))}
        </ul>
      )}
      {b && <BatchDetail b={b} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function BatchDetail({ b, onClose }: { b: Batch; onClose: () => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    const r = await act.run(fn, msg);
    if (r) onClose();
  };
  return (
    <div className="it-pad it-stack" style={{ borderTop: '1px solid var(--line)' }}>
      <Facts
        items={[
          ['Batch', `${b.ref}, ${b.companyName}`],
          ['Prepared by', `${b.preparedBy}, ${dateTimeLabel(b.preparedAt)}`],
          ...(b.note ? ([['Note', b.note]] as [string, string][]) : []),
          ...(b.decision ? ([[b.decision.approve ? 'Approved by' : 'Returned by', `${b.decision.by}: ${b.decision.note}`]] as [string, string][]) : []),
          ...(b.created ? ([['Made', `${b.created.count} sign-in${b.created.count === 1 ? '' : 's'}${b.created.skipped.length ? `, ${b.created.skipped.length} skipped (already had one or no longer active)` : ''}`]] as [string, string][]) : []),
          ...(b.cancelled ? ([['Cancelled', `${b.cancelled.by}: ${b.cancelled.reason}`]] as [string, string][]) : []),
        ]}
      />
      <details className="nb-more">
        <summary>{`The ${b.rows.length} guards`}</summary>
        <ul className="it-rows it-rows-tight">
          {b.rows.map((r) => (
            <li key={r.personId} className="it-row">
              <span className="it-row-main">
                <strong>{r.name}</strong>
                <span className="muted">{r.staffNo}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
      {b.status === 'prepared' && b.mine && <p className="muted small">You prepared this batch, so someone else approves it.</p>}
      {(b.canDecide || b.canCancel) && (
        <label className="isc-field">
          {b.canDecide ? 'Comment (required)' : 'Reason (required)'}
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <div className="nb-actions">
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
        {b.canCancel && (
          <button className="btn" type="button" disabled={act.busy || note.trim().length < 3} onClick={() => run(() => api.cancelGuardSignIns(b.id, note), 'Batch cancelled.')}>
            Cancel the batch
          </button>
        )}
        {b.canDecide && (
          <>
            <button className="btn" type="button" disabled={act.busy || note.trim().length < 3} onClick={() => run(() => api.decideGuardSignIns(b.id, false, note), 'Returned.')}>
              Return
            </button>
            <button className="btn btn-primary" type="button" disabled={act.busy || note.trim().length < 3} onClick={() => run(() => api.decideGuardSignIns(b.id, true, note), 'Approved. The sign-ins are made.')}>
              Approve and make the sign-ins
            </button>
          </>
        )}
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}
