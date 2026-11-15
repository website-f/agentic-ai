// A12 (Fitri package, Fauzan 11 Nov 2026): guard sign-ins in bulk, and location readings kept only for the set days.
// Pure helpers; the server scripts apply them with an administrator database login, never from the web.
import type { IsoDateTime, Person, User } from './types';

/** The guard sign-in Prima makes for an active guard or officer who has none: own view only, no grants. */
export function guardLoginFor(p: Pick<Person, 'id' | 'companyId' | 'name' | 'staffNo' | 'role' | 'status'>): User {
  return {
    id: `u-guard-${p.companyId}-${p.staffNo.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || p.id}`.slice(0, 120),
    name: p.name,
    title: `${p.role === 'supervisor' ? 'Officer' : 'Guard'} ${p.staffNo}, own view only`,
    role: p.role === 'supervisor' ? 'supervisor' : 'guard',
    companyIds: [p.companyId],
    siteIds: [],
    personId: p.id,
  };
}

/** Who of a company's people get a new sign-in: active guards and officers with no guard or officer sign-in yet. */
export function guardLoginsToCreate(people: Person[], users: User[]): { create: User[]; skipped: { personId: string; why: string }[] } {
  const create: User[] = [];
  const skipped: { personId: string; why: string }[] = [];
  const taken = new Set(users.map((u) => u.id));
  for (const p of people) {
    if (p.role === 'office') continue;
    if (p.role === 'patrol_officer') {
      skipped.push({ personId: p.id, why: 'patrol officers sign in with Microsoft' });
      continue;
    }
    if (p.status !== 'active') {
      skipped.push({ personId: p.id, why: `not active (${p.status})` });
      continue;
    }
    if (users.some((u) => u.personId === p.id && (u.role === 'guard' || u.role === 'supervisor') && !u.integration)) continue;
    const u = guardLoginFor(p);
    if (taken.has(u.id)) {
      skipped.push({ personId: p.id, why: `sign-in id ${u.id} already used: check the staff number` });
      continue;
    }
    taken.add(u.id);
    create.push(u);
  }
  return { create, skipped };
}

/** The cut-off: readings received before this are deleted. */
export function locationCutoff(nowMs: number, keepDays: number): IsoDateTime {
  if (!Number.isFinite(keepDays) || keepDays < 30) throw new Error('Keep location readings at least 30 days.');
  return new Date(nowMs - keepDays * 86_400_000).toISOString();
}
