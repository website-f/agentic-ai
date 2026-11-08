import {ItPurchaseDecision} from './ItPurchaseDecision';
import {WebTicketReview,WebTicketHistory} from './WebTicketReview';
import{RentalCorrections}from'./RentalCorrections';
import { ItOnboardingStep } from './ItOnboardingStep';
import { useState } from 'react';
import { BookOpenTextIcon, ClockCountdownIcon, DesktopIcon, LifebuoyIcon, PlusIcon, ShoppingCartIcon, StethoscopeIcon, UserSwitchIcon } from '@phosphor-icons/react';
import { arishaLeader } from '@prima/core';
import { api, type ItBoard } from '../api';
import { useApp } from '../App';
import { Card, Empty, Facts, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import { AssignPick, Jobs, MyWork, Systems, Team } from './ItWork';
import { AwayPanel, BuyFlow, ItAudit, ItTenders, LogTicket, RecordConfirm } from './ItPilot';
import { WebsitesView } from './Websites';
import { ItPlanView } from './ItPlan';
import { LoginHandoverPanel } from './LoginHandover';
import { ItImport } from './ItImport';
import { ItManualPanel, manualItVisible } from './ItManual';
import { ImportButton } from './ImportDrawer';
import { ItOperations } from './ItOperations';
import { ItGuide } from './ItGuide';
import { Chip, Drawer, ErrorNotice, Loading, dataNotice, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/it.css';

/**
 * IT (Fauzan, 27 Oct 2026). IT runs the full lifecycle of IT and electronic assets: request, purchase, receive and tag,
 * assign, maintain and repair, dispose. It also watches domains and websites, answers help requests, sets up joiners
 * and leavers, and fills the IT part of tenders. The COO monitors and approves purchases; the CEO oversees.
 * Everyone else uses this screen to ask IT for help.
 *
 * P75 layout (service-desk standard): one page head, the numbers that matter as tiles that open their tab, the sections
 * as tabs, help requests as a queue with priority, time limit and owner, assets as a register with status, purchases as
 * an approval inbox. Staff who only ask IT for help see their own form and requests, nothing else.
 */

type Tab = 'guide' | 'import' | 'audit' | 'work' | 'plan' | 'rental' | 'jobs' | 'team' | 'systems' | 'assets' | 'purchases' | 'maintenance' | 'websites' | 'tickets' | 'onboarding' | 'tenders' | 'mine';
type AssetRow = NonNullable<ItBoard['assets']>[number];
type Asset = AssetRow['asset'];
const manualRecord=(row:unknown)=>(row as {manual?:{kind?:string;unitLabel?:string;companyId?:string|null;purchaseDateUnknown?:boolean;personUserId?:string|null}}).manual;
const assetProvenance=(row:AssetRow)=>manualRecord(row.asset)?.kind==='asset'?`Existing-stock record · ${manualRecord(row.asset)?.companyId?row.ownerName:(manualRecord(row.asset)?.unitLabel||'Unlinked organization')} (registration alone does not establish rental charges)`:`Rented to ${row.ownerName}`;

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND: Record<Asset['kind'], string> = {
  LAPTOP: 'Laptops',
  DESKTOP: 'Desktops',
  PHONE: 'Phones',
  TABLET: 'Tablets',
  PRINTER: 'Printers',
  NETWORK: 'Network',
  CCTV: 'CCTV',
  OTHER: 'Other',
};
const STATUS: Record<Asset['status'], [Parameters<typeof Chip>[0]['tone'], string]> = {
  in_use: ['ok', 'In use'],
  spare: ['info', 'Spare'],
  repair: ['warn', 'In repair'],
  disposal_pending: ['warn', 'Disposal asked'],
  disposed: ['unknown', 'Disposed'],
};
const CATEGORY = {
  ACCOUNT: 'Account or password',
  DEVICE: 'Device',
  M365: 'Microsoft 365',
  NETWORK: 'Internet or network',
  PRIMA: 'Prima',
  WEBSITE: 'Website',
  SOCIAL: 'Social media',
  EMAIL: 'Company email',
  OTHER: 'Other',
} as const;

export function ItView() {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.itBoard(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="IT" />;
  const k = data.kpis;
  const staff = data.role === 'manager' || data.role === 'team';
  const watcher = data.role === 'coo' || data.role === 'view';
  const tabs: [Tab, string][] = !k
    ? [['mine', 'My requests']]
    : data.role === 'hr'
      ? [
          ['team', 'Team'],
          ['jobs', 'Jobs'],
        ]
      : data.role === 'finance'
        ? [
            ['purchases', 'Purchases'],
            ['rental', 'Device rental'],
            ['assets', 'Assets'],
          ]
      : data.role === 'audit'
        ? [
            ['audit', 'Audit'],
            ['plan', 'Plan'],
            ['team', 'Team'],
            ['jobs', 'Jobs'],
            ['tickets', 'Help requests'],
            ['purchases', 'Purchases'],
            ['tenders', 'Tenders (eP)'],
            ['systems', 'Systems and access'],
            ['assets', 'Assets'],
            ['rental', 'Device rental'],
            ['onboarding', 'Joining and leaving'],
          ]
        : [
        ...(staff ? ([['work', 'My work']] as [Tab, string][]) : []),
        // The week, month and year plan: the IT Manager plans, everyone else looks (Fauzan, 28 Oct 2026).
        ...(data.assigner && !watcher ? ([['plan', 'Plan']] as [Tab, string][]) : []),
        ...(watcher ? ([['team', 'Team'], ['plan', 'Plan']] as [Tab, string][]) : []),
        ['jobs', 'Jobs'],
        ['tickets', 'Help requests'],
        ...(staff && !watcher && data.assigner ? ([['team', 'Team']] as [Tab, string][]) : []),
        ['systems', 'Systems and access'],
        ['assets', 'Assets'],
        ...(staff || watcher ? ([['rental', 'Device rental']] as [Tab, string][]) : []),
        ['purchases', 'Purchases'],
        ['maintenance', 'Maintenance'],
        ['websites', 'Websites and domains'],
        ['tenders', 'Tenders (eP)'],
        ['onboarding', 'Joining and leaving'],
        ['mine', 'My requests'],
        // The CEO's batch import of open IT work (task T9).
        ...(arishaLeader(me.user) === 'ceo' ? ([['import', 'Import']] as [Tab, string][]) : []),
      ];
  const current = tab ?? tabs[0][0];
  const has = (t: Tab) => tabs.some(([x]) => x === t);
  /** A tile opens its tab when this person has that tab. */
  const opens = (t: Tab) => (has(t) ? () => setTab(t) : undefined);
  const selfService = tabs.length === 1;
  return (
    <div className="page it-page">
      <PageHead
        title="IT"
        sub={
          k
            ? 'Jobs given with a due date and done with proof, help requests, IT and electronic assets from purchase to disposal, joining and leaving, and the IT part of tenders. The IT Manager supervises, the IT Lead is technical, the COO monitors and the CEO owns every system.'
            : 'Ask IT for help with your account, device, Microsoft 365, the network or Prima, and follow your requests here.'
        }
        actions={
          <>
            {/* The step-by-step guide to every IT workflow, for this person's own screens (P78). */}
            {k && current !== 'guide' && (
              <button className="btn" onClick={() => setTab('guide')}>
                <BookOpenTextIcon size={16} aria-hidden="true" />
                Workflow guide
              </button>
            )}
            {has('mine') && current !== 'mine' && (
              <button className="btn btn-primary" onClick={() => setTab('mine')}>
                <PlusIcon size={16} weight="bold" aria-hidden="true" />
                Ask IT for help
              </button>
            )}
          </>
        }
      />
      <p className="notice it-notice" data-tone="info">
        <span>{dataNotice(me.dataMode)}</span>
        {data.pilot?.on && (
          <span>{` Pilot: only IT, the COO, the CEO, the ACT head, the HR administrator and the Finance Director sign in. Others reach IT on Teams, email or phone and IT logs it for them; approvals given in Teams Approvals are recorded here with a screenshot (${data.pilot.stack}).`}</span>
        )}
      </p>
      {k && (
        <Stats>
          <Stat
            label="Jobs late"
            value={k.jobsLate}
            tone={k.jobsLate ? 'crit' : 'ok'}
            note={`${k.jobsOpen} open · ${k.jobsWaitingCheck} to check`}
            icon={<ClockCountdownIcon size={16} />}
            onClick={opens('jobs')}
          />
          <Stat
            label="Help requests open"
            value={k.ticketsOpen}
            tone={k.ticketsLate ? 'crit' : 'ok'}
            note={`${k.ticketsLate} past the time limit`}
            icon={<LifebuoyIcon size={16} />}
            onClick={opens('tickets')}
          />
          <Stat
            label="Purchases waiting"
            value={k.purchasesWaiting}
            tone={k.purchasesWaiting ? 'warn' : 'ok'}
            icon={<ShoppingCartIcon size={16} />}
            onClick={opens('purchases')}
          />
          <Stat
            label="Assets"
            value={k.assets}
            note={`${k.inRepair} in repair · ${k.serviceDue} service due`}
            icon={<DesktopIcon size={16} />}
            onClick={opens('assets')}
          />
          <Stat
            label="Health inspection due / initial check"
            value={k.checkLate}
            tone={k.checkLate ? 'warn' : 'ok'}
            icon={<StethoscopeIcon size={16} />}
            onClick={opens('maintenance')}
          />
          <Stat
            label="Joiners or leavers late"
            value={k.onboardingLate}
            tone={k.onboardingLate ? 'crit' : 'ok'}
            icon={<UserSwitchIcon size={16} />}
            onClick={opens('onboarding')}
          />
        </Stats>
      )}
      {(staff || me.user.opsTier === 'ceo') && <LoginHandoverPanel />}
      {!selfService && (
        <div className="tabbar it-tabs" role="tablist" aria-label="IT sections">
          {tabs.map(([t, l]) => (
            <button key={t} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <div className="it-panel" role={selfService ? undefined : 'tabpanel'} aria-label={selfService ? undefined : (tabs.find(([t]) => t === current)?.[1] ?? 'Workflow guide')}>
        {current === 'guide' && (
          <>
            <div className="it-actions">
              <button className="btn btn-sm" onClick={() => setTab(null)}>
                Back to IT
              </button>
            </div>
            <ItGuide allowedTabs={tabs.map(([t]) => t)} onOpen={(t) => setTab(t)} />
          </>
        )}
        {current === 'audit' && <ItAudit data={data} />}
        {current === 'work' && <MyWork data={data} openTab={setTab} />}
        {current === 'plan' && <ItPlanView board={data} />}
        {current === 'rental' && <><ItOperations mode="billing" /><RentalCorrections/></>}
        {current === 'jobs' && <Jobs data={data} />}
        {current === 'team' && (
          <>
            <AwayPanel data={data} />
            <Team data={data} />
          </>
        )}
        {current === 'systems' && <>{manualItVisible(me.user)&&<ItManualPanel mode="systems"/>}<Systems data={data} /></>}
        {current === 'assets' && <>{manualItVisible(me.user)&&<ItManualPanel mode="assets"/>}{manualItVisible(me.user)&&<div className="imp-inline"><ImportButton kind="itAsset" label="Import IT equipment from file" /></div>}<Assets data={data} staff={staff} /></>}
        {current === 'purchases' && <Purchases data={data} staff={staff} />}
        {current === 'maintenance' && <><Maintenance data={data} staff={staff} /><ItOperations mode="inspection"/></>}
        {current === 'websites' && <WebsitesView />}
        {current === 'tickets' && <Tickets data={data} staff={staff} />}
        {current === 'onboarding' && <>{manualItVisible(me.user)&&<ItManualPanel mode="intake"/>}<Onboarding data={data} staff={staff} /></>}
        {current === 'tenders' && <ItTenders data={data} />}
        {current === 'mine' && <Mine data={data} />}
        {current === 'import' && arishaLeader(me.user) === 'ceo' && <ItImport />}
      </div>
    </div>
  );
}

/** The flags on one asset that need attention, as short words for a row. */
function assetFlags(r: AssetRow) {
  return [r.checkLate ? 'health inspection due or initial check needed' : '', r.serviceDue ? 'service due' : '', r.warrantySoon ? 'warranty ending' : ''].filter(Boolean);
}

function Assets({ data, staff }: { data: ItBoard; staff: boolean }) {
  const [kind, setKind] = useState<Asset['kind'] | 'ALL'>('ALL');
  const [status, setStatus] = useState<Asset['status'] | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const rows = (data.assets ?? []).filter(
    (r) =>
      (kind === 'ALL' || r.asset.kind === kind) &&
      (status === 'ALL' || r.asset.status === status) &&
      (!q.trim() || `${r.asset.tag} ${r.asset.model} ${r.asset.assignedTo ?? ''} ${r.ownerName}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const row = (data.assets ?? []).find((r) => r.asset.id === open) ?? null;
  return (
    <>
      <Card title="By kind" sub="Choose a kind to show only those in the register.">
        <div className="it-kinds">
          {(data.byKind ?? []).map((b) => (
            <button
              key={b.kind}
              type="button"
              className="it-kind"
              aria-pressed={kind === b.kind}
              onClick={() => setKind(kind === b.kind ? 'ALL' : b.kind)}
            >
              <span className="it-kind-name">{KIND[b.kind]}</span>
              <span className="it-kind-total">{b.total}</span>
              <span className="it-kind-note">
                {b.inUse} in use{b.repair ? ` · ${b.repair} in repair` : ''}
              </span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Register" sub={`${rows.length} shown`} flush>
        <div className="it-card-bar">
          <Toolbar>
            <Search value={q} onChange={setQ} placeholder="Tag, model, holder or company" label="Search" />
            <select className="select it-filter" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'] | 'ALL')}>
              <option value="ALL">Every kind</option>
              {(Object.keys(KIND) as Asset['kind'][]).map((x) => (
                <option key={x} value={x}>
                  {KIND[x]}
                </option>
              ))}
            </select>
            <select className="select it-filter" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Asset['status'] | 'ALL')}>
              <option value="ALL">Every status</option>
              {(Object.keys(STATUS) as Asset['status'][])
                .filter((s) => s !== 'disposed')
                .map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s][1]}
                  </option>
                ))}
            </select>
          </Toolbar>
        </div>
        {rows.length > 0 && (
          <div className="it-asset it-asset-head" aria-hidden="true">
            <span>Asset</span>
            <span>With</span>
            <span>Owner and record</span>
            <span>Status</span>
          </div>
        )}
        <ul className="it-rows">
          {rows.slice(0, 80).map((r) => {
            const flags = assetFlags(r);
            return (
              <li key={r.asset.id}>
                <button className="it-asset" data-flag={flags.length ? 'yes' : undefined} onClick={() => setOpen(r.asset.id)}>
                  <span className="it-asset-main">
                    <span className="it-row-title">
                      <span className="it-ref">{r.asset.tag}</span> {r.asset.model}
                    </span>
                    <span className="it-row-meta">{KIND[r.asset.kind]}</span>
                  </span>
                  <span className="it-asset-with">{r.asset.assignedTo ?? r.asset.location}</span>
                  <span className="it-asset-owner">{assetProvenance(r)}</span>
                  <span className="it-asset-state">
                    <Chip tone={STATUS[r.asset.status][0]}>{STATUS[r.asset.status][1]}</Chip>
                    {flags.map((f) => (
                      <span key={f} className="it-flag">
                        {f}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {rows.length > 80 && <p className="it-more">Showing 80 of {rows.length}. Search or filter to narrow.</p>}
        {!rows.length && <Empty title="Nothing matches.">Change the search or the filters.</Empty>}
      </Card>
      {row && <AssetDrawer row={row} staff={staff} manager={data.role === 'manager'} onClose={() => setOpen(null)} />}
    </>
  );
}

function AssetDrawer({ row: r, staff, manager, onClose }: { row: AssetRow; staff: boolean; manager: boolean; onClose: () => void }) {
  const act = useAction();
  const a = r.asset;
  const [who, setWho] = useState(a.assignedTo ?? '');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  // RBA C2 (8 Nov 2026): a disposal names the licensed e-waste contractor and its consignment note or certificate.
  const [contractor, setContractor] = useState('');
  const [noteRef, setNoteRef] = useState('');
  const move = (status: Asset['status'], ok: string) =>
    act.run(() => api.setItAsset(a.id, status, status === 'in_use' ? who : null, note, status === 'disposed' ? { contractor: contractor.trim(), noteRef: noteRef.trim() } : null), ok);
  return (
    <Drawer title={`${a.tag} · ${a.model}`} sub={`${KIND[a.kind]} · ${manualRecord(a)?.kind==='asset'?assetProvenance(r):`owned by Merdeka Network, rented to ${r.ownerName}`}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <div className="it-drawer">
        <div className="it-facts">
          <Facts
            items={[
              ['Status', <Chip key="s" tone={STATUS[a.status][0]}>{STATUS[a.status][1]}</Chip>],
              ['With', a.assignedTo ?? a.location],
              ['Bought', a.boughtOn ? dateLabel(a.boughtOn) : 'Unknown — no purchase date recorded'],
              ['Warranty to', a.warrantyTo ? dateLabel(a.warrantyTo) : 'Not recorded'],
              ['Legacy/general check (not health inspection)', a.lastCheckedOn ? dateLabel(a.lastCheckedOn) : 'Not recorded'],
              ...(a.nextServiceOn ? ([['Next service', dateLabel(a.nextServiceOn)]] as [string, string][]) : []),
              ['Serial', a.serial || 'Not recorded'],
            ]}
          />
        </div>
        {a.disposal && (
          <div className="notice" data-tone="warn">
            Disposal asked by {a.disposal.askedBy} on {dateTimeLabel(a.disposal.askedAt)}: {a.disposal.reason}
            {a.disposal.doneBy ? `. Disposed by ${a.disposal.doneBy}.` : '. Waiting for the IT Manager.'}
            {a.disposal.ewaste ? ` E-waste: ${a.disposal.ewaste.contractor}, note ${a.disposal.ewaste.noteRef}.` : ''}
          </div>
        )}
        {staff && a.status !== 'disposed' && (
          <section className="it-sec">
            <h3>Move</h3>
            <div className="it-form">
              <label className="field">
                <span className="label">Holder</span>
                <input className="input" aria-label="Holder" placeholder="Who has it (to assign)" value={who} onChange={(e) => setWho(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Note</span>
                <input className="input" aria-label="Note" placeholder="Note (needed to ask for disposal)" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {a.status === 'disposal_pending' && manager && (
                <>
                  <label className="field">
                    <span className="label">E-waste contractor</span>
                    <input className="input" aria-label="E-waste contractor" placeholder="Licensed e-waste contractor (DOE scheduled waste)" value={contractor} onChange={(e) => setContractor(e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="label">Consignment note or certificate</span>
                    <input className="input" aria-label="Consignment note or certificate" placeholder="Consignment note or disposal certificate number" value={noteRef} onChange={(e) => setNoteRef(e.target.value)} />
                  </label>
                  <span className="muted small">Both are needed to dispose. Wipe the data first.</span>
                </>
              )}
            </div>
            <div className="it-actions">
              <button className="btn btn-sm" disabled={act.busy || !who.trim()} onClick={() => move('in_use', 'Assigned.')}>
                Assign
              </button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => move('spare', 'Back in the store.')}>
                Return to store
              </button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => move('repair', 'Sent for repair.')}>
                Send for repair
              </button>
              {a.status !== 'disposal_pending' && (
                <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => move('disposal_pending', 'Disposal asked.')}>
                  Ask to dispose
                </button>
              )}
              {a.status === 'disposal_pending' && manager && (
                <button className="btn btn-sm btn-danger" disabled={act.busy || contractor.trim().length < 3 || noteRef.trim().length < 3} onClick={() => move('disposed', 'Disposed. The record is kept.')}>
                  Dispose
                </button>
              )}
            </div>
          </section>
        )}
        <ItOperations mode="inspection" assetId={a.id}/>
        <section className="it-sec">
          <h3>Service and repair history (separate from health inspections)</h3>
          {!(a.maintenance ?? []).length && <p className="it-none">None recorded.</p>}
          {!!(a.maintenance ?? []).length && (
            <ul className="it-history">
              {[...(a.maintenance ?? [])].reverse().map((m) => (
                <li key={m.at}>
                  <span className="it-row-title">
                    {m.kind === 'service' ? 'Service' : 'Repair'}: {m.note}
                  </span>
                  <span className="it-row-meta">
                    {dateTimeLabel(m.at)} · {m.by} · {rm(m.cost)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {staff && a.status !== 'disposed' && (
            <div className="it-box">
              <label className="field">
                <span className="label">Cost, RM</span>
                <input className="input" inputMode="decimal" aria-label="Cost" placeholder="Cost, RM" value={cost} onChange={(e) => setCost(e.target.value)} />
              </label>
              <p className="it-hint">Write what was done in the note above.</p>
              <div className="it-actions">
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !note.trim()}
                  onClick={() => act.run(() => api.itMaintenance(a.id, 'service', note, Number(cost)), 'Service recorded.')}
                >
                  Record service
                </button>
                <button
                  className="btn btn-sm"
                  disabled={act.busy || !note.trim()}
                  onClick={() => act.run(() => api.itMaintenance(a.id, 'repair', note, Number(cost)), 'Repair recorded.')}
                >
                  Record repair
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function Purchases({ data, staff }: { data: ItBoard; staff: boolean }) {
  const [form, setForm] = useState(false);
  // IT asks to buy; so may the owner (P78). The IT Manager still agrees the need.
  const canAsk = staff || !!data.canRaisePurchase;
  const all = data.purchases ?? [];
  // The approval inbox: what waits for this person's decision comes first, then everything else in the same order.
  const mine = all.filter((p) => p.canApprove || p.canDecide);
  const rest = all.filter((p) => !(p.canApprove || p.canDecide));
  return (
    <Card
      title="Purchases"
      sub={mine.length ? `${mine.length} waiting for your decision · ${all.length} in all` : `${all.length} in all`}
      actions={
        canAsk && (
          <button className={form ? 'btn btn-sm' : 'btn btn-sm btn-primary'} aria-expanded={form} onClick={() => setForm(!form)}>
            {!form && <PlusIcon size={14} weight="bold" aria-hidden="true" />}
            {form ? 'Close' : 'Ask to buy'}
          </button>
        )
      }
      flush
    >
      <p className="it-rule">
        {data.pilot?.on
          ? `An IT Executive asks and the IT Manager agrees the need. IT then gets ${data.buyRule.quotesNeeded} quotes from different suppliers and records one evidenced online comparison, each with its listing link and separate evidence. The COO approves, then the CEO in Prima; trusted Teams approval integration remains pending. Nothing is bought before both. The configured Finance team records the PO; IT records actual goods receipts; Finance matches the invoice before recording payment. A separate advance exception needs current COO then CEO approval. Use IT purchase fulfilment; no bank action is executed.`
          : 'An IT Executive asks and the IT Manager agrees the need (the COO when the IT Manager asks). Procurement then buys it: three quotes, an approved supplier, COO and CEO approval, and the goods received note. IT tags only what was received.'}
      </p>
      {form && (
        <div className="it-inset">
          <PurchaseForm onDone={() => setForm(false)} />
        </div>
      )}
      {mine.length > 0 && (
        <>
          <h3 className="it-group">Waiting for your decision</h3>
          <ul className="it-rows">
            {mine.map((p) => (
              <PurchaseLine key={p.purchase.id} p={p} staff={staff} data={data} />
            ))}
          </ul>
        </>
      )}
      {mine.length > 0 && rest.length > 0 && <h3 className="it-group">Other purchases</h3>}
      <ul className="it-rows">
        {rest.map((p) => (
          <PurchaseLine key={p.purchase.id} p={p} staff={staff} data={data} />
        ))}
      </ul>
      {!all.length && <Empty title="No purchases yet.">{canAsk ? 'Use Ask to buy to start one.' : 'Purchases IT asks for appear here.'}</Empty>}
    </Card>
  );
}

function PurchaseLine({ p: row, staff, data }: { p: NonNullable<ItBoard['purchases']>[number]; staff: boolean; data: ItBoard }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const p = row.purchase;
  const tone = p.status === 'rejected' ? 'crit' : p.status === 'received' ? 'ok' : row.canApprove || row.canDecide ? 'warn' : 'info';
  return (
    <li className="it-item" data-wait={row.canApprove || row.canDecide ? 'yes' : undefined}>
      <div className="it-item-head">
        <div className="it-item-main">
          <span className="it-row-title">
            <span className="it-ref">{p.ref}</span> {rm(p.total)}
          </span>
          <span className="it-item-what">{p.items.map((i) => `${i.qty} × ${i.description}`).join(', ')} · {row.ownerName} · {p.reason}</span>
          <span className="it-row-meta">
            Asked by {p.requestedBy} {dateTimeLabel(p.at)}
            {p.managerStep ? ` · IT Manager: ${p.managerStep.by}` : ''}
            {p.cooStep && !p.quotes ? ` · COO: ${p.cooStep.by}` : ''}
            {row.purRequest ? ` · Procurement ${row.purRequest.ref}` : ''}
            {p.received ? ` · ${p.received.assetIds.length} tagged` : ''}
            {(p.cooStep?.note || p.managerStep?.note) && p.status === 'rejected' ? ` · ${p.cooStep?.note || p.managerStep?.note}` : ''}
          </span>
        </div>
        <Chip tone={tone}>{p.status === 'rejected' ? 'Rejected' : p.status === 'received' ? 'Received' : `With ${row.waitingOn}`}</Chip>
      </div>
      {row.canApprove && (
        <div className="it-decide">
          <ItPurchaseDecision note={note} onNote={setNote} busy={act.busy}
            onDecide={(action, reason) => act.run(() => api.itPurchaseStep(p.id, action, { note: reason }), action === 'approve' ? 'Approved.' : 'Rejected.')} />
        </div>
      )}
      <BuyFlow row={row} data={data} />
      {row.canTag&&<p className="notice" data-tone="info">Record actual delivery quantities in IT purchase fulfilment. The previous direct tag/receipt shortcut is not used for the protected workflow.</p>}
      <ErrorNotice error={act.error} />
    </li>
  );
}

function PurchaseForm({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState('pwvsb');
  const [kind, setKind] = useState<Asset['kind']>('LAPTOP');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  return (
    <div className="it-form">
      <label className="field it-span">
        <span className="label">Why it is needed</span>
        <input className="input" aria-label="Why" placeholder="Why it is needed" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">For</span>
        <select className="select" aria-label="For" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="pwvsb">PWVSB</option>
          <option value="co-sasa">Sasa (pilot)</option>
          <option value="co-arsh">Arrow Shield (pilot)</option>
          <option value="co-inas">Inas (pilot)</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Kind</span>
        <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'])}>
          {(Object.keys(KIND) as Asset['kind'][]).map((x) => (
            <option key={x} value={x}>
              {KIND[x]}
            </option>
          ))}
        </select>
      </label>
      <label className="field it-span">
        <span className="label">Item and model</span>
        <input className="input" aria-label="Item" placeholder="Item and model" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Quantity</span>
        <input className="input" inputMode="numeric" aria-label="Quantity" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Unit price, RM</span>
        <input
          className="input"
          inputMode="decimal"
          aria-label="Unit price"
          placeholder="Unit price, RM"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <div className="it-form-foot it-span">
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={() =>
            act
              .run(
                () => api.raiseItPurchase({ ownerId: owner, reason, items: [{ kind, description: desc, qty: Number(qty), unitPrice: Number(price) }] }),
                'Sent to the IT Manager.',
              )
              .then((r) => r && onDone())
          }
        >
          Send for approval
        </button>
      </div>
    </div>
  );
}

function Maintenance({ data, staff }: { data: ItBoard; staff: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const due = (data.assets ?? []).filter((r) => r.serviceDue).sort((a, b) => (a.asset.nextServiceOn ?? '').localeCompare(b.asset.nextServiceOn ?? ''));
  const repair = (data.assets ?? []).filter((r) => r.asset.status === 'repair');
  const disposal = (data.assets ?? []).filter((r) => r.asset.status === 'disposal_pending');
  const row = (data.assets ?? []).find((r) => r.asset.id === open) ?? null;
  const line = (r: AssetRow, detail: string, tone: Parameters<typeof Chip>[0]['tone'], chip: string) => (
    <li key={r.asset.id}>
      <button className="it-line" onClick={() => setOpen(r.asset.id)}>
        <span className="it-line-main">
          <span className="it-row-title">
            <span className="it-ref">{r.asset.tag}</span> {r.asset.model}
          </span>
          <span className="it-row-meta">
            {r.ownerName} · {detail}
          </span>
        </span>
        <Chip tone={tone}>{chip}</Chip>
      </button>
    </li>
  );
  return (
    <>
      <div className="it-trio">
        <Card title="Service due (CCTV, network, printers)" sub={`${due.length} in the next 14 days`} flush>
          {!due.length && <p className="it-none it-pad">Nothing due in the next 14 days.</p>}
          <ul className="it-rows">
            {due.map((r) =>
              line(r, `due ${dateLabel(r.asset.nextServiceOn!)}`, r.asset.nextServiceOn! < new Date().toISOString().slice(0, 10) ? 'crit' : 'warn', 'Service'),
            )}
          </ul>
        </Card>
        <Card title="In repair" sub={`${repair.length} away`} flush>
          {!repair.length && <p className="it-none it-pad">None.</p>}
          <ul className="it-rows">{repair.map((r) => line(r, r.asset.maintenance?.at(-1)?.note ?? 'No note', 'warn', 'Repair'))}</ul>
        </Card>
        <Card title="Disposal asked" sub={`${disposal.length} waiting for the IT Manager`} flush>
          {!disposal.length && <p className="it-none it-pad">None.</p>}
          <ul className="it-rows">{disposal.map((r) => line(r, r.asset.disposal?.reason ?? '', 'warn', 'IT Manager'))}</ul>
        </Card>
      </div>
      {row && <AssetDrawer row={row} staff={staff} manager={data.role === 'manager'} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The domain and website register moved to its own Websites screen (Fauzan, 27 Oct 2026), so there is one register. */
function Tickets({ data, staff }: { data: ItBoard; staff: boolean }) {
  const [showDone, setShowDone] = useState(false);
  const [log, setLog] = useState(false);
  const all = data.tickets ?? [];
  // The queue: open requests first, the nearest time limit at the top (resolved ones follow when shown).
  const rows = all
    .filter((t) => showDone || t.ticket.status !== 'resolved')
    .slice()
    .sort((a, b) => Number(a.ticket.status === 'resolved') - Number(b.ticket.status === 'resolved') || String(a.due).localeCompare(String(b.due)));
  const open = all.filter((t) => t.ticket.status !== 'resolved');
  const late = open.filter((t) => t.breached).length;
  const nobody = open.filter((t) => !t.ticket.assignedTo).length;
  return (
    <Card
      title="Help requests"
      sub={`Time limits: P1 ${data.rule.slaHours.P1} hours, P2 ${data.rule.slaHours.P2} hours, P3 ${data.rule.slaHours.P3} hours.`}
      actions={
        <>
          <button className="btn btn-sm" aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide resolved' : 'Show resolved'}
          </button>
          {(staff || !!data.canLogTicket) && (
            <button className={log ? 'btn btn-sm' : 'btn btn-sm btn-primary'} aria-expanded={log} onClick={() => setLog(!log)}>
              {!log && <PlusIcon size={14} weight="bold" aria-hidden="true" />}
              Log a request
            </button>
          )}
        </>
      }
      flush
    >
      <div className="it-queue-sum">
        <span>
          <strong>{open.length}</strong> open
        </span>
        <span data-tone={late ? 'crit' : undefined}>
          <strong>{late}</strong> past the time limit
        </span>
        <span data-tone={nobody ? 'warn' : undefined}>
          <strong>{nobody}</strong> not given to anyone
        </span>
      </div>
      {log && (
        <div className="it-inset">
          <LogTicket onDone={() => setLog(false)} />
        </div>
      )}
      {!rows.length && <Empty title="Nothing open.">{staff || data.canLogTicket ? 'Use Log a request when someone reaches IT by Teams, email, phone or in person.' : 'New help requests appear here with their time limit.'}</Empty>}
      {rows.length > 0 && (
        <div className="it-ticket it-ticket-head" aria-hidden="true">
          <span>Priority</span>
          <span>Request</span>
          <span>Owner</span>
          <span>Due</span>
          <span>Status</span>
        </div>
      )}
      <ul className="it-rows">
        {rows.map((t) => (
          <TicketLine key={t.ticket.id} t={t} staff={staff} data={data} />
        ))}
      </ul>
    </Card>
  );
}

function TicketLine({ t: row, staff, data }: { t: NonNullable<ItBoard['tickets']>[number]; staff: boolean; data: ItBoard }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const t = row.ticket;
  const done = t.status === 'resolved';
  const extra = [
    done ? t.resolution : '',
    done && t.resolvedBy ? `fixed by ${t.resolvedBy}` : '',
    done && !row.webPolicy ? (row.confirm === 'confirmed' ? (t.confirmedVia ? `confirmed: ${t.confirmedVia}` : 'confirmed by the person') : row.confirm === 'waiting' ? 'waiting for the person to confirm' : 'not answered, counted as confirmed') : '',
    t.reopened ? `reopened ${t.reopened}×` : '',
    row.toCoo ? 'the COO sees it' : '',
  ].filter(Boolean);
  return (
    <li className="it-item" data-late={row.breached ? 'yes' : undefined}>
      <div className="it-ticket">
        <span className="it-pri" data-pri={t.priority}>{t.priority}</span>
        <span className="it-ticket-main">
          <span className="it-row-title">
            <span className="it-ref">{t.ref}</span> {t.title}
          </span>
          <span className="it-row-meta">
            {CATEGORY[t.category]} · {t.raisedBy}
            {t.raisedFor ? ` (logged by IT, via ${t.channel === 'in_person' ? 'in person' : t.channel})` : ''} · {dateTimeLabel(t.at)}
          </span>
          {extra.length > 0 && <span className="it-row-meta">{extra.join(' · ')}</span>}
        </span>
        <span className="it-ticket-owner">
          <span className="it-cell-label">Owner </span>
          {t.assignedTo ? `with ${t.assignedTo}` : <span className="it-faint">Nobody yet</span>}
        </span>
        <span className="it-ticket-due">
          <span className="it-cell-label">Due </span>
          {done ? '—' : dateTimeLabel(row.due)}
        </span>
        <span className="it-ticket-state">
          <Chip tone={row.breached ? 'crit' : done ? 'ok' : t.status === 'in_progress' ? 'info' : 'warn'}>
            {row.webPolicy&&done?(t.confirmedAt?'Fix confirmed':'Resolved; confirmation pending'):row.breached ? (done ? 'Resolved late' : 'Past time limit') : done ? 'Resolved' : t.status === 'in_progress' ? 'Being worked' : 'Open'}
          </Chip>
        </span>
      </div>
      {!row.webPolicy && row.canRecord && row.confirm === 'waiting' && <RecordConfirm id={t.id} />}
      {row.webPolicy&&<WebTicketReview key={t.id} confirmedAt={t.confirmedAt} policy={row.webPolicy} submit={(action,note,expectedResolutionVersion)=>api.itAct(action==='reopen'?'reopenWebTicket':'confirmTicket',{id:t.id,note,expectedResolutionVersion,...(action==='reopen'?{}:{fixed:action==='confirm'})})}/>}
      {row.webPolicy&&<WebTicketHistory entries={t.webHistory}/>}
      {(row.canAssign || (staff && row.canWork)) && (
        <div className="it-work">
          {row.canAssign && (
            <AssignPick data={data} current={t.assignedToId} busy={act.busy} onPick={(id) => void act.run(() => api.itAct('assignTicket', { id: t.id, toId: id }), 'Given.')} />
          )}
          {staff && row.canWork && (
            <>
              <input className="input it-work-note" aria-label="What fixed it" placeholder="What fixed it" value={note} onChange={(e) => setNote(e.target.value)} />
              {t.status === 'open' && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.itTicketStep(t.id, 'take', ''), 'Taken.')}>
                  Take it
                </button>
              )}
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !note.trim()}
                onClick={() => act.run(() => api.itTicketStep(t.id, 'resolve', note), 'Resolved.')}
              >
                Resolve
              </button>
            </>
          )}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </li>
  );
}

function Onboarding({ data, staff }: { data: ItBoard; staff: boolean }) {
  const act = useAction();
  const list = data.onboarding ?? [];
  return (
    <Card
      title="Joining and leaving"
      sub="Track the work needed for joiners and leavers. These checklists record staff-reported completion with evidence, not independent checking or certification. They do not create accounts, revoke access or prove changes in Microsoft."
    >
      <ErrorNotice error={act.error} />
      {!list.length && <Empty title="No joiners or leavers.">People joining or leaving appear here with their IT steps. Use Add joining / leaving request above to record one.</Empty>}
      <div className="it-people">
        {list.map((o) => {
          const total = o.item.steps.length;
          const recorded = o.item.steps.filter((s) => s.doneAt).length;
          return (
            <article key={o.item.id} className="it-person" data-late={o.late ? 'yes' : undefined}>
              <div className="it-item-head">
                <div className="it-item-main">
                  <span className="it-person-name">
                    {o.item.personName}
                    {manualRecord(o.item)&&!manualRecord(o.item)?.personUserId&&<Chip tone="unknown">Unlinked identity</Chip>}
                  </span>
                  <span className="it-row-meta">
                    {o.item.kind === 'join' ? 'Joins' : 'Leaves'} {dateLabel(o.item.on)} · {o.item.jobTitle} · {manualRecord(o.item)&&!manualRecord(o.item)?.companyId?`${manualRecord(o.item)?.unitLabel||'Unlinked organization'} (not verified)`:o.ownerName} · {o.staffName ?? 'not given to anyone'}
                  </span>
                </div>
                <Chip tone={o.late ? 'crit' : o.soon ? 'warn' : o.open ? 'info' : 'ok'}>{o.open ? (o.late ? `${o.open} late` : `${o.open} to do`) : 'All steps recorded — not independently checked'}</Chip>
              </div>
              {total > 0 && (
                <div className="it-progress" aria-label={`${recorded} of ${total} steps recorded`}>
                  <span className="it-progress-track">
                    <span className="it-progress-fill" style={{ width: `${Math.round((recorded / total) * 100)}%` }} />
                  </span>
                  <span className="it-progress-text">
                    {recorded} of {total} steps recorded
                  </span>
                </div>
              )}
              {data.assigner && o.open > 0 && (
                <div className="it-actions">
                  <span className="it-cell-label it-cell-label-on">Owner</span>
                  <AssignPick
                    data={data}
                    current={o.item.ownerStaffId}
                    busy={act.busy}
                    onPick={(id) => void act.run(() => api.itAct('setOwner', { what: 'onboarding', id: o.item.id, toId: id }), 'Given.')}
                  />
                </div>
              )}
              <div className="it-steps">
                {o.item.steps.map((s) => <ItOnboardingStep key={s.key} step={s} canTick={o.canTick} busy={act.busy} onSave={(done,evidence,version)=>void act.run(()=>api.setItOnboardingStep(o.item.id,s.key,done,evidence,version))}/>)}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}

function Mine({ data }: { data: ItBoard }) {
  const act = useAction();
  const [category, setCategory] = useState<keyof typeof CATEGORY>('M365');
  const [priority, setPriority] = useState<'P1' | 'P2' | 'P3'>('P3');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const openCount = data.mine.filter((t) => t.status !== 'resolved').length;
  return (
    <div className="it-mine">
      <Card title="Ask IT for help" sub="Say what is wrong and how much it stops your work. IT replies within the time limit for that urgency.">
        <div className="it-form">
          <label className="field">
            <span className="label">About</span>
            <select className="select" aria-label="About" value={category} onChange={(e) => setCategory(e.target.value as keyof typeof CATEGORY)}>
              {(Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Urgency</span>
            <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value as 'P1' | 'P2' | 'P3')}>
              <option value="P1">P1: I cannot work at all</option>
              <option value="P2">P2: work is slowed down</option>
              <option value="P3">P3: a question or training</option>
            </select>
          </label>
          <label className="field it-span">
            <span className="label">What is wrong</span>
            <input className="input" aria-label="What is wrong" placeholder="What is wrong" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field it-span">
            <span className="label">Details (optional)</span>
            <textarea className="input" aria-label="Details" placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
          <div className="it-form-foot it-span">
            <ErrorNotice error={act.error} />
            <button
              className="btn btn-primary"
              disabled={act.busy || !title.trim()}
              onClick={() =>
                act
                  .run(() => api.raiseItTicket({ category, priority, title, detail }), 'Sent to IT.')
                  .then((r) => {
                    if (r) {
                      setTitle('');
                      setDetail('');
                    }
                  })
              }
            >
              Send to IT
            </button>
          </div>
        </div>
      </Card>
      <Card title="My requests" sub={data.mine.length ? `${openCount} open · ${data.mine.length} in all` : undefined} flush>
        {!data.mine.length && <Empty title="You have not asked IT for anything yet.">Requests you send appear here so you can follow them.</Empty>}
        <ul className="it-rows">
          {data.mine.map((t) => (
            <li key={t.id} className="it-item">
              <div className="it-item-head">
                <div className="it-item-main">
                  <span className="it-row-title">
                    <span className="it-pri" data-pri={t.priority}>{t.priority}</span> <span className="it-ref">{t.ref}</span> {t.title}
                  </span>
                  <span className="it-row-meta">
                    {CATEGORY[t.category]} · {dateTimeLabel(t.at)}
                    {t.assignedTo ? ` · with ${t.assignedTo}` : ''}
                    {t.resolution ? ` · ${t.resolution}` : ''}
                  </span>
                </div>
                <Chip tone={t.status === 'resolved' ? 'ok' : t.status === 'in_progress' ? 'info' : 'warn'}>
                  {t.status === 'resolved' ? (t.confirmedAt ? 'Fixed, confirmed' : 'Resolved') : t.status === 'in_progress' ? 'Being worked' : 'Open'}
                </Chip>
              </div>
              {t.webPolicy?<WebTicketReview key={t.id} confirmedAt={t.confirmedAt} policy={t.webPolicy} submit={(action,note,expectedResolutionVersion)=>api.itAct(action==='reopen'?'reopenWebTicket':'confirmTicket',{id:t.id,note,expectedResolutionVersion,...(action==='reopen'?{}:{fixed:action==='confirm'})})}/>:t.canConfirm&&<ConfirmFix id={t.id}/>}
              {t.webPolicy&&<WebTicketHistory entries={t.webHistory}/>}
              {!t.webPolicy && t.confirmNote && <p className="it-row-meta">{t.confirmNote}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** The person who asked says whether it is really fixed; "not fixed" reopens it with the same IT person. */
function ConfirmFix({ id }: { id: string }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="it-confirm">
      <p className="it-confirm-q">Is it fixed?</p>
      <div className="it-work">
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.itAct('confirmTicket', { id, fixed: true }), 'Thank you. Confirmed.')}>
          Yes, it is fixed
        </button>
        <input className="input it-work-note" aria-label="What is still wrong" placeholder="What is still wrong" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => void act.run(() => api.itAct('confirmTicket', { id, fixed: false, note }), 'Sent back to IT.')}>
          Not fixed
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}
