import { describe, expect, it } from "vitest";

import {
  clampZoom, fitRect, guessWheelDevice, interpolate, midpoint, momentumStep, pinchTo, toScreen, toWorld,
  VelocityTracker, wheelAction, zoomAt, zoomBy, type Camera, type Pt, type WheelLike,
} from "./viewport";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const wheel = (p: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...p });

describe("zoom at a point", () => {
  const cams: Camera[] = [{ x: 0, y: 0, k: 1 }, { x: 137.5, y: -42, k: 0.37 }, { x: -900, y: 310, k: 3.2 }];
  const points = [{ x: 0, y: 0 }, { x: 400, y: 250 }, { x: 1199, y: 3 }];

  it("keeps the world point under the cursor fixed, at every zoom", () => {
    for (const c of cams) {
      for (const p of points) {
        for (const k of [0.1, 0.5, 1, 2.75, 4]) {
          const before = toWorld(c, p);
          const after = toWorld(zoomAt(c, k, p), p);
          close(before.x, after.x, 1e-6);
          close(before.y, after.y, 1e-6);
        }
      }
    }
  });

  it("clamps the zoom and still keeps the point fixed", () => {
    const c = { x: 10, y: 20, k: 1 };
    const p = { x: 300, y: 200 };
    const z = zoomAt(c, 50, p, { min: 0.1, max: 4 });
    expect(z.k).toBe(4);
    const w = toWorld(c, p);
    const s = toScreen(z, w);
    close(s.x, p.x, 1e-9);
    close(s.y, p.y, 1e-9);
    expect(zoomAt(c, 0.0001, p).k).toBe(0.1);
    expect(clampZoom(2, { min: 0.5, max: 1.5 })).toBe(1.5);
    expect(clampZoom(0.2, { min: 0.5, max: 1.5 })).toBe(0.5);
  });

  it("zooming in then out by the same factor at the same point is a no-op", () => {
    const c = { x: 33, y: -12, k: 0.8 };
    const p = { x: 512, y: 384 };
    const back = zoomBy(zoomBy(c, 1.7, p), 1 / 1.7, p);
    close(back.k, c.k, 1e-12);
    close(back.x, c.x, 1e-9);
    close(back.y, c.y, 1e-9);
  });

  it("toWorld and toScreen are inverses", () => {
    const c = { x: -77, y: 19, k: 2.5 };
    const p = { x: 123, y: 456 };
    const s = toScreen(c, toWorld(c, p));
    close(s.x, p.x);
    close(s.y, p.y);
  });
});

describe("pinch", () => {
  const c0 = { x: 50, y: 80, k: 1 };

  it("spreading fingers symmetrically zooms around the midpoint, which stays put", () => {
    const from: [Pt, Pt] = [{ x: 100, y: 200 }, { x: 300, y: 200 }];
    const to: [Pt, Pt] = [{ x: 0, y: 200 }, { x: 400, y: 200 }];
    const c = pinchTo(c0, from, to);
    close(c.k, 2);
    const m = midpoint(from[0], from[1]);
    const before = toWorld(c0, m);
    const after = toWorld(c, m);
    close(before.x, after.x);
    close(before.y, after.y);
  });

  it("moving both fingers together pans by the midpoint's travel, no zoom", () => {
    const c = pinchTo(c0, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 130, y: 60 }, { x: 230, y: 60 }]);
    close(c.k, 1);
    close(c.x, c0.x + 30);
    close(c.y, c0.y - 40);
  });

  it("pinch and pan at once: the world point under the first midpoint ends under the new one", () => {
    const from: [Pt, Pt] = [{ x: 120, y: 90 }, { x: 260, y: 310 }];
    const to: [Pt, Pt] = [{ x: 40, y: 150 }, { x: 420, y: 380 }];
    const c = pinchTo(c0, from, to);
    const w = toWorld(c0, midpoint(from[0], from[1]));
    const s = toScreen(c, w);
    const m1 = midpoint(to[0], to[1]);
    close(s.x, m1.x, 1e-9);
    close(s.y, m1.y, 1e-9);
  });

  it("respects the zoom limits", () => {
    const c = pinchTo(c0, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { min: 0.25, max: 3 });
    expect(c.k).toBe(3);
  });
});

