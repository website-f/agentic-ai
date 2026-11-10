/**
 * P81 (staff check-in by place, 6 Nov 2026): the staff member's own check-in and check-out. Steps: allow location (with
 * help when the browser blocked it), a reading accurate to 100 m or better, the server's verdict on a map, the face check
 * when the clock waits for one, then confirm. The server decides in or out of the area; the screen only shows it.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  AirplaneTiltIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CrosshairIcon,
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
import { LOCATION_PROBLEM_TEXT, locationProblem, queryPermission, type LocationProblem, type PermState } from './checkin-permissions';
import type { MapCircle, MapPoint } from './GeoMap';
import { clockChanged } from './StaffTracker';
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
  | { phase: 'asking'; accuracy: number | null }
  | { phase: 'problem'; problem: LocationProblem }
  | { phase: 'rough'; fix: Fix; text: string }
  | { phase: 'checking'; fix: Fix }
  | { phase: 'ready'; fix: Fix; preview: CheckinPreview };
type TestPlace = 'at' | 'away' | 'rough' | 'device';

/** Readings better than this are taken at once; otherwise the best in a few seconds. */
const GOOD_M = 25;
const WAIT_MS = 12_000;
/**
 * P93: when the best after WAIT_MS is still too rough, keep looking (the phone's GPS often needs half a minute indoors)
 * and show how close it is, instead of failing; only after this long is the person asked to move and try again.
 */
const LONG_WAIT_MS = 45_000;

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
    return { lat: t.lat, lng: t.lng, accuracyM: 240 };
  };

  const locate = () => {
    stopWatch.current();
    if (api.mode === 'demo' && test !== 'device') return void check(testFix());
    if (!navigator.geolocation) return setLoc({ phase: 'problem', problem: 'unsupported' });
    setLoc({ phase: 'asking', accuracy: null });
    let best: GeolocationPosition | null = null;
    let done = false;
    let longTimer = 0;
    const finish = (final = false) => {
      if (done) return;
      // Nothing usable yet: keep waiting a while longer, showing the accuracy so far.
      if (!final && (!best || best.coords.accuracy > me.maxAccuracyM)) {
        longTimer = window.setTimeout(() => finish(true), LONG_WAIT_MS - WAIT_MS);
        return;
      }
      done = true;
      stopWatch.current();
      if (!best) return setLoc({ phase: 'problem', problem: 'timeout' });
      const fix = { lat: best.coords.latitude, lng: best.coords.longitude, accuracyM: Math.round(best.coords.accuracy) };
      // Rough readings are never sent as a check-in: the person tries again (the server refuses them too).
      if (fix.accuracyM > me.maxAccuracyM)
        return setLoc({ phase: 'rough', fix, text: `Your location is only accurate to about ${fix.accuracyM} m; it must be within ${me.maxAccuracyM} m.` });
      void check(fix);
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPerm('granted');
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
        setLoc({ phase: 'asking', accuracy: Math.round(best.coords.accuracy) });
        if (best.coords.accuracy <= GOOD_M) finish(true);
        // Already waited the first few seconds and this one is usable: take it.
        else if (longTimer && best.coords.accuracy <= me.maxAccuracyM) finish(true);
      },
      (err) => {
        const problem = locationProblem(err);
        // P93: a slow phone that already gave a reading: use the best one so far instead of failing.
        if (problem !== 'denied' && best) return finish(true);
        done = true;
        stopWatch.current();
        if (problem === 'denied') setPerm('denied');
        setLoc({ phase: 'problem', problem });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: LONG_WAIT_MS },
    );
    const timer = window.setTimeout(() => finish(), WAIT_MS);
    stopWatch.current = () => {
      navigator.geolocation.clearWatch(id);
      window.clearTimeout(timer);
      window.clearTimeout(longTimer);
    };
  };

  // Already allowed: start finding the location at once.
  useEffect(() => {
    if (perm === 'granted' && loc.phase === 'idle') locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm]);

  const preview = loc.phase === 'ready' ? loc.preview : null;
  const fix = loc.phase === 'ready' || loc.phase === 'rough' || loc.phase === 'checking' ? loc.fix : null;
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
                  ? LOCATION_PROBLEM_TEXT[loc.problem]
                  : perm === 'prompt' || perm === 'unknown'
                    ? 'Your browser will ask to use your location. Choose Allow (and Precise, if asked).'
                    : 'Finding where you are.'}
              </p>
              <button type="button" className="btn btn-primary" onClick={locate}>
                <CrosshairIcon size={18} aria-hidden="true" /> {loc.phase === 'problem' ? 'Try again' : 'Enable location'}
              </button>
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
            <div className="ci-ask" data-busy="">
              <span className="ci-radar" aria-hidden="true" />
              <p className="ci-ask-title">Finding your location…</p>
              <p className="ci-ask-sub">
                {loc.accuracy == null
                  ? 'Hold the phone still for a few seconds.'
                  : loc.accuracy > me.maxAccuracyM
                    ? `Accurate to about ${loc.accuracy} m so far; waiting for ${me.maxAccuracyM} m or better. Stay near a window or step outside.`
                    : `Accurate to about ${loc.accuracy} m so far.`}
              </p>
            </div>
          )}

          {loc.phase === 'checking' && (
            <div className="ci-ask" data-busy="">
              <span className="ci-radar" aria-hidden="true" />
              <p className="ci-ask-title">Checking your place…</p>
            </div>
          )}

          {loc.phase === 'rough' && (
            <div className="ci-blocked">
              <p className="notice" data-tone="warn">
                {loc.text}
              </p>
              <ul className="ci-tips">
                <li>Step near a window or outside, away from tall buildings.</li>
                <li>Turn on precise location (iPhone: Precise Location; Android: Location accuracy).</li>
                <li>Turn on Wi-Fi: it helps the phone find itself, even without connecting.</li>
              </ul>
              <button type="button" className="btn btn-primary" onClick={locate}>
                <ArrowClockwiseIcon size={18} aria-hidden="true" /> Try again
              </button>
            </div>
          )}

          {loc.phase === 'ready' && preview && (
            <>
              <Verdict preview={preview} kind={kind} />
              <Suspense fallback={<MapFallback />}>
                <GeoMap
                  label="Your location and the places you may check in at"
                  height={260}
                  circles={preview.targets.map((t): MapCircle => ({ lat: t.lat, lng: t.lng, radiusM: t.radiusM, tone: 'primary', label: `${t.label} (${fmtM(t.radiusM)})` }))}
                  points={[{ lat: loc.fix.lat, lng: loc.fix.lng, accuracyM: loc.fix.accuracyM, tone: preview.verdict === 'out_of_area' ? 'warn' : 'ok', label: 'You' } satisfies MapPoint]}
                  fitKey={`${loc.fix.lat},${loc.fix.lng}`}
                />
              </Suspense>
              <p className="ci-address">
                <MapPinIcon size={15} aria-hidden="true" /> {addressText(preview)} · ±{loc.fix.accuracyM} m
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
