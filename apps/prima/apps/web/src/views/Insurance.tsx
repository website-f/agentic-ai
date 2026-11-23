import { Select } from '../SearchSelect';
import { useState } from 'react';
import { BuildingsIcon, CoinsIcon, FileTextIcon, ScalesIcon, ShieldWarningIcon, UmbrellaIcon } from '@phosphor-icons/react';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { api, type Insurance, type InsuranceRenewInput } from '../api';
import { useApp, useRouteTab } from '../App';
import { KeyIn } from '../KeyIn';
import { Card, Empty, Facts, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { SopHelp } from '../sop/SopHelp';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { DataTable, useTableState, type DtColumn, type DtFilter } from '../DataTable';
import '../styles/biz.css';

type Tab = 'alerts' | 'policies' | 'premiums' | 'claims' | 'guarantees' | 'companies' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'alerts', label: 'To chase' },
  { id: 'policies', label: 'Policies' },
  { id: 'premiums', label: 'Premiums' },
  { id: 'claims', label: 'Claims' },
  { id: 'guarantees', label: 'Guarantees' },
  { id: 'companies', label: 'Companies' },
  { id: 'history', label: 'History' },
];

type PolicyRow = Insurance['policies'][number];

const rm = (v: number) => `RM ${v.toLocaleString('en-MY')}`;