describe("fit", () => {
  it("centres the rect and fits it inside the padding", () => {
    const r = { x: 100, y: 50, w: 800, h: 400 };
    const c = fitRect(r, { w: 1000, h: 600 }, { pad: 50, maxK: 4 });
    close(c.k, Math.min(900 / 800, 500 / 400));
    const tl = toScreen(c, { x: r.x, y: r.y });
    const br = toScreen(c, { x: r.x + r.w, y: r.y + r.h });
    close((tl.x + br.x) / 2, 500);
    close((tl.y + br.y) / 2, 300);
    expect(tl.x).toBeGreaterThanOrEqual(50 - 1e-9);
  });
  it("does not zoom past maxK for a tiny graph", () => {
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 800 }, { maxK: 1.1 }).k).toBe(1.1);
  });
});

describe("animation path", () => {
  it("starts at from, ends at to, and keeps the focus point's glide straight", () => {
    const from = { x: 0, y: 0, k: 1 };
    const p = { x: 200, y: 100 };
    const to = zoomAt(from, 3, p);
    const a = interpolate(from, to, 0, p);
    const b = interpolate(from, to, 1, p);
    close(a.k, 1);
    close(a.x, 0);
    close(b.k, 3);
    close(b.x, to.x);
    close(b.y, to.y);
    // A pure zoom at p keeps p fixed throughout.
    const mid = interpolate(from, to, 0.5, p);
    const w = toWorld(from, p);
    const s = toScreen(mid, w);
    close(s.x, p.x, 1e-9);
    close(s.y, p.y, 1e-9);
  });
});

describe("wheel", () => {
  it("tells mouse wheels from trackpads", () => {
    expect(guessWheelDevice(wheel({ deltaY: 100, wheelDeltaY: -120 }))).toBe("mouse");
    expect(guessWheelDevice(wheel({ deltaY: 3, deltaMode: 1 }))).toBe("mouse");
    expect(guessWheelDevice(wheel({ deltaY: 4, wheelDeltaY: -12 }))).toBe("trackpad");
    expect(guessWheelDevice(wheel({ deltaY: 2.5 }))).toBe("trackpad");
    expect(guessWheelDevice(wheel({ deltaX: 1, deltaY: 10 }))).toBe("trackpad");
  });
  it("mouse wheel zooms (n8n), trackpad scroll pans, ctrl/pinch zooms, shift pans sideways", () => {
    const z = wheelAction(wheel({ deltaY: -100 }), "mouse");
    expect(z.kind).toBe("zoom");
    if (z.kind === "zoom") expect(z.factor).toBeGreaterThan(1);
    const pan = wheelAction(wheel({ deltaX: 5, deltaY: 12 }), "trackpad");
    expect(pan).toEqual({ kind: "pan", dx: -5, dy: -12 });
    const pinch = wheelAction(wheel({ deltaY: 4, ctrlKey: true }), "trackpad");
    expect(pinch.kind).toBe("zoom");
    if (pinch.kind === "zoom") expect(pinch.factor).toBeLessThan(1);
    expect(wheelAction(wheel({ deltaY: 100, shiftKey: true }), "mouse")).toEqual({ kind: "pan", dx: -100, dy: 0 });
    expect(wheelAction(wheel({ deltaY: 100 }), "mouse", "pan")).toEqual({ kind: "pan", dx: -0, dy: -100 });
  });
  it("one notch zooms a modest step either way", () => {
    const a = wheelAction(wheel({ deltaY: 100 }), "mouse");
    const b = wheelAction(wheel({ deltaY: -100 }), "mouse");
    if (a.kind !== "zoom" || b.kind !== "zoom") throw new Error("expected zoom");
    close(a.factor * b.factor, 1, 1e-12);
    expect(b.factor).toBeGreaterThan(1.1);
    expect(b.factor).toBeLessThan(1.25);
  });
});

describe("momentum", () => {
  it("measures a fling and ignores a pointer that stopped before letting go", () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 5; i++) v.add({ x: i * 10, y: 0 }, i * 10);
    close(v.velocity(50).x, 1);
    expect(v.velocity(200).x).toBe(0);
  });
  it("decays, and the distance does not depend on the frame rate", () => {
    const run = (dt: number) => {
      let vel = { x: 1, y: 0 };
      let d = 0;
      for (let t = 0; t < 600; t += dt) {
        const s = momentumStep(vel, dt);
        d += s.dx;
        vel = s.v;
      }
      return { d, v: vel.x };
    };
    const a = run(8);
    const b = run(24);
    expect(a.v).toBeLessThan(0.2);
    close(a.d, b.d, 1);
  });
});
