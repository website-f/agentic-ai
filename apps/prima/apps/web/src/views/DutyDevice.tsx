import { useEffect, useState } from 'react';
import {
  GATE_FLAG_LABEL,
  POST_LOG_KINDS,
  POST_LOG_LABEL,
  RULES,
  SITE_TASK_FOR_LABEL,
  VISITOR_ID_KINDS,
  VISITOR_ID_LABEL,
  sealForInhouse,
  type FaceCapture,
  type GateFlag,
  type PostLogKind,
  type SealedBundle,
  type VisitorIdKind,
} from '@prima/core';
import { api, type GateInInput, type PhotoInput } from '../api';
import { Chip, ErrorNotice, Loading, hhmm, useAction, useLoad, type Tone } from '../ui';
import { EvidenceCamera, PhotoCard } from './Camera';
import { OUTBOX_CHANGED, deviceNow, flush, isTestOffline, loadDuty, outbox, removeRefused, setTestOffline, startOutbox, submit, type OutboxItem } from '../duty/offline';
import { canReadText, readIdNumber, sampleCardImage, shrinkImage } from '../duty/idphoto';

/**
 * The one-stop guard duty device (Fauzan, 6 Nov 2026): the post log, the visitor and vehicle log with evidence, the
 * visitor's IC or licence photographed and the face checked against it, plates checked against the site vehicle list,
 * and pages of a site's written in/out book. Every entry is signed with staff number and PIN.
 *
 * Police may need the full details of anyone who came in, kept 2 to 7 years: the full number, the IC picture and book
 * pages are sealed on the phone for the company's in-house server, and Prima keeps only the last 4 characters readable.
 * With no internet, entries are kept encrypted on the device and sent when the signal returns (duty/offline.ts).
 * The IC reader, plate reader and face engine are not connected yet: the phone camera is used first.
 */

type Site = { id: string; code: string; companyId: string; lat: number; lng: number; geofenceM: number };
const FLAG_TONE = (f: GateFlag): Tone => (f === 'PLATE_ON_WATCH' || f === 'FACE_NOT_MATCHED' ? 'crit' : 'warn');

/** Re-renders when the device outbox changes. */
function useOutbox(siteId: string) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [v, setV] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    startOutbox();
    const on = () => setV((x) => x + 1);
    window.addEventListener(OUTBOX_CHANGED, on);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener(OUTBOX_CHANGED, on);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  useEffect(() => {
    let live = true;
    void outbox(siteId).then((x) => { if (live) { setItems(x); setError(null); } }).catch(() => { if (live) { setItems([]); setError('Cannot read pending entries. Records have not been deleted; ask a supervisor before clearing browser data.'); } });
    return () => {
      live = false;
    };
  }, [siteId, v]);
  return { items, version: v, error };
}

export function PinPad({ staffNo, setStaffNo, pin, setPin }: { staffNo: string; setStaffNo: (v: string) => void; pin: string; setPin: (f: (p: string) => string) => void }) {
  const press = (k: string) => setPin((p) => (k === '⌫' ? p.slice(0, -1) : p.length < 4 ? p + k : p));
  return (
    <>
      <label className="field">
        <span className="label">Your staff number</span>
        <input className="input mono" value={staffNo} onChange={(e) => setStaffNo(e.target.value.toUpperCase())} placeholder="e.g. SASA0002" autoComplete="off" />
      </label>
      <div className="field">
        <span className="label">Your PIN</span>
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
    </>
  );
}

