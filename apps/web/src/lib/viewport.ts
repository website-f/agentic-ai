/** A camera for infinite canvases: pan, zoom and touch gestures in plain DOM, with no
 * framework. The workflow board (React, DOM nodes) and the pixel office (Canvas 2D) both
 * use it, so they feel the same: drag empty space to pan, wheel zooms at the pointer like
 * n8n, Space + drag is a hand tool, one finger pans with momentum, two fingers pinch.
 *
 * Camera convention: screen = world * k + (x, y), in CSS pixels relative to the surface.
 * The top half is pure math (unit tested); `createViewport` wires it to pointer, wheel and
 * keyboard events and calls `onChange` at most once per animation frame. */

export type Pt = { x: number; y: number };
export type Camera = { x: number; y: number; k: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type ZoomLimits = { min: number; max: number };

export const DEFAULT_LIMITS: ZoomLimits = { min: 0.1, max: 4 };

// ---------------------------------------------------------------- pure math

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampZoom = (k: number, lim: ZoomLimits = DEFAULT_LIMITS) => clamp(k, lim.min, lim.max);
export const toWorld = (c: Camera, p: Pt): Pt => ({ x: (p.x - c.x) / c.k, y: (p.y - c.y) / c.k });
export const toScreen = (c: Camera, p: Pt): Pt => ({ x: p.x * c.k + c.x, y: p.y * c.k + c.y });
export const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Zoom to `k` keeping the world point under screen point `p` exactly where it is. */
export function zoomAt(c: Camera, k: number, p: Pt, lim: ZoomLimits = DEFAULT_LIMITS): Camera {
  const nk = clampZoom(k, lim);
  const w = toWorld(c, p);
  return { k: nk, x: p.x - w.x * nk, y: p.y - w.y * nk };
}

export const zoomBy = (c: Camera, factor: number, p: Pt, lim: ZoomLimits = DEFAULT_LIMITS) => zoomAt(c, c.k * factor, p, lim);
export const panBy = (c: Camera, dx: number, dy: number): Camera => ({ ...c, x: c.x + dx, y: c.y + dy });

/** Two fingers moved from `from` to `to`: scale by the change in their distance and carry
 * the world point under the old midpoint to the new midpoint (pinch and pan at once).
 * Computed from the gesture's start camera, so it never drifts. */
export function pinchTo(c0: Camera, from: [Pt, Pt], to: [Pt, Pt], lim: ZoomLimits = DEFAULT_LIMITS): Camera {
  const d0 = distance(from[0], from[1]);
  const d1 = distance(to[0], to[1]);
  const nk = clampZoom(d0 > 0 ? (c0.k * d1) / d0 : c0.k, lim);
  const w = toWorld(c0, midpoint(from[0], from[1]));
  const m1 = midpoint(to[0], to[1]);
  return { k: nk, x: m1.x - w.x * nk, y: m1.y - w.y * nk };
}

/** The camera that shows `r` centred in a `size` box with `pad` px around it. */
export function fitRect(r: Rect, size: { w: number; h: number }, opts: { pad?: number; lim?: ZoomLimits; maxK?: number } = {}): Camera {
  const pad = opts.pad ?? 60;
  const lim = opts.lim ?? DEFAULT_LIMITS;
  const raw = Math.min((size.w - pad * 2) / Math.max(1, r.w), (size.h - pad * 2) / Math.max(1, r.h));
  const k = clampZoom(Math.min(opts.maxK ?? lim.max, raw > 0 ? raw : lim.min), lim);
  return { k, x: (size.w - r.w * k) / 2 - r.x * k, y: (size.h - r.h * k) / 2 - r.y * k };
}

/** Ease between two cameras so that the world point which ends under `focus` glides there
 * in a straight line while the zoom changes geometrically (no swooping). */
export function interpolate(from: Camera, to: Camera, t: number, focus: Pt): Camera {
  const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * t);
  const w = toWorld(to, focus);
  const s0 = toScreen(from, w);
  const sx = s0.x + (focus.x - s0.x) * t;
  const sy = s0.y + (focus.y - s0.y) * t;
  return { k, x: sx - w.x * k, y: sy - w.y * k };
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

// ---------------------------------------------------------------- wheel

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** Non-standard (Chrome, Safari, Edge): multiples of 120 for wheel notches, -3 x deltaY on trackpads. */
  wheelDeltaY?: number;
}
export type WheelDevice = "mouse" | "trackpad";

