/**
 * P81 (staff check-in by place, 6 Nov 2026): the staff member's own check-in and check-out. Steps: allow location (with
 * help when the browser blocked it), a reading accurate to 100 m or better, the server's verdict on a map, the face check
 * when the clock waits for one, then confirm. The server decides in or out of the area; the screen only shows it.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AirplaneTiltIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  MapPinIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  SignInIcon,
  SignOutIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { fromMs, type CheckinEvent } from '@prima/core';
import { api, type CheckinPreview, type MyCheckin } from '../api';
import { Card, Steps, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';
import { PermissionHelp } from './PermissionHelp';
import { ClockPhotoStep, type ClockPhoto } from './ClockPhoto';
import { MovementView } from './Movement';
import {
  detectPlatform,
  deviceKind,
  LOCATION_PROBLEM_TEXT,
  locationProblem,
  locationProblemText,
  queryPermission,
  roughTips,
  type Device,
  type LocationProblem,
  type PermState,
} from './checkin-permissions';
import type { MapCircle, MapTone } from './GeoMap';
import { clockChanged } from './StaffTracker';
import { bestEstimate, fuse, locateEnd, nearestPlace, settled, SETTLE, usable, type Reading } from './location-fix';
import '../styles/checkin.css';

const GeoMap = lazy(() => import('./GeoMap'));

const time = (t: string) => t.slice(11, 16);
export const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);

export const VERDICT: Record<CheckinEvent['verdict'], { label: string; tone: Tone }> = {
  in_area: { label: 'In area', tone: 'ok' },
  out_of_area: { label: 'Out of area', tone: 'warn' },
  no_place: { label: 'No place set', tone: 'neutral' },
};
export const OUTCOME: Record<CheckinEvent['outcome'], { label: string; tone: Tone }> = {
  accepted: { label: 'Accepted', tone: 'ok' },
  flagged: { label: 'Flagged for review', tone: 'warn' },
  blocked: { label: 'Refused', tone: 'crit' },
};

/** Where the person stood, in words. */
export function whereText(e: Pick<CheckinEvent, 'matched' | 'nearest' | 'verdict' | 'outstation'>): string {
  if (e.matched) return `at ${e.matched.label}, ${fmtM(e.matched.distanceM)} from its pin`;
  if (e.outstation) return 'on an outstation day (anywhere allowed)';
  if (e.nearest) return `${fmtM(e.nearest.outsideByM)} outside ${e.nearest.label}`;
  return 'no check-in place is set';
}

export function addressText(e: Pick<CheckinEvent, 'address' | 'addressStatus'>): string {
  if (e.address) return e.address;
  return e.addressStatus === 'pending' ? 'Looking up the address…' : e.addressStatus === 'off' ? 'Address not looked up here' : 'No street address found for this point';
}

export function MapFallback({ height = 260 }: { height?: number }) {
  return <div className="ci-map ci-map-wait" style={{ height }} aria-hidden="true" />;
}

