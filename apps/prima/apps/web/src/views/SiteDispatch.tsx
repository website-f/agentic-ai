import { useEffect, useRef, useState } from 'react';
import { EVIDENCE_PLACE_LABEL, EVIDENCE_TIME_LABEL, fromMs, type EvidenceVideo } from '@prima/core';
import { api, type CmsDispatches, type DeviceDispatches, type VideoInput } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { EvidenceCamera, PhotoCard, gps, type Fix } from './Camera';
import { SiteDutyLogView } from './DutyDevice';

/**
 * CMS messages to a site's shared device (Fauzan, 6 Nov 2026). CMS sends an instruction, an alert or an urgent alert,
 * often after AI on CCTV or a sensor pin-points something. The guard takes it with staff number and PIN and verifies
 * with a time- and GPS-stamped photo, or a video from the device or a linked bodycam. CMS monitors and tells; a real
 * event opens the company's own case and the company decides.
 */

type Level = 'instruction' | 'alert' | 'urgent';
type Proof = 'none' | 'photo' | 'video' | 'photo_or_video';

export const LEVEL: Record<Level, { label: string; tone: Tone }> = {
  urgent: { label: 'Urgent', tone: 'crit' },
  alert: { label: 'Alert', tone: 'warn' },
  instruction: { label: 'Instruction', tone: 'info' },
};
const PROOF: Record<Proof, string> = { none: 'No proof needed', photo: 'Photo', video: 'Video', photo_or_video: 'Photo or video' };
const STATUS: Record<CmsDispatches['open'][number]['dispatch']['status'], { label: string; tone: Tone }> = {
  sent: { label: 'Sent, not shown yet', tone: 'warn' },
  received: { label: 'On the device screen', tone: 'warn' },
  acknowledged: { label: 'Guard checking', tone: 'info' },
  proof_sent: { label: 'Proof sent, review', tone: 'ok' },
  closed: { label: 'Closed', tone: 'neutral' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};
const OUTCOME = { real: 'Real, incident opened', nothing_found: 'Nothing found', done: 'Done', cancelled: 'Withdrawn' } as const;

const secs = (s: number) => (s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

// ---------- CMS side ----------

export function CmsDevicesTab() {
  const { data, error, reload } = useLoad(() => api.cmsDispatches(), []);
  const [draft, setDraft] = useState<{ siteId: string; alarmId: string | null; title: string; message: string; level: Level; proof: Proof } | null>(null);
  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="site device messages" />;
  const blank = { siteId: data.sites[0]?.id ?? '', alarmId: null, title: '', message: '', level: 'alert' as Level, proof: 'photo_or_video' as Proof };
  return (
    <>
      <div className="notice" data-tone="info">
        Send an instruction, alert or urgent alert to a site's shared device. The guard takes it with staff number and PIN, then sends a photo or video stamped
        with the time and location. AI detections are never proof by themselves: a person checks. A real event opens the company's own case; the company
        decides the response.
      </div>
      <Detections data={data} onSend={(d) => setDraft(d)} />
      {data.canDesk && <SendForm data={data} draft={draft ?? blank} key={draft ? `${draft.alarmId}-${draft.siteId}` : 'blank'} onSent={() => setDraft(null)} />}
      <section className="panel">
        <div className="panel-head">
          <h2>Open messages</h2>
          <span className="muted small">
            Take within {data.rule.value.ackSec.urgent} s (urgent), {secs(data.rule.value.ackSec.alert)} (alert), {secs(data.rule.value.ackSec.instruction)}{' '}
            (instruction). Rule {data.rule.id}, values proposed.
          </span>
        </div>
        <div className="list">
          {data.open.length === 0 && <div className="empty">No open messages.</div>}
          {data.open.map((r) => (
            <DispatchRow key={r.dispatch.id} r={r} canDesk={data.canDesk} />
          ))}
        </div>
      </section>
      <DutyLogPicker sites={data.sites} />
      <section className="panel">
        <div className="panel-head">
          <h2>Closed today</h2>
        </div>
        <div className="list">
          {data.closedToday.length === 0 && <div className="empty">None yet.</div>}
          {data.closedToday.map((r) => (
            <DispatchRow key={r.dispatch.id} r={r} canDesk={false} />
          ))}
        </div>
      </section>
    </>
  );
}

/** CMS reads a site's post log and gate log (read only). */
function DutyLogPicker({ sites }: { sites: CmsDispatches['sites'] }) {
  const [siteId, setSiteId] = useState<string>('');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Site duty logs</h2>
        <select className="select" aria-label="Site duty log" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">Choose a site</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} {s.name}
            </option>
          ))}
        </select>
      </div>
      {siteId && (
        <div className="panel-body">
          <SiteDutyLogView siteId={siteId} />
        </div>
      )}
    </section>
  );
}

