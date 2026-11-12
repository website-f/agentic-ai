// Items and equipment (P85; Fauzan, 6 Nov 2026; Fitri's paper v1.0). One register for every uniform, shoe, vest, radio,
// phone, IT device, office item, piece of furniture and cleaning stock in every company: one label for life (QR and
// Code 128 of the same ID), owner and holder kept apart, every handover confirmed by the person who gets it. Firearms
// stay in the Arms Control records. SQL Account is not connected: Finance works from export files only. Nothing is
// ever deducted from pay.
// P91 (Fitri, 9 Nov 2026: "where do I add the items?"): Add (new item type, register items) and Import from file sit at
// the top of the screen for the people who may add, and open here whichever tab is showing.
// P98 (Fitri, 11 Nov 2026: still no Add for her; "the UI is quite confusing: make it very intuitive"): the server says
// who may add (the owner too), and the screen opens on an overview: what to do first, each part with its count, Add
// and Import always at the top. Import reads any item list or stock report (SmartImport); every item type has its own
// QR code from its code (Labels).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowsLeftRightIcon,
  BarcodeIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  ClockCountdownIcon,
  CoinsIcon,
  HeartbeatIcon,
  ListChecksIcon,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
  QrCodeIcon,
  ScalesIcon,
  ShirtFoldedIcon,
  SirenIcon,
  StackIcon,
  TagIcon,
  UploadSimpleIcon,
  UserIcon,
} from '@phosphor-icons/react';
import { api, type ItemBoard } from '../../api';
import { Card, PageHead, Stat, Stats } from '../../kit';
import { ErrorNotice, Loading, useLoad } from '../../ui';
import { Care } from './Care';
import { Cases } from './Cases';
import { Catalogue, SkuForm } from './Catalogue';
import { Counts } from './Counts';
import { FinanceBoard } from './FinanceBoard';
import { Mine } from './Mine';
import { Moves } from './Moves';
import { Find } from './Passport';
import { Reports } from './Reports';
import { SiteBoard } from './SiteBoard';
import { LabelsToPrint, RegisterPrint, Stock } from './Stock';
import { Uniforms } from './Uniforms';
import { any } from './shared';
import { ItemsAddBar, mayAddTypes, mayRegister, type ItemAddIntent } from './AddMenu';
import { SmartImport } from './SmartImport';
import { TypeCard, TypeLabelPrint, TypeLabelsPicker } from './TypeLabels';
import '../../styles/items.css';

type Tab = 'home' | 'find' | 'catalogue' | 'stock' | 'labels' | 'moves' | 'site' | 'counts' | 'cases' | 'care' | 'uniforms' | 'reports' | 'finance' | 'mine';

