/**
 * P93 (Fitri, 9 Nov 2026): a clock session's movement, the same for the staff member, their manager and the owner's
 * TEST check-in: how far they moved (GPS jitter, rough readings and jumps left out), time inside and outside their
 * place, the route on a map, the timeline, and the items for the manager to look at. The numbers come from the server
 * (movement.ts); this screen only words them.
 */
import { lazy, Suspense } from 'react';
import { MapPinIcon, PathIcon, QuestionIcon, SignOutIcon } from '@phosphor-icons/react';
import type { MovementFlag, MovementFlagKind, MovementSummary, StationState } from '@prima/core';
import { Stat, Stats } from '../kit';
import { Chip, type Tone } from '../ui';
import { MapFallback, fmtM } from './CheckIn';
import type { MapCircle, MapPoint } from './GeoMap';
import '../styles/checkin.css';

const GeoMap = lazy(() => import('./GeoMap'));

const time = (t: string) => t.slice(11, 16);
export const durText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`);

export const MOVE_FLAG: Record<MovementFlagKind, { label: string; tone: Tone }> = {
  out_of_station: { label: 'Out of station', tone: 'warn' },
  jump: { label: 'Location jump', tone: 'crit' },
  fake_location: { label: 'Location looks fake', tone: 'crit' },
  far_clock_in: { label: 'Clocked in far from the place', tone: 'warn' },
  phone_time: { label: 'Phone clock set ahead', tone: 'warn' },
  location_stopped: { label: 'Location stopped', tone: 'unknown' },
};

const STATE: Record<StationState, { label: string; tone: Tone }> = {
  inside: { label: 'Inside', tone: 'ok' },
  outside: { label: 'Outside', tone: 'warn' },
  unknown: { label: 'Unknown', tone: 'unknown' },
};

/** One review item in plain words (one sentence, so the Malay screen reads it whole). */
export function flagText(f: MovementFlag): string {
  switch (f.kind) {
    case 'out_of_station':
      return `Outside ${f.place ?? 'the place'} from ${time(f.at)} to ${f.to ? time(f.to) : 'now'} (${durText(f.minutes ?? 0)}), up to ${fmtM(f.distanceM ?? 0)} beyond its edge.`;
    case 'jump':
      return `The location jumped ${fmtM(f.distanceM ?? 0)} in ${f.minutes ?? 0} min at ${time(f.at)}, faster than any car. Check the phone was with the person.`;
    case 'fake_location':
      return `${f.count ?? 0} readings look fake: the exact same point with perfect accuracy. Real phones always move a little.`;
    case 'far_clock_in':
      return `Clocked in ${fmtM(f.distanceM ?? 0)} outside ${f.place ?? 'the place'} at ${time(f.at)}.`;
    case 'phone_time':
      return `${f.count ?? 0} readings had the phone clock set ahead of the server; the server time was used.`;
    case 'location_stopped':
      return `No location from ${time(f.at)} to ${f.to ? time(f.to) : 'now'} (${durText(f.minutes ?? 0)}) while clocked in.`;
  }
}

const MEASURE: Partial<Record<MovementSummary['measure'], string>> = {
  no_place: 'No place is set for this person, so time outside cannot be measured. HR or the manager sets it on Check-in places.',
  outstation: 'Outstation day: anywhere is allowed, so time outside is not counted.',
  home: 'Working from home: the location is checked once at the start and not followed.',
  no_location: 'No usable location reading yet.',
};

/** The short line on a list row: moved, and outside when it was. */
export function MovementChips({ m }: { m: { measure: MovementSummary['measure']; distanceM: number; outsideMin: number; flags: MovementFlag[] } | null }) {
  if (!m) return null;
  return (
    <span className="ss-chips mv-chips">
      {m.measure !== 'home' && m.measure !== 'no_location' && <Chip tone="neutral">Moved {fmtM(m.distanceM)}</Chip>}
      {m.measure === 'measured' && m.outsideMin > 0 && <Chip tone={m.flags.some((f) => f.kind === 'out_of_station') ? 'warn' : 'neutral'}>Outside {durText(m.outsideMin)}</Chip>}
      {m.measure === 'no_place' && <Chip tone="unknown">No place set</Chip>}
      {m.flags
        .filter((f) => f.kind !== 'out_of_station')
        .map((f, i) => (
          <Chip key={`${f.kind}-${i}`} tone={MOVE_FLAG[f.kind].tone}>
            {MOVE_FLAG[f.kind].label}
          </Chip>
        ))}
    </span>
  );
}

/** The whole session: figures, what to look at, the route on the map and the timeline. */
export function MovementView({ m, mapLabel = 'The route while clocked in', fitKey }: { m: MovementSummary; mapLabel?: string; fitKey: string }) {
  const route = m.route;
  const circles = m.targets.map((t): MapCircle => ({ lat: t.lat, lng: t.lng, radiusM: t.radiusM, tone: 'primary', label: `${t.label} (${fmtM(t.radiusM)})` }));
  const first = route[0];
  const end = route.at(-1);
  const points: MapPoint[] = [
    ...(first ? [{ lat: first.lat, lng: first.lng, tone: 'ok' as const, label: `Start ${time(first.t)}` }] : []),
    ...(end && route.length > 1 ? [{ lat: end.lat, lng: end.lng, accuracyM: end.accuracyM, tone: (end.source === 'out' ? 'crit' : 'info') as MapPoint['tone'], label: `${end.source === 'out' ? 'End' : 'Last'} ${time(end.t)}` }] : []),
  ];
  const ignored = m.readings.total - m.readings.used;
  return (
    <div className="mv">
      <Stats>
        <Stat label="Moved" value={fmtM(m.distanceM)} note={`${m.readings.used} readings used`} icon={<PathIcon size={16} />} />
        {m.measure === 'measured' && <Stat label="Inside the place" value={durText(m.insideMin)} tone="ok" icon={<MapPinIcon size={16} />} />}
        {m.measure === 'measured' && <Stat label="Outside the place" value={durText(m.outsideMin)} tone={m.outsideMin ? 'warn' : 'ok'} icon={<SignOutIcon size={16} />} />}
        <Stat label="No location" value={durText(m.unknownMin)} tone={m.unknownMin > m.rules.gapMin ? 'unknown' : 'ok'} icon={<QuestionIcon size={16} />} />
      </Stats>
      {MEASURE[m.measure] && (
        <p className="notice small" data-tone={m.measure === 'no_place' ? 'unknown' : 'info'}>
          {MEASURE[m.measure]}
        </p>
      )}
      {m.flags.length > 0 && (
        <ul className="mv-flags" aria-label="To look at">
          {m.flags.map((f, i) => (
            <li key={`${f.kind}-${f.at}-${i}`} data-tone={MOVE_FLAG[f.kind].tone}>
              <Chip tone={MOVE_FLAG[f.kind].tone}>{MOVE_FLAG[f.kind].label}</Chip>
              <span className="mv-flag-text">{flagText(f)}</span>
            </li>
          ))}
        </ul>
      )}
      {route.length > 0 && (
        <Suspense fallback={<MapFallback height={280} />}>
          <GeoMap label={mapLabel} height={280} circles={circles} lines={route.length > 1 ? [{ path: route, tone: 'primary', label: 'Route' }] : []} points={points} fitKey={fitKey} />
        </Suspense>
      )}
      {m.periods.length > 0 && (
        <ol className="ci-timeline mv-timeline" aria-label="Timeline">
          {m.periods.map((p) => (
            <li key={p.from} data-outcome={p.state === 'outside' ? 'flagged' : p.state === 'inside' ? 'accepted' : undefined}>
              <span className="ci-tl-time">
                {time(p.from)}–{time(p.to)}
              </span>
              <span className="ci-tl-main">
                <span className="ci-tl-title">{durText(p.minutes)}</span>
                {p.state === 'outside' && p.place && <span className="ci-tl-sub">{`Up to ${fmtM(p.outsideByM ?? 0)} beyond ${p.place}`}</span>}
              </span>
              <Chip tone={STATE[p.state].tone}>{m.measure === 'measured' || p.state === 'unknown' ? STATE[p.state].label : 'Location known'}</Chip>
            </li>
          ))}
        </ol>
      )}
      <p className="ss-note">
        {ignored > 0 ? `${ignored} of ${m.readings.total} readings were left out (too rough, sent twice, or an impossible jump). ` : ''}
        {`Readings rougher than ${m.rules.maxAccuracyM} m are not used. Small GPS wobble is not counted as moving. Outside for more than ${m.rules.outOfStationMin} minutes is shown to the manager.`}
      </p>
    </div>
  );
}
