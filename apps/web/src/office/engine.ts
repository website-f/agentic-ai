/** The office engine: a Canvas 2D renderer, a camera, and one small state machine per
 * agent. It is a view onto real state: agents move only because an event or snapshot from
 * the API says their state changed. The app talks to it through `createOffice`.
 *
 * The camera is the shared infinite-canvas viewport (lib/viewport, framework-free): drag or
 * one finger pans with momentum, wheel / pinch zooms at the pointer, double tap zooms in,
 * Space + drag and the middle button pan, + / - / 0 / Shift+1 / arrows work when hovered.
 * Pixel art stays crisp: smoothing is off and zoom settles on whole device pixels. */
import { clamp, createViewport, toScreen, toWorld, type Camera } from "../lib/viewport";
import { CHAR_H, CHAR_W, characterSheet, DIRS, FRAMES, hash, renderMap, type Frame } from "./art";
import { buildOffice, namedRooms } from "./layout";
import { findPath } from "./path";
import { TILE, type AgentState, type Facing, type OfficeEvent, type OfficeMap, type OfficeSnapshot, type ZoneName } from "./types";

export interface OfficeHandlers {
  onAgentTap?: (agentId: string) => void;
  onTaskDrop?: (taskId: string, agentId: string) => void;
  /** Following an agent stopped (the person panned or zoomed). */
  onFollowChange?: (agentId: string | null) => void;
}

export interface Office {
  setData(snap: OfficeSnapshot): void;
  apply(ev: OfficeEvent): void;
  focus(agentId: string): void;
  /** Keep the camera on an agent as it walks; null stops. */
  follow(agentId: string | null): void;
  zoom(step: 1 | -1): void;
  /** The whole office on screen. */
  fit(): void;
  setTheme(dark: boolean): void;
  select(agentId: string | null): void;
  /** Where an agent is on screen, in CSS px relative to the canvas (for overlays and tests). */
  agentPosition(agentId: string): { x: number; y: number } | null;
  destroy(): void;
}

const SPEED = 4.5 * TILE; // px per second
const BUBBLE_MS = 4000;
const BUBBLE_GAP_MS = 3000;
const ERRAND_MS = 6000;
const LIBRARY_TOOLS = new Set(["recall", "read_page", "write_page", "remember", "use_skill"]);
const WORKSHOP_TOOLS = new Set(["propose_skill", "memory"]);
const MAX_CSS_ZOOM = 6; // CSS px per art px

type Icon = "think" | "alert" | "zz" | "error" | "bang" | "tick";

interface Walker {
  id: string;
  name: string;
  color: string;
  sheet: HTMLCanvasElement;
  x: number; // world px (tile top-left of where the feet are)
  y: number;
  path: { x: number; y: number }[];
  target: { x: number; y: number; sit: boolean; facing: Facing } | null;
  facing: Facing;
  moving: boolean;
  sitting: boolean;
  state: AgentState;
  thinking: boolean;
  thinkingUntil: number;
  errand: { zone: ZoneName; until: number } | null;
  bubble: { text: string; until: number } | null;
  lastBubble: number;
  flash: { icon: Icon; until: number } | null;
  idleSince: number;
  spotKey: string | null;
}

function short(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
}

