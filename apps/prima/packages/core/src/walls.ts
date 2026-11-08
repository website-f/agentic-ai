import type { User } from "./types";



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