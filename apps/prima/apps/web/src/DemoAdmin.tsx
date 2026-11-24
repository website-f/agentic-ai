import { useEffect, useMemo, useState } from 'react';
import type { User } from '@prima/core';
import { api } from './api';
import type { Me } from './api/types';

declare const __DEMO__: boolean;

/**
 * DEMO global admin (Fauzan, 23 Nov 2026: "Create a global admin global user DEMO to see how the system works").
 *
 * Test version only. It is not a new account or a new permission: it opens the test version as the CEO with every
 * made-up person able to sign in (the IT pilot limit lifted in this browser only), and adds a "View as" bar so the
 * owner can jump between every department, company and role and see exactly what that person sees, under that
 * person's own rules. The server-connected build compiles all of this out (`__DEMO__` is false there), so it can
 * never become a way into the real system.
 */
const ADMIN_KEY = 'prima-demo-global-admin';
const ALL_STAFF_KEY = 'prima-demo-all-staff';
const USER_KEY = 'prima-demo-user';
const START_AS = 'u-fauzan';

const DEPT: Record<string, string> = {
  finance: 'Finance', hr: 'HR', fwm: 'Foreign Worker Management', it: 'IT (Merdeka Network)', procurement: 'Procurement and Inventory',
  transport: 'Transport', arms_control: 'Arms Control', asset: 'Asset Management', audit: 'ACT (Audit, Compliance and Transformation)',
  operations: 'Operations', cms: 'CMS command centre', chief_of_staff: 'Chief of Staff office', director_office: 'Director Office',
  pdpa: 'PDPA', legal: 'Legal', marketing: 'Marketing',
};
const ROLE: Record<User['role'], string> = {
  director: 'Group leadership', pwvsb_officer: 'PWVSB central', company_manager: 'Company managers', admin_exec: 'Company admin executives',
  supervisor: 'Supervisors and officers', site_device: 'Site devices', guard: 'Guards (own view)',
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True only in the test version, after the owner chose DEMO global admin in this browser. */
export function demoAdminOn(): boolean {
  return __DEMO__ && api.mode === 'demo' && read(ADMIN_KEY) === '1';
}

/** Open the test version as the DEMO global admin: start as the CEO, with every made-up person able to sign in. */
export function startDemoAdmin(): void {
  if (!__DEMO__ || api.mode !== 'demo') return;
  try {
    localStorage.setItem(ADMIN_KEY, '1');
    localStorage.setItem(ALL_STAFF_KEY, '1');
    localStorage.setItem(USER_KEY, START_AS);
  } catch {
    /* private window: nothing to keep */
  }
  // The pilot limit is read when the test data starts, so open the page again.
  location.reload();
}

export function endDemoAdmin(): void {
  try {
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(ALL_STAFF_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}

export function groupOf(u: User): string {
  if (u.role === 'director' || (u.role === 'pwvsb_officer' && (u.leadership || u.opsTier === 'ceo' || u.opsTier === 'coo'))) return 'Group leadership';
  if (u.role === 'pwvsb_officer') return u.department ? (DEPT[u.department] ?? u.department) : ROLE.pwvsb_officer;
  return ROLE[u.role] ?? u.role;
}

/** The sign-in card for the test version. */
export function DemoAdminCard() {
  if (!__DEMO__ || api.mode !== 'demo') return null;
  return (
    <div className="demo-admin-card">
      <div>
        <strong>DEMO global admin</strong>
        <div className="small">
          See how the whole system works: start as the CEO, then switch to any department, company or role from the bar at the top. Made-up data
          only, this browser only. Not part of the real system.
        </div>
      </div>
      <button className="btn btn-primary" onClick={startDemoAdmin}>
        Open as DEMO global admin
      </button>
    </div>
  );
}

/** The "View as" bar shown on every screen while the DEMO global admin is on. */
export function DemoAdminBar({ me, onSwitch }: { me: Me; onSwitch: (me: Me) => void }) {
  const [people, setPeople] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listUsers().then(setPeople, (e: Error) => setError(e.message));
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, User[]>();
    for (const u of people ?? []) {
      const g = groupOf(u);
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(u);
    }
    const order = (g: string) => (g === 'Group leadership' ? 0 : Object.values(ROLE).includes(g) ? 2 : 1);
    return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [people]);
  if (!demoAdminOn()) return null;
  return (
    <div className="demo-admin-bar" role="region" aria-label="DEMO global admin">
      <strong>DEMO global admin</strong>
      <label className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span>View as</span>
        <select
          id="demo-view-as"
          className="select"
          value={me.user.id}
          disabled={!people}
          onChange={(e) => {
            setError(null);
            api.signIn(e.target.value).then(onSwitch, (err: Error) => setError(err.message));
          }}
        >
          {!people && <option value={me.user.id}>{me.user.name}</option>}
          {groups.map(([g, us]) => (
            <optgroup key={g} label={`${g} (${us.length})`}>
              {us.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}: {u.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <span className="small hide-sm">{people ? `${people.length} made-up people. You see exactly what the chosen person sees.` : 'Loading people…'}</span>
      <span className="grow" />
      {me.user.id !== START_AS && (
        <button className="btn btn-sm" onClick={() => api.signIn(START_AS).then(onSwitch, (err: Error) => setError(err.message))}>
          Back to CEO
        </button>
      )}
      <button className="btn btn-sm btn-ghost" onClick={endDemoAdmin}>
        Leave demo admin
      </button>
      {error && <span className="small" role="alert">{error}</span>}
    </div>
  );
}