function Detections({ data, onSend }: { data: CmsDispatches; onSend: (d: { siteId: string; alarmId: string; title: string; message: string; level: Level; proof: Proof }) => void }) {
  const act = useAction();
  const [simSite, setSimSite] = useState(data.sites[0]?.id ?? '');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>AI and sensor detections</h2>
        <span className="muted small">From CCTV and sensor analytics. Feed not connected yet: test detections only.</span>
      </div>
      <div className="list">
        {data.detections.length === 0 && <div className="empty">No detection waiting.</div>}
        {data.detections.map((x) => (
          <div key={x.alarm.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600 }}>
                {x.alarm.detection?.label ?? x.alarm.source} · {hhmm(x.alarm.at)}
              </div>
              <div className="muted small">
                {x.siteName} · {x.companyName} · {x.alarm.detection?.device ?? x.alarm.source}
              </div>
              <div className="row" style={{ gap: 4, marginTop: 4 }}>
                <Chip tone="unknown">Unverified, score {Math.round((x.alarm.detection?.confidence ?? 0) * 100)}%</Chip>
                {x.sent && <Chip tone="info">Site device sent</Chip>}
                {!x.device && <Chip tone="warn">No shared device: phone the site</Chip>}
              </div>
            </div>
            {data.canDesk && x.device && !x.sent && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() =>
                  onSend({
                    siteId: x.alarm.siteId,
                    alarmId: x.alarm.id,
                    level: 'alert',
                    proof: 'photo_or_video',
                    title: `Check ${x.alarm.detection?.device ?? 'the area'}`,
                    message: `${x.alarm.detection?.system === 'sensor' ? 'A sensor' : 'A camera'} shows "${x.alarm.detection?.label ?? 'something'}" at ${x.alarm.detection?.device ?? 'the site'}. Go and check now, then send a photo or video of what you see.`,
                  })
                }
              >
                Send site device to check
              </button>
            )}
          </div>
        ))}
      </div>
      {api.simulateDetection && data.canDesk && data.sites.length > 0 && (
        <div className="panel-body row" style={{ flexWrap: 'wrap' }}>
          <span className="label">Test only: an analytics detection arrives</span>
          <select className="select" aria-label="Site for the test detection" value={simSite} onChange={(e) => setSimSite(e.target.value)}>
            {data.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {s.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.simulateDetection!({ siteId: simSite, system: 'cctv', device: 'CAM-03 main gate', label: 'Vehicle stopped at gate for 10 min', confidence: 0.78 }), 'Test detection received')}
          >
            CCTV detection
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.simulateDetection!({ siteId: simSite, system: 'sensor', device: 'Smoke sensor store', label: 'Smoke detected', confidence: 0.9 }), 'Test detection received')}
          >
            Sensor detection
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </section>
  );
}

