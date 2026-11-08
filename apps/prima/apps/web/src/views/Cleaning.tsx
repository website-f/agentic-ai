// Cleaning planner (Fauzan, 4 Nov 2026). The OM who covers a site sets up its scope (areas and sizes from the client's
// contract), uploads the site map, makes and publishes each day's minute-by-minute plan for every cleaner and supervisor,
// and records what the supervisor reports with time-marked photos. Gov Ops (OGM) monitors every site; the company manager
// views only. Cleaners and supervisors do not sign in yet.
import { Select } from '../SearchSelect';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CLEANING_DEFAULT_RATE,
  CLEANING_RULES,
  CLEANING_TIMING_KEYS,
  CLEANING_TIMING_LABEL,
  CLEANING_UNIT_LABEL,
  CLEANING_WORK_LABEL,
  addDays,
  dateOf,
  frequencyLabel,
  kpmSchoolAreas,
  kpmSchoolStock,
  kpmWeek,
  minutesFor,
  type CleaningArea,
  type CleaningCrewMember,
  type CleaningTask,
  type CleaningWorkKind,
} from '@prima/core';
import { api, type CleaningProofInput, type CleaningSetupInput, type CleaningSiteView, type StockLineInput } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';

const MAX_PHOTO = 700_000;
const MAX_MAP = 2_000_000;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function readFile(f: Blob): Promise<string> {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => bad(new Error('The file could not be read.'));
    r.readAsDataURL(f);
  });
}

/**
 * A time-marked photo from the supervisor. The OM types the time printed on the photo; the server compares it with
 * the camera's own time inside the file and refuses another day or a photo used before. The file is sent as taken
 * (shrinking it would remove the camera time), so it must be under 700 KB.
 */
export function TimeMarkedPhoto({ date, value, onChange, label = "Supervisor's time-marked photo" }: { date: string; value: CleaningProofInput | null; onChange: (p: CleaningProofInput | null) => void; label?: string }) {
  const [image, setImage] = useState<string | null>(value?.image ?? null);
  const [time, setTime] = useState(value?.stampedAt?.slice(11, 16) ?? '');
  const [err, setErr] = useState<string | null>(null);
  // A new file input after each save, so the same file can be chosen again (and is then refused as used before).
  const [inputKey, setInputKey] = useState(0);
  const had = useRef(false);
  useEffect(() => {
    // Clear only when a ready proof was taken away (saved or reset), not on first show.
    if (!value && had.current) {
      setImage(null);
      setTime('');
      setInputKey((k) => k + 1);
    }
    had.current = !!value;
  }, [value]);
  // The proof is ready once both the photo and the printed time are in, whichever comes last.
  const push = (img: string | null, t: string) => onChange(img && /^\d{2}:\d{2}$/.test(t) ? { image: img, stampedAt: `${date}T${t}` } : null);
  useEffect(() => {
    if (image && /^\d{2}:\d{2}$/.test(time) && (value?.image !== image || value?.stampedAt !== `${date}T${time}`)) push(image, time);
  }, [image, time]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="field">
      <span className="label">{label}</span>
      <input
        key={inputKey}
        className="input"
        type="file"
        accept="image/jpeg,image/png"
        aria-label="Time-marked photo"
        onChange={async (e) => {
          setErr(null);
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > MAX_PHOTO) {
            setErr('This photo is over 700 KB. Ask the supervisor to send it at a smaller size from the time-mark camera app; shrinking it here would remove the camera time.');
            return;
          }
          const d = await readFile(f);
          setImage(d);
        }}
      />
      <label className="field">
        <span className="small muted">Time printed on the photo ({dateLabel(date)})</span>
        <input
          className="input"
          type="time"
          aria-label="Time printed on the photo"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            push(image, e.target.value);
          }}
          style={{ maxWidth: 160 }}
        />
      </label>
      {image && <img src={image} alt="Proof preview" style={{ maxWidth: 160, borderRadius: 6, border: '1px solid var(--line)' }} />}
      {err && <div className="notice" data-tone="warn">{err}</div>}
      <div className="notice" data-tone="info">
        Ask the supervisor to send time-stamp photos by <strong>email</strong>, not WhatsApp. WhatsApp removes the camera's own time from the file, so the photo can only be marked "camera time removed".
      </div>
      <span className="small muted">An ordinary photo is not accepted: the photo must show the date and time printed on it. The app also reads the camera's time in the file and refuses a photo from another day or one used before.</span>
    </div>
  );
}

const STATUS_TONE: Record<CleaningTask['status'], Tone> = { planned: 'neutral', done: 'info', checked: 'ok', redo: 'warn', missed: 'crit', not_needed: 'neutral' };
const STATUS_LABEL: Record<CleaningTask['status'], string> = { planned: 'Planned', done: 'Done', checked: 'Checked', redo: 'Redo', missed: 'Missed', not_needed: 'Not needed today' };

export function CleaningView() {
  const { me } = useApp();
  const today = dateOf(me.now);
  const [date, setDate] = useState(today);
  const [siteId, setSiteId] = useState<string | null>(null);
  const board = useLoad(() => api.cleaningBoard(date), [date]);
  if (siteId) return <CleaningSite siteId={siteId} date={date} setDate={setDate} onBack={() => setSiteId(null)} />;
  const b = board.data;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cleaning plans</h1>
          <p>Each site's daily roster and minute-by-minute plan for cleaners and supervisors, from the client's scope and the size of each area.</p>
        </div>
        <div className="row">
          <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
      </div>
      <ErrorNotice error={board.error} />
      {!b && !board.error && <Loading what="cleaning sites" />}
      {b && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Sites with cleaning</h2>
              <Chip tone="neutral">{b.rows.length}</Chip>
            </div>
            {!b.rows.length && <div className="empty">No cleaning sites you can see yet.</div>}
            <div className="list">
              {b.rows.map((r) => (
                <button key={r.siteId} className="list-item link-button" style={{ width: '100%', textAlign: 'left' }} onClick={() => setSiteId(r.siteId)}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.siteName}</div>
                    <div className="small muted">
                      {r.companyName} · {r.client}
                    </div>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    {!r.working ? (
                      <Chip tone="neutral">Rest day</Chip>
                    ) : !r.day ? (
                      <Chip tone="warn">No plan yet</Chip>
                    ) : r.day.status === 'draft' ? (
                      <Chip tone="warn">Draft, not published</Chip>
                    ) : (
                      <Chip tone="ok">Published</Chip>
                    )}
                    {r.day && (
                      <Chip tone={r.tasks.missed ? 'crit' : r.tasks.redo ? 'warn' : 'neutral'}>
                        {r.tasks.done}/{r.tasks.total} done · {r.tasks.checked} checked
                      </Chip>
                    )}
                    {r.day && r.day.summary.headcountShort > 0 && <Chip tone="crit">{r.day.summary.headcountShort} short of contract</Chip>}
                    {r.day && r.day.uncovered > 0 && <Chip tone="warn">{r.day.uncovered} jobs not covered</Chip>}
                    {r.stockFlags > 0 && <Chip tone="warn">{r.stockFlags} stock flags</Chip>}
                    {r.noStockCheck && <Chip tone="unknown">No stock check</Chip>}
                    {r.slipsOutstanding > 0 && <Chip tone="warn">{r.slipsOutstanding} work days waiting for the client's slip</Chip>}
                    {r.problems > 0 && <Chip tone="warn">{r.problems} set-up gaps</Chip>}
                    <Chip tone={r.access === 'manage' ? 'info' : 'neutral'}>{r.access === 'manage' ? 'You manage' : 'View only'}</Chip>
                  </div>
                </button>
              ))}
            </div>
          </section>
          {b.startable.length > 0 && <StartCleaning sites={b.startable} today={today} onStarted={setSiteId} />}
        </>
      )}
    </div>
  );
}

