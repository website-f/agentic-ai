/**
 * P90 (Fitri, 9 Nov 2026): the owner tests check-in and check-out and sees the movements between them. The owner has no
 * staff clock, so this is a separate TEST: its own record (never a clock, attendance, KPI, report or pay record), its own
 * route on the map, and a list of past tests. The server allows it for the owner only (owner-test-checkin.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { CrosshairIcon, FlaskIcon, MapPinIcon, PathIcon, SignInIcon, SignOutIcon, TimerIcon } from '@phosphor-icons/react';
import { fromMs, type OwnerTestPoint } from '@prima/core';
import { api, type MyTestCheckins, type TestCheckinFix } from '../api';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { LOCATION_PROBLEM_TEXT, locationProblem, type LocationProblem } from './checkin-permissions';
import { PermissionHelp } from './PermissionHelp';
import { fmtM } from './CheckIn';
import { MovementView } from './Movement';
import '../styles/checkin.css';

const time = (t: string) => t.slice(11, 16);
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`);
const minutesOf = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));

/** One reading from the phone: the best within a few seconds. Rejects with the reason it did not come. */
function readLocation(timeoutMs = 15_000): Promise<TestCheckinFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ problem: 'unsupported' as LocationProblem });
    let best: GeolocationPosition | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(id);
      window.clearTimeout(timer);
      if (!best) return reject({ problem: 'timeout' as LocationProblem });
      resolve({ lat: best.coords.latitude, lng: best.coords.longitude, accuracyM: Math.round(best.coords.accuracy), capturedAt: fromMs(best.timestamp) });
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
        if (best.coords.accuracy <= 30) finish();
      },
      (e) => {
        if (done) return;
        done = true;
        navigator.geolocation.clearWatch(id);
        window.clearTimeout(timer);
        reject({ problem: locationProblem(e) });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    const timer = window.setTimeout(finish, Math.min(timeoutMs, 8_000));
  });
}

/** Test version only: a walk around a point, so the route can be seen without a phone. */
function simulated(last: Pick<OwnerTestPoint, 'lat' | 'lng'> | null): TestCheckinFix {
  const base = last ?? { lat: 3.1478, lng: 101.6953 };
  const a = Math.random() * Math.PI * 2;
  const step = last ? 0.0006 + Math.random() * 0.0008 : 0;
  return { lat: base.lat + Math.sin(a) * step, lng: base.lng + Math.cos(a) * step, accuracyM: 6 + Math.round(Math.random() * 10), capturedAt: fromMs(Date.now()) };
}

/** Sends a reading every so often while the test is open and this screen is showing. */
function useTestTracker(open: boolean, everyS: number, onSent: () => void) {
  const sent = useRef(0);
  useEffect(() => {
    if (!open || api.mode === 'demo' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - sent.current < everyS * 1000) return;
        sent.current = Date.now();
        void api
          .testCheckin('ping', { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), capturedAt: fromMs(p.timestamp) })
          .then(onSent)
          .catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, everyS]);
}

