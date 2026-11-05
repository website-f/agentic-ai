import { useState } from 'react';
import { BILLING_METHOD_LABEL, CMS_SERVICE_KINDS, MOB_WORKSTREAM_LABEL, type BillingMethod, type CmsServiceKind, type ContractState } from '@prima/core';
import { api, type ContractBoard } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

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
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ContractsView() {
  const { data, error } = useLoad(() => api.contracts(), []);
  const [filter, setFilter] = useState<'attention' | 'mobilising' | 'live' | 'all'>('attention');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="contracts" />;
  const rows = data.rows.filter((r) =>
    filter === 'attention'
      ? r.tone === 'crit' || r.tone === 'warn' || r.lastInvoice?.mismatch
      : filter === 'mobilising'
        ? ['awarded', 'mobilising', 'ready'].includes(r.contract.state)
        : filter === 'live'
          ? r.contract.state === 'active'
          : true,
  );
  const mobilising = data.rows.filter((r) => ['awarded', 'mobilising', 'ready'].includes(r.contract.state));
  const mismatch = data.rows.filter((r) => r.lastInvoice?.mismatch || (r.lastInvoice && r.lastInvoice.invoiced == null));
  const live = data.rows.filter((r) => r.contract.state === 'active');
  const row = data.rows.find((r) => r.contract.id === open) ?? null;
  const multi = new Set(data.rows.map((r) => r.contract.companyId)).size > 1;
  return (
    <div className="page">
      {adding && <NewContractForm options={data.canAdd} onDone={() => setAdding(false)} />}
      <div className="page-head">
        <div>
          <h1>Contracts</h1>
          <p className="muted">
            Each site is mobilised against 12 workstreams (the 12th is CMS activation) and goes live only with the Site Ready-to-Operate Certificate. Reviews follow at day 1, 7, 14 and 30.
            The billing method changes only by a signed variation.
          </p>
        </div>
        {data.canAdd.length > 0 && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            New contract
          </button>
        )}
      </div>
      <div className="kpis">
        <Kpi label="Live contracts" value={live.length} note={`${rm(live.reduce((n, r) => n + r.billing.total, 0))} a month`} />
        <Kpi
          label="Sites being mobilised"
          value={mobilising.length}
          tone={mobilising.some((r) => r.tone === 'crit') ? 'crit' : mobilising.length ? 'warn' : 'ok'}
          note={`${mobilising.filter((r) => r.daysToStart <= data.rule.startWarnDays).length} start within ${data.rule.startWarnDays} days`}
        />
        <Kpi
          label="Reviews due"
          value={data.rows.reduce((n, r) => n + r.reviewsDue.length, 0)}
          tone={data.rows.some((r) => r.reviewsDue.length) ? 'warn' : 'ok'}
        />
        <Kpi label="Last month's invoice off or missing" value={mismatch.length} tone={mismatch.length ? 'warn' : 'ok'} note="Against the contract's billing" />
      </div>
      <div className="tabbar" role="tablist" aria-label="Contracts">
        {(
          [
            ['attention', 'Needs attention'],
            ['mobilising', 'Mobilising'],
            ['live', 'Live'],
            ['all', 'All'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="list">
          {rows.length === 0 && <div className="empty">Nothing here.</div>}
          {rows.slice(0, 120).map((r) => (
            <button
              key={r.contract.id}
              className="list-item"
              style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }}
              onClick={() => setOpen(r.contract.id)}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.contract.clientName}</div>
                <div className="muted small">
                  {multi ? `${r.companyName} · ` : ''}
                  {r.contract.ref} · {BILLING_METHOD_LABEL[r.current.billingMethod]} · {rm(r.billing.total)} a month
                  {['awarded', 'mobilising'].includes(r.contract.state)
                    ? ` · ${r.progress.done} of ${r.progress.total} items done, starts ${dateLabel(r.contract.startOn)}`
                    : ''}
                  {r.reviewsDue.length ? ` · day ${r.reviewsDue.map((x) => x.day).join(', ')} review due` : ''}
                  {r.lastInvoice?.mismatch ? ` · ${r.lastInvoice.period} invoice ${rm(r.lastInvoice.invoiced ?? 0)} against ${rm(r.lastInvoice.expected)}` : ''}
                </div>
              </div>
              <Chip tone={r.tone === 'crit' ? 'crit' : STATE[r.contract.state][0]}>{STATE[r.contract.state][1]}</Chip>
            </button>
          ))}
          {rows.length > 120 && <div className="muted small">and {rows.length - 120} more</div>}
        </div>
      </section>
      {row && <ContractDrawer row={row} onClose={() => setOpen(null)} />}
    </div>
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
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Chip tone={STATE[c.state][0]}>{STATE[c.state][1]}</Chip>
        {c.rtoCert && <Chip tone="ok">Ready-to-Operate signed {dateLabel(c.rtoCert.at.slice(0, 10))}</Chip>}
        {['awarded', 'mobilising'].includes(c.state) && (
          <Chip tone={r.daysToStart < 0 ? 'crit' : 'warn'}>{r.daysToStart < 0 ? `Start ${-r.daysToStart} days late` : `Starts in ${r.daysToStart} days`}</Chip>
        )}
      </div>
      <ErrorNotice error={act.error} />
      {manager && c.state !== 'terminated' && (
        <section className="panel">
          <div className="panel-head">
            <h3>Company manager</h3>
          </div>
          <input className="input" aria-label="Note" placeholder="Note (needed to suspend or end)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {c.state === 'awarded' && (
              <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => step('mobilise', 'Mobilisation started.')}>
                Start mobilising
              </button>
            )}
            {c.state === 'mobilising' && (
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !r.canCertify}
                onClick={() => step('certify', 'Site Ready-to-Operate Certificate signed.')}
              >
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
            <button className="btn btn-sm" onClick={() => setVariation(!variation)}>
              Record a variation
            </button>
          </div>
          {c.state === 'mobilising' && !r.canCertify && (
            <p className="muted small">Sign only when every critical item is done and every other item due by the start is done or its risk accepted.</p>
          )}
          {variation && <VariationForm id={c.id} current={r.current} onDone={() => setVariation(false)} />}
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Billing</h3>
          <span className="muted small">
            v{r.current.version} from {dateLabel(r.current.effectiveFrom)} · {BILLING_METHOD_LABEL[r.current.billingMethod]}
          </span>
        </div>
        <div className="list">
          {r.billing.lines.map((l) => (
            <div key={l.label} className="list-item">
              <span>
                {l.label}
                {l.hours ? <span className="muted small"> · {l.hours.toLocaleString('en-MY')} hours</span> : null}
              </span>
              <span>{rm(l.amount)}</span>
            </div>
          ))}
          <div className="list-item" style={{ fontWeight: 700 }}>
            <span>This month ({r.billing.days} days)</span>
            <span>{rm(r.billing.total)}</span>
          </div>
          {r.lastInvoice && (
            <div className="list-item">
              <span>{r.lastInvoice.period} invoice</span>
              <Chip tone={r.lastInvoice.invoiced == null ? 'unknown' : r.lastInvoice.mismatch ? 'warn' : 'ok'}>
                {r.lastInvoice.invoiced == null ? 'Not recorded' : `${rm(r.lastInvoice.invoiced)} against ${rm(r.lastInvoice.expected)}`}
              </Chip>
            </div>
          )}
        </div>
        <p className="muted small">
          SLA: replace an absent guard within {r.current.sla.replaceAbsentMinutes} minutes, incident report within {r.current.sla.incidentReportHours} hours,
          monthly report by the {r.current.sla.monthlyReportByDay}th. {r.current.penalties}
        </p>
        {c.versions.length > 1 && (
          <div className="list">
            {c.versions.map((v) => (
              <div key={v.version} className="muted small">
                v{v.version} from {dateLabel(v.effectiveFrom)}: {BILLING_METHOD_LABEL[v.billingMethod]}, {v.signedRef}, {v.reason}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Mobilisation</h3>
          <span className="muted small">
            {r.progress.done} of {r.progress.total} done
          </span>
        </div>
        <div className="list">
          {c.mobilisation.map((i) => (
            <MobLine key={i.id} contractId={c.id} item={i} works={works && c.state !== 'terminated'} manager={manager} />
          ))}
        </div>
      </section>
      {c.mobilisation.some((i) => i.check === 'cms_activation') && <CmsServicePanel row={r} manager={manager && c.state !== 'terminated'} />}
      {['active', 'suspended'].includes(c.state) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Reviews after go-live</h3>
          </div>
          <div className="list">
            {c.reviews.map((rv) => (
              <ReviewLine key={rv.day} contractId={c.id} review={rv} canDo={works && c.state === 'active' && !rv.doneAt && rv.dueOn <= today} />
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>History</h3>
        </div>
        <div className="list">
          {c.history.map((h) => (
            <div key={h.at + h.to} className="muted small">
              {dateTimeLabel(h.at)} · {h.by}: {h.from ? `${STATE[h.from][1]} to ` : ''}
              {STATE[h.to][1]}
              {h.note ? `, ${h.note}` : ''}
            </div>
          ))}
        </div>
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
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div>
            {i.label}
            {i.critical ? (
              <span className="small" style={{ fontWeight: 600 }}>
                {' '}
                · critical
              </span>
            ) : null}
          </div>
          <div className="muted small">
            {i.workstream} {MOB_WORKSTREAM_LABEL[i.workstream]} · due {dateLabel(i.dueOn)}
            {i.by ? ` · ${i.by}` : ''}
            {i.status === 'risk_accepted' ? ` · risk accepted until ${dateLabel(i.acceptedUntil)}: ${i.note}` : ''}
          </div>
          {i.check === 'cms_activation' && i.status === 'open' && (
            <div className="muted small">
              Prima checks this before it can be marked done: each site has a CCTV or alarm panel linked and tested, CMS has heard from it in the last 24
              hours (a test alarm counts), and CMS has a site supervisor, the company manager and a Regional OM to call. It is a technical check only:
              it does not confirm a signed CMS service scope, the client's or operator's acceptance, or that the phone numbers were verified.
            </div>
          )}
        </div>
        <Chip tone={i.status === 'done' ? 'ok' : late ? 'crit' : i.status === 'risk_accepted' ? 'warn' : 'neutral'}>
          {i.status === 'done' ? 'Done' : late ? 'Overdue' : i.status === 'risk_accepted' ? 'Risk accepted' : 'Open'}
        </Chip>
      </div>
      {works && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {i.status !== 'done' ? (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setMobItem(contractId, i.id, 'done', '', null), 'Done.')}>
              Mark done
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              disabled={act.busy}
              onClick={() => act.run(() => api.setMobItem(contractId, i.id, 'open', '', null), 'Opened again.')}
            >
              Open again
            </button>
          )}
          {manager && !i.critical && i.status === 'open' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setAccepting(!accepting)}>
              Accept risk
            </button>
          )}
        </div>
      )}
      {accepting && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Why" placeholder="Why the risk is accepted" value={why} onChange={(e) => setWhy(e.target.value)} />
          <input className="input" type="date" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !why.trim() || !until}
            onClick={() => act.run(() => api.setMobItem(contractId, i.id, 'risk_accepted', why, until), 'Risk accepted.')}
          >
            Accept
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function ReviewLine({ contractId, review: rv, canDo }: { contractId: string; review: Row['contract']['reviews'][number]; canDo: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <span>Day {rv.day}</span>
        <Chip tone={rv.doneAt ? 'ok' : canDo ? 'warn' : 'neutral'}>
          {rv.doneAt ? `Done ${dateLabel(rv.doneAt.slice(0, 10))}` : `Due ${dateLabel(rv.dueOn)}`}
        </Chip>
      </div>
      {rv.doneAt && (
        <div className="muted small">
          {rv.by}: {rv.note}
        </div>
      )}
      {canDo && (
        <>
          <input
            className="input"
            aria-label={`Day ${rv.day} review`}
            placeholder="What the review found"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {rv.day === 30 && (
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              First invoice checked against the contract's billing
            </label>
          )}
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim() || (rv.day === 30 && !checked)}
            onClick={() => act.run(() => api.contractReview(contractId, rv.day, note, checked), 'Review recorded.')}
          >
            Record review
          </button>
          <ErrorNotice error={act.error} />
        </>
      )}
    </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <select className="select" aria-label="Billing method" value={method} onChange={(e) => setMethod(e.target.value as BillingMethod)}>
        {Object.entries(BILLING_METHOD_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {method === 'FIXED' ? (
        <input
          className="input"
          inputMode="decimal"
          aria-label="Fixed fee"
          placeholder="Fixed monthly fee, RM"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
        />
      ) : (
        <input
          className="input"
          inputMode="decimal"
          aria-label="Rate"
          placeholder="Rate per guard-hour for every post, RM"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      )}
      <input className="input" type="date" aria-label="Takes effect from" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input
        className="input"
        aria-label="Signed variation reference"
        placeholder="Signed variation reference"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
      />
      <input className="input" aria-label="What changes" placeholder="What the variation changes" value={reason} onChange={(e) => setReason(e.target.value)} />
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
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Record a signed contract or letter of award; mobilisation opens against its start date (company manager only). */
function NewContractForm({ options, onDone }: { options: ContractBoard['canAdd']; onDone: () => void }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(options[0]?.companyId ?? '');
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
    <Drawer
      title="New contract"
      sub="Record the signed contract or letter of award. Mobilisation opens with all 12 workstreams due against the start date."
      onClose={onDone}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.length > 1 && (
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
        )}
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
        {!clientId && (
          <input className="input" aria-label="Client name" placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
        )}
        <div className="muted small">Sites under this contract</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, maxHeight: 160, overflow: 'auto' }}>
          {co?.sites.length === 0 && <span className="muted small">No sites yet. Add the site first under Sites.</span>}
          {co?.sites.map((x) => (
            <label key={x.id} className="row small" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={chosen.includes(x.id)}
                onChange={(e) => setSiteIds(e.target.checked ? [...chosen, x.id] : chosen.filter((id) => id !== x.id))}
              />
              {x.name}
            </label>
          ))}
        </div>
        <label className="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Starts
          <input className="input" type="date" aria-label="Starts on" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </label>
        <label className="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Ends
          <input className="input" type="date" aria-label="Ends on" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
        </label>
        <select className="select" aria-label="Billing method" value={method} onChange={(e) => setMethod(e.target.value as BillingMethod)}>
          {Object.entries(BILLING_METHOD_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {method === 'FIXED' ? (
          <input
            className="input"
            inputMode="decimal"
            aria-label="Fixed fee"
            placeholder="Fixed monthly fee, RM"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        ) : (
          <input
            className="input"
            inputMode="decimal"
            aria-label="Rate"
            placeholder="Rate per guard-hour, RM"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        )}
        {method === 'M2' && (
          <input
            className="input"
            inputMode="numeric"
            aria-label="Contracted hours"
            placeholder="Contracted hours a month per guard position"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        )}
        <input
          className="input"
          aria-label="Signed contract reference"
          placeholder="Signed contract or letter of award reference"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <button
          className="btn btn-primary btn-sm"
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
        <ErrorNotice error={act.error} />
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
    act.run(
      () =>
        api.setCmsService(c.id, {
          sites: sites.filter((x) => x.on).map(({ siteId, from, to }) => ({ siteId, from, to })),
          services,
          signedRef,
          clientSignatory: signatory,
          signedOn,
        }),
      'CMS service scope recorded.',
    ).then((x) => x && setEditing(false));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>CMS service</h3>
        <span className="muted small">Signed scope, contacts verified by CMS, CMS acceptance, then the client&apos;s acceptance</span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
        <ErrorNotice error={act.error} />
        {!c.siteIds.length && <p className="muted small">Add the contract&apos;s sites first.</p>}
        {svc ? (
          <>
            <div className="small">
              Scope v{svc.version}: {svc.services.map((x) => CMS_SERVICE_KINDS[x]).join(', ')}. Signed {dateLabel(svc.signedOn)} by {svc.clientSignatory}, ref{' '}
              {svc.signedRef}. Recorded by {svc.recordedBy}.
            </div>
            <div className="list">
              {svc.sites.map((x) => (
                <div key={x.siteId} className="small">
                  {name(x.siteId)}: watched {x.from} to {x.to} MYT
                </div>
              ))}
            </div>
            <div className="list">
              {svc.contacts.map((x, i) => (
                <div key={i} className="row small" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                  <span>
                    {CONTACT_ROLE[x.role]}
                    {x.siteId ? ` (${name(x.siteId)})` : ''}: {x.name}
                  </span>
                  <Chip tone={x.verifiedAt ? 'ok' : 'warn'}>{x.verifiedAt ? `Verified by ${x.verifiedBy}` : 'Not verified by CMS yet'}</Chip>
                </div>
              ))}
            </div>
            <div className="small">
              Acceptance tests: {(svc.tests ?? []).length} of {svc.services.length * svc.sites.length} recorded by CMS
              {(svc.tests ?? []).some((t) => t.basis === 'operator_attested') ? ' (attendance and patrol tests are attested by the operator; Prima cannot see the JA app)' : ''}
              <br />
              CMS acceptance: {svc.operatorAcceptance ? `${svc.operatorAcceptance.by}, ${dateTimeLabel(svc.operatorAcceptance.at)}: ${svc.operatorAcceptance.note}` : 'not yet'}
              <br />
              Client acceptance:{' '}
              {svc.clientAcceptance ? `${svc.clientAcceptance.clientName}, ref ${svc.clientAcceptance.ref} (recorded by ${svc.clientAcceptance.recordedBy})` : 'not yet'}
            </div>
            {manager && svc.operatorAcceptance && !svc.clientAcceptance && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input className="input" aria-label="Client name" placeholder="Client's name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
                <input className="input" aria-label="Acceptance reference" placeholder="Reference of their written acceptance" value={clientRef} onChange={(e) => setClientRef(e.target.value)} />
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() => act.run(() => api.acceptCmsService(c.id, 'client', svc.version, { clientName, ref: clientRef }), 'Client acceptance recorded.')}
                >
                  Record client acceptance
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted small">No signed CMS service scope yet.</p>
        )}
        {manager && c.siteIds.length > 0 && !editing && (
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              {svc ? 'Record a new signed scope (starts the checks again)' : 'Record the signed CMS scope'}
            </button>
          </div>
        )}
        {editing && (
          <div style={{ display: 'grid', gap: 6 }}>
            {sites.map((x, i) => (
              <div key={x.siteId} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <label className="small">
                  <input type="checkbox" checked={x.on} onChange={(e) => setSites(sites.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} /> {name(x.siteId)}
                </label>
                <input className="input" style={{ width: 80 }} aria-label={`From, ${name(x.siteId)}`} value={x.from} onChange={(e) => setSites(sites.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)))} />
                <span className="small">to</span>
                <input className="input" style={{ width: 80 }} aria-label={`To, ${name(x.siteId)}`} value={x.to} onChange={(e) => setSites(sites.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)))} />
              </div>
            ))}
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {(Object.keys(CMS_SERVICE_KINDS) as CmsServiceKind[]).map((k) => (
                <label key={k} className="small">
                  <input type="checkbox" checked={services.includes(k)} onChange={(e) => setServices(e.target.checked ? [...services, k] : services.filter((x) => x !== k))} />{' '}
                  {CMS_SERVICE_KINDS[k]}
                </label>
              ))}
            </div>
            <input className="input" aria-label="Signed document reference" placeholder="Signed CMS service document reference" value={signedRef} onChange={(e) => setSignedRef(e.target.value)} />
            <input className="input" aria-label="Client signatory" placeholder="Client signatory's name" value={signatory} onChange={(e) => setSignatory(e.target.value)} />
            <input className="input" type="date" aria-label="Signed on" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" disabled={act.busy} onClick={save}>
                Save signed scope
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