function StartCleaning({ sites, today, onStarted }: { sites: { siteId: string; siteName: string; companyName: string }[]; today: string; onStarted: (id: string) => void }) {
  const [siteId, setSiteId] = useState(sites[0].siteId);
  const [f, setF] = useState({ contractRef: '', headcount: 5, acres: '', blocks: '', floors: '', toilets: '', twoSession: false, weekend: 'sat_sun' as 'sat_sun' | 'fri_sat', wage: '' });
  const act = useAction();
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const start = () =>
    act.run(async () => {
      const facts = { acres: num(f.acres), blocks: num(f.blocks), floors: num(f.floors), toiletCubicles: num(f.toilets) };
      const stock = kpmSchoolStock();
      const n = Math.max(2, f.headcount);
      // Contract: two-session schools split the crew 60:40; session 2 works 9am-6pm.
      const second = f.twoSession ? Math.round((n - 1) * 0.4) : 0;
      const crew: CleaningCrewMember[] = Array.from({ length: n }, (_, i) => ({
        id: `w${i + 1}`,
        name: i === 0 ? 'Supervisor (enter name)' : `Cleaner ${i} (enter name)`,
        role: i === 0 ? 'supervisor' : 'cleaner',
        session: i > 0 && i > n - 1 - second ? 2 : 1,
        personId: null,
      }));
      const setup: CleaningSetupInput = {
        template: 'kpm_school',
        contractRef: f.contractRef.trim(),
        requiredHeadcount: f.headcount,
        facts,
        week: kpmWeek(f.weekend),
        secondSession: f.twoSession ? { start: '09:00', end: '18:00' } : null,
        closedDays: [],
        cycleStart: today,
        monthlyWage: num(f.wage),
        crew,
        areas: kpmSchoolAreas(facts, f.twoSession),
        equipment: stock.equipment,
        supplies: stock.supplies,
      };
      await api.cleaningSaveSetup(siteId, setup, null);
      onStarted(siteId);
    }, 'Cleaning started on this site. Measure the areas and enter the crew names next.');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Start cleaning on a site</h2>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
        <p className="small muted">Starts from the KPM school template (Jadual 1A scope, Lampiran A1 hours). You can change every area, size and time afterwards.</p>
        <div className="grid-2">
          <label className="field">
            <span className="label">Site</span>
            <Select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => (
                <option key={s.siteId} value={s.siteId}>
                  {s.siteName} · {s.companyName}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="label">Contract or letter reference</span>
            <input className="input" value={f.contractRef} onChange={(e) => setF({ ...f, contractRef: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Workers the contract requires each day</span>
            <input className="input" type="number" min={1} value={f.headcount} onChange={(e) => setF({ ...f, headcount: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span className="label">Monthly wage per worker, RM (for the deduction estimate)</span>
            <input className="input" type="number" min={0} value={f.wage} onChange={(e) => setF({ ...f, wage: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Acres (Lampiran A2)</span>
            <input className="input" type="number" min={0} step="0.1" value={f.acres} onChange={(e) => setF({ ...f, acres: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Toilet cubicles</span>
            <input className="input" type="number" min={0} value={f.toilets} onChange={(e) => setF({ ...f, toilets: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Blocks</span>
            <input className="input" type="number" min={0} value={f.blocks} onChange={(e) => setF({ ...f, blocks: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Floors</span>
            <input className="input" type="number" min={0} value={f.floors} onChange={(e) => setF({ ...f, floors: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Weekend</span>
            <select className="select" value={f.weekend} onChange={(e) => setF({ ...f, weekend: e.target.value as 'sat_sun' | 'fri_sat' })}>
              <option value="sat_sun">Saturday half day, Sunday rest</option>
              <option value="fri_sat">Friday rest, Saturday half day</option>
            </select>
          </label>
          <label className="row" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={f.twoSession} onChange={(e) => setF({ ...f, twoSession: e.target.checked })} />
            <span>Two-session school (crew split 60:40, session 2 works 9am to 6pm)</span>
          </label>
        </div>
        <ErrorNotice error={act.error} />
        <div>
          <button className="btn btn-primary" disabled={act.busy} onClick={start}>
            Start cleaning on this site
          </button>
        </div>
      </div>
    </section>
  );
}

type Tab = 'plan' | 'setup' | 'map' | 'stock' | 'slips' | 'month';

function CleaningSite({ siteId, date, setDate, onBack }: { siteId: string; date: string; setDate: (d: string) => void; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('plan');
  const data = useLoad(() => api.cleaningSite(siteId, date), [siteId, date]);
  const d = data.data;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            ‹ All cleaning sites
          </button>
          <h1>{d?.site.name ?? 'Cleaning site'}</h1>
          {d && (
            <p>
              {d.site.client} {d.setup?.contractRef ? `· ${d.setup.contractRef}` : ''}{' '}
              <Chip tone={d.access === 'manage' ? 'info' : 'neutral'}>{d.access === 'manage' ? 'You manage this site' : 'View only'}</Chip>
            </p>
          )}
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            ‹
          </button>
          <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ maxWidth: 170 }} />
          <button className="btn btn-sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
            ›
          </button>
        </div>
      </div>
      <div className="seg" role="tablist" style={{ flexWrap: 'wrap' }}>
        {(
          [
            ['plan', 'Day plan'],
            ['setup', 'Scope and crew'],
            ['map', 'Site map'],
            ['stock', 'Supplies and equipment'],
            ['slips', 'Client slips'],
            ['month', 'Monthly report'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <ErrorNotice error={data.error} />
      {!d && !data.error && <Loading what="site plan" />}
      {d && !d.setup && <div className="empty">Cleaning is not set up on this site.</div>}
      {d && d.setup && tab === 'plan' && <DayPlan d={d} />}
      {d && d.setup && tab === 'setup' && <SetupEditor d={d} />}
      {d && d.setup && tab === 'map' && <SiteMap d={d} />}
      {d && d.setup && tab === 'stock' && <Stock d={d} />}
      {d && d.setup && tab === 'slips' && <ClientSlips d={d} />}
      {d && d.setup && tab === 'month' && <Monthly siteId={siteId} date={date} />}
    </div>
  );
}

// ---------- Day plan ----------

function DayPlan({ d }: { d: CleaningSiteView }) {
  const { me } = useApp();
  const setup = d.setup!;
  const day = d.day;
  const plan = day ?? d.preview;
  const manage = d.access === 'manage';
  const [absent, setAbsent] = useState<string[]>(day?.absentIds ?? []);
  const [picked, setPicked] = useState<string[]>([]);
  const [proofOf, setProofOf] = useState<string | null>(null);
  const act = useAction();
  useEffect(() => setAbsent(day?.absentIds ?? []), [day?.id, day?.planVersion]);
  useEffect(() => setPicked([]), [d.date, day?.planVersion]);
  const nowHm = me.now.slice(11, 16);
  const isToday = d.date === d.today;
  if (!plan) return <div className="empty">{d.problems.length ? 'Fix the set-up gaps first.' : 'Not a working day at this site.'}</div>;
  const s = plan.summary;
  const crew = setup.crew;
  const byCrew = new Map<string, CleaningTask[]>();
  for (const t of plan.tasks) byCrew.set(t.crewId, [...(byCrew.get(t.crewId) ?? []), t]);
  const canRecord = manage && day?.status === 'published' && d.date <= d.today;
  const tasks = new Map(plan.tasks.map((t) => [t.id, t]));
  return (
    <>
      {d.problems.length > 0 && (
        <div className="notice" data-tone="warn">
          <strong>Set-up gaps:</strong> {d.problems.join(' ')}
        </div>
      )}
      <section className="kpis">
        <Kpi label="Contract headcount" value={s.requiredHeadcount} />
        <Kpi label="Present (cleaners + supervisors)" value={s.presentCleaners + s.supervisors} tone={s.headcountShort ? 'crit' : 'ok'} note={s.headcountShort ? `${s.headcountShort} short` : 'Full'} />
        <Kpi label="Deduction estimate" value={s.deductionEstimate == null ? '–' : `RM ${s.deductionEstimate.toFixed(2)}`} note="wage ÷ 30.5 × missing" tone={s.deductionEstimate ? 'crit' : 'neutral'} />
        <Kpi label="Planned work" value={`${Math.round(s.workMinutes / 60)} h`} note={`of ${Math.round(s.availableMinutes / 60)} h available`} />
        <Kpi label="Not covered" value={`${s.uncoveredMinutes} min`} tone={s.uncoveredMinutes ? 'warn' : 'ok'} note={s.uncoveredMinutes ? `${s.cleanersNeeded} cleaners needed` : 'All due work fits'} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{day ? (day.status === 'published' ? 'Published plan' : 'Draft plan, not yet published') : 'Preview (not saved)'}</h2>
          <div className="row">
            {day?.publishedAt && <Chip tone="ok">Published by {day.publishedBy}</Chip>}
            {plan.hours && (
              <Chip tone="neutral">
                {plan.hours.start}–{plan.hours.end}, break {plan.hours.breakMin} min in turns
              </Chip>
            )}
          </div>
        </div>
        {manage && d.date >= d.today && (
          <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
            <div className="small muted">Mark who is absent, then make the plan. On a published day the plan is made again from now, keeping what is already recorded.</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {crew.map((c) => (
                <label key={c.id} className="row small" style={{ gap: 4 }}>
                  <input type="checkbox" checked={absent.includes(c.id)} onChange={(e) => setAbsent(e.target.checked ? [...absent, c.id] : absent.filter((x) => x !== c.id))} />
                  Absent: {c.name}
                </label>
              ))}
            </div>
            <div className="row">
              <button className="btn" disabled={act.busy} onClick={() => act.run(() => api.cleaningPlan(d.site.id, d.date, absent), 'Plan made. Check it, then publish.')}>
                {day ? 'Make the plan again' : 'Make the plan'}
              </button>
              <button className="btn btn-primary" disabled={act.busy || !day || day.status === 'published'} onClick={() => act.run(() => api.cleaningPublish(d.site.id, d.date), 'Plan published for the supervisor.')}>
                Publish
              </button>
            </div>
          </div>
        )}
        <ErrorNotice error={act.error} />
        <div className="table-wrap">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, crew.length)}, minmax(220px, 1fr))`, gap: 12, padding: 12 }}>
            {crew.map((c) => {
              const out = plan.tasks.length && !(byCrew.get(c.id) ?? []).length;
              return (
                <div key={c.id} data-testid={`crew-${c.id}`}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="small muted">
                    {c.role === 'supervisor' ? 'Supervisor' : 'Cleaner'}
                    {setup.secondSession ? ` · session ${c.session}` : ''}
                    {(day?.absentIds ?? []).includes(c.id) ? ' · absent' : ''}
                  </div>
                  {out && <div className="small muted">No tasks</div>}
                  <ol className="timeline" style={{ marginTop: 8 }}>
                    {(byCrew.get(c.id) ?? []).map((t) => {
                      const live = isToday && t.start <= nowHm && nowHm < t.end;
                      // Work already due can be recorded; later work today can also be marked not needed.
                      const pickable = canRecord && t.type === 'work' && (t.start <= (isToday ? nowHm : '24:00') || (isToday && t.status === 'planned'));
                      return (
                        <li key={t.id} style={live ? { background: 'var(--surface-2)', borderRadius: 6 } : undefined}>
                          <time>
                            {t.start}
                            <br />
                            {t.end}
                          </time>
                          <div>
                            <label className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                              {pickable && (
                                <input type="checkbox" aria-label={`Pick ${t.title}`} checked={picked.includes(t.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} />
                              )}
                              <span style={{ fontWeight: t.type === 'work' ? 600 : 400, textDecoration: t.status === 'not_needed' ? 'line-through' : undefined, opacity: t.status === 'not_needed' ? 0.6 : 1 }}>{t.title}</span>
                            </label>
                            <div className="row small" style={{ gap: 4 }}>
                              <span className="muted">{t.minutes} min</span>
                              {t.part && <span className="muted">part {t.part.n}/{t.part.of}</span>}
                              {t.late && <Chip tone="warn">After client's time</Chip>}
                              {(t.type === 'work' || t.type === 'inspect') && <Chip tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Chip>}
                              {live && <Chip tone="info">Now</Chip>}
                            </div>
                            {t.note && <div className="small muted">{t.note}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {canRecord && <RecordBar siteId={d.site.id} date={d.date} today={d.today} picked={picked.map((id) => tasks.get(id)!).filter(Boolean)} onDone={() => setPicked([])} />}

      {plan.uncovered.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Due work not covered today</h2>
            <Chip tone="warn">{plan.uncovered.length}</Chip>
          </div>
          <div className="list">
            {plan.uncovered.map((u) => (
              <div key={u.jobKey} className="list-item">
                <div>
                  <div>{u.title}</div>
                  <div className="small muted">{u.reason}</div>
                </div>
                <span className="mono small">{u.minutes} min</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {plan.watchList.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Supervisor's watch list (always or as needed)</h2>
          </div>
          <div className="list">
            {plan.watchList.map((w) => (
              <div key={w.areaId} className="list-item">
                <div>
                  <div>{w.title}</div>
                  <div className="small muted">{w.quality}</div>
                </div>
                <Chip tone="neutral">{w.kind === 'always' ? 'Always' : 'As needed'}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Proof photos</h2>
          <Chip tone="neutral">{d.proofs.length}</Chip>
        </div>
        {!d.proofs.length && <div className="empty">No proof yet.</div>}
        <div className="list">
          {d.proofs.slice(0, 30).map((p) => (
            <div key={p.id} className="list-item">
              <div>
                <div>{p.caption}</div>
                <div className="small muted">
                  Time on photo {p.timeMark?.stampedAt.replace('T', ' ') ?? '–'} · uploaded by {p.uploadedBy}
                </div>
              </div>
              <div className="row">
                {p.timeMarkLabel && <Chip tone={p.timeMark?.check === 'matches' ? 'ok' : p.timeMark?.check === 'differs' ? 'crit' : 'unknown'}>{p.timeMarkLabel}</Chip>}
                <button className="btn btn-sm" onClick={() => setProofOf(p.id)}>
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {proofOf && <ProofDrawer siteId={d.site.id} docId={proofOf} onClose={() => setProofOf(null)} />}
    </>
  );
}

function RecordBar({ siteId, date, today, picked, onDone }: { siteId: string; date: string; today: string; picked: CleaningTask[]; onDone: () => void }) {
  const [action, setAction] = useState<'done' | 'checked' | 'redo' | 'missed' | 'not_needed'>('done');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<CleaningProofInput | null>(null);
  const act = useAction();
  const needsPhoto = action === 'checked' || action === 'redo' || action === 'not_needed';
  const needsReason = action === 'redo' || action === 'missed' || action === 'not_needed';
  const areas = new Set(picked.map((t) => t.areaId));
  const save = async () => {
    const r = await act.run(
      () =>
        api.cleaningRecord(siteId, date, {
          taskIds: picked.map((t) => t.id),
          action,
          note,
          proof: needsPhoto ? proof : null,
          expectedStatuses: Object.fromEntries(picked.map((t) => [t.id, t.status])),
        }),
      `${picked.length} task${picked.length === 1 ? '' : 's'} recorded as ${STATUS_LABEL[action].toLowerCase()}.`,
    );
    if (r) {
      setNote('');
      setProof(null);
      onDone();
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Record the supervisor's report</h2>
        <Chip tone={picked.length ? 'info' : 'neutral'}>{picked.length} picked</Chip>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
        {!picked.length && <div className="small muted">Tick the tasks in the plan above that the supervisor reported on.</div>}
        <div className="seg">
          {(['done', 'checked', 'redo', 'missed', ...(date === today ? (['not_needed'] as const) : [])] as const).map((a) => (
            <button key={a} aria-pressed={action === a} onClick={() => setAction(a)}>
              {STATUS_LABEL[a]}
            </button>
          ))}
        </div>
        {action === 'not_needed' && (
          <div className="notice" data-tone="info">
            Use this when the supervisor sees the area does not need the job today (for example the drains are already clean). Give the reason and a time-stamp photo of the area. The rest of today is planned again at once, so the freed time goes to other work that is due.
          </div>
        )}
        {needsPhoto && areas.size > 1 && <div className="notice" data-tone="warn">One photo covers one area. Pick tasks from one area at a time.</div>}
        {needsPhoto && <TimeMarkedPhoto date={date} value={proof} onChange={setProof} />}
        <label className="field">
          <span className="label">{needsReason ? 'Reason (required)' : 'Note'}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorNotice error={act.error} />
        <div>
          <button className="btn btn-primary" disabled={act.busy || !picked.length || (needsPhoto && !proof) || (needsReason && !note.trim())} onClick={save}>
            Record {picked.length || ''} as {STATUS_LABEL[action].toLowerCase()}
          </button>
        </div>
      </div>
    </section>
  );
}

function ProofDrawer({ siteId, docId, onClose }: { siteId: string; docId: string; onClose: () => void }) {
  const p = useLoad(() => api.cleaningProof(siteId, docId), [siteId, docId]);
  return (
    <Drawer title="Proof" sub={p.data?.caption} onClose={onClose}>
      <ErrorNotice error={p.error} />
      {p.data && p.data.mime !== 'application/pdf' && <img src={p.data.data} alt={p.data.caption} style={{ maxWidth: '100%' }} />}
      {p.data && p.data.mime === 'application/pdf' && (
        <a className="btn btn-sm" href={p.data.data} download={p.data.name}>
          Download the PDF
        </a>
      )}
      {p.data?.timeMark && (
        <div className="small">
          Printed time {p.data.timeMark.stampedAt.replace('T', ' ')} · camera time {p.data.timeMark.cameraAt?.replace('T', ' ') ?? 'not in the file'}
        </div>
      )}
    </Drawer>
  );
}

// ---------- Scope and crew ----------

const KINDS = Object.keys(CLEANING_DEFAULT_RATE) as CleaningWorkKind[];

function SetupEditor({ d }: { d: CleaningSiteView }) {
  const setup = d.setup!;
  const manage = d.access === 'manage';
  const toInput = (): CleaningSetupInput => {
    const { id: _i, companyId: _c, siteId: _s, map: _m, version: _v, updatedBy: _u, updatedAt: _a, ...rest } = setup;
    return structuredClone(rest);
  };
  const [draft, setDraft] = useState<CleaningSetupInput>(toInput);
  useEffect(() => setDraft(toInput()), [setup.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = useAction();
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(toInput()), [draft, setup.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const setArea = (i: number, patch: Partial<CleaningArea>) => setDraft({ ...draft, areas: draft.areas.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const setCrew = (i: number, patch: Partial<CleaningCrewMember>) => setDraft({ ...draft, crew: draft.crew.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const nextId = (prefix: string, ids: string[]) => {
    let n = ids.length + 1;
    while (ids.includes(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Contract and hours</h2>
          <Chip tone="neutral">Version {setup.version}</Chip>
        </div>
        <div className="panel-body grid-2">
          <label className="field">
            <span className="label">Contract reference</span>
            <input className="input" disabled={!manage} value={draft.contractRef} onChange={(e) => setDraft({ ...draft, contractRef: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Workers required each day</span>
            <input className="input" type="number" disabled={!manage} value={draft.requiredHeadcount} onChange={(e) => setDraft({ ...draft, requiredHeadcount: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span className="label">Monthly wage per worker, RM</span>
            <input className="input" type="number" disabled={!manage} value={draft.monthlyWage ?? ''} onChange={(e) => setDraft({ ...draft, monthlyWage: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <div className="field">
            <span className="label">Hours</span>
            <div className="small">
              {draft.week.map((h, i) => (
                <div key={i}>
                  {DAY[i]}: {h ? `${h.start}–${h.end}, break ${h.breakMin} min` : 'Rest'}
                </div>
              ))}
              {draft.secondSession && (
                <div>
                  Session 2: {draft.secondSession.start}–{draft.secondSession.end}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Areas and sizes</h2>
          <Chip tone="neutral">{draft.areas.length}</Chip>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Area</th>
                <th>Work</th>
                <th>Size</th>
                <th>Rate per hour</th>
                <th>How often</th>
                <th>Minutes each time</th>
                <th>Client standard</th>
                <th>Client slip</th>
              </tr>
            </thead>
            <tbody>
              {draft.areas.map((a, i) => (
                <tr key={a.id}>
                  <td>
                    <input className="input" disabled={!manage} value={a.name} onChange={(e) => setArea(i, { name: e.target.value })} aria-label="Area name" />
                    <div className="small muted">{a.scopeRef}</div>
                  </td>
                  <td>
                    <Select className="select" disabled={!manage} value={a.work} onChange={(e) => setArea(i, { work: e.target.value as CleaningWorkKind, unit: CLEANING_DEFAULT_RATE[e.target.value as CleaningWorkKind].unit })}>
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {CLEANING_WORK_LABEL[k].en}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <input className="input" type="number" min={0} disabled={!manage} value={a.size} onChange={(e) => setArea(i, { size: Number(e.target.value) })} style={{ width: 90 }} aria-label={`Size of ${a.name}`} />
                      <span className="small">{CLEANING_UNIT_LABEL[a.unit]}</span>
                    </div>
                    {a.size === 0 && a.frequency.kind !== 'always' && a.frequency.kind !== 'as_needed' && <Chip tone="warn">Measure</Chip>}
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      disabled={!manage}
                      placeholder={String(CLEANING_DEFAULT_RATE[a.work].perHour)}
                      value={a.ratePerHour ?? ''}
                      onChange={(e) => setArea(i, { ratePerHour: e.target.value === '' ? null : Number(e.target.value) })}
                      style={{ width: 80 }}
                      aria-label={`Rate for ${a.name}`}
                    />
                  </td>
                  <td className="small">{frequencyLabel(a.frequency)}</td>
                  <td className="mono small">{a.size ? minutesFor(a) : '–'}</td>
                  <td className="small">{a.quality}</td>
                  <td>
                    <label className="row small" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <input type="checkbox" disabled={!manage} checked={!!a.clientAck} onChange={(e) => setArea(i, { clientAck: e.target.checked })} aria-label={`Client slip needed for ${a.name}`} />
                      Needed
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {manage && (
          <div className="panel-body">
            <button
              className="btn btn-sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  areas: [
                    ...draft.areas,
                    { id: nextId('area-', draft.areas.map((a) => a.id)), name: 'New area', work: 'sweep', size: 0, unit: 'm2', frequency: { kind: 'per_day', times: 1 }, ratePerHour: null, quality: 'Clean and tidy', scopeRef: '', pin: null, notBefore: null, notAfter: null, clientAck: false },
                  ],
                })
              }
            >
              Add an area
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Crew</h2>
          <Chip tone="neutral">{draft.crew.length}</Chip>
        </div>
        <div className="small muted panel-body">Cleaners and supervisors do not sign in yet. The OM keeps this list and records what the supervisor reports.</div>
        <div className="list">
          {draft.crew.map((c, i) => (
            <div key={c.id} className="list-item">
              <input className="input" disabled={!manage} value={c.name} onChange={(e) => setCrew(i, { name: e.target.value })} aria-label="Crew name" />
              <select className="select" disabled={!manage} value={c.role} onChange={(e) => setCrew(i, { role: e.target.value as CleaningCrewMember['role'] })} style={{ maxWidth: 140 }}>
                <option value="cleaner">Cleaner</option>
                <option value="supervisor">Supervisor</option>
              </select>
              {draft.secondSession && (
                <select className="select" disabled={!manage} value={c.session} onChange={(e) => setCrew(i, { session: Number(e.target.value) as 1 | 2 })} style={{ maxWidth: 120 }}>
                  <option value={1}>Session 1</option>
                  <option value={2}>Session 2</option>
                </select>
              )}
              {manage && (
                <button className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...draft, crew: draft.crew.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {manage && (
          <div className="panel-body">
            <button className="btn btn-sm" onClick={() => setDraft({ ...draft, crew: [...draft.crew, { id: nextId('w', draft.crew.map((c) => c.id)), name: 'New cleaner', role: 'cleaner', session: 1, personId: null }] })}>
              Add a worker
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Planner timings for this site</h2>
          <Chip tone="neutral">Empty = the usual timing</Chip>
        </div>
        <div className="panel-body grid-2">
          {CLEANING_TIMING_KEYS.map((k) => (
            <label key={k} className="field">
              <span className="label">{CLEANING_TIMING_LABEL[k]}</span>
              <input
                className="input"
                type={k === 'breakFrom' ? 'time' : 'number'}
                min={0}
                disabled={!manage}
                placeholder={String(CLEANING_RULES[k])}
                value={(draft.timings?.[k] as string | number | undefined) ?? ''}
                aria-label={CLEANING_TIMING_LABEL[k]}
                onChange={(e) => {
                  const next = { ...(draft.timings ?? {}) } as Record<string, string | number>;
                  if (e.target.value === '') delete next[k];
                  else next[k] = k === 'breakFrom' ? e.target.value : Number(e.target.value);
                  setDraft({ ...draft, timings: Object.keys(next).length ? next : null });
                }}
                style={{ maxWidth: 160 }}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Supplies budget per working day</h2>
        </div>
        <div className="list">
          {draft.supplies.map((s, i) => (
            <div key={s.id} className="list-item">
              <div>{s.name}</div>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.1"
                  disabled={!manage}
                  value={s.perDay}
                  onChange={(e) => setDraft({ ...draft, supplies: draft.supplies.map((x, j) => (j === i ? { ...x, perDay: Number(e.target.value) } : x)) })}
                  style={{ width: 90 }}
                  aria-label={`${s.name} per day`}
                />
                <span className="small">{s.unit} a day</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {manage && (
        <section className="panel">
          <div className="panel-body row">
            <ErrorNotice error={act.error} />
            <button className="btn btn-primary" disabled={!dirty || act.busy} onClick={() => act.run(() => api.cleaningSaveSetup(d.site.id, draft, setup.version), 'Set-up saved. Make the plan again to use it.')}>
              Save scope and crew
            </button>
            {dirty && (
              <button className="btn" onClick={() => setDraft(toInput())}>
                Undo changes
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

// ---------- Site map ----------

function SiteMap({ d }: { d: CleaningSiteView }) {
  const setup = d.setup!;
  const manage = d.access === 'manage';
  const act = useAction();
  const [placing, setPlacing] = useState<string>('');
  const pinned = setup.areas.filter((a) => a.pin);
  const upload = async (f: File) => {
    if (f.size > MAX_MAP) {
      act.run(() => Promise.reject(new Error('The map is over 2 MB. Save it smaller.')));
      return;
    }
    const data = await readFile(f);
    act.run(() => api.cleaningSetMap(d.site.id, { name: f.name, data }, setup.version), 'Site map saved.');
  };
  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!manage || !placing) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    const { id: _i, companyId: _c, siteId: _s, map: _m, version: _v, updatedBy: _u, updatedAt: _a, ...rest } = setup;
    const input: CleaningSetupInput = { ...rest, areas: setup.areas.map((a) => (a.id === placing ? { ...a, pin: { x, y } } : a)) };
    act.run(() => api.cleaningSaveSetup(d.site.id, input, setup.version), 'Area placed on the map.');
    setPlacing('');
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Site map</h2>
        {setup.map && <Chip tone="neutral">{setup.map.name}</Chip>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
        {manage && (
          <label className="field">
            <span className="label">{setup.map ? 'Replace the map' : 'Upload the site map'} (PDF, JPEG or PNG, under 2 MB)</span>
            <input className="input" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        )}
        <ErrorNotice error={act.error} />
        {!d.mapData && <div className="empty">No map yet.</div>}
        {d.mapData && setup.map?.mime === 'application/pdf' && (
          <a className="btn btn-sm" href={d.mapData} download={setup.map.name}>
            Open the map (PDF)
          </a>
        )}
        {d.mapData && setup.map?.mime !== 'application/pdf' && (
          <>
            {manage && (
              <label className="field">
                <span className="label">Place an area on the map: pick it, then tap its place</span>
                <Select className="select" value={placing} onChange={(e) => setPlacing(e.target.value)} style={{ maxWidth: 420 }}>
                  <option value="">Choose an area…</option>
                  {setup.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.pin ? ' (placed)' : ''}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <div onClick={place} style={{ position: 'relative', cursor: placing ? 'crosshair' : 'default', maxWidth: 900 }} data-testid="site-map">
              <img src={d.mapData} alt="Site map" style={{ width: '100%', display: 'block', borderRadius: 6 }} />
              {pinned.map((a, i) => (
                <span
                  key={a.id}
                  title={`${a.name}: ${a.size} ${CLEANING_UNIT_LABEL[a.unit]}`}
                  style={{ position: 'absolute', left: `${a.pin!.x}%`, top: `${a.pin!.y}%`, transform: 'translate(-50%, -50%)', background: 'var(--accent, #2563eb)', color: '#fff', borderRadius: 999, minWidth: 22, height: 22, fontSize: 12, display: 'grid', placeItems: 'center', padding: '0 4px' }}
                >
                  {i + 1}
                </span>
              ))}
            </div>
            <ol className="small">
              {pinned.map((a) => (
                <li key={a.id}>
                  {a.name}: {a.size} {CLEANING_UNIT_LABEL[a.unit]}, {frequencyLabel(a.frequency)}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

// ---------- Supplies and equipment ----------

const FLAG: Record<string, { tone: Tone; label: string }> = {
  over_use: { tone: 'crit', label: 'Over-used' },
  under_use: { tone: 'warn', label: 'Under-given or not used' },
  reorder: { tone: 'warn', label: 'Reorder' },
  short_delivery: { tone: 'crit', label: 'Short delivery' },
  no_check: { tone: 'unknown', label: 'No check yet' },
  ok: { tone: 'ok', label: 'OK' },
};

function Stock({ d }: { d: CleaningSiteView }) {
  const setup = d.setup!;
  const st = d.stock!;
  const manage = d.access === 'manage';
  const [form, setForm] = useState<null | 'delivery' | 'check' | { receive: string }>(null);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Supplies</h2>
          <Chip tone="neutral">
            Over {d.rules.stock.value.overUsePct}% or under {d.rules.stock.value.underUsePct}% of budget is flagged
          </Chip>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supply</th>
                <th>On hand</th>
                <th>Used / budget</th>
                <th>Days left</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {st.supplies.map((s) => (
                <tr key={s.supply.id}>
                  <td>
                    {s.supply.name}
                    <div className="small muted">
                      {s.supply.perDay} {s.supply.unit} a day
                    </div>
                  </td>
                  <td className="mono">{s.onHand ?? '–'}</td>
                  <td className="mono">
                    {s.used ?? '–'} / {s.budget ?? '–'} {s.usePct != null ? `(${s.usePct}%)` : ''}
                  </td>
                  <td className="mono">{s.daysLeft ?? '–'}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {s.flags.map((f) => (
                        <Chip key={f} tone={FLAG[f].tone}>
                          {FLAG[f].label}
                          {f === 'short_delivery' ? ` (${s.shortDelivered})` : ''}
                        </Chip>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Equipment (contract list)</h2>
        </div>
        <div className="list">
          {st.equipment.map((e) => (
            <div key={e.equipment.id} className="list-item">
              <div>
                {e.equipment.name}
                <div className="small muted">
                  Needs {e.equipment.required} · last check {e.lastCheck ? dateLabel(e.lastCheck) : 'none'}
                </div>
              </div>
              <div className="row">
                <Chip tone="neutral">{e.working ?? '–'} working</Chip>
                {(e.broken ?? 0) > 0 && <Chip tone="warn">{e.broken} broken</Chip>}
                {(e.missing ?? 0) > 0 && <Chip tone="crit">{e.missing} short</Chip>}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Deliveries and checks</h2>
          {manage && (
            <div className="row">
              <button className="btn btn-sm" onClick={() => setForm('delivery')}>
                Record a delivery
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => setForm('check')}>
                Record a stock check
              </button>
            </div>
          )}
        </div>
        {!d.entries.length && <div className="empty">Nothing recorded yet.</div>}
        <div className="list">
          {d.entries.map((e) => (
            <div key={e.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {e.kind === 'delivery' ? 'Delivery' : 'Stock check'} · {dateLabel(e.date)}
                </div>
                <div className="small muted">
                  {e.supplies
                    .map((x) => {
                      const s = setup.supplies.find((y) => y.id === x.supplyId);
                      return `${s?.name ?? x.supplyId}: ${e.kind === 'delivery' ? `sent ${x.sent ?? '–'}${x.counted != null ? `, arrived ${x.counted}` : ''}` : `${x.counted}`}`;
                    })
                    .join(' · ')}
                </div>
                <div className="small muted">
                  By {e.by}
                  {e.note ? ` · ${e.note}` : ''}
                </div>
              </div>
              <div className="row">
                {e.kind === 'delivery' && (e.received ? <Chip tone="ok">Received</Chip> : <Chip tone="warn">Waiting for supervisor</Chip>)}
                {e.kind === 'delivery' && !e.received && manage && (
                  <button className="btn btn-sm" onClick={() => setForm({ receive: e.id })}>
                    Record receipt
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {form && <StockForm d={d} mode={form} onClose={() => setForm(null)} />}
    </>
  );
}

function StockForm({ d, mode, onClose }: { d: CleaningSiteView; mode: 'delivery' | 'check' | { receive: string }; onClose: () => void }) {
  const setup = d.setup!;
  const receive = typeof mode === 'object' ? d.entries.find((e) => e.id === mode.receive) : undefined;
  const [date, setDate] = useState(d.today);
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (receive) {
      for (const x of receive.supplies) init[`s:${x.supplyId}`] = String(x.sent ?? '');
      for (const x of receive.equipment) init[`e:${x.equipmentId}`] = String(x.sent ?? '');
    }
    return init;
  });
  const [broken, setBroken] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<CleaningProofInput | null>(null);
  const act = useAction();
  const supplies = receive ? setup.supplies.filter((s) => receive.supplies.some((x) => x.supplyId === s.id)) : setup.supplies;
  const equipment = receive ? setup.equipment.filter((e) => receive.equipment.some((x) => x.equipmentId === e.id)) : setup.equipment;
  const lines = () => {
    const s: StockLineInput[] = supplies.filter((x) => qty[`s:${x.id}`]?.trim()).map((x) => ({ supplyId: x.id, qty: Number(qty[`s:${x.id}`]) }));
    const e: StockLineInput[] = equipment
      .filter((x) => qty[`e:${x.id}`]?.trim())
      .map((x) => ({ equipmentId: x.id, qty: Number(qty[`e:${x.id}`]), ...(mode === 'check' ? { broken: Number(broken[x.id] || 0) } : {}) }));
    return { supplies: s, equipment: e };
  };
  const needsProof = mode !== 'delivery';
  const title = mode === 'delivery' ? 'Record a delivery to the site' : mode === 'check' ? 'Stock check at the site' : 'What arrived at the site';
  const save = async () => {
    const l = lines();
    const r = await act.run(
      () =>
        mode === 'delivery'
          ? api.cleaningDelivery(d.site.id, { date, ...l, note })
          : mode === 'check'
            ? api.cleaningStockCheck(d.site.id, { date, ...l, note, proof: proof! })
            : api.cleaningReceive(d.site.id, receive!.id, { ...l, note, proof: proof! }),
      mode === 'delivery' ? 'Delivery recorded. The supervisor confirms what arrived.' : mode === 'check' ? 'Stock check recorded.' : 'Receipt recorded.',
    );
    if (r) onClose();
  };
  return (
    <Drawer title={title} sub={d.site.name} onClose={onClose}>
      <div style={{ display: 'grid', gap: 10 }}>
        {mode !== 'check' && typeof mode !== 'object' && null}
        {typeof mode !== 'object' && (
          <label className="field">
            <span className="label">Date</span>
            <input className="input" type="date" value={date} max={d.today} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <div className="label">{mode === 'delivery' ? 'Sent' : mode === 'check' ? 'Counted on site' : 'Arrived (as counted by the supervisor)'}</div>
        {supplies.map((s) => (
          <label key={s.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span>
              {s.name} <span className="small muted">({s.unit})</span>
            </span>
            <input className="input" type="number" min={0} step="0.1" value={qty[`s:${s.id}`] ?? ''} onChange={(e) => setQty({ ...qty, [`s:${s.id}`]: e.target.value })} style={{ width: 100 }} aria-label={`${s.name} quantity`} />
          </label>
        ))}
        {equipment.map((x) => (
          <label key={x.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span>{x.name}</span>
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" type="number" min={0} value={qty[`e:${x.id}`] ?? ''} placeholder={mode === 'check' ? 'working' : ''} onChange={(e) => setQty({ ...qty, [`e:${x.id}`]: e.target.value })} style={{ width: 80 }} aria-label={`${x.name} quantity`} />
              {mode === 'check' && <input className="input" type="number" min={0} value={broken[x.id] ?? ''} placeholder="broken" onChange={(e) => setBroken({ ...broken, [x.id]: e.target.value })} style={{ width: 80 }} aria-label={`${x.name} broken`} />}
            </span>
          </label>
        ))}
        {needsProof && <TimeMarkedPhoto date={typeof mode === 'object' ? d.today : date} value={proof} onChange={setProof} />}
        <label className="field">
          <span className="label">Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorNotice error={act.error} />
        <button className="btn btn-primary" disabled={act.busy || (needsProof && !proof)} onClick={save}>
          Save
        </button>
      </div>
    </Drawer>
  );
}

// ---------- Monthly plan vs actual ----------

function Monthly({ siteId, date }: { siteId: string; date: string }) {
  const [month, setMonth] = useState(date.slice(0, 7));
  const m = useLoad(() => api.cleaningMonthly(siteId, month), [siteId, month]);
  const r = m.data;
  return (
    <>
      <div className="row">
        <input className="input" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ maxWidth: 180 }} />
      </div>
      <ErrorNotice error={m.error} />
      {!r && !m.error && <Loading what="monthly report" />}
      {r && (
        <>
          <section className="kpis">
            <Kpi label="Working days" value={r.totals.workingDays} note={`${r.totals.daysPublished} published`} />
            <Kpi label="Planned tasks" value={r.totals.planned} />
            <Kpi label="Checked with photo" value={r.totals.checkedPct == null ? '–' : `${r.totals.checkedPct}%`} note={`${r.totals.checked} checked`} />
            <Kpi label="Not needed (with photo)" value={r.totals.notNeeded} />
            <Kpi label="Redo / missed" value={`${r.totals.redo} / ${r.totals.missed}`} tone={r.totals.missed ? 'crit' : r.totals.redo ? 'warn' : 'ok'} />
            <Kpi label="Not recorded" value={r.totals.notRecorded} tone={r.totals.notRecorded ? 'warn' : 'ok'} />
            <Kpi
              label="Client slips"
              value={r.totals.slipsReceived}
              tone={r.totals.slipDaysOutstanding || r.totals.slipsNotAccepted ? 'warn' : 'ok'}
              note={`${r.totals.slipsNotAccepted} not accepted · ${r.totals.slipDaysOutstanding} work days waiting`}
            />
            <Kpi label="Worker-days short" value={r.totals.workerDaysShort} tone={r.totals.workerDaysShort ? 'crit' : 'ok'} note={r.totals.deductionEstimate ? `≈ RM ${r.totals.deductionEstimate.toFixed(2)} deduction` : undefined} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Plan against actual, day by day</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Plan</th>
                    <th>Planned</th>
                    <th>Done</th>
                    <th>Checked</th>
                    <th>Redo</th>
                    <th>Missed</th>
                    <th>Not needed</th>
                    <th>Not recorded</th>
                    <th>Present / required</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.date}>
                      <td>{dateLabel(l.date)}</td>
                      <td>
                        <Chip tone={l.status === 'published' ? 'ok' : l.status === 'not_planned' ? 'crit' : 'neutral'}>
                          {l.status === 'published' ? 'Published' : l.status === 'draft' ? 'Draft' : l.status === 'not_planned' ? 'No plan' : 'Later'}
                        </Chip>
                      </td>
                      <td className="mono">{l.planned}</td>
                      <td className="mono">{l.done}</td>
                      <td className="mono">{l.checked}</td>
                      <td className="mono">{l.redo}</td>
                      <td className="mono">{l.missed}</td>
                      <td className="mono">{l.notNeeded}</td>
                      <td className="mono">{l.notRecorded}</td>
                      <td className="mono">
                        {l.present ?? '–'} / {l.required}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Supplies used against budget</h2>
            </div>
            <div className="list">
              {r.supplies.map((s) => (
                <div key={s.supply} className="list-item">
                  <div>{s.supply}</div>
                  <div className="mono small">
                    {s.used ?? '–'} / {s.budget ?? '–'} {s.unit} {s.usePct != null ? `(${s.usePct}%)` : '(needs two checks)'}
                  </div>
                </div>
              ))}
            </div>
          </section>
          {r.slips.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>Client slips and comments</h2>
              </div>
              <div className="list">
                {r.slips.map((x) => (
                  <div key={x.id} className="list-item" style={{ display: 'block' }}>
                    <Chip tone={x.outcome === 'accepted' ? 'ok' : 'crit'}>{x.outcome === 'accepted' ? 'Accepted' : 'Not accepted'}</Chip> {dateLabel(x.signedOn)} · {x.signer} · {x.areas.join(', ')} ({dateLabel(x.from)} to {dateLabel(x.to)})
                    {x.comment && <div className="small">Comment: “{x.comment}”</div>}
                    {x.action && <div className="small muted">Action: {x.action}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}
          <ReturnSpec spec={r.returnSpec} title="What the JA app (or the app that runs the work) sends back each month" />
        </>
      )}
    </>
  );
}

// ---------- Client slips (Fauzan, 4 Nov 2026) ----------

/**
 * Work that needs the client's signed slip (e.g. the school's slip for grass cutting) and the slips received. The OM
 * uploads the slip and copies the client's comment; a slip that does not accept the work leaves those days open until
 * the work is redone and a new slip is signed.
 */
function ClientSlips({ d }: { d: CleaningSiteView }) {
  const manage = d.access === 'manage';
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const areaName = (id: string) => d.setup!.areas.find((a) => a.id === id)?.name ?? id;
  const range = (days: string[]) => (days.length ? (days.length === 1 ? dateLabel(days[0]) : `${dateLabel(days[0])} to ${dateLabel(days.at(-1)!)} (${days.length} days)`) : '');
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Work that needs the client's slip</h2>
          {manage && (
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
              Upload a client slip
            </button>
          )}
        </div>
        {!d.slipStatus.length ? (
          <div className="empty">No area needs a client slip. Tick “Client slip needed” on an area under Scope and crew (grass cutting and hedges are ticked on the KPM template).</div>
        ) : (
          <div className="list">
            {d.slipStatus.map((x) => (
              <div key={x.areaId} className="list-item" style={{ display: 'block' }}>
                <div style={{ fontWeight: 600 }}>{x.name}</div>
                {!x.workDays.length && <div className="small muted">No work done in the last 62 days.</div>}
                {x.outstanding.length > 0 && (
                  <div className="small">
                    <Chip tone="warn">Waiting for slip</Chip> {range(x.outstanding)}
                  </div>
                )}
                {x.rejected.length > 0 && (
                  <div className="small">
                    <Chip tone="crit">Not accepted: redo and get a new slip</Chip> {range(x.rejected)}
                  </div>
                )}
                {x.acknowledged.length > 0 && (
                  <div className="small">
                    <Chip tone="ok">Acknowledged</Chip> {range(x.acknowledged)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Slips received</h2>
          <Chip tone="neutral">{d.slips.length}</Chip>
        </div>
        {!d.slips.length && <div className="empty">No client slip uploaded yet.</div>}
        <div className="list">
          {d.slips.map((e) => (
            <div key={e.id} className="list-item" style={{ display: 'block' }}>
              <Chip tone={e.ack?.outcome === 'accepted' ? 'ok' : 'crit'}>{e.ack?.outcome === 'accepted' ? 'Accepted' : 'Not accepted'}</Chip> Signed {dateLabel(e.date)} by {e.ack?.signer} ·{' '}
              {(e.ack?.areaIds ?? []).map(areaName).join(', ')} · work {dateLabel(e.ack?.from ?? e.date)} to {dateLabel(e.ack?.to ?? e.date)}
              {e.ack?.comment && <div className="small">Client's comment: “{e.ack.comment}”</div>}
              {e.ack?.action && <div className="small muted">Action: {e.ack.action}</div>}
              <div className="small muted">
                Uploaded by {e.by}{' '}
                {e.proofIds[0] && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setView(e.proofIds[0])}>
                    View slip
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {open && <SlipForm d={d} onClose={() => setOpen(false)} />}
      {view && <ProofDrawer siteId={d.site.id} docId={view} onClose={() => setView(null)} />}
    </>
  );
}

function SlipForm({ d, onClose }: { d: CleaningSiteView; onClose: () => void }) {
  const waiting = d.slipStatus.filter((x) => x.outstanding.length || x.rejected.length);
  const first = waiting[0];
  const days = first ? [...first.outstanding, ...first.rejected].sort() : [];
  const [areaIds, setAreaIds] = useState<string[]>(first ? [first.areaId] : []);
  const [from, setFrom] = useState(days[0] ?? d.today);
  const [to, setTo] = useState(days.at(-1) ?? d.today);
  const [signedOn, setSignedOn] = useState(d.today);
  const [signer, setSigner] = useState('');
  const [outcome, setOutcome] = useState<'accepted' | 'not_accepted'>('accepted');
  const [comment, setComment] = useState('');
  const [action, setAction] = useState('');
  const [slip, setSlip] = useState<{ name: string; data: string } | null>(null);
  const [fileError, setFileError] = useState('');
  const act = useAction();
  const ready = !!slip && areaIds.length > 0 && signer.trim().length > 1 && (outcome === 'accepted' || (comment.trim() && action.trim()));
  return (
    <Drawer title="Upload a client slip" sub={`${d.site.name}: the client's signed acknowledgement that the work was done properly`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="label">Work the slip is for</div>
        {d.setup!.areas
          .filter((a) => a.frequency.kind !== 'always')
          .map((a) => (
            <label key={a.id} className="row small" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input type="checkbox" checked={areaIds.includes(a.id)} onChange={(e) => setAreaIds(e.target.checked ? [...areaIds, a.id] : areaIds.filter((x) => x !== a.id))} />
              {a.name} {a.clientAck && <Chip tone="info">Slip needed</Chip>}
            </label>
          ))}
        <div className="row" style={{ gap: 6 }}>
          <label className="field">
            <span className="label">Work from</span>
            <input className="input" type="date" value={from} max={d.today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">to</span>
            <input className="input" type="date" value={to} max={d.today} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Signed on</span>
            <input className="input" type="date" value={signedOn} max={d.today} onChange={(e) => setSignedOn(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="label">Signed by (name and post)</span>
          <input className="input" value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="e.g. school clerk, Penolong Kanan HEM" />
        </label>
        <label className="field">
          <span className="label">Did the client accept the work?</span>
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="accepted">Accepted</option>
            <option value="not_accepted">Not accepted</option>
          </select>
        </label>
        <label className="field">
          <span className="label">The client's comment on the slip{outcome === 'not_accepted' ? '' : ' (if any)'}</span>
          <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {outcome === 'not_accepted' && (
          <label className="field">
            <span className="label">What will be done (e.g. redo by a date)</span>
            <input className="input" value={action} onChange={(e) => setAction(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="label">The signed slip (photo or scan: JPEG, PNG or PDF, under 2 MB)</span>
          <input
            className="input"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setFileError('');
              setSlip(null);
              if (!f) return;
              if (f.size > MAX_MAP) return setFileError('The file is over 2 MB. Save it smaller.');
              setSlip({ name: f.name, data: await readFile(f) });
            }}
          />
        </label>
        {fileError && <div className="notice" data-tone="crit">{fileError}</div>}
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !ready}
          onClick={async () => {
            const r = await act.run(() => api.cleaningClientSlip(d.site.id, { signedOn, from, to, areaIds, signer, outcome, comment, action, slip: slip! }), 'Client slip recorded.');
            if (r) onClose();
          }}
        >
          Save the slip
        </button>
      </div>
    </Drawer>
  );
}

export function ReturnSpec({ spec, title }: { spec: Record<string, unknown>; title: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <Chip tone="neutral">Version {String(spec.version)}</Chip>
      </div>
      <div className="panel-body small">
        {Object.entries(spec)
          .filter(([k]) => k !== 'version')
          .map(([k, v]) => (
            <div key={k} style={{ marginBottom: 8 }}>
              <div className="label">{k === 'perSite' ? 'For each site' : k === 'perDay' ? 'For each day' : k === 'perMonth' ? 'For the month' : k === 'rules' ? 'Rules' : k === 'guards' ? 'Guards' : k === 'officers' ? 'Patrolling officers' : k}</div>
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {(v as string[]).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </section>
  );
}
