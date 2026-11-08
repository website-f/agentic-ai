/**
 * P81 (staff check-in by place, 6 Nov 2026): the Check-in places screen (a tab on Staff clock) for the owner, HR and
 * company managers: each company's offices on a map with their allowed radius, the company's choice for check-ins
 * outside the area, who checks in where (one person or a department at once), and the review of flagged check-ins.
 */
import { Select } from '../SearchSelect';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AirplaneTiltIcon, ArchiveIcon, BuildingsIcon, CrosshairIcon, MagnifyingGlassIcon, MapPinIcon, PlusIcon, TrashIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { STATE_CAPITALS, type CheckinPlace, type CheckinRuleKind, type CheckinZone } from '@prima/core';
import { api, type CheckinReviews, type CheckinSetup, type CheckinSites, type GeoResult } from '../api';
import { Card, Empty, Facts, Person, Search } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { MapFallback, OUTCOME, VERDICT, addressText, fmtM, whereText } from './CheckIn';
import type { MapCircle } from './GeoMap';
import '../styles/checkin.css';

const GeoMap = lazy(() => import('./GeoMap'));

type Company = CheckinSetup['companies'][number];
type Staff = CheckinSetup['staff'][number];

const KIND_LABEL: Record<CheckinRuleKind, string> = { office: 'Company office', place: 'A specific place', field: 'Flexible / field' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEPT_LABEL: Record<string, string> = {
  hr: 'HR',
  it: 'IT',
  fwm: 'Foreign workers (FWM)',
  cms: 'Control room (CMS)',
  pdpa: 'PDPA',
  director_office: 'Director office',
  chief_of_staff: 'Chief of staff',
  arms_control: 'Arms control',
};
const deptLabel = (d: string | null) => (d ? (DEPT_LABEL[d] ?? d.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())) : 'No department');

/** A rule in a few words, for the staff list. */
function ruleText(s: Staff, places: CheckinPlace[]): { text: string; tone: Tone } {
  const r = s.rule;
  if (!r || r.kind === 'office') return { text: s.hasBase && !places.some((p) => p.active) ? 'Own base (older setting)' : 'Company office', tone: 'neutral' };
  if (r.kind === 'place') return { text: places.find((p) => p.id === r.placeId)?.name ?? 'A place (archived: company office)', tone: 'info' };
  return { text: `Field: ${r.zones.map((z) => z.label).join(', ')}${r.outstation.length || r.outstationWeekdays.length ? ' · outstation set' : ''}`, tone: 'info' };
}

