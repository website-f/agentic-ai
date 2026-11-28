/**
 * P145b (owner, 27 Nov 2026: "when I click view/edit, open a FULL PAGE instead of the off-canvas drawer"): the address
 * of one member's own page inside Members and organization: `#members/member/<user_id>` (Prima's '#view/tab' address,
 * so a refresh or a shared link opens the same page). The org chart's person panel can open it the same way:
 * openMember(go, userId).
 *
 * P146 (owner, 28 Nov 2026: "When in the org chart I click to see any member, going back doesn't return to the org
 * chart"): a member's page opened from another screen remembers that screen (sessionStorage "prima.member.return");
 * its Back button, the browser's and the phone's Back return there. From the org chart the canvas comes back as it was
 * (org-memory.ts).
 */
import { hashOf, splitHash, type Route, type ViewName } from '../../App';
import { canvas, markChartReturn } from '../org-memory';

const PREFIX = 'member/';
const RETURN = 'prima.member.return';

export const memberRoute = (userId: string): Route => ({ view: 'members', tab: `${PREFIX}${userId}` });

/** The member whose page the address names, or null for the tabs. */
export function memberIdOf(tab: string | undefined): string | null {
  if (!tab?.startsWith(PREFIX)) return null;
  const id = tab.slice(PREFIX.length).trim();
  return id && /^[\w-]{1,64}$/.test(id) ? id : null;
}

/** Where a member's page goes back to: the screen it was opened from. */
export interface MemberReturn {
  route: Route;
  /** The button's words ("Back to the org chart"). */
  label: string;
}

function readReturn(): MemberReturn | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(RETURN) ?? 'null') as MemberReturn | null;
    return r && typeof r.route?.view === 'string' && r.route.view !== 'members' ? r : null;
  } catch {
    return null;
  }
}

function writeReturn(r: MemberReturn | null): void {
  try {
    if (r) sessionStorage.setItem(RETURN, JSON.stringify(r));
    else sessionStorage.removeItem(RETURN);
  } catch {
    /* blocked storage: Back goes to the members list */
  }
}

/** The screen a member's page was opened from, when not the members list. */
export function memberReturn(): MemberReturn | null {
  return readReturn();
}

export function forgetReturn(): void {
  writeReturn(null);
}

/** Whether this address is the screen the member's page returns to. */
export function isReturnAddress(hash: string): boolean {
  const r = readReturn();
  if (!r) return false;
  const at = splitHash(hash);
  return at.view === r.route.view && (at.tab ?? '') === (r.route.tab ?? '');
}

// The member page opened with its own history entry, so the phone's Back returns to the list.
let pushedFor: string | null = null;

/** Opens a member's page as a step the phone's or browser's Back undoes. */
export function openMember(go: (r: Route) => void, userId: string): void {
  const r = memberRoute(userId);
  const at = splitHash(location.hash);
  let back: MemberReturn | null = null;
  if (at.view === 'orgchart') {
    // The chart comes back as it was (its canvas, or its details tab).
    if (canvas.shown) markChartReturn();
    back = { route: { view: 'orgchart', tab: canvas.shown ? 'chart' : 'details' }, label: 'Back to the org chart' };
  } else if (at.view && at.view !== 'members') back = { route: { view: at.view as ViewName, ...(at.tab ? { tab: at.tab } : {}) }, label: 'Back' };
  if (back) writeReturn(back);
  else if (!memberIdOf(at.tab)) writeReturn(null);
  // (From one member's page to another's: the first one's way back stays.)
  let before = location.hash;
  try {
    if (back) {
      // The address Back returns to names the exact screen and tab.
      before = hashOf(back.route);
      history.replaceState(history.state, '', before);
    }
  } catch {
    /* a frame without history */
  }
  const len = history.length;
  go(r);
  try {
    // go() adds a step only when the screen is in another app; otherwise it replaced this address: put it back and
    // add the member's page as its own step (one Back returns, never two).
    if (history.length === len) {
      history.replaceState(history.state, '', before || '#');
      history.pushState(null, '', hashOf(r));
    }
    pushedFor = userId;
  } catch {
    pushedFor = null;
  }
}

/** Back from a member's page: undoes its own history step when it has one, else opens where it came from (or the list). */
export function backToMembers(go: (r: Route) => void, userId: string): void {
  if (pushedFor === userId) {
    pushedFor = null;
    history.back();
    return;
  }
  const ret = readReturn();
  writeReturn(null);
  go(ret?.route ?? { view: 'members', tab: 'members' });
}

export function forgetPushed(): void {
  pushedFor = null;
}
