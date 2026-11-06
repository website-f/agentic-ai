import { useState } from 'react';
import { CalendarCheckIcon, HandshakeIcon, PlusIcon, ReceiptIcon, RocketLaunchIcon } from '@phosphor-icons/react';
import { BILLING_METHOD_LABEL, CMS_SERVICE_KINDS, MOB_WORKSTREAM_LABEL, type BillingMethod, type CmsServiceKind, type ContractState } from '@prima/core';
import { api, type ContractBoard } from '../api';
import { Card, Empty, Facts, PageHead, Search, Stat, Stats, Steps, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { useApp } from '../App';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import '../styles/biz.css';

/**
 * Contracts and site mobilisation (V3, V6 amendment). A signed contract or letter of award opens mobilisation against
 * 12 workstreams (W12 CMS activation, masterplan §191); the company manager signs the Site Ready-to-Operate Certificate once every critical item is done;
 * reviews follow at day 1, 7, 14 and 30. Billing follows the contract's method and changes only by a signed variation.
 */

type Row = ContractBoard['rows'][number];

const STATE: Record<ContractState, [Tone, string]> = {
  awarded: ['info', 'Awarded'],
  mobilising: ['warn', 'Mobilising'],
  ready: ['info', 'Ready to start'],
  active: ['ok', 'Live'],
  suspended: ['warn', 'Suspended'],
  terminated: ['neutral', 'Ended'],
};
const FILTERS = [
  ['attention', 'Needs attention'],
  ['mobilising', 'Mobilising'],
  ['live', 'Live'],
  ['all', 'All'],
] as const;
type Filter = (typeof FILTERS)[number][0];
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

export function ContractsView() {
  const { data, error } = useLoad(() => api.contracts(), []);
  const [filter, setFilter] = useState<Filter>('attention');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="contracts" />
      </div>
    );
  const needle = q.trim().toLowerCase();
  const rows = data.rows.filter(
    (r) =>
      (!needle || [r.contract.clientName, r.contract.ref, r.companyName].some((v) => v.toLowerCase().includes(needle))) &&
      (filter === 'attention'
        ? r.tone === 'crit' || r.tone === 'warn' || r.lastInvoice?.mismatch
        : filter === 'mobilising'
          ? ['awarded', 'mobilising', 'ready'].includes(r.contract.state)
          : filter === 'live'
            ? r.contract.state === 'active'
            : true),
  );
  const mobilising = data.rows.filter((r) => ['awarded', 'mobilising', 'ready'].includes(r.contract.state));
  const mismatch = data.rows.filter((r) => r.lastInvoice?.mismatch || (r.lastInvoice && r.lastInvoice.invoiced == null));
  const live = data.rows.filter((r) => r.contract.state === 'active');
  const reviewsDue = data.rows.reduce((n, r) => n + r.reviewsDue.length, 0);
  const row = data.rows.find((r) => r.contract.id === open) ?? null;
  const multi = new Set(data.rows.map((r) => r.contract.companyId)).size > 1;
  return (
    <div className="page">
      {adding && <NewContractForm options={data.canAdd} onDone={() => setAdding(false)} />}
      <PageHead
        title="Contracts"
        sub="Each site is mobilised against 12 workstreams (the 12th is CMS activation) and goes live only with the Site Ready-to-Operate Certificate. Reviews follow at day 1, 7, 14 and 30. The billing method changes only by a signed variation."
        actions={
          data.canAdd.length > 0 && (
            <>
              <ImportButton kind="contract" choices={data.canAdd.map((c): [string, string] => [c.companyId, c.companyName])} />
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <PlusIcon size={16} weight="bold" aria-hidden="true" />
                New contract
              </button>
            </>
          )
        }
      />
      <Stats>
        <Stat
          label="Live contracts"
          value={live.length}
          note={`${rm(live.reduce((n, r) => n + r.billing.total, 0))} a month`}
          icon={<HandshakeIcon size={16} />}
          tone="info"
          onClick={() => setFilter('live')}
        />
        <Stat
          label="Sites being mobilised"
          value={mobilising.length}
          tone={mobilising.some((r) => r.tone === 'crit') ? 'crit' : mobilising.length ? 'warn' : 'ok'}
          note={`${mobilising.filter((r) => r.daysToStart <= data.rule.startWarnDays).length} start within ${data.rule.startWarnDays} days`}
          icon={<RocketLaunchIcon size={16} />}
          onClick={() => setFilter('mobilising')}
        />
        <Stat label="Reviews due" value={reviewsDue} tone={reviewsDue ? 'warn' : 'ok'} icon={<CalendarCheckIcon size={16} />} onClick={() => setFilter('attention')} />
        <Stat
          label="Last month's invoice off or missing"
          value={mismatch.length}
          tone={mismatch.length ? 'warn' : 'ok'}
          note="Against the contract's billing"
          icon={<ReceiptIcon size={16} />}
        />
      </Stats>

      <Toolbar
        end={
          <div className="tabbar" role="tablist" aria-label="Contracts">
            {FILTERS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search client, reference or company" label="Search contracts" />
      </Toolbar>

      <Card title={FILTERS.find(([k]) => k === filter)?.[1]} sub={`${rows.length} contract${rows.length === 1 ? '' : 's'}`} flush>
        {rows.length === 0 ? (
          <Empty
            title="Nothing here."
            action={
              !needle &&
              data.canAdd.length > 0 && (
                <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
                  New contract
                </button>
              )
            }
          >
            {needle
              ? 'No contract matches the search.'
              : filter !== 'all'
                ? 'Nothing in this view. Choose All to see every contract, or record a signed contract to start its mobilisation.'
                : 'Record a signed contract or letter of award to start its site mobilisation.'}
          </Empty>
        ) : (
          <>
            <div className="bz-ct-headrow" aria-hidden="true">
              <span>Client</span>
              <span>Value</span>
              <span>Term</span>
              <span>State</span>
            </div>
            <ul className="bz-rows">
              {rows.slice(0, 120).map((r) => (
                <li key={r.contract.id}>
                  <ContractLine r={r} multi={multi} onOpen={() => setOpen(r.contract.id)} />
                </li>
              ))}
            </ul>
          </>
        )}
        {rows.length > 120 && <p className="bz-note bz-ct-more">and {rows.length - 120} more</p>}
      </Card>
      {row && <ContractDrawer row={row} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ContractLine({ r, multi, onOpen }: { r: Row; multi: boolean; onOpen: () => void }) {
  const c = r.contract;
  const mob = ['awarded', 'mobilising'].includes(c.state);
  return (
    <button className="bz-row bz-ct-row" data-tone={r.tone === 'crit' || r.tone === 'warn' ? r.tone : undefined} onClick={onOpen}>
      <span className="bz-row-main">
        <span className="bz-row-title">{c.clientName}</span>
        <span className="bz-row-meta">
          {multi ? `${r.companyName} · ` : ''}
          <span className="mono">{c.ref}</span> · {BILLING_METHOD_LABEL[r.current.billingMethod]}
        </span>
        {mob && (
          <span className="bz-ct-prog">
            <span className="bz-meter" data-tone={r.tone === 'crit' ? 'crit' : undefined}>
              <span style={{ width: `${pct(r.progress.done, r.progress.total)}%` }} />
            </span>
            <span className="bz-sub">
              {r.progress.done} of {r.progress.total} items done, starts {dateLabel(c.startOn)}
            </span>
          </span>
        )}
        {(r.reviewsDue.length > 0 || r.lastInvoice?.mismatch) && (
          <span className="bz-chips">
            {r.reviewsDue.length > 0 && <Chip tone="warn">Day {r.reviewsDue.map((x) => x.day).join(', ')} review due</Chip>}
            {r.lastInvoice?.mismatch && (
              <Chip tone="warn">
                {r.lastInvoice.period} invoice {rm(r.lastInvoice.invoiced ?? 0)} against {rm(r.lastInvoice.expected)}
              </Chip>
            )}
          </span>
        )}
      </span>
      <span className="bz-ct-value">
        <span className="bz-amt">{rm(r.billing.total)}</span>
        <span className="bz-sub">a month</span>
      </span>
      <span className="bz-ct-term">
        <span>Ends {dateLabel(c.endOn)}</span>
        <span className="bz-sub">From {dateLabel(c.startOn)}</span>
      </span>
      <span className="bz-ct-state">
        <Chip tone={r.tone === 'crit' ? 'crit' : STATE[c.state][0]}>{STATE[c.state][1]}</Chip>
      </span>
    </button>
  );
}

function ContractDrawer({ row: r, onClose }: { row: Row; onClose: () => void }) {
  const c = r.contract;
  const act = useAction();
  const [note, setNote] = useState('');
  const [variation, setVariation] = useState(false);
  const manager = r.role === 'manager';
  const works = r.role === 'manager' || r.role === 'staff';
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const step = (action: Parameters<typeof api.contractStep>[1], done: string) => act.run(() => api.contractStep(c.id, action, note), done);
  return (
    <Drawer title={c.clientName} sub={`${r.companyName} · ${c.ref} · ${dateLabel(c.startOn)} to ${dateLabel(c.endOn)}`} onClose={onClose}>
      <div className="bz-chips">
        <Chip tone={STATE[c.state][0]}>{STATE[c.state][1]}</Chip>
        {c.rtoCert && <Chip tone="ok">Ready-to-Operate signed {dateLabel(c.rtoCert.at.slice(0, 10))}</Chip>}
        {['awarded', 'mobilising'].includes(c.state) && (
          <Chip tone={r.daysToStart < 0 ? 'crit' : 'warn'}>{r.daysToStart < 0 ? `Start ${-r.daysToStart} days late` : `Starts in ${r.daysToStart} days`}</Chip>
        )}
      </div>
      <div className="bz-facts">
        <Facts
          items={[
            ['Value this month', <span className="bz-amt">{rm(r.billing.total)}</span>],
            ['Billing method', BILLING_METHOD_LABEL[r.current.billingMethod]],
            ['Starts', dateLabel(c.startOn)],
            ['Ends', dateLabel(c.endOn)],
            ['Mobilisation', `${r.progress.done} of ${r.progress.total} done`],
            ['Company', r.companyName],
          ]}
        />
      </div>
      <ErrorNotice error={act.error} />
      {manager && c.state !== 'terminated' && (
        <section className="bz-sec">
          <h3>Company manager</h3>
          <div className="bz-act">
            <label className="field">
              <span className="label">Note</span>
              <input className="input" aria-label="Note" placeholder="Note (needed to suspend or end)" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="bz-actions">
              {c.state === 'awarded' && (
                <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('mobilise', 'Mobilisation started.')}>
                  Start mobilising
                </button>
              )}
              {c.state === 'mobilising' && (
                <button className="btn btn-primary btn-sm" disabled={act.busy || !r.canCertify} onClick={() => step('certify', 'Site Ready-to-Operate Certificate signed.')}>
                  Sign Ready-to-Operate
                </button>
              )}
              {c.state === 'ready' && (
                <button className="btn btn-primary btn-sm" disabled={act.busy || today < c.startOn} onClick={() => step('activate', 'Contract is live.')}>
                  Go live
                </button>
              )}
              {c.state === 'active' && (
                <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => step('suspend', 'Suspended.')}>
                  Suspend
                </button>
              )}
              {c.state === 'suspended' && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => step('resume', 'Resumed.')}>
                  Resume
                </button>
              )}
              <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => step('terminate', 'Contract ended.')}>
                End contract
              </button>
              <button className="btn btn-sm" aria-expanded={variation} onClick={() => setVariation(!variation)}>
                Record a variation
              </button>
            </div>
            {c.state === 'mobilising' && !r.canCertify && (
              <p className="bz-note">Sign only when every critical item is done and every other item due by the start is done or its risk accepted.</p>
            )}
          </div>
          {variation && <VariationForm id={c.id} current={r.current} onDone={() => setVariation(false)} />}
        </section>
      )}

      <section className="bz-sec">
        <div className="bz-sec-head">
          <h3>Billing</h3>
          <span className="bz-sub">
            v{r.current.version} from {dateLabel(r.current.effectiveFrom)} · {BILLING_METHOD_LABEL[r.current.billingMethod]}
          </span>
        </div>
        <ul className="bz-ct-lines">
          {r.billing.lines.map((l) => (
            <li key={l.label}>
              <span>
                {l.label}
                {l.hours ? <span className="bz-sub"> · {l.hours.toLocaleString('en-MY')} hours</span> : null}
              </span>
              <span className="bz-amt">{rm(l.amount)}</span>
            </li>
          ))}
          <li className="bz-ct-total">
            <span>This month ({r.billing.days} days)</span>
            <span className="bz-amt">{rm(r.billing.total)}</span>
          </li>
          {r.lastInvoice && (
            <li>
              <span>{r.lastInvoice.period} invoice</span>
              <Chip tone={r.lastInvoice.invoiced == null ? 'unknown' : r.lastInvoice.mismatch ? 'warn' : 'ok'}>
                {r.lastInvoice.invoiced == null ? 'Not recorded' : `${rm(r.lastInvoice.invoiced)} against ${rm(r.lastInvoice.expected)}`}
              </Chip>
            </li>
          )}
        </ul>
        <p className="bz-note">
          SLA: replace an absent guard within {r.current.sla.replaceAbsentMinutes} minutes, incident report within {r.current.sla.incidentReportHours} hours, monthly
          report by the {r.current.sla.monthlyReportByDay}th. {r.current.penalties}
        </p>
        {c.versions.length > 1 && (
          <ul className="bz-ct-tl">
            {c.versions.map((v) => (
              <li key={v.version}>
                <strong>
                  v{v.version} from {dateLabel(v.effectiveFrom)}
                </strong>
                <span className="bz-row-meta">
                  {BILLING_METHOD_LABEL[v.billingMethod]}, {v.signedRef}, {v.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bz-sec">
        <div className="bz-sec-head">
          <h3>Mobilisation</h3>
          <span className="bz-sub">
            {r.progress.done} of {r.progress.total} done
          </span>
        </div>
        <span className="bz-meter">
          <span style={{ width: `${pct(r.progress.done, r.progress.total)}%` }} />
        </span>
        <ul className="bz-ct-items">
          {c.mobilisation.map((i) => (
            <MobLine key={i.id} contractId={c.id} item={i} works={works && c.state !== 'terminated'} manager={manager} />
          ))}
        </ul>
      </section>
      {c.mobilisation.some((i) => i.check === 'cms_activation') && <CmsServicePanel row={r} manager={manager && c.state !== 'terminated'} />}
      {['active', 'suspended'].includes(c.state) && (
        <section className="bz-sec">
          <h3>Reviews after go-live</h3>
          <Steps
            steps={c.reviews.map((rv) => ({
              label: `Day ${rv.day}`,
              state: rv.doneAt ? 'done' : rv.dueOn <= today ? 'now' : 'todo',
              note: rv.doneAt ? `Done ${dateLabel(rv.doneAt.slice(0, 10))}` : `Due ${dateLabel(rv.dueOn)}`,
            }))}
          />
          <ul className="bz-ct-items">
            {c.reviews.map((rv) => (
              <ReviewLine key={rv.day} contractId={c.id} review={rv} canDo={works && c.state === 'active' && !rv.doneAt && rv.dueOn <= today} />
            ))}
          </ul>
        </section>
      )}
      <section className="bz-sec">
        <h3>History</h3>
        <ul className="bz-ct-tl">
          {c.history.map((h) => (
            <li key={h.at + h.to}>
              <span className="bz-ct-tl-top">
                <strong>
                  {h.from ? `${STATE[h.from][1]} to ` : ''}
                  {STATE[h.to][1]}
                </strong>
                <time className="bz-sub">{dateTimeLabel(h.at)}</time>
              </span>
              <span className="bz-row-meta">
                {h.by}
                {h.note ? `, ${h.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Drawer>
  );
}

function MobLine({
  contractId,
  item: i,
  works,
  manager,
}: {
  contractId: string;
  item: Row['contract']['mobilisation'][number];
  works: boolean;
  manager: boolean;
}) {
  const act = useAction();
  const [accepting, setAccepting] = useState(false);
  const [why, setWhy] = useState('');
  const [until, setUntil] = useState('');
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const late = i.status !== 'done' && i.dueOn < today && !(i.status === 'risk_accepted' && (i.acceptedUntil ?? '') >= today);
  return (
    <li className="bz-ct-item" data-state={i.status === 'done' ? 'done' : late ? 'late' : undefined}>
      <div className="bz-ct-item-top">
        <div className="bz-row-main">
          <span className="bz-ct-item-label">
            {i.label}
            {i.critical ? <strong className="bz-ct-crit"> · critical</strong> : null}
          </span>
          <span className="bz-row-meta">
            {i.workstream} {MOB_WORKSTREAM_LABEL[i.workstream]} · due {dateLabel(i.dueOn)}
            {i.by ? ` · ${i.by}` : ''}
            {i.status === 'risk_accepted' ? ` · risk accepted until ${dateLabel(i.acceptedUntil)}: ${i.note}` : ''}
          </span>
          {i.check === 'cms_activation' && i.status === 'open' && (
            <span className="bz-row-meta">
              Prima checks this before it can be marked done: each site has a CCTV or alarm panel linked and tested, CMS has heard from it in the last 24 hours (a test alarm
              counts), and CMS has a site supervisor, the company manager and a Regional OM to call. It is a technical check only: it does not confirm a signed CMS service
              scope, the client's or operator's acceptance, or that the phone numbers were verified.
            </span>
          )}
        </div>
        <Chip tone={i.status === 'done' ? 'ok' : late ? 'crit' : i.status === 'risk_accepted' ? 'warn' : 'neutral'}>
          {i.status === 'done' ? 'Done' : late ? 'Overdue' : i.status === 'risk_accepted' ? 'Risk accepted' : 'Open'}
        </Chip>
      </div>
      {works && (
        <div className="bz-actions">
          {i.status !== 'done' ? (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setMobItem(contractId, i.id, 'done', '', null), 'Done.')}>
              Mark done
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setMobItem(contractId, i.id, 'open', '', null), 'Opened again.')}>
              Open again
            </button>
          )}
          {manager && !i.critical && i.status === 'open' && (
            <button className="btn btn-ghost btn-sm" aria-expanded={accepting} onClick={() => setAccepting(!accepting)}>
              Accept risk
            </button>
          )}
        </div>
      )}
      {accepting && (
        <div className="bz-act">
          <div className="bz-form">
            <label className="field">
              <span className="label">Why</span>
              <input className="input" aria-label="Why" placeholder="Why the risk is accepted" value={why} onChange={(e) => setWhy(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Until</span>
              <input className="input" type="date" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !why.trim() || !until}
              onClick={() => act.run(() => api.setMobItem(contractId, i.id, 'risk_accepted', why, until), 'Risk accepted.')}
            >
              Accept
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </li>
  );
}

function ReviewLine({ contractId, review: rv, canDo }: { contractId: string; review: Row['contract']['reviews'][number]; canDo: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  return (
    <li className="bz-ct-item" data-state={rv.doneAt ? 'done' : undefined}>
      <div className="bz-ct-item-top">
        <span className="bz-ct-item-label">Day {rv.day}</span>
        <Chip tone={rv.doneAt ? 'ok' : canDo ? 'warn' : 'neutral'}>{rv.doneAt ? `Done ${dateLabel(rv.doneAt.slice(0, 10))}` : `Due ${dateLabel(rv.dueOn)}`}</Chip>
      </div>
      {rv.doneAt && (
        <span className="bz-row-meta">
          {rv.by}: {rv.note}
        </span>
      )}
      {canDo && (
        <div className="bz-act">
          <label className="field">
            <span className="label">What the review found</span>
            <input className="input" aria-label={`Day ${rv.day} review`} placeholder="What the review found" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {rv.day === 30 && (
            <label className="bz-ct-check">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              First invoice checked against the contract's billing
            </label>
          )}
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !note.trim() || (rv.day === 30 && !checked)}
              onClick={() => act.run(() => api.contractReview(contractId, rv.day, note, checked), 'Review recorded.')}
            >
              Record review
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </li>
  );
}

function VariationForm({ id, current, onDone }: { id: string; current: Row['current']; onDone: () => void }) {
  const act = useAction();
  const [method, setMethod] = useState<BillingMethod>(current.billingMethod);
  const [from, setFrom] = useState('');
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('');
  const [rate, setRate] = useState(String(current.posts[0]?.rate ?? ''));
  return (
    <div className="bz-act">
      <span className="label">Variation</span>
      <div className="bz-form">
        <label className="field">
          <span className="label">Billing method</span>
          <select className="select" aria-label="Billing method" value={method} onChange={(e) => setMethod(e.target.value as BillingMethod)}>
            {Object.entries(BILLING_METHOD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {method === 'FIXED' ? (
          <label className="field">
            <span className="label">Fixed monthly fee, RM</span>
            <input className="input" inputMode="decimal" aria-label="Fixed fee" placeholder="Fixed monthly fee, RM" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        ) : (
          <label className="field">
            <span className="label">Rate per guard-hour, RM</span>
            <input
              className="input"
              inputMode="decimal"
              aria-label="Rate"
              placeholder="Rate per guard-hour for every post, RM"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span className="label">Takes effect from</span>
          <input className="input" type="date" aria-label="Takes effect from" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Signed variation reference</span>
          <input className="input" aria-label="Signed variation reference" placeholder="Signed variation reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <label className="field bz-span">
          <span className="label">What changes</span>
          <input className="input" aria-label="What changes" placeholder="What the variation changes" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !from || !ref.trim() || !reason.trim()}
          onClick={async () => {
            const ok = await act.run(
              () =>
                api.addContractVariation(id, {
                  effectiveFrom: from,
                  billingMethod: method,
                  posts: current.posts.map((p) => ({ ...p, rate: Number(rate), contractedHours: p.contractedHours ?? (method === 'M2' ? 312 : undefined) })),
                  fixedFee: method === 'FIXED' ? Number(fee) : null,
                  signedRef: ref,
                  reason,
                }),
              'Variation recorded.',
            );
            if (ok) onDone();
          }}
        >
          Save variation
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Record a signed contract or letter of award; mobilisation opens against its start date (company manager only). */
function NewContractForm({ options, onDone }: { options: ContractBoard['canAdd']; onDone: () => void }) {
  const act = useAction();
  const app = useApp();
  // Start on the company chosen at the top of the app when this user may record contracts for it.
  const [companyId, setCompanyId] = useState((options.find((o) => o.companyId === app.companyId) ?? options[0])?.companyId ?? '');
  const co = options.find((o) => o.companyId === companyId) ?? options[0];
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [startOn, setStartOn] = useState('');
  const [endOn, setEndOn] = useState('');
  const [method, setMethod] = useState<BillingMethod>('M1');
  const [rate, setRate] = useState('');
  const [fee, setFee] = useState('');
  const [hours, setHours] = useState('312');
  const [ref, setRef] = useState('');
  const client = co?.clients.find((c) => c.id === clientId);
  const chosen = siteIds.length ? siteIds : (client?.siteIds ?? []);
  return (
    <Drawer title="New contract" sub="Record the signed contract or letter of award. Mobilisation opens with all 12 workstreams due against the start date." onClose={onDone}>
      <div className="bz-form">
        {options.length > 1 && (
          <label className="field bz-span">
            <span className="label">Company</span>
            <select
              className="select"
              aria-label="Company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setClientId('');
                setSiteIds([]);
              }}
            >
              {options.map((o) => (
                <option key={o.companyId} value={o.companyId}>
                  {o.companyName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field bz-span">
          <span className="label">Client</span>
          <select
            className="select"
            aria-label="Client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setSiteIds([]);
            }}
          >
            <option value="">A client not on the list yet</option>
            {co?.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {!clientId && (
          <label className="field bz-span">
            <span className="label">Client name</span>
            <input className="input" aria-label="Client name" placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </label>
        )}
        <fieldset className="bz-span bz-ct-sites">
          <legend className="label">Sites under this contract</legend>
          {co?.sites.length === 0 && (
            <span className="bz-note">
              No sites yet. Add the site first so the contract carries its posts; saved without a site it bills one main post.{' '}
              <RecordButton kind="site" companyId={co.companyId} label="Add site" />
            </span>
          )}
          {co?.sites.map((x) => (
            <label key={x.id} className="bz-ct-check">
              <input type="checkbox" checked={chosen.includes(x.id)} onChange={(e) => setSiteIds(e.target.checked ? [...chosen, x.id] : chosen.filter((id) => id !== x.id))} />
              {x.name}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="label">Starts</span>
          <input className="input" type="date" aria-label="Starts on" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Ends</span>
          <input className="input" type="date" aria-label="Ends on" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Billing method</span>
          <select className="select" aria-label="Billing method" value={method} onChange={(e) => setMethod(e.target.value as BillingMethod)}>
            {Object.entries(BILLING_METHOD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {method === 'FIXED' ? (
          <label className="field">
            <span className="label">Fixed monthly fee, RM</span>
            <input className="input" inputMode="decimal" aria-label="Fixed fee" placeholder="Fixed monthly fee, RM" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        ) : (
          <label className="field">
            <span className="label">Rate per guard-hour, RM</span>
            <input className="input" inputMode="decimal" aria-label="Rate" placeholder="Rate per guard-hour, RM" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
        )}
        {method === 'M2' && (
          <label className="field">
            <span className="label">Contracted hours a month per guard position</span>
            <input
              className="input"
              inputMode="numeric"
              aria-label="Contracted hours"
              placeholder="Contracted hours a month per guard position"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
        )}
        <label className="field bz-span">
          <span className="label">Signed contract or letter of award reference</span>
          <input
            className="input"
            aria-label="Signed contract reference"
            placeholder="Signed contract or letter of award reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !startOn || !endOn || !ref.trim() || (!clientId && !clientName.trim())}
          onClick={async () => {
            const ok = await act.run(
              () =>
                api.addContract({
                  companyId: co!.companyId,
                  clientAccountId: clientId || null,
                  clientName,
                  siteIds: chosen,
                  startOn,
                  endOn,
                  billingMethod: method,
                  rate: Number(rate),
                  fixedFee: method === 'FIXED' ? Number(fee) : null,
                  contractedHours: method === 'M2' ? Number(hours) : null,
                  signedRef: ref,
                }),
              'Contract recorded. Mobilisation is open.',
            );
            if (ok) onDone();
          }}
        >
          Save contract
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}

const CONTACT_ROLE: Record<string, string> = { site_supervisor: 'Site supervisor', company_manager: 'Company manager', regional_om: 'Regional OM' };

/**
 * Masterplan §191: the signed CMS service for this contract. The company manager records the signed scope and, after
 * CMS (Arms Control) accepts, the client's acceptance. CMS operators verify the contacts from the CMS screen.
 */
function CmsServicePanel({ row: r, manager }: { row: Row; manager: boolean }) {
  const c = r.contract;
  const svc = c.cmsService ?? null;
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [sites, setSites] = useState(() => r.siteNames.map((x) => ({ siteId: x.id, on: true, from: '00:00', to: '24:00' })));
  const [services, setServices] = useState<CmsServiceKind[]>(['cctv', 'alarm']);
  const [signedRef, setSignedRef] = useState('');
  const [signatory, setSignatory] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientRef, setClientRef] = useState('');
  const name = (id: string) => r.siteNames.find((x) => x.id === id)?.name ?? id;
  const save = () =>
    act
      .run(
        () =>
          api.setCmsService(c.id, {
            sites: sites.filter((x) => x.on).map(({ siteId, from, to }) => ({ siteId, from, to })),
            services,
            signedRef,
            clientSignatory: signatory,
            signedOn,
          }),
        'CMS service scope recorded.',
      )
      .then((x) => x && setEditing(false));
  return (
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>CMS service</h3>
      </div>
      <p className="bz-note">Signed scope, contacts verified by CMS, CMS acceptance, then the client&apos;s acceptance</p>
      {svc && (
        <Steps
          steps={[
            { label: 'Signed scope', state: 'done', note: `v${svc.version}` },
            {
              label: 'Contacts verified',
              state: svc.contacts.length && svc.contacts.every((x) => x.verifiedAt) ? 'done' : 'now',
            },
            { label: 'CMS acceptance', state: svc.operatorAcceptance ? 'done' : 'todo' },
            { label: 'Client acceptance', state: svc.clientAcceptance ? 'done' : svc.operatorAcceptance ? 'now' : 'todo' },
          ]}
        />
      )}
      <ErrorNotice error={act.error} />
      {!c.siteIds.length && <p className="bz-note">Add the contract&apos;s sites first.</p>}
      {svc ? (
        <>
          <p>
            Scope v{svc.version}: {svc.services.map((x) => CMS_SERVICE_KINDS[x]).join(', ')}. Signed {dateLabel(svc.signedOn)} by {svc.clientSignatory}, ref {svc.signedRef}.
            Recorded by {svc.recordedBy}.
          </p>
          <ul className="bz-ct-lines">
            {svc.sites.map((x) => (
              <li key={x.siteId}>
                <span>{name(x.siteId)}</span>
                <span className="bz-sub">
                  watched {x.from} to {x.to} MYT
                </span>
              </li>
            ))}
          </ul>
          <ul className="bz-ct-lines">
            {svc.contacts.map((x, i) => (
              <li key={i}>
                <span>
                  {CONTACT_ROLE[x.role]}
                  {x.siteId ? ` (${name(x.siteId)})` : ''}: {x.name}
                </span>
                <Chip tone={x.verifiedAt ? 'ok' : 'warn'}>{x.verifiedAt ? `Verified by ${x.verifiedBy}` : 'Not verified by CMS yet'}</Chip>
              </li>
            ))}
          </ul>
          <div className="bz-facts">
            <Facts
              items={[
                [
                  'Acceptance tests',
                  `${(svc.tests ?? []).length} of ${svc.services.length * svc.sites.length} recorded by CMS${
                    (svc.tests ?? []).some((t) => t.basis === 'operator_attested')
                      ? ' (attendance and patrol tests are attested by the operator; Prima cannot see the JA app)'
                      : ''
                  }`,
                ],
                ['CMS acceptance', svc.operatorAcceptance ? `${svc.operatorAcceptance.by}, ${dateTimeLabel(svc.operatorAcceptance.at)}: ${svc.operatorAcceptance.note}` : 'not yet'],
                [
                  'Client acceptance',
                  svc.clientAcceptance
                    ? `${svc.clientAcceptance.clientName}, ref ${svc.clientAcceptance.ref} (recorded by ${svc.clientAcceptance.recordedBy})`
                    : 'not yet',
                ],
              ]}
            />
          </div>
          {manager && svc.operatorAcceptance && !svc.clientAcceptance && (
            <div className="bz-act">
              <div className="bz-form">
                <label className="field">
                  <span className="label">Client's name</span>
                  <input className="input" aria-label="Client name" placeholder="Client's name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">Acceptance reference</span>
                  <input
                    className="input"
                    aria-label="Acceptance reference"
                    placeholder="Reference of their written acceptance"
                    value={clientRef}
                    onChange={(e) => setClientRef(e.target.value)}
                  />
                </label>
              </div>
              <div className="bz-actions">
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() => act.run(() => api.acceptCmsService(c.id, 'client', svc.version, { clientName, ref: clientRef }), 'Client acceptance recorded.')}
                >
                  Record client acceptance
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="bz-note">No signed CMS service scope yet.</p>
      )}
      {manager && c.siteIds.length > 0 && !editing && (
        <div className="bz-actions">
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            {svc ? 'Record a new signed scope (starts the checks again)' : 'Record the signed CMS scope'}
          </button>
        </div>
      )}
      {editing && (
        <div className="bz-act">
          <span className="label">Sites watched</span>
          {sites.map((x, i) => (
            <div key={x.siteId} className="bz-ct-hours">
              <label className="bz-ct-check">
                <input type="checkbox" checked={x.on} onChange={(e) => setSites(sites.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} /> {name(x.siteId)}
              </label>
              <input
                className="input bz-ct-time"
                aria-label={`From, ${name(x.siteId)}`}
                value={x.from}
                onChange={(e) => setSites(sites.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)))}
              />
              <span className="bz-sub">to</span>
              <input
                className="input bz-ct-time"
                aria-label={`To, ${name(x.siteId)}`}
                value={x.to}
                onChange={(e) => setSites(sites.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)))}
              />
            </div>
          ))}
          <span className="label">Services</span>
          <div className="bz-actions">
            {(Object.keys(CMS_SERVICE_KINDS) as CmsServiceKind[]).map((k) => (
              <label key={k} className="bz-ct-check">
                <input type="checkbox" checked={services.includes(k)} onChange={(e) => setServices(e.target.checked ? [...services, k] : services.filter((x) => x !== k))} />{' '}
                {CMS_SERVICE_KINDS[k]}
              </label>
            ))}
          </div>
          <div className="bz-form">
            <label className="field bz-span">
              <span className="label">Signed CMS service document reference</span>
              <input
                className="input"
                aria-label="Signed document reference"
                placeholder="Signed CMS service document reference"
                value={signedRef}
                onChange={(e) => setSignedRef(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Client signatory's name</span>
              <input className="input" aria-label="Client signatory" placeholder="Client signatory's name" value={signatory} onChange={(e) => setSignatory(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Signed on</span>
              <input className="input" type="date" aria-label="Signed on" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
            </label>
          </div>
          <div className="bz-actions">
            <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={save}>
              Save signed scope
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
