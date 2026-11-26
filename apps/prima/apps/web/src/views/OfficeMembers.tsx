import { useRouteTab } from '../App';
import { office } from '../api/office';
import { Card, PageHead } from '../kit';
import { ErrorNotice, Loading, useLoad } from '../ui';
import { MembersTab } from './office/Members';
import { OfficeAccessTab } from './office/OfficeAccess';
import { OrganizationTab } from './office/Organization';
import { RolesAccessTab } from './office/RolesAccess';
import { PowersCtx, powersOf } from './office/shared';
import '../styles/office-admin.css';

/**
 * P135 (Fitri, 26 Nov 2026): the Agentic Office's Organization, Members and roles, Roles and access and Office access,
 * fully managed from Prima.
 * P139 (owner, 27 Nov 2026: "no web view"): the same four tabs drawn natively in Prima's own kit (views/office/*), no
 * frame. They call the office's own API on this same site (api/office.ts) with the office sign-in; the office checks
 * every permission again, and each tab shows only what /api/auth/me says this person may do. People and companies
 * added in Prima's People, Accounts and access and Group still reach the office by themselves (every 30 minutes).
 */
const TABS = [
  { id: 'organization', label: 'Organization' },
  { id: 'members', label: 'Members and roles' },
  { id: 'roles', label: 'Roles and access' },
  { id: 'access', label: 'Office access' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function OfficeMembersView() {
  const [tab, setTab] = useRouteTab<Tab>(
    'members',
    TABS.map((t) => t.id),
  );
  const me = useLoad(() => office.me(), []);
  const powers = me.data ? powersOf(me.data) : null;
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