function SendForm({ data, draft, onSent }: { data: CmsDispatches; draft: { siteId: string; alarmId: string | null; title: string; message: string; level: Level; proof: Proof }; onSent: () => void }) {
  const [f, setF] = useState(draft);
  const act = useAction();
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  if (!data.sites.length) return <div className="notice" data-tone="warn">No site has a shared device yet.</div>;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{f.alarmId ? 'Send the site device to check' : 'Send to a site device'}</h2>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="field">
          <span className="label">Site</span>
          <select className="select" value={f.siteId} disabled={!!f.alarmId} onChange={(e) => set({ siteId: e.target.value })}>
            {data.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName} · {s.code} {s.name}
                {s.bodycams.length ? ' · bodycam' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="label">Level</span>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            {(['instruction', 'alert', 'urgent'] as Level[]).map((l) => (
              <button key={l} aria-pressed={f.level === l} onClick={() => set({ level: l, proof: l === 'instruction' ? f.proof : f.proof === 'none' ? 'photo_or_video' : f.proof })}>
                {LEVEL[l].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Proof the guard sends</span>
          <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            {(['photo_or_video', 'photo', 'video', 'none'] as Proof[])
              .filter((p) => p !== 'none' || f.level === 'instruction')
              .map((p) => (
                <button key={p} aria-pressed={f.proof === p} onClick={() => set({ proof: p })}>
                  {PROOF[p]}
                </button>
              ))}
          </div>
        </div>
        <label className="field">
          <span className="label">Title</span>
          <input className="input" value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Check the rear fence" />
        </label>
        <label className="field">
          <span className="label">What the guard must do</span>
          <textarea className="textarea" value={f.message} maxLength={600} onChange={(e) => set({ message: e.target.value })} />
        </label>
        <ErrorNotice error={act.error} />
        <div className="row">
          <button
            className={`btn ${f.level === 'urgent' ? 'btn-danger' : 'btn-primary'}`}
            disabled={act.busy || !f.siteId}
            onClick={async () => {
              const r = await act.run(() => api.sendDispatch(f), 'Sent to the site device');
              if (r) {
                onSent();
                setF({ ...draft, alarmId: null, title: '', message: '' });
              }
            }}
          >
            Send {LEVEL[f.level].label.toLowerCase()}
          </button>
          {f.alarmId && (
            <button className="btn btn-ghost" onClick={onSent}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function DispatchRow({ r, canDesk }: { r: CmsDispatches['open'][number]; canDesk: boolean }) {
  const d = r.dispatch;
  const act = useAction();
  const [note, setNote] = useState('');
  const st = STATUS[d.status];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {d.ref} · {d.title}
          </div>
          <div className="muted small">
            {r.siteCode} {r.siteName} · {r.companyName} · sent {hhmm(d.sentAt)} by {d.sentBy}
            {d.origin === 'ai_cctv' ? ' · after AI on CCTV' : d.origin === 'ai_sensor' ? ' · after AI on sensor' : d.origin === 'alarm' ? ' · after an alarm' : ''}
          </div>
          <div className="small">{d.message}</div>
          {d.ack && (
            <div className="muted small">
              Taken by {d.ack.name} ({d.ack.staffNo}) at {hhmm(d.ack.at)}
              {d.ack.onDuty ? '' : ' · not clocked in at this site'}
            </div>
          )}
          {d.reply && <div className="small">Guard: {d.reply}</div>}
          {d.closed && (
            <div className="muted small">
              {OUTCOME[d.closed.outcome]} by {d.closed.by} at {hhmm(d.closed.at)}: {d.closed.note}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <Chip tone={LEVEL[d.level].tone}>{LEVEL[d.level].label}</Chip>
          <Chip tone={r.ackLate ? 'crit' : r.proofLate ? 'warn' : st.tone}>
            {r.ackLate ? `Not taken after ${secs(r.waitedSec)}` : r.proofLate ? 'Proof late' : st.label}
          </Chip>
          <span className="muted small">{PROOF[d.proof]}</span>
        </div>
      </div>
      {(r.photos.length > 0 || r.videos.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {r.photos.map((p) => (
            <PhotoCard key={p.id} p={p} />
          ))}
          {r.videos.map((v) => (
            <VideoCard key={v.id} v={v} />
          ))}
        </div>
      )}
      {r.ackLate && <div className="notice" data-tone="crit">Nobody has taken this at the site. Phone the guard on duty or the site officer now.</div>}
      {canDesk && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 180 }} aria-label={`Note for ${d.ref}`} placeholder="What the proof shows, or why it is withdrawn" value={note} onChange={(e) => setNote(e.target.value)} />
          {d.ack && (
            <button className="btn btn-sm btn-danger" disabled={act.busy} onClick={() => act.run(() => api.closeDispatch(d.id, 'real', note), 'Real: incident opened for the company')}>
              Real: open incident
            </button>
          )}
          {d.ack && d.level !== 'instruction' && (
            <button className="btn btn-sm" disabled={act.busy || !r.proofDone} onClick={() => act.run(() => api.closeDispatch(d.id, 'nothing_found', note), 'Closed: nothing found')}>
              Nothing found
            </button>
          )}
          {d.ack && d.level === 'instruction' && (
            <button className="btn btn-sm" disabled={act.busy || !r.proofDone} onClick={() => act.run(() => api.closeDispatch(d.id, 'done', note), 'Closed as done')}>
              Done
            </button>
          )}
          <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => act.run(() => api.cancelDispatch(d.id, note), 'Withdrawn')}>
            Withdraw
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** A saved clip with what the server checked: place, distance, time and fingerprint. */
export function VideoCard({ v }: { v: EvidenceVideo }) {
  const tone = v.place === 'on_site' ? 'ok' : v.place === 'away' ? 'crit' : 'warn';
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {v.video && v.source !== 'test_clip' && api.mode !== 'demo' ? (
        <video src={v.video} controls playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} />
      ) : (
        <div className="notice" data-tone="neutral" style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}>
          {v.video ? `Test clip, not a real video (${v.durationSec} s)` : `Video held for the CMS desk (${v.durationSec} s)`}
        </div>
      )}
      <figcaption className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="row" style={{ gap: 4 }}>
          <Chip tone={tone}>
            {EVIDENCE_PLACE_LABEL[v.place]} · {v.distanceM} m
          </Chip>
          <Chip tone={v.time === 'ok' ? 'ok' : 'warn'}>{EVIDENCE_TIME_LABEL[v.time]}</Chip>
          <Chip tone="info">{v.source === 'bodycam' ? 'Bodycam' : v.source === 'test_clip' ? 'Test clip' : 'Device camera'}</Chip>
        </div>
        {v.caption && <div>{v.caption}</div>}
        <div className="muted">
          Taken {dateTimeLabel(v.capturedAt)}, received {dateTimeLabel(v.receivedAt)} · {v.takenBy} · kept until {v.keepUntil} (PDPA)
        </div>
        <div className="mono muted" title={v.sha256}>
          SHA-256 {v.sha256.slice(0, 16)}…
        </div>
      </figcaption>
    </figure>
  );
}

// ---------- Site device side ----------

type DeviceMsg = DeviceDispatches['open'][number];

/** Plays a short tone and vibrates. Browsers may stay silent until someone has touched the screen once. */
function ring(level: Level) {
  try {
    navigator.vibrate?.(level === 'urgent' ? [400, 150, 400, 150, 400] : [300]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = level === 'urgent' ? 880 : 660;
    g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (level === 'urgent' ? 0.9 : 0.4));
    o.onended = () => void ctx.close();
  } catch {
    /* no sound on this device */
  }
}

/** The banner at the top of the site device: messages from CMS, newest urgent first, sounding until taken. */
export function DeviceInbox({ site, onOpen }: { site: { id: string; code: string }; onOpen: (m: DeviceMsg) => void }) {
  const { data, reload } = useLoad(() => api.deviceDispatches(), [site.id]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    if (!data) return;
    for (const m of data.open) {
      if (m.status === 'sent' && !seen.current.has(m.id)) {
        seen.current.add(m.id);
        void api.dispatchSeen(m.id).catch(() => undefined);
      }
    }
    const loud = data.open.filter((m) => !m.ack && m.repeatSec > 0);
    if (!loud.length) return;
    const top = loud.some((m) => m.level === 'urgent') ? 'urgent' : 'alert';
    ring(top);
    const t = setInterval(() => ring(top), Math.min(...loud.map((m) => m.repeatSec)) * 1000);
    return () => clearInterval(t);
  }, [data]);
  if (!data || !data.open.length) return null;
  return (
    <section className="panel" aria-live="assertive">
      <div className="panel-head">
        <h3>From CMS</h3>
        <span className="muted small">{data.open.length} open</span>
      </div>
      <div className="list">
        {data.open.map((m) => (
          <button
            key={m.id}
            className="list-item"
            data-level={m.level}
            onClick={() => onOpen(m)}
            style={{
              textAlign: 'left',
              width: '100%',
              border: m.level === 'urgent' && !m.ack ? '2px solid var(--crit, #c62828)' : undefined,
              animation: m.level === 'urgent' && !m.ack ? 'pulse 1s ease-in-out infinite alternate' : undefined,
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>
                {LEVEL[m.level].label.toUpperCase()} · {m.title}
              </div>
              <div className="muted small">
                {m.ref} · {hhmm(m.sentAt)} · {m.ack ? `taken by ${m.ack.name}` : 'tap to take it'}
              </div>
            </div>
            <Chip tone={m.ack ? 'info' : LEVEL[m.level].tone}>{m.ack ? 'Send proof' : 'Take'}</Chip>
          </button>
        ))}
      </div>
    </section>
  );
}

/** One CMS message on the device: take it with staff number and PIN, send photo or video proof, say what was found. */
export function DeviceDispatch({ id, site, onDone }: { id: string; site: { id: string; code: string; lat: number; lng: number }; onDone: () => void }) {
  const { data, reload } = useLoad(() => api.deviceDispatches(), [id]);
  const [staffNo, setStaffNo] = useState('');
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'photo' | 'video' | 'bodycam' | null>(null);
  const [reply, setReply] = useState('');
  const act = useAction();
  if (!data) return <Loading what="message" />;
  const m = data.open.find((x) => x.id === id) ?? data.recent.find((x) => x.id === id);
  if (!m)
    return (
      <div className="device">
        <div className="notice">This message is closed.</div>
        <button className="btn btn-primary" onClick={onDone}>
          Back
        </button>
      </div>
    );
  const proofOk = m.proof === 'none' || (m.proof === 'photo' ? m.photos > 0 : m.proof === 'video' ? m.videos > 0 : m.photos + m.videos > 0);
  const press = (k: string) => setPin((p) => (k === '⌫' ? p.slice(0, -1) : p.length < 4 ? p + k : p));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {LEVEL[m.level].label}: {m.title}
        </h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="notice" data-tone={LEVEL[m.level].tone}>
          <div style={{ fontWeight: 600 }}>{m.message}</div>
          <div className="small muted">
            {m.ref} from CMS at {hhmm(m.sentAt)}
            {m.fromAi ? ' · spotted by AI on camera or sensor, not confirmed yet' : ''} · proof: {PROOF[m.proof].toLowerCase()}
          </div>
        </div>
        {m.closedAs && <div className="notice">CMS closed this: {m.closedAs}.</div>}
        {!m.ack && !m.closedAs && (
          <>
            <label className="field">
              <span className="label">Staff number</span>
              <input className="input mono" value={staffNo} onChange={(e) => setStaffNo(e.target.value.toUpperCase())} placeholder="e.g. SASA0002" autoComplete="off" />
            </label>
            <div className="field">
              <span className="label">PIN</span>
              <div className="pin-dots" aria-label={`${pin.length} of 4 digits entered`}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} data-on={i < pin.length} />
                ))}
              </div>
              <div className="keypad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
                  k ? (
                    <button key={i} onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : k}>
                      {k}
                    </button>
                  ) : (
                    <span key={i} />
                  ),
                )}
              </div>
            </div>
            <ErrorNotice error={act.error} />
            <button
              className="btn btn-primary"
              disabled={act.busy || !staffNo || pin.length !== 4}
              onClick={async () => {
                if (await act.run(() => api.acknowledgeDispatch(m.id, { staffNo, pin }), 'Taken. CMS knows you are checking.')) reload();
              }}
            >
              I am going to check
            </button>
          </>
        )}
        {m.ack && !m.closedAs && (
          <>
            <div className="row" style={{ gap: 6 }}>
              <Chip tone="info">Taken by {m.ack.name}</Chip>
              <Chip tone={m.photos ? 'ok' : 'neutral'}>{m.photos} photo{m.photos === 1 ? '' : 's'}</Chip>
              <Chip tone={m.videos ? 'ok' : 'neutral'}>{m.videos} video{m.videos === 1 ? '' : 's'}</Chip>
            </div>
            {m.proof !== 'none' && !mode && (
              <div className="big-actions">
                {m.proof !== 'video' && (
                  <button className="btn btn-primary" onClick={() => setMode('photo')}>
                    Take photo
                  </button>
                )}
                {m.proof !== 'photo' && (
                  <button className="btn" onClick={() => setMode('video')}>
                    Record video
                  </button>
                )}
                {m.proof !== 'photo' && data.bodycams.length > 0 && (
                  <button className="btn" onClick={() => setMode('bodycam')}>
                    Video from bodycam
                  </button>
                )}
              </div>
            )}
            {mode === 'photo' && (
              <EvidenceCamera
                site={site}
                refText={m.ref}
                onSend={async (p) => {
                  const r = await api.addDispatchPhoto(m.id, { ...p, caption: p.caption || m.title });
                  reload();
                  return r;
                }}
                onDone={() => setMode(null)}
              />
            )}
            {(mode === 'video' || mode === 'bodycam') && (
              <VideoCapture
                site={site}
                refText={m.ref}
                maxSec={data.rule.maxVideoSec}
                bodycam={mode === 'bodycam' ? data.bodycams[0] : null}
                onSend={async (v) => {
                  const r = await api.addDispatchVideo(m.id, { ...v, caption: v.caption || m.title });
                  reload();
                  return r;
                }}
                onDone={() => setMode(null)}
              />
            )}
            {!mode && m.status !== 'proof_sent' && (
              <>
                <label className="field">
                  <span className="label">What you found</span>
                  <textarea className="textarea" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Two men at the fence ran away, fence not cut" />
                </label>
                <ErrorNotice error={act.error} />
                <button
                  className="btn btn-primary"
                  disabled={act.busy || reply.trim().length < 3 || !proofOk}
                  onClick={async () => {
                    if (await act.run(() => api.replyDispatch(m.id, reply), 'Sent to CMS')) onDone();
                  }}
                >
                  Send to CMS
                </button>
                {!proofOk && <span className="muted small">Send the {PROOF[m.proof].toLowerCase()} first.</span>}
              </>
            )}
            {m.status === 'proof_sent' && <div className="notice" data-tone="ok">Sent to CMS: {m.reply}. You can add more photos or videos.</div>}
          </>
        )}
        <span className="muted small">
          Video records people's faces and voices. Record only what CMS asked about. Clips are kept {data.rule.videoKeepDays} days unless a case needs them (proposed, PDPA).
        </span>
      </div>
    </section>
  );
}

const toDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The video could not be read.'));
    r.readAsDataURL(b);
  });

/**
 * Records a short clip on the device camera, or takes the last clip from the linked bodycam. The bodycam bridge is a
 * mock until a brand is chosen, so outside the test version the bodycam button is not offered. The test page cannot
 * open the camera, so it sends a small test clip that the live server refuses.
 */
function VideoCapture({
  site,
  refText,
  maxSec,
  bodycam,
  onSend,
  onDone,
}: {
  site: { code: string; lat: number; lng: number };
  refText: string;
  maxSec: number;
  bodycam: { id: string; name: string } | null;
  onSend: (v: VideoInput) => Promise<unknown>;
  onDone: () => void;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [clip, setClip] = useState<VideoInput | null>(null);
  const [recording, setRecording] = useState(0);
  const [where, setWhere] = useState<'site' | 'away' | 'gps'>(api.mode === 'demo' ? 'site' : 'gps');
  const act = useAction();

  useEffect(() => {
    if (bodycam) return;
    let s: MediaStream | null = null;
    let live = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setCamErr('This browser cannot record video.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 } }, audio: true })
      .then((m) => {
        if (!live) return m.getTracks().forEach((t) => t.stop());
        s = m;
        setStream(m);
      })
      .catch(() => setCamErr('The camera is blocked. Allow the camera and microphone for this app.'));
    return () => {
      live = false;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [bodycam]);
  useEffect(() => {
    if (preview.current && stream) {
      preview.current.srcObject = stream;
      void preview.current.play().catch(() => undefined);
    }
  }, [stream]);

  const fix = async (): Promise<Fix> => {
    if (where === 'site') return { lat: site.lat + 0.0001, lng: site.lng - 0.0001, accuracyM: 8 };
    if (where === 'away') return { lat: site.lat + 0.012, lng: site.lng, accuracyM: 12 };
    return gps();
  };
  const testClip = (label: string) => `data:video/webm;base64,${btoa(`TEST CLIP ${label} ${site.code} ${Date.now()}`)}`;

  const start = async () => {
    if (!stream) {
      // Test version only: no camera on the test page.
      const f = await fix();
      setClip({ video: testClip('device'), durationSec: 8, capturedAt: fromMs(Date.now()), ...f, source: 'test_clip' });
      return;
    }
    const chunks: Blob[] = [];
    const type = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const r = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 350_000, audioBitsPerSecond: 32_000 });
    const begun = Date.now();
    const f = await fix();
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      setRecording(0);
      const raw = await toDataUrl(new Blob(chunks, { type }));
      // The server takes a plain video/webm or video/mp4 data URL, without codec details.
      const video = `data:${type};base64,${raw.slice(raw.indexOf(',') + 1)}`;
      setClip({ video, durationSec: Math.max(1, Math.round((Date.now() - begun) / 1000)), capturedAt: fromMs(begun), ...f, source: 'device_camera' });
    };
    rec.current = r;
    r.start();
    setRecording(begun);
    setTimeout(() => r.state === 'recording' && r.stop(), maxSec * 1000);
  };

  const fromBodycam = async () => {
    // Mock bridge: the paired bodycam's last clip, with the site device's own GPS.
    const f = await fix();
    setClip({ video: testClip(bodycam!.name), durationSec: 15, capturedAt: fromMs(Date.now() - 20_000), ...f, source: 'bodycam', bodycamId: bodycam!.id });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {bodycam ? (
        <div className="notice" data-tone="info">
          {api.mode === 'demo'
            ? `${bodycam.name}: test connection. The real bodycam link is built once a brand is chosen.`
            : `${bodycam.name}: the bodycam link is not connected yet. Record on the device instead.`}
        </div>
      ) : (
        <>
          {!clip && stream && <video ref={preview} playsInline muted style={{ width: '100%', borderRadius: 8, background: '#000' }} />}
          {!clip && !stream && camErr && (
            <div className="notice" data-tone={api.mode === 'demo' ? 'info' : 'warn'}>
              {api.mode === 'demo' ? 'The test page cannot open the camera, so a test clip is used.' : camErr}
            </div>
          )}
        </>
      )}
      {api.mode === 'demo' && !clip && (
        <div className="field">
          <span className="label">Test only: where the device is</span>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button aria-pressed={where === 'site'} onClick={() => setWhere('site')}>
              At the site
            </button>
            <button aria-pressed={where === 'away'} onClick={() => setWhere('away')}>
              1.3 km away
            </button>
          </div>
        </div>
      )}
      {clip && (
        <div className="notice" data-tone="ok">
          {clip.source === 'bodycam' ? 'Bodycam clip' : clip.source === 'test_clip' ? 'Test clip' : 'Video'} ready: {clip.durationSec} s, taken {dateTimeLabel(clip.capturedAt)}
          {clip.lat == null ? ', no GPS' : `, ${clip.lat.toFixed(5)}, ${clip.lng!.toFixed(5)}`}.
        </div>
      )}
      <ErrorNotice error={act.error} />
      <div className="row">
        {!clip && !recording && (
          <button className="btn btn-primary" disabled={api.mode !== 'demo' && (!!bodycam || !stream)} onClick={bodycam ? fromBodycam : start}>
            {bodycam ? 'Get last bodycam clip' : `Record (up to ${maxSec} s)`}
          </button>
        )}
        {!!recording && (
          <button className="btn btn-danger" onClick={() => rec.current?.stop()}>
            Stop recording
          </button>
        )}
        {clip && (
          <>
            <button
              className="btn btn-primary"
              disabled={act.busy}
              onClick={async () => {
                if (await act.run(() => onSend(clip).then(() => true), 'Video sent with its time and location')) onDone();
              }}
            >
              Send video
            </button>
            <button className="btn" disabled={act.busy} onClick={() => setClip(null)}>
              Again
            </button>
          </>
        )}
        <button className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
