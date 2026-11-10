/**
 * P93 (Fitri, 9 Nov 2026: "my movements and all must be recorded nicely"): sends location readings while — and only
 * while — the staff member is clocked in. Battery friendly and adaptive (movement.ts pingDue): about every 10 minutes
 * when still, every 2 minutes when moving. When still for a while the phone's location is not watched continuously; it
 * is read once each interval instead. Readings taken with no signal are kept on this phone and sent together when the
 * signal is back. When the screen comes back into view a fresh reading is sent at once.
 *
 * P97 (Fitri, 11 Nov 2026: "the location must be logged even if they close the thing"): as continuous as a phone allows.
 * - In the Prima app for Android and iPhone with the background-geolocation plugin (native-geo.ts), positions keep coming
 *   with Prima in the background or the screen off; the phone shows that Prima is following.
 * - In a browser, watchPosition keeps running while Prima is open, also in a background tab for as long as the browser
 *   lets it; the screen can be kept awake while clocked in (Screen Wake Lock, the person's choice on My clock).
 * - A web page cannot read the location once it is closed or the phone sleeps. Nothing is invented for those times: the
 *   phone notes when Prima went to the background, when location was refused or found nothing, and when the signal went,
 *   and sends those notes with the readings, so each gap shows its likely cause (movement.ts gapCause).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { RULES, fromMs, haversineM, pingDue, type TrackerNoteKind } from '@prima/core';
import { ApiError, api } from '../api';
import { useApp } from '../App';
import { startBackgroundGeo } from '../native-geo';

/** Sent on window after a check-in, check-out or sign-in clock, so the tracker starts or stops at once. */
export const CLOCK_CHANGED = 'prima:clock-changed';
export const clockChanged = () => window.dispatchEvent(new Event(CLOCK_CHANGED));

type Reading = { lat: number; lng: number; accuracyM: number | null; capturedAt: string };
type Note = { at: string; kind: TrackerNoteKind };
const QUEUE_MAX = 200;
const NOTES_MAX = 50;
/** Still for this long: stop watching continuously and read the location once each interval. */
const STILL_MS = 10 * 60_000;
/** The same "no position" note at most this often (a phone indoors can fail every few seconds). */
const NO_FIX_NOTE_MS = 10 * 60_000;
const qKey = (uid: string) => `prima.clockQueue.${uid}`;
const nKey = (uid: string) => `prima.clockNotes.${uid}`;
/** P97: the person's choice to keep the screen on while clocked in (this phone only). */
export const AWAKE_KEY = 'prima.clockAwake';

function readList<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeList<T>(key: string, q: T[], max: number) {
  try {
    if (q.length) localStorage.setItem(key, JSON.stringify(q.slice(-max)));
    else localStorage.removeItem(key);
  } catch {
    /* private window: kept only while there is a signal */
  }
}
/** No signal (or the server not reachable): keep the reading. A refusal (not clocked in) is not retried. */
const noSignal = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 408 || e.status === 429;

