import type { HomeLink } from '@prima/core';
import { myName } from '../office-access';
import { useApp } from '../App';
import { setFinTarget } from '../finTarget';
import { HomeLaunchpad, SpaceHome } from '../Spaces';
import { useHome } from './Home';
import { spaceOf, type SpaceId } from '../nav-catalog';
import '../styles/home.css';
import { Suspense, lazy } from 'react';

// P122 (speed): an app's "How work flows here" strip carries the whole SOP guide (about 0.6 MB): fetched after the page shows.
const SpaceSops = lazy(() => import('./Sop').then((m) => ({ default: m.SpaceSops })));

/**
 * P91: an app's own home page (`#@hr`): its screens, and the items from this person's home list that belong to it. The
 * screens show at once; the waiting items follow when the home list has loaded (a failed load only hides that part).
 */
export function SpaceRoute({ id }: { id: SpaceId }) {
  const { me, companyId, setCompanyId, go, menu, openSpace, canOpen } = useApp();
  const companyScoped = me.user.role === 'company_manager' || me.user.role === 'admin_exec';
  // The waiting items come from the person's home list, so only for people whose menu has the home screen.
  const hasHome = canOpen?.('home') ?? false;
  // P148d: the same last-shown home as the Home screen (views/Home useHome), so an app's waiting items show at once.
  const { data } = useHome(me.user.id, companyScoped ? companyId : undefined, hasHome);
  const open = (l: HomeLink) => {
    if (l.view === 'finance' && l.tab) setFinTarget({ tab: l.tab, section: l.section, companyId: l.companyId });
    else if (l.companyId) setCompanyId(l.companyId);
    go({ view: l.view, siteId: l.siteId, personId: l.personId, caseId: l.caseId, tenderId: l.tenderId });
  };
  return <SpaceHome id={id} menu={menu ?? []} waitingItems={data?.todo} onView={(v) => go({ view: v })} onLink={open} onBack={() => openSpace?.(null)} extra={<Suspense fallback={null}><SpaceSops id={id} /></Suspense>} />;
}

/**
 * P91: the home screen for a person with apps whose menu has no Home dashboard (central staff such as Operations,
 * Finance or IT): the greeting, one search, their main screens and the app cards. It reads no dashboard data.
 */
export function LaunchpadView() {
  const { me, go, menu, openSpace } = useApp();
  const items = menu ?? [];
  const main = items.filter((i) => spaceOf(i.view) !== 'home').slice(0, 3);
  return (
    <div className="page home">
      {openSpace && <HomeLaunchpad name={myName(me)} menu={items} main={main} userId={me.user.id} waiting={{}} onView={(v) => go({ view: v })} onSpace={openSpace} />}
    </div>
  );
}
