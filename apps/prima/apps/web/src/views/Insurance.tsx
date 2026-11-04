import { useState } from 'react';
import { RecordButton } from './RecordForm';
import { api, type Insurance } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, ExpiryChip, Kpi, Loading, dateLabel, useLoad, type Tone } from '../ui';

type Tab = 'alerts' | 'policies' | 'premiums' | 'claims' | 'guarantees' | 'companies';

const TABS: { id: Tab; label: string }[] = [
  { id: 'alerts', label: 'To chase' },
  { id: 'policies', label: 'Policies' },
  { id: 'premiums', label: 'Premiums' },
  { id: 'claims', label: 'Claims' },
  { id: 'guarantees', label: 'Guarantees' },
  { id: 'companies', label: 'Companies' },
];

const rm = (v: number) => `RM ${v.toLocaleString('en-MY')}`;

const CLAIM_STATUS: Record<Insurance['claims'][number]['claim']['status'], { label: string; tone: Tone }> = {
  to_notify: { label: 'Insurer not told', tone: 'crit' },
  notified: { label: 'Insurer told', tone: 'info' },
  documents: { label: 'Sending documents', tone: 'info' },
  assessing: { label: 'Adjuster assessing', tone: 'info' },
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
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Insurance</h1>
          <p>
            Premiums, policies, claims and guarantees{group ? ' for every company' : ''}. The Chief of Staff's insurance section follows up; paying a premium,
            signing a guarantee or accepting a settlement stays with the company's board and Finance. A company with no records loaded shows Unknown, never as
            covered.
          </p>
        </div>
      </div>
      <div className="kpis">
        <Kpi
          label="Cover gaps"
          value={t.coverGaps + t.lapsed}
          tone={t.coverGaps + t.lapsed ? 'crit' : 'ok'}
          note={`${t.lapsed} lapsed, ${t.coverGaps} missing`}
        />
        <Kpi label="Renewals due" value={t.expiring} tone={t.expiring ? 'warn' : 'ok'} note={`Within ${data.rules.renewDays} days, not renewed`} />
        <Kpi
          label="Premiums to pay"
          value={rm(t.premiumUnpaid)}
          tone={t.premiumsOverdue ? 'crit' : t.premiumsDue ? 'warn' : 'ok'}
          note={`${t.premiumsOverdue} overdue, ${t.premiumsDue} due in ${data.rules.premiumDays} days`}
        />
        <Kpi label="Annual premiums" value={rm(t.premiumYear)} note="Companies with records" />
        <Kpi
          label="Claims open"
          value={t.claimsOpen}
          tone={t.claimsNotNotified ? 'crit' : t.claimsOpen ? 'info' : 'ok'}
          note={`${t.claimsNotNotified} insurer not told yet`}
        />
        <Kpi
          label="Guarantees out"
          value={rm(t.guaranteesLive)}
          tone={t.guaranteesAction ? 'warn' : 'ok'}
          note={`${t.guaranteesAction} to extend or release`}
        />
        {group && <Kpi label="Companies unknown" value={t.unknown} tone={t.unknown ? 'unknown' : 'ok'} note="No insurance records loaded" />}
      </div>
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
    </div>
  );
}

