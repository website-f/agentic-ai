import { Select } from '../SearchSelect';
import { useState } from 'react';
import { BuildingsIcon, CoinsIcon, FileTextIcon, ScalesIcon, ShieldWarningIcon, UmbrellaIcon } from '@phosphor-icons/react';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { api, type Insurance, type InsuranceRenewInput } from '../api';
import { useApp } from '../App';
import { Card, Empty, Facts, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, ExpiryChip, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
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
  const [tab, setTab] = useState<Tab>('alerts');
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
            <AddFor kind="insurancePolicy" label="Add policy" primary />
            <AddFor kind="insuranceClaim" label="Record claim" />
            <AddFor kind="insuranceGuarantee" label="Add guarantee" />
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
          note={`${t.premiumsOverdue} overdue, ${t.premiumsDue} due in ${data.rules.premiumDays} days`}
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

function Alerts({ data }: { data: Insurance }) {
  return (
    <Card title="To chase" sub="Most urgent first" flush>
      {data.alerts.length === 0 ? (
        <Empty title="Nothing to chase." />
      ) : (
        <ul className="bz-rows">
          {data.alerts.map((a, i) => (
            <li key={i} className="bz-row" data-tone={stripe(a.tone)}>
              <span className="bz-row-main">
                <span className="bz-row-title">{a.title}</span>
                <span className="bz-row-meta">{a.detail}</span>
                <span className="bz-in-co">{a.companyName}</span>
              </span>
              <span className="bz-row-side">
                <Chip tone={a.tone}>{a.kind}</Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Policies({ data }: { data: Insurance }) {
  return (
    <Card title="Policies" sub={`Renewal starts ${data.rules.renewDays} days before expiry`} actions={<><ImportFor kind="insurancePolicy" /><AddFor kind="insurancePolicy" label="Add policy" /></>} flush>
      {data.policies.length === 0 ? (
        <Empty title="No policies recorded." action={<AddFor kind="insurancePolicy" label="Add policy" primary />} />
      ) : (
        <ul className="bz-rows">
          {data.policies.map((r) => (
            <li key={r.policy.id} className="bz-row bz-in-row">
              <span className="bz-row-main">
                <span className="bz-row-title">{r.label}</span>
                <span className="bz-row-meta">
                  {r.policy.insurer} · <span className="mono">{r.policy.policyNo}</span>
                  {r.policy.broker ? ` · via ${r.policy.broker}` : ''}
                </span>
                <span className="bz-row-meta">
                  {r.policy.scheduleRef ? `Schedule: ${r.policy.scheduleRef}` : 'Policy schedule not on file'}
                  {r.renewedBy ? ` · renewed as ${r.renewedBy.policyNo} from ${dateLabel(r.renewedBy.startsOn)}` : ''}
                </span>
                <span className="bz-row-meta">{r.companyName}</span>
                {r.canAct && <PolicySteps r={r} />}
              </span>
              <span className="bz-in-fig">
                <span className="bz-sub">Cover</span>
                <span className="bz-amt">{rm(r.policy.sumInsured)}</span>
                <span className="bz-sub">
                  {dateLabel(r.policy.startsOn)} to {dateLabel(r.policy.expiresOn)}
                </span>
              </span>
              <span className="bz-in-fig">
                <span className="bz-sub">Premium</span>
                <span className="bz-amt">{rm(r.policy.premium)}</span>
                <span className="bz-sub">a year</span>
              </span>
              <span className="bz-row-side">
                <ExpiryChip status={r.cover.status} daysLeft={r.cover.daysLeft} />
                {r.cover.status === 'DUE' && (
                  <span className="bz-sub">
                    renewal {r.policy.renewal === 'renewed' ? 'done' : r.policy.renewal === 'quotes' ? 'quotes in hand' : 'not started'}
                  </span>
                )}
                {!r.renewedBy && <RecordButton kind="insurancePolicy" id={r.policy.id} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Premiums({ data }: { data: Insurance }) {
  const rows = [...data.policies].sort((a, b) => a.policy.premiumDueOn.localeCompare(b.policy.premiumDueOn));
  const order = { overdue: 0, due: 1, later: 2, paid: 3 } as const;
  rows.sort((a, b) => order[a.premium] - order[b.premium]);
  const groups = (Object.keys(order) as (keyof typeof order)[]).map((k) => ({ k, rows: rows.filter((r) => r.premium === k) })).filter((g) => g.rows.length);
  return (
    <Card title="Premiums" sub="Cash before cover: an unpaid premium can leave the company without cover" flush>
      {rows.length === 0 && <Empty title="No policies recorded." />}
      {groups.map((g) => (
        <div key={g.k} className="bz-in-group">
          <div className="bz-in-group-head">
            <Chip tone={PREMIUM[g.k].tone}>{PREMIUM[g.k].label}</Chip>
            <span className="bz-sub">
              {g.rows.length} · <span className="bz-amt">{rm(g.rows.reduce((n, r) => n + r.policy.premium, 0))}</span>
            </span>
          </div>
          <ul className="bz-rows">
            {g.rows.map((r) => (
              <li key={r.policy.id} className="bz-row" data-tone={g.k === 'overdue' ? 'crit' : g.k === 'due' ? 'warn' : undefined}>
                <span className="bz-row-main">
                  <span className="bz-row-title">{r.label}</span>
                  <span className="bz-row-meta">
                    {r.policy.premiumPayment
                      ? `Paid ${dateLabel(r.policy.premiumPayment.on)}, ref ${r.policy.premiumPayment.ref}`
                      : r.policy.premiumPaidOn
                        ? `Paid ${dateLabel(r.policy.premiumPaidOn)}, no payment reference recorded`
                        : r.premiumDaysLeft < 0
                        ? `Was due ${dateLabel(r.policy.premiumDueOn)}, ${-r.premiumDaysLeft} days ago`
                        : `Due ${dateLabel(r.policy.premiumDueOn)}, in ${r.premiumDaysLeft} days`}{' '}
                    · {r.policy.insurer}
                  </span>
                  <span className="bz-row-meta">{r.companyName}</span>
                </span>
                <span className="bz-row-side">
                  <span className="bz-amt">{rm(r.policy.premium)}</span>
                  {r.paidWithoutRef && <Chip tone="warn">Paid, no reference</Chip>}
                  {r.canAct && r.premium !== 'paid' && <PremiumForm policyId={r.policy.id} />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

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
      {data.claims.length === 0 ? (
        <Empty title="No claims." action={<AddFor kind="insuranceClaim" label="Record claim" />} />
      ) : (
        <ul className="bz-rows">
          {data.claims.map((r) => {
            const s = CLAIM_STATUS[r.claim.status];
            return (
              <li key={r.claim.id} className="bz-row bz-in-claim" data-tone={stripe(s.tone)}>
                <span className="bz-row-main">
                  <span className="bz-row-title">{r.claim.what}</span>
                  <span className="bz-row-meta">
                    <span className="mono">{r.claim.ref}</span> · {r.policyLabel}
                  </span>
                  <span className="bz-row-meta">
                    Incident {dateLabel(r.claim.incidentOn)}
                    {r.claim.notifiedOn ? ` · insurer told ${dateLabel(r.claim.notifiedOn)}` : ` · ${r.sinceIncident} days and the insurer is not told`}
                  </span>
                  <span className="bz-row-meta">{r.companyName}</span>
                  <span className="bz-chips">
                    <Chip tone={s.tone}>{s.label}</Chip>
                    {!r.covered && <Chip tone="warn">Outside cover dates</Chip>}
                  </span>
                </span>
                <span className="bz-in-fig">
                  <span className="bz-amt">{rm(r.claim.amountClaimed)}</span>
                  <span className="bz-sub">claimed</span>
                  {r.claim.settledAmount !== null && (
                    <span className="bz-sub">
                      {rm(r.claim.settledAmount)} paid {dateLabel(r.claim.settledOn)}
                    </span>
                  )}
                </span>
                <span className="bz-row-side bz-in-claim-acts">
                  <button className="btn btn-sm" onClick={() => setOpenId(r.claim.id)}>
                    Steps
                  </button>
                  {r.claim.status === 'to_notify' && <RecordButton kind="insuranceClaim" id={r.claim.id} />}
                </span>
              </li>
            );
          })}
        </ul>
      )}
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

function Guarantees({ data }: { data: Insurance }) {
  return (
    <Card
      title="Guarantees and bonds"
      sub="Must stay valid until the contract ends; ask for release after"
      actions={<><ImportFor kind="insuranceGuarantee" /><AddFor kind="insuranceGuarantee" label="Add guarantee" /></>}
      flush
    >
      {data.guarantees.length === 0 ? (
        <Empty title="No guarantees." action={<AddFor kind="insuranceGuarantee" label="Add guarantee" />} />
      ) : (
        <ul className="bz-rows">
          {data.guarantees.map((r) => {
            const s = GUARANTEE_STATE[r.state];
            const g = r.guarantee;
            return (
              <li key={g.id} className="bz-row bz-in-row" data-tone={stripe(s.tone)}>
                <span className="bz-row-main">
                  <span className="bz-row-title">{r.label}</span>
                  <span className="bz-row-meta">
                    To {g.beneficiary} · {g.contractRef}
                  </span>
                  <span className="bz-row-meta">
                    By {g.issuer} · fee {rm(g.fee)}
                    {g.releasedOn ? ` · released ${dateLabel(g.releasedOn)}` : ''}
                  </span>
                  <span className="bz-row-meta">{r.companyName}</span>
                </span>
                <span className="bz-in-fig">
                  <span className="bz-sub">Amount</span>
                  <span className="bz-amt">{rm(g.amount)}</span>
                </span>
                <span className="bz-in-fig">
                  <span>Valid to {dateLabel(g.expiresOn)}</span>
                  <span className="bz-sub">Contract to {dateLabel(g.contractEndsOn)}</span>
                </span>
                <span className="bz-row-side">
                  <Chip tone={s.tone}>{s.label}</Chip>
                  <RecordButton kind="insuranceGuarantee" id={g.id} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
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

function Companies({ data }: { data: Insurance }) {
  return (
    <Card title="By company" sub="Also shows insurance watched on other screens: group insurance licence, foreign worker and armed-service cover" flush>
      <ul className="bz-rows">
        {data.rows.map((r) => {
          if (!r.hasDetail)
            return (
              <li key={r.company.id} className="bz-row">
                <span className="bz-row-main">
                  <span className="bz-row-title">{r.company.name}</span>
                  <span className="bz-row-meta">Unknown: insurance records not loaded yet</span>
                </span>
                <span className="bz-row-side">
                  <Chip tone="unknown">Unknown</Chip>
                  <RecordButton kind="insurancePolicy" companyId={r.company.id} label="Add policy" />
                </span>
              </li>
            );
          const gaps = r.missing.length + r.lapsed;
          const tone: Tone = gaps ? 'crit' : r.expiring ? 'warn' : 'ok';
          return (
            <li key={r.company.id} className="bz-row" data-tone={stripe(tone)}>
              <span className="bz-row-main">
                <span className="bz-row-title">{r.company.name}</span>
                <span className="bz-in-figs">
                  <span>
                    <strong>{r.policies}</strong> policies
                  </span>
                  <span>
                    <strong>{rm(r.premiumYear)}</strong> a year in premiums
                  </span>
                  <span>
                    <strong>{r.claimsOpen}</strong> claims open
                  </span>
                  <span>
                    <strong>{rm(r.guaranteesLive)}</strong> in guarantees
                  </span>
                </span>
                {r.missing.map((m) => (
                  <span key={m.kind} className="bz-in-missing">
                    No {m.label.toLowerCase()}: {m.why}
                  </span>
                ))}
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
                  {data.armedCoverOnArmsBoard
                    ? 'Armed-service and cash-in-transit cover: checked on the Arms Control board'
                    : `Armed-service cover: ${r.armsInsurance} client agreements, ${r.armsInsuranceDue} due or unknown`}
                </span>
              </span>
              <span className="bz-row-side">
                <Chip tone={tone}>{gaps ? `${gaps} cover gap${gaps === 1 ? '' : 's'}` : r.expiring ? 'Renewals due' : 'Covered'}</Chip>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The steps on a policy year: renew (adds next year's record) or cancel (kept as history with the reason). */
function PolicySteps({ r }: { r: PolicyRow }) {
  const [open, setOpen] = useState<'renew' | 'cancel' | null>(null);
  if (r.renewedBy) return null;
  return (
    <>
      {!open && (
        <span className="bz-actions">
          {r.cover.status !== 'OK' && (
            <button className="btn btn-sm" onClick={() => setOpen('renew')}>
              Renew
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen('cancel')}>
            Cancel policy
          </button>
        </span>
      )}
      {open === 'renew' && <RenewForm r={r} onDone={() => setOpen(null)} />}
      {open === 'cancel' && <CancelForm policyId={r.policy.id} onDone={() => setOpen(null)} />}
    </>
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
  const set = (x: Partial<InsuranceRenewInput>) => setF({ ...f, ...x });
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
      <ErrorNotice error={act.error} />
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !f.insurer.trim() || !f.policyNo.trim()}
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

/** Premium paid: the date and Finance's payment reference. A date on its own is not proof of payment. */
function PremiumForm({ policyId }: { policyId: string }) {
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState('');
  const [ref, setRef] = useState('');
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Record payment
      </button>
    );
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
          onClick={() => act.run(() => api.recordInsurancePremium(policyId, { paidOn, ref }), 'Premium recorded as paid.').then((x) => x && setOpen(false))}
        >
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Policy years that ended by renewal, and cancelled policies: kept on the register, no longer counted as cover. */
function History({ data }: { data: Insurance }) {
  return (
    <Card title="History" sub="Renewed and cancelled policies stay on the register" flush>
      {data.history.length === 0 ? (
        <Empty title="No past policies yet." />
      ) : (
        <ul className="bz-rows">
          {data.history.map((r) => (
            <li key={r.policy.id} className="bz-row">
              <span className="bz-row-main">
                <span className="bz-row-title">{r.label}</span>
                <span className="bz-row-meta">
                  {r.policy.insurer} · <span className="mono">{r.policy.policyNo}</span> · {dateLabel(r.policy.startsOn)} to {dateLabel(r.policy.expiresOn)} · premium{' '}
                  {rm(r.policy.premium)}
                  {r.policy.premiumPayment ? `, paid ref ${r.policy.premiumPayment.ref}` : ''}
                </span>
                {r.policy.cancelled && (
                  <span className="bz-row-meta">
                    Cancelled from {dateLabel(r.policy.cancelled.on)} by {r.policy.cancelled.by}: {r.policy.cancelled.reason}
                  </span>
                )}
                <span className="bz-row-meta">{r.companyName}</span>
              </span>
              <span className="bz-row-side">
                <Chip tone="neutral">{r.why === 'cancelled' ? 'Cancelled' : 'Renewed'}</Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
