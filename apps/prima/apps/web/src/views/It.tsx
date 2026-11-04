import {ItPurchaseDecision} from './ItPurchaseDecision';
import {WebTicketReview,WebTicketHistory} from './WebTicketReview';
import{RentalCorrections}from'./RentalCorrections';
import { ItOnboardingStep } from './ItOnboardingStep';
import { useState } from 'react';
import { arishaLeader } from '@prima/core';
import { api, type ItBoard } from '../api';
import { useApp } from '../App';
import { AssignPick, Jobs, MyWork, Systems, Team } from './ItWork';
import { AwayPanel, BuyFlow, ItAudit, ItTenders, LogTicket, RecordConfirm } from './ItPilot';
import { WebsitesView } from './Websites';
import { ItPlanView } from './ItPlan';
import { ItImport } from './ItImport';
import { ItManualPanel, manualItVisible } from './ItManual';
import { ItOperations } from './ItOperations';
import { ItGuide } from './ItGuide';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dataNotice, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * IT (Fauzan, 27 Oct 2026). IT runs the full lifecycle of IT and electronic assets: request, purchase, receive and tag,
 * assign, maintain and repair, dispose. It also watches domains and websites, answers help requests, sets up joiners
 * and leavers, and fills the IT part of tenders. The COO monitors and approves purchases; the CEO oversees.
 * Everyone else uses this screen to ask IT for help.
 */

