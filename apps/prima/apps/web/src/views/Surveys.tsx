import { useCallback, useEffect, useState } from 'react';
import { RULES, SURVEY_RISKS, SURVEY_RISK_LABEL, SURVEY_SITE_TYPES, SURVEY_SITE_TYPE_LABEL, SURVEY_STATUS_LABEL, SURVEY_UNIT_LABEL, fromMs, guardsPerDay } from '@prima/core';
import { api, type SiteSurveyBoard, type SiteSurveySetup } from '../api';
import { Chip, Drawer, ErrorNotice, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { Empty, PageHead } from '../kit';
import { EvidenceCamera, gps } from './Camera';
import {
  NUMBER_LABEL,
  SURVEYS_CHANGED,
  blankForm,
  cachedSetup,
  deleteLocal,
  deletePhoto,
  getPhoto,
  keepPhoto,
  listLocal,
  missingBits,
  newSurveyId,
  othersWaiting,
  putLocal,
  rememberSetup,
  savesOnPhone,
  syncSurveys,
  type FormPost,
  type LocalSurvey,
  type SurveyForm,
} from '../survey/offline';

/**
 * Site survey form (Fauzan, 4 Nov 2026): fill it at the site with no signal, take photos and measurements, and the
 * phone sends it when there is a signal. Nothing is typed twice: an accepted survey fills the sales lead. The Project
 * Director (COO, Operations General Manager, Operations Director) accepts or returns it with a reason.
 */
export function SurveysView({ ownerId, offline = false }: { ownerId: string; offline?: boolean }) {
  const [tab, setTab] = useState<'phone' | 'sent' | 'decide'>('phone');
  const [local, setLocal] = useState<LocalSurvey[] | null>(null);
  const [others, setOthers] = useState(0);
  const [saves, setSaves] = useState(true);
  const [setup, setSetup] = useState<SiteSurveySetup | null>(null);
  const [editing, setEditing] = useState<LocalSurvey | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLocal(await listLocal(ownerId));
    setOthers(await othersWaiting(ownerId));
  }, [ownerId]);

  // The lists for working offline: fresh from the server when there is a signal, else what this phone kept.
  useEffect(() => {
    let live = true;
    void savesOnPhone().then((ok) => live && setSaves(ok));
    void (async () => {
      const kept = await cachedSetup(ownerId);
      if (live && kept) setSetup(kept);
      if (offline) return;
      try {
        const fresh = await api.siteSurveySetup();
        if (fresh.user.id !== ownerId) return;
        await rememberSetup(fresh);
        if (live) setSetup(fresh);
      } catch {
        /* no signal: keep what the phone has */
      }
    })();
    return () => {
      live = false;
    };
  }, [ownerId, offline]);

  const send = useCallback(
    async (force = false) => {
      if (offline) return;
      const r = await syncSurveys(ownerId, force);
      if (r.sent) setSyncNote(`${r.sent} survey${r.sent === 1 ? '' : 's'} sent to the Project Director.`);
      else if (r.offline) setSyncNote('No signal yet. The phone keeps trying by itself.');
      else setSyncNote(null);
      await reload();
    },
    [ownerId, offline, reload],
  );

  useEffect(() => {
    void reload();
    const on = () => {
      setOnline(true);
      void send(true);
    };
    const off = () => setOnline(false);
    const changed = () => void reload();
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener(SURVEYS_CHANGED, changed);
    void send();
    const timer = window.setInterval(() => void send(), 60_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener(SURVEYS_CHANGED, changed);
      window.clearInterval(timer);
    };
  }, [reload, send]);

  const start = async () => {
    const id = newSurveyId();
    const companyId = setup?.companies.length === 1 ? setup.companies[0].id : '';
    const s: LocalSurvey = {
      id,
      ownerId,
      state: 'draft',
      startedAt: fromMs(Date.now()),
      finishedAt: null,
      updatedAt: Date.now(),
      form: blankForm(companyId),
      photos: [],
      serverReceived: false,
      ref: null,
      error: null,
      tries: 0,
      nextTryAt: 0,
      sentAt: null,
    };
    await putLocal(s);
    setEditing(s);
    await reload();
  };

  const waiting = (local ?? []).filter((s) => s.state === 'ready' || s.state === 'sending').length;
  const keepDays = RULES.siteSurvey.value.keepOnPhoneDays;
  const old = (local ?? []).filter((s) => s.state !== 'sent' && Date.now() - s.updatedAt > keepDays * 86_400_000).length;

  if (editing)
    return (
      <SurveyEditor
        key={editing.id}
        initial={editing}
        setup={setup}
        onClose={async (finished) => {
          setEditing(null);
          await reload();
          if (finished) void send(true);
        }}
      />
    );

  return (
    // P90: the page frame (padding, width, rhythm) and the kit's page head, with New site survey as the main action.
    <div className={offline ? 'survey' : 'page survey'} style={{ display: 'flex', flexDirection: 'column', gap: offline ? 12 : undefined }}>
      <PageHead
        title="Site survey"
        sub="Fill it in at the site, even with no signal. Photos and measurements stay on this phone and are sent by themselves when there is a signal."
        actions={
          <>
            {!offline && waiting > 0 && (
              <button className="btn btn-lg" onClick={() => send(true)}>
                Send now
              </button>
            )}
            <button className="btn btn-primary btn-lg" onClick={start} disabled={!setup || setup.companies.length === 0}>
              New site survey
            </button>
          </>
        }
      />
      <div className="notice" data-tone={online && !offline ? 'ok' : 'warn'} role="status">
        {online && !offline ? 'Signal: on.' : 'No signal. You can still fill in surveys; they are sent later.'}
        {waiting > 0 && ` ${waiting} survey${waiting === 1 ? '' : 's'} waiting to send.`}
        {syncNote && ` ${syncNote}`}
      </div>
      {!saves && <div className="notice" data-tone="crit">This browser cannot keep surveys after it closes. Keep the app open until the survey is sent, or install the app.</div>}
      {old > 0 && <div className="notice" data-tone="warn">{old} survey{old === 1 ? ' has' : 's have'} been on this phone for over {keepDays} days. Finish and send, or delete.</div>}
      {others > 0 && <div className="notice">{others} survey{others === 1 ? '' : 's'} on this phone belong to another person. They are sent when that person signs in here.</div>}
      {setup && setup.companies.length === 0 && <div className="notice">You have no company to survey for. Ask your manager.</div>}

      {!offline && (
        <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
          <button aria-pressed={tab === 'phone'} onClick={() => setTab('phone')}>
            On this phone
          </button>
          <button aria-pressed={tab === 'sent'} onClick={() => setTab('sent')}>
            Sent surveys
          </button>
          <button aria-pressed={tab === 'decide'} onClick={() => setTab('decide')}>
            To decide
          </button>
        </div>
      )}

      <section className="panel survey-list">
        {(offline || tab === 'phone') && <LocalList rows={local} onOpen={setEditing} onChanged={reload} />}
        {!offline && tab !== 'phone' && <ServerList decide={tab === 'decide'} onRedo={async (s) => {
          const id = newSurveyId();
          const redo: LocalSurvey = { id, ownerId, state: 'draft', startedAt: fromMs(Date.now()), finishedAt: null, updatedAt: Date.now(), form: s, photos: [], serverReceived: false, ref: null, error: null, tries: 0, nextTryAt: 0, sentAt: null };
          await putLocal(redo);
          setTab('phone');
          setEditing(redo);
        }} />}
      </section>
    </div>
  );
}