/** Best guess at whether a wheel event came from a notched mouse wheel or a trackpad. */
export function guessWheelDevice(e: WheelLike): WheelDevice {
  if (e.deltaMode !== 0) return "mouse"; // lines or pages: Firefox's mouse wheel
  if (e.deltaX !== 0) return "trackpad"; // two-finger scroll moves sideways too
  const wdy = e.wheelDeltaY;
  if (typeof wdy === "number" && wdy !== 0) {
    if (wdy === -3 * e.deltaY) return "trackpad";
    if (Math.abs(wdy) % 120 === 0) return "mouse";
  }
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40 ? "mouse" : "trackpad";
}

/** Wheel deltas in CSS px (Firefox reports lines, sometimes pages). */
export function wheelPixels(e: WheelLike, page = 800): Pt {
  const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1;
  return { x: e.deltaX * f, y: e.deltaY * f };
}

export type WheelAction = { kind: "zoom"; factor: number; smooth: boolean } | { kind: "pan"; dx: number; dy: number };

/** What a wheel event should do. Pinch on a trackpad arrives as ctrl + wheel. */
export function wheelAction(e: WheelLike, device: WheelDevice, mouseWheel: "zoom" | "pan" = "zoom"): WheelAction {
  const px = wheelPixels(e);
  if (e.ctrlKey || e.metaKey || (device === "mouse" && mouseWheel === "zoom" && !e.shiftKey)) {
    // d3-zoom's curve: one mouse notch (100px) is about 13%; a pinch is 10x more sensitive per px.
    const per = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
    const gain = device === "trackpad" && (e.ctrlKey || e.metaKey) ? 10 : 1;
    const exp = clamp(-e.deltaY * per * gain, -1, 1);
    return { kind: "zoom", factor: 2 ** exp, smooth: device === "mouse" };
  }
  if (e.shiftKey && px.x === 0) return { kind: "pan", dx: -px.y, dy: 0 }; // Shift + wheel: sideways
  return { kind: "pan", dx: -px.x, dy: -px.y };
}

// ---------------------------------------------------------------- momentum