export function createOffice(canvas: HTMLCanvasElement, handlers: OfficeHandlers = {}): Office {
  const ctx = canvas.getContext("2d")!;
  let map: OfficeMap | null = null;
  let mapCanvas: HTMLCanvasElement | null = null;
  let signature = "";
  let dark = false;
  const walkers = new Map<string, Walker>();
  const spots = new Map<string, string>(); // "zone:i" -> agent id
  let selected: string | null = null;
  let dropHover: string | null = null;
  let hovered: string | null = null;

  // Camera in CSS px (screen = world * k + offset, the shared viewport's convention).
  // Drawing happens in device px: scale = k * dpr, snapped to whole pixels when at rest.
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  let cam: Camera = { x: 0, y: 0, k: 1 };
  let following: string | null = null;
  let dirty = true;
  let raf = 0;
  let last = performance.now();
  let lastSlowDraw = 0;
  let destroyed = false;

  // ---------------------------------------------------------------- sizing and camera

  const cssW = () => canvas.width / dpr();
  const cssH = () => canvas.height / dpr();
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr()));
    const h = Math.max(1, Math.round(r.height * dpr()));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      dirty = true;
    }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  // Moving the window to a screen with another pixel ratio (or browser zoom) re-sizes too.
  let mq: MediaQueryList | null = null;
  const onDpr = () => {
    resize();
    watchDpr();
  };
  const watchDpr = () => {
    mq?.removeEventListener("change", onDpr);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener("change", onDpr);
  };
  watchDpr();

  const worldW = () => (map ? map.width * TILE : 1);
  const worldH = () => (map ? map.height * TILE : 1);
  const fitK = () => Math.min(cssW() / worldW(), cssH() / worldH());
  /** Whole device pixels per art pixel when that is at least 1: crisp, even pixels. */
  const crisp = (k: number) => {
    const d = dpr();
    return k * d >= 1 ? Math.max(1, Math.round(k * d)) / d : k;
  };
  const centreOf = (w: Walker) => ({ x: w.x + (w.sitting ? TILE : TILE / 2), y: w.y + TILE - CHAR_H / 2 });

  const vp = createViewport(canvas, {
    initial: cam,
    limits: () => ({ min: Math.min(fitK() * 0.8, 1), max: MAX_CSS_ZOOM }),
    onChange: (c) => {
      cam = c;
      dirty = true;
    },
    // Some of the office always stays on screen, however far it is flung.
    clamp: (c, size) => {
      const ww = worldW() * c.k;
      const wh = worldH() * c.k;
      const mx = Math.min(120, ww / 2, size.w / 2);
      const my = Math.min(120, wh / 2, size.h / 2);
      return { k: c.k, x: clamp(c.x, mx - ww, size.w - mx), y: clamp(c.y, my - wh, size.h - my) };
    },
    snapZoom: crisp,
    contentBounds: () => (map ? { x: 0, y: 0, w: worldW(), h: worldH() } : null),
    fitOptions: { pad: 12 },
    onTap: ({ client, pointerType }) => {
      const hit = agentAt(client.x, client.y, pointerType === "touch" ? 7 : 4);
      if (hit) {
        selected = hit;
        dirty = true;
        handlers.onAgentTap?.(hit);
      }
    },
    onUserGesture: () => {
      if (following) {
        following = null;
        handlers.onFollowChange?.(null);
      }
    },
  });

  function fit(animate = 0) {
    resize();
    const k = Math.min(MAX_CSS_ZOOM, crisp(fitK() * 0.98));
    vp.set({ k, x: (cssW() - worldW() * k) / 2, y: (cssH() - worldH() * k) / 2 }, { animate });
  }

  /** The first view: the whole office, but never so small that people cannot be told apart
   * (on a phone it starts at a readable size and people pan). */
  function home() {
    resize();
    const d = dpr();
    const k = Math.max(Math.round(d), Math.min(8, Math.max(1, Math.floor(fitK() * d)))) / d;
    vp.set({ k, x: (cssW() - worldW() * k) / 2, y: (cssH() - worldH() * k) / 2 });
  }

  /** Buttons step through whole-pixel zoom levels (halving below 1:1). */
  function zoomStep(step: 1 | -1) {
    const d = dpr();
    const kd = cam.k * d;
    let next: number;
    if (step > 0) next = kd >= 1 ? Math.floor(kd + 1e-6) + 1 : Math.min(1, kd * 2);
    else next = kd > 1 + 1e-6 ? Math.ceil(kd - 1e-6) - 1 : kd / 2;
    vp.zoomTo(next / d, undefined, 180);
  }

  function focus(agentId: string) {
    const w = walkers.get(agentId);
    if (!w) return;
    const d = dpr();
    vp.centerOn(centreOf(w), { k: Math.max(cam.k, (2 * Math.round(d)) / d), animate: 320 });
    selected = agentId;
    dirty = true;
  }

  /** One frame of following: glide towards the agent (and a readable zoom). */
  function followStep(dt: number) {
    if (!following) return;
    const w = walkers.get(following);
    if (!w) return;
    const d = dpr();
    const kT = Math.max(cam.k, (2 * Math.round(d)) / d);
    const p = centreOf(w);
    const a = Math.min(1, dt * 7);
    const k = Math.abs(kT - cam.k) < 1e-3 ? kT : cam.k + (kT - cam.k) * a;
    const tx = cssW() / 2 - p.x * k;
    const ty = cssH() / 2 - p.y * k;
    if (Math.abs(tx - cam.x) < 0.3 && Math.abs(ty - cam.y) < 0.3 && k === cam.k) return;
    vp.set({ k, x: cam.x + (tx - cam.x) * a, y: cam.y + (ty - cam.y) * a });
  }

  // ---------------------------------------------------------------- state -> place

  function spotFor(w: Walker, zone: ZoneName): { x: number; y: number } {
    const list = map!.zones[zone];
    if (w.spotKey?.startsWith(`${zone}:`)) {
      const i = Number(w.spotKey.split(":")[1]);
      if (list[i]) return list[i]!;
    }
    if (w.spotKey) spots.delete(w.spotKey);
    // Meeting seats fill in order (they alternate sides of the table); elsewhere, spread out.
    const start = zone === "meeting" ? 0 : hash(w.id) % list.length;
    for (let k = 0; k < list.length; k++) {
      const i = (start + k) % list.length;
      if (!spots.has(`${zone}:${i}`)) {
        spots.set(`${zone}:${i}`, w.id);
        w.spotKey = `${zone}:${i}`;
        return list[i]!;
      }
    }
    w.spotKey = null; // full: share a spot
    return list[start]!;
  }

  function releaseSpot(w: Walker) {
    if (w.spotKey) spots.delete(w.spotKey);
    w.spotKey = null;
  }

  function desiredTarget(w: Walker, now: number): Walker["target"] {
    if (!map) return null;
    if (w.errand && now < w.errand.until) {
      const s = spotFor(w, w.errand.zone);
      return { ...s, sit: false, facing: "up" };
    }
    w.errand = null;
    const desk = map.desks.get(w.id);
    const zone: ZoneName | null =
      w.state === "waiting_approval" ? "podium" : w.state === "in_meeting" ? "meeting" : w.state === "error" ? "bug" : w.state === "idle" ? "breakroom" : null;
    if (zone) {
      const s = spotFor(w, zone);
      // Meeting spots alternate above and below the table: face it.
      const across = zone === "meeting" && Number(w.spotKey?.split(":")[1] ?? 0) % 2 === 1 ? "up" : "down";
      return { ...s, sit: false, facing: zone === "podium" ? "right" : zone === "bug" ? "up" : zone === "meeting" ? across : "down" };
    }
    releaseSpot(w);
    if (desk) return { ...desk.seat, sit: true, facing: desk.facing };
    const s = spotFor(w, "breakroom");
    return { ...s, sit: false, facing: "down" };
  }

  function retarget(w: Walker, now: number, instant = false) {
    const t = desiredTarget(w, now);
    if (!t || !map) return;
    const same = w.target && w.target.x === t.x && w.target.y === t.y;
    w.target = t;
    if (instant) {
      w.x = t.x * TILE;
      w.y = t.y * TILE;
      w.path = [];
      w.moving = false;
      w.sitting = t.sit;
      w.facing = t.facing;
      return;
    }
    if (same && !w.moving) {
      w.sitting = t.sit;
      w.facing = t.facing;
      return;
    }
    const from = { x: Math.round(w.x / TILE), y: Math.round(w.y / TILE) };
    const path = findPath(map.width, map.height, map.walkable, from, t);
    if (path === null) {
      // Lost (e.g. the layout changed under it): appear at the destination.
      retarget(w, now, true);
      return;
    }
    w.path = path;
    w.sitting = false;
    w.moving = path.length > 0;
    if (!w.moving) {
      w.sitting = t.sit;
      w.facing = t.facing;
    }
    dirty = true;
  }

  // ---------------------------------------------------------------- data in

  function setData(snap: OfficeSnapshot) {
    const sig = JSON.stringify([snap.departments.map((d) => d.id), snap.agents.map((a) => [a.id, a.department_id])]);
    const now = performance.now();
    const rebuilt = sig !== signature;
    if (rebuilt) {
      signature = sig;
      map = buildOffice(snap);
      mapCanvas = renderMap(map);
      spots.clear();
      for (const w of walkers.values()) w.spotKey = null;
    }
    const seen = new Set<string>();
    for (const a of snap.agents) {
      seen.add(a.id);
      let w = walkers.get(a.id);
      const fresh = !w;
      if (!w) {
        w = {
          id: a.id, name: a.name, color: a.color, sheet: characterSheet(a.id, a.color), x: 0, y: 0, path: [],
          target: null, facing: "down", moving: false, sitting: false, state: a.state, thinking: false, thinkingUntil: 0,
          errand: null, bubble: null, lastBubble: 0, flash: null, idleSince: now, spotKey: null,
        };
        walkers.set(a.id, w);
      }
      if (w.color !== a.color) w.sheet = characterSheet(a.id, a.color);
      w.name = a.name;
      w.color = a.color;
      const changed = w.state !== a.state;
      w.state = a.state;
      if (fresh || rebuilt) retarget(w, now, fresh);
      else if (changed) retarget(w, now);
    }
    for (const id of [...walkers.keys()]) {
      if (!seen.has(id)) {
        releaseSpot(walkers.get(id)!);
        walkers.delete(id);
      }
    }
    if (rebuilt) home();
    dirty = true;
  }

  function say(w: Walker, text: string, now: number) {
    if (!text || now - w.lastBubble < BUBBLE_GAP_MS) return;
    w.bubble = { text: short(text), until: now + BUBBLE_MS };
    w.lastBubble = now;
  }

  function apply(ev: OfficeEvent) {
    const now = performance.now();
    if (ev.type === "agent.status") {
      const w = walkers.get(ev.data.agent_id);
      if (!w) return;
      const s = ev.data.status;
      if (s === "broadcast_received") w.flash = { icon: "bang", until: now + 4000 };
      else if (s === "working" || s === "waiting_approval" || s === "in_meeting" || s === "idle" || s === "error" || s === "paused") {
        if (w.state !== s) {
          w.state = s;
          if (s === "working") w.errand = null;
          retarget(w, now);
        }
      }
    } else if (ev.type === "agent.thinking") {
      const w = walkers.get(ev.data.agent_id);
      if (!w) return;
      w.thinking = ev.data.on;
      w.thinkingUntil = now + 60_000; // safety: never stuck thinking
    } else if (ev.type === "task.event") {
      const id = ev.data.actor.startsWith("agent:") ? ev.data.actor.slice(6) : "";
      const w = walkers.get(id);
      if (!w) return;
      const tool = ev.data.tool ?? "";
      const zone: ZoneName | null =
        ev.data.kind === "memory" || LIBRARY_TOOLS.has(tool) ? "library" : ev.data.kind === "skill" || WORKSHOP_TOOLS.has(tool) ? "workshop" : null;
      if (zone && w.state !== "paused") {
        w.errand = { zone, until: now + ERRAND_MS };
        retarget(w, now);
      }
      if (ev.data.kind === "progress" || ev.data.kind === "tool" || ev.data.kind === "memory" || ev.data.kind === "skill") {
        // Timeline texts read "used Search memory": capitalise for the bubble.
        say(w, ev.data.text.charAt(0).toUpperCase() + ev.data.text.slice(1), now);
      }
    } else if (ev.type === "meeting.turn") {
      const w = ev.data.agent_id ? walkers.get(ev.data.agent_id) : undefined;
      if (w && ev.data.kind === "turn" && ev.data.content !== "(nothing to add)") {
        w.lastBubble = 0; // in a meeting every turn shows
        say(w, ev.data.content, now);
      }
    } else if (ev.type === "broadcast.ack") {
      const w = walkers.get(ev.data.agent_id);
      if (w) w.flash = { icon: "tick", until: now + 3000 };
    }
    dirty = true;
  }

  // ---------------------------------------------------------------- update

  function update(dt: number, now: number): boolean {
    let animating = false;
    for (const w of walkers.values()) {
      if (w.thinking && now > w.thinkingUntil) w.thinking = false;
      if (w.bubble && now > w.bubble.until) {
        w.bubble = null;
        dirty = true;
      }
      if (w.flash && now > w.flash.until) {
        w.flash = null;
        dirty = true;
      }
      if (w.errand && now >= w.errand.until && !w.moving) retarget(w, now);
      // Idle agents drift to another free spot in the breakroom now and then.
      if (w.state === "idle" && !w.moving && !w.errand && now - w.idleSince > 20000 + (hash(w.id) % 15000)) {
        w.idleSince = now;
        releaseSpot(w);
        const list = map?.zones.breakroom ?? [];
        const i = Math.floor(Math.random() * list.length);
        if (list[i] && !spots.has(`breakroom:${i}`)) {
          spots.set(`breakroom:${i}`, w.id);
          w.spotKey = `breakroom:${i}`;
        }
        retarget(w, now);
      }
      if (!w.moving) continue;
      animating = true;
      let budget = SPEED * dt;
      while (budget > 0 && w.path.length) {
        const next = w.path[0]!;
        const tx = next.x * TILE;
        const ty = next.y * TILE;
        const dx = tx - w.x;
        const dy = ty - w.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dx !== 0 || dy !== 0) w.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (dist <= budget) {
          w.x = tx;
          w.y = ty;
          budget -= dist;
          w.path.shift();
        } else {
          w.x += Math.sign(dx) * Math.min(Math.abs(dx), budget);
          w.y += Math.sign(dy) * Math.min(Math.abs(dy), dx === 0 ? budget : 0);
          budget = 0;
        }
      }
      if (!w.path.length) {
        w.moving = false;
        if (w.target) {
          w.sitting = w.target.sit;
          w.facing = w.target.facing;
        }
        w.idleSince = now;
      }
    }
    return animating;
  }

  // ---------------------------------------------------------------- draw

  function frameFor(w: Walker, now: number): { frame: Frame; dir: Facing } {
    if (w.moving) {
      const step = Math.floor(now / 140) % 4;
      return { frame: step === 1 ? "walk1" : step === 3 ? "walk2" : "stand", dir: w.facing };
    }
    if (w.sitting) {
      const typing = w.state === "working" && !w.thinking;
      const rate = 220;
      return { frame: typing ? (Math.floor(now / rate) % 2 ? "type1" : "type2") : "sit", dir: "up" };
    }
    return { frame: "stand", dir: w.facing };
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(now: number) {
    const W = canvas.width;
    const H = canvas.height;
    const d = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = dark ? "#0b0f0d" : "#e9eeeb";
    ctx.fillRect(0, 0, W, H);
    if (!map || !mapCanvas) return;
    // Device px per art px, and the offset rounded to whole device px: no half-pixel blur.
    const scale = cam.k * d;
    const ox = Math.round(cam.x * d);
    const oy = Math.round(cam.y * d);
    const sx = (wx: number) => Math.round(wx * scale + ox);
    const sy = (wy: number) => Math.round(wy * scale + oy);
    ctx.drawImage(mapCanvas, ox, oy, Math.round(mapCanvas.width * scale), Math.round(mapCanvas.height * scale));

    const sorted = [...walkers.values()].sort((a, b) => a.y - b.y);
    // Selection and drop rings under the feet.
    for (const w of sorted) {
      if (w.id !== selected && w.id !== dropHover && w.id !== following) continue;
      ctx.fillStyle = w.id === dropHover ? "rgba(53,196,140,0.55)" : "rgba(42,120,214,0.45)";
      ctx.beginPath();
      ctx.ellipse(sx(w.x + (w.sitting ? TILE : TILE / 2)), sy(w.y + TILE - 1), 8 * scale, 3 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const w of sorted) {
      const { frame, dir } = frameFor(w, now);
      const col = FRAMES.indexOf(frame);
      const row = DIRS.indexOf(dir);
      const ox = w.sitting ? TILE / 2 : 0; // seats sit under the middle of a 2-tile desk
      const x = sx(w.x + ox);
      const y = sy(w.y + TILE - CHAR_H);
      if (w.state === "paused") ctx.globalAlpha = 0.45;
      ctx.drawImage(w.sheet, col * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H, x, y, Math.round(CHAR_W * scale), Math.round(CHAR_H * scale));
      ctx.globalAlpha = 1;
    }
    if (dark) {
      ctx.fillStyle = "rgba(6,12,28,0.42)";
      ctx.fillRect(0, 0, W, H);
      // Monitors of people at work glow at night.
      ctx.fillStyle = "rgba(120,210,255,0.85)";
      for (const w of walkers.values()) {
        const desk = map.desks.get(w.id);
        if (!desk || w.state !== "working") continue;
        ctx.fillRect(sx(desk.seat.x * TILE + 11), sy((desk.seat.y - 1) * TILE - 2), 10 * scale, 6 * scale);
      }
    }

    // Screen-space text: crisp at every zoom.
    const fs = Math.round(11 * d);
    ctx.font = `600 ${fs}px "Geist Variable", system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const narrow = canvas.width / d < 640; // a phone: only part of the office is on screen
    // Labels need room: zoomed far out (the whole office on a phone) they would pile up.
    if (cam.k >= 0.99 || (narrow && cam.k >= 0.6)) {
      for (const r of namedRooms(map)) {
        const label = r.label;
        const tw = ctx.measureText(label).width + 12 * d;
        const cx = sx(r.x * TILE + (r.w * TILE) / 2);
        const cy = sy(r.y * TILE + 8);
        ctx.fillStyle = dark ? "rgba(20,27,24,0.9)" : "rgba(255,255,255,0.92)";
        roundRect(cx - tw / 2, cy - 9 * d, tw, 18 * d, 9 * d);
        ctx.fill();
        ctx.fillStyle = dark ? "#e6ece9" : "#121a17";
        ctx.fillText(label, cx, cy + 0.5);
      }
    }
    const pulse = 0.6 + 0.4 * Math.sin(now / 250);
    for (const w of sorted) {
      const cx = sx(w.x + (w.sitting ? TILE : TILE / 2));
      const top = sy(w.y + TILE - CHAR_H) - 6 * d;
      // name tag
      if (cam.k >= 1.99 || (narrow && cam.k >= 0.95) || w.id === selected || w.id === hovered || w.id === following) {
        ctx.font = `600 ${Math.round(10 * d)}px "Geist Variable", system-ui, sans-serif`;
        const tw = ctx.measureText(w.name).width + 10 * d;
        const ny = sy(w.y + TILE) + 9 * d;
        ctx.fillStyle = dark ? "rgba(20,27,24,0.85)" : "rgba(255,255,255,0.9)";
        roundRect(cx - tw / 2, ny - 8 * d, tw, 16 * d, 8 * d);
        ctx.fill();
        ctx.fillStyle = w.color;
        ctx.fillRect(cx - tw / 2 + 5 * d, ny - 2 * d, 3 * d, 3 * d);
        ctx.fillStyle = dark ? "#e6ece9" : "#121a17";
        ctx.fillText(w.name, cx + 2 * d, ny + 0.5);
      }
      // icon bubble (state) or speech bubble (what it is doing)
      let icon: Icon | null = w.flash?.icon ?? null;
      if (!icon) icon = w.thinking ? "think" : w.state === "waiting_approval" ? "alert" : w.state === "error" ? "error" : w.state === "paused" ? "zz" : null;
      if (w.bubble) {
        ctx.font = `500 ${Math.round(11 * d)}px "Geist Variable", system-ui, sans-serif`;
        const tw = Math.min(ctx.measureText(w.bubble.text).width, 220 * d) + 14 * d;
        const fade = Math.min(1, (w.bubble.until - now) / 600);
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = dark ? "#1b2420" : "#ffffff";
        ctx.strokeStyle = dark ? "#33413a" : "#d9e1dd";
        ctx.lineWidth = d;
        // Keep the bubble inside the canvas: rooms on the edge would cut it off.
        const bx = Math.max(4 * d, Math.min(cx - tw / 2, ctx.canvas.width - tw - 4 * d));
        roundRect(bx, top - 22 * d, tw, 20 * d, 6 * d);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = dark ? "#e6ece9" : "#121a17";
        ctx.fillText(w.bubble.text, bx + tw / 2, top - 12 * d, 220 * d);
        ctx.globalAlpha = 1;
      } else if (icon) {
        const r = 9 * d;
        const colors: Record<Icon, [string, string, string]> = {
          think: [dark ? "#1b2420" : "#ffffff", dark ? "#93a39c" : "#5a6762", "…"],
          alert: ["#e0a84a", "#ffffff", "!"],
          error: ["#ef5d4b", "#ffffff", "!"],
          zz: [dark ? "#1b2420" : "#ffffff", "#6fa4e8", "z"],
          bang: ["#2a78d6", "#ffffff", "!"],
          tick: ["#1e8a4c", "#ffffff", "✓"],
        };
        const [bg, fg, ch] = colors[icon];
        ctx.globalAlpha = icon === "alert" ? pulse : 1;
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(cx, top - r, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = fg;
        ctx.font = `700 ${Math.round(12 * d)}px "Geist Variable", system-ui, sans-serif`;
        ctx.fillText(ch, cx, top - r + 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- loop

  function needsSlowFrames(): boolean {
    for (const w of walkers.values()) {
      if (w.bubble || w.flash || w.thinking || w.state === "waiting_approval") return true;
      if (w.sitting && w.state === "working") return true;
    }
    return false;
  }

  function loop(now: number) {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const moving = update(dt, now);
    followStep(dt);
    // Moving: every frame. Typing, bubbles, pulses: about 8 fps. Nothing happening: no drawing.
    if (moving || dirty || (needsSlowFrames() && now - lastSlowDraw > 125)) {
      draw(now);
      lastSlowDraw = now;
      dirty = false;
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  // ---------------------------------------------------------------- input

  function agentAt(clientX: number, clientY: number, slack = 2): string | null {
    const r = canvas.getBoundingClientRect();
    const { x: wx, y: wy } = toWorld(cam, { x: clientX - r.left, y: clientY - r.top });
    let best: string | null = null;
    let bestD = Infinity;
    for (const w of walkers.values()) {
      const c = centreOf(w);
      const dx = Math.abs(wx - c.x);
      const dy = Math.abs(wy - c.y);
      if (dx <= CHAR_W / 2 + slack && dy <= CHAR_H / 2 + slack) {
        const dd = dx * dx + dy * dy;
        if (dd < bestD) {
          bestD = dd;
          best = w.id;
        }
      }
    }
    return best;
  }

  // Panning, zooming and taps are the viewport's; hovering (mouse, no button) shows a name.
  const onHover = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const hit = agentAt(e.clientX, e.clientY, 3);
    if (hit !== hovered) {
      hovered = hit;
      canvas.style.cursor = hit ? "pointer" : "";
      dirty = true;
    }
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("application/x-agentic-task")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const hit = agentAt(e.clientX, e.clientY, 8);
    if (hit !== dropHover) {
      dropHover = hit;
      dirty = true;
    }
  };
  const onDragLeave = () => {
    dropHover = null;
    dirty = true;
  };
  const onDrop = (e: DragEvent) => {
    const taskId = e.dataTransfer?.getData("application/x-agentic-task");
    const hit = agentAt(e.clientX, e.clientY, 8);
    dropHover = null;
    dirty = true;
    if (!taskId || !hit) return;
    e.preventDefault();
    handlers.onTaskDrop?.(taskId, hit);
  };
  canvas.addEventListener("pointermove", onHover);
  canvas.addEventListener("dragover", onDragOver);
  canvas.addEventListener("dragleave", onDragLeave);
  canvas.addEventListener("drop", onDrop);

  return {
    setData,
    apply,
    focus,
    follow(id) {
      following = id && walkers.has(id) ? id : null;
      if (following) selected = following;
      dirty = true;
    },
    zoom: zoomStep,
    fit: () => fit(260),
    setTheme(isDark) {
      dark = isDark;
      dirty = true;
    },
    select(id) {
      selected = id;
      dirty = true;
    },
    agentPosition(id) {
      const w = walkers.get(id);
      return w ? toScreen(cam, centreOf(w)) : null;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      vp.destroy();
      mq?.removeEventListener("change", onDpr);
      canvas.removeEventListener("pointermove", onHover);
      canvas.removeEventListener("dragover", onDragOver);
      canvas.removeEventListener("dragleave", onDragLeave);
      canvas.removeEventListener("drop", onDrop);
    },
  };
}