/** The tab: pick a company, then its places, its out-of-area choice and its staff. */
export function CheckinPlacesView() {
  const { data, error, reload } = useLoad(() => api.checkinSetup(), []);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CheckinPlace | 'new' | null>(null);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="check-in places" />;
  if (!data.companies.length) return <Empty title="No companies to set up">You set check-in places for the companies you manage.</Empty>;
  const company = data.companies.find((c) => c.id === companyId) ?? data.companies[0];
  const places = company.places;
  const active = places.filter((p) => p.active);
  const staff = data.staff.filter((s) => s.companyId === company.id);
  return (
    <div className="ci-setup">
      <div className="ci-bar">
        {data.companies.length > 1 && (
          <label className="field ci-company">
            <span className="label">Company</span>
            <Select className="select" value={company.id} onChange={(e) => setCompanyId(e.target.value)}>
              {data.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <div className="field">
          <span className="label">Check-in outside the allowed area</span>
          <div className="seg" role="group" aria-label="Check-in outside the allowed area">
            {(
              [
                ['flag', 'Allow with a reason'],
                ['block', 'Refuse'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                aria-pressed={company.policy === k}
                disabled={act.busy}
                onClick={() => company.policy !== k && void act.run(() => api.setCheckinPolicy(company.id, k), k === 'block' ? 'Check-ins outside the area are now refused.' : 'Check-ins outside the area now need a reason.').then(reload)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="ss-note">
        {company.policy === 'block'
          ? 'Refused check-ins are kept, with their place, for you to review. Check-outs are never refused: outside the area they need a reason.'
          : 'A check-in outside the area needs a reason from the staff member and comes to you to review.'}
      </p>
      <ErrorNotice error={act.error} />

      <Card
        title="Offices and places"
        sub={`Staff check in within the radius of their company's offices (${fmtM(data.limits.defaultRadiusM)} unless you set another), of one place, or of their field area.`}
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <PlusIcon size={16} aria-hidden="true" /> Add place
          </button>
        }
      >
        {active.length > 0 && (
          <Suspense fallback={<MapFallback height={240} />}>
            <GeoMap
              label={`${company.name}: check-in places`}
              height={240}
              circles={active.map((p): MapCircle => ({ lat: p.lat, lng: p.lng, radiusM: p.radiusM, tone: 'primary', label: `${p.name} (${fmtM(p.radiusM)})` }))}
              fitKey={`${company.id}-${active.map((p) => `${p.id}${p.lat}${p.lng}${p.radiusM}`).join()}`}
            />
          </Suspense>
        )}
        {places.length === 0 ? (
          <Empty title="No check-in place yet" action={<button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>Add the first place</button>}>
            Until a place is set, staff check-ins are recorded with their location but not checked against a place.
          </Empty>
        ) : (
          <ul className="ci-places">
            {places.map((p) => (
              <li key={p.id} data-archived={p.active ? undefined : ''}>
                <span className="ci-place-icon" aria-hidden="true">
                  <BuildingsIcon size={20} />
                </span>
                <span className="ci-place-main">
                  <span className="ci-place-name">
                    {p.name} {!p.active && <Chip tone="neutral">Archived</Chip>}
                  </span>
                  <span className="ci-place-sub">{p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}</span>
                  <span className="ci-place-sub">
                    Within {fmtM(p.radiusM)} · changed by {p.updatedBy}, {dateTimeLabel(p.updatedAt)}
                  </span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>
                  {p.active ? 'Edit' : 'Open'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <StaffRules key={company.id} company={company} staff={staff} onChanged={reload} />

      {editing && (
        <PlaceEditor
          company={company}
          place={editing === 'new' ? null : editing}
          limits={data.limits}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Add or change a place: search an address, drop or drag the pin, and set the radius while watching its circle. */
function PlaceEditor({
  company,
  place,
  limits,
  onClose,
  onSaved,
}: {
  company: Company;
  place: CheckinPlace | null;
  limits: CheckinSetup['limits'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(place?.name ?? '');
  const [address, setAddress] = useState(place?.address ?? '');
  const [touched, setTouched] = useState(!!place?.address);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(place ? { lat: place.lat, lng: place.lng } : null);
  const [radius, setRadius] = useState(place?.radiusM ?? limits.defaultRadiusM);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; key: string } | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'none' | 'off'>('idle');
  const search = useAction();
  const save = useAction();
  const seq = useRef(0);
  const others = company.places.filter((p) => p.active && p.id !== place?.id);

  // The street address for a dropped or dragged pin, unless the address was typed by hand.
  const lookUp = (lat: number, lng: number) => {
    if (touched) return;
    const n = ++seq.current;
    setLookup('busy');
    window.setTimeout(() => {
      if (n !== seq.current) return;
      api.geoReverse(lat, lng).then(
        (r) => {
          if (n !== seq.current) return;
          if (r.address) setAddress(r.address);
          setLookup(r.address ? 'idle' : r.status === 'off' ? 'off' : 'none');
        },
        () => n === seq.current && setLookup('none'),
      );
    }, 600);
  };

  const move = (lat: number, lng: number) => {
    setPin({ lat, lng });
    lookUp(lat, lng);
  };

  const runSearch = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 3) return;
    void search.run(async () => {
      const r = await api.geoSearch(q.trim());
      setResults(r.results);
      return r;
    });
  };

  const choose = (r: GeoResult) => {
    setPin({ lat: r.lat, lng: r.lng });
    setFocus({ lat: r.lat, lng: r.lng, zoom: 18, key: `${r.lat},${r.lng}` });
    if (!touched) setAddress(r.label);
    if (!name.trim()) setName(r.label.split(',')[0].slice(0, 80));
    setResults(null);
  };

  const here = () => {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        move(p.coords.latitude, p.coords.longitude);
        setFocus({ lat: p.coords.latitude, lng: p.coords.longitude, zoom: 18, key: `me-${Date.now()}` });
      },
      () => setLookup('none'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const max = Math.min(limits.place.max, 2_000);
  return (
    <Drawer title={place ? place.name : 'Add a check-in place'} sub={company.name} onClose={onClose}>
      <form className="ci-search" onSubmit={runSearch} role="search">
        <label className="k-search">
          <MagnifyingGlassIcon size={16} aria-hidden="true" />
          <input type="search" value={q} placeholder="Search an address or building" aria-label="Search an address or building" onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={search.busy || q.trim().length < 3}>
          {search.busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      <ErrorNotice error={search.error} />
      {results && (
        <ul className="ci-results" aria-label="Search results">
          {results.length === 0 && <li className="muted small">Nothing found. Try the building name and town, or drop the pin on the map.</li>}
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button type="button" onClick={() => choose(r)}>
                <MapPinIcon size={16} aria-hidden="true" />
                <span>{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Suspense fallback={<MapFallback height={320} />}>
        <GeoMap
          label="Tap the map to drop the pin; drag the pin to move it"
          height={320}
          pin={pin ? { ...pin, radiusM: radius } : null}
          onPin={move}
          focus={focus}
          circles={others.map((p): MapCircle => ({ lat: p.lat, lng: p.lng, radiusM: p.radiusM, tone: 'muted', label: p.name }))}
          fitKey={place?.id ?? 'new'}
        />
      </Suspense>
      <div className="row ci-map-tools">
        <span className="small muted">{pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : 'Tap the map, or search, to drop the pin.'}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={here}>
          <CrosshairIcon size={16} aria-hidden="true" /> Use where I am
        </button>
      </div>
      <label className="field">
        <span className="label">
          Allowed radius: <strong className="ci-radius-value">{fmtM(radius)}</strong>
        </span>
        <input
          type="range"
          className="ci-range"
          min={limits.place.min}
          max={max}
          step={5}
          value={Math.min(radius, max)}
          aria-valuetext={fmtM(radius)}
          onChange={(e) => setRadius(Number(e.target.value))}
          style={{ ['--fill' as string]: `${((Math.min(radius, max) - limits.place.min) / (max - limits.place.min)) * 100}%` }}
        />
        <span className="ss-note">Big compound or poor GPS indoors? Widen it. Most offices work well at 100 to 200 m.</span>
      </label>
      <label className="field">
        <span className="label">Name</span>
        <input className="input" value={name} maxLength={80} placeholder="Head office" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">
          Address {lookup === 'busy' && <span className="muted small">· looking it up…</span>}
          {lookup === 'none' && <span className="muted small">· no address found for the pin; type it</span>}
          {lookup === 'off' && <span className="muted small">· address lookup is off here; type it</span>}
        </span>
        <textarea
          className="textarea"
          value={address}
          maxLength={300}
          rows={2}
          onChange={(e) => {
            setAddress(e.target.value);
            setTouched(e.target.value.trim().length > 0);
          }}
        />
      </label>
      <ErrorNotice error={save.error} />
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={save.busy || !pin || name.trim().length < 2}
          onClick={() =>
            void save
              .run(() => api.saveCheckinPlace({ id: place?.id ?? null, companyId: company.id, name: name.trim(), address: address.trim(), lat: pin!.lat, lng: pin!.lng, radiusM: radius }), 'Place saved.')
              .then((r) => r !== undefined && onSaved())
          }
        >
          {save.busy ? 'Saving…' : 'Save place'}
        </button>
        {place && (
          <button
            type="button"
            className="btn"
            disabled={save.busy}
            onClick={() => void save.run(() => api.setCheckinPlaceActive(place.id, !place.active), place.active ? 'Place archived.' : 'Place restored.').then((r) => r !== undefined && onSaved())}
          >
            <ArchiveIcon size={16} aria-hidden="true" /> {place.active ? 'Archive' : 'Restore'}
          </button>
        )}
      </div>
    </Drawer>
  );
}

/** Who checks in where: search, filter by department, pick people (or a whole department), then set their rule. */
function StaffRules({ company, staff, onChanged }: { company: Company; staff: Staff[]; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const depts = useMemo(() => [...new Set(staff.map((s) => s.department ?? ''))].sort(), [staff]);
  const needle = q.trim().toLowerCase();
  const shown = staff.filter((s) => (dept === 'all' || (s.department ?? '') === dept) && (!needle || `${s.name} ${s.title}`.toLowerCase().includes(needle)));
  const pickable = shown.filter((s) => !s.own);
  const allPicked = pickable.length > 0 && pickable.every((s) => picked.has(s.userId));
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? (p.delete(id), new Set(p)) : new Set(p.add(id))));
  const chosen = staff.filter((s) => picked.has(s.userId));
  return (
    <Card title="Who checks in where" sub="Everyone checks in at their company's offices unless you set otherwise. Pick people, or a whole department, and set their rule." flush>
      <div className="ss-tools ci-tools">
        <Search value={q} onChange={setQ} placeholder="Search name or title" />
        <Select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="all">All departments</option>
          {depts.map((d) => (
            <option key={d} value={d}>
              {deptLabel(d || null)}
            </option>
          ))}
        </Select>
        <label className="ci-check">
          <input
            type="checkbox"
            checked={allPicked}
            disabled={!pickable.length}
            onChange={() =>
              setPicked((p) => {
                const n = new Set(p);
                for (const s of pickable) allPicked ? n.delete(s.userId) : n.add(s.userId);
                return n;
              })
            }
          />
          Select all shown ({pickable.length})
        </label>
      </div>
      <ul className="ss-rows ci-staff">
        {shown.length === 0 && <li className="empty">Nobody here.</li>}
        {shown.map((s) => {
          const r = ruleText(s, company.places);
          return (
            <li key={s.userId} className="ss-row" data-picked={picked.has(s.userId) ? '' : undefined}>
              <label className="ci-staff-pick">
                <input type="checkbox" checked={picked.has(s.userId)} disabled={s.own} onChange={() => toggle(s.userId)} aria-label={`Choose ${s.name}`} />
                <Person name={s.name} sub={`${s.title}${s.department ? ` · ${deptLabel(s.department)}` : ''}`} />
              </label>
              <span className="ss-row-side">
                {s.own ? <Chip tone="neutral">Yours: set by someone else</Chip> : <Chip tone={r.tone}>{r.text}</Chip>}
              </span>
            </li>
          );
        })}
      </ul>
      {chosen.length > 0 && (
        <div className="ci-pickbar" role="region" aria-label="Chosen staff">
          <span>
            <UsersThreeIcon size={18} aria-hidden="true" /> {chosen.length} chosen
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
            Clear
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
            Set where they check in
          </button>
        </div>
      )}
      {editing && (
        <RuleEditor
          company={company}
          staff={chosen}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setPicked(new Set());
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

/** 100 m to 300 km on one slider, finer at the small end (a slider position is not a straight line of metres). */
const ZMIN = 100;
const ZMAX = 300_000;
const toSlider = (m: number) => Math.round((Math.log(m / ZMIN) / Math.log(ZMAX / ZMIN)) * 1000);
const fromSlider = (v: number) => {
  const m = ZMIN * Math.pow(ZMAX / ZMIN, v / 1000);
  return m >= 10_000 ? Math.round(m / 1000) * 1000 : m >= 1000 ? Math.round(m / 100) * 100 : Math.round(m / 10) * 10;
};

function RuleEditor({ company, staff, onClose, onSaved }: { company: Company; staff: Staff[]; onClose: () => void; onSaved: () => void }) {
  const first = staff.length === 1 ? staff[0].rule : null;
  const active = company.places.filter((p) => p.active);
  const [kind, setKind] = useState<CheckinRuleKind>(first?.kind ?? 'office');
  const [placeId, setPlaceId] = useState(first?.placeId ?? active[0]?.id ?? '');
  const [zones, setZones] = useState<CheckinZone[]>(first?.zones ?? []);
  const [days, setDays] = useState<number[]>(first?.outstationWeekdays ?? []);
  const [trips, setTrips] = useState(first?.outstation ?? []);
  const [note, setNote] = useState(first?.note ?? '');
  const [sites, setSites] = useState<CheckinSites | null>(null);
  const [adding, setAdding] = useState(false);
  const [fit, setFit] = useState('start');
  const act = useAction();
  const loadSites = useAction();

  useEffect(() => {
    if (kind === 'field' && !sites) void loadSites.run(() => api.checkinSites(company.id).then((s) => (setSites(s), s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const addZone = (z: CheckinZone) => {
    setZones((x) => [...x, z].slice(0, 12));
    setFit(`z-${Date.now()}`);
  };
  const patch = (i: number, p: Partial<CheckinZone>) => setZones((x) => x.map((z, j) => (j === i ? { ...z, ...p } : z)));
  const valid = kind === 'office' || (kind === 'place' && !!placeId) || (kind === 'field' && zones.length > 0 && zones.every((z) => z.label.trim()) && trips.every((t) => t.from && t.to && t.from <= t.to));

  const save = () =>
    act
      .run(
        () =>
          api.setCheckinRules(
            staff.map((s) => s.userId),
            kind === 'office'
              ? { kind, note }
              : kind === 'place'
                ? { kind, placeId, note }
                : { kind, zones: zones.map((z) => ({ ...z, label: z.label.trim() })), outstationWeekdays: days, outstation: trips, note },
          ),
        (r) => `Updated ${r.updated} staff.`,
      )
      .then((r) => r !== undefined && onSaved());

  return (
    <Drawer title={staff.length === 1 ? staff[0].name : `${staff.length} staff`} sub="Where they check in" onClose={onClose}>
      <div className="ci-kinds" role="radiogroup" aria-label="Where they check in">
        {(['office', 'place', 'field'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="ci-kind" onClick={() => setKind(k)}>
            <span className="ci-kind-title">{KIND_LABEL[k]}</span>
            <span className="ci-kind-sub">
              {k === 'office'
                ? `Any office of ${company.name} (${active.length} set).`
                : k === 'place'
                  ? 'One place only, for example a client site office.'
                  : 'On-ground staff: their working areas, and outstation days.'}
            </span>
          </button>
        ))}
      </div>

      {kind === 'place' &&
        (active.length ? (
          <label className="field">
            <span className="label">Place</span>
            <Select className="select" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (within {fmtM(p.radiusM)})
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <p className="notice" data-tone="warn">
            Add a place first (Offices and places).
          </p>
        ))}

      {kind === 'field' && (
        <>
          <Suspense fallback={<MapFallback height={280} />}>
            <GeoMap
              label="Working areas"
              height={280}
              circles={[
                ...zones.map((z): MapCircle => ({ lat: z.lat, lng: z.lng, radiusM: z.radiusM, tone: 'primary', label: `${z.label} (${fmtM(z.radiusM)})` })),
                ...active.map((p): MapCircle => ({ lat: p.lat, lng: p.lng, radiusM: p.radiusM, tone: 'muted', label: p.name })),
              ]}
              onMapClick={adding ? (lat, lng) => (addZone({ label: `Area ${zones.length + 1}`, lat, lng, radiusM: 5_000 }), setAdding(false)) : undefined}
              fitKey={fit}
            />
          </Suspense>
          <div className="ci-add-zone">
            <Select
              className="select"
              value=""
              aria-label="Add a state capital"
              onChange={(e) => {
                const c = STATE_CAPITALS.find((x) => x.city === e.target.value);
                if (c) addZone({ label: `${c.city} and around`, lat: c.lat, lng: c.lng, radiusM: 50_000 });
              }}
            >
              <option value="">+ A state capital (50 km)</option>
              {STATE_CAPITALS.map((c) => (
                <option key={c.city} value={c.city}>
                  {c.city}, {c.state}
                </option>
              ))}
            </Select>
            <Select
              className="select"
              value=""
              aria-label="Add a site"
              disabled={!sites?.length}
              onChange={(e) => {
                const s = sites?.find((x) => x.id === e.target.value);
                if (s) addZone({ label: s.name.slice(0, 80), lat: s.lat, lng: s.lng, radiusM: Math.max(s.radiusM, 100) });
              }}
            >
              <option value="">{loadSites.busy ? 'Loading sites…' : sites?.length ? `+ A site they cover (${sites.length})` : 'No sites with a location'}</option>
              {sites?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.code} · ` : ''}
                  {s.name}
                </option>
              ))}
            </Select>
            <button type="button" className="btn btn-sm" aria-pressed={adding} onClick={() => setAdding((x) => !x)}>
              <MapPinIcon size={16} aria-hidden="true" /> {adding ? 'Tap the map…' : 'Drop on the map'}
            </button>
          </div>
          {zones.length === 0 && <p className="ss-note">Add at least one working area. They may also check in at any office of the company.</p>}
          <ul className="ci-zones">
            {zones.map((z, i) => (
              <li key={i}>
                <input className="input" value={z.label} maxLength={80} aria-label={`Name of area ${i + 1}`} onChange={(e) => patch(i, { label: e.target.value })} />
                <label className="ci-zone-radius">
                  <span className="small">
                    Within <strong>{fmtM(z.radiusM)}</strong>
                  </span>
                  <input
                    type="range"
                    className="ci-range"
                    min={0}
                    max={1000}
                    value={toSlider(z.radiusM)}
                    aria-label={`Radius of ${z.label || `area ${i + 1}`}`}
                    aria-valuetext={fmtM(z.radiusM)}
                    onChange={(e) => patch(i, { radiusM: fromSlider(Number(e.target.value)) })}
                    style={{ ['--fill' as string]: `${toSlider(z.radiusM) / 10}%` }}
                  />
                </label>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${z.label}`} onClick={() => setZones((x) => x.filter((_, j) => j !== i))}>
                  <TrashIcon size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          <div className="field">
            <span className="label">
              <AirplaneTiltIcon size={14} aria-hidden="true" /> Outstation every week (anywhere allowed, still recorded)
            </span>
            <div className="ci-days" role="group" aria-label="Outstation weekdays">
              {WEEKDAYS.map((d, i) => (
                <button key={d} type="button" aria-pressed={days.includes(i + 1)} onClick={() => setDays((x) => (x.includes(i + 1) ? x.filter((y) => y !== i + 1) : [...x, i + 1]))}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Outstation trips</span>
            {trips.map((t, i) => (
              <div key={i} className="ci-trip">
                <input type="date" className="input" value={t.from} aria-label="From" onChange={(e) => setTrips((x) => x.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)))} />
                <input type="date" className="input" value={t.to} aria-label="To" onChange={(e) => setTrips((x) => x.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)))} />
                <input className="input" value={t.note} maxLength={200} placeholder="Where, why" aria-label="Note" onChange={(e) => setTrips((x) => x.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove trip" onClick={() => setTrips((x) => x.filter((_, j) => j !== i))}>
                  <TrashIcon size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm ci-add-trip" disabled={trips.length >= 24} onClick={() => setTrips((x) => [...x, { from: '', to: '', note: '' }])}>
              <PlusIcon size={16} aria-hidden="true" /> Add a trip
            </button>
          </div>
        </>
      )}

      <label className="field">
        <span className="label">Note (optional, kept in the audit trail)</span>
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorNotice error={act.error} />
      <ErrorNotice error={loadSites.error} />
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={act.busy || !valid} onClick={() => void save()}>
          {act.busy ? 'Saving…' : `Apply to ${staff.length === 1 ? staff[0].name : `${staff.length} staff`}`}
        </button>
      </div>
    </Drawer>
  );
}

type Review = CheckinReviews['open'][number];

/** Flagged and refused check-ins, for the manager or HR: open first; each one opens with its map. */
export function CheckinReviewView() {
  const { data, error, reload } = useLoad(() => api.checkinReviews(), []);
  const [open, setOpen] = useState<Review | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="check-ins to review" />;
  return (
    <div className="ci-setup">
      <Card title={`To review (${data.open.length})`} sub="Check-ins outside the allowed area, with the staff member's reason, and refused attempts." flush>
        <ul className="ss-rows">
          {data.open.length === 0 && (
            <li className="empty">Nothing to review. Check-ins outside the area appear here.</li>
          )}
          {data.open.map((e) => (
            <li key={e.id}>
              <ReviewRow e={e} onOpen={() => setOpen(e)} />
            </li>
          ))}
        </ul>
      </Card>
      {data.decided.length > 0 && (
        <details className="ci-decided">
          <summary>Reviewed in the last 30 days ({data.decided.length})</summary>
          <ul className="ss-rows">
            {data.decided.map((e) => (
              <li key={e.id}>
                <ReviewRow e={e} onOpen={() => setOpen(e)} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {open && (
        <ReviewDrawer
          e={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ReviewRow({ e, onOpen }: { e: Review; onOpen: () => void }) {
  const done = e.review?.status !== 'open';
  return (
    <button type="button" className="ss-row ss-board-row" data-tone={done ? undefined : 'warn'} onClick={onOpen}>
      <Person name={e.userName} sub={`${e.kind === 'in' ? 'Check-in' : 'Check-out'} ${dateTimeLabel(e.at)} · ${whereText(e)}`} />
      <span className="ss-board-times">
        <span className="ss-meta">{e.reason ? `"${e.reason}"` : 'No reason given'}</span>
        <span className="ss-meta">{addressText(e)}</span>
      </span>
      <span className="ss-row-side">
        {done ? (
          <Chip tone={e.review?.status === 'cleared' ? 'ok' : 'warn'}>{e.review?.status === 'cleared' ? 'Reason accepted' : 'Followed up'}</Chip>
        ) : (
          <Chip tone={OUTCOME[e.outcome].tone}>{OUTCOME[e.outcome].label}</Chip>
        )}
      </span>
    </button>
  );
}

function ReviewDrawer({ e, onClose, onDone }: { e: Review; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const open = e.review?.status === 'open';
  return (
    <Drawer title={e.userName} sub={`${e.kind === 'in' ? 'Check-in' : 'Check-out'} · ${dateTimeLabel(e.at)}`} onClose={onClose}>
      <div className="ss-chips">
        <Chip tone={VERDICT[e.verdict].tone}>{VERDICT[e.verdict].label}</Chip>
        <Chip tone={OUTCOME[e.outcome].tone}>{OUTCOME[e.outcome].label}</Chip>
        {e.outstation && <Chip tone="info">Outstation day</Chip>}
      </div>
      <Suspense fallback={<MapFallback height={280} />}>
        <GeoMap
          label="Where the check-in was made, and the allowed places"
          height={280}
          circles={e.targets.map((t): MapCircle => ({ lat: t.lat, lng: t.lng, radiusM: t.radiusM, tone: 'primary', label: `${t.label} (${fmtM(t.radiusM)})` }))}
          points={[{ lat: e.lat, lng: e.lng, accuracyM: e.accuracyM, tone: e.outcome === 'blocked' ? 'crit' : 'warn', label: e.userName }]}
          fitKey={e.id}
        />
      </Suspense>
      <Facts
        items={[
          ['Where', whereText(e)],
          ['Address', addressText(e)],
          ['Point', `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)} ±${e.accuracyM} m`],
          ['Server time', dateTimeLabel(e.at)],
          ['Phone time', dateTimeLabel(e.capturedAt)],
          ['Reason', e.reason ?? 'None given'],
          ['Face check', e.face ? `Match ${Math.round(e.face.score * 100)}%${e.face.live ? '' : ', face did not move'}` : 'Not done with this check-in'],
        ]}
      />
      {!open && e.review && (
        <p className="notice" data-tone={e.review.status === 'cleared' ? 'ok' : 'warn'}>
          {e.review.status === 'cleared' ? 'Reason accepted' : 'Followed up'} by {e.review.by}: {e.review.note}
        </p>
      )}
      {open && e.own && <p className="notice" data-tone="info">Your own check-in: someone else reviews it.</p>}
      {open && !e.own && (
        <>
          <label className="field">
            <span className="label">Comment (needed)</span>
            <textarea className="textarea" value={note} maxLength={500} onChange={(x) => setNote(x.target.value)} placeholder="For example: confirmed with the client, meeting at their office" />
          </label>
          <ErrorNotice error={act.error} />
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={act.busy || !note.trim()} onClick={() => void act.run(() => api.decideCheckin(e.id, 'cleared', note), 'Reason accepted.').then((r) => r !== undefined && onDone())}>
              Accept the reason
            </button>
            <button type="button" className="btn" disabled={act.busy || !note.trim()} onClick={() => void act.run(() => api.decideCheckin(e.id, 'upheld', note), 'Marked to follow up.').then((r) => r !== undefined && onDone())}>
              Follow up
            </button>
          </div>
        </>
      )}
    </Drawer>
  );
}