/** Remembers the last ~100 ms of pointer positions to measure a fling. */
export class VelocityTracker {
  private s: { x: number; y: number; t: number }[] = [];
  add(p: Pt, t: number) {
    this.s.push({ ...p, t });
    while (this.s.length > 2 && t - this.s[0]!.t > 100) this.s.shift();
  }
  reset() {
    this.s = [];
  }
  /** px per ms; zero when the pointer had stopped before letting go. */
  velocity(now: number): Pt {
    const s = this.s;
    if (s.length < 2) return { x: 0, y: 0 };
    const last = s[s.length - 1]!;
    if (now - last.t > 60) return { x: 0, y: 0 };
    const first = s[0]!;
    const dt = last.t - first.t;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}

/** One frame of momentum: move by v * dt and decay v exponentially (tau in ms). */
export function momentumStep(v: Pt, dt: number, tau = 260): { dx: number; dy: number; v: Pt } {
  const decay = Math.exp(-dt / tau);
  // Integral of v * e^(-t/tau) over dt: the exact distance, independent of frame rate.
  const f = tau * (1 - decay);
  return { dx: v.x * f, dy: v.y * f, v: { x: v.x * decay, y: v.y * decay } };
}

// ---------------------------------------------------------------- the controller

export type Role = "background" | "item" | "ignore";

export interface ViewportOptions {
  initial: Camera;
  limits?: ZoomLimits | (() => ZoomLimits);
  /** Called at most once per frame with the new camera. */
  onChange: (c: Camera) => void;
  /** What a pointer landed on. Default: data-vp="item" / "ignore" on an ancestor, else background.
   * Mouse on an item is left to the app (drag the node); touch on an item waits: a drag
   * pans, a tap is `onTap`, a long press is `onLongPress`. */
  classify?: (target: Element) => Role;
  onTap?: (info: { target: Element; point: Pt; client: Pt; pointerType: string; role: Role; shiftKey: boolean }) => void;
  /** Touch long-press on an item. Return true when the app takes over the pointer (e.g. drags it). */
  onLongPress?: (e: PointerEvent, target: Element) => boolean;
  /** Shift + drag on the background (mouse): a selection rectangle in surface px, null when done. */
  onMarquee?: (r: Rect | null, done: boolean) => void;
  /** Any pan, pinch or zoom started by the person (not by code). */
  onUserGesture?: () => void;
  /** Keep the camera within bounds (e.g. so the office never leaves the screen). */
  clamp?: (c: Camera, size: { w: number; h: number }) => Camera;
  /** After a pinch or a wheel zoom settles, adjust the zoom (e.g. to whole pixels). */
  snapZoom?: (k: number) => number;
  /** For Shift+1 and fit(). */
  contentBounds?: () => Rect | null;
  fitOptions?: { pad?: number; maxK?: number };
  /** Plain mouse wheel: zoom at the pointer (n8n) or pan. Default zoom. */
  mouseWheel?: "zoom" | "pan";
  /** "focus": a plain wheel scrolls the page until the surface has been clicked (for boards
   * embedded in a scrolling page). Ctrl + wheel and pinch always zoom. Default "always". */
  wheelCapture?: "always" | "focus";
  /** Arrow keys may pan (e.g. only when nothing is selected). */
  canNudge?: () => boolean;
  keyboard?: boolean;
  doubleTapZoom?: boolean;
  longPressMs?: number;
}

export interface Viewport {
  get(): Camera;
  size(): { w: number; h: number };
  set(c: Camera, opts?: { animate?: number; focus?: Pt }): void;
  zoomBy(factor: number, at?: Pt, animate?: number): void;
  zoomTo(k: number, at?: Pt, animate?: number): void;
  fit(r?: Rect | null, opts?: { pad?: number; maxK?: number; animate?: number }): void;
  centerOn(world: Pt, opts?: { k?: number; animate?: number }): void;
  panBy(dx: number, dy: number, animate?: number): void;
  /** Stop momentum and animations (e.g. when following something). */
  stop(): void;
  isGesturing(): boolean;
  destroy(): void;
}

const SLOP_TOUCH = 8;
const SLOP_MOUSE = 3;
const DOUBLE_TAP_MS = 300;

type Gesture =
  | { kind: "idle" }
  | { kind: "pending"; id: number; start: Pt; target: Element; role: Role; timer: number; down: PointerEvent }
  | { kind: "pan"; id: number; last: Pt; moved: boolean; start: Pt; target: Element; role: Role; mouse: boolean; shiftKey: boolean }
  | { kind: "pinch"; ids: [number, number]; start: [Pt, Pt]; cam0: Camera }
  | { kind: "marquee"; id: number; start: Pt; cur: Pt }
  | { kind: "delegated"; id: number };

function defaultClassify(target: Element): Role {
  const hit = target.closest("[data-vp]");
  const v = hit?.getAttribute("data-vp");
  return v === "item" || v === "ignore" ? v : "background";
}

function isTyping(el: EventTarget | null) {
  return el instanceof Element && !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]");
}