function Alerts({ data }: { data: Insurance }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>To chase</h2>
        <span className="muted small">Most urgent first</span>
      </div>
      <div className="list">
        {data.alerts.length === 0 && <div className="empty">Nothing to chase.</div>}
        {data.alerts.map((a, i) => (
          <div key={i} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="muted small">{a.detail}</div>
              <div className="small">{a.companyName}</div>
            </div>
            <Chip tone={a.tone}>{a.kind}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

function Policies({ data }: { data: Insurance }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Policies</h2>
        <span className="muted small">Renewal starts {data.rules.renewDays} days before expiry</span>
        <AddFor kind="insurancePolicy" label="Add policy" />
      </div>
      <div className="list">
        {data.policies.length === 0 && <div className="empty">No policies recorded.</div>}
        {data.policies.map((r) => (
          <div key={r.policy.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{r.label}</div>
              <div className="muted small">
                {r.policy.insurer} · {r.policy.policyNo}
                {r.policy.broker ? ` · via ${r.policy.broker}` : ''}
              </div>
              <div className="muted small">
                Cover {rm(r.policy.sumInsured)} · premium {rm(r.policy.premium)} a year · {dateLabel(r.policy.startsOn)} to {dateLabel(r.policy.expiresOn)}
                {r.cover.status === 'DUE'
                  ? ` · renewal ${r.policy.renewal === 'renewed' ? 'done' : r.policy.renewal === 'quotes' ? 'quotes in hand' : 'not started'}`
                  : ''}
              </div>
              <div className="small">{r.companyName}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <ExpiryChip status={r.cover.status} daysLeft={r.cover.daysLeft} />
              <RecordButton kind="insurancePolicy" id={r.policy.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Premiums({ data }: { data: Insurance }) {
  const rows = [...data.policies].sort((a, b) => a.policy.premiumDueOn.localeCompare(b.policy.premiumDueOn));
  const order = { overdue: 0, due: 1, later: 2, paid: 3 } as const;
  rows.sort((a, b) => order[a.premium] - order[b.premium]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Premiums</h2>
        <span className="muted small">Cash before cover: an unpaid premium can leave the company without cover</span>
      </div>
      <div className="list">
        {rows.map((r) => {
          const p = PREMIUM[r.premium];
          return (
            <div key={r.policy.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {rm(r.policy.premium)} · {r.label}
                </div>
                <div className="muted small">
                  {r.policy.premiumPaidOn
                    ? `Paid ${dateLabel(r.policy.premiumPaidOn)}`
                    : r.premiumDaysLeft < 0
                      ? `Was due ${dateLabel(r.policy.premiumDueOn)}, ${-r.premiumDaysLeft} days ago`
                      : `Due ${dateLabel(r.policy.premiumDueOn)}, in ${r.premiumDaysLeft} days`}{' '}
                  · {r.policy.insurer}
                </div>
                <div className="small">{r.companyName}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Chip tone={p.tone}>{p.label}</Chip>
                <RecordButton kind="insurancePolicy" id={r.policy.id} label="Record payment" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Claims({ data }: { data: Insurance }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Claims</h2>
        <span className="muted small">
          Tell the insurer within {data.rules.noticeDays} days of the incident; chase after {data.rules.claimAge} days
        </span>
        <AddFor kind="insuranceClaim" label="Add claim" />
      </div>
      <div className="list">
        {data.claims.length === 0 && <div className="empty">No claims.</div>}
        {data.claims.map((r) => {
          const s = CLAIM_STATUS[r.claim.status];
          return (
            <div key={r.claim.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{r.claim.what}</div>
                <div className="muted small">
                  {r.claim.ref} · {r.policyLabel} · {rm(r.claim.amountClaimed)} claimed
                  {r.claim.settledAmount !== null ? `, ${rm(r.claim.settledAmount)} paid ${dateLabel(r.claim.settledOn)}` : ''}
                </div>
                <div className="muted small">
                  Incident {dateLabel(r.claim.incidentOn)}
                  {r.claim.notifiedOn ? ` · insurer told ${dateLabel(r.claim.notifiedOn)}` : ` · ${r.sinceIncident} days and the insurer is not told`}
                </div>
                <div className="small">{r.companyName}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Chip tone={s.tone}>{s.label}</Chip>
                <RecordButton kind="insuranceClaim" id={r.claim.id} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Guarantees({ data }: { data: Insurance }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Guarantees and bonds</h2>
        <span className="muted small">Must stay valid until the contract ends; ask for release after</span>
        <AddFor kind="insuranceGuarantee" label="Add guarantee" />
      </div>
      <div className="list">
        {data.guarantees.length === 0 && <div className="empty">No guarantees.</div>}
        {data.guarantees.map((r) => {
          const s = GUARANTEE_STATE[r.state];
          const g = r.guarantee;
          return (
            <div key={g.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.label} {rm(g.amount)}
                </div>
                <div className="muted small">
                  To {g.beneficiary} · {g.contractRef}
                </div>
                <div className="muted small">
                  By {g.issuer} · fee {rm(g.fee)} · valid to {dateLabel(g.expiresOn)} · contract to {dateLabel(g.contractEndsOn)}
                  {g.releasedOn ? ` · released ${dateLabel(g.releasedOn)}` : ''}
                </div>
                <div className="small">{r.companyName}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Chip tone={s.tone}>{s.label}</Chip>
                <RecordButton kind="insuranceGuarantee" id={g.id} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Adds for the company chosen at the top of the screen. */
function AddFor({ kind, label }: { kind: 'insurancePolicy' | 'insuranceClaim' | 'insuranceGuarantee'; label: string }) {
  const { companyId, company } = useApp();
  return <RecordButton kind={kind} companyId={companyId} label={company ? `${label} (${company.code})` : label} />;
}

function Companies({ data }: { data: Insurance }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>By company</h2>
        <span className="muted small">Also shows insurance watched on other screens: group insurance licence, foreign worker and armed-service cover</span>
      </div>
      <div className="list">
        {data.rows.map((r) =>
          r.hasDetail ? (
            <div key={r.company.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 600 }}>{r.company.name}</div>
                <Chip tone={r.missing.length || r.lapsed ? 'crit' : r.expiring ? 'warn' : 'ok'}>
                  {r.missing.length || r.lapsed
                    ? `${r.missing.length + r.lapsed} cover gap${r.missing.length + r.lapsed === 1 ? '' : 's'}`
                    : r.expiring
                      ? 'Renewals due'
                      : 'Covered'}
                </Chip>
              </div>
              <div className="muted small">
                {r.policies} policies · {rm(r.premiumYear)} a year in premiums · {r.claimsOpen} claims open · {rm(r.guaranteesLive)} in guarantees
              </div>
              {r.missing.map((m) => (
                <div key={m.kind} className="small" style={{ color: 'var(--crit)' }}>
                  No {m.label.toLowerCase()}: {m.why}
                </div>
              ))}
              <div className="muted small">
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
                · Foreign worker insurance: {r.fwInsured} workers, {r.fwDue} due or unknown · Armed-service cover: {r.armsInsurance} client agreements,{' '}
                {r.armsInsuranceDue} due or unknown
              </div>
            </div>
          ) : (
            <div key={r.company.id} className="list-item">
              <div>
                <div>{r.company.name}</div>
                <div className="muted small">Unknown: insurance records not loaded yet</div>
              </div>
              <Chip tone="unknown">Unknown</Chip>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
