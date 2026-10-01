/** Pixel art drawn in code: tiles, furniture and characters. Original work, no asset packs,
 * so nothing to license. Everything is drawn at 1 px per art pixel and scaled by the
 * renderer in whole steps, which keeps it crisp. A real art pack can replace this module. */
import { Tile, TILE, type Facing, type Furniture, type OfficeMap } from "./types";

export const CHAR_W = 16;
export const CHAR_H = 20;
/** Frame columns in a character sheet. */
export const FRAMES = ["stand", "walk1", "walk2", "sit", "type1", "type2"] as const;
export type Frame = (typeof FRAMES)[number];
export const DIRS: Facing[] = ["down", "up", "left", "right"];

const SKIN = ["#f3cfa8", "#e3b07c", "#c98b55", "#9a6239", "#6e4426"];
const HAIR = ["#2a1f19", "#4b3022", "#7b4a26", "#b88746", "#1b1d24", "#7a7a7a", "#9c3a27", "#2f3a5a"];
const PANTS = "#2f3644";
const SHOE = "#1d2129";

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Deterministic pseudo-random in [0,1) for texture noise. */
function noise(x: number, y: number, seed = 0): number {
  const h = hash(`${x},${y},${seed}`);
  return (h % 1000) / 1000;
}

// ---------------------------------------------------------------- floors and walls

const FLOOR: Record<number, [string, string]> = {
  [Tile.Wood]: ["#c99a68", "#b4865a"],
  [Tile.Carpet]: ["#4f7f7c", "#477370"],
  [Tile.Hall]: ["#ddd7cc", "#cbc4b6"],
  [Tile.Lounge]: ["#e6d2a8", "#d8c193"],
  [Tile.Study]: ["#6e5f88", "#63557c"],
};

function drawFloor(ctx: CanvasRenderingContext2D, t: Tile, px: number, py: number, tx: number, ty: number) {
  const [base, line] = FLOOR[t] ?? ["#ccc", "#bbb"];
  ctx.fillStyle = base;
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = line;
  if (t === Tile.Wood) {
    for (let r = 3; r < TILE; r += 4) ctx.fillRect(px, py + r, TILE, 1);
    for (let r = 0; r < 4; r++) {
      const jx = Math.floor(noise(tx, ty, r) * 14) + 1;
      ctx.fillRect(px + jx, py + r * 4, 1, 3);
    }
  } else if (t === Tile.Hall || t === Tile.Lounge) {
    ctx.fillRect(px, py + 15, TILE, 1);
    ctx.fillRect(px + 15, py, 1, TILE);
    if (t === Tile.Lounge && (tx + ty) % 2 === 0) {
      ctx.fillStyle = shade(base, -0.04);
      ctx.fillRect(px, py, 15, 15);
    }
  } else {
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(px + Math.floor(noise(tx, ty, i) * 15), py + Math.floor(noise(ty, tx, i + 9) * 15), 1, 1);
    }
  }
}

function drawWall(ctx: CanvasRenderingContext2D, px: number, py: number, front: boolean) {
  ctx.fillStyle = "#3d4556";
  ctx.fillRect(px, py, TILE, TILE);
  if (front) {
    ctx.fillStyle = "#6c768a";
    ctx.fillRect(px, py + 5, TILE, 11);
    ctx.fillStyle = "#7d879b";
    ctx.fillRect(px, py + 5, TILE, 2);
    ctx.fillStyle = "#555e70";
    ctx.fillRect(px, py + 14, TILE, 2);
  } else {
    ctx.fillStyle = "#454e60";
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
  }
}

// ---------------------------------------------------------------- furniture

const BOOKS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#e34948"];