export function createViewport(el: HTMLElement, opts: ViewportOptions): Viewport {
  let cam: Camera = { ...opts.initial };
  let w = el.clientWidth;
  let h = el.clientHeight;
  let raf = 0;
  let destroyed = false;
  let anim: { from: Camera; to: Camera; focus: Pt; t0: number; ms: number } | null = null;
  let momentum: { v: Pt; tau: number } | null = null;
  let gesture: Gesture = { kind: "idle" };
  const pts = new Map<number, Pt>(); // live touch/pen/mouse pointers we track, surface px
  const vel = new VelocityTracker();
  let space = false;
  let hovered = false;
  let engaged = false; // clicked into (for wheelCapture "focus")
  let wheelSession = { device: "mouse" as WheelDevice, last: 0 };
  let settleTimer = 0;
  let lastFocus: Pt = { x: w / 2, y: h / 2 };
  let lastTap: { t: number; p: Pt } | null = null;
  let lastPointerType = "mouse";

  const limits = (): ZoomLimits => (typeof opts.limits === "function" ? opts.limits() : opts.limits ?? DEFAULT_LIMITS);
  const size = () => ({ w, h });
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const fix = (c: Camera): Camera => {
    const k = clampZoom(c.k, limits());
    const c2 = k === c.k ? c : zoomAt(c, k, { x: w / 2, y: h / 2 }, limits());
    return opts.clamp ? opts.clamp(c2, size()) : c2;
  };
  const schedule = () => {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  };
  const apply = (c: Camera) => {
    cam = fix(c);
    schedule();
  };

  let lastFrame = 0;
  function frame(now: number) {
    raf = 0;
    if (destroyed) return;
    const dt = lastFrame ? Math.min(40, now - lastFrame) : 16;
    lastFrame = now;
    let again = false;
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.ms);
      cam = fix(interpolate(anim.from, anim.to, easeOutCubic(t), anim.focus));
      if (t >= 1) anim = null;
      else again = true;
    } else if (momentum) {
      const step = momentumStep(momentum.v, dt, momentum.tau);
      const before = cam;
      cam = fix(panBy(cam, step.dx, step.dy));
      momentum.v = step.v;
      const stuck = Math.abs(cam.x - before.x) < 0.01 && Math.abs(cam.y - before.y) < 0.01;
      if (Math.hypot(step.v.x, step.v.y) < 0.015 || stuck) momentum = null;
      else again = true;
    }
    opts.onChange(cam);
    if (again) schedule();
    else lastFrame = 0;
  }

  const stop = () => {
    anim = null;
    momentum = null;
  };
  const animateTo = (to: Camera, ms: number, focus?: Pt) => {
    momentum = null;
    const target = fix(to);
    if (ms <= 0) {
      anim = null;
      cam = target;
      schedule();
      return;
    }
    anim = { from: cam, to: target, focus: focus ?? { x: w / 2, y: h / 2 }, t0: performance.now(), ms };
    schedule();
  };
  /** Where the camera is heading (so quick wheel notches add up instead of restarting). */
  const heading = () => anim?.to ?? cam;

  const settle = () => {
    window.clearTimeout(settleTimer);
    if (!opts.snapZoom) return;
    const base = heading();
    const k = clampZoom(opts.snapZoom(base.k), limits());
    if (Math.abs(k - base.k) > 1e-3) animateTo(zoomAt(base, k, lastFocus, limits()), 160, lastFocus);
  };
  const settleSoon = () => {
    window.clearTimeout(settleTimer);
    if (opts.snapZoom) settleTimer = window.setTimeout(settle, 180);
  };

  // ------------------------------------------------ pointers

  const role = (t: EventTarget | null): Role => {
    if (!(t instanceof Element)) return "background";
    return (opts.classify ?? defaultClassify)(t);
  };
  const capture = (id: number) => {
    try {
      el.setPointerCapture(id);
    } catch {
      /* synthetic or already-ended pointer */
    }
  };
  const release = (id: number) => {
    try {
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    } catch {
      /* ignore */
    }
  };
  const setCursor = () => {
    el.style.cursor = gesture.kind === "pan" && gesture.moved ? "grabbing" : space && hovered ? "grab" : "";
  };
  const user = () => {
    stop();
    opts.onUserGesture?.();
  };

  const startPan = (id: number, p: Pt, target: Element, r: Role, mouse: boolean, shiftKey: boolean, moved = false, from = p) => {
    gesture = { kind: "pan", id, last: p, moved, start: from, target, role: r, mouse, shiftKey };
    vel.reset();
    vel.add(p, performance.now());
    setCursor();
  };
  const startPinch = () => {
    const [a, b] = [...pts.entries()];
    if (!a || !b) return;
    if (gesture.kind === "pending") window.clearTimeout(gesture.timer);
    gesture = { kind: "pinch", ids: [a[0], b[0]], start: [a[1], b[1]], cam0: cam };
    user();
  };

  const onDown = (e: PointerEvent) => {
    lastPointerType = e.pointerType;
    const p = local(e);
    const target = e.target instanceof Element ? e.target : el;
    const r = role(target);
    const touch = e.pointerType === "touch";
    if (!touch) engaged = true;
    if (touch) {
      if (r === "ignore") return;
      pts.set(e.pointerId, p);
      capture(e.pointerId);
      stop();
      if (pts.size === 2 && (gesture.kind === "pending" || gesture.kind === "pan" || gesture.kind === "idle")) {
        startPinch();
        return;
      }
      if (pts.size > 2 || gesture.kind !== "idle") return;
      engaged = true;
      const timer = r === "item" && opts.onLongPress
        ? window.setTimeout(() => {
            if (gesture.kind !== "pending" || gesture.id !== e.pointerId) return;
            const g = gesture;
            if (opts.onLongPress!(g.down, g.target)) {
              gesture = { kind: "delegated", id: g.id };
              pts.delete(g.id);
              navigator.vibrate?.(12);
            }
          }, opts.longPressMs ?? 380)
        : 0;
      gesture = { kind: "pending", id: e.pointerId, start: p, target, role: r, timer, down: e };
      return;
    }
    // Mouse and pen.
    const middle = e.button === 1;
    const hand = e.button === 0 && space;
    if (middle || hand) {
      // Take it before the node under the pointer sees it: no node drag, no autoscroll.
      e.preventDefault();
      e.stopPropagation();
      user();
      capture(e.pointerId);
      pts.set(e.pointerId, p);
      startPan(e.pointerId, p, target, r, true, false, true);
      el.focus({ preventScroll: true });
      return;
    }
    if (e.button !== 0 || r !== "background") return;
    if (gesture.kind !== "idle") return;
    e.preventDefault(); // no text selection while dragging the board
    el.focus({ preventScroll: true });
    stop();
    capture(e.pointerId);
    pts.set(e.pointerId, p);
    if (e.shiftKey && opts.onMarquee) {
      gesture = { kind: "marquee", id: e.pointerId, start: p, cur: p };
      return;
    }
    startPan(e.pointerId, p, target, r, true, e.shiftKey);
  };

  const onMove = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === "mouse") hovered = true;
      return;
    }
    const p = local(e);
    pts.set(e.pointerId, p);
    const g = gesture;
    if (g.kind === "pinch") {
      if (!g.ids.includes(e.pointerId)) return;
      const a = pts.get(g.ids[0]);
      const b = pts.get(g.ids[1]);
      if (!a || !b) return;
      lastFocus = midpoint(a, b);
      apply(pinchTo(g.cam0, g.start, [a, b], limits()));
      return;
    }
    if (g.kind === "pending" && g.id === e.pointerId) {
      if (distance(p, g.start) > SLOP_TOUCH) {
        window.clearTimeout(g.timer);
        user();
        // Pan from where the finger started so nothing jumps.
        startPan(g.id, g.start, g.target, g.role, false, false, true);
        const pg = gesture as Extract<Gesture, { kind: "pan" }>;
        apply(panBy(cam, p.x - pg.last.x, p.y - pg.last.y));
        pg.last = p;
        vel.add(p, performance.now());
      }
      return;
    }
    if (g.kind === "pan" && g.id === e.pointerId) {
      if (!g.moved) {
        if (distance(p, g.start) <= (g.mouse ? SLOP_MOUSE : SLOP_TOUCH)) return;
        g.moved = true;
        user();
        setCursor();
      }
      apply(panBy(cam, p.x - g.last.x, p.y - g.last.y));
      g.last = p;
      vel.add(p, performance.now());
      return;
    }
    if (g.kind === "marquee" && g.id === e.pointerId) {
      g.cur = p;
      opts.onMarquee?.(rectOf(g.start, p), false);
    }
  };

  const rectOf = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  const tap = (target: Element, p: Pt, e: PointerEvent, r: Role, shiftKey: boolean) => {
    const now = performance.now();
    const client = { x: e.clientX, y: e.clientY };
    if (opts.doubleTapZoom !== false && e.pointerType === "touch" && r === "background" && lastTap && now - lastTap.t < DOUBLE_TAP_MS && distance(lastTap.p, p) < 30) {
      lastTap = null;
      lastFocus = p;
      animateTo(zoomAt(heading(), heading().k * 2, p, limits()), 220, p);
      opts.onUserGesture?.();
      settleSoon();
      return;
    }
    lastTap = { t: now, p };
    opts.onTap?.({ target, point: p, client, pointerType: e.pointerType, role: r, shiftKey });
  };

  const onUp = (e: PointerEvent) => {
    const cancelled = e.type === "pointercancel";
    if (!pts.has(e.pointerId)) {
      if (gesture.kind === "delegated" && gesture.id === e.pointerId) gesture = { kind: "idle" };
      return;
    }
    const p = local(e);
    pts.delete(e.pointerId);
    release(e.pointerId);
    const g = gesture;
    if (g.kind === "pinch") {
      if (!g.ids.includes(e.pointerId)) return;
      const rest = [...pts.entries()];
      if (rest.length >= 2) {
        gesture = { kind: "pinch", ids: [rest[0]![0], rest[1]![0]], start: [rest[0]![1], rest[1]![1]], cam0: cam };
      } else if (rest.length === 1) {
        // One finger stays: keep panning with it.
        startPan(rest[0]![0], rest[0]![1], el, "background", false, false, true);
      } else {
        gesture = { kind: "idle" };
      }
      settleSoon();
      return;
    }
    if (g.kind === "pending" && g.id === e.pointerId) {
      window.clearTimeout(g.timer);
      gesture = { kind: "idle" };
      if (!cancelled) tap(g.target, p, e, g.role, false);
      return;
    }
    if (g.kind === "pan" && g.id === e.pointerId) {
      gesture = { kind: "idle" };
      setCursor();
      if (cancelled) return;
      if (!g.moved) {
        tap(g.target, p, e, g.role, g.shiftKey);
        return;
      }
      const v = vel.velocity(performance.now());
      const speed = Math.hypot(v.x, v.y);
      if (speed > 0.25) {
        // Subtle: a touch fling glides up to ~half a screen, a mouse fling a little less.
        const cap = Math.min(1, (g.mouse ? 1.8 : 2.4) / speed);
        momentum = { v: { x: v.x * cap, y: v.y * cap }, tau: g.mouse ? 150 : 200 };
        schedule();
      }
      return;
    }
    if (g.kind === "marquee" && g.id === e.pointerId) {
      gesture = { kind: "idle" };
      const r = rectOf(g.start, p);
      if (r.w < 3 && r.h < 3 && !cancelled) {
        opts.onMarquee?.(null, true);
        tap(e.target instanceof Element ? e.target : el, p, e, "background", true);
      } else opts.onMarquee?.(cancelled ? null : r, true);
    }
  };

  // ------------------------------------------------ wheel

  const onWheel = (e: WheelEvent) => {
    const now = performance.now();
    const device = now - wheelSession.last < 220 ? wheelSession.device : guessWheelDevice(e as WheelEvent & { wheelDeltaY?: number });
    wheelSession = { device, last: now };
    const act = wheelAction(e as WheelEvent & { wheelDeltaY?: number }, device, opts.mouseWheel ?? "zoom");
    const pinchy = e.ctrlKey || e.metaKey;
    if (opts.wheelCapture === "focus" && !engaged && !pinchy) return; // let the page scroll
    e.preventDefault();
    const p = local(e);
    lastFocus = p;
    opts.onUserGesture?.();
    momentum = null;
    if (act.kind === "zoom") {
      const base = act.smooth ? heading() : cam;
      const next = zoomAt(base, base.k * act.factor, p, limits());
      if (act.smooth) animateTo(next, 110, p);
      else {
        anim = null;
        apply(next);
      }
      settleSoon();
    } else {
      anim = null;
      apply(panBy(cam, act.dx, act.dy));
    }
  };

  // ------------------------------------------------ keyboard

  const active = () => {
    const a = document.activeElement;
    return el.contains(a) || ((!a || a === document.body) && hovered);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === " " && !isTyping(e.target) && (hovered || el.contains(document.activeElement))) {
      if (e.target instanceof HTMLButtonElement && !el.contains(e.target)) return;
      e.preventDefault(); // no page scroll, no button press
      if (!space) {
        space = true;
        setCursor();
      }
      return;
    }
    if (opts.keyboard === false || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || !active()) return;
    const c = { x: w / 2, y: h / 2 };
    const step = e.shiftKey ? 240 : 60;
    let handled = true;
    if (e.key === "+" || e.key === "=") api.zoomBy(1.25, c, 160);
    else if (e.key === "-" || e.key === "_") api.zoomBy(1 / 1.25, c, 160);
    else if (e.key === "0") api.zoomTo(1, c, 180);
    else if (e.shiftKey && (e.code === "Digit1" || e.key === "!")) api.fit(undefined, { animate: 260 });
    else if (e.key.startsWith("Arrow") && (opts.canNudge?.() ?? true)) {
      const dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
      const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      api.panBy(dx, dy, 120);
    } else handled = false;
    if (handled) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") {
      space = false;
      setCursor();
    }
  };
  const onBlur = () => {
    space = false;
    setCursor();
  };
  const onEnter = () => {
    hovered = true;
    setCursor();
  };
  const onLeave = () => {
    hovered = false;
    setCursor();
  };
  const onDocDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) engaged = false;
  };
  // iOS Safari: its own pinch-to-zoom of the page uses gesture events.
  const stopGesture = (e: Event) => e.preventDefault();
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault();
  };
  const onContext = (e: Event) => {
    if (lastPointerType === "touch") e.preventDefault(); // long press is ours, not a menu
  };

  const ro = new ResizeObserver(() => {
    const nw = el.clientWidth;
    const nh = el.clientHeight;
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    apply(cam);
  });
  ro.observe(el);

  el.addEventListener("pointerdown", onDown, true);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerenter", onEnter);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("gesturestart", stopGesture);
  el.addEventListener("gesturechange", stopGesture);
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("contextmenu", onContext);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("pointerdown", onDocDown, true);

  const api: Viewport = {
    get: () => cam,
    size,
    set(c, o) {
      if (o?.animate) animateTo(c, o.animate, o.focus);
      else {
        stop();
        apply(c);
      }
    },
    zoomBy(factor, at, animate = 0) {
      const p = at ?? { x: w / 2, y: h / 2 };
      const base = heading();
      lastFocus = p;
      animateTo(zoomAt(base, base.k * factor, p, limits()), animate, p);
    },
    zoomTo(k, at, animate = 0) {
      const p = at ?? { x: w / 2, y: h / 2 };
      animateTo(zoomAt(heading(), k, p, limits()), animate, p);
    },
    fit(r, o) {
      const rect = r ?? opts.contentBounds?.();
      if (!rect || !w || !h) return;
      const c = fitRect(rect, size(), { pad: o?.pad ?? opts.fitOptions?.pad, maxK: o?.maxK ?? opts.fitOptions?.maxK, lim: limits() });
      animateTo(c, o?.animate ?? 0);
    },
    centerOn(p, o) {
      const k = clampZoom(o?.k ?? heading().k, limits());
      animateTo({ k, x: w / 2 - p.x * k, y: h / 2 - p.y * k }, o?.animate ?? 0);
    },
    panBy(dx, dy, animate = 0) {
      animateTo(panBy(heading(), dx, dy), animate);
    },
    stop,
    isGesturing: () => gesture.kind !== "idle" || !!momentum,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      if (gesture.kind === "pending") window.clearTimeout(gesture.timer);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onDocDown, true);
      el.style.cursor = "";
    },
  };
  return api;
}
