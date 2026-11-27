/**
 * P145b (owner, 27 Nov 2026: "when I click view/edit, open a FULL PAGE instead of the off-canvas drawer"): the address
 * of one member's own page inside Members and organization: `#members/member/<user_id>` (Prima's '#view/tab' address,
 * so a refresh or a shared link opens the same page). The org chart's person panel can open it the same way:
 * openMember(go, userId).
 */
import { hashOf, type Route } from '../../App';

const PREFIX = 'member/';

export const memberRoute = (userId: string): Route => ({ view: 'members', tab: `${PREFIX}${userId}` });

/** The member whose page the address names, or null for the tabs. */
export function memberIdOf(tab: string | undefined): string | null {
  if (!tab?.startsWith(PREFIX)) return null;
  const id = tab.slice(PREFIX.length).trim();
  return id && /^[\w-]{1,64}$/.test(id) ? id : null;
}

// The member page opened with its own history entry, so the phone's Back returns to the list.
let pushedFor: string | null = null;

/** Opens a member's page as a step the phone's or browser's Back undoes. */
export function openMember(go: (r: Route) => void, userId: string): void {
  const r = memberRoute(userId);
  try {
    history.pushState(null, '', hashOf(r));
    pushedFor = userId;
  } catch {
    pushedFor = null;
  }
  go(r);
}

/** Back to the list: undoes the page's own history step when it has one, else opens the list. */
export function backToMembers(go: (r: Route) => void, userId: string): void {
  if (pushedFor === userId) {
    pushedFor = null;
    history.back();
    return;
  }
  go({ view: 'members', tab: 'members' });
}

export function forgetPushed(): void {
  pushedFor = null;
}
