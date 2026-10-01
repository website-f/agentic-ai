/** Build the office from the branch: one room per department (a desk per agent) around a
 * central corridor, plus the shared places agents walk to. Pure and deterministic, so the
 * same branch always gives the same office. */
import { Tile, type Desk, type Furniture, type OfficeMap, type OfficeSnapshot, type Room, type ZoneName } from "./types";

const IW = 10; // room interior width in tiles
const STEP = IW + 1; // rooms share their side walls
const CORRIDOR = 3;
const DESKS_PER_ROW = 3;
const NO_DEPT = "__hot";

interface RoomPlan {
  id: string;
  label: string;
  kind: "dept" | ZoneName;
  agentIds: string[];
}

export function buildOffice(snap: OfficeSnapshot): OfficeMap {
  const byDept = new Map<string, string[]>();
  for (const a of snap.agents) {
    const key = a.department_id && snap.departments.some((d) => d.id === a.department_id) ? a.department_id : NO_DEPT;
    byDept.set(key, [...(byDept.get(key) ?? []), a.id]);
  }
  const depts: RoomPlan[] = snap.departments.map((d) => ({ id: d.id, label: d.name, kind: "dept", agentIds: byDept.get(d.id) ?? [] }));
  if (byDept.has(NO_DEPT)) depts.push({ id: NO_DEPT, label: "Hot desks", kind: "dept", agentIds: byDept.get(NO_DEPT)! });
  if (!depts.length) depts.push({ id: NO_DEPT, label: "Hot desks", kind: "dept", agentIds: [] });

  // Department rooms fill two rows facing the corridor; shared rooms take the last columns.
  const half = Math.max(2, Math.ceil(depts.length / 2));
  const top: RoomPlan[] = [...depts.slice(0, half), { id: "library", label: "Library", kind: "library", agentIds: [] }, { id: "workshop", label: "Workshop", kind: "workshop", agentIds: [] }];
  const bottom: RoomPlan[] = [...depts.slice(half), { id: "breakroom", label: "Breakroom", kind: "breakroom", agentIds: [] }, { id: "meeting", label: "Meeting room", kind: "meeting", agentIds: [] }];
  // Keep the shared rooms in the same columns top and bottom.
  while (bottom.length < top.length) bottom.splice(bottom.length - 2, 0, { id: `__spare${bottom.length}`, label: "", kind: "dept", agentIds: [] });
  while (top.length < bottom.length) top.splice(top.length - 2, 0, { id: `__spare${top.length}`, label: "", kind: "dept", agentIds: [] });
  const cols = top.length;

  const deskRows = Math.max(2, ...depts.map((d) => Math.ceil(Math.max(1, d.agentIds.length) / DESKS_PER_ROW)));
  const IH = 1 + deskRows * 3; // decor row + (desk, chair, aisle) per desk row
  const H = IH + 2;
  const width = cols * STEP + 1;
  const height = H * 2 + CORRIDOR;

  const tiles: Tile[] = new Array(width * height).fill(Tile.Void);
  const at = (x: number, y: number) => y * width + x;
  const set = (x: number, y: number, t: Tile) => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[at(x, y)] = t;
  };
  const furniture: Furniture[] = [];
  const add = (kind: Furniture["kind"], x: number, y: number, w = 1, h = 1, blocks = true) => furniture.push({ kind, x, y, w, h, blocks });
  const desks = new Map<string, Desk>();
  const zones: Record<ZoneName, { x: number; y: number }[]> = { breakroom: [], library: [], workshop: [], bug: [], podium: [], meeting: [] };
  const rooms: Room[] = [];

  const floorFor = (k: RoomPlan["kind"]): Tile =>
    k === "dept" ? Tile.Wood : k === "library" ? Tile.Study : k === "breakroom" ? Tile.Lounge : k === "meeting" ? Tile.Carpet : Tile.Hall;

  const placeRoom = (plan: RoomPlan, col: number, rowTop: boolean) => {
    const rx = col * STEP;
    const ry = rowTop ? 0 : H + CORRIDOR;
    const floor = floorFor(plan.kind);
    for (let y = ry; y < ry + H; y++) {
      for (let x = rx; x <= rx + STEP; x++) {
        const edge = y === ry || y === ry + H - 1 || x === rx || x === rx + STEP;
        // Shared side walls: do not paint over a neighbour's floor.
        if (edge) {
          if (tiles[at(x, y)] === Tile.Void || tiles[at(x, y)] === Tile.Wall) set(x, y, Tile.Wall);
        } else set(x, y, floor);
      }
    }
    // Door into the corridor (2 tiles), unless it is an empty spare room.
    const doorY = rowTop ? ry + H - 1 : ry;
    if (plan.label) {
      set(rx + 5, doorY, floor);
      set(rx + 6, doorY, floor);
    }
    rooms.push({ id: plan.id, label: plan.label, x: rx, y: ry, w: STEP + 1, h: H, floor });
    const ix = rx + 1; // interior origin
    const iy = ry + 1;

    if (plan.kind === "dept" && plan.label) {
      add("plant", ix, iy);
      add("board", ix + 8, iy, 2, 1);
      plan.agentIds.forEach((agentId, i) => {
        const r = Math.floor(i / DESKS_PER_ROW);
        const c = i % DESKS_PER_ROW;
        const dx = ix + 1 + c * 3;
        const dy = iy + 1 + r * 3;
        add("desk", dx, dy, 2, 1);
        add("chair", dx, dy + 1, 2, 1, false);
        desks.set(agentId, { agentId, seat: { x: dx, y: dy + 1 }, facing: "up" });
      });
    } else if (plan.kind === "library") {
      for (let x = ix; x < ix + IW; x += 2) if (x !== ix + 4) add("shelf", x, iy, 2, 1);
      add("table", ix + 3, iy + 4, 4, 1);
      for (let x = ix; x < ix + IW; x += 2) if (x !== ix + 4) zones.library.push({ x, y: iy + 1 });
      zones.library.push({ x: ix + 3, y: iy + 5 }, { x: ix + 6, y: iy + 5 });
    } else if (plan.kind === "workshop") {
      add("bench", ix, iy, 4, 1);
      add("bug", ix + 7, iy + 1, 3, 2, false);
      for (let x = ix; x < ix + 4; x++) zones.workshop.push({ x, y: iy + 1 });
      zones.bug.push({ x: ix + 7, y: iy + 2 }, { x: ix + 8, y: iy + 2 }, { x: ix + 9, y: iy + 2 }, { x: ix + 8, y: iy + 3 });
      add("plant", ix + 9, iy + IH - 1);
    } else if (plan.kind === "breakroom") {
      add("coffee", ix, iy + 1);
      add("plant", ix + 9, iy);
      add("sofa", ix + 1, iy + IH - 1, 3, 1);
      add("table", ix + 6, iy + IH - 3, 2, 1);
      add("rug", ix + 5, iy + IH - 4, 4, 3, false);
      zones.breakroom.push(
        { x: ix + 1, y: iy + 1 }, { x: ix + 1, y: iy + 2 }, { x: ix + 1, y: iy + IH - 2 }, { x: ix + 2, y: iy + IH - 2 },
        { x: ix + 3, y: iy + IH - 2 }, { x: ix + 5, y: iy + IH - 3 }, { x: ix + 8, y: iy + IH - 3 }, { x: ix + 6, y: iy + IH - 2 },
        { x: ix + 7, y: iy + IH - 2 }, { x: ix + 4, y: iy + 3 },
      );
    } else if (plan.kind === "meeting") {
      add("meeting", ix + 2, iy + 2, 6, 2);
      for (let x = ix + 2; x < ix + 8; x++) zones.meeting.push({ x, y: iy + 1 }, { x, y: iy + 4 });
    }
  };

  top.forEach((p, i) => placeRoom(p, i, true));
  bottom.forEach((p, i) => placeRoom(p, i, false));

  // The corridor, with walls at both ends.
  for (let y = H; y < H + CORRIDOR; y++) {
    for (let x = 0; x < width; x++) set(x, y, x === 0 || x === width - 1 ? Tile.Wall : Tile.Hall);
  }
  // Approval podium in the hall, by the shared rooms; people queue to its left.
  const px = (cols - 2) * STEP + 2;
  const py = H + 1;
  add("podium", px, py);
  for (let k = 1; k <= 4; k++) zones.podium.push({ x: px - k, y: py });
  zones.podium.push({ x: px - 1, y: py - 1 }, { x: px - 1, y: py + 1 });
  add("plant", 1, H);
  add("plant", width - 2, H + CORRIDOR - 1);

  const walkable = tiles.map((t) => t !== Tile.Void && t !== Tile.Wall);
  for (const f of furniture) {
    if (!f.blocks) continue;
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) walkable[at(x, y)] = false;
  }
  return { width, height, tiles, walkable, rooms, furniture, desks, zones };
}

/** Rooms that a person would recognise (no spare filler rooms). */
export function namedRooms(map: OfficeMap): Room[] {
  return map.rooms.filter((r) => r.label);
}