export function ItemsView() {
  const { data, error } = useLoad(() => api.itemBoard(), []);
  // I1 (P100): an OM who asks the Goodwill store for uniforms, or the store that decides, gets the Uniforms tab even with
  // no guards in the item register (the request panel lives there). False when the module is not installed yet.
  const { data: asksUniforms } = useLoad(() => api.uniformRequests().then((r) => r.canRequest || r.canDecide, () => false), []);
  const [tab, setTab] = useState<Tab | null>(null);
  const [adding, setAdding] = useState<{ what: ItemAddIntent; oldTag?: string; n: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [typeOpen, setTypeOpen] = useState<string | null>(null);
  const [printTypes, setPrintTypes] = useState<string[] | null>(null);
  const addBox = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (adding) addBox.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [adding]);
  const add = (what: ItemAddIntent, oldTag?: string) => setAdding((cur) => ({ what, oldTag, n: (cur?.n ?? 0) + 1 }));
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="item register" />
      </div>
    );
  const has = data.roles.length > 0;
  const handlesAny = any(data, 'store', 'manager', 'ops', 'it');
  const overdueCare = data.care.filter((c) => c.status === 'overdue' || c.status === 'end_of_life').length;
  const due = data.uniforms.rows.filter((r) => r.status === 'due').length;
  const openCases = data.cases.filter((c) => c.status === 'open').length;
  const labelsTodo = data.items.filter((i) => (i.labelGen ?? 1) === 0 || i.labelVerifiedAt === null).length;
  const openMoves = data.movements.filter((m) => m.status !== 'received' && m.status !== 'cancelled').length;
  const openCounts = data.counts.filter((c) => !c.closed).length;
  const mayImport = mayAddTypes(data) && mayRegister(data);
  const go = (t: Tab) => {
    setTab(t);
    setTimeout(() => tabs.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 0);
  };
  const all: [Tab, string, number | null, boolean, ReactNode][] = [
    ['home', 'Overview', null, has, <StackIcon key="i" size={18} aria-hidden="true" />],
    ['find', 'Scan or find', null, has, <QrCodeIcon key="i" size={18} aria-hidden="true" />],
    ['catalogue', 'Item types', data.skus.length, has, <ListChecksIcon key="i" size={18} aria-hidden="true" />],
    ['stock', 'Stock', null, has, <PackageIcon key="i" size={18} aria-hidden="true" />],
    ['labels', 'Labels', labelsTodo || null, has, <TagIcon key="i" size={18} aria-hidden="true" />],
    ['moves', 'Send and receive', openMoves || null, has, <ArrowsLeftRightIcon key="i" size={18} aria-hidden="true" />],
    ['counts', 'Counts', openCounts || null, handlesAny, <ClipboardTextIcon key="i" size={18} aria-hidden="true" />],
    ['site', 'Site board', null, data.siteChoices.length > 0, <MapPinIcon key="i" size={18} aria-hidden="true" />],
    ['cases', 'Cases', openCases || null, has, <SirenIcon key="i" size={18} aria-hidden="true" />],
    ['care', 'After-sale care', overdueCare || null, has, <HeartbeatIcon key="i" size={18} aria-hidden="true" />],
    ['uniforms', 'Uniforms', due || null, data.uniforms.rows.length > 0 || !!asksUniforms, <ShirtFoldedIcon key="i" size={18} aria-hidden="true" />],
    ['reports', 'Reports', null, has, <ChartBarIcon key="i" size={18} aria-hidden="true" />],
    ['finance', 'Finance and SQL', null, any(data, 'finance', 'manager', 'view'), <CoinsIcon key="i" size={18} aria-hidden="true" />],
    ['mine', 'My items', data.mine.length, true, <UserIcon key="i" size={18} aria-hidden="true" />],
  ];
  const shown = all.filter((t) => t[3]);
  const current = tab ?? (has ? 'home' : 'mine');
  const c = data.checks;
  return (
    <div className="page items-view">
      <PageHead
        title="Items and equipment"
        sub="Every uniform, device and stock item: what it is, where it is, who holds it. One label for life; the person who gets an item confirms it. Nothing is ever charged to them automatically."
        actions={<ItemsAddBar data={data} onAdd={(what) => add(what)} onImport={() => setImporting(true)} />}
      />
      {adding && (
        <div ref={addBox} className="it-adding">
          {adding.what === 'type' ? (
            <Card
              title="New item type"
              sub="The item type says what it is, its size and unit. Many units share one type. How a type is tracked is set once."
              actions={
                <button className="btn" type="button" onClick={() => setAdding(null)}>
                  Cancel
                </button>
              }
            >
              <SkuForm key={adding.n} onDone={() => setAdding(null)} />
            </Card>
          ) : (
            <RegisterPrint key={adding.n} data={data} legacyRef={adding.oldTag} onClose={() => setAdding(null)} />
          )}
        </div>
      )}
      <div ref={tabs} className="it-nav" role="tablist" aria-label="Items">
        {shown.map(([t, l, n, , icon]) => (
          <button key={t} role="tab" type="button" aria-selected={current === t} onClick={() => setTab(t)}>
            {icon}
            <span>{l}</span>
            {n !== null && n > 0 && <span className="it-nav-n">{n}</span>}
          </button>
        ))}
      </div>
      {current === 'home' ? (
        <Overview data={data} go={go} onImport={mayImport ? () => setImporting(true) : undefined} onAdd={mayAddTypes(data) ? () => add('type') : undefined} labelsTodo={labelsTodo} openMoves={openMoves} openCounts={openCounts} />
      ) : (
        <Body
          tab={current}
          data={data}
          onRegister={mayRegister(data) ? (oldTag) => add('register', oldTag) : undefined}
          onType={setTypeOpen}
          onImport={mayImport ? () => setImporting(true) : undefined}
          onAddType={mayAddTypes(data) ? () => add('type') : undefined}
        />
      )}
      {current === 'home' && has && (
        <Stats>
          <Stat label="In transit" value={c.inTransit.length} tone={c.inTransit.length ? 'warn' : 'ok'} icon={<ArrowsLeftRightIcon size={16} />} onClick={() => go('moves')} />
          <Stat label="Open cases" value={c.openCases} tone={c.openCases ? 'warn' : 'ok'} icon={<SirenIcon size={16} />} onClick={() => go('cases')} />
          <Stat label="Waiting to confirm" value={c.unconfirmedHandovers.length} tone={c.unconfirmedHandovers.length ? 'warn' : 'ok'} icon={<ClockCountdownIcon size={16} />} onClick={() => go('moves')} />
          <Stat label="Labels to print or scan back" value={labelsTodo} tone={labelsTodo ? 'warn' : 'ok'} icon={<TagIcon size={16} />} onClick={() => go('labels')} />
          <Stat label="Ownership for Finance" value={c.ownershipPending.length} tone={c.ownershipPending.length ? 'warn' : 'ok'} icon={<ScalesIcon size={16} />} />
          <Stat label="Rental or loan overdue" value={c.overdueReturns.length} tone={c.overdueReturns.length ? 'crit' : 'ok'} icon={<PackageIcon size={16} />} onClick={() => go('moves')} />
        </Stats>
      )}
      {(current === 'home' || current === 'find') && (
        <p className="notice small" data-tone="info">
          {data.armsNote} {data.sqlConnection.note}
        </p>
      )}
      {importing && <SmartImport data={data} onClose={() => setImporting(false)} />}
      {typeOpen && <TypeCard data={data} skuId={typeOpen} onClose={() => setTypeOpen(null)} onPrint={(ids) => (setTypeOpen(null), setPrintTypes(ids))} />}
      {printTypes && <TypeLabelPrint data={data} skuIds={printTypes} onClose={() => setPrintTypes(null)} />}
    </div>
  );
}

