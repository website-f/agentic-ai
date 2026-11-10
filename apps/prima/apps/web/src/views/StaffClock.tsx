import { useState } from 'react';
import {
  BroadcastIcon,
  ClockIcon,
  CoffeeIcon,
  DoorOpenIcon,
  MapPinIcon,
  QuestionIcon,
  SignInIcon,
  SignOutIcon,
  TimerIcon,
  UserCheckIcon,
  UserMinusIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { checkinScope, fromMs, isOwnerAdmin, type CheckinEvent, type StaffClockFlag } from '@prima/core';
import { api, type MyStaffClock, type StaffClockBoard } from '../api';
import { Card, Empty, PageHead, Person, Search, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { gps, type Fix } from './Camera';
import { MyRemoteSection, RemoteBoardView } from './Remote';
import { FaceCapture, FaceChallengeCapture } from './FaceCheck';
import { FlexPanel } from './HrLeave';
import { OfficeOshPanel } from './HrOsh';
import { AppraisalsPanel, PoliciesPanel, TrainingPanel } from './HrDevelop';
import { HrGuide } from './HrGuide';
import { useApp } from '../App';
import { MyCheckinCard, OUTCOME, VERDICT, whereText } from './CheckIn';
import { CheckinPlacesView, CheckinReviewView } from './CheckinPlaces';
import { MyTimeSlipSection, TimeSlipBoardView } from './TimeSlip';
import { OwnerTestCheckinView } from './OwnerTestCheckin';
import { MOVE_FLAG, MovementChips, MovementView, flagText } from './Movement';
import { ClockPhotoCard } from './ClockPhoto';
import { awakeWanted, setAwakeWanted, useTrackerStatus } from './StaffTracker';
import { inAppShell } from '../native';
// P93: the tracker moved to its own file (adaptive, offline queue, back-on-screen reading); App.tsx imports it from here.
export { StaffTracker } from './StaffTracker';
import '../styles/selfservice.css';

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
  OUT_OF_AREA: 'Checked in or out outside the area',
};
const FLAG_TONE: Partial<Record<StaffClockFlag, Tone>> = { PHOTO_ONLY: 'neutral', NO_GPS: 'warn', AWAY_FROM_BASE: 'warn', OUT_OF_AREA: 'warn' };
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

const MY_CLOCK_SUB = (every: number) =>
  `You are clocked in when you sign in to Prima and clocked out when you sign out. Nothing to press: the clock keeps running while your laptop or PC is idle or asleep. If the device sends its location, it is recorded about every ${every} minutes while you are clocked in, and never after.`;

/**
 * Staff are clocked in when they sign in and out when they sign out, idle or asleep in between (Fauzan, 27 Oct 2026).
 * Location is followed only while clocked in, when the device sends it. Guards clock on the site device.
 */
export function MyClockView() {
  const { data, error, reload } = useLoad(() => api.myStaffClock(), []);
  const [where, setWhere] = useState<TestPlace>(api.mode === 'demo' ? 'base' : 'gps');
  const [record, setRecord] = useState<string | null>(null);
  const act = useAction();
  const { me } = useApp();
  // P90: the owner has no staff clock; they test check-in and check-out here instead (never attendance or pay).
  if (isOwnerAdmin(me.user) && (!data || !data.allowed)) return <OwnerTestCheckinView />;
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
        <Loading what="your clock" />
      </div>
    );
  if (!data.allowed)
    return (
      <div className="page ss">
        <PageHead title="My clock" />
        <Card>
          <Empty title="Guards clock in by face on the site device." />
        </Card>
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
    <div className="page ss">
      <PageHead title="My clock" sub={MY_CLOCK_SUB(data.pingEveryMin)} />

      <section className="ss-hero" data-on={open ? '' : undefined} aria-label="Clock status">
        <span className="ss-hero-icon" aria-hidden="true">
          <ClockIcon size={26} />
        </span>
        <div className="ss-hero-main">
          <span className="ss-hero-kicker">Today</span>
          <h2 className="ss-hero-title">{open ? `Clocked in since ${time(open.in.receivedAt)}` : 'Not clocked in'}</h2>
          <span className="ss-hero-sub">
            {data.base ? `Base: ${data.base.name}, within ${data.base.radiusM} m` : 'No fixed base: your route is recorded, not checked against a place'}
          </span>
        </div>
        <div className="ss-hero-side">
          <Chip tone={loc.tone}>{loc.label}</Chip>
        </div>
        {(open || api.mode === 'demo' || act.error) && (
          <div className="ss-hero-more">
            {open?.mode === 'login' && <div className="small">Started at sign-in. Sign out properly at the end of the day to clock out.</div>}
            {open && (
              <div className="ss-meta">
                <span>
                  <MapPinIcon size={14} aria-hidden="true" />
                  {open.pings} location reading{open.pings === 1 ? '' : 's'}
                  {open.lastPingAt ? `, last at ${time(open.lastPingAt)}` : ''}.
                </span>
              </div>
            )}
            {open && data.state === 'unknown' && (
              <div className="notice small" data-tone="warn">
                No location for over {data.gapMin} minutes. Keep the app open with location allowed. Your manager sees this as Unknown.
              </div>
            )}
            {open && open.flags.length > 0 && (
              <div className="ss-chips">
                {open.flags.map((f) => (
                  <Chip key={f} tone={FLAG_TONE[f] ?? 'crit'}>
                    {FLAG_LABEL[f]}
                  </Chip>
                ))}
              </div>
            )}
            {api.mode === 'demo' && (
              <div className="field">
                <span className="label">Test only: where the phone is</span>
                <div className="seg ss-tabs" role="group" aria-label="Test only: where the phone is">
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
              <div className="ss-actions">
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={async () => {
                    const r = await act.run(ping, 'Location sent.');
                    if (r) reload();
                  }}
                >
                  Test only: send a location reading now
                </button>
              </div>
            )}
            <ErrorNotice error={act.error} />
          </div>
        )}
      </section>

      {/* P81: check in and out by place, with the location checked by the server. */}
      <MyCheckinCard />

      {/* P97: how the location is followed on this phone, said honestly (a web page cannot follow a closed app). */}
      {open && !data.home && <TrackingCard lastPingAt={open.lastPingAt} />}

      {/* P93: today's movement, worked out the same way the manager sees it. */}
      {data.today?.movement && (
        <Card title="My movement today" sub="From your location readings while clocked in, and only then. You, your manager and HR see it.">
          <MovementView m={data.today.movement} mapLabel="Your route today" fitKey={`${data.today.clockId}:${data.today.movement.readings.used}`} />
          <div className="ss-actions">
            <button type="button" className="btn btn-sm" onClick={() => setRecord(data.today!.clockId)}>
              Open the full record
            </button>
          </div>
        </Card>
      )}

      <div className="ss-cols">
        <Card title="Last 7 days" flush>
          <ul className="ss-rows">
            {data.recent.length === 0 && <li className="empty">No clock records yet.</li>}
            {data.recent.map((c) => {
              const flags = c.flags.filter((f) => f !== 'PHOTO_ONLY');
              const review = (c.movement?.flags.length ?? 0) > 0;
              return (
                <li key={c.id}>
                  <button type="button" className="ss-row" data-tone={flags.length > 0 || review ? 'warn' : undefined} onClick={() => setRecord(c.id)}>
                  <span className="ss-row-main">
                    <span className="ss-row-title">{dateTimeLabel(c.in.receivedAt).replace(/,? \d\d:\d\d$/, '')}</span>
                    <span className="ss-times-line ss-meta">
                      <span>
                        <SignInIcon size={14} aria-hidden="true" />
                        In {time(c.in.receivedAt)}
                      </span>
                      <span>
                        <SignOutIcon size={14} aria-hidden="true" />
                        {c.out ? `out ${time(c.out.receivedAt)}` : 'still in'}
                      </span>
                      <span>
                        <MapPinIcon size={14} aria-hidden="true" />
                        {c.pings} readings
                      </span>
                    </span>
                    <MovementChips m={c.movement} />
                  </span>
                  {flags.length > 0 ? <Chip tone="warn">{flags.map((f) => FLAG_LABEL[f]).join(', ')}</Chip> : <Chip tone="ok">OK</Chip>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <MyFacePanel faceEnrolled={data.faceEnrolled} pending={!!open?.flags.includes('FACE_PENDING')} />
      </div>

      <div className="ss-stack">
        <MyRemoteSection />
        <FlexPanel />
        <OfficeOshPanel coordinatorOnly />
        <PoliciesPanel mine />
        <AppraisalsPanel mine />
        <TrainingPanel mine />
        <HrGuide staffSide />
        <MyTimeSlipSection />
      </div>
      {record && <ClockDetail id={record} onClose={() => setRecord(null)} />}
    </div>
  );
}

type Row = StaffClockBoard['rows'][number];
type Filter = 'all' | 'in' | 'problem' | 'not_in';
const STATUS_ORDER: Record<Row['status'], number> = { in: 0, out: 1, not_in: 2 };

/** Who of the staff is clocked in and where, for the company manager, central HR and top management. */
export function StaffClockBoardView() {
  const { data, error } = useLoad(() => api.staffClockBoard(), []);
  const { me } = useApp();
  // P81: HR, managers and leaders set check-in places and review check-ins outside the area.
  const places = checkinScope(me.user) !== null;
  const day = useLoad(() => (places ? api.checkinDay().catch(() => null) : Promise.resolve(null)), [places]);
  const reviews = useLoad(() => (places ? api.checkinReviews().catch(() => null) : Promise.resolve(null)), [places]);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<'clock' | 'home' | 'slips' | 'places' | 'review'>('clock');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  if (error)
    return (
      <div className="page ss">
        <PageHead title="Staff clock" />
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page ss">
        <PageHead title="Staff clock" />
        <Loading what="staff clock" />
      </div>
    );
  const problem = (r: Row) =>
    !!r.hours?.late ||
    !!r.hours?.early ||
    !!r.hours?.longBreak ||
    r.location === 'unknown' ||
    r.location === 'away' ||
    (r.status === 'in' && r.door.left) ||
    r.review.length > 0 ||
    (r.clock?.flags ?? []).some((f) => f !== 'PHOTO_ONLY');
  const needle = q.trim().toLowerCase();
  const rows = data.rows
    .filter((r) => filter === 'all' || (filter === 'in' ? r.status === 'in' : filter === 'not_in' ? r.status === 'not_in' : problem(r)))
    .filter((r) => !needle || [r.name, r.title, r.company].some((x) => x.toLowerCase().includes(needle)))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => STATUS_ORDER[a.r.status] - STATUS_ORDER[b.r.status] || a.i - b.i)
    .map((x) => x.r);
  const inNow = data.rows.filter((r) => r.status === 'in').length;
  const unknown = data.rows.filter((r) => r.location === 'unknown').length;
  const away = data.rows.filter((r) => r.location === 'away').length;
  const notIn = data.rows.filter((r) => r.status === 'not_in').length;
  const problems = data.rows.filter(problem).length;
  const outOfStation = data.reviews.filter((x) => x.kind === 'out_of_station').length;
  const pick = (f: Filter) => () => {
    setTab('clock');
    setFilter(f);
  };
  return (
    <div className="page ss">
      <PageHead
        title="Staff clock"
        sub={
          <>
            Staff clock in and out on their own phones with face or a time-stamped photo. Location is recorded only from clock-in to clock-out. No reading for{' '}
            {data.gapMin} minutes shows as Unknown, never as fine. The office door readings, monitored by CMS, show who left the office while still signed in.
          </>
        }
      >
        <p className="ss-note">
          Working hours {hm(data.hours.start)} to {hm(data.hours.end)}, with a {data.hours.breakMin}-minute break taken at any time. A first clock-in after{' '}
          {hm(data.hours.start)}, a clock-out before {hm(data.hours.end)} and a break over {data.hours.breakMin} minutes are flagged for a look.
        </p>
        {data.viewOnly && <p className="notice">You see your IT team's clock, view only.</p>}
      </PageHead>
      <FaceReviewsPanel />
      <ClockPhotoReviews onOpen={setOpen} />
      <div className="tabbar" role="tablist" aria-label="Staff clock sections">
        <button role="tab" aria-selected={tab === 'clock'} onClick={() => setTab('clock')}>
          Clock today
        </button>
        <button role="tab" aria-selected={tab === 'home'} onClick={() => setTab('home')}>
          Working from home
        </button>
        <button role="tab" aria-selected={tab === 'slips'} onClick={() => setTab('slips')}>
          Time slips
        </button>
        {places && (
          <>
            <button role="tab" aria-selected={tab === 'places'} onClick={() => setTab('places')}>
              Check-in places
            </button>
            <button role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
              Out of area{reviews.data?.open.length ? <span className="ss-count">{reviews.data.open.length}</span> : null}
            </button>
          </>
        )}
      </div>
      {tab === 'slips' ? (
        <TimeSlipBoardView />
      ) : tab === 'home' ? (
        <RemoteBoardView />
      ) : tab === 'places' ? (
        <CheckinPlacesView />
      ) : tab === 'review' ? (
        <CheckinReviewView />
      ) : (
        <>
          <Stats>
            <Stat label="Clocked in now" value={inNow} tone="info" icon={<UserCheckIcon size={16} />} onClick={pick('in')} />
            <Stat label="Location unknown" value={unknown} tone={unknown ? 'unknown' : 'ok'} icon={<QuestionIcon size={16} />} onClick={pick('problem')} />
            <Stat label="Away from base" value={away} tone={away ? 'warn' : 'ok'} icon={<MapPinIcon size={16} />} onClick={pick('problem')} />
            <Stat label="Out of station" value={outOfStation} tone={outOfStation ? 'warn' : 'ok'} icon={<WarningCircleIcon size={16} />} onClick={pick('problem')} />
            <Stat label="Not clocked in today" value={notIn} icon={<UserMinusIcon size={16} />} onClick={pick('not_in')} />
            <Stat label="Late in" value={data.late} tone={data.late ? 'warn' : 'ok'} icon={<TimerIcon size={16} />} onClick={pick('problem')} />
            <Stat label="Break over 1 hour" value={data.longBreak} tone={data.longBreak ? 'warn' : 'ok'} icon={<CoffeeIcon size={16} />} onClick={pick('problem')} />
            <Stat
              label="Left the office, still signed in"
              value={data.leftStillSignedIn}
              tone={data.leftStillSignedIn ? 'warn' : 'ok'}
              icon={<DoorOpenIcon size={16} />}
              onClick={pick('problem')}
            />
          </Stats>
          {!data.doorFeed && (
            <p className="notice" data-tone="unknown">
              No office door readings for this day: the door check is unknown, not passed.
            </p>
          )}
          {data.reviews.length > 0 && (
            <Card
              title={`Movement to look at (${data.reviews.length})`}
              sub={`Outside their place for more than ${data.movementRules.outOfStationMin} minutes, a location jump, a fake-looking location, a clock-in far from the place, or location that stopped. Open one for the route and timeline.`}
              flush
            >
              <ul className="ss-rows">
                {data.reviews.map((f, i) => (
                  <li key={`${f.clockId}-${f.kind}-${f.at}-${i}`}>
                    <button type="button" className="ss-row mv-review" data-tone={MOVE_FLAG[f.kind].tone === 'crit' ? 'crit' : 'warn'} onClick={() => setOpen(f.clockId)}>
                      <Person name={f.name} sub={f.title.includes(f.company.split(' ')[0]) ? f.title : `${f.title} · ${f.company}`} />
                      <span className="ss-board-times">
                        <span className="mv-flag-text">{flagText(f)}</span>
                      </span>
                      <span className="ss-row-side">
                        <Chip tone={MOVE_FLAG[f.kind].tone}>{MOVE_FLAG[f.kind].label}</Chip>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Team today" sub="Clocked in first, then clocked out, then not in. Open a person for their clock record." flush>
            <div className="ss-tools">
              <div className="seg" role="group" aria-label="Who to show">
                {(
                  [
                    ['all', 'All', data.rows.length],
                    ['in', 'Clocked in', inNow],
                    ['problem', 'Needs a look', problems],
                    ['not_in', 'Not clocked in', notIn],
                  ] as const
                ).map(([k, l, n]) => (
                  <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                    {l}
                    <span className="ss-count">{n}</span>
                  </button>
                ))}
              </div>
              <Search value={q} onChange={setQ} placeholder="Search name, title or company" />
            </div>
            <ul className="ss-rows">
              {rows.length === 0 && <li className="empty">Nobody here.</li>}
              {rows.map((r) => (
                <li key={r.userId}>
                  <BoardRow r={r} problem={problem(r)} checkins={day.data?.events.filter((e) => e.userId === r.userId) ?? []} onOpen={() => r.clock && setOpen(r.clock.id)} />
                </li>
              ))}
            </ul>
            <p className="ss-note ss-foot">
              Location and face are personal data, and face is biometric data under the PDPA. Staff must be told in writing what is recorded and why before this
              goes live.
            </p>
          </Card>
        </>
      )}
      {open && <ClockDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BoardRow({ r, problem, onOpen, checkins = [] }: { r: Row; problem: boolean; onOpen: () => void; checkins?: CheckinEvent[] }) {
  const flags = r.clock ? r.clock.flags.filter((f) => f !== 'PHOTO_ONLY') : [];
  const status =
    r.status === 'in' ? LOCATION[r.location] : r.status === 'out' ? { label: 'Clocked out', tone: 'neutral' as Tone } : { label: 'Not in', tone: 'neutral' as Tone };
  return (
    <button className="ss-row ss-board-row" data-status={r.status} data-tone={problem ? 'warn' : undefined} disabled={!r.clock} onClick={onOpen}>
      <Person name={r.name} sub={r.title.includes(r.company.split(' ')[0]) ? r.title : `${r.title} · ${r.company}`} />
      <span className="ss-board-times">
        {r.clock ? (
          <span className="ss-times-line">
            <span>
              <SignInIcon size={14} aria-hidden="true" />
              In {time(r.clock.in.receivedAt)}
            </span>
            {r.clock.out && (
              <span>
                <SignOutIcon size={14} aria-hidden="true" />
                out {time(r.clock.out.receivedAt)}
              </span>
            )}
          </span>
        ) : (
          <span className="muted">Not clocked in today</span>
        )}
        {r.hours && (
          <span className="ss-times-line ss-meta">
            <span>
              First in {time(r.hours.firstIn)}
              {r.hours.lastOut && r.status === 'out' ? `, last out ${time(r.hours.lastOut)}` : ''}
            </span>
            <span>
              <ClockIcon size={14} aria-hidden="true" />
              worked {dur(r.hours.workedMin)}
            </span>
            <span>
              <CoffeeIcon size={14} aria-hidden="true" />
              break {dur(r.hours.breakMin)}
            </span>
          </span>
        )}
        {r.last && (
          <span className="ss-meta">
            Last reading {time(r.last.at)}
            {r.last.distanceM !== null ? `, ${fmtDistance(r.last.distanceM)} from base` : ''}
          </span>
        )}
        {r.status !== 'not_in' && <MovementChips m={r.movement} />}
        {checkins.length > 0 && (
          <span className="ci-board-line">
            {checkins.map((e) => (
              <Chip key={e.id} tone={e.outcome === 'accepted' ? VERDICT[e.verdict].tone : OUTCOME[e.outcome].tone}>
                {e.kind === 'in' ? 'In' : 'Out'} {time(e.at)} · {e.outcome === 'blocked' ? 'refused, ' : ''}
                {whereText(e)}
              </Chip>
            ))}
          </span>
        )}
        {(r.door.firstIn || r.door.lastOut) && (
          <span className="ss-meta">
            Door: {r.door.firstIn ? `in ${time(r.door.firstIn)}` : 'no entry'}
            {r.door.lastOut ? `, left ${time(r.door.lastOut)}` : ''}
          </span>
        )}
        {((r.hours && (r.hours.late || (r.hours.early && r.status === 'out') || r.hours.longBreak)) || (r.status === 'in' && r.door.left) || flags.length > 0) && (
          <span className="ss-chips">
            {r.hours?.late && <Chip tone="warn">Late {dur(r.hours.lateMin)}</Chip>}
            {r.hours?.early && r.status === 'out' && <Chip tone="warn">Left before {hm(r.hours.end)}</Chip>}
            {r.hours?.longBreak && <Chip tone="warn">Break over 1 hour</Chip>}
            {r.status === 'in' && r.door.left && <Chip tone="warn">Left the office, still signed in</Chip>}
            {flags.map((f) => (
              <Chip key={f} tone={FLAG_TONE[f] ?? 'crit'}>
                {FLAG_LABEL[f]}
              </Chip>
            ))}
          </span>
        )}
      </span>
      <span className="ss-row-side">
        <Chip tone={status.tone}>{status.label}</Chip>
      </span>
    </button>
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
          <section className="ss-sec">
            <div className="ss-chips">
              <Chip tone={LOCATION[data.state].tone}>{data.clock.out ? 'Clocked out' : LOCATION[data.state].label}</Chip>
              {data.clock.flags.map((f) => (
                <Chip key={f} tone={FLAG_TONE[f] ?? 'crit'}>
                  {FLAG_LABEL[f]}
                </Chip>
              ))}
            </div>
            {data.clock.faceCheck && (
              <div className="ss-io-col">
                <span className="label">Face check after sign-in (spot-check: the phone does the matching)</span>
                <img src={data.clock.faceCheck.image} alt="Face check photo" className="ss-photo ss-photo-sm" />
                <span>
                  {time(data.clock.faceCheck.receivedAt)} server time · match{' '}
                  {data.clock.faceCheck.face ? `${Math.round(data.clock.faceCheck.face.score * 100)}%` : 'none'}
                  {data.clock.faceCheck.face && !data.clock.faceCheck.face.live ? ' · face did not move' : ''}
                </span>
              </div>
            )}
          </section>
          <section className="ss-sec">
            <div className="ss-io">
              {(['in', 'out'] as const).map((k) => {
                const s = data.clock[k];
                return (
                  <div key={k} className="ss-io-col">
                    <span className="label">{k === 'in' ? 'Clock in' : 'Clock out'}</span>
                    {!s ? (
                      <span className="muted">Not yet</span>
                    ) : (
                      <>
                        {s.image ? (
                          <img src={s.image} alt={`${k} photo`} className="ss-photo" />
                        ) : (
                          <span className="muted">
                            {s.source === 'checkin'
                              ? 'At check-out, no photo'
                              : s.source === 'door'
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
                        {/* P93: a check-out's distance is from the check-in place, not from the old personal base. */}
                        {s.distanceM !== null && <span className="muted">{s.source === 'checkin' ? `${fmtDistance(s.distanceM)} from the check-in place` : `${fmtDistance(s.distanceM)} from base`}</span>}
                        <span className="mono muted">SHA-256 {s.sha256.slice(0, 12)}…</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {/* P97: the face photos of this record's check-ins and check-outs. */}
          {data.snaps && data.snaps.length > 0 && (
            <section className="ss-sec">
              <h3 className="ss-sec-title">Face photos</h3>
              <div className="cph-pair">
                {data.snaps.map((sn) => (
                  <ClockPhotoCard key={sn.id} label={sn.kind === 'in' ? 'Check-in photo' : 'Check-out photo'} snap={sn} />
                ))}
              </div>
            </section>
          )}
          {data.movement && (
            <section className="ss-sec">
              <h3 className="ss-sec-title">Movement</h3>
              <MovementView m={data.movement} fitKey={`${data.clock.id}:${data.movement.readings.used}`} />
            </section>
          )}
          <section className="ss-sec">
            <h3 className="ss-sec-title">Location while clocked in</h3>
            <p className="ss-note">{data.base ? `Base: ${data.base.name}, within ${data.base.radiusM} m.` : 'No fixed base; the route is recorded, not checked.'}</p>
            {data.gaps.length > 0 && (
              <div className="ss-gaps">
                {data.gaps.map((g) => (
                  <div key={g.from} className="notice small" data-tone="warn">
                    No location from {time(g.from)} to {data.clock.out || g.to < data.clock.in.receivedAt ? time(g.to) : 'now'} ({g.minutes} minutes): Unknown.
                  </div>
                ))}
              </div>
            )}
            <div className="list ss-pings">
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
  const state: { label: string; tone: Tone } = faceEnrolled
    ? pending
      ? { label: 'Check needed', tone: 'warn' }
      : { label: 'Registered', tone: 'ok' }
    : f.status === 'pending'
      ? { label: 'Waiting for HR', tone: 'info' }
      : f.status === 'refused'
        ? { label: 'Refused', tone: 'warn' }
        : { label: 'Not registered', tone: 'neutral' };
  return (
    <Card title="Face recognition" actions={<Chip tone={state.tone}>{state.label}</Chip>}>
      <div className="ss-form">
        {faceEnrolled && pending && (
          <>
            <p className="small">You are clocked in from your sign-in. Confirm it is you with a quick face check.</p>
            {f.engine === 'server' ? (
              <FaceChallengeCapture
                label="Check my face"
                busy={act.busy}
                start={() => api.faceChallenge()}
                onFrames={(r) => void act.run(() => api.staffFaceCheckFrames({ ...r, capturedAt: new Date().toISOString() }), 'Face checked.')}
              />
            ) : (
              <FaceCapture
                label="Check my face"
                title="Check your face"
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
            )}
          </>
        )}
        {faceEnrolled && !pending && <p className="ss-note">Your face is registered. Each sign-in asks for a quick face check.</p>}
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
              title="Register your face"
              busy={act.busy}
              photoOnly={f.engine === 'server'}
              onCapture={(r) => void act.run(() => api.registerFace({ photo: r.photo, descriptor: r.descriptor }), 'Sent to HR to approve.').then(() => mine.reload())}
            />
          </>
        )}
        <ErrorNotice error={act.error} />
      </div>
    </Card>
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
    <Card
      title={`Faces waiting for HR (${list.data.pending.length})`}
      sub="Check the photo is the staff member before approving. The phone does the matching, so spot-check clock-in photos too."
      flush
    >
      <ul className="ss-rows">
        {list.data.pending.map((r) => (
          <li key={r.personId} className="ss-face">
            {r.photo ? <img src={r.photo} alt={`Face registered by ${r.name}`} /> : <span className="ss-face-noimg" aria-hidden="true" />}
            <div className="ss-form">
              <div className="ss-row-main">
                <span className="ss-row-title">{r.name}</span>
                <span className="ss-meta">
                  {r.staffNo ? `(${r.staffNo})` : ''} {r.jobTitle ? `· ${r.jobTitle}` : ''}
                </span>
              </div>
              {r.own ? (
                <p className="ss-note">Your own face: someone else in HR approves it.</p>
              ) : (
                <>
                  <input
                    className="input"
                    placeholder="Comment (needed)"
                    aria-label={`Comment for ${r.name}`}
                    value={note[r.personId] ?? ''}
                    onChange={(e) => setNote((x) => ({ ...x, [r.personId]: e.target.value }))}
                  />
                  <div className="ss-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={act.busy || !(note[r.personId] ?? '').trim()}
                      onClick={() => void act.run(() => api.decideFace(r.personId, true, note[r.personId] ?? ''), 'Face approved.').then(() => list.reload())}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !(note[r.personId] ?? '').trim()}
                      onClick={() => void act.run(() => api.decideFace(r.personId, false, note[r.personId] ?? ''), 'Face refused.').then(() => list.reload())}
                    >
                      Refuse
                    </button>
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {act.error && (
        <div className="ss-pad">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}

/**
 * P97: following the location while clocked in, said honestly. In the Prima app with background following the phone
 * keeps sending; in a browser only while Prima is open (also in a background tab while the browser allows it), with an
 * option to keep the screen on. Times without a position show as gaps with their likely cause, never filled in.
 */
function TrackingCard({ lastPingAt }: { lastPingAt: string | null }) {
  const st = useTrackerStatus();
  const [awake, setAwake] = useState(awakeWanted());
  const app = inAppShell();
  const last = st.lastFixAt ? fromMs(st.lastFixAt) : lastPingAt;
  const mode =
    api.mode === 'demo'
      ? { label: 'Test version: no location followed', tone: 'neutral' as Tone }
      : st.problem === 'denied'
        ? { label: 'Location is off for Prima', tone: 'crit' as Tone }
        : st.mode === 'native'
          ? { label: 'Following, also in the background', tone: 'ok' as Tone }
          : st.mode === 'web'
            ? { label: 'Following while Prima is open', tone: 'info' as Tone }
            : { label: 'Starting', tone: 'neutral' as Tone };
  return (
    <Card title="Location while clocked in" actions={<Chip tone={mode.tone}>{mode.label}</Chip>}>
      <div className="trk">
        <div className="trk-line ss-meta">
          <span>
            <BroadcastIcon size={14} aria-hidden="true" /> {last ? `Last position sent ${time(last)}` : 'No position sent yet'}
          </span>
          {st.queued > 0 && <Chip tone="warn">{`${st.queued} waiting for signal`}</Chip>}
        </div>
        {st.problem === 'denied' && (
          <p className="notice small" data-tone="warn">
            Location is blocked for Prima, so nothing is recorded and your manager sees a gap. Allow location for Prima in the phone settings.
          </p>
        )}
        {st.mode === 'native' ? (
          <p className="ss-note">The Prima app keeps sending your position with Prima in the background or the screen off, until you check out. The phone shows a notice while it does.</p>
        ) : (
          <p className="ss-note">
            {app
              ? 'This Prima app follows your location only while Prima is open. Keep it open while you move.'
              : 'A web page can follow your location only while Prima is open (also in another tab, while the browser allows it). Once Prima is closed or the phone sleeps, nothing is recorded: that time shows as a gap with its likely cause, never as a made-up route. The Prima app for Android and iPhone can follow in the background.'}
          </p>
        )}
        {st.mode === 'web' && st.wake !== 'unsupported' && (
          <label className="trk-toggle">
            <input
              type="checkbox"
              checked={awake}
              onChange={(e) => {
                setAwake(e.target.checked);
                setAwakeWanted(e.target.checked);
              }}
            />
            <span>Keep the screen on while clocked in (uses more battery)</span>
            {st.wake === 'on' && <Chip tone="ok">On</Chip>}
          </label>
        )}
      </div>
    </Card>
  );
}

/** P97: the check-in and check-out face photos for the manager or HR to look at: fine, or follow up, with a comment. */
function ClockPhotoReviews({ onOpen }: { onOpen: (clockId: string) => void }) {
  const list = useLoad(() => api.clockPhotoReviews().catch(() => null), []);
  const [note, setNote] = useState<Record<string, string>>({});
  const act = useAction();
  const d = list.data;
  if (!d || d.open.length === 0) return null;
  const WHY: Record<string, string> = {
    no_camera: 'No camera',
    no_photo: 'No photo',
    not_matched: 'Face not matched',
    not_live: 'Face did not move',
    no_face: 'No face found',
  };
  return (
    <Card title={`Face photos to look at (${d.open.length})`} sub="Check-ins and check-outs without a photo, with a face that did not match or did not move. Nobody decides their own." flush>
      <ul className="ss-rows">
        {d.open.map((sn) => (
          <li key={sn.id} className="cph-review">
            {sn.image ? <img className="cph-photo" src={sn.image} alt={`${sn.kind === 'in' ? 'Check-in' : 'Check-out'} photo of ${sn.userName}`} /> : <span className="cph-nophoto" aria-hidden="true" />}
            <div className="ss-form">
              <div className="ss-row-main">
                <span className="ss-row-title">{sn.userName}</span>
                <span className="ss-meta">
                  {sn.kind === 'in' ? 'Check-in' : 'Check-out'} {dateTimeLabel(sn.at)}
                </span>
              </div>
              <div className="ss-chips">
                {(sn.review?.why ?? []).map((w) => (
                  <Chip key={w} tone={w === 'not_matched' ? 'crit' : 'warn'}>
                    {WHY[w] ?? w}
                  </Chip>
                ))}
                {sn.face && <Chip tone={sn.face.matched ? 'ok' : 'crit'}>{`Match ${Math.round(sn.face.score * 100)}%`}</Chip>}
              </div>
              {sn.reason && <p className="small">“{sn.reason}”</p>}
              {sn.clockId && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(sn.clockId!)}>
                  Open the clock record
                </button>
              )}
              {d.canDecide && (
                <>
                  <input
                    className="input"
                    placeholder="Comment (needed)"
                    aria-label={`Comment for ${sn.userName}`}
                    value={note[sn.id] ?? ''}
                    onChange={(e) => setNote((x) => ({ ...x, [sn.id]: e.target.value }))}
                  />
                  <div className="ss-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={act.busy || !(note[sn.id] ?? '').trim()}
                      onClick={() => void act.run(() => api.decideClockPhoto(sn.id, 'cleared', note[sn.id] ?? ''), 'Marked fine.').then(() => list.reload())}
                    >
                      Fine
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !(note[sn.id] ?? '').trim()}
                      onClick={() => void act.run(() => api.decideClockPhoto(sn.id, 'upheld', note[sn.id] ?? ''), 'Marked for follow-up.').then(() => list.reload())}
                    >
                      Follow up
                    </button>
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {act.error && (
        <div className="ss-pad">
          <ErrorNotice error={act.error} />
        </div>
      )}
    </Card>
  );
}
