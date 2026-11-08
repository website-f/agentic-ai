import { Select } from '../SearchSelect';
import { useEffect, useRef, useState } from 'react';
import { CalendarCheckIcon, HandshakeIcon, LinkBreakIcon, PlusIcon, ReceiptIcon, RocketLaunchIcon } from '@phosphor-icons/react';
import {
  BILLING_METHOD_LABEL,
  CMS_SERVICE_KINDS,
  MOB_OWNER_LABEL,
  MOB_WORKSTREAM_LABEL,
  PAPER_FIELD_LABEL,
  extractPdfText,
  type BillingMethod,
  type CmsServiceKind,
  type ContractState,
  type MobOwner,
  type MobWorkstream,
  type PaperField,
  type ProofInput,
} from '@prima/core';
import { api, type ContractBoard, type PaperReadingResult } from '../api';
import { Card, Empty, Facts, PageHead, Search, Stat, Stats, Steps, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { useApp } from '../App';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { DocList, ProofPicker } from './Proof';
import { InstructionsSection } from './ClientQuality';
import '../styles/biz.css';

/**
 * Contracts and site mobilisation (V3, V6 amendment). A signed contract or letter of award opens mobilisation against
 * 12 workstreams (W12 CMS activation, masterplan §191); the company manager signs the Site Ready-to-Operate Certificate once every critical item is done;
 * reviews follow at day 1, 7, 14 and 30. Billing follows the contract's method and changes only by a signed variation.
 */

type Row = ContractBoard['rows'][number];
type Item = Row['contract']['mobilisation'][number];
type AddOption = ContractBoard['canAdd'][number];

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
const todayMyt = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const WS = Object.keys(MOB_WORKSTREAM_LABEL) as MobWorkstream[];
const AUTO_LABEL = { roster: 'Roster', guard_clearance: 'Guard clearance', client_contacts: 'Client contacts' } as const;
/** Another screen (Clients) may ask this one to open a contract. */
export const OPEN_CONTRACT_KEY = 'prima.openContract';

export function ContractsView() {
  const { data, error } = useLoad(() => api.contracts(), []);
  const [filter, setFilter] = useState<Filter>('attention');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    try {
      const id = sessionStorage.getItem(OPEN_CONTRACT_KEY);
      if (id) {
        sessionStorage.removeItem(OPEN_CONTRACT_KEY);
        setOpen(id);
        setFilter('all');
      }
    } catch {
      /* private window: nothing to open */
    }
  }, []);
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
          ? ['awarded', 'mobilising', 'ready'].includes(r.contract.state) || r.rounds.some((x) => !x.certified)
          : filter === 'live'
            ? r.contract.state === 'active'
            : true),
  );
  const mobilising = data.rows.filter((r) => ['awarded', 'mobilising', 'ready'].includes(r.contract.state));
  const expanding = data.rows.filter((r) => r.contract.state !== 'terminated' && r.rounds.some((x) => !x.certified));
  const mismatch = data.rows.filter((r) => r.lastInvoice?.mismatch || (r.lastInvoice && r.lastInvoice.invoiced == null));
  const live = data.rows.filter((r) => r.contract.state === 'active');
  const loose = data.rows.filter((r) => !r.client && r.contract.state !== 'terminated');
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
          value={mobilising.length + expanding.length}
          tone={mobilising.some((r) => r.tone === 'crit') ? 'crit' : mobilising.length || expanding.length ? 'warn' : 'ok'}
          note={`${mobilising.filter((r) => r.daysToStart <= data.rule.startWarnDays).length} start within ${data.rule.startWarnDays} days${expanding.length ? ` · ${expanding.length} expansion${expanding.length === 1 ? '' : 's'}` : ''}`}
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
        <Stat label="Not tied to a client" value={loose.length} tone={loose.length ? 'warn' : 'ok'} note="Tie it to the client in Clients" icon={<LinkBreakIcon size={16} />} />
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
      {row && <ContractDrawer row={row} options={data.canAdd} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ContractLine({ r, multi, onOpen }: { r: Row; multi: boolean; onOpen: () => void }) {
  const c = r.contract;
  const mob = ['awarded', 'mobilising'].includes(c.state);
  const openRound = r.rounds.find((x) => !x.certified);
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
        {openRound && (
          <span className="bz-ct-prog">
            <span className="bz-meter">
              <span style={{ width: `${pct(openRound.progress.done, openRound.progress.total)}%` }} />
            </span>
            <span className="bz-sub">
              Expansion {openRound.round - 1}: {openRound.progress.done} of {openRound.progress.total} done, starts {dateLabel(openRound.startOn)}
            </span>
          </span>
        )}
        {(r.reviewsDue.length > 0 || r.lastInvoice?.mismatch || !r.client) && (
          <span className="bz-chips">
            {r.reviewsDue.length > 0 && <Chip tone="warn">Day {r.reviewsDue.map((x) => x.day).join(', ')} review due</Chip>}
            {r.lastInvoice?.mismatch && (
              <Chip tone="warn">
                {r.lastInvoice.period} invoice {rm(r.lastInvoice.invoiced ?? 0)} against {rm(r.lastInvoice.expected)}
              </Chip>
            )}
            {!r.client && <Chip tone="warn">Not tied to a client</Chip>}
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

function ContractDrawer({ row: r, options, onClose }: { row: Row; options: AddOption[]; onClose: () => void }) {
  const c = r.contract;
  const act = useAction();
  const [note, setNote] = useState('');
  const [panel, setPanel] = useState<null | 'variation' | 'renew' | 'client' | 'item'>(null);
  const [round, setRound] = useState<number>(r.checks?.round ?? 1);
  const manager = r.role === 'manager';
  const works = r.role === 'manager' || r.role === 'staff';
  const today = todayMyt();
  const step = (action: Parameters<typeof api.contractStep>[1], done: string) => act.run(() => api.contractStep(c.id, action, note), done);
  const opt = options.find((o) => o.companyId === c.companyId) ?? null;
  const rounds = [1, ...r.rounds.map((x) => x.round)];
  const shown = c.mobilisation.filter((i) => (i.round ?? 1) === round);
  const shownDone = shown.filter((i) => i.status === 'done').length;
  const roundInfo = r.rounds.find((x) => x.round === round) ?? null;
  const roundOpen = round === 1 ? ['awarded', 'mobilising'].includes(c.state) : !!roundInfo && !roundInfo.certified;
  const toggle = (p: typeof panel) => setPanel(panel === p ? null : p);
  const paperName = c.paper ? (c.paper.kind === 'loa' ? 'Letter of award' : 'Signed contract') : 'Paper';
  return (
    <Drawer title={c.clientName} sub={`${r.companyName} · ${c.ref} · ${dateLabel(c.startOn)} to ${dateLabel(c.endOn)}`} onClose={onClose}>
      <div className="bz-chips">
        <Chip tone={STATE[c.state][0]}>{STATE[c.state][1]}</Chip>
        {c.paper && <Chip tone="neutral">{c.paper.kind === 'loa' ? 'Letter of award' : 'Signed contract'}</Chip>}
        {c.rtoCert && <Chip tone="ok">Ready-to-Operate signed {dateLabel(c.rtoCert.at.slice(0, 10))}</Chip>}
        {['awarded', 'mobilising'].includes(c.state) && (
          <Chip tone={r.daysToStart < 0 ? 'crit' : 'warn'}>{r.daysToStart < 0 ? `Start ${-r.daysToStart} days late` : `Starts in ${r.daysToStart} days`}</Chip>
        )}
        {!r.client && <Chip tone="warn">Not tied to a client</Chip>}
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
              <button className="btn btn-sm" aria-expanded={panel === 'variation'} onClick={() => toggle('variation')}>
                Record a variation
              </button>
              <button className="btn btn-sm" aria-expanded={panel === 'renew'} onClick={() => toggle('renew')}>
                Record a renewal
              </button>
              {!r.client && opt && (
                <button className="btn btn-sm" aria-expanded={panel === 'client'} onClick={() => toggle('client')}>
                  Tie to a client
                </button>
              )}
            </div>
            {c.state === 'mobilising' && !r.canCertify && (
              <p className="bz-note">Sign only when every critical item is done and every other item due by the start is done or its risk accepted.</p>
            )}
          </div>
          {panel === 'variation' && <VariationForm row={r} option={opt} onDone={() => setPanel(null)} />}
          {panel === 'renew' && <RenewForm row={r} onDone={() => setPanel(null)} />}
          {panel === 'client' && opt && <TieClientForm row={r} option={opt} onDone={() => setPanel(null)} />}
        </section>
      )}

      <section className="bz-sec">
        <h3>Terms</h3>
        <ul className="bz-ct-lines">
          <li>
            <span>{paperName}</span>
            <span>
              <span className="mono">{c.ref}</span>
              {c.paper?.poRef ? ` · client PO ${c.paper.poRef}` : ''}
            </span>
          </li>
          {c.terms ? (
            <>
              <li>
                <span>Payment and notice</span>
                <span>
                  within {c.terms.paymentDays} days · notice {c.terms.noticeDays} days
                </span>
              </li>
              <li>
                <span>Bond</span>
                <span>{c.terms.bond ? `${rm(c.terms.bond.amount)} (${c.terms.bond.ref}) until ${dateLabel(c.terms.bond.expiresOn)}` : 'No bond'}</span>
              </li>
            </>
          ) : (
            <li>
              <span>Payment and notice</span>
              <span className="bz-sub">Not recorded</span>
            </li>
          )}
          <li>
            <span>Client in Clients</span>
            <span>{r.client ? `${r.client.name}, contract ends ${dateLabel(r.client.contractEndsOn)}` : 'Not tied yet'}</span>
          </li>
          {r.sites.length > 0 && (
            <li>
              <span>Sites</span>
              <span>{r.sites.map((s) => s.name).join(', ')}</span>
            </li>
          )}
        </ul>
      </section>

      <section className="bz-sec">
        <div className="bz-sec-head">
          <h3>Billing</h3>
          <span className="bz-sub">
            v{r.current.version} from {dateLabel(r.current.effectiveFrom)} · {BILLING_METHOD_LABEL[r.current.billingMethod]}
          </span>
        </div>
        <ul className="bz-ct-lines">
          {r.billing.lines.map((l, k) => (
            <li key={`${l.label}-${k}`}>
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

      {r.checks && (
        <section className="bz-sec">
          <div className="bz-sec-head">
            <h3>Checked by the system</h3>
            <span className="bz-sub">{r.checks.round === 1 ? 'First mobilisation' : `Expansion ${r.checks.round - 1}`}</span>
          </div>
          <ul className="bz-ct-items">
            {(['roster', 'guard_clearance', 'client_contacts'] as const).map((k) => (
              <li key={k} className="bz-ct-item" data-state={r.checks![k].ok ? 'done' : undefined}>
                <div className="bz-ct-item-top">
                  <div className="bz-row-main">
                    <span className="bz-ct-item-label">{AUTO_LABEL[k]}</span>
                    <span className="bz-row-meta">{r.checks![k].detail}</span>
                    {k === 'guard_clearance' &&
                      r.checks!.guard_clearance.blocked.slice(0, 10).map((b) => (
                        <span key={b.name} className="bz-row-meta">
                          {b.name}: {b.reasons.join(' ')}
                        </span>
                      ))}
                  </div>
                  <Chip tone={r.checks![k].ok ? 'ok' : 'warn'}>{r.checks![k].ok ? 'Passes' : 'Not yet'}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bz-sec">
        <div className="bz-sec-head">
          <h3>Mobilisation</h3>
          <span className="bz-sub">
            {shownDone} of {shown.length} done
          </span>
        </div>
        {rounds.length > 1 && (
          <div className="tabbar" role="tablist" aria-label="Mobilisation round">
            {rounds.map((n) => (
              <button key={n} role="tab" aria-selected={round === n} onClick={() => setRound(n)}>
                {n === 1 ? 'First mobilisation' : `Expansion ${n - 1}`}
              </button>
            ))}
          </div>
        )}
        <span className="bz-meter">
          <span style={{ width: `${pct(shownDone, shown.length)}%` }} />
        </span>
        {roundInfo && (
          <div className="bz-act">
            <p className="bz-note">
              {roundInfo.reason} ({roundInfo.signedRef}) · starts {dateLabel(roundInfo.startOn)}
              {roundInfo.certified ? ` · certified ready by ${roundInfo.certified.by}, ${dateLabel(roundInfo.certified.at.slice(0, 10))}` : ''}
            </p>
            {manager && !roundInfo.certified && (
              <div className="bz-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !roundInfo.canCertify}
                  onClick={() => act.run(() => api.certifyContractRound(c.id, roundInfo.round, note), 'Expansion certified ready.')}
                >
                  Sign Ready-to-Operate for the expansion
                </button>
              </div>
            )}
          </div>
        )}
        {WS.filter((w) => shown.some((i) => i.workstream === w)).map((w) => (
          <div key={w}>
            <span className="label">
              {w} {MOB_WORKSTREAM_LABEL[w]}
            </span>
            <ul className="bz-ct-items">
              {shown
                .filter((i) => i.workstream === w)
                .map((i) => (
                  <MobLine key={i.id} row={r} item={i} works={works && roundOpen && c.state !== 'terminated'} manager={manager} />
                ))}
            </ul>
          </div>
        ))}
        {manager && roundOpen && (
          <>
            <div className="bz-actions">
              <button className="btn btn-ghost btn-sm" aria-expanded={panel === 'item'} onClick={() => toggle('item')}>
                Add an item for this site
              </button>
            </div>
            {panel === 'item' && <AddItemForm contractId={c.id} round={round} onDone={() => setPanel(null)} />}
          </>
        )}
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
      {/* Operations outside its own area watches the contract but does not open its papers. */}
      {!(r.opsOnly && r.role === 'view') && <ProofSection id={c.id} />}
      <InstructionsSection siteIds={[...new Set([...c.siteIds, ...r.rounds.flatMap((x) => x.siteIds)])]} />
      <section className="bz-sec">
        <h3>History</h3>
        <ul className="bz-ct-tl">
          {c.history.map((h, k) => (
            <li key={`${h.at}-${k}`}>
              <span className="bz-ct-tl-top">
                <strong>{h.from && h.from !== h.to ? `${STATE[h.from][1]} to ${STATE[h.to][1]}` : h.from ? 'Note' : STATE[h.to][1]}</strong>
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

/** The copies kept with the contract: the signed paper, item proof, variations and renewals. Loaded when asked. */
function ProofSection({ id }: { id: string }) {
  const [show, setShow] = useState(false);
  return (
    <section className="bz-sec">
      <div className="bz-sec-head">
        <h3>Papers and proof</h3>
        <button className="btn btn-ghost btn-sm" aria-expanded={show} onClick={() => setShow(!show)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {show && <ProofList id={id} />}
    </section>
  );
}

function ProofList({ id }: { id: string }) {
  const { data, error } = useLoad(() => api.contractProof(id), [id]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="papers" />;
  if (!data.docs.length && !data.photos.length) return <p className="bz-note">No papers yet.</p>;
  return (
    <>
      <DocList docs={data.docs} />
      {data.photos.length > 0 && (
        <ul className="bz-ct-tl">
          {data.photos.map((p) => (
            <li key={p.id}>
              <span className="bz-row-meta">
                Photo {p.caption ? `"${p.caption}" ` : ''}· {p.takenBy} · {dateTimeLabel(p.receivedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MobLine({ row: r, item: i, works, manager }: { row: Row; item: Item; works: boolean; manager: boolean }) {
  const act = useAction();
  const [mode, setMode] = useState<null | 'done' | 'open' | 'accept'>(null);
  const [why, setWhy] = useState('');
  const [until, setUntil] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const today = todayMyt();
  const late = i.status !== 'done' && i.dueOn < today && !(i.status === 'risk_accepted' && (i.acceptedUntil ?? '') >= today);
  const owner = (i.owner ?? 'company') as MobOwner;
  // Operations works the site items; the company office records the rest.
  const mayWork = works && (!r.opsOnly || owner === 'operations');
  const check = i.auto && r.checks ? r.checks[i.auto] : null;
  const site = r.sites[0] ? { code: r.sites[0].code, lat: r.sites[0].lat, lng: r.sites[0].lng } : null;
  const close = () => {
    setMode(null);
    setWhy('');
    setProof([]);
  };
  return (
    <li className="bz-ct-item" data-state={i.status === 'done' ? 'done' : late ? 'late' : undefined}>
      <div className="bz-ct-item-top">
        <div className="bz-row-main">
          <span className="bz-ct-item-label">
            {i.label}
            {i.critical ? <strong className="bz-ct-crit"> · critical</strong> : null}
            {i.extra ? <span className="bz-sub"> · added</span> : null}
          </span>
          <span className="bz-row-meta">
            {MOB_OWNER_LABEL[owner]} · due {dateLabel(i.dueOn)}
            {i.auto ? ' · checked by the system' : ''}
            {i.status === 'done' && i.by ? ` · done by ${i.by}${i.at ? `, ${dateLabel(i.at.slice(0, 10))}` : ''}${i.proofIds?.length ? `, ${i.proofIds.length} proof` : ''}` : ''}
            {i.status === 'done' && i.note ? `: ${i.note}` : ''}
            {i.status === 'risk_accepted' ? ` · risk accepted until ${dateLabel(i.acceptedUntil)} by ${i.by}: ${i.note}` : ''}
          </span>
          {i.check === 'cms_activation' && i.status === 'open' && (
            <span className="bz-row-meta">
              Prima checks this before it can be marked done: each site has a CCTV or alarm panel linked and tested, CMS has heard from it in the last 24 hours (a test alarm
              counts), and CMS has a site supervisor, the company manager and a Regional OM to call. It is a technical check only: it does not confirm a signed CMS service
              scope, the client's or operator's acceptance, or that the phone numbers were verified.
            </span>
          )}
          {check && i.status !== 'done' && <span className="bz-row-meta">{check.detail}</span>}
        </div>
        <Chip tone={i.status === 'done' ? 'ok' : late ? 'crit' : i.status === 'risk_accepted' ? 'warn' : 'neutral'}>
          {i.status === 'done' ? 'Done' : late ? 'Overdue' : i.status === 'risk_accepted' ? 'Risk accepted' : 'Open'}
        </Chip>
      </div>
      {mayWork && !mode && (
        <div className="bz-actions">
          {i.status !== 'done' ? (
            i.auto ? (
              <button className="btn btn-sm" disabled={act.busy || !check?.ok} onClick={() => act.run(() => api.setMobItem(r.contract.id, i.id, 'done', '', null), 'Checked and done.')}>
                Mark done (checked)
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => setMode('done')}>
                Mark done
              </button>
            )
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setMode('open')}>
              Open again
            </button>
          )}
          {manager && !i.critical && i.status === 'open' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setMode('accept')}>
              Accept risk
            </button>
          )}
        </div>
      )}
      {mode === 'done' && (
        <div className="bz-act">
          <ProofPicker site={site} refText={`${r.contract.ref} ${i.label}`} items={proof} onChange={setProof} required />
          <label className="field">
            <span className="label">Note (optional)</span>
            <input className="input" aria-label="Note" value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <div className="bz-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length}
              onClick={async () => {
                const ok = await act.run(() => api.setMobItem(r.contract.id, i.id, 'done', why, null, proof), 'Done.');
                if (ok) close();
              }}
            >
              Save as done
            </button>
            <button className="btn btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === 'open' && (
        <div className="bz-act">
          <label className="field">
            <span className="label">Why it is opened again</span>
            <input className="input" aria-label="Why" value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || why.trim().length < 3}
              onClick={async () => {
                const ok = await act.run(() => api.setMobItem(r.contract.id, i.id, 'open', why, null), 'Opened again.');
                if (ok) close();
              }}
            >
              Open again
            </button>
            <button className="btn btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === 'accept' && (
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
              onClick={async () => {
                const ok = await act.run(() => api.setMobItem(r.contract.id, i.id, 'risk_accepted', why, until), 'Risk accepted.');
                if (ok) close();
              }}
            >
              Accept
            </button>
            <button className="btn btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </li>
  );
}

function AddItemForm({ contractId, round, onDone }: { contractId: string; round: number; onDone: () => void }) {
  const act = useAction();
  const [ws, setWs] = useState<MobWorkstream>('W4');
  const [owner, setOwner] = useState<MobOwner>('operations');
  const [label, setLabel] = useState('');
  const [due, setDue] = useState('');
  const [critical, setCritical] = useState(false);
  return (
    <div className="bz-act">
      <div className="bz-form">
        <label className="field">
          <span className="label">Workstream</span>
          <Select className="select" aria-label="Workstream" value={ws} onChange={(e) => setWs(e.target.value as MobWorkstream)}>
            {WS.map((w) => (
              <option key={w} value={w}>
                {w} {MOB_WORKSTREAM_LABEL[w]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Who does it</span>
          <Select className="select" aria-label="Who does it" value={owner} onChange={(e) => setOwner(e.target.value as MobOwner)}>
            {(Object.keys(MOB_OWNER_LABEL) as MobOwner[]).map((o) => (
              <option key={o} value={o}>
                {MOB_OWNER_LABEL[o]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field bz-span">
          <span className="label">What has to be done</span>
          <input className="input" aria-label="What has to be done" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Due</span>
          <input className="input" type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="bz-ct-check">
          <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
          Critical: the site cannot go live without it
        </label>
      </div>
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || label.trim().length < 5 || !due}
          onClick={async () => {
            const ok = await act.run(() => api.addMobItem(contractId, { workstream: ws, owner, label, dueOn: due, critical, round }), 'Item added.');
            if (ok) onDone();
          }}
        >
          Add item
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
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

// ---------- Posts and rates, shared by the new contract and the variation ----------

type PostLine = { postId: string | null; label: string; guards: string; hoursPerDay: string; rate: string; armed: boolean; contractedHours: string };

function PostsEditor({ method, lines, onChange }: { method: BillingMethod; lines: PostLine[]; onChange: (l: PostLine[]) => void }) {
  const set = (k: number, patch: Partial<PostLine>) => onChange(lines.map((l, j) => (j === k ? { ...l, ...patch } : l)));
  return (
    <fieldset className="bz-span bz-ct-sites">
      <legend className="label">Posts as in the contract{method === 'FIXED' ? ' (the fixed fee covers them all)' : ''}</legend>
      {lines.map((l, k) => (
        <div key={k} className="bz-act">
          <label className="field">
            <span className="label">Post name</span>
            <input className="input" aria-label="Post name" value={l.label} onChange={(e) => set(k, { label: e.target.value })} />
          </label>
          <div className="bz-form">
            <label className="field">
              <span className="label">Guards</span>
              <input className="input" inputMode="numeric" aria-label="Guards" value={l.guards} onChange={(e) => set(k, { guards: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Hours a day</span>
              <input className="input" inputMode="numeric" aria-label="Hours a day" value={l.hoursPerDay} onChange={(e) => set(k, { hoursPerDay: e.target.value })} />
            </label>
            {method !== 'FIXED' && (
              <label className="field">
                <span className="label">RM a guard-hour</span>
                <input className="input" inputMode="decimal" aria-label="Rate" value={l.rate} onChange={(e) => set(k, { rate: e.target.value })} />
              </label>
            )}
            {method === 'M2' && (
              <label className="field">
                <span className="label">Hours a month</span>
                <input className="input" inputMode="numeric" aria-label="Contracted hours" value={l.contractedHours} onChange={(e) => set(k, { contractedHours: e.target.value })} />
              </label>
            )}
          </div>
          <div className="bz-actions">
            <label className="bz-ct-check">
              <input type="checkbox" checked={l.armed} onChange={(e) => set(k, { armed: e.target.checked })} />
              Armed
            </label>
            <button className="btn btn-ghost btn-sm" onClick={() => onChange(lines.filter((_, j) => j !== k))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="bz-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...lines, { postId: null, label: '', guards: '1', hoursPerDay: '12', rate: lines[0]?.rate ?? '', armed: false, contractedHours: '312' }])}
        >
          Add a post
        </button>
      </div>
    </fieldset>
  );
}

const toPosts = (lines: PostLine[]) =>
  lines.map((l) => ({
    postId: l.postId,
    label: l.label,
    guards: Number(l.guards),
    hoursPerDay: Number(l.hoursPerDay),
    rate: Number(l.rate || 0),
    armed: l.armed,
    contractedHours: l.contractedHours ? Number(l.contractedHours) : null,
  }));

function VariationForm({ row: r, option, onDone }: { row: Row; option: AddOption | null; onDone: () => void }) {
  const act = useAction();
  const cur = r.contract.versions[r.contract.versions.length - 1];
  const [method, setMethod] = useState<BillingMethod>(cur.billingMethod);
  const [from, setFrom] = useState('');
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState(cur.fixedFee ? String(cur.fixedFee) : '');
  const [lines, setLines] = useState<PostLine[]>(
    cur.posts.map((p) => ({
      postId: p.postId,
      label: p.label,
      guards: String(p.guards),
      hoursPerDay: String(p.hoursPerDay),
      rate: String(p.rate || ''),
      armed: p.armed,
      contractedHours: String(p.contractedHours ?? 312),
    })),
  );
  const [addSites, setAddSites] = useState<string[]>([]);
  const [expansion, setExpansion] = useState(false);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const others = option?.sites.filter((s) => !r.contract.siteIds.includes(s.id)) ?? [];
  const live = !['awarded', 'mobilising'].includes(r.contract.state);
  return (
    <div className="bz-act">
      <span className="label">Variation</span>
      <div className="bz-form">
        <label className="field">
          <span className="label">Billing method</span>
          <Select className="select" aria-label="Billing method" value={method} onChange={(e) => setMethod(e.target.value as BillingMethod)}>
            {Object.entries(BILLING_METHOD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        {method === 'FIXED' && (
          <label className="field">
            <span className="label">Fixed monthly fee, RM</span>
            <input className="input" inputMode="decimal" aria-label="Fixed fee" placeholder="Fixed monthly fee, RM" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        )}
        <PostsEditor method={method} lines={lines} onChange={setLines} />
        {others.length > 0 && (
          <fieldset className="bz-span bz-ct-sites">
            <legend className="label">Sites the variation adds</legend>
            {others.map((x) => (
              <label key={x.id} className="bz-ct-check">
                <input type="checkbox" checked={addSites.includes(x.id)} onChange={(e) => setAddSites(e.target.checked ? [...addSites, x.id] : addSites.filter((id) => id !== x.id))} />
                {x.name}
              </label>
            ))}
          </fieldset>
        )}
        {live && (
          <label className="bz-ct-check bz-span">
            <input type="checkbox" checked={expansion || addSites.length > 0} disabled={addSites.length > 0} onChange={(e) => setExpansion(e.target.checked)} />
            More guards or armed posts: mobilise the change before it starts
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
        <div className="bz-span">
          <ProofPicker site={null} refText={`${r.contract.ref} variation`} items={proof} onChange={setProof} documentsOnly required />
        </div>
      </div>
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !from || !ref.trim() || !reason.trim() || !proof.length}
          onClick={async () => {
            const ok = await act.run(
              () =>
                api.addContractVariation(r.contract.id, {
                  effectiveFrom: from,
                  billingMethod: method,
                  posts: toPosts(lines).map((p) => ({ ...p, contractedHours: p.contractedHours ?? undefined })),
                  fixedFee: method === 'FIXED' ? Number(fee) : null,
                  signedRef: ref,
                  reason,
                  proof,
                  addSiteIds: addSites,
                  expansion,
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

function RenewForm({ row: r, onDone }: { row: Row; onDone: () => void }) {
  const act = useAction();
  const [end, setEnd] = useState('');
  const [ref, setRef] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  return (
    <div className="bz-act">
      <span className="label">Renewal</span>
      <p className="bz-note">A renewal signed through Clients moves the end date by itself. Use this for one signed another way. A new price needs its own variation.</p>
      <div className="bz-form">
        <label className="field">
          <span className="label">New end date (now {dateLabel(r.contract.endOn)})</span>
          <input className="input" type="date" aria-label="New end date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Signed renewal reference</span>
          <input className="input" aria-label="Signed renewal reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <div className="bz-span">
          <ProofPicker site={null} refText={`${r.contract.ref} renewal`} items={proof} onChange={setProof} documentsOnly required />
        </div>
      </div>
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !end || !ref.trim() || !proof.length}
          onClick={async () => {
            const ok = await act.run(() => api.renewContract(r.contract.id, { newEndOn: end, signedRef: ref, proof }), 'Renewal recorded.');
            if (ok) onDone();
          }}
        >
          Save renewal
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function TieClientForm({ row: r, option, onDone }: { row: Row; option: AddOption; onDone: () => void }) {
  const act = useAction();
  const [id, setId] = useState('');
  return (
    <div className="bz-act">
      <label className="field">
        <span className="label">Client</span>
        <Select className="select" aria-label="Client" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose the client in Clients</option>
          {option.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <p className="bz-note">Not on the list? Open the client in Clients first (a won lead opens as a client there).</p>
      <div className="bz-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !id}
          onClick={async () => {
            const ok = await act.run(() => api.linkContractClient(r.contract.id, id), 'Tied to the client.');
            if (ok) onDone();
          }}
        >
          Tie to this client
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Unpack a PDF stream with the browser's own inflate; a stream with junk after its end keeps what was unpacked. */
async function inflate(b: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
      if (size > 8_000_000) break;
    }
  } catch {
    if (!parts.length) throw new Error('unreadable');
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const x of parts) {
    out.set(x, at);
    at += x.length;
  }
  return out;
}

/** The words in an attached PDF copy, read here on the device. A photo or scanned paper has none. */
async function wordsOf(proof: ProofInput[]): Promise<string> {
  for (const p of proof) {
    if (p.kind !== 'document' || !/^data:application\/pdf;base64,/.test(p.data)) continue;
    const bin = atob(p.data.slice(p.data.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const text = await extractPdfText(bytes, inflate);
    if (text.replace(/\s/g, '').length >= 40) return text;
  }
  return '';
}

const FLAG_TONE = { warn: 'warn', info: 'info' } as const;

/**
 * Help with the attached paper: read it, propose values for the form with the words each came from, and point at
 * clauses to look at twice. Nothing is filled until the manager presses Use, and nothing is saved until Save contract.
 */
function PaperHelp({
  proof,
  companyId,
  clientId,
  current,
  onUse,
}: {
  proof: ProofInput[];
  companyId: string;
  clientId: string;
  current: Partial<Record<PaperField, string>>;
  onUse: (field: PaperField, value: string) => void;
}) {
  // Reading saves nothing, so the screen is not refreshed after it (the form keeps what is typed).
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; findings: [] } | null>(null);
  const [reading, setReading] = useState<PaperReadingResult | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [noWords, setNoWords] = useState(false);
  const read = async (text: string) => {
    setError(null);
    try {
      const r = await api.readContractPaper({ companyId, clientAccountId: clientId || null, text });
      setReading(r);
      setNoWords(r.flags.some((f) => f.code === 'NO_TEXT'));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), findings: [] });
    }
  };
  const fromCopy = async () => {
    if (busy) return;
    setBusy(true);
    setNoWords(false);
    try {
      const text = await wordsOf(proof).catch(() => '');
      if (!text) {
        setReading(null);
        setNoWords(true);
        setPaste((p) => p ?? '');
        return;
      }
      await read(text);
    } finally {
      setBusy(false);
    }
  };
  const readPaste = async (text: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await read(text);
    } finally {
      setBusy(false);
    }
  };
  const hasPdf = proof.some((p) => p.kind === 'document' && /^data:application\/pdf/.test(p.data));
  const same = (f: PaperField, v: string) => {
    const c = (current[f] ?? '').trim();
    return c !== '' && (c === v || (Number.isFinite(Number(c)) && Number(c) === Number(v)));
  };
  const usable = reading?.values.filter((v) => v.field in current && !same(v.field, v.value)) ?? [];
  return (
    <div className="bz-act bz-span">
      <div className="bz-sec-head">
        <span className="label">Help from the paper</span>
        <div className="bz-actions">
          <button className="btn btn-ghost btn-sm" disabled={busy || !hasPdf} onClick={fromCopy}>
            {busy ? 'Reading…' : 'Read the attached copy'}
          </button>
          {paste == null && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPaste('')}>
              Paste the text instead
            </button>
          )}
        </div>
      </div>
      {!hasPdf && paste == null && (
        <p className="bz-note">Attach the PDF copy above, then read it: the dates, posts, rates, terms and clauses to check are picked out with the words they came from.</p>
      )}
      {noWords && (
        <div className="notice small" data-tone="warn">
          No words could be read from this copy. A scanned paper or photo is a picture: type the details from it, or paste its text below.
        </div>
      )}
      {paste != null && (
        <>
          <label className="field">
            <span className="label">Text of the paper</span>
            <textarea className="textarea" aria-label="Text of the paper" rows={4} placeholder="Paste the text of the contract or letter of award" value={paste} onChange={(e) => setPaste(e.target.value)} />
          </label>
          <div className="bz-actions">
            <button className="btn btn-ghost btn-sm" disabled={busy || paste.trim().length < 40} onClick={() => readPaste(paste)}>
              Read this text
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={error} />
      {reading && !noWords && (
        <>
          <p className="bz-note">
            Suggestions only. Check each one against the paper, then press Use. Nothing is saved until you press Save contract. The paper's words are not kept.
            {reading.quotation ? ` Compared with quotation ${reading.quotation.ref}.` : ''}
          </p>
          {reading.flags.length > 0 && (
            <>
              <span className="label">To look at twice</span>
              <ul className="bz-ct-tl">
                {reading.flags.map((f) => (
                  <li key={f.code}>
                    <span>
                      <Chip tone={FLAG_TONE[f.level]}>{f.level === 'warn' ? 'Check' : 'Note'}</Chip> {f.what}
                    </span>
                    {f.quote && (
                      <q className="bz-row-meta" style={{ overflowWrap: 'anywhere' }}>
                        {f.quote}
                      </q>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {reading.values.length === 0 ? (
            <p className="bz-note">No values could be picked out. Type them from the paper.</p>
          ) : (
            <>
              <div className="bz-sec-head">
                <span className="label">Read from the paper</span>
                {usable.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => usable.forEach((v) => onUse(v.field, v.value))}>
                    Use all {usable.length}
                  </button>
                )}
              </div>
              <ul className="bz-ct-items">
                {reading.values.map((v, k) => (
                  <li key={`${v.field}-${k}`} className="bz-ct-item">
                    <div className="bz-ct-item-top">
                      <span>
                        <strong>{PAPER_FIELD_LABEL[v.field]}</strong>:{' '}
                        {v.field === 'paperKind' ? (v.value === 'loa' ? 'Letter of award' : 'Signed contract') : v.field === 'startOn' || v.field === 'endOn' ? dateLabel(v.value) : v.value}
                        {v.by === 'online' && <span className="bz-sub"> (second reading)</span>}
                      </span>
                      {!(v.field in current) ? (
                        <span className="bz-sub">compare with the posts</span>
                      ) : same(v.field, v.value) ? (
                        <Chip tone="ok">In the form</Chip>
                      ) : (
                        <span className="bz-actions">
                          {current[v.field] ? <span className="bz-sub">form: {current[v.field]}</span> : null}
                          <button className="btn btn-ghost btn-sm" onClick={() => onUse(v.field, v.value)}>
                            Use
                          </button>
                        </span>
                      )}
                    </div>
                    <q className="bz-row-meta" style={{ overflowWrap: 'anywhere' }}>
                      {v.quote.length > 200 ? `${v.quote.slice(0, 200)}…` : v.quote}
                    </q>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Record a signed contract or letter of award with its copy; mobilisation opens against its start date (company
 * manager only). Clients opens it with the client already chosen.
 */
export function NewContractForm({ options, onDone, clientId: initialClient }: { options: AddOption[]; onDone: () => void; clientId?: string }) {
  const act = useAction();
  const app = useApp();
  // Start on the client's company when Clients opened the form; otherwise on the company chosen at the top of the app.
  const first = initialClient
    ? (options.find((o) => o.clients.some((c) => c.id === initialClient)) ?? options[0])
    : (options.find((o) => o.companyId === app.companyId) ?? options[0]);
  const [companyId, setCompanyId] = useState(first?.companyId ?? '');
  const co = options.find((o) => o.companyId === companyId) ?? options[0];
  const [paperKind, setPaperKind] = useState<'contract' | 'loa'>('contract');
  const [clientId, setClientId] = useState(initialClient ?? '');
  const [clientName, setClientName] = useState('');
  const [siteIds, setSiteIds] = useState<string[] | null>(null);
  const [startOn, setStartOn] = useState('');
  const [endOn, setEndOn] = useState('');
  const [method, setMethod] = useState<BillingMethod>('M1');
  const [rate, setRate] = useState('');
  const rateRef = useRef('');
  rateRef.current = rate;
  const [fee, setFee] = useState('');
  const [lines, setLines] = useState<PostLine[] | null>(null);
  const [ref, setRef] = useState('');
  const [po, setPo] = useState('');
  const [sla, setSla] = useState({ replaceAbsentMinutes: '60', incidentReportHours: '24', monthlyReportByDay: '7' });
  const [penalties, setPenalties] = useState('');
  const [paymentDays, setPaymentDays] = useState('30');
  const [noticeDays, setNoticeDays] = useState('30');
  const [bond, setBond] = useState({ amount: '', ref: '', expiresOn: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const client = co?.clients.find((c) => c.id === clientId);
  const chosen = siteIds ?? client?.siteIds ?? [];
  // The posts start from the chosen sites' posts, at the rate given; each can be changed as in the contract.
  const fromSites: PostLine[] = (co?.sites ?? [])
    .filter((s) => chosen.includes(s.id))
    .flatMap((s) =>
      s.posts.map((p) => ({ postId: p.id, label: `${s.name}: ${p.name}`, guards: String(p.guardsPerShift), hoursPerDay: '24', rate, armed: s.armed, contractedHours: '312' })),
    );
  const posts = lines ?? fromSites;
  const hasBond = bond.amount.trim() !== '' || bond.ref.trim() !== '';
  // What the form holds now, to compare with what was read from the paper; and how a value read is put in the form.
  const current: Partial<Record<PaperField, string>> = {
    paperKind,
    ref,
    poRef: po,
    startOn,
    endOn,
    monthlyFee: method === 'FIXED' ? fee : '',
    ratePerHour: method === 'FIXED' ? '' : lines ? (lines.every((l) => l.rate === lines[0]?.rate) ? (lines[0]?.rate ?? '') : '') : rate,
    hoursPerDay: posts.length && posts.every((l) => l.hoursPerDay === posts[0].hoursPerDay) ? posts[0].hoursPerDay : '',
    paymentDays,
    noticeDays,
    bondAmount: bond.amount,
    replaceAbsentMinutes: sla.replaceAbsentMinutes,
    incidentReportHours: sla.incidentReportHours,
    penalties,
  };
  if (posts.length <= 1) current.guards = posts[0]?.guards ?? '';
  const use = (field: PaperField, v: string) => {
    // "Use all" puts several values in one go: the rate just used must reach the posts made after it.
    const r = rateRef.current;
    const base = (posts.length ? posts : [{ postId: null, label: 'Main post', guards: '1', hoursPerDay: '24', rate: r, armed: false, contractedHours: '312' }]).map((l) => (lines ? l : { ...l, rate: r }));
    const setPosts = (patch: Partial<PostLine>) => setLines((prev) => (prev ?? base).map((l) => ({ ...l, ...patch })));
    if (field === 'paperKind') setPaperKind(v === 'loa' ? 'loa' : 'contract');
    else if (field === 'ref') setRef(v);
    else if (field === 'poRef') setPo(v);
    else if (field === 'startOn') setStartOn(v);
    else if (field === 'endOn') setEndOn(v);
    else if (field === 'monthlyFee') {
      setMethod('FIXED');
      setFee(v);
    } else if (field === 'ratePerHour') {
      if (method === 'FIXED') setMethod('M1');
      rateRef.current = v;
      setRate(v);
      setLines((prev) => (prev ? prev.map((l) => ({ ...l, rate: v })) : prev));
    } else if (field === 'hoursPerDay') setPosts({ hoursPerDay: v });
    else if (field === 'guards') setPosts({ guards: v });
    else if (field === 'paymentDays') setPaymentDays(v);
    else if (field === 'noticeDays') setNoticeDays(v);
    else if (field === 'bondAmount') setBond((b) => ({ ...b, amount: v }));
    else if (field === 'replaceAbsentMinutes') setSla((x) => ({ ...x, replaceAbsentMinutes: v }));
    else if (field === 'incidentReportHours') setSla((x) => ({ ...x, incidentReportHours: v }));
    else if (field === 'penalties') setPenalties(v);
  };
  if (!co) return null;
  return (
    <Drawer title="New contract" sub="Record the signed contract or letter of award. Mobilisation opens with all 12 workstreams due against the start date." onClose={onDone}>
      <div className="bz-form">
        {options.length > 1 && (
          <label className="field bz-span">
            <span className="label">Company</span>
            <Select
              className="select"
              aria-label="Company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setClientId('');
                setSiteIds(null);
                setLines(null);
              }}
            >
              {options.map((o) => (
                <option key={o.companyId} value={o.companyId}>
                  {o.companyName}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="field bz-span">
          <span className="label">Paper</span>
          <select className="select" aria-label="Paper" value={paperKind} onChange={(e) => setPaperKind(e.target.value as 'contract' | 'loa')}>
            <option value="contract">Signed contract</option>
            <option value="loa">Letter of award (contract to follow)</option>
          </select>
        </label>
        <div className="field bz-span">
          <span className="label">Copy of the signed paper (PDF best)</span>
          <ProofPicker site={null} refText={ref || 'contract'} items={proof} onChange={setProof} documentsOnly required />
        </div>
        <PaperHelp proof={proof} companyId={co.companyId} clientId={clientId} current={current} onUse={use} />
        <label className="field bz-span">
          <span className="label">Client</span>
          <Select
            className="select"
            aria-label="Client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setSiteIds(null);
              setLines(null);
            }}
          >
            <option value="">A client not in Clients yet</option>
            {co.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        {!clientId && (
          <label className="field bz-span">
            <span className="label">Client name</span>
            <input className="input" aria-label="Client name" placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            <span className="bz-note">Better: open the client in Clients first (a won lead opens as a client there), then choose it here.</span>
          </label>
        )}
        <fieldset className="bz-span bz-ct-sites">
          <legend className="label">Sites under this contract</legend>
          {co.sites.length === 0 && (
            <span className="bz-note">
              No sites yet. Add the site first so the contract carries its posts; saved without a site it bills one main post.{' '}
              <RecordButton kind="site" companyId={co.companyId} label="Add site" />
            </span>
          )}
          {co.sites.map((x) => (
            <label key={x.id} className="bz-ct-check">
              <input
                type="checkbox"
                checked={chosen.includes(x.id)}
                onChange={(e) => {
                  setSiteIds(e.target.checked ? [...chosen, x.id] : chosen.filter((id) => id !== x.id));
                  setLines(null);
                }}
              />
              {x.name}
              {x.armed ? ' (armed)' : ''}
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
          <Select className="select" aria-label="Billing method" value={method} onChange={(e) => setMethod(e.target.value as BillingMethod)}>
            {Object.entries(BILLING_METHOD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        {method === 'FIXED' ? (
          <label className="field">
            <span className="label">Fixed monthly fee, RM</span>
            <input className="input" inputMode="decimal" aria-label="Fixed fee" placeholder="Fixed monthly fee, RM" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        ) : (
          lines == null && (
            <label className="field">
              <span className="label">Rate per guard-hour for every post, RM</span>
              <input className="input" inputMode="decimal" aria-label="Rate" placeholder="Rate per guard-hour, RM" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
          )
        )}
        {posts.length > 0 || lines ? (
          <PostsEditor method={method} lines={posts} onChange={setLines} />
        ) : (
          <div className="bz-span bz-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setLines([{ postId: null, label: 'Main post', guards: '1', hoursPerDay: '24', rate, armed: false, contractedHours: '312' }])}>
              Add the posts
            </button>
          </div>
        )}
        <span className="label bz-span">Service levels and penalties in the contract</span>
        <label className="field">
          <span className="label">Replace absent guard, minutes</span>
          <input className="input" inputMode="numeric" aria-label="Replace absent guard within minutes" value={sla.replaceAbsentMinutes} onChange={(e) => setSla({ ...sla, replaceAbsentMinutes: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Incident report, hours</span>
          <input className="input" inputMode="numeric" aria-label="Incident report within hours" value={sla.incidentReportHours} onChange={(e) => setSla({ ...sla, incidentReportHours: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Monthly report by day</span>
          <input className="input" inputMode="numeric" aria-label="Monthly report by day" value={sla.monthlyReportByDay} onChange={(e) => setSla({ ...sla, monthlyReportByDay: e.target.value })} />
        </label>
        <label className="field bz-span">
          <span className="label">Penalties (as written in the contract)</span>
          <input className="input" aria-label="Penalties" value={penalties} onChange={(e) => setPenalties(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Payment within, days</span>
          <input className="input" inputMode="numeric" aria-label="Payment within days" value={paymentDays} onChange={(e) => setPaymentDays(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Notice, days</span>
          <input className="input" inputMode="numeric" aria-label="Notice days" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} />
        </label>
        <span className="label bz-span">Performance bond or bank guarantee, if the contract asks</span>
        <label className="field">
          <span className="label">Bond amount, RM</span>
          <input className="input" inputMode="decimal" aria-label="Bond amount" value={bond.amount} onChange={(e) => setBond({ ...bond, amount: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Bond reference</span>
          <input className="input" aria-label="Bond reference" value={bond.ref} onChange={(e) => setBond({ ...bond, ref: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Bond expires</span>
          <input className="input" type="date" aria-label="Bond expires" value={bond.expiresOn} onChange={(e) => setBond({ ...bond, expiresOn: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Client's purchase order number (if any)</span>
          <input className="input" aria-label="Client PO number" value={po} onChange={(e) => setPo(e.target.value)} />
        </label>
        <label className="field bz-span">
          <span className="label">{paperKind === 'loa' ? 'Letter of award reference' : 'Signed contract reference'}</span>
          <input
            className="input"
            aria-label="Signed contract reference"
            placeholder={paperKind === 'loa' ? 'Letter of award reference' : 'Signed contract reference'}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button
          className="btn btn-primary"
          disabled={act.busy || !startOn || !endOn || !ref.trim() || (!clientId && !clientName.trim()) || !proof.length}
          onClick={async () => {
            const ok = await act.run(
              () =>
                api.addContract({
                  companyId: co.companyId,
                  clientAccountId: clientId || null,
                  clientName,
                  siteIds: chosen,
                  startOn,
                  endOn,
                  billingMethod: method,
                  rate: Number(rate || 0),
                  fixedFee: method === 'FIXED' ? Number(fee) : null,
                  contractedHours: method === 'M2' ? 312 : null,
                  signedRef: ref,
                  paperKind,
                  poRef: po || null,
                  posts: posts.length ? toPosts(posts) : null,
                  sla: { replaceAbsentMinutes: Number(sla.replaceAbsentMinutes), incidentReportHours: Number(sla.incidentReportHours), monthlyReportByDay: Number(sla.monthlyReportByDay) },
                  penalties,
                  paymentDays: Number(paymentDays),
                  noticeDays: Number(noticeDays),
                  bond: hasBond ? { amount: Number(bond.amount), ref: bond.ref, expiresOn: bond.expiresOn } : null,
                  proof,
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
