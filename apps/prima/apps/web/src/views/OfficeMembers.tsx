import { useEffect } from 'react';
import { splitHash, useApp, useRouteTab, type ViewName } from '../App';
import { backClosedSheet } from '../back-close';
import { office } from '../api/office';
import { Card, PageHead } from '../kit';
import { ErrorNotice, Loading, useLoad } from '../ui';
import { MemberPage } from './office/MemberPage';
import { MembersTab } from './office/Members';
import { OfficeAccessTab } from './office/OfficeAccess';
import { OrganizationTab } from './office/Organization';
import { RolesAccessTab } from './office/RolesAccess';
import { backToMembers, forgetPushed, forgetReturn, isReturnAddress, memberIdOf, memberReturn } from './office/member-route';
import { PowersCtx, powersOf } from './office/shared';
import '../styles/office-admin.css';

/**
 * P135 (Fitri, 26 Nov 2026): the Agentic Office's Organization, Members and roles, Roles and access and Office access,
 * fully managed from Prima.
 * P139 (owner, 27 Nov 2026: "no web view"): the same four tabs drawn natively in Prima's own kit (views/office/*), no
 * frame. They call the office's own API on this same site (api/office.ts) with the office sign-in; the office checks
 * every permission again, and each tab shows only what /api/auth/me says this person may do. People and companies
 * added in Prima's People, Accounts and access and Group still reach the office by themselves (every 30 minutes).
 * P145b (owner, 27 Nov 2026): one member opens as a full page (#members/member/<user_id>), with Back to the list.
 */
const TABS = [
  { id: 'organization', label: 'Organization' },
  { id: 'members', label: 'Members and roles' },
  { id: 'roles', label: 'Roles and access' },
  { id: 'access', label: 'Office access' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function OfficeMembersView() {
  const { route, go, apps } = useApp();
  const [tab, setTab] = useRouteTab<Tab>(
    'members',
    TABS.map((t) => t.id),
  );
  const memberId = memberIdOf(route?.view === 'members' ? route.tab : undefined);
  const me = useLoad(() => office.me(), []);
  const powers = me.data ? powersOf(me.data) : null;
  // P145b: the phone's or browser's Back from a member's page comes back to the list (and Forward opens it again).
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (backClosedSheet(e)) return;
      const at = splitHash(location.hash);
      if (at.view !== 'members') {
        // P146: Back to the screen the member's page was opened from (the org chart as it was). Prima with apps opens
        // it itself; without, that screen is opened here.
        if (isReturnAddress(location.hash)) {
          forgetReturn();
          forgetPushed();
          if (!apps) go(at.tab ? { view: at.view as ViewName, tab: at.tab } : { view: at.view as ViewName });
        }
        return;
      }
      if (!memberIdOf(at.tab)) forgetPushed();
      go({ view: 'members', tab: at.tab || 'members' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [go, apps]);

  const waiting = !powers ? (
    me.error ? (
      <Card>
        <ErrorNotice error={`The office could not say who you are: ${me.error}`} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={me.reload}>
            Try again
          </button>
        </div>
      </Card>
    ) : (
      <Loading what="your access" />
    )
  ) : null;

  if (memberId)
    return (
      <div className="page oa-page">
        {powers ? (
          <PowersCtx.Provider value={powers}>
            <MemberPage key={memberId} userId={memberId} onBack={() => backToMembers(go, memberId)} backLabel={memberReturn()?.label} />
          </PowersCtx.Provider>
        ) : (
          waiting
        )}
      </div>
    );

  return (
    <div className="page oa-page">
      <PageHead
        title="Members and organization"
        sub="Everyone who signs in, their role and company, the companies and departments, what each role may do, and who runs the office."
      >
        <div className="tabbar" role="tablist" aria-label="Members and organization">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </PageHead>
      {!powers ? (
        waiting
      ) : (
        <PowersCtx.Provider value={powers}>
          <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
            {tab === 'organization' && <OrganizationTab />}
            {tab === 'members' && <MembersTab />}
            {tab === 'roles' && <RolesAccessTab />}
            {tab === 'access' && <OfficeAccessTab />}
          </div>
        </PowersCtx.Provider>
      )}
    </div>
  );
}
