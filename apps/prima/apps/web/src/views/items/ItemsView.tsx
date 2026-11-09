// Items and equipment (P85; Fauzan, 6 Nov 2026; Fitri's paper v1.0). One register for every uniform, shoe, vest, radio,
// phone, IT device, office item, piece of furniture and cleaning stock in every company: one label for life (QR and
// Code 128 of the same ID), owner and holder kept apart, every handover confirmed by the person who gets it. Firearms
// stay in the Arms Control records. SQL Account is not connected: Finance works from export files only. Nothing is
// ever deducted from pay.
// P91 (Fitri, 9 Nov 2026: "where do I add the items?"): Add (new item type, register items) and Import from file sit at
// the top of the screen for the people who may add, and open here whichever tab is showing.
import { useEffect, useRef, useState } from 'react';
import { ArrowsLeftRightIcon, ClockCountdownIcon, PackageIcon, ScalesIcon, SirenIcon, TagIcon } from '@phosphor-icons/react';
import { api, type ItemBoard } from '../../api';
import { Card, PageHead, Stat, Stats } from '../../kit';
import { ErrorNotice, Loading, useLoad } from '../../ui';
import { Care } from './Care';
import { Cases } from './Cases';
import { Catalogue } from './Catalogue';
import { Counts } from './Counts';
import { FinanceBoard } from './FinanceBoard';
import { Mine } from './Mine';
import { Moves } from './Moves';
import { Find } from './Passport';
import { Reports } from './Reports';
import { SiteBoard } from './SiteBoard';
import { Stock } from './Stock';
import { Uniforms } from './Uniforms';
import { any } from './shared';
import { ItemsAddBar, type ItemAddIntent } from './AddMenu';
import { SkuForm } from './Catalogue';
import { RegisterPrint } from './Stock';
import '../../styles/items.css';

type Tab = 'find' | 'stock' | 'moves' | 'site' | 'counts' | 'cases' | 'care' | 'uniforms' | 'catalogue' | 'reports' | 'finance' | 'mine';

export function ItemsView() {
  const { data, error } = useLoad(() => api.itemBoard(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  const [adding, setAdding] = useState<{ what: ItemAddIntent; oldTag?: string; n: number } | null>(null);
  const addBox = useRef<HTMLDivElement>(null);
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
  const tabs: [Tab, string, boolean][] = [
    ['find', 'Find or scan', has],
    ['stock', 'Stock and labels', has],
    ['moves', 'Send and receive', has],
    ['site', 'Site board', data.siteChoices.length > 0],
    ['counts', 'Counts', handlesAny],
    ['cases', `Cases${openCases ? ` (${openCases})` : ''}`, has],
    ['care', `After-sale care${overdueCare ? ` (${overdueCare})` : ''}`, has],
    ['uniforms', `Uniforms${due ? ` (${due} due)` : ''}`, data.uniforms.rows.length > 0],
    ['catalogue', 'Item types', has],
    ['reports', 'Reports', has],
    ['finance', 'Finance and SQL', any(data, 'finance', 'manager', 'view')],
    ['mine', `My items (${data.mine.length})`, true],
  ];
  const shown = tabs.filter((t) => t[2]);
  const current = tab ?? (has ? 'find' : 'mine');
  const c = data.checks;
  const labelsTodo = data.items.filter((i) => (i.labelGen ?? 1) === 0 || i.labelVerifiedAt === null).length;
  return (
    <div className="page items-view">
      <PageHead
        title="Items and equipment"
        sub="One label for life per item, printed as a QR code and a barcode of the same ID. Owner and holder are kept apart; the person who gets an item confirms it themselves. Nothing is ever charged to them automatically."
        actions={<ItemsAddBar data={data} onAdd={(what) => add(what)} />}
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
      <p className="notice" data-tone="info">
        {data.armsNote} {data.sqlConnection.note}
      </p>
      {has && (
        <Stats>
          <Stat label="In transit" value={c.inTransit.length} tone={c.inTransit.length ? 'warn' : 'ok'} icon={<ArrowsLeftRightIcon size={16} />} onClick={() => setTab('moves')} />
          <Stat label="Open cases" value={c.openCases} tone={c.openCases ? 'warn' : 'ok'} icon={<SirenIcon size={16} />} onClick={() => setTab('cases')} />
          <Stat label="Waiting to confirm" value={c.unconfirmedHandovers.length} tone={c.unconfirmedHandovers.length ? 'warn' : 'ok'} icon={<ClockCountdownIcon size={16} />} />
          <Stat label="Labels to print or scan back" value={labelsTodo} tone={labelsTodo ? 'warn' : 'ok'} icon={<TagIcon size={16} />} onClick={() => setTab('stock')} />
          <Stat label="Ownership for Finance" value={c.ownershipPending.length} tone={c.ownershipPending.length ? 'warn' : 'ok'} icon={<ScalesIcon size={16} />} />
          <Stat label="Rental or loan overdue" value={c.overdueReturns.length} tone={c.overdueReturns.length ? 'crit' : 'ok'} icon={<PackageIcon size={16} />} />
        </Stats>
      )}
      <div className="tabbar" role="tablist" aria-label="Items">
        {shown.map(([t, l]) => (
          <button key={t} role="tab" type="button" aria-selected={current === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      <Body tab={current} data={data} onRegister={(oldTag) => add('register', oldTag)} />
    </div>
  );
}

function Body({ tab, data, onRegister }: { tab: Tab; data: ItemBoard; onRegister: (oldTag: string) => void }) {
  switch (tab) {
    case 'find':
      return <Find data={data} onRegister={any(data, 'store', 'manager', 'it') ? onRegister : undefined} />;
    case 'stock':
      return <Stock data={data} />;
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
    case 'catalogue':
      return <Catalogue data={data} />;
    case 'reports':
      return <Reports data={data} />;
    case 'finance':
      return <FinanceBoard data={data} />;
    case 'mine':
      return <Mine data={data} />;
  }
}