export function OwnerTestCheckinView() {
  const { data, error, reload } = useLoad(() => api.myTestCheckins(), []);
  const act = useAction();
  const [problem, setProblem] = useState<LocationProblem | null>(null);
  const [finding, setFinding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, tick] = useState(0);
  const open = data?.open ?? null;
  useTestTracker(!!open, data?.pingEveryS ?? 15, reload);
  // The running time on the open test.
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [open]);

  if (error)
    return (
      <div className="page ss">
        <PageHead title="My clock" />
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page ss">
        <PageHead title="My clock" />
        <Loading what="your test check-ins" />
      </div>
    );

  const step = (kind: 'in' | 'ping' | 'out', success?: string) =>
    act.run(async () => {
      setProblem(null);
      let fix: TestCheckinFix;
      if (api.mode === 'demo') fix = simulated(kind === 'in' ? null : (open?.trail.at(-1) ?? null));
      else {
        setFinding(true);
        try {
          fix = await readLocation();
        } catch (e) {
          const p = (e as { problem?: LocationProblem }).problem ?? 'unavailable';
          setProblem(p);
          throw new Error(LOCATION_PROBLEM_TEXT[p]);
        } finally {
          setFinding(false);
        }
      }
      const r = await api.testCheckin(kind, fix);
      reload();
      return r;
    }, success);

  const nowIso = data.now;
  const opened_min = open ? minutesOf(open.startedAt, fromMs(Date.now())) : 0;
  const busyText = finding ? 'Finding your location…' : 'Saving…';

  return (
    <div className="page ss otc">
      <PageHead
        title="My clock"
        sub="Owners have no staff clock. Here you can test check-in and check-out and see your route between them. Tests are never attendance, never on the staff clock or reports, and never in pay."
      />

      <div className="otc-banner" role="note">
        <FlaskIcon size={20} weight="duotone" aria-hidden="true" />
        <span>
          <strong>Test only.</strong> Not attendance, not pay. Only you see your tests.
        </span>
      </div>

      <section className="ss-hero otc-hero" data-on={open ? '' : undefined} aria-label="Test check-in">
        <span className="ss-hero-icon" aria-hidden="true">
          {open ? <PathIcon size={26} /> : <MapPinIcon size={26} />}
        </span>
        <div className="ss-hero-main">
          <span className="ss-hero-kicker">Test check-in</span>
          <h2 className="ss-hero-title">
            {open ? (
              <>
                Checked in (test) since <span className="mono">{time(open.startedAt)}</span>
              </>
            ) : (
              'Not checked in'
            )}
          </h2>
          <span className="ss-hero-sub">
            {open ? (
              <>
                <span className="otc-figures">
                  {dur(opened_min)} · {open.trail.length} readings · {fmtM(open.distanceM)}
                </span>{' '}
                <span>Keep this screen open while you move: your location is read every few seconds.</span>
              </>
            ) : (
              'Check in, move around, then check out. Your route is drawn on the map.'
            )}
          </span>
        </div>
        <div className="ss-hero-side">
          <Chip tone={open ? 'ok' : 'neutral'}>{open ? 'Test running' : 'No test running'}</Chip>
        </div>
        <div className="ss-hero-more">
          <div className="row">
            {open ? (
              <>
                <button type="button" className="btn btn-primary ci-go" disabled={act.busy} onClick={() => void step('out', 'Test check-out saved.')}>
                  <SignOutIcon size={18} aria-hidden="true" /> {act.busy ? busyText : 'Check out (test)'}
                </button>
                <button type="button" className="btn" disabled={act.busy} onClick={() => void step('ping')}>
                  <CrosshairIcon size={16} aria-hidden="true" /> {api.mode === 'demo' ? 'Test only: move and send a reading' : 'Send my location now'}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary ci-go" disabled={act.busy} onClick={() => void step('in', 'Test check-in saved.')}>
                <SignInIcon size={18} aria-hidden="true" /> {act.busy ? busyText : 'Check in (test)'}
              </button>
            )}
          </div>
          {problem === 'denied' && <PermissionHelp kind="location" />}
          <ErrorNotice error={act.error} />
        </div>
      </section>

      {/* P93: the same movement reading as a staff clock: distance without GPS wobble, time inside and outside the office. */}
      {open && (
        <Card title="Your route so far" sub={`From ${time(open.startedAt)} · ${fmtM(open.distanceM)}`}>
          <MovementView m={open.movement} mapLabel="Your route since the test check-in" fitKey={`${open.id}:${open.trail.length}`} />
        </Card>
      )}

      <Card title="My test check-ins" sub="Each test, from check-in to check-out. Tap one to see the movements." flush>
        {data.sessions.length === 0 ? (
          <Empty title="No tests yet. Check in (test) above to start one." />
        ) : (
          <ul className="ss-rows otc-list">
            {data.sessions.map((s) => {
              const mins = minutesOf(s.startedAt, s.endedAt ?? nowIso);
              return (
                <li key={s.id}>
                  <button type="button" className="ss-row" onClick={() => setOpenId(s.id)}>
                    <span className="ss-row-main">
                      <span className="ss-row-title">{dateTimeLabel(s.startedAt).replace(/,? \d\d:\d\d$/, '')}</span>
                      <span className="ss-times-line ss-meta">
                        <span>
                          <SignInIcon size={14} aria-hidden="true" />
                          In {time(s.startedAt)}
                        </span>
                        <span>
                          <SignOutIcon size={14} aria-hidden="true" />
                          {s.endedAt ? <>Out {time(s.endedAt)}</> : 'Still in'}
                        </span>
                        <span>
                          <TimerIcon size={14} aria-hidden="true" />
                          {dur(mins)}
                        </span>
                        <span>
                          <PathIcon size={14} aria-hidden="true" />
                          {fmtM(s.distanceM)} · {s.trail.length} readings
                        </span>
                      </span>
                    </span>
                    <Chip tone={s.endedAt ? (s.autoEnded ? 'warn' : 'neutral') : 'ok'}>
                      {s.endedAt ? (s.autoEnded ? 'Closed by Prima' : s.endedBy === 'sign_out' ? 'Ended at sign-out' : 'Test') : 'Running'}
                    </Chip>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {openId && <TestSession s={data.sessions.find((x) => x.id === openId) ?? null} now={nowIso} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** One test: the route on the map and every reading from check-in to check-out. */
function TestSession({ s, now, onClose }: { s: MyTestCheckins['sessions'][number] | null; now: string; onClose: () => void }) {
  if (!s) return null;
  const mins = minutesOf(s.startedAt, s.endedAt ?? now);
  const rows = s.trail.map((p, i) => ({ p, first: i === 0, last: !!s.out && i === s.trail.length - 1 }));
  return (
    <Drawer title="Test check-in" sub={`${dateTimeLabel(s.startedAt)} · Test only, never attendance or pay`} onClose={onClose}>
      <Stats>
        <Stat label="Check-in" value={time(s.startedAt)} icon={<SignInIcon size={16} />} />
        <Stat label="Check-out" value={s.endedAt ? time(s.endedAt) : 'Still in'} icon={<SignOutIcon size={16} />} />
        <Stat label="Time" value={dur(mins)} icon={<TimerIcon size={16} />} />
      </Stats>
      <MovementView m={s.movement} mapLabel="The route from check-in to check-out" fitKey={s.id} />
      {s.autoEnded && <p className="notice small" data-tone="warn">This test was left open, so Prima closed it at its last reading when the next test started.</p>}
      {s.endedBy === 'sign_out' && <p className="notice small" data-tone="info">You signed out of Prima during this test, so it ended at its last reading.</p>}
      <ol className="ci-timeline otc-timeline" aria-label="Movements">
        {rows.map(({ p, first, last }, i) => (
          <li key={`${p.at}-${i}`} data-outcome={first || last ? 'accepted' : undefined}>
            <span className="ci-tl-time">{p.at.slice(11, 19)}</span>
            <span className="ci-tl-main">
              <span className="ci-tl-title">{first ? 'Check-in (test)' : last ? 'Check-out (test)' : <>Reading {i}</>}</span>
              <span className="ci-tl-sub">
                {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                {p.accuracyM != null ? ` · ±${p.accuracyM} m` : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {s.trail.length >= 400 && <p className="ss-note">Long routes are shown with 400 evenly spaced readings; the record keeps them all.</p>}
      <button type="button" className="btn" onClick={onClose}>
        Close
      </button>
    </Drawer>
  );
}