const LOCAL_TONE: Record<LocalSurvey['state'], Tone> = { draft: 'neutral', ready: 'warn', sending: 'info', refused: 'crit', sent: 'ok' };
const LOCAL_LABEL: Record<LocalSurvey['state'], string> = {
  draft: 'Not finished',
  ready: 'Waiting for signal',
  sending: 'Sending',
  refused: 'Not accepted by the server',
  sent: 'Sent',
};

function placeOf(f: SurveyForm, setup?: SiteSurveySetup | null): string {
  const c = setup?.companies.find((x) => x.id === f.companyId);
  if (f.target === 'lead') return c?.leads.find((l) => l.id === f.leadId)?.prospect ?? 'Sales lead';
  if (f.target === 'site') return c?.sites.find((s) => s.id === f.siteId)?.name ?? 'Site';
  return f.place || 'New place';
}

function LocalList({ rows, onOpen, onChanged }: { rows: LocalSurvey[] | null; onOpen: (s: LocalSurvey) => void; onChanged: () => void }) {
  if (!rows) return null;
  if (!rows.length) return <Empty title="No surveys on this phone.">Press New site survey at the site; it saves here even with no signal.</Empty>;
  return (
    <div className="list">
      {rows.map((s) => (
        <div key={s.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{s.ref ?? placeOf(s.form)}</div>
              <div className="muted small">
                Started {dateTimeLabel(s.startedAt)} · {s.photos.length} photo{s.photos.length === 1 ? '' : 's'} · {guardsPerDay(s.form.posts)} guard{guardsPerDay(s.form.posts) === 1 ? '' : 's'} a day
              </div>
            </div>
            <Chip tone={LOCAL_TONE[s.state]}>{LOCAL_LABEL[s.state]}</Chip>
          </div>
          {s.error && <div className="notice" data-tone={s.state === 'refused' ? 'crit' : 'warn'}>{s.error}</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(s.state === 'draft' || (s.state === 'refused' && !s.serverReceived)) && (
              <button className="btn btn-primary" onClick={() => onOpen(s)}>
                {s.state === 'draft' ? 'Continue' : 'Fix and send'}
              </button>
            )}
            {s.state !== 'sending' && (s.state !== 'ready' || !s.serverReceived) && (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  if (s.state !== 'sent' && !window.confirm('Delete this survey and its photos from the phone? This cannot be undone.')) return;
                  await deleteLocal(s);
                  onChanged();
                }}
              >
                {s.state === 'sent' ? 'Clear' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const SERVER_TONE: Record<string, Tone> = { receiving_photos: 'info', submitted: 'warn', accepted: 'ok', returned: 'crit' };

function ServerList({ decide, onRedo }: { decide: boolean; onRedo: (f: SurveyForm) => void }) {
  const { data, error } = useLoad(() => api.siteSurveyBoard(), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;
  const rows = decide ? data.rows.filter((r) => r.canReview) : data.rows;
  return (
    <>
      {decide && !data.isProjectDirector && <div className="notice">Only the Project Director (COO, Operations General Manager, Operations Director) decides surveys.</div>}
      <div className="list">
        {rows.length === 0 && <Empty title={decide ? 'No surveys waiting for you.' : 'No surveys sent yet.'} />}
        {rows.map((r: SiteSurveyBoard['rows'][number]) => (
          <button key={r.survey.id} className="list-item" style={{ textAlign: 'left', width: '100%', cursor: 'pointer' }} onClick={() => setOpen(r.survey.id)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {r.survey.ref} · {r.survey.place}
              </div>
              <div className="muted small">
                {r.company} · {r.survey.surveyorName} · received {dateTimeLabel(r.survey.receivedAt)} · {r.survey.guardsPerDay} guard{r.survey.guardsPerDay === 1 ? '' : 's'} a day
              </div>
            </div>
            <Chip tone={SERVER_TONE[r.survey.status] ?? 'neutral'}>{SURVEY_STATUS_LABEL[r.survey.status]}</Chip>
          </button>
        ))}
      </div>
      {open && <SurveyDrawer id={open} onClose={() => setOpen(null)} onRedo={onRedo} />}
    </>
  );
}

function SurveyDrawer({ id, onClose, onRedo }: { id: string; onClose: () => void; onRedo: (f: SurveyForm) => void }) {
  const { data, error } = useLoad(() => api.siteSurveyDetail(id), [id]);
  const [reason, setReason] = useState('');
  const act = useAction();
  const s = data?.survey;
  return (
    <Drawer title={s ? `${s.ref} · ${s.place}` : 'Site survey'} sub={s ? `${s.surveyorName}, ${s.surveyorTitle}` : undefined} onClose={onClose}>
      {error && <ErrorNotice error={error} />}
      {s && data && (
        <div className="survey" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            <Chip tone={SERVER_TONE[s.status] ?? 'neutral'}>{SURVEY_STATUS_LABEL[s.status]}</Chip>
            <Chip tone={s.time === 'ok' ? 'ok' : 'warn'}>{s.time === 'ok' ? 'Sent from the site' : s.time === 'sent_later' ? 'Sent later (no signal at the site)' : 'Phone clock wrong'}</Chip>
            <Chip tone={s.gps === 'ok' ? 'ok' : 'warn'}>{s.gps === 'ok' ? `GPS ±${s.accuracyM} m` : s.gps === 'weak' ? 'GPS weak' : 'No GPS'}</Chip>
          </div>
          <div className="small muted">
            Filled {dateTimeLabel(s.startedAt)} to {dateTimeLabel(s.finishedAt)} on the phone; received {dateTimeLabel(s.receivedAt)} (server time).
            {s.lat != null && s.lng != null && ` Location ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}.`}
          </div>
          {data.lead && (
            <div className="small">
              Sales lead {data.lead.ref}: {data.lead.prospect}
            </div>
          )}
          {s.address && <div className="small">{s.address}</div>}
          <h3 style={{ margin: 0 }}>Site details</h3>
          <dl className="kv small">
            <dt>Type</dt>
            <dd>{SURVEY_SITE_TYPE_LABEL[s.details.siteType]}</dd>
            {s.details.operatingHours && (
              <>
                <dt>Operating hours</dt>
                <dd>{s.details.operatingHours}</dd>
              </>
            )}
            {(Object.keys(NUMBER_LABEL) as (keyof typeof NUMBER_LABEL)[]).map((k) =>
              s.details[k] == null ? null : (
                <span key={k} style={{ display: 'contents' }}>
                  <dt>{NUMBER_LABEL[k]}</dt>
                  <dd>{s.details[k]}</dd>
                </span>
              ),
            )}
            <dt>Lighting</dt>
            <dd>{LIGHT_LABEL[s.details.lighting]}</dd>
            <dt>Fence</dt>
            <dd>{FENCE_LABEL[s.details.fence]}</dd>
            <dt>Alarm</dt>
            <dd>{s.details.alarm ? 'Yes' : 'No'}</dd>
            <dt>Guard house</dt>
            <dd>{s.details.guardhouse ? 'Yes' : 'No'}</dd>
            {s.measures.map((m, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <dt>{m.label}</dt>
                <dd>
                  {m.value} {SURVEY_UNIT_LABEL[m.unit]}
                </dd>
              </span>
            ))}
          </dl>
          {(s.risks.length > 0 || s.riskNote) && (
            <>
              <h3 style={{ margin: 0 }}>Risks</h3>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {s.risks.map((r) => (
                  <Chip key={r} tone="warn">
                    {SURVEY_RISK_LABEL[r]}
                  </Chip>
                ))}
              </div>
              {s.riskNote && <div className="small">{s.riskNote}</div>}
            </>
          )}
          <h3 style={{ margin: 0 }}>Guard posts: {s.guardsPerDay} guards a day</h3>
          <div className="list">
            {s.posts.map((p, i) => (
              <div key={i} className="list-item small">
                {p.name}: {p.coverHours} hours a day, {p.shiftHours}-hour shifts, {p.guardsPerShift} guard{p.guardsPerShift === 1 ? '' : 's'} a shift{p.armed ? ', armed' : ''}
              </div>
            ))}
          </div>
          <h3 style={{ margin: 0 }}>Findings</h3>
          <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
            {s.findings}
          </div>
          <h3 style={{ margin: 0 }}>Photos</h3>
          {s.noPhotoReason && <div className="notice" data-tone="warn">No photos: {s.noPhotoReason}</div>}
          {data.photos.map((p) => {
            const ref = s.photos.find((x) => x.n === p.n);
            return (
              <figure key={p.id} style={{ margin: 0 }}>
                <img src={p.image} alt={ref?.caption || `Survey photo ${p.n}`} style={{ width: '100%', borderRadius: 8 }} loading="lazy" />
                <figcaption className="small muted">
                  {ref?.caption ? `${ref.caption} · ` : ''}taken {ref ? dateTimeLabel(ref.capturedAt) : ''}
                  {ref?.lat != null && ref.lng != null ? ` · ${ref.lat.toFixed(5)}, ${ref.lng.toFixed(5)}` : ' · no GPS'} · <span className="mono">SHA-256 {p.sha256.slice(0, 12)}…</span>
                </figcaption>
              </figure>
            );
          })}
          {s.photos.some((p) => !p.received) && <div className="notice">{s.photos.filter((p) => !p.received).length} photo(s) still coming from the phone.</div>}
          {s.review && (
            <div className="notice" data-tone={s.review.outcome === 'accepted' ? 'ok' : 'crit'}>
              {s.review.outcome === 'accepted' ? 'Accepted' : 'Returned'} by {s.review.by} on {dateTimeLabel(s.review.at)}: {s.review.reason}
              {s.leadNote ? ` ${s.leadNote}` : ''}
            </div>
          )}
          {data.canReview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea className="textarea" aria-label="Your reason" placeholder="Your reason (needed for accept or return)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <ErrorNotice error={act.error} />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-lg" disabled={act.busy} onClick={() => act.run(() => api.siteSurveyReview(s.id, 'accepted', reason), 'Survey accepted').then((r) => r !== undefined && onClose())}>
                  Accept survey
                </button>
                <button className="btn btn-lg" disabled={act.busy} onClick={() => act.run(() => api.siteSurveyReview(s.id, 'returned', reason), 'Survey returned to the surveyor').then((r) => r !== undefined && onClose())}>
                  Return to surveyor
                </button>
              </div>
            </div>
          )}
          {data.canRedo && (
            <button
              className="btn btn-primary btn-lg"
              onClick={() => {
                onClose();
                onRedo({
                  ...blankForm(s.companyId),
                  target: s.leadId ? 'lead' : s.siteId ? 'site' : 'new',
                  leadId: s.leadId ?? '',
                  siteId: s.siteId ?? '',
                  place: s.leadId || s.siteId ? '' : s.place,
                  address: s.address,
                  details: {
                    ...s.details,
                    perimeterM: s.details.perimeterM?.toString() ?? '',
                    areaM2: s.details.areaM2?.toString() ?? '',
                    floors: s.details.floors?.toString() ?? '',
                    entrances: s.details.entrances?.toString() ?? '',
                    vehicleGates: s.details.vehicleGates?.toString() ?? '',
                    cctvCameras: s.details.cctvCameras?.toString() ?? '',
                  },
                  measures: s.measures.map((m) => ({ ...m, value: String(m.value) })),
                  risks: [...s.risks],
                  riskNote: s.riskNote,
                  posts: s.posts.map((p) => ({ ...p })),
                  findings: s.findings,
                  redoOf: s.id,
                });
              }}
            >
              Redo this survey (answers copied, take new photos)
            </button>
          )}
        </div>
      )}
    </Drawer>
  );
}

const LIGHT_LABEL = { good: 'Good', poor: 'Poor', none: 'None' } as const;
const FENCE_LABEL = { full: 'All round', partial: 'Part only', none: 'None' } as const;

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12))} />
    </label>
  );
}

/** The survey form. Every change is kept on the phone at once, so closing the app or losing battery loses nothing. */
function SurveyEditor({ initial, setup, onClose }: { initial: LocalSurvey; setup: SiteSurveySetup | null; onClose: (finished: boolean) => void }) {
  const [s, setS] = useState<LocalSurvey>(initial);
  const [camera, setCamera] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [locating, setLocating] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const f = s.form;
  const company = setup?.companies.find((c) => c.id === f.companyId);

  const save = useCallback(async (next: LocalSurvey) => {
    setS(next);
    try {
      await putLocal(next);
      setSaveErr(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  const set = (patch: Partial<SurveyForm>) => save({ ...s, updatedAt: Date.now(), state: s.state === 'refused' ? 'draft' : s.state, error: null, form: { ...f, ...patch } });
  const setD = (patch: Partial<SurveyForm['details']>) => set({ details: { ...f.details, ...patch } });
  const setPost = (i: number, patch: Partial<FormPost>) => set({ posts: f.posts.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const p of s.photos) {
        const img = await getPhoto(p.key);
        if (img) out[p.key] = img;
      }
      if (live) setThumbs(out);
    })();
    return () => {
      live = false;
    };
  }, [s.photos]);

  const locate = async () => {
    setLocating(true);
    const fix = await gps();
    setLocating(false);
    set({ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM });
  };

  const finish = async () => {
    const missing = missingBits(s);
    setProblems(missing);
    if (missing.length) return;
    await save({ ...s, state: 'ready', finishedAt: fromMs(Date.now()), updatedAt: Date.now(), nextTryAt: 0, tries: 0, error: null });
    onClose(true);
  };

  const max = RULES.siteSurvey.value.maxPhotos;
  const perDay = guardsPerDay(f.posts);
  return (
    <div className="survey" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 40 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h1 style={{ margin: 0 }}>Site survey</h1>
        <button className="btn btn-lg" onClick={() => onClose(false)}>
          Save and close
        </button>
      </div>
      <div className="muted small">Saved on this phone as you type. It is sent only when you press Finish and send.</div>
      {saveErr && <div className="notice" data-tone="crit">{saveErr}</div>}

      <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>1. Which place</h2>
        {setup && setup.companies.length > 1 && (
          <label className="field">
            <span className="label">Company</span>
            <select className="input" value={f.companyId} onChange={(e) => set({ companyId: e.target.value, leadId: '', siteId: '' })}>
              <option value="">Choose the company</option>
              {setup.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!setup && <div className="notice" data-tone="warn">The company list is not on this phone yet. Open this screen once with a signal.</div>}
        <Seg
          label="This survey is for"
          value={f.target}
          onChange={(target) => set({ target })}
          options={[
            ...(company?.leads.length ? ([['lead', 'A sales lead']] as [SurveyForm['target'], string][]) : []),
            ...(company?.sites.length ? ([['site', 'Our existing site']] as [SurveyForm['target'], string][]) : []),
            ['new', 'A new place'],
          ]}
        />
        {f.target === 'lead' && (
          <label className="field">
            <span className="label">Sales lead</span>
            <select className="input" value={f.leadId} onChange={(e) => set({ leadId: e.target.value })}>
              <option value="">Choose the lead</option>
              {company?.leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.ref} · {l.prospect}
                </option>
              ))}
            </select>
          </label>
        )}
        {f.target === 'site' && (
          <label className="field">
            <span className="label">Site</span>
            <select className="input" value={f.siteId} onChange={(e) => set({ siteId: e.target.value })}>
              <option value="">Choose the site</option>
              {company?.sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} · {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {f.target === 'new' && (
          <label className="field">
            <span className="label">Name of the place</span>
            <input className="input" value={f.place} onChange={(e) => set({ place: e.target.value.slice(0, 160) })} />
          </label>
        )}
        <label className="field">
          <span className="label">Address</span>
          <input className="input" value={f.address} onChange={(e) => set({ address: e.target.value.slice(0, 300) })} />
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-lg" disabled={locating} onClick={locate}>
            {locating ? 'Finding location…' : f.lat == null ? 'Record location (GPS)' : 'Record location again'}
          </button>
          <span className="small muted">{f.lat == null || f.lng == null ? 'No location yet. GPS works without signal; it may take a minute.' : `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)} ±${f.accuracyM ?? '?'} m`}</span>
        </div>
      </section>

      <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>2. Site details and measurements</h2>
        <Seg label="Type of site" value={f.details.siteType} onChange={(siteType) => setD({ siteType })} options={SURVEY_SITE_TYPES.map((t) => [t, SURVEY_SITE_TYPE_LABEL[t]])} />
        <label className="field">
          <span className="label">Operating hours</span>
          <input className="input" placeholder="e.g. 24 hours, or 8am to 6pm" value={f.details.operatingHours} onChange={(e) => setD({ operatingHours: e.target.value.slice(0, 80) })} />
        </label>
        <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {(Object.keys(NUMBER_LABEL) as (keyof typeof NUMBER_LABEL)[]).map((k) => (
            <NumberField key={k} label={NUMBER_LABEL[k]} value={f.details[k]} onChange={(v) => setD({ [k]: v })} />
          ))}
        </div>
        <Seg label="Lighting at night" value={f.details.lighting} onChange={(lighting) => setD({ lighting })} options={Object.entries(LIGHT_LABEL) as [SurveyForm['details']['lighting'], string][]} />
        <Seg label="Fence" value={f.details.fence} onChange={(fence) => setD({ fence })} options={Object.entries(FENCE_LABEL) as [SurveyForm['details']['fence'], string][]} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-lg" aria-pressed={f.details.alarm} onClick={() => setD({ alarm: !f.details.alarm })}>
            {f.details.alarm ? '✓ Alarm on site' : 'Alarm on site?'}
          </button>
          <button className="btn btn-lg" aria-pressed={f.details.guardhouse} onClick={() => setD({ guardhouse: !f.details.guardhouse })}>
            {f.details.guardhouse ? '✓ Guard house' : 'Guard house?'}
          </button>
        </div>
        <span className="label">Other measurements</span>
        {f.measures.map((m, i) => (
          <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: '2 1 140px' }} aria-label="What you measured" placeholder="What you measured" value={m.label} onChange={(e) => set({ measures: f.measures.map((x, k) => (k === i ? { ...x, label: e.target.value.slice(0, 80) } : x)) })} />
            <input className="input" style={{ flex: '1 1 80px' }} aria-label="Value" inputMode="decimal" value={m.value} onChange={(e) => set({ measures: f.measures.map((x, k) => (k === i ? { ...x, value: e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12) } : x)) })} />
            <select className="input" style={{ flex: '0 1 90px' }} aria-label="Unit" value={m.unit} onChange={(e) => set({ measures: f.measures.map((x, k) => (k === i ? { ...x, unit: e.target.value as typeof m.unit } : x)) })}>
              {Object.entries(SURVEY_UNIT_LABEL).map(([u, l]) => (
                <option key={u} value={u}>
                  {l}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" onClick={() => set({ measures: f.measures.filter((_, k) => k !== i) })}>
              Remove
            </button>
          </div>
        ))}
        {f.measures.length < RULES.siteSurvey.value.maxMeasures && (
          <div>
            <button className="btn btn-lg" onClick={() => set({ measures: [...f.measures, { label: '', value: '', unit: 'm' }] })}>
              Add a measurement
            </button>
          </div>
        )}
      </section>

      <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>3. Risks</h2>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {SURVEY_RISKS.map((r) => {
            const on = f.risks.includes(r);
            return (
              <button key={r} className={`btn${on ? ' btn-primary' : ''}`} aria-pressed={on} onClick={() => set({ risks: on ? f.risks.filter((x) => x !== r) : [...f.risks, r] })}>
                {on ? '✓ ' : ''}
                {SURVEY_RISK_LABEL[r]}
              </button>
            );
          })}
        </div>
        <textarea className="textarea" aria-label="Risk notes" placeholder="Anything else about the risks" value={f.riskNote} onChange={(e) => set({ riskNote: e.target.value.slice(0, 500) })} />
      </section>

      <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>4. Guard posts: {perDay} guard{perDay === 1 ? '' : 's'} a day</h2>
        {f.posts.map((p, i) => (
          <div key={i} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <input className="input" aria-label="Post name" value={p.name} onChange={(e) => setPost(i, { name: e.target.value.slice(0, 80) })} />
            <Seg label="Hours a day" value={p.coverHours} onChange={(coverHours) => setPost(i, { coverHours })} options={[[8, '8 h'], [12, '12 h'], [24, '24 h']]} />
            <Seg label="Shift length" value={p.shiftHours} onChange={(shiftHours) => setPost(i, { shiftHours })} options={[[8, '8 h'], [12, '12 h']]} />
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="label">Guards a shift</span>
              <button className="btn btn-lg" aria-label="One fewer guard" disabled={p.guardsPerShift <= 1} onClick={() => setPost(i, { guardsPerShift: p.guardsPerShift - 1 })}>
                −
              </button>
              <strong style={{ minWidth: 24, textAlign: 'center' }}>{p.guardsPerShift}</strong>
              <button className="btn btn-lg" aria-label="One more guard" disabled={p.guardsPerShift >= 50} onClick={() => setPost(i, { guardsPerShift: p.guardsPerShift + 1 })}>
                +
              </button>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" aria-pressed={p.armed} onClick={() => setPost(i, { armed: !p.armed })}>
                {p.armed ? '✓ Armed post' : 'Armed post?'}
              </button>
              {f.posts.length > 1 && (
                <button className="btn btn-ghost" onClick={() => set({ posts: f.posts.filter((_, k) => k !== i) })}>
                  Remove post
                </button>
              )}
            </div>
          </div>
        ))}
        {f.posts.length < RULES.siteSurvey.value.maxPosts && (
          <div>
            <button className="btn btn-lg" onClick={() => set({ posts: [...f.posts, { name: `Pos ${f.posts.length + 1}`, coverHours: 12, shiftHours: 12, guardsPerShift: 1, armed: false }] })}>
              Add a post
            </button>
          </div>
        )}
        <div className="small muted">Relief guards for rest days and leave are added in the quotation.</div>
      </section>

      <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>
          5. Photos ({s.photos.length} of {max})
        </h2>
        {s.photos.map((p, i) => (
          <div key={p.key} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            {thumbs[p.key] && <img src={thumbs[p.key]} alt={p.caption || `Photo ${i + 1}`} style={{ width: 96, borderRadius: 6 }} />}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input className="input" aria-label="Photo caption" placeholder="What the photo shows" value={p.caption} onChange={(e) => save({ ...s, updatedAt: Date.now(), photos: s.photos.map((x) => (x.key === p.key ? { ...x, caption: e.target.value.slice(0, 200) } : x)) })} />
              <span className="small muted">
                {dateTimeLabel(p.capturedAt)} · {p.lat == null ? 'no GPS' : `±${p.accuracyM ?? '?'} m`}
              </span>
            </div>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await deletePhoto(p.key);
                await save({ ...s, updatedAt: Date.now(), photos: s.photos.filter((x) => x.key !== p.key) });
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {s.photos.length === 0 && (
          <label className="field">
            <span className="label">Photos not allowed at this site? Say why</span>
            <input
              className="input"
              placeholder="e.g. protected place, client does not allow photos"
              value={f.noPhotoReason ?? ''}
              onChange={(e) => set({ noPhotoReason: e.target.value.slice(0, 300) })}
            />
          </label>
        )}
        {camera ? (
          <EvidenceCamera
            collect
            site={{ code: 'SURVEY', lat: f.lat ?? 3.139, lng: f.lng ?? 101.6869 }}
            refText={`Survey ${placeOf(f, setup)}`.slice(0, 60)}
            onSend={async (shot) => {
              const kept = await keepPhoto(s.ownerId, s.id, { image: shot.image, caption: shot.caption, capturedAt: shot.capturedAt ?? fromMs(Date.now()), lat: shot.lat, lng: shot.lng, accuracyM: shot.accuracyM });
              if (s.photos.some((x) => x.sha256 === kept.sha256)) return;
              await save({ ...s, updatedAt: Date.now(), photos: [...s.photos, kept] });
            }}
            onDone={() => setCamera(false)}
          />
        ) : (
          s.photos.length < max && (
            <div>
              <button className="btn btn-primary btn-lg" onClick={() => setCamera(true)}>
                Take a photo
              </button>
            </div>
          )
        )}
      </section>

      <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>6. Findings</h2>
        <textarea className="textarea" aria-label="Findings" rows={4} placeholder="What you found and what the client asked for" value={f.findings} onChange={(e) => set({ findings: e.target.value.slice(0, 2000) })} />
      </section>

      {problems.length > 0 && (
        <div className="notice" data-tone="crit">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-lg" onClick={finish}>
          Finish and send
        </button>
        <button className="btn btn-lg" onClick={() => onClose(false)}>
          Save and close
        </button>
      </div>
    </div>
  );
}