/** The first screen: what to do first, then each part of the register with its count. */
function Overview({
  data,
  go,
  onImport,
  onAdd,
  labelsTodo,
  openMoves,
  openCounts,
}: {
  data: ItemBoard;
  go: (t: Tab) => void;
  onImport?: () => void;
  onAdd?: () => void;
  labelsTodo: number;
  openMoves: number;
  openCounts: number;
}) {
  const stockQty = data.balance.reduce((a, b) => a + b.qty, 0);
  const empty = !data.skus.length;
  const tile = (t: Tab, icon: ReactNode, title: string, sub: string, n?: number | null, tone?: 'warn') => (
    <button type="button" className="it-tile" onClick={() => go(t)} data-tone={tone}>
      <span className="it-tile-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="it-tile-text">
        <strong>{title}</strong>
        <span className="muted small">{sub}</span>
      </span>
      {n !== undefined && n !== null && <span className="it-tile-n">{n}</span>}
    </button>
  );
  return (
    <div className="it-stack">
      {empty && (onImport || onAdd) ? (
        <section className="it-hero">
          <h2>Start with your item list</h2>
          <p className="muted">
            Load the list you already have: the old system's stock item list, stock balance or stock card, as Excel, CSV or PDF. Prima reads every column, merges the files by item code, and gives each item its QR code.
          </p>
          <div className="it-hero-actions">
            {onImport && (
              <button className="btn btn-primary it-big" type="button" onClick={onImport}>
                <UploadSimpleIcon size={20} aria-hidden="true" /> Import from file
              </button>
            )}
            {onAdd && (
              <button className="btn it-big" type="button" onClick={onAdd}>
                <PlusIcon size={20} aria-hidden="true" /> Add an item type by hand
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="it-quick">
          <button className="btn btn-primary it-big" type="button" onClick={() => go('find')}>
            <BarcodeIcon size={20} aria-hidden="true" /> Scan or find an item
          </button>
          {onImport && (
            <button className="btn it-big it-wide-only" type="button" onClick={onImport}>
              <UploadSimpleIcon size={20} aria-hidden="true" /> Import from file
            </button>
          )}
        </section>
      )}
      <div className="it-tiles">
        {tile('catalogue', <ListChecksIcon size={22} />, 'Item types', 'What each item is, its unit, price and QR code', data.skus.length)}
        {tile('stock', <PackageIcon size={22} />, 'Stock', 'How many, who owns and who holds them', stockQty)}
        {tile('labels', <TagIcon size={22} />, 'Labels', 'Print QR labels; scan new labels back', labelsTodo || null, labelsTodo ? 'warn' : undefined)}
        {tile('moves', <ArrowsLeftRightIcon size={22} />, 'Send and receive', 'Deliveries between companies and sites', openMoves || null)}
        {data.siteChoices.length > 0 && tile('site', <MapPinIcon size={22} />, 'Site board', 'What is at each site')}
        {any(data, 'store', 'manager', 'ops', 'it') && tile('counts', <ClipboardTextIcon size={22} />, 'Counts', 'Count the store or a site, then review', openCounts || null)}
        {tile('reports', <ChartBarIcon size={22} />, 'Reports', 'Stock, movements and cases, as CSV')}
        {tile('mine', <UserIcon size={22} />, 'My items', 'What you hold, to confirm or return', data.mine.length)}
      </div>
    </div>
  );
}

function Body({
  tab,
  data,
  onRegister,
  onType,
  onImport,
  onAddType,
}: {
  tab: Tab;
  data: ItemBoard;
  onRegister?: (oldTag: string) => void;
  onType: (skuId: string) => void;
  onImport?: () => void;
  onAddType?: () => void;
}) {
  switch (tab) {
    case 'home':
    case 'find':
      return <Find data={data} onRegister={onRegister} onType={onType} />;
    case 'catalogue':
      return <Catalogue data={data} onAdd={onAddType} onImport={onImport} />;
    case 'stock':
      return <Stock data={data} onImport={onImport} onType={onType} />;
    case 'labels':
      return (
        <div className="it-stack">
          <LabelsToPrint data={data} always />
          <TypeLabelsPicker data={data} />
        </div>
      );
    case 'moves':
      return <Moves data={data} />;
    case 'site':
      return <SiteBoard data={data} />;
    case 'counts':
      return <Counts data={data} />;
    case 'cases':
      return <Cases data={data} />;
    case 'care':
      return <Care data={data} />;
    case 'uniforms':
      return <Uniforms data={data} />;
    case 'reports':
      return <Reports data={data} />;
    case 'finance':
      return <FinanceBoard data={data} />;
    case 'mine':
      return <Mine data={data} />;
  }
}
