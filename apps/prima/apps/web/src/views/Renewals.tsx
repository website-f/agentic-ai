import { useMemo, useState } from 'react';
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import { ArrowsClockwiseIcon, ClockCountdownIcon, QuestionIcon, WarningOctagonIcon } from '@phosphor-icons/react';
import { api, type RenewalAction, type RenewalBoard, type RenewalBody } from '../api';
import { Empty, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';
import { DateLeaf } from './Compliance';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import '../styles/hrx.css';
import { KdnRenewalPanel } from './KdnRenewal';

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

type Focus = 'overdue' | 'due' | 'unknown' | 'inProgress';
const FOCUS: { value: Focus; label: string }[] = [
  { value: 'overdue', label: 'Expired' },
  { value: 'due', label: 'Due' },
  { value: 'unknown', label: 'No expiry on file' },
  { value: 'inProgress', label: 'Being renewed' },
];
/** What a tile picks: its status, plus "being renewed" when a renewal is open. */
const focusOf = (r: Row): Focus[] => {
  const out: Focus[] = [];
  if (r.status === 'OVERDUE') out.push('overdue');
  else if (r.status === 'DUE') out.push('due');
  else if (r.status === 'UNKNOWN') out.push('unknown');
  if (r.licence.renewal) out.push('inProgress');
  return out;
};
const stageOf = (r: Row) => (r.status === 'OVERDUE' ? (['crit', 'Expired'] as const) : STAGE[r.stage]);
const bucketRank = (r: Row) => BUCKETS.findIndex((x) => x.key === bucketOf(r));

/** P107: renewals as one table (was groups by urgency or by company); a row opens its renewal steps in a drawer. */
const RENEWAL_COLUMNS: DtColumn<Row>[] = [
  { id: 'licence', label: 'Licence', value: (r) => `${r.label}${r.licence.title ? `: ${r.licence.title}` : ''}`, phone: 'title' },
  { id: 'company', label: 'Company', value: (r) => r.companyName, phone: 'sub' },
  {
    id: 'ref',
    label: 'Reference',
    value: (r) => r.licence.reference,
    render: (r) => (
      <span className="small">
        {r.licence.reference}
        {r.licence.issuer ? <span className="muted"> · {r.licence.issuer}</span> : null}
      </span>
    ),
    hideBelow: 1100,
  },
  { id: 'expires', label: 'Expires', value: (r) => r.licence.expiresOn, sort: 'date', render: (r) => (r.licence.expiresOn ? dateLabel(r.licence.expiresOn) : 'No expiry on file') },
  { id: 'days', label: 'Days left', value: (r) => r.daysLeft, sort: 'number', hideBelow: 900 },
  {
    id: 'stage',
    label: 'Stage',
    value: bucketRank,
    sort: 'number',
    search: false,
    render: (r) => {
      const [tone, label] = stageOf(r);
      return (
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {r.escalatedTo && <Chip tone="crit">Now with the {r.escalatedTo}</Chip>}
          <Chip tone={tone}>{label}</Chip>
        </span>
      );
    },
  },
];

export function RenewalsView() {
  const { data, error } = useLoad(() => api.renewalBoard(), []);
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const table = useTableState('gov.renewals.list');
  const focus = (table.state.f.focus ?? '') as Focus | '';
  const companies = useMemo(() => new Map((data?.companies ?? []).map((c) => [c.id, c.name])), [data]);
  const filters: DtFilter<Row>[] = useMemo(
    () => [
      { id: 'focus', label: 'Show', value: focusOf, options: FOCUS },
      { id: 'company', label: 'Company', value: (r) => r.licence.companyId, optionLabel: (id) => companies.get(id) ?? id, allLabel: 'All companies' },
      { id: 'stage', label: 'Stage', value: (r) => stageOf(r)[1] },
    ],
    [companies],
  );
  // Most urgent first (expired, due, no expiry, being renewed, in date), then the board's own order.
  const rows = useMemo(
    () =>
      (data?.rows ?? [])
        // The KDN licence is worked on the KDN panel above (Part W).
        .filter((r) => r.licence.type !== 'KDN_LICENCE' && (all || r.stage !== 'ok'))
        .map((r, i) => ({ r, i, b: bucketRank(r) }))
        .sort((x, y) => x.b - y.b || x.i - y.i)
        .map((x) => x.r),
    [data, all],
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
  const pick = (k: Focus) => table.set({ f: { focus: focus === k ? '' : k } });
  const opened = openId ? data.rows.find((r) => r.licence.id === openId) : undefined;
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
      <KdnRenewalPanel />
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
      <section className="k-card">
        <DataTable
          label="Renewals"
          control={table}
          rows={rows}
          rowKey={(r) => r.licence.id}
          columns={RENEWAL_COLUMNS}
          filters={filters}
          searchText={(r) => r.licence.issuer ?? ''}
          searchPlaceholder="Search licence, company or reference"
          onView={(r) => setOpenId(r.licence.id)}
          rowTone={(r) => (r.status === 'OVERDUE' ? 'crit' : r.status === 'DUE' || r.status === 'UNKNOWN' ? 'warn' : undefined)}
          rowEnd={(r) => (r.can.open ? <OpenRenewal r={r} /> : null)}
          toolbar={
            <button className="btn btn-sm" aria-pressed={all} onClick={() => setAll(!all)}>
              {all ? 'Hide in date' : 'Show in date'}
            </button>
          }
          empty={
            <Empty title="Nothing due." action={<RecordButton kind="licence" primary label="Add licence" />}>
              Add each licence, registration or certificate with its expiry date; its renewal opens here when it falls due.
            </Empty>
          }
        />
      </section>
      {opened && (
        <Drawer title={`${opened.label}${opened.licence.title ? `: ${opened.licence.title}` : ''}`} sub={opened.companyName} onClose={() => setOpenId(null)}>
          <RenewalRow r={opened} />
        </Drawer>
      )}
    </div>
  );
}

/** The "Open renewal" button on a row (the same step its drawer offers). */
function OpenRenewal({ r }: { r: Row }) {
  const act = useAction();
  return (
    <button className="btn btn-primary btn-sm" disabled={act.busy} title={act.error?.message} onClick={() => act.run(() => api.renewalStep(r.licence.id, 'open', {}), 'Renewal opened.')}>
      Open renewal
    </button>
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
    <div className="hx-row rn-row" data-tone={r.status === 'OVERDUE' ? 'crit' : r.status === 'DUE' ? 'warn' : r.status === 'UNKNOWN' ? 'unknown' : undefined}>
      <DateLeaf date={r.licence.expiresOn} tone={leafTone} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {r.label}
          {r.licence.title ? `: ${r.licence.title}` : ''}
        </span>
        <span className="hx-row-meta">
          {`${r.companyName} · `}
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
    </div>
  );
}