function drawFurniture(ctx: CanvasRenderingContext2D, f: Furniture) {
  const x = f.x * TILE;
  const y = f.y * TILE;
  const w = f.w * TILE;
  const h = f.h * TILE;
  const box = (bx: number, by: number, bw: number, bh: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + bx, y + by, bw, bh);
  };
  switch (f.kind) {
    case "desk":
      box(1, 3, w - 2, 9, "#9a6b43");
      box(1, 3, w - 2, 1, "#b07f55");
      box(1, 12, w - 2, 2, "#6e4a2d");
      box(2, 14, 2, 2, "#5a3c25");
      box(w - 4, 14, 2, 2, "#5a3c25");
      box(10, -3, 12, 9, "#2a303b"); // monitor
      box(11, -2, 10, 6, "#3b6f8f");
      box(15, 6, 2, 2, "#2a303b");
      box(11, 9, 10, 2, "#d9dee4"); // keyboard
      box(25, 6, 3, 3, "#e8e2d6"); // mug
      break;
    case "chair":
      box(11, 6, 10, 7, "#384152");
      box(12, 7, 8, 5, "#465166");
      box(15, 13, 2, 2, "#2b3240");
      break;
    case "plant":
      box(5, 10, 6, 5, "#a65a32");
      box(5, 10, 6, 1, "#bf6c3e");
      box(4, 3, 4, 7, "#2f8a4a");
      box(8, 2, 4, 8, "#3aa55a");
      box(6, 0, 3, 4, "#4cbb6b");
      box(10, 5, 3, 4, "#2f8a4a");
      break;
    case "shelf":
      box(0, -6, w, h + 6, "#6e4a2d");
      for (const row of [-4, 2, 8]) {
        box(1, row, w - 2, 5, "#4a311d");
        for (let i = 0; i < 9; i++) {
          const c = BOOKS[(hash(`${f.x}${f.y}${row}${i}`) % BOOKS.length)]!;
          box(2 + i * 3, row + 1 + (i % 3 === 0 ? 1 : 0), 2, 4 - (i % 3 === 0 ? 1 : 0), c);
        }
      }
      break;
    case "coffee":
      box(3, -2, 10, 16, "#5b6372");
      box(4, -1, 8, 5, "#3b414d");
      box(10, 1, 1, 1, "#ef4444");
      box(6, 8, 4, 4, "#f1ece2");
      box(6, 8, 4, 1, "#6b3f22");
      break;
    case "sofa":
      box(0, 1, w, 6, "#b9554a");
      box(0, 7, w, 7, "#cf6a5c");
      box(0, 1, 3, 13, "#a64a40");
      box(w - 3, 1, 3, 13, "#a64a40");
      for (let i = 1; i < f.w; i++) box(i * TILE, 8, 1, 6, "#b9554a");
      break;
    case "table":
      box(1, 3, w - 2, 9, "#b07d52");
      box(1, 3, w - 2, 1, "#c4915f");
      box(1, 12, w - 2, 2, "#8a5e3a");
      break;
    case "rug":
      box(0, 0, w, h, "#d7c49c");
      box(2, 2, w - 4, h - 4, "#c9b384");
      box(4, 4, w - 8, h - 8, "#d7c49c");
      break;
    case "podium":
      box(3, 2, 10, 13, "#8b5a3c");
      box(2, 1, 12, 3, "#e0a84a");
      box(6, 6, 4, 6, "#7a4e33");
      break;
    case "bench":
      box(0, 2, w, 10, "#7b8794");
      box(0, 2, w, 2, "#95a1ad");
      box(0, 12, w, 2, "#5f6a76");
      box(6, 5, 8, 2, "#c0c7cf"); // wrench
      box(20, 4, 3, 5, "#eda100"); // drill
      box(36, 5, 10, 3, "#3b6f8f"); // laptop
      break;
    case "bug":
      box(0, 0, w, h, "#efc4bb");
      box(2, 2, w - 4, h - 4, "#e9b1a5");
      box(w / 2 - 4, h / 2 - 3, 8, 7, "#7a2e24"); // the bug
      box(w / 2 - 6, h / 2 - 2, 2, 1, "#7a2e24");
      box(w / 2 + 4, h / 2 - 2, 2, 1, "#7a2e24");
      box(w / 2 - 6, h / 2 + 2, 2, 1, "#7a2e24");
      box(w / 2 + 4, h / 2 + 2, 2, 1, "#7a2e24");
      break;
    case "board":
      box(1, -6, w - 2, 12, "#9aa3ae");
      box(2, -5, w - 4, 10, "#f7f8f9");
      box(4, -3, 14, 1, "#2a78d6");
      box(4, -1, 20, 1, "#9aa3ae");
      box(4, 1, 10, 1, "#eb6834");
      break;
    case "meeting":
      box(2, 2, w - 4, h - 4, "#8b5a3c");
      box(2, 2, w - 4, 2, "#a06b49");
      box(2, h - 4, w - 4, 2, "#6e4a2d");
      for (let i = 0; i < 5; i++) box(10 + i * 16, 10, 6, 4, "#e8e2d6");
      break;
  }
}

/** The static layer: floors, walls and furniture, drawn once per layout. */
export function renderMap(map: OfficeMap): HTMLCanvasElement {
  const [c, ctx] = canvas(map.width * TILE, map.height * TILE);
  const at = (x: number, y: number) => map.tiles[y * map.width + x];
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = at(tx, ty);
      const px = tx * TILE;
      const py = ty * TILE;
      if (t === Tile.Void || t === undefined) continue;
      if (t === Tile.Wall) {
        const below = ty + 1 < map.height ? at(tx, ty + 1) : Tile.Void;
        drawWall(ctx, px, py, below !== Tile.Wall && below !== Tile.Void);
      } else drawFloor(ctx, t, px, py, tx, ty);
    }
  }
  for (const f of [...map.furniture].sort((a, b) => (a.kind === "rug" || a.kind === "bug" ? -1 : 0) - (b.kind === "rug" || b.kind === "bug" ? -1 : 0) || a.y - b.y)) {
    drawFurniture(ctx, f);
  }
  return c;
}