export function awakeWanted(): boolean {
  try {
    return localStorage.getItem(AWAKE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setAwakeWanted(on: boolean) {
  try {
    if (on) localStorage.setItem(AWAKE_KEY, '1');
    else localStorage.removeItem(AWAKE_KEY);
  } catch {
    /* private window */
  }
  window.dispatchEvent(new Event(CLOCK_CHANGED));
}

/** P97: what the tracker is doing now, for My clock to say honestly. */
export interface TrackerStatus {
  /** 'native': the Prima app follows in the background; 'web': only while Prima is open; 'off': not clocked in. */
  mode: 'off' | 'web' | 'native';
  lastFixAt: number | null;
  queued: number;
  problem: 'denied' | 'unsupported' | null;
  /** The screen kept awake: on, off, or this browser cannot. */
  wake: 'on' | 'off' | 'unsupported';
}
let status: TrackerStatus = { mode: 'off', lastFixAt: null, queued: 0, problem: null, wake: 'off' };
const listeners = new Set<() => void>();
function setStatus(p: Partial<TrackerStatus>) {
  status = { ...status, ...p };
  for (const l of listeners) l();
}
export function useTrackerStatus(): TrackerStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => status,
  );
}

type WakeLockLike = { release(): Promise<void>; addEventListener?(t: 'release', f: () => void): void };

export function StaffTracker() {
  const { me } = useApp();
  const uid = me.user.id;
  useEffect(() => {
    if (api.mode === 'demo') return;
    const geoOk = !!navigator.geolocation;
    const rule = RULES.staffMovement.value;
    let stillMin = RULES.staffPingMin.value;
    let on = false;
    let stopped = false;
    let watch: number | null = null;
    let poll: number | null = null;
    let nativeStop: (() => void) | null = null;
    let wake: WakeLockLike | null = null;
    let last: { atMs: number; lat: number; lng: number } | null = null;
    let lastMoveMs = Date.now();
    let lastNoFix = 0;

    const queued = () => readList<Reading>(qKey(uid)).length;
    const note = (kind: TrackerNoteKind) => {
      if (!on) return;
      if (kind === 'no_fix') {
        if (Date.now() - lastNoFix < NO_FIX_NOTE_MS) return;
        lastNoFix = Date.now();
      }
      writeList(nKey(uid), [...readList<Note>(nKey(uid)), { at: fromMs(Date.now()), kind }], NOTES_MAX);
    };

    const flush = async () => {
      const q = readList<Reading>(qKey(uid));
      const n = readList<Note>(nKey(uid));
      if ((!q.length && !n.length) || !navigator.onLine) return setStatus({ queued: q.length });
      try {
        await api.staffPings(q.slice(0, 200), n.slice(0, NOTES_MAX));
        writeList(qKey(uid), readList<Reading>(qKey(uid)).slice(Math.min(q.length, 200)), QUEUE_MAX);
        writeList(nKey(uid), readList<Note>(nKey(uid)).slice(Math.min(n.length, NOTES_MAX)), NOTES_MAX);
      } catch (e) {
        // Refused (for example no clock session any more for those times): drop them, never retry forever.
        if (!noSignal(e)) {
          writeList(qKey(uid), [], QUEUE_MAX);
          writeList(nKey(uid), [], NOTES_MAX);
        }
      }
      setStatus({ queued: queued() });
    };

    const send = async (r: Reading) => {
      setStatus({ lastFixAt: Date.now(), problem: null });
      if (!navigator.onLine) {
        writeList(qKey(uid), [...readList<Reading>(qKey(uid)), r], QUEUE_MAX);
        return setStatus({ queued: queued() });
      }
      try {
        const res = (await api.staffPing(r)) as { remote?: boolean };
        // A home day takes one reading at the start and no more (rule HR-WFH-PLACE).
        if (res?.remote) stop();
        void flush();
      } catch (e) {
        if (noSignal(e)) writeList(qKey(uid), [...readList<Reading>(qKey(uid)), r], QUEUE_MAX);
        // Not clocked in any more (checked out or signed out elsewhere): stop following at once.
        else if (e instanceof ApiError && /only while you are clocked in/i.test(e.message)) stop();
        setStatus({ queued: queued() });
      }
    };

    const onPosition = (lat: number, lng: number, accuracy: number, time: number | null) => {
      const fix = { atMs: Date.now(), lat, lng, accuracyM: Math.round(accuracy) };
      if (last && haversineM(last, fix) >= Math.max(rule.movedM, fix.accuracyM)) lastMoveMs = fix.atMs;
      if (!pingDue(last, fix, { stillMin, movingMin: rule.movingPingMin, movedM: rule.movedM, maxAccuracyM: rule.maxAccuracyM })) return adapt();
      last = { atMs: fix.atMs, lat: fix.lat, lng: fix.lng };
      void send({ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, capturedAt: fromMs(time || Date.now()) });
      adapt();
    };
    const onFix = (p: GeolocationPosition) => onPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.timestamp);
    const onError = (e: GeolocationPositionError) => {
      if (e.code === 1) {
        note('denied');
        setStatus({ problem: 'denied' });
      } else note('no_fix');
    };

    const startWatch = () => {
      if (watch !== null || stopped || nativeStop || !geoOk) return;
      if (poll !== null) window.clearInterval(poll);
      poll = null;
      watch = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 30_000 });
    };
    const readOnce = () => {
      if (!geoOk || nativeStop) return;
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
        onError,
        { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
      );
    };
    /** Still for a while: stop the continuous watch (battery) and read once each interval. */
    const adapt = () => {
      if (watch === null || Date.now() - lastMoveMs < STILL_MS) return;
      navigator.geolocation.clearWatch(watch);
      watch = null;
      if (poll === null) poll = window.setInterval(readOnce, stillMin * 60_000);
    };

    /** P97: keep the screen on while clocked in, when the person chose it and this browser allows it. */
    const holdWake = async () => {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock;
      if (!wl) return setStatus({ wake: 'unsupported' });
      if (!on || !awakeWanted() || document.visibilityState !== 'visible') {
        if (wake) void wake.release().catch(() => undefined);
        wake = null;
        return setStatus({ wake: 'off' });
      }
      if (wake) return;
      try {
        wake = await wl.request('screen');
        wake.addEventListener?.('release', () => {
          wake = null;
          setStatus({ wake: 'off' });
        });
        setStatus({ wake: 'on' });
      } catch {
        setStatus({ wake: 'off' });
      }
    };

    function stop() {
      if (on) note('stopped');
      on = false;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      if (poll !== null) window.clearInterval(poll);
      nativeStop?.();
      nativeStop = null;
      watch = null;
      poll = null;
      void holdWake();
      setStatus({ mode: 'off' });
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
        // The Prima app with the background plugin follows with Prima in the background; a browser uses watchPosition.
        nativeStop = await startBackgroundGeo(
          (f) => onPosition(f.latitude, f.longitude, f.accuracy, f.time),
          () => {
            note('denied');
            setStatus({ problem: 'denied' });
          },
        );
        if (stopped || !on) {
          nativeStop?.();
          nativeStop = null;
          return;
        }
        if (nativeStop) note('native');
        else if (!geoOk) setStatus({ problem: 'unsupported' });
        setStatus({ mode: nativeStop ? 'native' : 'web' });
        startWatch();
      }
      void holdWake();
      void flush();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        // The phone or browser may stop the page from here on: noted, so a gap that follows says why.
        note('hidden');
        void flush();
        return;
      }
      note('visible');
      void check().then(() => {
        // Back on the screen: a fresh reading at once (the phone may have slept), and anything kept is sent.
        if (on) {
          last = last ? { ...last, atMs: 0 } : null;
          readOnce();
        }
      });
    };
    const onOnline = () => {
      note('online');
      void flush();
    };
    const onOffline = () => note('offline');
    const onHide = () => note('hidden');
    void check();
    const t = window.setInterval(() => void check(), 5 * 60_000);
    window.addEventListener(CLOCK_CHANGED, check);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      stopped = true;
      window.clearInterval(t);
      window.removeEventListener(CLOCK_CHANGED, check);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [uid]);
  return null;
}
