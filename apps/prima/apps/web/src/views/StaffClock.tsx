import { useEffect, useState } from 'react';
import { fromMs, type StaffClockFlag } from '@prima/core';
import { api, type MyStaffClock, type StaffClockBoard } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { gps, type Fix } from './Camera';
import { MyRemoteSection, RemoteBoardView } from './Remote';
import { FaceCapture } from './FaceCheck';
import { FlexPanel } from './HrLeave';
import { OfficeOshPanel } from './HrOsh';
import { AppraisalsPanel, PoliciesPanel, TrainingPanel } from './HrDevelop';
import { HrGuide } from './HrGuide';
import { useApp } from '../App';

const FLAG_LABEL: Record<StaffClockFlag, string> = {
  NO_GPS: 'No location',
  AWAY_FROM_BASE: 'Away from base',
  FACE_NOT_MATCHED: 'Face not matched',
  NO_LIVENESS: 'Photo of a photo?',
  PHOTO_ONLY: 'Photo, no face match',
  PHONE_TIME_OFF: 'Phone time off',
  NO_SIGN_OUT: 'Did not sign out',
  LEFT_BEFORE_SIGN_OUT: 'Left the office before signing out',
  FACE_PENDING: 'Face check not done',
};
const FLAG_TONE: Partial<Record<StaffClockFlag, Tone>> = { PHOTO_ONLY: 'neutral', NO_GPS: 'warn', AWAY_FROM_BASE: 'warn' };
const LOCATION: Record<'tracked' | 'away' | 'unknown' | 'off' | 'desk' | 'remote', { label: string; tone: Tone }> = {
  remote: { label: 'Working from home', tone: 'info' },
  desk: { label: 'Signed in, location not followed', tone: 'neutral' },
  tracked: { label: 'Location followed', tone: 'ok' },
  away: { label: 'Away from base', tone: 'warn' },
  unknown: { label: 'Location unknown', tone: 'unknown' },
  off: { label: 'Not clocked in', tone: 'neutral' },
};
const time = (t: string) => t.slice(11, 16);
/** '08:30' as 8.30 am, the way staff say it. */
const hm = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}.${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`);

type TestPlace = 'base' | 'away' | 'none' | 'gps';

/** The phone's place for the test version; the installed app reads the phone's GPS. */
async function placeFix(where: TestPlace, base: MyStaffClock['base']): Promise<Fix> {
  const b = base ?? { lat: 3.139, lng: 101.6869 };
  if (where === 'base') return { lat: b.lat + 0.0001, lng: b.lng - 0.0001, accuracyM: 9 };
  if (where === 'away') return { lat: b.lat + 0.0135, lng: b.lng, accuracyM: 14 };
  if (where === 'none') return { lat: null, lng: null, accuracyM: null };
  return gps();
}

/**
 * Staff are clocked in when they sign in and out when they sign out, idle or asleep in between (Fauzan, 27 Oct 2026).
 * Location is followed only while clocked in, when the device sends it. Guards clock on the site device.
 */
export function MyClockView() {
  const { data, error, reload } = useLoad(() => api.myStaffClock(), []);
  const [where, setWhere] = useState<TestPlace>(api.mode === 'demo' ? 'base' : 'gps');
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your clock" />;
  if (!data.allowed)
    return (
      <div className="page">
        <p className="muted">Guards clock in by face on the site device.</p>
      </div>
    );
  const open = data.open;
  const loc = LOCATION[data.state];
  const ping = async () => {
    const f = await placeFix(where, data.base);
    if (f.lat === null) throw new Error('The phone gave no location.');
    const r = (await api.staffPing({ lat: f.lat, lng: f.lng!, accuracyM: f.accuracyM, capturedAt: fromMs(Date.now()) })) as {
      accepted: boolean;
      remote?: boolean;
    };
    if (!r.accepted && r.remote) throw new Error('Home day: the place was checked once at the start of the day. No more readings are taken.');
    if (!r.accepted) throw new Error('A reading was taken less than a minute ago. Try again in a minute.');
    return r;
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My clock</h1>
          <p>
            You are clocked in when you sign in to Prima and clocked out when you sign out. Nothing to press: the clock keeps running while your laptop or PC is
            idle or asleep. If the device sends its location, it is recorded about every {data.pingEveryMin} minutes while you are clocked in, and never after.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{open ? `Clocked in since ${time(open.in.receivedAt)}` : 'Not clocked in'}</h3>
            {open?.mode === 'login' && <div className="small">Started at sign-in. Sign out properly at the end of the day to clock out.</div>}
            <div className="muted small">
              {data.base ? `Base: ${data.base.name}, within ${data.base.radiusM} m` : 'No fixed base: your route is recorded, not checked against a place'}
            </div>
          </div>
          <Chip tone={loc.tone}>{loc.label}</Chip>
        </div>
        {open && (
          <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>
              {open.pings} location reading{open.pings === 1 ? '' : 's'}
              {open.lastPingAt ? `, last at ${time(open.lastPingAt)}` : ''}.
            </div>
            {data.state === 'unknown' && (
              <div className="notice" data-tone="warn">
                No location for over {data.gapMin} minutes. Keep the app open with location allowed. Your manager sees this as Unknown.
              </div>
            )}
            {open.flags.length > 0 && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {open.flags.map((f) => (
                  <Chip key={f} tone={FLAG_TONE[f] ?? 'crit'}>
                    {FLAG_LABEL[f]}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
        {api.mode === 'demo' && (
          <div className="field" style={{ marginTop: 8 }}>
            <span className="label">Test only: where the phone is</span>
            <div className="seg" style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
              <button aria-pressed={where === 'base'} onClick={() => setWhere('base')}>
                At base
              </button>
              <button aria-pressed={where === 'away'} onClick={() => setWhere('away')}>
                1.5 km away
              </button>
              <button aria-pressed={where === 'none'} onClick={() => setWhere('none')}>
                GPS off
              </button>
              <button aria-pressed={where === 'gps'} onClick={() => setWhere('gps')}>
                This phone's GPS
              </button>
            </div>
          </div>
        )}
        {open && api.mode === 'demo' && (
          <button
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            disabled={act.busy}
            onClick={async () => {
              const r = await act.run(ping, 'Location sent.');
              if (r) reload();
            }}
          >
            Test only: send a location reading now
          </button>
        )}
        <ErrorNotice error={act.error} />
      </section>
      <MyFacePanel faceEnrolled={data.faceEnrolled} pending={!!open?.flags.includes('FACE_PENDING')} />
      <MyRemoteSection />
      <FlexPanel />
      <OfficeOshPanel coordinatorOnly />
      <PoliciesPanel mine />
      <AppraisalsPanel mine />
      <TrainingPanel mine />
      <HrGuide staffSide />
      <section className="panel">
        <h3>Last 7 days</h3>
        <div className="list">
          {data.recent.length === 0 && <div className="empty">No clock records yet.</div>}
          {data.recent.map((c) => (
            <div key={c.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{dateTimeLabel(c.in.receivedAt).replace(/,? \d\d:\d\d$/, '')}</div>
                <div className="muted small">
                  In {time(c.in.receivedAt)} · {c.out ? `out ${time(c.out.receivedAt)}` : 'still in'} · {c.pings} readings
                </div>
              </div>
              {c.flags.filter((f) => f !== 'PHOTO_ONLY').length > 0 ? (
                <Chip tone="warn">
                  {c.flags
                    .filter((f) => f !== 'PHOTO_ONLY')
                    .map((f) => FLAG_LABEL[f])
                    .join(', ')}
                </Chip>
              ) : (
                <Chip tone="ok">OK</Chip>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Sends a location reading while the staff member is clocked in, on the installed app. A web app only reads the
 * location while it is open; following a closed phone needs the native app wrapper (production).
 */
export function StaffTracker() {
  useEffect(() => {
    if (api.mode === 'demo' || !navigator.geolocation) return;
    let watch: number | null = null;
    let last = 0;
    let everyMs = 10 * 60_000;
    let stopped = false;
    const start = async () => {
      const mine = await api.myStaffClock().catch(() => null);
      if (stopped || !mine?.open) return;
      everyMs = mine.pingEveryMin * 60_000;
      watch = navigator.geolocation.watchPosition(
        (p) => {
          if (Date.now() - last < everyMs) return;
          last = Date.now();
          void api
            .staffPing({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), capturedAt: fromMs(p.timestamp) })
            .then((r) => {
              // A home day takes one reading at the start and no more (rule HR-WFH-PLACE).
              if ((r as { remote?: boolean }).remote && watch !== null) {
                navigator.geolocation.clearWatch(watch);
                stopped = true;
              }
            })
            .catch(() => undefined);
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 60_000 },
      );
    };
    void start();
    const t = setInterval(() => {
      if (watch === null) void start();
    }, 5 * 60_000);
    return () => {
      stopped = true;
      clearInterval(t);
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    };
  }, []);
  return null;
}

type Row = StaffClockBoard['rows'][number];

/** Who of the staff is clocked in and where, for the company manager, central HR and top management. */
export function StaffClockBoardView() {
  const { data, error } = useLoad(() => api.staffClockBoard(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<'clock' | 'home'>('clock');
  const [filter, setFilter] = useState<'all' | 'in' | 'problem' | 'not_in'>('all');
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="staff clock" />
      </div>
    );
  const problem = (r: Row) =>
    !!r.hours?.late ||
    !!r.hours?.early ||
    !!r.hours?.longBreak ||
    r.location === 'unknown' || r.location === 'away' || (r.status === 'in' && r.door.left) || (r.clock?.flags ?? []).some((f) => f !== 'PHOTO_ONLY');
  const rows = data.rows.filter((r) => filter === 'all' || (filter === 'in' ? r.status === 'in' : filter === 'not_in' ? r.status === 'not_in' : problem(r)));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Staff clock</h1>
          <p>
            Staff clock in and out on their own phones with face or a time-stamped photo. Location is recorded only from clock-in to clock-out. No reading for{' '}
            {data.gapMin} minutes shows as Unknown, never as fine. The office door readings, monitored by CMS, show who left the office while still signed in.
          </p>
          <p>
            Working hours {hm(data.hours.start)} to {hm(data.hours.end)}, with a {data.hours.breakMin}-minute break taken at any time. A first clock-in after{' '}
            {hm(data.hours.start)}, a clock-out before {hm(data.hours.end)} and a break over {data.hours.breakMin} minutes are flagged for a look.
          </p>
          {data.viewOnly && <p className="notice">You see your IT team's clock, view only.</p>}
        </div>
      </div>
      <FaceReviewsPanel />
      <div className="seg" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
        <button aria-pressed={tab === 'clock'} onClick={() => setTab('clock')}>
          Clock today
        </button>
        <button aria-pressed={tab === 'home'} onClick={() => setTab('home')}>
          Working from home
        </button>
      </div>
      {tab === 'home' ? (
        <RemoteBoardView />
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Clocked in now" value={data.rows.filter((r) => r.status === 'in').length} />
            <Kpi
              label="Location unknown"
              value={data.rows.filter((r) => r.location === 'unknown').length}
              tone={data.rows.some((r) => r.location === 'unknown') ? 'unknown' : 'ok'}
            />
            <Kpi
              label="Away from base"
              value={data.rows.filter((r) => r.location === 'away').length}
              tone={data.rows.some((r) => r.location === 'away') ? 'warn' : 'ok'}
            />
            <Kpi label="Not clocked in today" value={data.rows.filter((r) => r.status === 'not_in').length} />
            <Kpi label="Late in" value={data.late} tone={data.late ? 'warn' : 'ok'} />
            <Kpi label="Break over 1 hour" value={data.longBreak} tone={data.longBreak ? 'warn' : 'ok'} />
            <Kpi label="Left the office, still signed in" value={data.leftStillSignedIn} tone={data.leftStillSignedIn ? 'warn' : 'ok'} />
          </div>
          {!data.doorFeed && (
            <p className="notice" data-tone="unknown">
              No office door readings for this day: the door check is unknown, not passed.
            </p>
          )}
          <div className="seg" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['all', 'All'],
                ['in', 'Clocked in'],
                ['problem', 'Needs a look'],
                ['not_in', 'Not clocked in'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          <section className="panel">
            <div className="list">
              {rows.length === 0 && <div className="empty">Nobody here.</div>}
              {rows.map((r) => (
                <button
                  key={r.userId}
                  className="list-item list-button"
                  style={{ alignItems: 'flex-start' }}
                  disabled={!r.clock}
                  onClick={() => r.clock && setOpen(r.clock.id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="muted small">{r.title.includes(r.company.split(' ')[0]) ? r.title : `${r.title} · ${r.company}`}</div>
                    <div className="muted small">
                      {r.clock ? `In ${time(r.clock.in.receivedAt)}${r.clock.out ? `, out ${time(r.clock.out.receivedAt)}` : ''}` : 'Not clocked in today'}
                      {r.last ? ` · last reading ${time(r.last.at)}${r.last.distanceM !== null ? `, ${fmtDistance(r.last.distanceM)} from base` : ''}` : ''}
                    </div>
                    {r.hours && (
                      <div className="muted small">
                        First in {time(r.hours.firstIn)}
                        {r.hours.lastOut && r.status === 'out' ? `, last out ${time(r.hours.lastOut)}` : ''} · worked {dur(r.hours.workedMin)} · break {dur(r.hours.breakMin)}
                      </div>
                    )}
                    {r.hours && (r.hours.late || (r.hours.early && r.status === 'out') || r.hours.longBreak) && (
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {r.hours.late && <Chip tone="warn">Late {dur(r.hours.lateMin)}</Chip>}
                        {r.hours.early && r.status === 'out' && <Chip tone="warn">Left before {hm(r.hours.end)}</Chip>}
                        {r.hours.longBreak && <Chip tone="warn">Break over 1 hour</Chip>}
                      </div>
                    )}
                    {(r.door.firstIn || r.door.lastOut) && (
                      <div className="muted small">
                        Door: {r.door.firstIn ? `in ${time(r.door.firstIn)}` : 'no entry'}
                        {r.door.lastOut ? `, left ${time(r.door.lastOut)}` : ''}
                      </div>
                    )}
                    {r.status === 'in' && r.door.left && (
                      <div className="row" style={{ gap: 4, marginTop: 4 }}>
                        <Chip tone="warn">Left the office, still signed in</Chip>
                      </div>
                    )}
                    {r.clock && r.clock.flags.some((f) => f !== 'PHOTO_ONLY') && (
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {r.clock.flags
                          .filter((f) => f !== 'PHOTO_ONLY')
                          .map((f) => (
                            <Chip key={f} tone={FLAG_TONE[f] ?? 'crit'}>
                              {FLAG_LABEL[f]}
                            </Chip>
                          ))}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {r.status === 'in' ? (
                      <Chip tone={LOCATION[r.location].tone}>{LOCATION[r.location].label}</Chip>
                    ) : r.status === 'out' ? (
                      <Chip tone="neutral">Clocked out</Chip>
                    ) : (
                      <Chip tone="neutral">Not in</Chip>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
          <p className="muted small">
            Location and face are personal data, and face is biometric data under the PDPA. Staff must be told in writing what is recorded and why before this
            goes live.
          </p>
        </>
      )}
      {open && <ClockDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function fmtDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function ClockDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api.staffClockDetail(id), [id]);
  return (
    <Drawer title={data ? data.clock.userName : 'Clock record'} sub={data ? `${dateTimeLabel(data.clock.in.receivedAt)}` : undefined} onClose={onClose}>
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="clock record" />}
      {data && (
        <>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            <Chip tone={LOCATION[data.state].tone}>{data.clock.out ? 'Clocked out' : LOCATION[data.state].label}</Chip>
            {data.clock.flags.map((f) => (
              <Chip key={f} tone={FLAG_TONE[f] ?? 'crit'}>
                {FLAG_LABEL[f]}
              </Chip>
            ))}
          </div>
          {data.clock.faceCheck && (
            <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <div className="label">Face check after sign-in (spot-check: the phone does the matching)</div>
              <img src={data.clock.faceCheck.image} alt="Face check photo" style={{ maxWidth: 240, borderRadius: 8 }} />
              <span>
                {time(data.clock.faceCheck.receivedAt)} server time · match {data.clock.faceCheck.face ? `${Math.round(data.clock.faceCheck.face.score * 100)}%` : 'none'}
                {data.clock.faceCheck.face && !data.clock.faceCheck.face.live ? ' · face did not move' : ''}
              </span>
            </div>
          )}
          <div className="grid-2">
            {(['in', 'out'] as const).map((k) => {
              const s = data.clock[k];
              return (
                <div key={k}>
                  <div className="label">{k === 'in' ? 'Clock in' : 'Clock out'}</div>
                  {!s ? (
                    <div className="small muted">Not yet</div>
                  ) : (
                    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {s.image ? (
                        <img src={s.image} alt={`${k} photo`} style={{ width: '100%', borderRadius: 8 }} />
                      ) : (
                        <span className="muted">
                          {s.source === 'door'
                            ? 'Not signed out: closed at the last office door exit'
                            : s.source === 'login'
                              ? k === 'in'
                                ? 'At sign-in, no photo'
                                : 'At sign-out, no photo'
                              : 'Test record, no photo'}
                        </span>
                      )}
                      <span>
                        {time(s.receivedAt)} server time{s.lat !== null ? ` · ${s.lat.toFixed(5)}, ${s.lng!.toFixed(5)}` : ' · no location'}
                      </span>
                      {s.distanceM !== null && <span className="muted">{fmtDistance(s.distanceM)} from base</span>}
                      <span className="mono muted">SHA-256 {s.sha256.slice(0, 12)}…</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <section>
            <h3>Location while clocked in</h3>
            <p className="muted small">
              {data.base ? `Base: ${data.base.name}, within ${data.base.radiusM} m.` : 'No fixed base; the route is recorded, not checked.'}
            </p>
            {data.gaps.map((g) => (
              <div key={g.from} className="notice" data-tone="warn" style={{ marginBottom: 6 }}>
                No location from {time(g.from)} to {data.clock.out || g.to < data.clock.in.receivedAt ? time(g.to) : 'now'} ({g.minutes} minutes): Unknown.
              </div>
            ))}
            <div className="list">
              {data.pings.length === 0 && <div className="empty">No readings yet.</div>}
              {data.pings
                .slice()
                .reverse()
                .slice(0, 30)
                .map((p) => (
                  <div key={p.id} className="list-item small">
                    <span className="mono">{time(p.receivedAt)}</span>
                    <span>
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                      {p.accuracyM !== null ? ` ±${p.accuracyM} m` : ''}
                    </span>
                    <span className="muted">{p.distanceM !== null ? fmtDistance(p.distanceM) : ''}</span>
                  </div>
                ))}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

/**
 * Face recognition for clock in (Fauzan, 2 Nov 2026; free engine on the phone). Register once, HR approves the photo,
 * then each sign-in asks for a quick face check. The photo is kept for HR to spot-check.
 */
function MyFacePanel({ faceEnrolled, pending }: { faceEnrolled: boolean; pending: boolean }) {
  const mine = useLoad(() => api.myFace(), []);
  const act = useAction();
  const f = mine.data;
  if (!f) return null;
  return (
    <section className="panel">
      <h3>Face recognition</h3>
      {faceEnrolled && pending && (
        <>
          <p className="small">You are clocked in from your sign-in. Confirm it is you with a quick face check.</p>
          <FaceCapture
            label="Check my face"
            busy={act.busy}
            onCapture={(r) =>
              void act.run(
                () =>
                  api.staffFaceCheck({
                    image: r.photo,
                    capturedAt: new Date().toISOString(),
                    lat: null,
                    lng: null,
                    accuracyM: null,
                    face: { score: 0, live: r.live },
                    descriptor: r.descriptor,
                  }),
                'Face checked.',
              )
            }
          />
        </>
      )}
      {faceEnrolled && !pending && <p className="muted small">Your face is registered. Each sign-in asks for a quick face check.</p>}
      {!faceEnrolled && f.status === 'pending' && <p className="small">Your face is registered and waiting for HR to approve it. Until then you clock in with a photo.</p>}
      {!faceEnrolled && (f.status === 'none' || f.status === 'refused') && (
        <>
          {f.status === 'refused' && f.note && (
            <div className="notice small" data-tone="warn">
              HR: {f.note}
            </div>
          )}
          <p className="small">Register your face once. HR looks at the photo and approves it; after that each sign-in asks for a quick face check.</p>
          <FaceCapture
            label="Register my face"
            busy={act.busy}
            onCapture={(r) => void act.run(() => api.registerFace({ photo: r.photo, descriptor: r.descriptor }), 'Sent to HR to approve.').then(() => mine.reload())}
          />
        </>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** HR approves each registered face after looking at the photo, with a comment. Nobody approves their own. */
function FaceReviewsPanel() {
  const { me } = useApp();
  const u = me.user;
  const reviews = (u.role === 'pwvsb_officer' && u.department === 'hr') || u.leadership === 'cos' || u.leadership === 'deputy_cos';
  const list = useLoad(() => (reviews ? api.faceReviews() : Promise.resolve(null)), [reviews]);
  const [note, setNote] = useState<Record<string, string>>({});
  const act = useAction();
  if (!reviews || !list.data || list.data.pending.length === 0) return null;
  return (
    <section className="panel">
      <h3>Faces waiting for HR ({list.data.pending.length})</h3>
      <p className="muted small">Check the photo is the staff member before approving. The phone does the matching, so spot-check clock-in photos too.</p>
      <div className="list">
        {list.data.pending.map((r) => (
          <div key={r.personId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div style={{ fontWeight: 600 }}>
              {r.name} {r.staffNo ? `(${r.staffNo})` : ''} {r.jobTitle ? `· ${r.jobTitle}` : ''}
            </div>
            {r.photo && <img src={r.photo} alt={`Face registered by ${r.name}`} style={{ maxWidth: 200, borderRadius: 6 }} />}
            {r.own ? (
              <div className="muted small">Your own face: someone else in HR approves it.</div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Comment (needed)"
                  aria-label={`Comment for ${r.name}`}
                  value={note[r.personId] ?? ''}
                  onChange={(e) => setNote((x) => ({ ...x, [r.personId]: e.target.value }))}
                />
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn btn-primary"
                    disabled={act.busy || !(note[r.personId] ?? '').trim()}
                    onClick={() => void act.run(() => api.decideFace(r.personId, true, note[r.personId] ?? ''), 'Face approved.').then(() => list.reload())}
                  >
                    Approve
                  </button>
                  <button
                    className="btn"
                    disabled={act.busy || !(note[r.personId] ?? '').trim()}
                    onClick={() => void act.run(() => api.decideFace(r.personId, false, note[r.personId] ?? ''), 'Face refused.').then(() => list.reload())}
                  >
                    Refuse
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}
