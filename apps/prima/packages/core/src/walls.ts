// Shared registry of department database walls (connect-departments, 2 Nov 2026).
//
// Each request carries the walls the person passes (app.walls); the database lets a row of a walled table through only
// on a wall the person holds. Before this file every department PR added its wall names to the DataWall list and to
// dataWalls() in access.ts, so the PRs collided on the same lines. Now a department registers its wall from its own
// module; dataWalls() appends every registered wall the person holds. The built-in walls in access.ts are unchanged.

import type { User } from './types';

export type WallHolds = (user: User) => boolean;

const WALLS = new Map<string, WallHolds>();
const NAME = /^[a-z][a-z0-9_]{1,39}$/;

/** Register a department wall. The same name with a different rule throws, so two PRs cannot override each other. */
export function registerWall(name: string, holds: WallHolds): void {
  if (!NAME.test(name)) throw new Error(`Wall name "${name}" must be lower case letters, digits or _`);
  const have = WALLS.get(name);
  if (have && have !== holds) throw new Error(`Wall "${name}" is already registered`);
  WALLS.set(name, holds);
}

/** The registered walls this person holds. A system feed holds none. */
export function registeredWallsOf(user: User): string[] {
  if (user.integration) return [];
  return [...WALLS.entries()].filter(([, holds]) => holds(user)).map(([name]) => name).sort();
}

export function registeredWallNames(): string[] {
  return [...WALLS.keys()].sort();
}
