import { Select } from '../SearchSelect';
import { useMemo, useState } from 'react';
import { ArrowsClockwiseIcon, ClockCountdownIcon, QuestionIcon, WarningOctagonIcon } from '@phosphor-icons/react';
import { api, type RenewalAction, type RenewalBoard, type RenewalBody } from '../api';
import { Empty, PageHead, Search, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';
import { CalendarGroup, DateLeaf } from './Compliance';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import '../styles/hrx.css';

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

/** The renewal's steps, in the order the stages run. */
const FLOW: { stage: Row['stage']; label: string }[] = [
  { stage: 'papers', label: 'Papers' },
  { stage: 'to_sign', label: 'Manager signs' },
  { stage: 'fee', label: 'Fee' },
  { stage: 'to_submit', label: 'Submit' },
  { stage: 'with_agency', label: 'With the agency' },
  { stage: 'to_confirm', label: 'Central Admin confirms' },
];

type Bucket = 'overdue' | 'due' | 'unknown' | 'progress' | 'ok';
const BUCKETS: { key: Bucket; title: string; tone?: string }[] = [
  { key: 'overdue', title: 'Expired', tone: 'crit' },
  { key: 'due', title: 'Due', tone: 'warn' },
  { key: 'unknown', title: 'No expiry on file', tone: 'unknown' },
  { key: 'progress', title: 'Being renewed, still in date', tone: 'info' },
  { key: 'ok', title: 'In date', tone: 'ok' },
];
function bucketOf(r: Row): Bucket {
  if (r.status === 'OVERDUE') return 'overdue';
  if (r.status === 'DUE') return 'due';
  if (r.status === 'UNKNOWN') return 'unknown';
  return r.licence.renewal && r.stage !== 'ok' ? 'progress' : 'ok';
}

export function RenewalsView() {
  const { data, error } = useLoad(() => api.renewalBoard(), []);
  const [all, setAll] = useState(false);
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const [by, setBy] = useState<'urgency' | 'company'>('urgency');
  const [focus, setFocus] = useState<'overdue' | 'due' | 'unknown' | 'inProgress' | ''>('');
  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (r) =>
          (all || r.stage !== 'ok') &&
          (!company || r.licence.companyId === company) &&
          (!focus ||
            (focus === 'inProgress'
              ? !!r.licence.renewal
              : focus === 'overdue'
                ? r.status === 'OVERDUE'
                : focus === 'due'
                  ? r.status === 'DUE'
                  : r.status === 'UNKNOWN')) &&
          (!needle || `${r.label} ${r.licence.title ?? ''} ${r.companyName} ${r.licence.reference} ${r.licence.issuer ?? ''}`.toLowerCase().includes(needle)),
      ),
    [data, all, company, focus, needle],
  );
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="renewals" />
      </div>
    );
  const sum = (k: 'overdue' | 'due' | 'unknown' | 'inProgress') => data.companies.reduce((n, c) => n + c[k], 0);
  const expired = data.companies.filter((c) => c.kdnExpired);
  const pick = (k: typeof focus) => setFocus(focus === k ? '' : k);
  const groups =
    by === 'urgency'
      ? BUCKETS.map((b) => ({ key: b.key, title: b.title, tone: b.tone, rows: rows.filter((r) => bucketOf(r) === b.key) }))
      : [...new Set(rows.map((r) => r.licence.companyId))].map((id) => {
          const mine = rows.filter((r) => r.licence.companyId === id);
          const worst = BUCKETS.find((b) => mine.some((r) => bucketOf(r) === b.key));
          return { key: id, title: mine[0].companyName, tone: worst?.tone, rows: mine };
        });
  return (
    <div className="page">
      <PageHead
        title="Renewals"
        sub="Every licence, registration and certificate each company holds: KDN, MOF and vendor panels, council licences, ISO, fire certificate, insurance and SSM. Each company renews its own; Central Admin monitors and confirms the new expiry. The app never lodges or pays."
        actions={
          <>
            <ImportButton kind="licence" />
            <RecordButton kind="licence" primary label="Add licence" />
          </>
        }
      >
        <p className="notice" data-tone="info">
          Test data. Lead times and paper lists are starting proposals; the agency's current form decides.
        </p>
      </PageHead>
      <CentralAdminGuide view="renewals" />
      <Stats>
        <Stat
          label="Expired"
          value={sum('overdue')}
          tone={sum('overdue') ? 'crit' : 'ok'}
          icon={<WarningOctagonIcon size={16} />}
          note={focus === 'overdue' ? 'Showing these only' : 'Past the expiry date'}
          onClick={() => pick('overdue')}
        />
        <Stat
          label="Due"
          value={sum('due')}
          tone={sum('due') ? 'warn' : 'ok'}
          icon={<ClockCountdownIcon size={16} />}
          note={focus === 'due' ? 'Showing these only' : 'Inside the lead time'}
          onClick={() => pick('due')}
        />
        <Stat
          label="No expiry on file"
          value={sum('unknown')}
          tone={sum('unknown') ? 'warn' : 'ok'}
          icon={<QuestionIcon size={16} />}
          note={focus === 'unknown' ? 'Showing these only' : 'Unknown, not in date'}
          onClick={() => pick('unknown')}
        />
        <Stat
          label="Being renewed"
          value={sum('inProgress')}
          tone="info"
          icon={<ArrowsClockwiseIcon size={16} />}
          note={focus === 'inProgress' ? 'Showing these only' : 'A renewal is open'}
          onClick={() => pick('inProgress')}
        />
      </Stats>
      {expired.length > 0 && (
        <p className="notice" data-tone="warn">
          KDN licence past its expiry, renewal is urgent: {expired.map((c) => c.name).join(', ')}.
        </p>
      )}
      <Toolbar
        end={
          <>
            <div className="seg" role="group" aria-label="Group by">
              <button aria-pressed={by === 'urgency'} onClick={() => setBy('urgency')}>
                By urgency
              </button>
              <button aria-pressed={by === 'company'} onClick={() => setBy('company')}>
                By company
              </button>
            </div>
            <button className="btn btn-sm" aria-pressed={all} onClick={() => setAll(!all)}>
              {all ? 'Hide in date' : 'Show in date'}
            </button>
          </>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search licence, company or reference" label="Search renewals" />
        {data.companies.length > 1 && (
          <Select className="select hx-filter" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">All companies</option>
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {focus && (
          <button className="btn btn-sm" onClick={() => setFocus('')}>
            Clear filter
          </button>
        )}
      </Toolbar>
      {rows.length === 0 && (
        <section className="k-card">
          <Empty title="Nothing due." action={needle || focus || company ? undefined : <RecordButton kind="licence" primary label="Add licence" />}>
            {needle || focus || company ? 'No renewal matches the search or filter.' : 'Add each licence, registration or certificate with its expiry date; its renewal opens here when it falls due.'}
          </Empty>
        </section>
      )}
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <CalendarGroup key={g.key} title={g.title} count={g.rows.length} tone={g.tone}>
            {g.rows.map((r) => (
              <RenewalRow key={r.licence.id} r={r} byCompany={by === 'company'} />
            ))}
          </CalendarGroup>
        ))}
    </div>
  );
}