const CLAIM_STATUS: Record<Insurance['claims'][number]['claim']['status'], { label: string; tone: Tone }> = {
  to_notify: { label: 'Insurer not told', tone: 'crit' },
  notified: { label: 'Insurer told', tone: 'info' },
  documents: { label: 'Sending documents', tone: 'info' },
  assessing: { label: 'Adjuster assessing', tone: 'info' },
  offered: { label: 'Insurer offered', tone: 'warn' },
  settled: { label: 'Settled', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

const GUARANTEE_STATE: Record<Insurance['guarantees'][number]['state'], { label: string; tone: Tone }> = {
  lapsed: { label: 'Expired, contract running', tone: 'crit' },
  extend: { label: 'Extend before contract ends', tone: 'warn' },
  release: { label: 'Ask for release', tone: 'info' },
  short: { label: 'Ends before contract', tone: 'neutral' },
  ok: { label: 'Valid to contract end', tone: 'ok' },
  released: { label: 'Released', tone: 'neutral' },
};

const PREMIUM: Record<Insurance['policies'][number]['premium'], { label: string; tone: Tone }> = {
  overdue: { label: 'Unpaid, overdue', tone: 'crit' },
  due: { label: 'Due soon', tone: 'warn' },
  later: { label: 'Not due yet', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'ok' },
};

const stripe = (t: Tone) => (t === 'crit' || t === 'warn' ? t : undefined);

/**
 * Chief of Staff insurance section (Fauzan, 25 Oct 2026): premiums, every insurance matter and
 * guarantees, for every company. The section chases; each company's board and Finance pay, sign and settle.
 */
export function InsuranceView() {
  const { me } = useApp();
  const [tab, setTab] = useRouteTab<Tab>('alerts', ['alerts', 'policies', 'premiums', 'claims', 'guarantees', 'companies', 'history']);
  const { data, error } = useLoad(() => api.insurance(), []);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="insurance" />
      </div>
    );
  const t = data.tiles;
  const group = me.user.role === 'director' || me.user.role === 'pwvsb_officer';
  return (
    <div className="page bz-in-page">
      <PageHead
        title="Insurance"
        sub={`Premiums, policies, claims and guarantees${group ? ' for every company' : ''}. The Chief of Staff's insurance section follows up; paying a premium, signing a guarantee or accepting a settlement stays with the company's board and Finance. A company with no records loaded shows Unknown, never as covered.`}
        actions={
          <>
            <SopHelp id="finance-insurance-claim" />
            <AddFor kind="insurancePolicy" label="Add policy" primary />
            <AddFor kind="insuranceClaim" label="Record claim" />
            <AddFor kind="insuranceGuarantee" label="Add guarantee" />
            {/* P91: Import for the open tab's records (policies on the other tabs). */}
            <ImportFor kind={tab === 'claims' ? 'insuranceClaim' : tab === 'guarantees' ? 'insuranceGuarantee' : 'insurancePolicy'} />
          </>
        }
      />
      <Stats>
        <Stat
          label="Cover gaps"
          value={t.coverGaps + t.lapsed}
          tone={t.coverGaps + t.lapsed ? 'crit' : 'ok'}
          note={`${t.lapsed} lapsed, ${t.coverGaps} missing`}
          icon={<ShieldWarningIcon size={16} />}
          onClick={() => setTab('companies')}
        />
        <Stat
          label="Renewals due"
          value={t.expiring}
          tone={t.expiring ? 'warn' : 'ok'}
          note={`Within ${data.rules.renewDays} days, not renewed`}
          icon={<UmbrellaIcon size={16} />}
          onClick={() => setTab('policies')}
        />
        <Stat
          label="Premiums to pay"
          value={rm(t.premiumUnpaid)}
          tone={t.premiumsOverdue ? 'crit' : t.premiumsDue ? 'warn' : 'ok'}
          note={`${t.premiumsOverdue} overdue, ${t.premiumsDue} due within ${data.rules.premiumDays.firstDays} days (second reminder at ${data.rules.premiumDays.secondDays})`}
          icon={<CoinsIcon size={16} />}
          onClick={() => setTab('premiums')}
        />
        <Stat label="Annual premiums" value={rm(t.premiumYear)} note="Companies with records" icon={<CoinsIcon size={16} />} />
        <Stat
          label="Claims open"
          value={t.claimsOpen}
          tone={t.claimsNotNotified ? 'crit' : t.claimsOpen ? 'info' : 'ok'}
          note={`${t.claimsNotNotified} insurer not told yet`}
          icon={<FileTextIcon size={16} />}
          onClick={() => setTab('claims')}
        />
        <Stat
          label="Guarantees out"
          value={rm(t.guaranteesLive)}
          tone={t.guaranteesAction ? 'warn' : 'ok'}
          note={`${t.guaranteesAction} to extend or release`}
          icon={<ScalesIcon size={16} />}
          onClick={() => setTab('guarantees')}
        />
        {group && (
          <Stat
            label="Companies unknown"
            value={t.unknown}
            tone={t.unknown ? 'unknown' : 'ok'}
            note="No insurance records loaded"
            icon={<BuildingsIcon size={16} />}
            onClick={() => setTab('companies')}
          />
        )}
      </Stats>
      <div className="tabbar" role="tablist" aria-label="Insurance sections">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {x.label}
            {x.id === 'alerts' && data.alerts.length > 0 && <span className="tab-count">{data.alerts.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'alerts' && <Alerts data={data} />}
      {tab === 'policies' && <Policies data={data} />}
      {tab === 'premiums' && <Premiums data={data} />}
      {tab === 'claims' && <Claims data={data} />}
      {tab === 'guarantees' && <Guarantees data={data} />}
      {tab === 'companies' && <Companies data={data} />}
      {tab === 'history' && <History data={data} />}
    </div>
  );
}

type AlertRow = Insurance['alerts'][number] & { key: string };

/** P107: "To chase" as a data table, most urgent first as before. */
const ALERT_COLUMNS: DtColumn<AlertRow>[] = [
  { id: 'title', label: 'To chase', value: (a) => a.title, render: (a) => <strong>{a.title}</strong>, phone: 'title' },
  { id: 'detail', label: 'Details', value: (a) => a.detail, phone: 'sub' },
  { id: 'company', label: 'Company', value: (a) => a.companyName },
  { id: 'kind', label: 'Type', value: (a) => a.kind, translate: true, render: (a) => <Chip tone={a.tone}>{a.kind}</Chip> },
];
const ALERT_FILTERS: DtFilter<AlertRow>[] = [
  { id: 'kind', label: 'Type', value: (a) => a.kind },
  { id: 'company', label: 'Company', value: (a) => a.companyName },
];

function Alerts({ data }: { data: Insurance }) {
  const rows = data.alerts.map((a, i) => ({ ...a, key: String(i) }));
  return (
    <Card title="To chase" sub="Most urgent first" flush>
      <DataTable
        label="To chase"
        stateKey="insurance.alerts"
        rows={rows}
        rowKey={(a) => a.key}
        columns={ALERT_COLUMNS}
        filters={ALERT_FILTERS}
        rowTone={(a) => stripe(a.tone)}
        empty={<Empty title="Nothing to chase." />}
      />
    </Card>
  );
}

const EXPIRY_OPTIONS = [
  { value: 'OVERDUE', label: 'Expired' },
  { value: 'DUE', label: 'Due soon' },
  { value: 'OK', label: 'Valid' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

/** P107: the policies as a data table: policy, insurer, company, cover and dates, premium, renewal state. */
const POLICY_COLUMNS: DtColumn<PolicyRow>[] = [
  {
    id: 'policy',
    label: 'Policy',
    value: (r) => r.label,
    render: (r) => (
      <>
        <strong>{r.label}</strong>
        <span className="bz-sub" style={{ display: 'block' }}>
          {r.policy.scheduleRef ? `Schedule: ${r.policy.scheduleRef}` : 'Policy schedule not on file'}
          {r.renewedBy ? ` · renewed as ${r.renewedBy.policyNo} from ${dateLabel(r.renewedBy.startsOn)}` : ''}
        </span>
      </>
    ),
    phone: 'title',
  },
  {
    id: 'insurer',
    label: 'Insurer',
    value: (r) => r.policy.insurer,
    render: (r) => (
      <>
        {r.policy.insurer} · <span className="mono">{r.policy.policyNo}</span>
        {r.policy.broker ? ` · via ${r.policy.broker}` : ''}
      </>
    ),
    phone: 'sub',
  },
  { id: 'company', label: 'Company', value: (r) => r.companyName, hideBelow: 1200 },
  { id: 'cover', label: 'Cover', value: (r) => r.policy.sumInsured, sort: 'money', render: (r) => rm(r.policy.sumInsured) },
  {
    id: 'dates',
    label: 'Dates',
    value: (r) => r.policy.expiresOn,
    sort: 'date',
    render: (r) => (
      <span className="bz-sub">
        {dateLabel(r.policy.startsOn)} to {dateLabel(r.policy.expiresOn)}
      </span>
    ),
    hideBelow: 1100,
  },
  {
    id: 'premium',
    label: 'Premium',
    value: (r) => r.policy.premium,
    sort: 'money',
    render: (r) => (
      <>
        {rm(r.policy.premium)} <span className="bz-sub">a year</span>
      </>
    ),
  },
  {
    id: 'status',
    label: 'Status',
    value: (r) => r.cover.daysLeft ?? null,
    sort: 'number',
    search: false,
    align: 'left',
    render: (r) => (
      <span className="bz-chips">
        <ExpiryChip status={r.cover.status} daysLeft={r.cover.daysLeft} />
        {r.cover.status === 'DUE' && (
          <span className="bz-sub">
            renewal {r.policy.renewal === 'renewed' ? 'done' : r.policy.renewal === 'quotes' ? 'quotes in hand' : 'not started'}
          </span>
        )}
      </span>
    ),
  },
];
const POLICY_FILTERS: DtFilter<PolicyRow>[] = [
  { id: 'company', label: 'Company', value: (r) => r.companyName },
  { id: 'status', label: 'Status', value: (r) => r.cover.status, options: EXPIRY_OPTIONS },
  {
    id: 'renewal',
    label: 'Policy renewal',
    value: (r) => r.policy.renewal,
    options: [
      { value: 'not_started', label: 'Not started' },
      { value: 'quotes', label: 'Quotes in hand' },
      { value: 'renewed', label: 'Renewed' },
    ],
  },
  { id: 'insurer', label: 'Insurer', value: (r) => r.policy.insurer },
];

function Policies({ data }: { data: Insurance }) {
  // P107: the Renew / Cancel policy form open under a row (several may be open, as before).
  const [steps, setSteps] = useState<Record<string, 'renew' | 'cancel'>>({});
  const setStep = (id: string, s: 'renew' | 'cancel' | null) =>
    setSteps((x) => {
      const next = { ...x };
      if (s) next[id] = s;
      else delete next[id];
      return next;
    });
  return (
    <Card title="Policies" sub={`Renewal starts ${data.rules.renewDays} days before expiry`} actions={<><ImportFor kind="insurancePolicy" /><AddFor kind="insurancePolicy" label="Add policy" /></>} flush>
      <DataTable
        label="Policies"
        stateKey="insurance.policies"
        rows={data.policies}
        rowKey={(r) => r.policy.id}
        columns={POLICY_COLUMNS}
        filters={POLICY_FILTERS}
        searchText={(r) => `${r.policy.policyNo} ${r.policy.broker ?? ''} ${r.policy.scheduleRef ?? ''}`}
        rowEnd={(r) => (
          <>
            {r.canAct && <PolicySteps r={r} open={steps[r.policy.id] ?? null} onOpen={(s) => setStep(r.policy.id, s)} />}
            {!r.renewedBy && <RecordButton kind="insurancePolicy" id={r.policy.id} />}
          </>
        )}
        rowDetail={(r) => {
          const s = r.canAct && !r.renewedBy ? steps[r.policy.id] : undefined;
          if (!s) return null;
          return (
            <div data-no-row-click>
              {s === 'renew' ? <RenewForm r={r} onDone={() => setStep(r.policy.id, null)} /> : <CancelForm policyId={r.policy.id} onDone={() => setStep(r.policy.id, null)} />}
            </div>
          );
        }}
        empty={<Empty title="No policies recorded." action={<AddFor kind="insurancePolicy" label="Add policy" primary />} />}
      />
    </Card>
  );
}

type PremiumState = Insurance['policies'][number]['premium'];
const PREMIUM_ORDER: Record<PremiumState, number> = { overdue: 0, due: 1, later: 2, paid: 3 };

/** P107: the premiums as one data table (the old groups are the Premiums filter; the group heads above pick it). */
const PREMIUM_COLUMNS: DtColumn<PolicyRow>[] = [
  { id: 'policy', label: 'Policy', value: (r) => r.label, render: (r) => <strong>{r.label}</strong>, phone: 'title' },
  { id: 'insurer', label: 'Insurer', value: (r) => r.policy.insurer, hideBelow: 1200, phone: 'sub' },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
  {
    id: 'due',
    label: 'Due',
    value: (r) => r.policy.premiumDueOn,
    sort: 'date',
    render: (r) => (
      <span className="bz-sub">
        {r.policy.premiumPayment
          ? `Paid ${dateLabel(r.policy.premiumPayment.on)}, ref ${r.policy.premiumPayment.ref}`
          : r.policy.premiumPaidOn
            ? `Paid ${dateLabel(r.policy.premiumPaidOn)}, no payment reference recorded`
            : r.premiumDaysLeft < 0
              ? `Was due ${dateLabel(r.policy.premiumDueOn)}, ${-r.premiumDaysLeft} days ago`
              : `Due ${dateLabel(r.policy.premiumDueOn)}, in ${r.premiumDaysLeft} days`}
      </span>
    ),
  },
  { id: 'premium', label: 'Premium', value: (r) => r.policy.premium, sort: 'money', render: (r) => rm(r.policy.premium) },
  {
    id: 'state',
    label: 'Status',
    value: (r) => PREMIUM[r.premium].label,
    translate: true,
    render: (r) => (
      <span className="bz-chips">
        <Chip tone={PREMIUM[r.premium].tone}>{PREMIUM[r.premium].label}</Chip>
        {r.paidWithoutRef && <Chip tone="warn">Paid, no reference</Chip>}
      </span>
    ),
  },
];
const PREMIUM_FILTERS: DtFilter<PolicyRow>[] = [
  { id: 'state', label: 'Premiums', value: (r) => r.premium, options: (Object.keys(PREMIUM_ORDER) as PremiumState[]).map((k) => ({ value: k, label: PREMIUM[k].label })) },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
];

function Premiums({ data }: { data: Insurance }) {
  const rows = [...data.policies].sort((a, b) => a.policy.premiumDueOn.localeCompare(b.policy.premiumDueOn));
  rows.sort((a, b) => PREMIUM_ORDER[a.premium] - PREMIUM_ORDER[b.premium]);
  const groups = (Object.keys(PREMIUM_ORDER) as PremiumState[]).map((k) => ({ k, rows: rows.filter((r) => r.premium === k) })).filter((g) => g.rows.length);
  const table = useTableState('insurance.premiums');
  const chosen = table.state.f.state ?? '';
  // P107: the Record payment form open under a row.
  const [paying, setPaying] = useState<ReadonlySet<string>>(new Set());
  const setPay = (id: string, on: boolean) =>
    setPaying((x) => {
      const next = new Set(x);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const canPay = (r: PolicyRow) => r.canAct && r.premium !== 'paid';
  return (
    <Card title="Premiums" sub="Cash before cover: an unpaid premium can leave the company without cover" flush>
      {groups.length > 0 && (
        <div className="bz-in-group">
          {/* The old group heads: each state's count and total; a click shows only that state, a second click all. */}
          <div className="bz-chips">
            {groups.map((g) => (
              <button
                key={g.k}
                type="button"
                className="btn btn-ghost btn-sm"
                aria-pressed={chosen === g.k}
                onClick={() => table.set({ f: { state: chosen === g.k ? '' : g.k } })}
              >
                <Chip tone={PREMIUM[g.k].tone}>{PREMIUM[g.k].label}</Chip>
                <span className="bz-sub">
                  {g.rows.length} · <span className="bz-amt">{rm(g.rows.reduce((n, r) => n + r.policy.premium, 0))}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <DataTable
        label="Premiums"
        control={table}
        rows={rows}
        rowKey={(r) => r.policy.id}
        columns={PREMIUM_COLUMNS}
        filters={PREMIUM_FILTERS}
        searchText={(r) => `${r.policy.policyNo} ${r.policy.premiumPayment?.ref ?? ''}`}
        rowTone={(r) => (r.premium === 'overdue' ? 'crit' : r.premium === 'due' ? 'warn' : undefined)}
        rowEnd={(r) =>
          canPay(r) && !paying.has(r.policy.id) ? (
            <button className="btn btn-sm" onClick={() => setPay(r.policy.id, true)}>
              Record payment
            </button>
          ) : null
        }
        rowDetail={(r) =>
          canPay(r) && paying.has(r.policy.id) ? (
            <div data-no-row-click>
              <PremiumForm policyId={r.policy.id} onClose={() => setPay(r.policy.id, false)} />
            </div>
          ) : null
        }
        empty={<Empty title="No policies recorded." />}
      />
    </Card>
  );
}

/** P107: the claims as a data table: what, policy, company, incident, status, amount; Steps opens the claim drawer. */
const CLAIM_COLUMNS: DtColumn<ClaimRow>[] = [
  {
    id: 'what',
    label: 'Claim',
    value: (r) => r.claim.what,
    render: (r) => (
      <>
        <strong>{r.claim.what}</strong>
        <span className="bz-sub" style={{ display: 'block' }}>
          <span className="mono">{r.claim.ref}</span> · {r.policyLabel}
        </span>
      </>
    ),
    phone: 'title',
  },
  { id: 'company', label: 'Company', value: (r) => r.companyName, phone: 'sub' },
  {
    id: 'incident',
    label: 'Incident',
    value: (r) => r.claim.incidentOn,
    sort: 'date',
    render: (r) => (
      <>
        {dateLabel(r.claim.incidentOn)}
        <span className="bz-sub" style={{ display: 'block' }}>
          {r.claim.notifiedOn ? `insurer told ${dateLabel(r.claim.notifiedOn)}` : `${r.sinceIncident} days and the insurer is not told`}
        </span>
      </>
    ),
    hideBelow: 1100,
  },
  {
    id: 'status',
    label: 'Status',
    value: (r) => CLAIM_STATUS[r.claim.status].label,
    translate: true,
    render: (r) => (
      <span className="bz-chips">
        <Chip tone={CLAIM_STATUS[r.claim.status].tone}>{CLAIM_STATUS[r.claim.status].label}</Chip>
        {!r.covered && <Chip tone="warn">Outside cover dates</Chip>}
      </span>
    ),
  },
  {
    id: 'claimed',
    label: 'Amount',
    value: (r) => r.claim.amountClaimed,
    sort: 'money',
    render: (r) => (
      <>
        {rm(r.claim.amountClaimed)} <span className="bz-sub">claimed</span>
        {r.claim.settledAmount !== null && (
          <span className="bz-sub" style={{ display: 'block' }}>
            {rm(r.claim.settledAmount)} paid {dateLabel(r.claim.settledOn)}
          </span>
        )}
      </>
    ),
  },
];
const CLAIM_FILTERS: DtFilter<ClaimRow>[] = [
  { id: 'status', label: 'Status', value: (r) => r.claim.status, options: (Object.keys(CLAIM_STATUS) as ClaimRow['claim']['status'][]).map((k) => ({ value: k, label: CLAIM_STATUS[k].label })) },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
  {
    id: 'covered',
    label: 'Cover dates',
    value: (r) => (r.covered ? 'in' : 'out'),
    options: [
      { value: 'in', label: 'Within cover dates' },
      { value: 'out', label: 'Outside cover dates' },
    ],
  },
];

function Claims({ data }: { data: Insurance }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.claims.find((r) => r.claim.id === openId) ?? null;
  return (
    <Card
      title="Claims"
      sub={`Tell the insurer within ${data.rules.noticeDays} days of the incident; chase after ${data.rules.claimAge} days`}
      actions={<><ImportFor kind="insuranceClaim" /><AddFor kind="insuranceClaim" label="Add claim" /></>}
      flush
    >
      <DataTable
        label="Claims"
        stateKey="insurance.claims"
        rows={data.claims}
        rowKey={(r) => r.claim.id}
        columns={CLAIM_COLUMNS}
        filters={CLAIM_FILTERS}
        searchText={(r) => `${r.claim.ref} ${r.policyLabel} ${r.claim.insurerRef ?? ''}`}
        rowTone={(r) => stripe(CLAIM_STATUS[r.claim.status].tone)}
        rowEnd={(r) => (
          <>
            <button className="btn btn-sm" onClick={() => setOpenId(r.claim.id)}>
              Steps
            </button>
            {r.claim.status === 'to_notify' && <RecordButton kind="insuranceClaim" id={r.claim.id} />}
          </>
        )}
        empty={<Empty title="No claims." action={<AddFor kind="insuranceClaim" label="Record claim" />} />}
      />
      {open && <ClaimDrawer row={open} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

type ClaimRow = Insurance['claims'][number];

const CLAIM_STEPS = ['Insurer told', 'Documents', 'Adjuster assessing', 'Offer', 'Settled'];
const CLAIM_AT: Record<ClaimRow['claim']['status'], number> = { to_notify: 0, notified: 1, documents: 1, assessing: 2, offered: 3, settled: 5, rejected: -1 };

/** Where a claim is: the steps it has passed and the one it waits on. */
function claimSteps(c: ClaimRow['claim']): { label: string; state: StepState }[] {
  if (c.status === 'rejected') return [{ label: CLAIM_STEPS[0], state: c.notifiedOn ? 'done' : 'todo' }, { label: 'Rejected', state: 'stopped' }];
  const at = CLAIM_AT[c.status];
  return CLAIM_STEPS.map((label, i) => ({ label, state: i < at ? 'done' : i === at ? 'now' : 'todo' }));
}

/** Masterplan 61: each claim step is recorded by a person with its reference. Prima never contacts the insurer. */
function ClaimDrawer({ row: r, onClose }: { row: ClaimRow; onClose: () => void }) {
  const act = useAction();
  const c = r.claim;
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const input = (k: string, label: string, type = 'text') => (
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" type={type} aria-label={label} placeholder={type === 'date' ? undefined : label} value={f[k] ?? ''} onChange={set(k)} />
    </label>
  );
  const step = (action: string, body: Record<string, unknown>, done: string) => act.run(() => api.insuranceClaimAct(c.id, action, body), done).then((x) => x !== undefined && setF({}));
  const keep = r.can.keep;
  const s = CLAIM_STATUS[c.status];
  const facts: [string, string][] = [['Claimed', rm(c.amountClaimed)]];
  if (c.insurerRef) facts.push(['Insurer reference', `${c.insurerRef} (${c.notifyHow})`]);
  if (c.offer) facts.push(['Offer', `${rm(c.offer.amount)} · ${c.offer.ref}`]);
  if (c.accepted) facts.push(['Accepted by', `${c.accepted.by}: ${c.accepted.note}`]);
  if (c.received) facts.push(['Money received', `${dateLabel(c.received.on)} · ${c.received.bankRef} · ${c.received.by}`]);
  if (c.rejection) facts.push(['Rejected', `${c.rejection.reason} (${c.rejection.ref})`]);
  if (c.appeal) facts.push(['Appeal', c.appeal.reason]);
  return (
    <Drawer title={c.ref} sub={`${r.companyName} · ${r.policyLabel}`} onClose={onClose}>
      <div className="bz-chips">
        <Chip tone={s.tone}>{s.label}</Chip>
      </div>
      <Steps steps={claimSteps(c)} />
      <p className="bz-note">Staff record each step with its reference. Prima does not contact the insurer, accept offers by itself or receive money.</p>
      {!r.covered && (
        <div className="notice" data-tone="warn">
          The incident date is outside the policy period. Check cover with the insurer or broker.
        </div>
      )}
      <div className="bz-facts">
        <Facts items={facts} />
      </div>
      {(c.status === 'notified' || c.status === 'documents') && (
        <section className="bz-sec">
          <h3>Documents</h3>
          {(c.docs ?? []).length > 0 && (
            <ul className="bz-in-docs">
              {(c.docs ?? []).map((d) => (
                <li key={d.name}>
                  <span>{d.name}</span>
                  <span className="bz-sub">{d.ref}</span>
                </li>
              ))}
            </ul>
          )}
          {r.missingDocs.length > 0 && <div className="notice" data-tone="info">Usually still needed: {r.missingDocs.join(', ')}. The insurer&apos;s own list wins.</div>}
        </section>
      )}
      {keep && c.status === 'to_notify' && (
        <div className="bz-act">
          {input('on', 'Date the insurer was told', 'date')}
          {input('insurerRef', 'Insurer claim reference')}
          {input('how', 'How (email, letter, portal, broker)')}
          <div className="bz-actions">
            <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('notify', { on: f.on, insurerRef: f.insurerRef, how: f.how }, 'Recorded: insurer told.')}>
              Record insurer told
            </button>
          </div>
        </div>
      )}
      {keep && (c.status === 'notified' || c.status === 'documents') && (
        <div className="bz-act">
          <label className="field">
            <span className="label">Document</span>
            <Select className="select" aria-label="Document" value={f.name ?? ''} onChange={set('name')}>
              <option value="">Choose or type a document</option>
              {r.typicalDocs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </label>
          {input('name', 'Document name')}
          {input('ref', 'Document reference or file number')}
          <div className="bz-actions">
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('add_doc', { name: f.name, ref: f.ref }, 'Document added.')}>
              Add document
            </button>
          </div>
          {c.status === 'documents' && (
            <>
              {input('on', 'Date documents went to the insurer', 'date')}
              <div className="bz-actions">
                <button className="btn btn-primary btn-sm" disabled={act.busy || r.missingDocs.length > 0} onClick={() => step('submit', { on: f.on }, 'Sent for assessment.')}>
                  Sent for assessment
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {keep && c.status === 'assessing' && (
        <div className="bz-act">
          {input('amount', 'Amount offered (RM)')}
          {input('ref', 'Offer or discharge letter reference')}
          {input('on', 'Offer date', 'date')}
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy}
              onClick={() => step('offer', { amount: Number(f.amount), ref: f.ref, on: f.on }, 'Offer recorded. The company manager accepts it.')}
            >
              Record offer
            </button>
          </div>
        </div>
      )}
      {r.can.accept && c.status === 'offered' && !c.accepted && (
        <div className="bz-act">
          {input('note', 'Comment (why the company accepts)')}
          <div className="bz-actions">
            <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('accept', { note: f.note }, 'Offer accepted. Finance records the money when it arrives.')}>
              Accept offer for the company
            </button>
          </div>
        </div>
      )}
      {r.can.receive && c.status === 'offered' && c.accepted && (
        <div className="bz-act">
          {input('bankRef', 'Bank statement reference')}
          {input('on', 'Date money reached the bank', 'date')}
          <div className="bz-actions">
            <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('received', { bankRef: f.bankRef, on: f.on }, 'Money received recorded. Claim settled.')}>
              Record money received
            </button>
          </div>
        </div>
      )}
      {keep && ['notified', 'documents', 'assessing', 'offered'].includes(c.status) && !c.accepted && (
        <details className="bz-in-details">
          <summary>Insurer rejected the claim</summary>
          <div className="bz-act">
            {input('reason', "Insurer's reason")}
            {input('ref', 'Letter reference')}
            {input('on', 'Date', 'date')}
            <div className="bz-actions">
              <button className="btn btn-sm" disabled={act.busy} onClick={() => step('reject', { reason: f.reason, ref: f.ref, on: f.on }, 'Rejection recorded.')}>
                Record rejection
              </button>
            </div>
          </div>
        </details>
      )}
      {r.can.accept && c.status === 'rejected' && !c.appeal && (
        <div className="bz-act">
          {input('reason', 'Grounds for appeal')}
          <div className="bz-actions">
            <button className="btn btn-sm" disabled={act.busy} onClick={() => step('appeal', { reason: f.reason }, 'Appeal recorded.')}>
              Appeal (once)
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <section className="bz-sec">
        <h3>History</h3>
        {(c.steps ?? []).length === 0 && <p className="bz-note">No steps recorded yet.</p>}
        <ul className="bz-ct-tl">
          {(c.steps ?? []).map((s, i) => (
            <li key={i}>
              <span className="bz-ct-tl-top">
                <strong>{s.what}</strong>
                <time className="bz-sub">{dateTimeLabel(s.at)}</time>
              </span>
              <span className="bz-row-meta">
                {s.by}
                {s.note ? `: ${s.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Drawer>
  );
}

type GuaranteeRow = Insurance['guarantees'][number];

/** P107: the guarantees as a data table: guarantee, beneficiary and contract, issuer and fee, company, amount, validity, state. */
const GUARANTEE_COLUMNS: DtColumn<GuaranteeRow>[] = [
  { id: 'label', label: 'Guarantee', value: (r) => r.label, render: (r) => <strong>{r.label}</strong>, phone: 'title' },
  {
    id: 'beneficiary',
    label: 'Beneficiary',
    value: (r) => r.guarantee.beneficiary,
    render: (r) => (
      <>
        To {r.guarantee.beneficiary} · {r.guarantee.contractRef}
      </>
    ),
    phone: 'sub',
  },
  {
    id: 'issuer',
    label: 'Issuer',
    value: (r) => r.guarantee.issuer,
    render: (r) => (
      <span className="bz-sub">
        By {r.guarantee.issuer} · fee {rm(r.guarantee.fee)}
        {r.guarantee.releasedOn ? ` · released ${dateLabel(r.guarantee.releasedOn)}` : ''}
      </span>
    ),
    hideBelow: 1200,
    phone: 'hidden',
  },
  { id: 'company', label: 'Company', value: (r) => r.companyName, hideBelow: 1100 },
  { id: 'amount', label: 'Amount', value: (r) => r.guarantee.amount, sort: 'money', render: (r) => rm(r.guarantee.amount) },
  {
    id: 'valid',
    label: 'Expires on',
    value: (r) => r.guarantee.expiresOn,
    sort: 'date',
    render: (r) => (
      <>
        <span>Valid to {dateLabel(r.guarantee.expiresOn)}</span>
        <span className="bz-sub" style={{ display: 'block' }}>
          Contract to {dateLabel(r.guarantee.contractEndsOn)}
        </span>
      </>
    ),
  },
  { id: 'state', label: 'Status', value: (r) => GUARANTEE_STATE[r.state].label, translate: true, render: (r) => <Chip tone={GUARANTEE_STATE[r.state].tone}>{GUARANTEE_STATE[r.state].label}</Chip> },
];
const GUARANTEE_FILTERS: DtFilter<GuaranteeRow>[] = [
  { id: 'state', label: 'Status', value: (r) => r.state, options: (Object.keys(GUARANTEE_STATE) as GuaranteeRow['state'][]).map((k) => ({ value: k, label: GUARANTEE_STATE[k].label })) },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
];

function Guarantees({ data }: { data: Insurance }) {
  return (
    <Card
      title="Guarantees and bonds"
      sub="Must stay valid until the contract ends; ask for release after"
      actions={<><ImportFor kind="insuranceGuarantee" /><AddFor kind="insuranceGuarantee" label="Add guarantee" /></>}
      flush
    >
      <DataTable
        label="Guarantees and bonds"
        stateKey="insurance.guarantees"
        rows={data.guarantees}
        rowKey={(r) => r.guarantee.id}
        columns={GUARANTEE_COLUMNS}
        filters={GUARANTEE_FILTERS}
        searchText={(r) => `${r.guarantee.contractRef} ${r.guarantee.issuer}`}
        rowTone={(r) => stripe(GUARANTEE_STATE[r.state].tone)}
        rowEnd={(r) => <RecordButton kind="insuranceGuarantee" id={r.guarantee.id} />}
        empty={<Empty title="No guarantees." action={<AddFor kind="insuranceGuarantee" label="Add guarantee" />} />}
      />
    </Card>
  );
}

/** Adds for the company chosen at the top of the screen. */
function AddFor({ kind, label, primary = false }: { kind: 'insurancePolicy' | 'insuranceClaim' | 'insuranceGuarantee'; label: string; primary?: boolean }) {
  const { companyId, company } = useApp();
  return <RecordButton kind={kind} companyId={companyId} label={company ? `${label} (${company.code})` : label} primary={primary} />;
}

/** P81: Import next to Add on each tab; the company chosen at the top, or chosen in the drawer. */
function ImportFor({ kind }: { kind: 'insurancePolicy' | 'insuranceClaim' | 'insuranceGuarantee' }) {
  const { companyId } = useApp();
  return <ImportButton kind={kind} companyId={companyId} />;
}

type CompanyRow = Insurance['rows'][number];
type CoverState = 'unknown' | 'gaps' | 'due' | 'ok';

const coverState = (r: CompanyRow): CoverState => (!r.hasDetail ? 'unknown' : r.missing.length + r.lapsed ? 'gaps' : r.expiring ? 'due' : 'ok');
const COVER_TONE: Record<CoverState, Tone> = { unknown: 'unknown', gaps: 'crit', due: 'warn', ok: 'ok' };
const COVER_OPTIONS: { value: CoverState; label: string }[] = [
  { value: 'gaps', label: 'Cover gaps' },
  { value: 'due', label: 'Renewals due' },
  { value: 'ok', label: 'Covered' },
  { value: 'unknown', label: 'Unknown' },
];
const COMPANY_FILTERS: DtFilter<CompanyRow>[] = [{ id: 'cover', label: 'Cover', value: coverState, options: COVER_OPTIONS }];

/** P107: the companies as a data table: company (with what is missing), counts and amounts, other cover watched, cover state. */
function companyColumns(armedCoverOnArmsBoard: boolean): DtColumn<CompanyRow>[] {
  const known = (r: CompanyRow, v: number | undefined) => (r.hasDetail ? (v ?? null) : null);
  return [
    {
      id: 'company',
      label: 'Company',
      value: (r) => r.company.name,
      render: (r) => (
        <>
          <strong>{r.company.name}</strong>
          {!r.hasDetail && (
            <span className="bz-row-meta" style={{ display: 'block' }}>
              Unknown: insurance records not loaded yet
            </span>
          )}
          {r.hasDetail &&
            r.missing.map((m) => (
              <span key={m.kind} className="bz-in-missing" style={{ display: 'block' }}>
                No {m.label.toLowerCase()}: {m.why}
              </span>
            ))}
        </>
      ),
      phone: 'title',
    },
    { id: 'policies', label: 'Policies', value: (r) => known(r, r.policies), sort: 'number' },
    {
      id: 'premiums',
      label: 'Premiums',
      value: (r) => known(r, r.premiumYear),
      sort: 'money',
      render: (r) =>
        r.hasDetail ? (
          <>
            {rm(r.premiumYear)} <span className="bz-sub">a year</span>
          </>
        ) : (
          '–'
        ),
    },
    { id: 'claims', label: 'Claims open', value: (r) => known(r, r.claimsOpen), sort: 'number', hideBelow: 1100 },
    { id: 'guarantees', label: 'Guarantees', value: (r) => known(r, r.guaranteesLive), sort: 'money', render: (r) => (r.hasDetail ? rm(r.guaranteesLive) : '–'), hideBelow: 1100 },
    {
      id: 'other',
      label: 'Other cover',
      sort: false,
      render: (r) =>
        r.hasDetail ? (
          <span className="bz-row-meta">
            Group insurance licence:{' '}
            {r.groupLicence
              ? r.groupLicence.status === 'OK'
                ? 'valid'
                : r.groupLicence.status === 'DUE'
                  ? `due in ${r.groupLicence.daysLeft} days`
                  : r.groupLicence.status === 'OVERDUE'
                    ? 'expired'
                    : 'unknown'
              : 'unknown'}{' '}
            · Foreign worker insurance: {r.fwInsured} workers, {r.fwDue} due or unknown ·{' '}
            {armedCoverOnArmsBoard
              ? 'Armed-service and cash-in-transit cover: checked on the Arms Control board'
              : `Armed-service cover: ${r.armsInsurance} client agreements, ${r.armsInsuranceDue} due or unknown`}
          </span>
        ) : (
          '–'
        ),
      hideBelow: 1300,
      phone: 'sub',
    },
    {
      id: 'cover',
      label: 'Cover',
      value: (r) => COVER_OPTIONS.find((o) => o.value === coverState(r))!.label,
      translate: true,
      render: (r) => {
        if (!r.hasDetail) return <Chip tone="unknown">Unknown</Chip>;
        const gaps = r.missing.length + r.lapsed;
        return <Chip tone={COVER_TONE[coverState(r)]}>{gaps ? `${gaps} cover gap${gaps === 1 ? '' : 's'}` : r.expiring ? 'Renewals due' : 'Covered'}</Chip>;
      },
    },
  ];
}

function Companies({ data }: { data: Insurance }) {
  return (
    <Card title="By company" sub="Also shows insurance watched on other screens: group insurance licence, foreign worker and armed-service cover" flush>
      <DataTable
        label="By company"
        stateKey="insurance.companies"
        rows={data.rows}
        rowKey={(r) => r.company.id}
        columns={companyColumns(data.armedCoverOnArmsBoard)}
        filters={COMPANY_FILTERS}
        phoneFacts={5}
        rowTone={(r) => (r.hasDetail ? stripe(COVER_TONE[coverState(r)]) : undefined)}
        rowEnd={(r) => (!r.hasDetail ? <RecordButton kind="insurancePolicy" companyId={r.company.id} label="Add policy" /> : null)}
      />
    </Card>
  );
}

/** The steps on a policy year: renew (adds next year's record) or cancel (kept as history with the reason). P107: the
 *  buttons sit at the row's end and the chosen form opens under the row (the table holds which one is open). */
function PolicySteps({ r, open, onOpen }: { r: PolicyRow; open: 'renew' | 'cancel' | null; onOpen: (s: 'renew' | 'cancel') => void }) {
  if (r.renewedBy || open) return null;
  return (
    <span className="bz-actions">
      {r.cover.status !== 'OK' && (
        <button className="btn btn-sm" onClick={() => onOpen('renew')}>
          Renew
        </button>
      )}
      <button className="btn btn-ghost btn-sm" onClick={() => onOpen('cancel')}>
        Cancel policy
      </button>
    </span>
  );
}

const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
const plusYear = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCFullYear(t.getUTCFullYear() + 1);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

function RenewForm({ r, onDone }: { r: PolicyRow; onDone: () => void }) {
  const p = r.policy;
  const start = nextDay(p.expiresOn);
  const [f, setF] = useState<InsuranceRenewInput>({
    insurer: p.insurer,
    broker: p.broker,
    policyNo: '',
    sumInsured: p.sumInsured,
    premium: p.premium,
    startsOn: start,
    expiresOn: plusYear(start),
    premiumDueOn: start,
    scheduleRef: null,
  });
  const act = useAction();
  // "Isi automatik" (rule KEY-IN): the new policy's number, dates and premium are read from the policy paper and wait
  // for the person's check. The values carried over from this year count as empty until the person changes them.
  const [checked, setChecked] = useState(true);
  const [touched, setTouched] = useState<Partial<Record<keyof InsuranceRenewInput, boolean>>>({});
  const set = (x: Partial<InsuranceRenewInput>) => {
    setF((was) => ({ ...was, ...x }));
    setTouched((was) => ({ ...was, ...Object.fromEntries(Object.keys(x).map((k) => [k, true])) }));
  };
  return (
    <div className="bz-act">
      <p className="bz-sub">Next year's policy is added as a new record. This year's stays on the register as history.</p>
      <div className="bz-form">
        <label className="field">
          <span className="label">Insurer</span>
          <input className="input" value={f.insurer} onChange={(e) => set({ insurer: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Broker</span>
          <input className="input" value={f.broker ?? ''} onChange={(e) => set({ broker: e.target.value || null })} />
        </label>
        <label className="field">
          <span className="label">New policy number</span>
          <input className="input" value={f.policyNo} onChange={(e) => set({ policyNo: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Sum insured (RM)</span>
          <input className="input" type="number" min={1} value={f.sumInsured} onChange={(e) => set({ sumInsured: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="label">Premium (RM)</span>
          <input className="input" type="number" min={0} value={f.premium} onChange={(e) => set({ premium: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="label">Starts on</span>
          <input className="input" type="date" value={f.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Expires on</span>
          <input className="input" type="date" value={f.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Premium due on</span>
          <input className="input" type="date" value={f.premiumDueOn} onChange={(e) => set({ premiumDueOn: e.target.value })} />
        </label>
        <label className="field bz-span">
          <span className="label">Policy schedule kept at</span>
          <input className="input" placeholder="Document name or link" value={f.scheduleRef ?? ''} onChange={(e) => set({ scheduleRef: e.target.value || null })} />
        </label>
      </div>
      <KeyIn
        paper="insurance"
        typed={{ ref: f.policyNo, startsOn: touched.startsOn ? f.startsOn : '', expiresOn: touched.expiresOn ? f.expiresOn : '', amount: touched.premium ? f.premium : '' }}
        onFields={(read, ok) => {
          setChecked(ok);
          const x: Partial<InsuranceRenewInput> = {};
          for (const r of read) {
            if (r.value == null || r.value === '') continue;
            if (r.name === 'ref') x.policyNo = String(r.value);
            if (r.name === 'startsOn' && typeof r.value === 'string') x.startsOn = r.value;
            if (r.name === 'expiresOn' && typeof r.value === 'string') x.expiresOn = r.value;
            if (r.name === 'amount' && typeof r.value === 'number') x.premium = r.value;
          }
          set(x);
        }}
      />
      <ErrorNotice error={act.error} />
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !checked || !f.insurer.trim() || !f.policyNo.trim()}
          onClick={() => act.run(() => api.renewInsurancePolicy(p.id, f), 'Renewed. Next year is on the register.').then((x) => x && onDone())}
        >
          Save renewal
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Back
        </button>
      </div>
    </div>
  );
}

function CancelForm({ policyId, onDone }: { policyId: string; onDone: () => void }) {
  const [on, setOn] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  return (
    <div className="bz-act">
      <div className="bz-form">
        <label className="field">
          <span className="label">Cancelled from</span>
          <input className="input" type="date" max={new Date().toLocaleDateString('en-CA')} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Reason</span>
          <input className="input" placeholder="Why it is cancelled" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-actions">
        <button
          className="btn btn-sm"
          disabled={act.busy || !on || reason.trim().length < 5}
          onClick={() => act.run(() => api.cancelInsurancePolicy(policyId, { on, reason }), 'Policy cancelled and kept as history.').then((x) => x && onDone())}
        >
          Confirm cancel
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Premium paid: the date and Finance's payment reference. A date on its own is not proof of payment. P107: the
 *  Record payment button sits at the row's end; this form opens under the row. */
function PremiumForm({ policyId, onClose }: { policyId: string; onClose: () => void }) {
  const [paidOn, setPaidOn] = useState('');
  const [ref, setRef] = useState('');
  const act = useAction();
  return (
    <div className="bz-act">
      <label className="field">
        <span className="label">Date paid</span>
        <input className="input" type="date" max={new Date().toLocaleDateString('en-CA')} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Payment reference</span>
        <input className="input" placeholder="Finance payment reference" value={ref} onChange={(e) => setRef(e.target.value)} />
      </label>
      <ErrorNotice error={act.error} />
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !paidOn || ref.trim().length < 3}
          onClick={() => act.run(() => api.recordInsurancePremium(policyId, { paidOn, ref }), 'Premium recorded as paid.').then((x) => x && onClose())}
        >
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
}

type HistoryRow = Insurance['history'][number];

/** P107: past policy years as a data table: policy (and why it was cancelled), insurer, dates, premium, company, why it ended. */
const HISTORY_COLUMNS: DtColumn<HistoryRow>[] = [
  {
    id: 'policy',
    label: 'Policy',
    value: (r) => r.label,
    render: (r) => (
      <>
        <strong>{r.label}</strong>
        {r.policy.cancelled && (
          <span className="bz-row-meta" style={{ display: 'block' }}>
            Cancelled from {dateLabel(r.policy.cancelled.on)} by {r.policy.cancelled.by}: {r.policy.cancelled.reason}
          </span>
        )}
      </>
    ),
    phone: 'title',
  },
  {
    id: 'insurer',
    label: 'Insurer',
    value: (r) => r.policy.insurer,
    render: (r) => (
      <>
        {r.policy.insurer} · <span className="mono">{r.policy.policyNo}</span>
      </>
    ),
    phone: 'sub',
  },
  {
    id: 'dates',
    label: 'Dates',
    value: (r) => r.policy.expiresOn,
    sort: 'date',
    render: (r) => (
      <span className="bz-sub">
        {dateLabel(r.policy.startsOn)} to {dateLabel(r.policy.expiresOn)}
      </span>
    ),
    hideBelow: 1100,
  },
  {
    id: 'premium',
    label: 'Premium',
    value: (r) => r.policy.premium,
    sort: 'money',
    render: (r) => (
      <>
        {rm(r.policy.premium)}
        {r.policy.premiumPayment ? <span className="bz-sub" style={{ display: 'block' }}>{`paid ref ${r.policy.premiumPayment.ref}`}</span> : null}
      </>
    ),
  },
  { id: 'company', label: 'Company', value: (r) => r.companyName, hideBelow: 1200 },
  { id: 'why', label: 'Why', value: (r) => (r.why === 'cancelled' ? 'Cancelled' : 'Renewed'), translate: true, render: (r) => <Chip tone="neutral">{r.why === 'cancelled' ? 'Cancelled' : 'Renewed'}</Chip> },
];
const HISTORY_FILTERS: DtFilter<HistoryRow>[] = [
  {
    id: 'why',
    label: 'Why',
    value: (r) => (r.why === 'cancelled' ? 'cancelled' : 'renewed'),
    options: [
      { value: 'renewed', label: 'Renewed' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  { id: 'company', label: 'Company', value: (r) => r.companyName },
];

/** Policy years that ended by renewal, and cancelled policies: kept on the register, no longer counted as cover. */
function History({ data }: { data: Insurance }) {
  return (
    <Card title="History" sub="Renewed and cancelled policies stay on the register" flush>
      <DataTable
        label="History"
        stateKey="insurance.history"
        rows={data.history}
        rowKey={(r) => r.policy.id}
        columns={HISTORY_COLUMNS}
        filters={HISTORY_FILTERS}
        searchText={(r) => `${r.policy.policyNo} ${r.policy.premiumPayment?.ref ?? ''}`}
        empty={<Empty title="No past policies yet." />}
      />
    </Card>
  );
}