/** Who is inside now, what is waiting to send, and the last post log lines, on the device home screen. */
export function DutyHome({
  site,
  onGate,
  onLog,
  onPaper,
  onOut,
  onTask,
}: {
  site: Site;
  onGate: () => void;
  onLog: () => void;
  onPaper: () => void;
  onOut: (id: string, label: string) => void;
  onTask: (t: DeviceTask) => void;
}) {
  const box = useOutbox(site.id);
  const { data, error } = useLoad(() => loadDuty(), [site.id, box.version]);
  const act = useAction();
  const demo = api.mode === 'demo';
  const waiting = box.items.filter((i) => i.status === 'waiting');
  const refused = box.items.filter((i) => i.status === 'refused');
  const leftIds = new Set(box.items.filter((i) => i.kind === 'gateOut').map((i) => i.clientRef.replace(/-out$/, '')));
  const doneHere = new Set(box.items.filter((i) => i.kind === 'task').map((i) => i.clientRef.replace(/-\d{4}-\d{2}-\d{2}$/, '')));
  return (
    <>
      {data && data.tasks.length > 0 && <TodayTasks tasks={data.tasks} waiting={doneHere} onTask={onTask} />}
      <div className="big-actions">
        {data?.gateOn !== false && (
          <button className="btn btn-primary" onClick={onGate}>
            Visitor or vehicle in
          </button>
        )}
        <button className="btn" onClick={onLog}>
          Write in post log
        </button>
        {data?.gateOn !== false && (
          <button className="btn" onClick={onPaper}>
            Upload written book page
          </button>
        )}
      </div>
      {data?.gateOn === false && <span className="muted small">Visitors and vehicles are recorded on the site's own system, as set by the OM.</span>}
      {demo && (
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={isTestOffline()} onChange={(e) => setTestOffline(e.target.checked)} />
          Test only: this site has no internet
        </label>
      )}
      {data && !data.offlineContext && <div className="notice" data-tone="warn">Offline recording is disabled for this enrollment. Older pending records, if any, remain locked on this browser. Do not clear browser data or re-enroll it until a supervisor has reconciled them.</div>}
      {data?.offline && <div className="notice" data-tone="warn">No internet. Entries are kept encrypted on this device and sent when the signal returns. Lists below are from the last time it was online.</div>}
      {!data?.offline && data && !data.inhouseKey && (
        <div className="notice" data-tone="warn">The in-house records server is not set up yet, so the full IC number cannot be kept. Entries are marked.</div>
      )}
      {(waiting.length > 0 || refused.length > 0) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Waiting to send</h3>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => flush(), (r) => (r.sent ? `${r.sent} sent` : 'Still no internet'))}>
              Send now
            </button>
          </div>
          <div className="list">
            {[...refused, ...waiting].map((i) => (
              <div key={i.clientRef} className="list-item">
                <div>
                  <div className="small" style={{ fontWeight: 600 }}>
                    {i.label}
                  </div>
                  <div className="muted small">
                    Written {hhmm(i.createdAt)} on this device{i.tries ? ` · tried ${i.tries}×` : ''}
                    {i.error ? ` · Refused: ${i.error}` : ''}
                  </div>
                </div>
                {i.status === 'refused' ? (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      if (window.confirm('Remove this entry from the device? Write it in the paper book first and tell your supervisor.')) void removeRefused(i.clientRef);
                    }}
                  >
                    Remove
                  </button>
                ) : i.gateId && !leftIds.has(i.gateId) ? (
                  <button className="btn btn-sm" onClick={() => onOut(i.gateId!, i.label.replace(/^Gate in: /, ''))}>
                    Out
                  </button>
                ) : (
                  <Chip tone="warn">Waiting</Chip>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <ErrorNotice error={box.error ?? error} />
      {data && (data.gateOn !== false || data.inside.length > 0) && (
        <section className="panel">
          <div className="panel-head">
            <h3>Inside now</h3>
            <span className="muted small">{data.inside.length}</span>
          </div>
          <div className="list">
            {data.inside.length === 0 && <div className="empty">Nobody signed in at the gate.</div>}
            {data.inside
              .filter((g) => !leftIds.has(g.id))
              .map((g) => (
                <div key={g.id} className="list-item">
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {g.visitor ? g.visitor.name : 'Vehicle'}
                      {g.vehicle ? ` · ${g.vehicle.plate}` : ''}
                    </div>
                    <div className="muted small">
                      {g.ref} · in {hhmm(g.inAt)}
                      {g.visitor ? ` · ${g.visitor.host}` : ''}
                    </div>
                    {(g.flags.length > 0 || g.longStay) && (
                      <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {g.longStay && <Chip tone="warn">Inside over {data.rule.insideAlertHours} h</Chip>}
                        {g.flags.map((f) => (
                          <Chip key={f} tone={FLAG_TONE(f)}>
                            {GATE_FLAG_LABEL[f]}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-sm" onClick={() => onOut(g.id, g.visitor?.name ?? g.vehicle?.plate ?? g.ref)}>
                    Out
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}
      {data && data.postLog.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Post log</h3>
            <span className="muted small">Today and yesterday</span>
          </div>
          <div className="list">
            {data.postLog.slice(0, 6).map((l) => (
              <div key={l.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="small">{l.text}</div>
                  <div className="muted small">
                    {hhmm(l.at)} · {POST_LOG_LABEL[l.kind]} · {l.name} ({l.staffNo}){l.correctsId ? ' · correction' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const savedOnDevice = 'No internet: saved on this device, encrypted. It is sent when the signal returns.';

type DeviceTask = Awaited<ReturnType<typeof loadDuty>>['tasks'][number];
const TASK_TONE: Record<DeviceTask['state'], Tone> = { late: 'crit', open: 'warn', not_done: 'warn', done: 'ok', done_late: 'warn', missed: 'crit', not_due: 'neutral' };
const TASK_STATE: Record<DeviceTask['state'], string> = { late: 'Late', open: 'To do', not_done: 'Not done', done: 'Done', done_late: 'Done, sent later', missed: 'Missed', not_due: '' };

/** Today's tasks from the OM, on top of the device home screen (Fauzan, 6 Nov 2026). */
function TodayTasks({ tasks, waiting, onTask }: { tasks: DeviceTask[]; waiting: Set<string>; onTask: (t: DeviceTask) => void }) {
  const left = tasks.filter((t) => (t.state === 'open' || t.state === 'late') && !waiting.has(t.id)).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Tasks today</h3>
        <span className="muted small">{left ? `${left} to do` : 'All recorded'}</span>
      </div>
      <div className="list">
        {tasks.map((t) => {
          const pending = waiting.has(t.id);
          const open = (t.state === 'open' || t.state === 'late') && !pending;
          return (
            <div key={t.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div className="muted small">
                  {SITE_TASK_FOR_LABEL[t.forRole]}
                  {t.byTime ? ` · by ${t.byTime}` : ' · any time today'}
                  {t.proof === 'photo' ? ' · photo needed' : ''}
                  {t.doneBy ? ` · ${t.doneBy}${t.doneAt ? ` at ${hhmm(t.doneAt)}` : ''}` : ''}
                </div>
              </div>
              {open ? (
                <button className={t.state === 'late' ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => onTask(t)}>
                  {t.state === 'late' ? 'Late: do now' : 'Do'}
                </button>
              ) : (
                <Chip tone={pending ? 'warn' : TASK_TONE[t.state]}>{pending ? 'Waiting to send' : TASK_STATE[t.state]}</Chip>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Sign off a task: done (with a photo where needed) or not done with the reason. */
export function TaskDoForm({ site, task, onDone }: { site: Site; task: DeviceTask; onDone: () => void }) {
  const [result, setResult] = useState<'done' | 'not_done'>('done');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [camera, setCamera] = useState(false);
  const [staffNo, setStaffNo] = useState('');
  const [pin, setPin] = useState('');
  const act = useAction();
  const needPhoto = result === 'done' && task.proof === 'photo';
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{task.title}</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {task.detail && <div className="small">{task.detail}</div>}
        <span className="muted small">
          For the {SITE_TASK_FOR_LABEL[task.forRole].toLowerCase()}
          {task.byTime ? `, by ${task.byTime}` : ''}. Set by the Operations Manager.
        </span>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button aria-pressed={result === 'done'} onClick={() => setResult('done')}>
            Done
          </button>
          <button aria-pressed={result === 'not_done'} onClick={() => setResult('not_done')}>
            Cannot do it
          </button>
        </div>
        <label className="field">
          <span className="label">{result === 'done' ? 'Note (optional)' : 'Why it cannot be done'}</span>
          <textarea className="textarea" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        {result === 'done' && (
          <div className="field">
            <span className="label">{needPhoto ? 'Photo (needed)' : 'Photo (optional)'}</span>
            {photo ? (
              <div className="row">
                <Chip tone="ok">Photo ready</Chip>
                <button className="btn btn-sm btn-ghost" onClick={() => setPhoto(null)}>
                  Retake
                </button>
              </div>
            ) : camera ? (
              <EvidenceCamera site={site} refText={`${site.code} task`} collect onSend={async (p) => setPhoto(p)} onDone={() => setCamera(false)} />
            ) : (
              <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCamera(true)}>
                Take photo
              </button>
            )}
          </div>
        )}
        <PinPad staffNo={staffNo} setStaffNo={setStaffNo} pin={pin} setPin={setPin} />
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !staffNo || pin.length !== 4 || (needPhoto && !photo) || (result === 'not_done' && note.trim().length < 3)}
          onClick={async () => {
            const r = await act.run(
              () => submit({ kind: 'task', id: task.id, title: task.title, body: { staffNo, pin, result, note, photo: result === 'done' ? photo : null } }),
              (x) => (x.sent ? (result === 'done' ? 'Task recorded as done' : 'Recorded as not done') : savedOnDevice),
            );
            if (r) onDone();
          }}
        >
          Sign and save
        </button>
      </div>
    </section>
  );
}

/** A line in the post log: what, optional stamped photo, signed with staff number and PIN. Kept on the device if offline. */
export function PostLogForm({ site, onDone }: { site: Site; onDone: () => void }) {
  const [kind, setKind] = useState<PostLogKind>('routine');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [camera, setCamera] = useState(false);
  const [staffNo, setStaffNo] = useState('');
  const [pin, setPin] = useState('');
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Write in post log</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <span className="label">Kind</span>
          <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            {POST_LOG_KINDS.map((k) => (
              <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {POST_LOG_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="label">What happened</span>
          <textarea className="textarea" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="e.g. 22:00 locked side gate, all clear" />
        </label>
        {photo ? (
          <div className="row">
            <Chip tone="ok">Photo added</Chip>
            <button className="btn btn-sm btn-ghost" onClick={() => setPhoto(null)}>
              Remove
            </button>
          </div>
        ) : camera ? (
          <EvidenceCamera site={site} refText={`${site.code} post log`} collect onSend={async (p) => setPhoto(p)} onDone={() => setCamera(false)} />
        ) : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCamera(true)}>
            Add photo (optional)
          </button>
        )}
        <PinPad staffNo={staffNo} setStaffNo={setStaffNo} pin={pin} setPin={setPin} />
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || text.trim().length < 3 || !staffNo || pin.length !== 4}
          onClick={async () => {
            const r = await act.run(() => submit({ kind: 'post', body: { staffNo, pin, kind, text, photo } }), (x) => (x.sent ? 'Written in the post log' : savedOnDevice));
            if (r) onDone();
          }}
        >
          Sign and save
        </button>
        <span className="muted small">A saved line cannot be changed. To put a mistake right, write a new line.</span>
      </div>
    </section>
  );
}

type FaceTest = 'match' | 'nomatch' | 'none';
const TEST_IDS = [
  { name: 'Sample Visitor One', idKind: 'mykad' as VisitorIdKind, idNumber: '900101-14-5678' },
  { name: 'Sample Driver Two', idKind: 'driving_licence' as VisitorIdKind, idNumber: 'D8812345' },
];
const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * A visitor or vehicle comes in. The guard photographs the IC or licence; the number is read from the picture where
 * the phone can, otherwise the guard types it from the picture. The full number and the picture are sealed for the
 * in-house server; Prima keeps the last 4. The face is checked against the card, the plate against the site list, and
 * a stamped photo is taken. A plate on watch tells CMS at once; the guard still decides at the gate.
 */
export function GateInForm({ site, onDone }: { site: Site; onDone: () => void }) {
  const duty = useLoad(() => loadDuty(), [site.id]);
  const [kind, setKind] = useState<'visitor' | 'vehicle'>('visitor');
  const [name, setName] = useState('');
  const [idKind, setIdKind] = useState<VisitorIdKind>('mykad');
  const [idNumber, setIdNumber] = useState('');
  const [idRead, setIdRead] = useState<'photo' | 'scan' | 'typed'>('typed');
  const [idPhoto, setIdPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [company, setCompany] = useState('');
  const [host, setHost] = useState('');
  const [purpose, setPurpose] = useState('');
  const [faceTest, setFaceTest] = useState<FaceTest>('match');
  const [faceDone, setFaceDone] = useState(false);
  const [plate, setPlate] = useState('');
  const [plateRead, setPlateRead] = useState<'photo' | 'scan' | 'typed'>('typed');
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [camera, setCamera] = useState(false);
  const [staffNo, setStaffNo] = useState('');
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<{ ref: string | null; flags: GateFlag[]; alarm: boolean; queued: boolean; watch: boolean } | null>(null);
  const act = useAction();
  const demo = api.mode === 'demo';
  if (duty.error) return <ErrorNotice error={duty.error} />;
  if (!duty.data) return <Loading what="gate" />;
  const d = duty.data;
  const listed = plate ? d.vehicles.find((v) => v.plate === clean(plate)) : undefined;

  const face = (): FaceCapture | null => {
    // The face engine is not connected outside the test version, so no score is sent and the entry is marked.
    if (!demo || !faceDone || faceTest === 'none') return null;
    return faceTest === 'match' ? { score: 0.93, live: true } : { score: 0.41, live: true };
  };

  const takeIdPhoto = async (file: File | null) => {
    if (!file) return;
    setReading(true);
    try {
      const pic = await shrinkImage(file, 1200, 0.7);
      setIdPhoto(pic);
      const n = await readIdNumber(pic);
      if (n) {
        setIdNumber(n);
        setIdRead('photo');
      }
    } finally {
      setReading(false);
    }
  };

  if (result)
    return (
      <div className="device">
        <div className="notice" data-tone={result.watch || result.alarm ? 'crit' : result.flags.length || result.queued ? 'warn' : 'ok'}>
          {result.queued ? savedOnDevice : `${result.ref} recorded.`}
          {result.alarm ? ' This plate is on watch: CMS has been told. Do not let it in until your supervisor or CMS says so.' : ''}
          {result.queued && result.watch ? ' This plate is on watch and CMS has NOT been told because there is no internet. Phone CMS now and do not let it in.' : ''}
          {result.flags.length > 0 && <div style={{ marginTop: 6 }}>{result.flags.map((f) => GATE_FLAG_LABEL[f]).join(' · ')}</div>}
        </div>
        <button className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    );

  const fullOk = clean(idNumber).length >= 5;
  const canSeal = !!d.inhouseKey;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Visitor or vehicle in</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {d.offline && <div className="notice" data-tone="warn">No internet. This entry is kept encrypted on the device and sent later.</div>}
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button aria-pressed={kind === 'visitor'} onClick={() => setKind('visitor')}>
            Visitor
          </button>
          <button aria-pressed={kind === 'vehicle'} onClick={() => setKind('vehicle')}>
            Vehicle only
          </button>
        </div>
        {kind === 'visitor' && (
          <>
            <div className="field">
              <span className="label">Photo of the IC or licence</span>
              {idPhoto ? (
                <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <img src={idPhoto} alt="The visitor's card as photographed" style={{ maxWidth: 260, width: '100%', borderRadius: 6, border: '1px solid var(--line)' }} />
                  <button className="btn btn-sm btn-ghost" onClick={() => (setIdPhoto(null), setIdRead('typed'))}>
                    Retake
                  </button>
                </div>
              ) : (
                <label className="btn" style={{ alignSelf: 'flex-start' }}>
                  {reading ? 'Reading…' : 'Photograph the card'}
                  <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void takeIdPhoto(e.target.files?.[0] ?? null)} />
                </label>
              )}
              {demo && !idPhoto && (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="muted small">Test only: photograph a sample card</span>
                  {TEST_IDS.map((t) => (
                    <button
                      key={t.idNumber}
                      className="btn btn-sm"
                      onClick={() => {
                        setIdPhoto(sampleCardImage(t.name, t.idNumber, VISITOR_ID_LABEL[t.idKind]));
                        setName(t.name);
                        setIdKind(t.idKind);
                        setIdNumber(t.idNumber);
                        setIdRead('photo');
                      }}
                    >
                      {VISITOR_ID_LABEL[t.idKind]}
                    </button>
                  ))}
                </div>
              )}
              <span className="muted small">
                {canReadText() ? 'The number is read from the picture. Check it.' : 'Read the name and number from the picture and type them.'} The picture and full number are locked for the company's in-house
                server; this app keeps only the last 4.
              </span>
            </div>
            <label className="field">
              <span className="label">Document</span>
              <select className="select" value={idKind} onChange={(e) => setIdKind(e.target.value as VisitorIdKind)}>
                {VISITOR_ID_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {VISITOR_ID_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Name as on the card</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Full ID number</span>
              <input
                className="input mono"
                value={idNumber}
                onChange={(e) => (setIdNumber(e.target.value), setIdRead(idPhoto ? 'photo' : 'typed'))}
                autoComplete="off"
              />
              {!canSeal && <span className="muted small">The in-house server is not set up: only the last 4 can be kept, and the entry is marked.</span>}
            </label>
            <div className="field">
              <span className="label">Face against the card</span>
              {demo ? (
                <>
                  <span className="muted small">Test only: what the camera sees</span>
                  <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                    <button aria-pressed={faceTest === 'match'} onClick={() => setFaceTest('match')}>
                      Same person
                    </button>
                    <button aria-pressed={faceTest === 'nomatch'} onClick={() => setFaceTest('nomatch')}>
                      Someone else
                    </button>
                    <button aria-pressed={faceTest === 'none'} onClick={() => setFaceTest('none')}>
                      Skip
                    </button>
                  </div>
                  <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setFaceDone(true)}>
                    {faceDone ? 'Face checked' : 'Check face'}
                  </button>
                </>
              ) : (
                <div className="notice" data-tone="warn">The face engine is not connected yet, so the entry is marked as face not checked. Compare the face with the card yourself.</div>
              )}
            </div>
            <label className="field">
              <span className="label">From (company)</span>
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Visiting</span>
              <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="Person or office" />
            </label>
            <label className="field">
              <span className="label">Purpose</span>
              <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </label>
          </>
        )}
        <div className="field">
          <span className="label">{kind === 'visitor' ? 'Vehicle plate (if they drive in)' : 'Vehicle plate'}</span>
          {demo ? (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="muted small">Test only: the plate camera reads</span>
              {[...d.vehicles.map((v) => v.plate), 'JQW5512'].map((p) => (
                <button key={p} className="btn btn-sm" onClick={() => (setPlate(p), setPlateRead('scan'))}>
                  {p}
                </button>
              ))}
            </div>
          ) : (
            <span className="muted small">The plate reader is not connected yet. Type the plate from the vehicle photo; it is checked against the site list.</span>
          )}
          <input className="input mono" value={plate} onChange={(e) => (setPlate(e.target.value.toUpperCase()), setPlateRead(photo ? 'photo' : 'typed'))} aria-label="Plate" />
          {plate && (
            <Chip tone={!listed ? 'warn' : listed.status === 'watch' ? 'crit' : 'ok'}>
              {!listed ? 'Not on the site list' : listed.status === 'watch' ? `On watch: ${listed.label}` : `Allowed: ${listed.label}`}
            </Chip>
          )}
        </div>
        <div className="field">
          <span className="label">{kind === 'visitor' ? 'Photo of the visitor' : 'Photo of the vehicle and plate'}</span>
          {photo ? (
            <div className="row">
              <Chip tone="ok">Photo ready</Chip>
              <button className="btn btn-sm btn-ghost" onClick={() => setPhoto(null)}>
                Retake
              </button>
            </div>
          ) : camera ? (
            <EvidenceCamera site={site} refText={`${site.code} gate`} collect onSend={async (p) => setPhoto(p)} onDone={() => setCamera(false)} />
          ) : (
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setCamera(true)}>
              Take photo
            </button>
          )}
        </div>
        <PinPad staffNo={staffNo} setStaffNo={setStaffNo} pin={pin} setPin={setPin} />
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !photo || !staffNo || pin.length !== 4 || (kind === 'vehicle' && !plate) || (kind === 'visitor' && !fullOk)}
          onClick={async () => {
            const r = await act.run(async () => {
              // The full number and card picture are sealed on this phone; only the in-house server can open them.
              let sealed: SealedBundle | null = null;
              if (kind === 'visitor' && d.inhouseKey) sealed = await sealForInhouse(d.inhouseKey, { id_number: idNumber.trim(), ...(idPhoto ? { id_photo: idPhoto } : {}) });
              const body: GateInInput = {
                staffNo,
                pin,
                kind,
                visitor: kind === 'visitor' ? { name, idKind, idLast4: clean(idNumber).slice(-4), idRead, company, host, purpose, face: face() } : null,
                vehicle: plate ? { plate, plateRead } : null,
                sealed,
                photo: photo!,
              };
              return submit<Awaited<ReturnType<typeof api.gateIn>>>({ kind: 'gateIn', body });
            });
            if (!r) return;
            if (r.sent) setResult({ ref: r.result.entry.ref, flags: r.result.entry.flags, alarm: !!r.result.alarmId, queued: false, watch: false });
            else setResult({ ref: null, flags: [], alarm: false, queued: true, watch: listed?.status === 'watch' });
          }}
        >
          Sign in at the gate
        </button>
        <span className="muted small">Visitors are told at the gate that their details and photo are recorded for site security and may be given to the police (PDPA notice wording pending).</span>
      </div>
    </section>
  );
}

/**
 * Some sites keep only a written in/out book. The guard photographs its pages: the pages are sealed for the in-house
 * server (they carry full names and numbers), and Prima records the day, the number of lines and who sent it.
 */
export function PaperLogForm({ site, onDone }: { site: Site; onDone: () => void }) {
  const duty = useLoad(() => loadDuty(), [site.id]);
  const max = RULES.siteGate.value.paperPagesMax;
  const [coversDate, setCoversDate] = useState(() => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10));
  const [lines, setLines] = useState('');
  const [note, setNote] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [busyPics, setBusyPics] = useState(false);
  const [staffNo, setStaffNo] = useState('');
  const [pin, setPin] = useState('');
  const act = useAction();
  if (duty.error) return <ErrorNotice error={duty.error} />;
  if (!duty.data) return <Loading what="book" />;
  const key = duty.data.inhouseKey;
  const size = pages.reduce((n, p) => n + p.length, 0);
  const tooBig = size > 1_700_000;
  const add = async (files: FileList | null) => {
    if (!files) return;
    setBusyPics(true);
    try {
      const out: string[] = [];
      for (const f of [...files].slice(0, max - pages.length)) out.push(await shrinkImage(f, 1400, 0.6));
      setPages((p) => [...p, ...out].slice(0, max));
    } finally {
      setBusyPics(false);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Upload written book page</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!key ? (
          <div className="notice" data-tone="warn">The in-house records server is not set up yet, so book pages cannot be kept safely. Keep the paper book.</div>
        ) : (
          <>
            <span className="muted small">For sites that give only a written list of people in and out. The pages are locked for the company's in-house server.</span>
            <label className="field">
              <span className="label">Day the pages cover</span>
              <input className="input" type="date" value={coversDate} onChange={(e) => setCoversDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Number of lines written</span>
              <input className="input" inputMode="numeric" value={lines} onChange={(e) => setLines(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="field">
              <span className="label">Note (optional)</span>
              <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client guardhouse book, pages 12 to 13" />
            </label>
            <div className="field">
              <span className="label">
                Pages ({pages.length} of {max})
              </span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {pages.map((p, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={p} alt={`Page ${i + 1}`} style={{ width: 90, height: 120, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--line)' }} />
                    <button className="btn btn-sm btn-ghost" onClick={() => setPages((x) => x.filter((_, j) => j !== i))} aria-label={`Remove page ${i + 1}`}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {pages.length < max && (
                <label className="btn" style={{ alignSelf: 'flex-start' }}>
                  {busyPics ? 'Adding…' : 'Photograph a page'}
                  <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void add(e.target.files)} />
                </label>
              )}
              {api.mode === 'demo' && pages.length === 0 && (
                <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPages([sampleCardImage('Sample book page', 'IN 08:10 / OUT 09:00', 'book page')])}>
                  Test only: add a sample page
                </button>
              )}
              {tooBig && <span className="small" style={{ color: 'var(--crit)' }}>Too many pages for one upload. Send these, then the rest.</span>}
            </div>
            <PinPad staffNo={staffNo} setStaffNo={setStaffNo} pin={pin} setPin={setPin} />
            <ErrorNotice error={act.error} />
            <button
              className="btn btn-primary"
              disabled={act.busy || !pages.length || tooBig || lines === '' || !staffNo || pin.length !== 4}
              onClick={async () => {
                const r = await act.run(
                  async () => {
                    const sealed = await sealForInhouse(key, { paper_pages: pages });
                    return submit({ kind: 'gateIn', body: { staffNo, pin, kind: 'paper_log', paper: { coversDate, lines: Number(lines), note }, sealed, photo: null } });
                  },
                  (x) => (x.sent ? 'Book pages sent' : savedOnDevice),
                );
                if (r) onDone();
              }}
            >
              Sign and send
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function GateOutForm({ id, label, onDone }: { id: string; label: string; onDone: () => void }) {
  const [staffNo, setStaffNo] = useState('');
  const [pin, setPin] = useState('');
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{label} out</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PinPad staffNo={staffNo} setStaffNo={setStaffNo} pin={pin} setPin={setPin} />
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !staffNo || pin.length !== 4}
          onClick={async () => {
            const r = await act.run(
              () => submit({ kind: 'gateOut', id, body: { staffNo, pin, recordedAt: deviceNow() } }),
              (x) => (x.sent ? 'Recorded as left' : savedOnDevice),
            );
            if (r) onDone();
          }}
        >
          Record as left
        </button>
      </div>
    </section>
  );
}

/** The site's duty log for the company and CMS: post log and gate log with photos. Read only. */
export function SiteDutyLogView({ siteId }: { siteId: string }) {
  const { data, error } = useLoad(() => api.siteDutyLog(siteId, 2), [siteId]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="duty log" />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>Gate log, {data.site.code}</h3>
          <span className="muted small">
            Kept {data.rule.value.keepYears} years for police. Full ID, IC picture and book pages are locked for the in-house server; only the last 4 show here.
          </span>
        </div>
        <div className="list">
          {data.gates.length === 0 && <div className="empty">No gate entries.</div>}
          {data.gates.map((g) => (
            <div key={g.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div style={{ fontWeight: 600 }}>
                {g.ref} · {g.paper ? `Written book page for ${g.paper.coversDate}, ${g.paper.lines} lines` : g.visitor ? `${g.visitor.name} (${VISITOR_ID_LABEL[g.visitor.idKind]} …${g.visitor.idLast4})` : 'Vehicle'}
                {g.vehicle ? ` · ${g.vehicle.plate}` : ''}
              </div>
              <div className="muted small">
                {g.paper ? `Sent by ${g.inBy.name}${g.paper.note ? ` · ${g.paper.note}` : ''}` : `In ${hhmm(g.inAt)} by ${g.inBy.name}`}
                {g.paper ? '' : g.outAt ? ` · out ${hhmm(g.outAt)}` : ' · inside now'}
                {g.visitor ? ` · ${g.visitor.company ? `${g.visitor.company}, ` : ''}visiting ${g.visitor.host}: ${g.visitor.purpose}` : ''}
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {g.sealedContents.length > 0 && (
                  <Chip tone={g.inhouse.status === 'delivered' ? 'ok' : 'warn'}>
                    {g.inhouse.status === 'delivered' ? 'Held by in-house server' : 'Locked, waiting for in-house server'}
                  </Chip>
                )}
                {g.visitor && <Chip tone={g.visitor.faceCheck === 'match' ? 'ok' : g.visitor.faceCheck === 'no_match' ? 'crit' : 'warn'}>Face {g.visitor.faceCheck.replace('_', ' ')}</Chip>}
                {g.flags.map((f) => (
                  <Chip key={f} tone={FLAG_TONE(f)}>
                    {GATE_FLAG_LABEL[f]}
                  </Chip>
                ))}
              </div>
              {g.photos.length > 0 && (
                <div style={{ maxWidth: 260 }}>
                  <PhotoCard p={g.photos[0]} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Post log</h3>
        </div>
        <div className="list">
          {data.postLog.length === 0 && <div className="empty">No entries.</div>}
          {data.postLog.map((l) => (
            <div key={l.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="small">{l.text}</div>
              <div className="muted small">
                {l.at.slice(0, 10)} {hhmm(l.at)} · {POST_LOG_LABEL[l.kind]} · {l.name} ({l.staffNo}){l.correctsId ? ' · correction of an earlier line' : ''}
                {l.receivedAt && Date.parse(l.receivedAt) - Date.parse(l.at) > RULES.siteGate.value.sentLaterMin * 60_000 ? ` · written offline, received ${l.receivedAt.slice(0, 10)} ${hhmm(l.receivedAt)}` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Site vehicle list</h3>
          <span className="muted small">Vehicle system link is a test connection</span>
        </div>
        <div className="list">
          {data.vehicles.map((v) => (
            <div key={v.id} className="list-item">
              <div>
                <div className="mono" style={{ fontWeight: 600 }}>
                  {v.plate}
                </div>
                <div className="muted small">
                  {v.label}
                  {v.source === 'vehicle_system_mock' ? ' · from vehicle system (test)' : ''}
                </div>
              </div>
              <Chip tone={v.status === 'watch' ? 'crit' : 'ok'}>{v.status === 'watch' ? 'On watch' : 'Allowed'}</Chip>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