function RenewalRow({ r, byCompany }: { r: Row; byCompany: boolean }) {
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
  const leafTone = r.status === 'OVERDUE' ? 'crit' : r.status === 'DUE' ? 'warn' : r.status === 'UNKNOWN' ? 'unknown' : 'ok';
  const at = FLOW.findIndex((f) => f.stage === r.stage);
  const steps = FLOW.map((f, i): { label: string; state: StepState } => ({
    label: f.label,
    state: r.stage === 'ok' || i < at ? 'done' : i === at ? 'now' : 'todo',
  }));
  const needsRef = c.fee || c.submit || c.renewed || c.agency || c.returnIt || c.confirm;
  const needsNote = c.agency || c.returnIt || c.confirm;
  const anyForm = c.papers || needsRef || c.sign;
  return (
    <li className="hx-row rn-row" data-tone={r.status === 'OVERDUE' ? 'crit' : r.status === 'DUE' ? 'warn' : r.status === 'UNKNOWN' ? 'unknown' : undefined}>
      <DateLeaf date={r.licence.expiresOn} tone={leafTone} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {r.label}
          {r.licence.title ? `: ${r.licence.title}` : ''}
        </span>
        <span className="hx-row-meta">
          {byCompany ? '' : `${r.companyName} · `}
          {r.licence.reference}
          {r.licence.issuer ? ` · ${r.licence.issuer}` : ''}
        </span>
        <span className="hx-row-meta">
          {r.licence.expiresOn
            ? `Expires ${dateLabel(r.licence.expiresOn)}${r.daysLeft !== null ? ` (${r.daysLeft < 0 ? `${-r.daysLeft} days ago` : `${r.daysLeft} days`})` : ''}`
            : 'No expiry on file'}{' '}
          · opens {r.leadDays} days before
        </span>
      </div>
      <div className="hx-row-side">
        {r.escalatedTo && <Chip tone="crit">Now with the {r.escalatedTo}</Chip>}
        <Chip tone={tone}>{label}</Chip>
        {c.open && (
          <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('open', {}, 'Renewal opened.')}>
            Open renewal
          </button>
        )}
      </div>
      <div className="hx-row-body">
        {rc && (
          <div className="rn-progress">
            <Steps steps={steps} />
            <div className="rn-detail">
              {rc.papers.length > 0 && (
                <div className="rn-detail-block">
                  <span className="label">Papers</span>
                  <ul className="hx-checks">
                    {rc.papers.map((p, i) => (
                      <li key={i}>
                        <label>
                          <input type="checkbox" checked={!!p.done} disabled={!c.papers || act.busy} onChange={() => step('paper', { index: i }, 'Updated.')} />
                          <span>
                            {p.name}
                            {p.done && <span className="hx-check-by"> · {p.done.by}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(rc.signed || rc.fee || rc.submitted || rc.agencyNotes.length > 0 || rc.returns.length > 0 || rc.renewed) && (
                <div className="rn-detail-block">
                  <span className="label">So far</span>
                  <ul className="rn-log">
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
                      <li key={`r${i}`} data-tone="warn">
                        Sent back: {n.note} ({n.by})
                      </li>
                    ))}
                    {rc.renewed && (
                      <li data-tone="ok">
                        Renewed to {dateLabel(rc.renewed.newExpiresOn)}, certificate {rc.renewed.certificateRef} ({rc.renewed.by})
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
        {act.error && <p className="error small">{act.error.message}</p>}
        {anyForm && (
          <div className="hx-form">
            {(c.papers || c.sign) && (
              <div className="rn-line">
                {c.papers && (
                  <>
                    <input
                      className="input"
                      aria-label="Another paper"
                      placeholder="Another paper the agency asks for"
                      value={paper}
                      onChange={(e) => setPaper(e.target.value)}
                    />
                    <button className="btn btn-sm" disabled={act.busy || paper.trim().length < 3} onClick={() => step('addPaper', { name: paper }, 'Paper added.')}>
                      Add paper
                    </button>
                  </>
                )}
                {c.sign && (
                  <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('sign', {}, 'Signed.')}>
                    Sign the application
                  </button>
                )}
              </div>
            )}
            {needsRef && (
              <div className="hx-form-grid">
                <label className="field">
                  <span className="label">{c.fee ? 'Payment reference' : c.renewed ? 'Certificate reference' : 'Reference'}</span>
                  <input
                    className="input"
                    aria-label="Reference"
                    placeholder={c.fee ? 'Finance payment ref, or "no fee"' : c.renewed ? 'New certificate ref' : 'Reference'}
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                  />
                </label>
                {c.fee && (
                  <label className="field">
                    <span className="label">Fee (RM)</span>
                    <input className="input" aria-label="Fee in RM" placeholder="Fee RM" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                )}
                {c.renewed && (
                  <label className="field">
                    <span className="label">New expiry</span>
                    <input className="input" type="date" aria-label="New expiry" value={newExp} onChange={(e) => setNewExp(e.target.value)} />
                  </label>
                )}
                {needsNote && (
                  <label className="field">
                    <span className="label">Note</span>
                    <input className="input" aria-label="Note" placeholder="Note or reason" value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                )}
              </div>
            )}
            {needsRef && (
              <div className="hx-form-actions">
                {c.fee && (
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => step('fee', { ref, amount: amount ? Number(amount) : null }, 'Fee recorded.')}>
                    Record fee
                  </button>
                )}
                {c.submit && r.stage === 'to_submit' && (
                  <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('submit', { ref }, 'Submitted.')}>
                    Record submission
                  </button>
                )}
                {c.renewed && (
                  <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('renewed', { newExpiresOn: newExp, ref }, 'Renewal recorded.')}>
                    Record new certificate
                  </button>
                )}
                {c.agency && (
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => step('agency', { note }, 'Note added.')}>
                    Agency note
                  </button>
                )}
                {c.confirm && (
                  <>
                    <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('confirm', { note, ok: true }, 'Confirmed.')}>
                      Confirm new expiry
                    </button>
                    <button className="btn btn-sm" disabled={act.busy} onClick={() => step('confirm', { note, ok: false }, 'Queried.')}>
                      Query it
                    </button>
                  </>
                )}
                {c.returnIt && (
                  <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => step('return', { note }, 'Sent back.')}>
                    Send back
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
