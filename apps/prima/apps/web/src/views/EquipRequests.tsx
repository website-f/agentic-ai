import { ArrowRightIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp, useRouteTab, type ViewName } from '../App';
import { Card, PageHead } from '../kit';
import { ErrorNotice, Loading, useLoad } from '../ui';
import { MyItemsPanel } from './MyItems';
import { UniformRequestQueue } from './Purchasing';
import { SiteSuppliesPanel } from './SiteSupplies';
import { WarrantyClaimsSection } from './Warranty';
import { SiteDisposalAsk, SiteMinMaxAsk, StoreMinMax, UniformRecordCard } from './EquipTools';
import { SopHelp } from '../sop/SopHelp';
import '../styles/sop.css';

/**
 * P121 (Fitri, 21 Nov 2026: "in equipment, where to order the equipment section, like the form?"): one place in the
 * Equipment app to ask for things and to answer what was asked.
 * - "Ask": the Operations Manager's uniform request for a guard and the site supplies request (Permohonan Pesanan
 *   Barang), the items to pass on with the signatures, and the person's own items. These are the same panels as on My
 *   details, which keeps them too. Below them, what happens after: a guard's uniform record and returns (T9, T11), a
 *   faulty item under warranty, a disposal request for site items (DISPOSAL_OF_GOODS) and a site's Min/Max (T4).
 * - "Store queue": what the storekeepers and the Procurement executive decide (the same panels as Procurement > Store),
 *   the store's Min/Max and the uniform record with the disposal of a returned worn or damaged piece (T12).
 * Every panel shows only what the server gives this person; the rules are in docs/UNIFORM_REQUESTS.md,
 * docs/SITE_SUPPLIES_REQUESTS.md, docs/INVENTORY_CONTROL.md and docs/DISPOSAL_OF_GOODS.md (see the SOP guide).
 */
type Tab = 'ask' | 'store';

/** Other things people ask for, and where. Shown only when the person has that screen. */
const ELSEWHERE: { view: ViewName; tab?: string; title: string; sub: string }[] = [
  { view: 'it', title: 'IT equipment or help', sub: 'A laptop, phone, account or repair: ask IT.' },
  { view: 'purchasing', tab: 'requests', title: 'Buy something new', sub: 'A purchase with quotes and approval (Procurement).' },
  { view: 'requests', title: 'Office repair or staff house stay', sub: 'Report office damage, or ask for a staff house for a work trip.' },
  { view: 'fleet', title: 'A company vehicle', sub: 'Book a vehicle or report a problem with one.' },
  { view: 'assets', title: 'Office assets', sub: 'Furniture and office equipment of the company.' },
  { view: 'items', title: 'Find an item', sub: 'Scan or search the item register: where it is and who holds it.' },
];

function StoreQueue() {
  const { me, go } = useApp();
  const { data, error } = useLoad(() => api.purBoard(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="store queue" />;
  const proc = data.roles.includes('proc');
  const store = proc || data.roles.includes('store');
  // As on Procurement > Store: the uniform queue is the Goodwill store's, for its storekeepers and Procurement only.
  const goodwill = data.stock.some((x) => x.item.companyId === 'goodwill') || data.suppliers.some((x) => x.supplier.companyId === 'goodwill');
  return (
    <>
      {store && goodwill && <UniformRequestQueue data={data} />}
      <SiteSuppliesPanel />
      {proc && <StoreMinMax data={data} />}
      <UniformRecordCard store={store || me.user.department === 'procurement'} />
      <Card title="More store work" sub="Issue to a person, record a return, confirm a loss, count the store, goods received and disposal cases are on Procurement > Store.">
        <button className="btn btn-sm" onClick={() => go({ view: 'purchasing', tab: 'store' })}>
          Open Procurement › Store <ArrowRightIcon size={14} aria-hidden="true" />
        </button>
      </Card>
    </>
  );
}

export function EquipRequestsView() {
  const { canOpen, go, me } = useApp();
  const store = !!canOpen?.('purchasing');
  const tabs: [Tab, string][] = [['ask', 'Ask'], ...(store ? ([['store', 'Store queue']] as [Tab, string][]) : [])];
  const [tab, setTab] = useRouteTab<Tab>('ask', tabs.map(([t]) => t));
  const others = ELSEWHERE.filter((o) => canOpen?.(o.view));
  const om = ['om', 'regional'].includes(me.user.opsTier ?? '');
  const watches = om || ['ogm', 'ops_director', 'coo'].includes(me.user.opsTier ?? '');
  return (
    <div className="page">
      <PageHead
        title="Ask for equipment"
        sub="Uniforms and site supplies for your guards and sites, and the store's answers. Each request shows its steps."
        actions={<SopHelp id="equip" />}
      />
      {tabs.length > 1 && (
        <div className="tabbar" role="tablist" aria-label="Ask for equipment">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'ask' && (
        <>
          <div className="sop-flowline" aria-label="Steps">
            <span>1. OM asks</span>
            <span>2. OGM confirms (site supplies)</span>
            <span>3. Store issues or buys</span>
            <span>4. Officer and guard sign on the OM's phone</span>
          </div>
          <MyItemsPanel />
          <EmptyHint />
          {watches && <UniformRecordCard />}
          <WarrantyClaimsSection source="stock" hideWhenEmpty />
          {om && <SiteDisposalAsk />}
          {om && <SiteMinMaxAsk />}
        </>
      )}
      {tab === 'store' && store && <StoreQueue />}
      {others.length > 0 && (
        <Card title="Something else?" sub="Other things are asked for on their own screens.">
          <div className="sop-links">
            {others.map((o) => (
              <button key={o.view} className="sop-link" onClick={() => go({ view: o.view, tab: o.tab })}>
                <span>
                  <strong>{o.title}</strong>
                  <span className="muted small">{o.sub}</span>
                </span>
                <ArrowRightIcon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** For someone who cannot ask (not an OM): say who does, instead of an empty page. */
function EmptyHint() {
  const { data } = useLoad(() => api.myItems(), []);
  if (!data || data.canRequestUniform) return null;
  return (
    <Card title="Who asks for uniforms and site supplies">
      <p className="muted">
        The Operations Manager (OM) or Regional OM covering the site asks for a guard's uniform and for site supplies. A
        guard, supervisor or patrolling officer tells their OM what is needed.
      </p>
    </Card>
  );
}