// ---------------------------------------------------------------- characters

interface Look {
  shirt: string;
  skin: string;
  hair: string;
  long: boolean;
}

function look(id: string, color: string): Look {
  const h = hash(id);
  return { shirt: color, skin: SKIN[h % SKIN.length]!, hair: HAIR[(h >> 4) % HAIR.length]!, long: ((h >> 9) & 3) === 0 };
}

function drawCharacter(ctx: CanvasRenderingContext2D, ox: number, oy: number, l: Look, dir: Facing, frame: Frame) {
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox + x, oy + y, w, h);
  };
  const shirt = l.shirt;
  const dark = shade(shirt, -0.28);
  const sitting = frame === "sit" || frame === "type1" || frame === "type2";
  const dy = sitting ? 2 : 0;
  const side = dir === "left" || dir === "right";

  // legs (hidden by the chair when sitting)
  if (!sitting) {
    const step = frame === "walk1" ? 1 : frame === "walk2" ? -1 : 0;
    if (side) {
      px(6, 14, 4, 4, PANTS);
      px(6 + step, 18, 3, 2, SHOE);
      px(8 - step, 18, 3, 2, SHOE);
    } else {
      px(5, 14, 3, 4 - Math.max(0, step), PANTS);
      px(8, 14, 3, 4 - Math.max(0, -step), PANTS);
      px(5, 18 - Math.max(0, step), 3, 2, SHOE);
      px(8, 18 - Math.max(0, -step), 3, 2, SHOE);
    }
  }
  // body
  if (side) {
    px(5, 8 + dy, 6, 7, shirt);
    px(5, 8 + dy, 6, 1, shade(shirt, 0.15));
    const arm = frame === "walk1" ? 1 : frame === "walk2" ? -1 : 0;
    px(dir === "left" ? 6 : 8, 9 + dy + arm, 2, 5, dark);
    px(dir === "left" ? 6 : 8, 14 + dy + arm, 2, 1, l.skin);
  } else {
    px(4, 8 + dy, 8, 7, shirt);
    px(4, 8 + dy, 8, 1, shade(shirt, 0.15));
    if (frame === "type1" || frame === "type2") {
      // arms forward to the keyboard, hands alternating
      px(3, 9 + dy, 2, 3, dark);
      px(11, 9 + dy, 2, 3, dark);
      px(3, frame === "type1" ? 7 + dy : 8 + dy, 2, 2, l.skin);
      px(11, frame === "type1" ? 8 + dy : 7 + dy, 2, 2, l.skin);
    } else {
      const swing = frame === "walk1" ? 1 : frame === "walk2" ? -1 : 0;
      px(3, 9 + dy + swing, 1, 5, dark);
      px(12, 9 + dy - swing, 1, 5, dark);
      px(3, 14 + dy + swing, 1, 1, l.skin);
      px(12, 14 + dy - swing, 1, 1, l.skin);
    }
  }
  // head
  const hy = dy;
  if (side) {
    px(5, 1 + hy, 6, 7, l.skin);
    px(dir === "left" ? 5 : 8, 0 + hy, 3, 1, l.hair);
    px(4, 0 + hy, 8, 3, l.hair);
    px(dir === "left" ? 9 : 4, 2 + hy, 3, l.long ? 6 : 3, l.hair);
    px(dir === "left" ? 6 : 9, 4 + hy, 1, 1, "#1d2129");
  } else {
    px(4, 1 + hy, 8, 7, l.skin);
    px(4, 0 + hy, 8, 3, l.hair);
    px(3, 1 + hy, 1, l.long ? 7 : 3, l.hair);
    px(12, 1 + hy, 1, l.long ? 7 : 3, l.hair);
    if (dir === "up") {
      px(4, 0 + hy, 8, l.long ? 8 : 6, l.hair);
    } else {
      px(6, 4 + hy, 1, 1, "#1d2129");
      px(9, 4 + hy, 1, 1, "#1d2129");
      px(7, 6 + hy, 2, 1, shade(l.skin, -0.2));
    }
  }
}

/** One sheet per agent: rows = directions, columns = frames. */
export function characterSheet(id: string, color: string): HTMLCanvasElement {
  const [c, ctx] = canvas(CHAR_W * FRAMES.length, CHAR_H * DIRS.length);
  const l = look(id, color);
  DIRS.forEach((dir, r) => {
    FRAMES.forEach((frame, col) => drawCharacter(ctx, col * CHAR_W, r * CHAR_H, l, dir, frame));
  });
  return c;
}