type Tab = 'import' | 'audit' | 'work' | 'plan' | 'rental' | 'jobs' | 'team' | 'systems' | 'assets' | 'purchases' | 'maintenance' | 'websites' | 'tickets' | 'onboarding' | 'tenders' | 'mine';
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
const TONE_TEXT = { crit: 'Act now', unknown: 'Unknown', warn: 'Due soon', ok: 'In order' } as const;
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
  const [showGuide,setShowGuide]=useState(false);
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
  return (
    <div className="page">
      <div className="page-head">
        <h1>IT</h1>
        <p className="muted">
          {k
            ? 'Jobs given with a due date and done with proof, help requests, IT and electronic assets from purchase to disposal, joining and leaving, and the IT part of tenders. The IT Manager supervises, the IT Lead is technical, the COO monitors and the CEO owns every system.'
            : 'Ask IT for help with your account, device, Microsoft 365, the network or Prima, and follow your requests here.'}
        </p>
        <p className="notice" data-tone="info">
          <span>{dataNotice(me.dataMode)}</span>
          {data.pilot?.on && (
            <span>{` Pilot: only IT, the COO, the CEO, the ACT head, the HR administrator and the Finance Director sign in. Others reach IT on Teams, email or phone and IT logs it for them; approvals given in Teams Approvals are recorded here with a screenshot (${data.pilot.stack}).`}</span>
          )}
        </p>
      </div>
      <button className="btn" aria-expanded={showGuide} onClick={()=>setShowGuide(v=>!v)}>{showGuide?'Hide Arisha work guide':'Ask Arisha how to do my IT work'}</button>
      {showGuide&&<ItGuide key={me.user.id} allowedTabs={tabs.map(([id])=>id)} onOpen={id=>{if(tabs.some(([t])=>t===id))setTab(id);}}/>}
      {k && (
        <div className="kpis">
          <Kpi label="Jobs late" value={k.jobsLate} tone={k.jobsLate ? 'crit' : 'ok'} note={`${k.jobsOpen} open · ${k.jobsWaitingCheck} to check`} />
          <Kpi label="Purchases waiting" value={k.purchasesWaiting} tone={k.purchasesWaiting ? 'warn' : 'ok'} />
          <Kpi label="Help requests open" value={k.ticketsOpen} tone={k.ticketsLate ? 'crit' : 'ok'} note={`${k.ticketsLate} past the time limit`} />
          <Kpi label="Assets" value={k.assets} note={`${k.inRepair} in repair · ${k.serviceDue} service due`} />
          <Kpi label="Health inspection due / initial check" value={k.checkLate} tone={k.checkLate ? 'warn' : 'ok'} />
          <Kpi label="Joiners or leavers late" value={k.onboardingLate} tone={k.onboardingLate ? 'crit' : 'ok'} />
        </div>
      )}
      <div className="tabbar" role="tablist" aria-label="IT sections" style={{ flexWrap: 'wrap' }}>
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
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
      {current === 'assets' && <>{manualItVisible(me.user)&&<ItManualPanel mode="assets"/>}<Assets data={data} staff={staff} /></>}
      {current === 'purchases' && <Purchases data={data} staff={staff} />}
      {current === 'maintenance' && <><ItOperations mode="inspection"/><Maintenance data={data} staff={staff} /></>}
      {current === 'websites' && <WebsitesView />}
      {current === 'tickets' && <Tickets data={data} staff={staff} />}
      {current === 'onboarding' && <>{manualItVisible(me.user)&&<ItManualPanel mode="intake"/>}<Onboarding data={data} staff={staff} /></>}
      {current === 'tenders' && <ItTenders data={data} />}
      {current === 'mine' && <Mine data={data} />}
      {current === 'import' && arishaLeader(me.user) === 'ceo' && <ItImport />}
    </div>
  );
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
      <section className="panel">
        <div className="panel-head">
          <h3>By kind</h3>
        </div>
        <div className="list">
          {(data.byKind ?? []).map((b) => (
            <div key={b.kind} className="list-item">
              <span>{KIND[b.kind]}</span>
              <span className="muted small">
                {b.total} · {b.inUse} in use{b.repair ? ` · ${b.repair} in repair` : ''}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Register</h3>
          <span className="muted small">{rows.length} shown</span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <input className="input" aria-label="Search" placeholder="Tag, model, holder or company" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'] | 'ALL')}>
            <option value="ALL">Every kind</option>
            {(Object.keys(KIND) as Asset['kind'][]).map((x) => (
              <option key={x} value={x}>
                {KIND[x]}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Asset['status'] | 'ALL')}>
            <option value="ALL">Every status</option>
            {(Object.keys(STATUS) as Asset['status'][])
              .filter((s) => s !== 'disposed')
              .map((s) => (
                <option key={s} value={s}>
                  {STATUS[s][1]}
                </option>
              ))}
          </select>
        </div>
        <div className="list">
          {rows.slice(0, 80).map((r) => (
            <button
              key={r.asset.id}
              className="list-item"
              style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }}
              onClick={() => setOpen(r.asset.id)}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {r.asset.tag} · {r.asset.model}
                </div>
                <div className="muted small">
                  {assetProvenance(r)} · {r.asset.assignedTo ?? r.asset.location}
                  {r.checkLate ? ' · health inspection due or initial check needed' : ''}
                  {r.serviceDue ? ' · service due' : ''}
                  {r.warrantySoon ? ' · warranty ending' : ''}
                </div>
              </div>
              <Chip tone={STATUS[r.asset.status][0]}>{STATUS[r.asset.status][1]}</Chip>
            </button>
          ))}
          {rows.length > 80 && <div className="muted small">Showing 80 of {rows.length}. Search or filter to narrow.</div>}
          {!rows.length && <div className="empty">Nothing matches.</div>}
        </div>
      </section>
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
  const move = (status: Asset['status'], ok: string) => act.run(() => api.setItAsset(a.id, status, status === 'in_use' ? who : null, note), ok);
  return (
    <Drawer title={`${a.tag} · ${a.model}`} sub={`${KIND[a.kind]} · ${manualRecord(a)?.kind==='asset'?assetProvenance(r):`owned by Merdeka Network, rented to ${r.ownerName}`}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <section className="panel">
        <div className="list">
          <div className="list-item">
            <span>Status</span>
            <Chip tone={STATUS[a.status][0]}>{STATUS[a.status][1]}</Chip>
          </div>
          <div className="list-item">
            <span>With</span>
            <span>{a.assignedTo ?? a.location}</span>
          </div>
          <div className="list-item">
            <span>Bought</span>
            <span>{a.boughtOn?dateLabel(a.boughtOn):'Unknown — no purchase date recorded'}</span>
          </div>
          <div className="list-item">
            <span>Warranty to</span>
            <span>{a.warrantyTo ? dateLabel(a.warrantyTo) : 'Not recorded'}</span>
          </div>
          <div className="list-item">
            <span>Legacy/general check (not health inspection)</span>
            <span>{a.lastCheckedOn ? dateLabel(a.lastCheckedOn) : 'Not recorded'}</span>
          </div>
          {a.nextServiceOn && (
            <div className="list-item">
              <span>Next service</span>
              <span>{dateLabel(a.nextServiceOn)}</span>
            </div>
          )}
          <div className="list-item">
            <span>Serial</span>
            <span>{a.serial || 'Not recorded'}</span>
          </div>
        </div>
        {a.disposal && (
          <div className="notice" data-tone="warn">
            Disposal asked by {a.disposal.askedBy} on {dateTimeLabel(a.disposal.askedAt)}: {a.disposal.reason}
            {a.disposal.doneBy ? `. Disposed by ${a.disposal.doneBy}.` : '. Waiting for the IT Manager.'}
          </div>
        )}
      </section>
      {staff && a.status !== 'disposed' && (
        <section className="panel">
          <div className="panel-head">
            <h3>Move</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input className="input" aria-label="Holder" placeholder="Who has it (to assign)" value={who} onChange={(e) => setWho(e.target.value)} />
            <input className="input" aria-label="Note" placeholder="Note (needed to ask for disposal)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
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
                <button className="btn btn-sm" disabled={act.busy} onClick={() => move('disposed', 'Disposed. The record is kept.')}>
                  Dispose
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      <ItOperations mode="inspection" assetId={a.id}/>
      <section className="panel">
        <div className="panel-head">
          <h3>Service and repair history (separate from health inspections)</h3>
        </div>
        <div className="list">
          {!(a.maintenance ?? []).length && <div className="empty">None recorded.</div>}
          {[...(a.maintenance ?? [])].reverse().map((m) => (
            <div key={m.at} className="list-item">
              <span>
                {m.kind === 'service' ? 'Service' : 'Repair'}: {m.note}
              </span>
              <span className="muted small">
                {dateTimeLabel(m.at)} · {m.by} · {rm(m.cost)}
              </span>
            </div>
          ))}
        </div>
        {staff && a.status !== 'disposed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <input className="input" inputMode="decimal" aria-label="Cost" placeholder="Cost, RM" value={cost} onChange={(e) => setCost(e.target.value)} />
            <div className="row" style={{ gap: 6 }}>
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
            <p className="muted small">Write what was done in the note above.</p>
          </div>
        )}
      </section>
    </Drawer>
  );
}

function Purchases({ data, staff }: { data: ItBoard; staff: boolean }) {
  const [form, setForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Purchases</h3>
        {staff && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            Ask to buy
          </button>
        )}
      </div>
      <p className="muted small">
        {data.pilot?.on
          ? `An IT Executive asks and the IT Manager agrees the need. IT then gets ${data.buyRule.quotesNeeded} quotes from different suppliers and records one evidenced online comparison, each with its listing link and separate evidence. The COO approves, then the CEO in Prima; trusted Teams approval integration remains pending. Nothing is bought before both. The configured Finance team records the PO; IT records actual goods receipts; Finance matches the invoice before recording payment. A separate advance exception needs current COO then CEO approval. Use IT purchase fulfilment; no bank action is executed.`
          : 'An IT Executive asks and the IT Manager agrees the need (the COO when the IT Manager asks). Procurement then buys it: three quotes, an approved supplier, COO and CEO approval, and the goods received note. IT tags only what was received.'}
      </p>
      {form && <PurchaseForm onDone={() => setForm(false)} />}
      <div className="list">
        {(data.purchases ?? []).map((p) => (
          <PurchaseLine key={p.purchase.id} p={p} staff={staff} data={data} />
        ))}
      </div>
    </section>
  );
}

function PurchaseLine({ p: row, staff, data }: { p: NonNullable<ItBoard['purchases']>[number]; staff: boolean; data: ItBoard }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const p = row.purchase;
  const tone = p.status === 'rejected' ? 'crit' : p.status === 'received' ? 'ok' : row.canApprove || row.canDecide ? 'warn' : 'info';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {p.ref} · {rm(p.total)}
          </div>
          <div className="muted small">
            {p.items.map((i) => `${i.qty} × ${i.description}`).join(', ')} · {row.ownerName} · {p.reason}
          </div>
          <div className="muted small">
            Asked by {p.requestedBy} {dateTimeLabel(p.at)}
            {p.managerStep ? ` · IT Manager: ${p.managerStep.by}` : ''}
            {p.cooStep && !p.quotes ? ` · COO: ${p.cooStep.by}` : ''}
            {row.purRequest ? ` · Procurement ${row.purRequest.ref}` : ''}
            {p.received ? ` · ${p.received.assetIds.length} tagged` : ''}
            {(p.cooStep?.note || p.managerStep?.note) && p.status === 'rejected' ? ` · ${p.cooStep?.note || p.managerStep?.note}` : ''}
          </div>
        </div>
        <Chip tone={tone}>{p.status === 'rejected' ? 'Rejected' : p.status === 'received' ? 'Received' : `With ${row.waitingOn}`}</Chip>
      </div>
      {row.canApprove && <ItPurchaseDecision note={note} onNote={setNote} busy={act.busy}
        onDecide={(action, reason) => act.run(() => api.itPurchaseStep(p.id, action, { note: reason }), action === 'approve' ? 'Approved.' : 'Rejected.')} />}
      <BuyFlow row={row} data={data} />
      {row.canTag&&<p className="notice" data-tone="info">Record actual delivery quantities in IT purchase fulfilment. The previous direct tag/receipt shortcut is not used for the protected workflow.</p>}
      <ErrorNotice error={act.error} />
    </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      <input className="input" aria-label="Why" placeholder="Why it is needed" value={reason} onChange={(e) => setReason(e.target.value)} />
      <select className="select" aria-label="For" value={owner} onChange={(e) => setOwner(e.target.value)}>
        <option value="pwvsb">PWVSB</option>
        <option value="co-sasa">Sasa (pilot)</option>
        <option value="co-arsh">Arrow Shield (pilot)</option>
        <option value="co-inas">Inas (pilot)</option>
      </select>
      <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'])}>
        {(Object.keys(KIND) as Asset['kind'][]).map((x) => (
          <option key={x} value={x}>
            {KIND[x]}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Item" placeholder="Item and model" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        <input className="input" inputMode="numeric" aria-label="Quantity" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input
          className="input"
          inputMode="decimal"
          aria-label="Unit price"
          placeholder="Unit price, RM"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
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
      <ErrorNotice error={act.error} />
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
    <button key={r.asset.id} className="list-item" style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap', gap: 6 }} onClick={() => setOpen(r.asset.id)}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {r.asset.tag} · {r.asset.model}
        </div>
        <div className="muted small">
          {r.ownerName} · {detail}
        </div>
      </div>
      <Chip tone={tone}>{chip}</Chip>
    </button>
  );
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Service due (CCTV, network, printers)</h3>
        </div>
        <div className="list">
          {!due.length && <div className="empty">Nothing due in the next 14 days.</div>}
          {due.map((r) =>
            line(r, `due ${dateLabel(r.asset.nextServiceOn!)}`, r.asset.nextServiceOn! < new Date().toISOString().slice(0, 10) ? 'crit' : 'warn', 'Service'),
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>In repair</h3>
        </div>
        <div className="list">
          {!repair.length && <div className="empty">None.</div>}
          {repair.map((r) => line(r, r.asset.maintenance?.at(-1)?.note ?? 'No note', 'warn', 'Repair'))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Disposal asked</h3>
        </div>
        <div className="list">
          {!disposal.length && <div className="empty">None.</div>}
          {disposal.map((r) => line(r, r.asset.disposal?.reason ?? '', 'warn', 'IT Manager'))}
        </div>
      </section>
      {row && <AssetDrawer row={row} staff={staff} manager={data.role === 'manager'} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The domain and website register moved to its own Websites screen (Fauzan, 27 Oct 2026), so there is one register. */
function Tickets({ data, staff }: { data: ItBoard; staff: boolean }) {
  const [showDone, setShowDone] = useState(false);
  const [log, setLog] = useState(false);
  const rows = (data.tickets ?? []).filter((t) => showDone || t.ticket.status !== 'resolved');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Help requests</h3>
        <div className="row" style={{ gap: 6 }}>
          {staff && (
            <button className="btn btn-sm" onClick={() => setLog(!log)}>
              Log a request
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide resolved' : 'Show resolved'}
          </button>
        </div>
      </div>
      {log && <LogTicket onDone={() => setLog(false)} />}
      <p className="muted small">
        Time limits: P1 {data.rule.slaHours.P1} hours, P2 {data.rule.slaHours.P2} hours, P3 {data.rule.slaHours.P3} hours.
      </p>
      <div className="list">
        {!rows.length && <div className="empty">Nothing open.</div>}
        {rows.map((t) => (
          <TicketLine key={t.ticket.id} t={t} staff={staff} data={data} />
        ))}
      </div>
    </section>
  );
}

function TicketLine({ t: row, staff, data }: { t: NonNullable<ItBoard['tickets']>[number]; staff: boolean; data: ItBoard }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const { me } = useApp();
  const t = row.ticket;
  const done = t.status === 'resolved';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {t.ref} · {t.title}
          </div>
          <div className="muted small">
            {t.priority} · {CATEGORY[t.category]} · {t.raisedBy}
            {t.raisedFor ? ` (logged by IT, via ${t.channel === 'in_person' ? 'in person' : t.channel})` : ''} · {dateTimeLabel(t.at)}
            {t.assignedTo ? ` · with ${t.assignedTo}` : ''}
            {done ? ` · ${t.resolution}` : ` · due ${dateTimeLabel(row.due)}`}
            {done && t.resolvedBy ? ` · fixed by ${t.resolvedBy}` : ''}
            {done && !row.webPolicy ? ` · ${row.confirm === 'confirmed' ? (t.confirmedVia ? `confirmed: ${t.confirmedVia}` : 'confirmed by the person') : row.confirm === 'waiting' ? 'waiting for the person to confirm' : 'not answered, counted as confirmed'}` : ''}
            {t.reopened ? ` · reopened ${t.reopened}×` : ''}
            {row.toCoo ? ' · the COO sees it' : ''}
          </div>
        </div>
        <Chip tone={row.breached ? 'crit' : done ? 'ok' : t.status === 'in_progress' ? 'info' : 'warn'}>
          {row.webPolicy&&done?(t.confirmedAt?'Fix confirmed':'Resolved; confirmation pending'):row.breached ? (done ? 'Resolved late' : 'Past time limit') : done ? 'Resolved' : t.status === 'in_progress' ? 'Being worked' : 'Open'}
        </Chip>
      </div>
      {!row.webPolicy && row.canRecord && row.confirm === 'waiting' && <RecordConfirm id={t.id} />}
      {row.webPolicy&&<WebTicketReview key={t.id} confirmedAt={t.confirmedAt} policy={row.webPolicy} submit={(action,note,expectedResolutionVersion)=>api.itAct(action==='reopen'?'reopenWebTicket':'confirmTicket',{id:t.id,note,expectedResolutionVersion,...(action==='reopen'?{}:{fixed:action==='confirm'})})}/>}
      {row.webPolicy&&<WebTicketHistory entries={t.webHistory}/>}
      {row.canAssign && (
        <AssignPick data={data} current={t.assignedToId} busy={act.busy} onPick={(id) => void act.run(() => api.itAct('assignTicket', { id: t.id, toId: id }), 'Given.')} />
      )}
      {staff && row.canWork && (
        <>
          <input className="input" aria-label="What fixed it" placeholder="What fixed it" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            {t.status === 'open' && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.itTicketStep(t.id, 'take', ''), 'Taken.')}>
                Take it
              </button>
            )}
            <button
              className="btn btn-sm"
              disabled={act.busy || !note.trim()}
              onClick={() => act.run(() => api.itTicketStep(t.id, 'resolve', note), 'Resolved.')}
            >
              Resolve
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Onboarding({ data, staff }: { data: ItBoard; staff: boolean }) {
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Joining and leaving</h3>
      </div>
      <p className="muted small">
        Track the work needed for joiners and leavers. These checklists record staff-reported completion with evidence, not independent checking or certification. They do not create accounts, revoke access or prove changes in Microsoft.
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {(data.onboarding ?? []).map((o) => (
          <div key={o.item.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{o.item.personName}{manualRecord(o.item)&&!manualRecord(o.item)?.personUserId&&<Chip tone="unknown">Unlinked identity</Chip>}</div>
                <div className="muted small">
                  {o.item.kind === 'join' ? 'Joins' : 'Leaves'} {dateLabel(o.item.on)} · {o.item.jobTitle} · {manualRecord(o.item)&&!manualRecord(o.item)?.companyId?`${manualRecord(o.item)?.unitLabel||'Unlinked organization'} (not verified)`:o.ownerName} · {o.staffName ?? 'not given to anyone'}
                </div>
              </div>
              <Chip tone={o.late ? 'crit' : o.soon ? 'warn' : o.open ? 'info' : 'ok'}>{o.open ? (o.late ? `${o.open} late` : `${o.open} to do`) : 'All steps recorded — not independently checked'}</Chip>
            </div>
            {data.assigner && o.open > 0 && (
              <AssignPick
                data={data}
                current={o.item.ownerStaffId}
                busy={act.busy}
                onPick={(id) => void act.run(() => api.itAct('setOwner', { what: 'onboarding', id: o.item.id, toId: id }), 'Given.')}
              />
            )}
            {o.item.steps.map((s) => <ItOnboardingStep key={s.key} step={s} canTick={o.canTick} busy={act.busy} onSave={(done,evidence,version)=>void act.run(()=>api.setItOnboardingStep(o.item.id,s.key,done,evidence,version))}/>)}
          </div>
        ))}
      </div>
    </section>
  );
}

function Mine({ data }: { data: ItBoard }) {
  const act = useAction();
  const [category, setCategory] = useState<keyof typeof CATEGORY>('M365');
  const [priority, setPriority] = useState<'P1' | 'P2' | 'P3'>('P3');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Ask IT for help</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select className="select" aria-label="About" value={category} onChange={(e) => setCategory(e.target.value as keyof typeof CATEGORY)}>
            {(Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY[c]}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value as 'P1' | 'P2' | 'P3')}>
            <option value="P1">P1: I cannot work at all</option>
            <option value="P2">P2: work is slowed down</option>
            <option value="P3">P3: a question or training</option>
          </select>
          <input className="input" aria-label="What is wrong" placeholder="What is wrong" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" aria-label="Details" placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
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
          <ErrorNotice error={act.error} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>My requests</h3>
        </div>
        <div className="list">
          {!data.mine.length && <div className="empty">You have not asked IT for anything yet.</div>}
          {data.mine.map((t) => (
            <div key={t.id} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {t.ref} · {t.title}
                </div>
                <div className="muted small">
                  {t.priority} · {CATEGORY[t.category]} · {dateTimeLabel(t.at)}
                  {t.assignedTo ? ` · with ${t.assignedTo}` : ''}
                  {t.resolution ? ` · ${t.resolution}` : ''}
                </div>
              </div>
              <Chip tone={t.status === 'resolved' ? 'ok' : t.status === 'in_progress' ? 'info' : 'warn'}>
                {t.status === 'resolved' ? (t.confirmedAt ? 'Fixed, confirmed' : 'Resolved') : t.status === 'in_progress' ? 'Being worked' : 'Open'}
              </Chip>
              {t.webPolicy?<WebTicketReview key={t.id} confirmedAt={t.confirmedAt} policy={t.webPolicy} submit={(action,note,expectedResolutionVersion)=>api.itAct(action==='reopen'?'reopenWebTicket':'confirmTicket',{id:t.id,note,expectedResolutionVersion,...(action==='reopen'?{}:{fixed:action==='confirm'})})}/>:t.canConfirm&&<ConfirmFix id={t.id}/>}
              {t.webPolicy&&<WebTicketHistory entries={t.webHistory}/>}
              {!t.webPolicy && t.confirmNote && (
                <div className="muted small" style={{ width: '100%' }}>
                  {t.confirmNote}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/** The person who asked says whether it is really fixed; "not fixed" reopens it with the same IT person. */
function ConfirmFix({ id }: { id: string }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.itAct('confirmTicket', { id, fixed: true }), 'Thank you. Confirmed.')}>
          Yes, it is fixed
        </button>
        <input className="input" aria-label="What is still wrong" placeholder="What is still wrong" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => void act.run(() => api.itAct('confirmTicket', { id, fixed: false, note }), 'Sent back to IT.')}>
          Not fixed
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}
