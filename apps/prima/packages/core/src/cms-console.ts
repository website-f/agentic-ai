// E7 (P100, Fauzan 11 Nov 2026: "CMS operator Microsoft sign-in: BUILD"). Who may open the CMS console from Prima, and
// under which name. Prima decides, never the CMS and never the browser: an active person on the CMS roster (Arms Control
// keeps it) whose own Prima account is linked to the roster entry, or Arms Control itself (canRunCms). The name is the
// roster name, so the CMS desk handover (which matches on the roster) knows the operator. The API signs the ticket
// (apps/api/src/cms-signin.controller.ts); the CMS checks it (apps/cms/src/signin.ts).
import { AccessDenied, canRunCms } from './access';
import type { CmsStaff, User } from './types';

export interface CmsConsolePerson {
  sub: string;
  name: string;
  posts: string[];
  /** Roster staff, or Arms Control opening the console to supervise. */
  as: 'roster' | 'arms_control';
}

export function cmsConsolePerson(user: User, staff: CmsStaff[]): CmsConsolePerson {
  if (user.integration || user.role === 'guard' || user.role === 'site_device') throw new AccessDenied('view', '(CMS operators on the roster and Arms Control)');
  const mine = staff.find((s) => s.active && s.userId === user.id);
  if (mine) return { sub: user.id, name: mine.name, posts: [...mine.posts], as: 'roster' };
  if (canRunCms(user)) return { sub: user.id, name: user.name, posts: [], as: 'arms_control' };
  throw new AccessDenied('view', '(CMS operators on the roster with their own Prima account, and Arms Control)');
}
