/**
 * P93 (Fitri, 9 Nov 2026: "my movements and all must be recorded nicely"): sends location readings while — and only
 * while — the staff member is clocked in. Battery friendly and adaptive (movement.ts pingDue): about every 10 minutes
 * when still, every 2 minutes when moving. When still for a while the phone's location is not watched continuously; it
 * is read once each interval instead. Readings taken with no signal are kept on this phone and sent together when the
 * signal is back. When the screen comes back into view a fresh reading is sent at once. A web app only reads the
 * location while it is open; following a closed phone needs the native app wrapper (production).
 */
import { useEffect } from 'react';
import { RULES, fromMs, haversineM, pingDue } from '@prima/core';
import { ApiError, api } from '../api';
import { useApp } from '../App';

/** Sent on window after a check-in, check-out or sign-in clock, so the tracker starts or stops at once. */
export const CLOCK_CHANGED = 'prima:clock-changed';
export const clockChanged = () => window.dispatchEvent(new Event(CLOCK_CHANGED));

type Reading = { lat: number; lng: number; accuracyM: number | null; capturedAt: string };
const QUEUE_MAX = 200;
/** Still for this long: stop watching continuously and read the location once each interval. */
const STILL_MS = 10 * 60_000;
const qKey = (uid: string) => `prima.clockQueue.${uid}`;

function readQueue(uid: string): Reading[] {
  try {
    const v = JSON.parse(localStorage.getItem(qKey(uid)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeQueue(uid: string, q: Reading[]) {
  try {
    if (q.length) localStorage.setItem(qKey(uid), JSON.stringify(q.slice(-QUEUE_MAX)));
    else localStorage.removeItem(qKey(uid));
  } catch {
    /* private window: the readings are sent only while there is a signal */
  }
}
/** No signal (or the server not reachable): keep the reading. A refusal (not clocked in) is not retried. */
const noSignal = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 408 || e.status === 429;

export function StaffTracker() {
  const { me } = useApp();
  const uid = me.user.id;
  useEffect(() => {
    if (api.mode === 'demo' || !navigator.geolocation) return;
    const rule = RULES.staffMovement.value;
    let stillMin = RULES.staffPingMin.value;
    let on = false;
    let stopped = false;
    let watch: number | null = null;
    let poll: number | null = null;
    let last: { atMs: number; lat: number; lng: number } | null = null;
    let lastMoveMs = Date.now();

    const flush = async () => {
      const q = readQueue(uid);
      if (!q.length || !navigator.onLine) return;
      try {
        await api.staffPings(q.slice(0, 200));
        writeQueue(uid, readQueue(uid).slice(q.length));
      } catch (e) {
        // Refused (for example no clock session any more for those times): drop them, never retry forever.
        if (!noSignal(e)) writeQueue(uid, []);
      }
    };

    const send = async (r: Reading) => {
      if (!navigator.onLine) return writeQueue(uid, [...readQueue(uid), r]);
      try {
        const res = (await api.staffPing(r)) as { remote?: boolean };
        // A home day takes one reading at the start and no more (rule HR-WFH-PLACE).
        if (res?.remote) stop();
        void flush();
      } catch (e) {
        if (noSignal(e)) writeQueue(uid, [...readQueue(uid), r]);
        // Not clocked in any more (checked out or signed out elsewhere): stop following at once.
        else if (e instanceof ApiError && /only while you are clocked in/i.test(e.message)) stop();
      }
    };

    const onFix = (p: GeolocationPosition) => {
      const fix = { atMs: Date.now(), lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) };
      if (last && haversineM(last, fix) >= Math.max(rule.movedM, fix.accuracyM)) lastMoveMs = fix.atMs;
      if (!pingDue(last, fix, { stillMin, movingMin: rule.movingPingMin, movedM: rule.movedM, maxAccuracyM: rule.maxAccuracyM })) return adapt();
      last = { atMs: fix.atMs, lat: fix.lat, lng: fix.lng };
      void send({ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, capturedAt: fromMs(p.timestamp || Date.now()) });
      adapt();
    };

    const startWatch = () => {
      if (watch !== null || stopped) return;
      if (poll !== null) window.clearInterval(poll);
      poll = null;
      watch = navigator.geolocation.watchPosition(onFix, () => undefined, { enableHighAccuracy: true, maximumAge: 30_000 });
    };
    const readOnce = () =>
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const moved = last && haversineM(last, { lat: p.coords.latitude, lng: p.coords.longitude }) >= Math.max(rule.movedM, p.coords.accuracy);
          onFix(p);
          // Moving again: watch continuously.
          if (moved) {
            lastMoveMs = Date.now();
            startWatch();
          }
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
      );
    /** Still for a while: stop the continuous watch (battery) and read once each interval. */
    const adapt = () => {
      if (watch === null || Date.now() - lastMoveMs < STILL_MS) return;
      navigator.geolocation.clearWatch(watch);
      watch = null;
      if (poll === null) poll = window.setInterval(readOnce, stillMin * 60_000);
    };
    function stop() {
      on = false;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      if (poll !== null) window.clearInterval(poll);
      watch = null;
      poll = null;
    }

    /** Follow only while clocked in: asked again on open, after a check-in or out, and every few minutes. */
    const check = async () => {
      const mine = await api.myStaffClock().catch(() => null);
      if (stopped || !mine) return;
      if (!mine.open || mine.home) {
        stop();
        return;
      }
      stillMin = mine.pingEveryMin;
      if (!on) {
        on = true;
        last = null;
        lastMoveMs = Date.now();
        startWatch();
      }
      void flush();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void check().then(() => {
        // Back on the screen: a fresh reading at once (the phone may have slept), and anything kept is sent.
        if (on) {
          last = last ? { ...last, atMs: 0 } : null;
          readOnce();
        }
      });
    };
    const onOnline = () => void flush();
    void check();
    const t = window.setInterval(() => void check(), 5 * 60_000);
    window.addEventListener(CLOCK_CHANGED, check);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      stop();
      window.clearInterval(t);
      window.removeEventListener(CLOCK_CHANGED, check);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [uid]);
  return null;
}