/** The check-in card on My clock. */
export function MyCheckinCard() {
  const { data, error, reload } = useLoad(() => api.myCheckin(), []);
  const [open, setOpen] = useState(false);
  if (error) return <Card title="Check in">{<ErrorNotice error={error} />}</Card>;
  if (!data || !data.allowed || !data.mine) return null;
  const m = data.mine;
  const done = data.today.filter((e) => e.outcome !== 'blocked');
  const last = done.at(-1) ?? null;
  const state = data.state;
  const head =
    state === 'in' && last
      ? { title: `Checked in at ${time(last.at)}`, sub: whereText(last), tone: 'ok' as Tone, chip: 'Checked in' }
      : state === 'out' && last
        ? { title: `Checked out at ${time(last.at)}`, sub: 'Check in again if you start work again today.', tone: 'neutral' as Tone, chip: 'Checked out' }
        : { title: 'Not checked in today', sub: 'Check in when you arrive. Your location is taken once, now.', tone: 'neutral' as Tone, chip: 'Not checked in' };
  return (
    <Card title="Check in" sub={`${m.companyName}`} actions={<Chip tone={head.tone}>{head.chip}</Chip>}>
      <div className="ci-card">
        <div className="ci-card-main">
          <span className="ci-card-icon" data-state={state} aria-hidden="true">
            {state === 'in' ? <SignInIcon size={24} /> : state === 'out' ? <SignOutIcon size={24} /> : <MapPinIcon size={24} />}
          </span>
          <div>
            <p className="ci-card-title">{head.title}</p>
            <p className="ci-card-sub">{head.sub}</p>
          </div>
        </div>
        <button type="button" className="btn btn-primary ci-go" onClick={() => setOpen(true)}>
          {state === 'in' ? <SignOutIcon size={18} aria-hidden="true" /> : <SignInIcon size={18} aria-hidden="true" />}
          {state === 'in' ? 'Check out' : 'Check in'}
        </button>
      </div>
      <div className="ci-where">
        <span className="label">You check in at</span>
        <div className="ci-chips">
          {m.targets.length === 0 && <Chip tone="neutral">No place set yet</Chip>}
          {m.targets.slice(0, 6).map((t) => (
            <Chip key={`${t.label}-${t.lat}`} tone="info">
              {t.label} · within {fmtM(t.radiusM)}
            </Chip>
          ))}
          {m.targets.length > 6 && <Chip tone="neutral">+{m.targets.length - 6} more</Chip>}
          {m.outstationToday && (
            <Chip tone="info">
              <AirplaneTiltIcon size={13} aria-hidden="true" /> Outstation today
            </Chip>
          )}
        </div>
        {m.rule === 'none' && (
          <p className="ss-note">No check-in place is set for you yet. Your check-in is still recorded with its location; HR or your manager sets your place.</p>
        )}
        <p className="ss-note">
          {m.policy === 'block'
            ? 'Outside your area, your company refuses the check-in; your manager sees the attempt.'
            : 'Outside your area, you can still check in with a reason; your manager reviews it.'}
        </p>
      </div>
      {data.today.length > 0 && (
        <ul className="ci-timeline" aria-label="Today's check-ins">
          {data.today.map((e) => (
            <li key={e.id} data-outcome={e.outcome}>
              <span className="ci-tl-time">{time(e.at)}</span>
              <span className="ci-tl-main">
                <span className="ci-tl-title">
                  {e.kind === 'in' ? 'Check-in' : 'Check-out'} {whereText(e)}
                </span>
                <span className="ci-tl-sub">
                  {addressText(e)} · ±{e.accuracyM} m
                </span>
              </span>
              <Chip tone={e.outcome === 'accepted' ? VERDICT[e.verdict].tone : OUTCOME[e.outcome].tone}>{e.outcome === 'accepted' ? VERDICT[e.verdict].label : OUTCOME[e.outcome].label}</Chip>
            </li>
          ))}
        </ul>
      )}
      <details className="ci-notice">
        <summary>
          <ShieldCheckIcon size={15} aria-hidden="true" /> What is recorded when you check in
        </summary>
        <ul>
          {data.notice.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
      {open && (
        <CheckinFlow
          me={data}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            reload();
          }}
        />
      )}
    </Card>
  );
}

type Fix = { lat: number; lng: number; accuracyM: number };
type Loc =
  | { phase: 'idle' }
  | { phase: 'asking'; accuracy: number | null; readings?: number; spot?: Fix | null }
  | { phase: 'problem'; problem: LocationProblem }
  | { phase: 'rough'; fix: Fix; text: string }
  | { phase: 'checking'; fix: Fix }
  | { phase: 'ready'; fix: Fix; preview: CheckinPreview };
type TestPlace = 'at' | 'away' | 'rough' | 'wifi' | 'device';
type GeoSource = Pick<Geolocation, 'watchPosition' | 'clearWatch' | 'getCurrentPosition'>;

/** P120: readings are gathered and combined (location-fix.ts); these are the old single-reading limits' heirs. */
const GOOD_M = SETTLE.goodM;
const WAIT_MS = SETTLE.waitMs;
/**
 * P93: when the best after WAIT_MS is still too rough, keep looking (the phone's GPS often needs half a minute indoors)
 * and show how close it is, instead of failing; only after this long is the person asked to move and try again.
 */
const LONG_WAIT_MS = 25_000; // P123: was 45 s
/** P123: a reading the browser already has counts when it is at most this old. */
const FRESH_MS = 20_000;
/** P123: within GOOD_M: taken after this (one more reading may sharpen it). */
const QUICK_MS = 800;
/** P123: within the check-in limit but rougher than GOOD_M: taken after this short look for better. */
const FAST_MS = 3_000;
/**
 * P122: a computer has no GPS; its Wi-Fi or network guess does not get better by waiting. With nothing within the
 * limit by then, it stops here and shows the guess with what to do (good readings still settle by the P120 rules).
 */
const COMPUTER_WAIT_MS = 10_000; // P123: was 20 s

