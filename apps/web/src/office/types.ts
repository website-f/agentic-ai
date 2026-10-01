/** Office engine types. This folder never imports React: the app talks to it through
 * the bridge in engine.ts, and all panels and buttons stay in the DOM. */

export type AgentState = "working" | "waiting_approval" | "in_meeting" | "idle" | "error" | "paused";

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  color: string;
  department_id: string | null;
  status: string;
  state: AgentState;
  pending_approvals: number;
  task: { id: string; title: string; status: string } | null;
  last: { text: string; ts: string; kind: string } | null;
}

export interface OfficeSnapshot {
  branch: { id: string; name: string; slug: string; color: string };
  departments: { id: string; name: string; slug: string }[];
  agents: OfficeAgent[];
}

/** Live events the app forwards from /api/events (same shapes as the server sends). */
export type OfficeEvent =
  | { type: "agent.status"; data: { agent_id: string; status: string } }
  | { type: "agent.thinking"; data: { agent_id: string; on: boolean } }
  | { type: "task.event"; data: { actor: string; kind: string; text: string; tool?: string | null } }
  | { type: "broadcast.ack"; data: { agent_id: string } }
  | { type: "meeting.turn"; data: { agent_id?: string; content: string; kind: string } };

export const TILE = 16;

export enum Tile {
  Void = 0,
  Wall = 1,
  Wood = 2,
  Carpet = 3,
  Hall = 4,
  Lounge = 5,
  Study = 6,
}

export type Facing = "up" | "down" | "left" | "right";

export type FurnitureKind =
  | "desk"
  | "chair"
  | "plant"
  | "shelf"
  | "coffee"
  | "sofa"
  | "table"
  | "podium"
  | "bench"
  | "bug"
  | "board"
  | "rug"
  | "meeting";

export interface Furniture {
  kind: FurnitureKind;
  x: number; // tile coordinates
  y: number;
  w: number;
  h: number;
  blocks: boolean;
}

export interface Desk {
  agentId: string;
  /** Tile the agent sits on (the chair). */
  seat: { x: number; y: number };
  facing: Facing;
}

export type ZoneName = "breakroom" | "library" | "workshop" | "bug" | "podium" | "meeting";

export interface Room {
  id: string; // department id, or a zone name
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: Tile;
}

export interface OfficeMap {
  width: number;
  height: number;
  tiles: Tile[]; // row-major
  walkable: boolean[]; // row-major collision grid
  rooms: Room[];
  furniture: Furniture[];
  desks: Map<string, Desk>;
  /** Where agents stand in each shared place; several spots so they do not stack. */
  zones: Record<ZoneName, { x: number; y: number }[]>;
}