/** Demo only: a pretend device sending the readings of the chosen test place, so the real search and its map run on
 * screen: a rough first guess, then closer readings. 'wifi': a computer with only a Wi-Fi guess, kilometres wide. */
function demoGeo(target: Fix, wifi: boolean): GeoSource {
  const timers = new Set<number>();
  const later = (ms: number, f: () => void) => {
    const t = window.setTimeout(() => {
      timers.delete(t);
      f();
    }, ms);
    timers.add(t);
  };
  const pos = (north: number, east: number, accuracy: number) =>
    ({
      coords: { latitude: target.lat + north / 111_320, longitude: target.lng + east / (111_320 * Math.cos((target.lat * Math.PI) / 180)), accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    }) as unknown as GeolocationPosition;
  return {
    getCurrentPosition(ok) {
      later(300, () => ok(wifi ? pos(1800, -900, 4200) : pos(900, 600, 2400)));
    },
    watchPosition(ok, fail) {
      if (wifi) {
        later(1300, () => ok(pos(1500, -700, 3900)));
        later(2800, () => fail?.({ code: 3, message: 'Timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError));
      } else {
        const closer: [number, number, number][] = [
          [260, -180, 650],
          [60, 40, 140],
          [12, -8, 35],
        ];
        closer.forEach(([n, e, a], i) => later(900 + i * 700, () => ok(pos(n, e, a))));
        for (let i = 0; i < 10; i++) later(3000 + i * 500, () => ok(pos(Math.sin(i) * 2, Math.cos(i) * 2, target.accuracyM)));
      }
      return 1;
    },
    clearWatch() {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    },
  };
}

/** P122: on a computer, the phone (with GPS) is the better way to check in. */
function PhoneHint() {
  return (
    <div className="ci-phone-hint">
      <DeviceMobileIcon size={24} aria-hidden="true" />
      <div>
        <p className="ci-phone-hint-title">Use the phone instead</p>
        <p className="ci-phone-hint-sub">Your phone has GPS and finds you to within a few metres. Open Prima on your phone and check in or out there.</p>
      </div>
    </div>
  );
}

function CheckinFlow({ me, onClose, onDone }: { me: MyCheckin; onClose: () => void; onDone: () => void }) {
  const m = me.mine!;
  // P97: fixed when the drawer opens. The screen reloads after the check-out is saved (state then 'out'); reading the
  // kind again then turned the finished check-out into "Checked in at ..." and hid its route.
  const [kind] = useState(() => (me.state === 'in' ? ('out' as const) : ('in' as const)));
  // P97 (rule HR-STAFF-SNAP, on by default): a face photo at every check-in and check-out. Before P97 the camera came
  // only with a face HR had approved and a sign-in clock still waiting for its face check, so most staff never saw it.
  const snapOn = me.snap?.on ?? false;
  const needFace = snapOn || (kind === 'in' && m.faceEnrolled && m.facePending);
  const [step, setStep] = useState<'location' | 'face' | 'confirm' | 'done'>('location');
  const [perm, setPerm] = useState<PermState>('unknown');
  const [loc, setLoc] = useState<Loc>({ phase: 'idle' });
  const [photo, setPhoto] = useState<ClockPhoto | null>(null);
  const [reason, setReason] = useState('');
  const [test, setTest] = useState<TestPlace>('at');
  const [result, setResult] = useState<{ at: string; text: string; already: boolean; clockId: string | null } | null>(null);
  const stopWatch = useRef<() => void>(() => undefined);
  const act = useAction();
  // P122: phone or computer, for the right help (a computer has no GPS; its location switch is in its settings).
  const here = useMemo(() => {
    const p = detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return { os: p.os, device: deviceKind(p, coarse) };
  }, []);
  const dev: Device = api.mode === 'demo' && test === 'wifi' ? 'computer' : here.device;

  useEffect(() => {
    let live = true;
    void queryPermission('location').then((s) => live && setPerm(s));
    // The browser tells us when the person changes the permission in its settings.
    let status: PermissionStatus | null = null;
    const onChange = () => status && setPerm(status.state as PermState);
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        status = s;
        s.addEventListener('change', onChange);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      status?.removeEventListener('change', onChange);
      stopWatch.current();
    };
  }, []);

  const check = async (fix: Fix) => {
    setLoc({ phase: 'checking', fix });
    try {
      const preview = await api.checkinPreview(fix);
      if (!preview.accuracyOk) return setLoc({ phase: 'rough', fix, text: preview.accuracyProblem ?? 'The reading is too rough.' });
      setLoc({ phase: 'ready', fix, preview });
    } catch (e) {
      // The server could not be reached or refused: show why, and offer the location step again.
      setLoc({ phase: 'idle' });
      void act.run(() => Promise.reject(e));
    }
  };

  const testFix = (): Fix => {
    const t = m.targets[0] ?? { lat: 3.139, lng: 101.6869, radiusM: 150 };
    if (test === 'at') return { lat: t.lat + 0.0002, lng: t.lng - 0.0001, accuracyM: 9 };
    if (test === 'away') return { lat: t.lat + 0.018, lng: t.lng, accuracyM: 14 };
    if (test === 'wifi') return { lat: t.lat, lng: t.lng, accuracyM: 4200 };
    return { lat: t.lat, lng: t.lng, accuracyM: 240 };
  };

  const roughText = (accuracyM: number) => `Your location is only accurate to about ${fmtM(accuracyM)}; it must be within ${me.maxAccuracyM} m to check in.`;

  const locate = () => {
    stopWatch.current();
    // Demo 'rough': the server's own accuracy check, at once.
    if (api.mode === 'demo' && test === 'rough') return void check(testFix());
    const geo: GeoSource | undefined = api.mode === 'demo' && test !== 'device' ? demoGeo(testFix(), test === 'wifi') : navigator.geolocation;
    if (!geo) return setLoc({ phase: 'problem', problem: 'unsupported' });
    setLoc({ phase: 'asking', accuracy: null, readings: 0, spot: null });
    // P120: every reading is kept and combined (location-fix.ts): cached and jumping readings dropped, the precise
    // cluster averaged by accuracy, taken once it is precise and steady (or the best there is at the time limit).
    const started = Date.now();
    // P123 (owner, 23 Nov 2026: "the map shows my pin but check-in does not detect it; detect it at once"): a reading
    // the browser already had, up to 20 s old, counts like a new one (it is where the person is), so the quick first
    // answer that puts the pin on the map can also be the check-in point.
    const since = started - FRESH_MS;
    const readings: Reading[] = [];
    const rules = { ...SETTLE, goodM: Math.min(GOOD_M, me.maxAccuracyM), maxM: me.maxAccuracyM, waitMs: WAIT_MS };
    const device = dev;
    let done = false;
    // P122: the browser's last error code (1 denied, 2 unavailable, 3 timeout), to say why when no reading came at all.
    let lastError: number | null = null;
    const current = () => fuse(usable(readings, since));
    const finish = () => {
      if (done) return;
      done = true;
      stopWatch.current();
      // P122: readings that came are never reported as "took too long": a good one is checked, a rough one is shown
      // with its real accuracy; only with no reading at all is it a problem (denied, switched off, or no answer).
      const end = locateEnd(readings, since, me.maxAccuracyM, lastError);
      if (end.kind === 'none') {
        if (end.problem === 'denied') setPerm('denied');
        return setLoc({ phase: 'problem', problem: end.problem });
      }
      const fix = { lat: end.lat, lng: end.lng, accuracyM: end.accuracyM };
      // Rough readings are never sent as a check-in: the person tries again (the server refuses them too).
      if (end.kind === 'rough' || fix.accuracyM > me.maxAccuracyM) return setLoc({ phase: 'rough', fix, text: roughText(fix.accuracyM) });
      void check(fix);
    };
    const review = () => {
      if (done) return;
      const elapsed = Date.now() - started;
      if (settled(usable(readings, since), elapsed, rules) || elapsed >= LONG_WAIT_MS) return finish();
      const f = current();
      // P123: good enough is taken at once: within GOOD_M straight away, within the limit after a short look for better.
      if (f && f.accuracyM <= me.maxAccuracyM && elapsed >= (f.accuracyM <= rules.goodM ? QUICK_MS : FAST_MS)) return finish();
      if (device === 'computer' && elapsed >= COMPUTER_WAIT_MS && (!f || f.accuracyM > me.maxAccuracyM) && bestEstimate(readings, since)) finish();
    };
    const take = (p: GeolocationPosition) => {
      if (done) return;
      setPerm('granted');
      // The phone's own time of the reading; a clock far off is replaced by now (the search is under a minute).
      const at = Math.abs(p.timestamp - Date.now()) < 120_000 ? p.timestamp : Date.now();
      readings.push({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at });
      const f = current();
      // P122: the map shows the best there is from the first reading on, even a rough one (never sent as such).
      const e = bestEstimate(readings, since);
      setLoc({ phase: 'asking', accuracy: e ? e.accuracyM : null, readings: f?.used ?? 0, spot: e ? { lat: e.lat, lng: e.lng, accuracyM: e.accuracyM } : null });
      review();
    };
    const fail = (err: GeolocationPositionError, fromWatch: boolean) => {
      if (done) return;
      const problem = locationProblem(err);
      if (problem === 'denied' || err.code === 2 || lastError == null) lastError = err.code;
      if (problem === 'denied') {
        done = true;
        stopWatch.current();
        setPerm('denied');
        return setLoc({ phase: 'problem', problem });
      }
      // The quick first answer failing says nothing yet: the watch keeps looking.
      if (!fromWatch) return;
      // P93/P122: a slow device that already gave a reading (even a rough one): use what there is instead of failing.
      if (bestEstimate(readings, since)) return finish();
      if (problem === 'timeout') return; // keep listening until the time limit
      done = true;
      stopWatch.current();
      setLoc({ phase: 'problem', problem });
    };
    const id = geo.watchPosition(take, (err) => fail(err, true), { enableHighAccuracy: true, maximumAge: 0, timeout: LONG_WAIT_MS });
    // P123: a second watch on the quick network location (Wi-Fi, cell): indoors it answers in a second or two while
    // the GPS is still looking; both go through the same rules.
    let quickWatch: number | null = null;
    try {
      quickWatch = geo.watchPosition(take, () => undefined, { enableHighAccuracy: false, maximumAge: FRESH_MS, timeout: LONG_WAIT_MS });
    } catch {
      quickWatch = null;
    }
    // P122: a quick first answer (Wi-Fi or network, or one the browser already has, up to a minute old) in parallel, so
    // the map shows where the person is at once. It goes through the same rules: too old or too rough, it is shown only.
    try {
      geo.getCurrentPosition(take, (err) => fail(err, false), { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 });
    } catch {
      /* the watch still runs */
    }
    // Readings may stop coming while the phone holds still: look again every second, and stop at the time limit.
    const tick = window.setInterval(review, 1000);
    const limit = window.setTimeout(finish, LONG_WAIT_MS + 500);
    stopWatch.current = () => {
      done = true;
      geo.clearWatch(id);
      if (quickWatch !== null) geo.clearWatch(quickWatch);
      window.clearInterval(tick);
      window.clearTimeout(limit);
    };
  };

  // Already allowed: start finding the location at once. P123: not yet asked either: the browser asks now, as the
  // check-in opens (Allow), instead of after a button press.
  useEffect(() => {
    if ((perm === 'granted' || perm === 'prompt') && loc.phase === 'idle') locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm]);

  const preview = loc.phase === 'ready' ? loc.preview : null;
  const fix = loc.phase === 'ready' || loc.phase === 'rough' || loc.phase === 'checking' ? loc.fix : null;
  // P122: the map from the first reading on: the person's best point now, with its accuracy, and the check-in places.
  const searching = loc.phase === 'asking';
  const spot: Fix | null = loc.phase === 'asking' ? (loc.spot ?? null) : fix;
  const places = preview?.targets ?? m.targets;
  const near = spot ? nearestPlace(spot, places) : null;
  const youTone: MapTone = preview ? (preview.outcome === 'blocked' ? 'crit' : preview.verdict === 'out_of_area' ? 'warn' : 'ok') : loc.phase === 'rough' ? 'warn' : 'info';
  // The person and the nearest place, when it is close enough to show both (a place 300 km away would hide the person).
  const fitTo = spot
    ? [
        { lat: spot.lat, lng: spot.lng, radiusM: spot.accuracyM },
        ...(near && !searching && near.distanceM <= Math.max(5000, spot.accuracyM * 3) ? [{ lat: near.place.lat, lng: near.place.lng, radiusM: near.place.radiusM }] : []),
      ]
    : [];
  const placeFrom = preview ? (preview.matched ?? preview.nearest) : null;
  const askingText =
    loc.phase !== 'asking'
      ? ''
      : loc.accuracy == null
        ? dev === 'computer'
          ? 'Asking this computer for its location. This takes a few seconds.'
          : 'Hold the phone still for a few seconds.'
        : loc.accuracy > me.maxAccuracyM
          ? `Accurate to about ${fmtM(loc.accuracy)} so far; waiting for ${me.maxAccuracyM} m or better. ${dev === 'computer' ? 'A computer finds itself from Wi-Fi, so it may not get closer than this.' : 'Stay near a window or step outside.'}`
          : `Accurate to about ${loc.accuracy} m so far. Hold still: a few more readings make it exact.`;
  const reasonOk = !preview?.reasonNeeded || reason.trim().length >= me.reasonMin;

  const submit = () =>
    act.run(async () => {
      if (!fix) throw new Error('Find your location first.');
      const r = await api.checkIn(kind, {
        lat: fix.lat,
        lng: fix.lng,
        accuracyM: fix.accuracyM,
        capturedAt: fromMs(Date.now()),
        reason: preview?.reasonNeeded || preview?.outcome === 'blocked' ? reason.trim() || null : null,
        face: photo?.face ?? null,
        noCamera: photo?.noCamera ?? null,
      });
      // P93: already checked in (or out) from another tab or phone, or a retry after a lost answer: shown as done.
      setResult({ at: r.event.at, text: whereText(r.event), already: !!r.already, clockId: r.clock?.id ?? r.event.clockId ?? null });
      setStep('done');
      clockChanged();
      return r;
    });

  const steps: { key: typeof step; label: string }[] = [
    { key: 'location', label: 'Location' },
    ...(needFace ? [{ key: 'face' as const, label: 'Face' }] : []),
    { key: 'confirm', label: 'Confirm' },
  ];
  const at = steps.findIndex((s) => s.key === step);
  const stepState = (i: number): StepState => (step === 'done' || i < at ? 'done' : i === at ? 'now' : 'todo');
  const next = () => setStep(needFace && step === 'location' ? 'face' : 'confirm');

  return (
    <Drawer title={kind === 'in' ? 'Check in' : 'Check out'} sub={m.companyName} onClose={onClose}>
      <Steps steps={steps.map((s, i) => ({ label: s.label, state: stepState(i) }))} />

      {step === 'location' && (
        <section className="ci-step" aria-live="polite">
          {api.mode === 'demo' && (
            <div className="field">
              <span className="label">Test only: where the phone is</span>
              <div className="seg ss-tabs" role="group" aria-label="Test only: where the phone is">
                {(
                  [
                    ['at', 'At the place'],
                    ['away', '2 km away'],
                    ['rough', 'Rough GPS'],
                    ['wifi', 'Computer (Wi-Fi only)'],
                    ['device', "This device's GPS"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} aria-pressed={test === k} onClick={() => setTest(k)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(loc.phase === 'idle' || (loc.phase === 'problem' && loc.problem !== 'denied')) && perm !== 'denied' && (
            <div className="ci-ask">
              <span className="ci-ask-icon" aria-hidden="true">
                <CrosshairIcon size={28} />
              </span>
              <p className="ci-ask-title">{loc.phase === 'problem' ? 'No location yet' : 'Enable location'}</p>
              <p className="ci-ask-sub">
                {loc.phase === 'problem'
                  ? locationProblemText(loc.problem, dev, here.os)
                  : perm === 'prompt' || perm === 'unknown'
                    ? 'Your browser will ask to use your location. Choose Allow (and Precise, if asked).'
                    : 'Finding where you are.'}
              </p>
              <button type="button" className="btn btn-primary" onClick={locate}>
                <CrosshairIcon size={18} aria-hidden="true" /> {loc.phase === 'problem' ? 'Try again' : 'Enable location'}
              </button>
              {loc.phase === 'problem' && dev === 'computer' && (loc.problem === 'unavailable' || loc.problem === 'timeout') && <PhoneHint />}
            </div>
          )}

          {(perm === 'denied' || (loc.phase === 'problem' && loc.problem === 'denied')) && loc.phase !== 'ready' && (
            <div className="ci-blocked">
              <p className="notice" data-tone="warn">
                {LOCATION_PROBLEM_TEXT.denied}
              </p>
              <PermissionHelp kind="location" />
              <button type="button" className="btn btn-primary" onClick={locate}>
                <ArrowClockwiseIcon size={18} aria-hidden="true" /> Try again
              </button>
            </div>
          )}

          {loc.phase === 'asking' && (
            <div className="ci-ask" data-busy="" data-compact={spot ? '' : undefined}>
              {!spot && <span className="ci-radar" aria-hidden="true" />}
              <p className="ci-ask-title">Finding your location…</p>
              <p className="ci-ask-sub">{askingText}</p>
              {loc.readings ? <p className="ss-note">{loc.readings === 1 ? '1 reading' : `${loc.readings} readings`} combined</p> : null}
            </div>
          )}

          {loc.phase === 'checking' && (
            <div className="ci-ask" data-busy="" data-compact={spot ? '' : undefined}>
              {!spot && <span className="ci-radar" aria-hidden="true" />}
              <p className="ci-ask-title">Checking your place…</p>
            </div>
          )}

          {loc.phase === 'rough' && (
            <p className="notice" data-tone="warn">
              {loc.text}
            </p>
          )}

          {loc.phase === 'ready' && preview && <Verdict preview={preview} kind={kind} />}

          {/* P122: one map from the first reading to the verdict: the live dot glides and its circle shrinks while
              searching, then the pin drops in with a pulsing ring and the map flies to the person and the nearest place. */}
          {spot && (
            <div className="ci-mapwrap">
              <Suspense fallback={<MapFallback />}>
                <GeoMap
                  label={searching ? 'Finding your location on the map' : 'Your location and the places you may check in at'}
                  height={260}
                  circles={places.map((t): MapCircle => ({ lat: t.lat, lng: t.lng, radiusM: t.radiusM, tone: 'primary', label: `${t.label} (${fmtM(t.radiusM)})` }))}
                  you={{ lat: spot.lat, lng: spot.lng, accuracyM: spot.accuracyM, tone: youTone, label: loc.phase === 'rough' ? 'You (rough guess)' : 'You' }}
                  youPin={loc.phase === 'checking' || loc.phase === 'ready'}
                  animatePoint
                  pulse
                  flyTo
                  follow={searching}
                  fitTo={fitTo}
                  fitKey={searching ? 'search' : `fix:${spot.lat},${spot.lng}`}
                />
              </Suspense>
              {searching && (
                <span className="ci-map-badge" data-tone={spot.accuracyM > me.maxAccuracyM ? 'warn' : 'ok'} aria-hidden="true">
                  ±{fmtM(spot.accuracyM)}
                </span>
              )}
            </div>
          )}

          {loc.phase === 'rough' && (
            <div className="ci-blocked">
              <ul className="ci-tips">
                {roughTips(dev, here.os).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              {dev === 'computer' && <PhoneHint />}
              <button type="button" className="btn btn-primary" onClick={locate}>
                <ArrowClockwiseIcon size={18} aria-hidden="true" /> Try again
              </button>
            </div>
          )}

          {loc.phase === 'ready' && preview && (
            <>
              <p className="ci-address">
                <MapPinIcon size={15} aria-hidden="true" />
                <span>
                  {`${addressText(preview)} · ±${fmtM(loc.fix.accuracyM)}${placeFrom ? ` · Nearest check-in place: ${placeFrom.label}, ${fmtM(placeFrom.distanceM)}` : ''}`}
                </span>
              </p>
              {preview.outcome === 'blocked' ? (
                <div className="ci-blocked">
                  <label className="field">
                    <span className="label">What happened (optional, for your manager)</span>
                    <textarea className="textarea" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <div className="row">
                    <button type="button" className="btn btn-primary" onClick={locate}>
                      <ArrowClockwiseIcon size={18} aria-hidden="true" /> Read my location again
                    </button>
                    <button type="button" className="btn" disabled={act.busy} onClick={() => void submit()}>
                      Record this attempt for my manager
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {preview.reasonNeeded && (
                    <label className="field">
                      <span className="label">Why are you checking {kind} here? (needed)</span>
                      <textarea
                        className="textarea"
                        value={reason}
                        maxLength={500}
                        placeholder="For example: meeting at the client's office in Kuantan"
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                  )}
                  <div className="row">
                    <button type="button" className="btn btn-primary" disabled={!reasonOk} onClick={next}>
                      Continue
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={locate}>
                      <ArrowClockwiseIcon size={16} aria-hidden="true" /> Read again
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          <ErrorNotice error={act.error} />
        </section>
      )}

      {step === 'face' && (
        <ClockPhotoStep
          kind={kind}
          reasonMin={me.snap?.reasonMin ?? 10}
          value={photo}
          onDone={(p) => (setPhoto(p), setStep('confirm'))}
          onBack={() => setStep('location')}
        />
      )}

      {step === 'confirm' && preview && fix && (
        <section className="ci-step">
          <dl className="k-facts">
            <div>
              <dt>{kind === 'in' ? 'Checking in' : 'Checking out'}</dt>
              <dd>{whereText(preview)}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{addressText(preview)}</dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>±{fix.accuracyM} m</dd>
            </div>
            {needFace && (
              <div>
                <dt>Face photo</dt>
                <dd>{photo?.face ? (photo.face.descriptor.length ? 'Photo taken, face found' : 'Photo taken') : photo?.noCamera ? `No camera: ${photo.noCamera.reason}` : 'Not taken: your manager or HR will see it is missing'}</dd>
              </div>
            )}
            {preview.reasonNeeded && (
              <div>
                <dt>Reason</dt>
                <dd>{reason.trim()}</dd>
              </div>
            )}
          </dl>
          <p className="ss-note">The server records its own time and checks the place again when you confirm.</p>
          <ErrorNotice error={act.error} />
          <div className="row">
            <button type="button" className="btn btn-primary ci-go" disabled={act.busy || !reasonOk} onClick={() => void submit()}>
              {kind === 'in' ? <SignInIcon size={18} aria-hidden="true" /> : <SignOutIcon size={18} aria-hidden="true" />}
              {act.busy ? 'Saving…' : kind === 'in' ? 'Check in now' : 'Check out now'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={act.busy} onClick={() => setStep(needFace ? 'face' : 'location')}>
              Back
            </button>
          </div>
        </section>
      )}

      {step === 'done' && result && (
        <section className="ci-step ci-done" aria-live="polite">
          <span className="ci-done-mark" aria-hidden="true">
            <CheckCircleIcon size={56} weight="fill" />
          </span>
          <p className="ci-ask-title">{kind === 'in' ? `Checked in at ${time(result.at)}` : `Checked out at ${time(result.at)}`}</p>
          <p className="ci-ask-sub">{result.already ? (kind === 'in' ? 'You were already checked in. Nothing more to do.' : 'You were already checked out. Nothing more to do.') : `You are ${result.text}.`}</p>
          {/* P97: at check-out, the shift's route from check-in to check-out, its distance and time on and off the place. */}
          {kind === 'out' && result.clockId && <ShiftSummary clockId={result.clockId} />}
          <button type="button" className="btn btn-primary" onClick={onDone}>
            Done
          </button>
        </section>
      )}
    </Drawer>
  );
}

function Verdict({ preview, kind }: { preview: CheckinPreview; kind: 'in' | 'out' }) {
  const out = preview.verdict === 'out_of_area';
  const tone = preview.outcome === 'blocked' ? 'crit' : out ? 'warn' : preview.verdict === 'no_place' ? 'info' : 'ok';
  const icon = preview.outcome === 'blocked' ? <ProhibitIcon size={22} /> : out ? <WarningCircleIcon size={22} /> : preview.outstation ? <AirplaneTiltIcon size={22} /> : <CheckCircleIcon size={22} />;
  const title =
    preview.outcome === 'blocked'
      ? 'Check-in refused outside your area'
      : out
        ? `You are ${fmtM(preview.nearest?.outsideByM ?? 0)} outside ${preview.nearest?.label ?? 'your area'}`
        : preview.verdict === 'no_place'
          ? 'No check-in place is set for you yet'
          : preview.outstation
            ? 'Outstation day: anywhere is allowed today'
            : `You are at ${preview.matched?.label}`;
  const sub =
    preview.outcome === 'blocked'
      ? `Your company does not allow check-ins outside your area. Move into it, or record this attempt so your manager can see it.`
      : out
        ? `You can still check ${kind} with a reason. It is flagged for your manager or HR to review.`
        : preview.verdict === 'no_place'
          ? 'Your location is still recorded for HR, who set your place.'
          : preview.outstation
            ? 'Your location is still recorded.'
            : `${fmtM(preview.matched?.distanceM ?? 0)} from the pin, within ${fmtM(preview.matched?.radiusM ?? 0)}.`;
  return (
    <div className="ci-verdict" data-tone={tone} role="status">
      <span className="ci-verdict-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="ci-verdict-title">{title}</p>
        <p className="ci-verdict-sub">{sub}</p>
      </div>
    </div>
  );
}

/** P97: the shift just checked out: its route on the map with the distance and time on and off the place. */
function ShiftSummary({ clockId }: { clockId: string }) {
  const { data, error } = useLoad(() => api.staffClockDetail(clockId), [clockId]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your route" />;
  if (!data.movement) return null;
  return (
    <div className="ci-summary">
      <p className="ci-tl-title">Your shift, from check-in to check-out</p>
      <MovementView m={data.movement} mapLabel="Your route from check-in to check-out" fitKey={`${clockId}:summary`} />
    </div>
  );
}
