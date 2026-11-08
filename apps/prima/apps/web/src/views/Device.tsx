import { Select } from '../SearchSelect';
import { useEffect, useState } from 'react';
import { ArrowLeftIcon, CalendarBlankIcon, ScanIcon, SignInIcon, SignOutIcon, SirenIcon, WarningIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, hhmm, useAction, useLoad } from '../ui';
import type { FaceCapture, ProofInput } from '@prima/core';
import { demoPin, jaOwns } from '@prima/core';
import { EvidenceCamera } from './Camera';
import { LeaveForm } from './Leave';
import { ProofPicker } from './Proof';
import { ScanBox } from './ScanBox';
import type { ItemDevicePending } from '../api/types';
import { FLAG_LABEL, SHIFT_STATE } from './shared';
import { Card, Empty } from '../kit';
import '../styles/ops.css';
import { DeviceDispatch, DeviceInbox } from './SiteDispatch';
import { DutyHome, GateInForm, GateOutForm, PaperLogForm, PostLogForm, TaskDoForm } from './DutyDevice';

type Mode = 'home' | 'in' | 'out' | 'scan' | 'report' | 'leave' | 'items';
type FaceTest = 'match' | 'nomatch' | 'photo';

// Web NFC is in Chrome on Android only; the type is not in TypeScript's DOM library yet.
interface NdefReading {
  serialNumber: string;
  message: { records: { recordType: string; data?: DataView; encoding?: string }[] };
}
interface NdefReaderLike {
  scan(opts?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((e: NdefReading) => void) | null;
  onreadingerror: (() => void) | null;
}

function nfcSupported(): boolean {
  return 'NDEFReader' in window;
}

/**
 * Reads the checkpoint code written on the tag as a text record. The test version returns
 * the tag picked on screen instead.
 */
async function readNfcTag(testTag: string): Promise<{ tagCode: string; tagSerial: string | null }> {
  if (api.mode === 'demo') return { tagCode: testTag, tagSerial: `TEST:${testTag}` };
  if (!nfcSupported()) throw new Error('This phone cannot read NFC tags. Use the Android site phone with NFC turned on.');
  const Reader = (window as unknown as { NDEFReader: new () => NdefReaderLike }).NDEFReader;
  const reader = new Reader();
  const stop = new AbortController();
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No tag read in 20 seconds. Try again, holding the phone still on the tag.')), 20_000);
      reader.onreading = (e) => {
        clearTimeout(timer);
        const text = e.message.records.find((r) => r.recordType === 'text' && r.data);
        if (!text) return reject(new Error('This tag has no checkpoint code. Ask your supervisor to check the tag.'));
        resolve({ tagCode: new TextDecoder(text.encoding ?? 'utf-8').decode(text.data), tagSerial: e.serialNumber || null });
      };
      reader.onreadingerror = () => {
        clearTimeout(timer);
        reject(new Error('The tag could not be read. Try again.'));
      };
      reader.scan({ signal: stop.signal }).catch((err: unknown) => {
        clearTimeout(timer);
        reject(
          new Error(
            err instanceof Error && err.name === 'NotAllowedError'
              ? 'Allow NFC for this app, then try again.'
              : 'NFC is off or not available. Turn on NFC in the phone settings.',
          ),
        );
      });
    });
  } finally {
    stop.abort();
  }
}

/**
 * The face engine is not chosen yet (open item), so the test version simulates its answer.
 * Outside the test version no score is sent and the record is flagged for the supervisor.
 */
function captureFace(test: FaceTest): FaceCapture | null {
  if (api.mode !== 'demo') return null;
  if (test === 'nomatch') return { score: 0.42, live: true };
  if (test === 'photo') return { score: 0.91, live: false };
  return { score: 0.94, live: true };
}

function FaceScan({ value, onChange }: { value: FaceTest; onChange: (v: FaceTest) => void }) {
  return (
    <div className="field dv-face">
      <span className="label">Face</span>
      <div className="face-frame" aria-hidden="true">
        <svg viewBox="0 0 120 140">
          <ellipse cx="60" cy="68" rx="38" ry="50" />
          <path d="M8 26V8h18M94 8h18v18M112 114v18H94M26 132H8v-18" />
        </svg>
      </div>
      <span className="muted small">Look at the camera. The picture is checked against your enrolled face.</span>
      {api.mode === 'demo' ? (
        <>
          <span className="label">Test only: what the camera sees</span>
          <div className="seg" role="group" aria-label="Test only: what the camera sees">
            <button aria-pressed={value === 'match'} onClick={() => onChange('match')}>
              The right guard
            </button>
            <button aria-pressed={value === 'nomatch'} onClick={() => onChange('nomatch')}>
              Someone else
            </button>
            <button aria-pressed={value === 'photo'} onClick={() => onChange('photo')}>
              A photo held up
            </button>
          </div>
        </>
      ) : (
        <div className="notice" data-tone="warn">
          The face engine is not connected in this build yet, so every record is marked for the supervisor to confirm.
        </div>
      )}
    </div>
  );
}

/**
 * Shared phone or tablet kept at the guard post (W7). Guards and supervisors clock in and
 * out by face (Fauzan, 24 Oct 2026). Patrols are recorded by tapping the phone on the coded
 * NFC tag at each checkpoint, with the staff number and PIN.
 */
export function Device() {
  const { me } = useApp();
  const siteId = me.user.siteIds[0];
  const site = useLoad(() => api.site(siteId), [siteId]);
  const [mode, setMode] = useState<Mode>('home');
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [duty, setDuty] = useState<{ view: 'gate' | 'log' | 'paper' } | { view: 'out'; id: string; label: string } | { view: 'task'; task: Parameters<typeof TaskDoForm>[0]['task'] } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  const myt = new Date(now.getTime() + 8 * 3_600_000);
  const clock = `${String(myt.getUTCHours()).padStart(2, '0')}:${String(myt.getUTCMinutes()).padStart(2, '0')}`;

  if (site.error)
    return (
      <div className="page">
        <ErrorNotice error={site.error} />
      </div>
    );
  if (!site.data)
    return (
      <div className="page">
        <Loading what="site" />
      </div>
    );
  const s = site.data.site;

  return (
    <div className="page">
      <div className="dv">
        <header className="dv-site">
          <span className="dv-code">{s.code}</span>
          <h1>{s.name}</h1>
          <div className="dv-clock" aria-label={`Time now ${clock}`}>
            {clock}
          </div>
        </header>
        {/* Messages from CMS stay on top of every screen until taken (Fauzan, 6 Nov 2026). */}
        {!dispatchId && <DeviceInbox site={s} onOpen={(m) => setDispatchId(m.id)} />}
        {dispatchId && <DeviceDispatch id={dispatchId} site={s} onDone={() => setDispatchId(null)} />}
        {!dispatchId && duty?.view === 'gate' && <GateInForm site={s} onDone={() => setDuty(null)} />}
        {!dispatchId && duty?.view === 'log' && <PostLogForm site={s} onDone={() => setDuty(null)} />}
        {!dispatchId && duty?.view === 'paper' && <PaperLogForm site={s} onDone={() => setDuty(null)} />}
        {!dispatchId && duty?.view === 'task' && <TaskDoForm site={s} task={duty.task} onDone={() => setDuty(null)} />}
        {!dispatchId && duty?.view === 'out' && <GateOutForm id={duty.id} label={duty.label} onDone={() => setDuty(null)} />}
        {!dispatchId && !duty && mode === 'home' && (
          <>
            {/* One-stop guard duty device (Fauzan, 6 Nov 2026): gate and post log first. */}
            <DutyHome site={s} onGate={() => setDuty({ view: 'gate' })} onLog={() => setDuty({ view: 'log' })} onPaper={() => setDuty({ view: 'paper' })} onTask={(task) => setDuty({ view: 'task', task })} onOut={(id, label) => setDuty({ view: 'out', id, label })} />
            <div className="dv-actions">
              <button className="dv-action" data-primary="true" onClick={() => setMode('in')}>
                <span className="dv-action-icon" aria-hidden="true">
                  <SignInIcon size={26} />
                </span>
                Clock in
              </button>
              <button className="dv-action" onClick={() => setMode('out')}>
                <span className="dv-action-icon" aria-hidden="true">
                  <SignOutIcon size={26} />
                </span>
                Clock out
              </button>
              <button className="dv-action" onClick={() => setMode('scan')}>
                <span className="dv-action-icon" aria-hidden="true">
                  <ScanIcon size={26} />
                </span>
                Patrol checkpoint
              </button>
              {/* Incidents are reported in the JA Group app while it owns them (rule SYS-JA-OWNS). */}
              {!jaOwns('incidents') && (
                <button className="dv-action" onClick={() => setMode('report')}>
                  <span className="dv-action-icon" aria-hidden="true">
                    <WarningIcon size={26} />
                  </span>
                  Report incident
                </button>
              )}
              <button className="dv-action" onClick={() => setMode('leave')}>
                <span className="dv-action-icon" aria-hidden="true">
                  <CalendarBlankIcon size={26} />
                </span>
                Leave or absence reason
              </button>
              <button className="btn" onClick={() => setMode('items')}>
                Confirm items I received
              </button>
            </div>
            <Sos siteId={s.id} companyId={s.companyId} />
            <Card title="Today at this post" sub={api.mode === 'demo' ? 'Patrol PINs shown in the test version only' : undefined} flush>
              {site.data.shifts.length === 0 && <Empty title="No shifts today." />}
              <ul className="op-list">
                {site.data.shifts.map((sh) => (
                  <li key={sh.id} className="op-item">
                    <div className="op-line">
                      <div className="op-main">
                        <span className="op-title">{sh.personName ?? 'Unfilled'}</span>
                        <span className="dv-shift-time">
                          {sh.staffNo ?? ''} · {hhmm(sh.start)}–{hhmm(sh.end)}
                          {api.mode === 'demo' && sh.staffNo ? ` · patrol PIN ${demoPin(sh.staffNo)}` : ''}
                        </span>
                      </div>
                      <Chip tone={SHIFT_STATE[sh.state].tone}>{SHIFT_STATE[sh.state].label}</Chip>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
        {!dispatchId && !duty && mode === 'leave' && <DeviceLeave onDone={() => setMode('home')} />}
        {!dispatchId && !duty && mode === 'items' && <DeviceItems onDone={() => setMode('home')} />}
        {!dispatchId && !duty && mode !== 'home' && mode !== 'leave' && mode !== 'items' && (
          <Flow mode={mode} site={s} checkpoints={site.data.checkpoints.map((c) => c.checkpoint)} onDone={() => setMode('home')} />
        )}
      </div>
    </div>
  );
}

function Sos({ siteId, companyId }: { siteId: string; companyId: string }) {
  const [confirm, setConfirm] = useState(false);
  const act = useAction();
  if (!confirm) {
    return (
      <button className="dv-sos" onClick={() => setConfirm(true)}>
        <SirenIcon size={26} weight="bold" aria-hidden="true" />
        SOS
      </button>
    );
  }
  return (
    <div className="notice dv-sos-confirm" data-tone="crit">
      <p>Send an SOS? A P1 case opens at once on the supervisor's and the company's screens. Phone your supervisor as well.</p>
      <div className="dv-big-btns">
        <button
          className="btn btn-danger"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.raiseCase({
                  companyId,
                  siteId,
                  type: 'SOS',
                  severity: 'P1',
                  title: 'SOS from site device',
                  description: 'SOS pressed on the shared site device.',
                }),
              (c) => `SOS case ${c.ref} opened as P1. Phone your supervisor now.`,
            );
            if (r) setConfirm(false);
          }}
        >
          Send SOS
        </button>
        <button className="btn" onClick={() => setConfirm(false)}>
          Cancel
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Flow({
  mode,
  site,
  checkpoints,
  onDone,
}: {
  mode: Exclude<Mode, 'home' | 'leave' | 'items'>;
  site: {
    id: string;
    code: string;
    companyId: string;
    lat: number;
    lng: number;
    geofenceM: number;
  };
  checkpoints: { id: string; name: string; tagCode: string }[];
  onDone: () => void;
}) {
  const [staffNo, setStaffNo] = useState('');
  const [pin, setPin] = useState('');
  const [faceTest, setFaceTest] = useState<FaceTest>('match');
  const [where, setWhere] = useState<'site' | 'away' | 'gps'>(api.mode === 'demo' ? 'site' : 'gps');
  const [tag, setTag] = useState(checkpoints[0]?.tagCode ?? '');
  const [waitingTag, setWaitingTag] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [reported, setReported] = useState<{ id: string; ref: string; photos: number } | null>(null);
  const [result, setResult] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);
  const act = useAction();

  const press = (k: string) => setPin((p) => (k === '⌫' ? p.slice(0, -1) : p.length < 4 ? p + k : p));

  const locate = (): Promise<{ lat: number | null; lng: number | null }> => {
    if (where === 'site')
      return Promise.resolve({
        lat: site.lat + 0.0002,
        lng: site.lng - 0.0001,
      });
    if (where === 'away') return Promise.resolve({ lat: site.lat + 0.012, lng: site.lng + 0.004 });
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({ lat: null, lng: null }),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });
  };

  const submit = async () => {
    if (mode === 'in') {
      const loc = await locate();
      const r = await act.run(() => api.clockIn({ staffNo, face: captureFace(faceTest), ...loc }));
      if (r) {
        const flags = r.attendance.flags;
        setResult({
          tone: flags.length || r.caseRef || r.identityCaseRef ? 'warn' : 'ok',
          text: `${r.person.name} clocked in at ${hhmm(r.attendance.clockIn)}.${flags.length ? ` Noted: ${flags.map((f) => FLAG_LABEL[f]).join(', ')}.` : ''}${r.identityCaseRef ? ` Your supervisor will confirm it is you (${r.identityCaseRef}).` : ''}${r.caseRef ? ` The supervisor has been asked to check your papers (${r.caseRef}).` : ''}`,
        });
      }
    } else if (mode === 'out') {
      const r = await act.run(() => api.clockOut({ staffNo, face: captureFace(faceTest) }));
      if (r) {
        const flags = r.outFlags;
        setResult({
          tone: flags.length || r.identityCaseRef ? 'warn' : 'ok',
          text: `${r.person.name} clocked out at ${hhmm(r.attendance.clockOut)}.${flags.length ? ` Noted: ${flags.map((f) => FLAG_LABEL[f]).join(', ')}.` : ''}${r.identityCaseRef ? ` Your supervisor will confirm it is you (${r.identityCaseRef}).` : ''}`,
        });
      }
    } else if (mode === 'scan') {
      setWaitingTag(true);
      const r = await act.run(async () => {
        try {
          const read = await readNfcTag(tag);
          return await api.scan({ staffNo, pin, ...read });
        } finally {
          setWaitingTag(false);
        }
      });
      if (r)
        setResult({
          tone: 'ok',
          text: `${r.checkpoint.name} recorded at ${hhmm(r.scan.at)}.`,
        });
    } else {
      const r = await act.run(() =>
        api.raiseCase({
          companyId: site.companyId,
          siteId: site.id,
          type: 'INCIDENT',
          severity: 'P3',
          title,
          description: desc,
          reporter: { staffNo, face: captureFace(faceTest) },
          proof,
        }),
      );
      if (r) setReported({ id: r.id, ref: r.ref, photos: proof.length });
    }
  };

  // The report goes with its proof; afterwards the guard may add more photos of the scene (Fauzan, 25 Oct 2026).
  if (reported) {
    return (
      <Card title={`Photos for ${reported.ref}`}>
        <div className="dv-form">
          <div className="notice" data-tone="ok">
            Report {reported.ref} sent to your supervisor with its proof. Add more photos of the scene if needed. Each photo is stamped with the time and this
            phone's location.
          </div>
          {reported.photos > 0 && (
            <Chip tone="ok">
              {reported.photos} photo{reported.photos === 1 ? '' : 's'} sent
            </Chip>
          )}
          <EvidenceCamera
            site={site}
            refText={reported.ref}
            onSend={async (p) => {
              const r = await api.addCasePhoto(reported.id, { ...p, caption: p.caption || title });
              setReported((x) => (x ? { ...x, photos: x.photos + 1 } : x));
              return r;
            }}
          />
          <button className="btn btn-primary dv-submit" onClick={onDone}>
            Done
          </button>
        </div>
      </Card>
    );
  }

  const titleText = {
    in: 'Clock in',
    out: 'Clock out',
    scan: 'Patrol checkpoint',
    report: 'Report incident',
  }[mode];

  if (result) {
    return (
      <div className="dv-result" role="status">
        <div className="notice" data-tone={result.tone}>
          {result.text}
        </div>
        <button className="btn btn-primary dv-submit" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <Card
      title={titleText}
      actions={
        <button className="btn btn-ghost" onClick={onDone}>
          <ArrowLeftIcon size={16} aria-hidden="true" />
          Back
        </button>
      }
    >
      <div className="dv-form">
        <div className="field">
          <label className="label" htmlFor="dev-staff">
            Staff number
          </label>
          <input
            id="dev-staff"
            className="input mono"
            value={staffNo}
            onChange={(e) => setStaffNo(e.target.value.toUpperCase())}
            placeholder="e.g. SASA0002"
            autoComplete="off"
          />
        </div>
        {(mode === 'in' || mode === 'out' || mode === 'report') && <FaceScan value={faceTest} onChange={setFaceTest} />}
        {mode === 'scan' && (
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
        )}
        {mode === 'in' && (
          <>
            <div className="field">
              <span className="label">Location</span>
              {api.mode === 'demo' ? (
                <div className="seg" role="group" aria-label="Location (test)">
                  <button aria-pressed={where === 'site'} onClick={() => setWhere('site')}>
                    At the site (test)
                  </button>
                  <button aria-pressed={where === 'away'} onClick={() => setWhere('away')}>
                    1 km away (test)
                  </button>
                </div>
              ) : (
                <span className="muted small">Taken from the device GPS when you press Clock in. Allowed within {site.geofenceM} m.</span>
              )}
            </div>
          </>
        )}
        {mode === 'scan' && (
          <div className="field">
            <span className="label">Checkpoint NFC tag</span>
            {api.mode === 'demo' ? (
              <>
                <label className="muted small" htmlFor="dev-tag">
                  Test only: which tag the phone touches
                </label>
                <Select id="dev-tag" className="select" value={tag} onChange={(e) => setTag(e.target.value)}>
                  {checkpoints.map((c) => (
                    <option key={c.id} value={c.tagCode}>
                      {c.name} ({c.tagCode})
                    </option>
                  ))}
                </Select>
              </>
            ) : !nfcSupported() ? (
              <div className="notice" data-tone="crit">
                This phone cannot read NFC tags. Patrols need an Android site phone with NFC turned on.
              </div>
            ) : null}
            {waitingTag ? (
              <div className="notice" data-tone="info" role="status">
                Hold the back of the phone against the checkpoint tag…
              </div>
            ) : (
              <span className="muted small">
                Press the button, then hold the back of the phone against the tag. Only the coded tag at the checkpoint is accepted.
              </span>
            )}
          </div>
        )}
        {mode === 'report' && (
          <>
            <div className="field">
              <label className="label" htmlFor="dev-title">
                What happened
              </label>
              <input id="dev-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gate barrier broken" />
            </div>
            <div className="field">
              <label className="label" htmlFor="dev-desc">
                Details
              </label>
              <textarea id="dev-desc" className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <ProofPicker site={site} refText={`${site.code} report`} items={proof} onChange={setProof} required />
          </>
        )}
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary dv-submit"
          disabled={act.busy || !staffNo || (mode === 'scan' && pin.length !== 4) || (mode === 'report' && (!title.trim() || !proof.length))}
          onClick={submit}
        >
          {mode === 'in' || mode === 'out' ? `Scan face and ${titleText.toLowerCase()}` : mode === 'scan' ? 'Tap NFC tag' : titleText}
        </button>
        {(mode === 'in' || mode === 'out') && (
          <span className="muted small">
            Late, away from site and a face that does not match are recorded for the supervisor to confirm. The app never refuses a guard who is at the post.
          </span>
        )}
      </div>
    </Card>
  );
}

/** A guard asks for leave or gives the reason for an absence on the site device, with staff number and face scan. */
function DeviceLeave({ onDone }: { onDone: () => void }) {
  const [staffNo, setStaffNo] = useState('');
  const [faceTest, setFaceTest] = useState<FaceTest>('match');
  return (
    <Card
      title="Leave or absence reason"
      actions={
        <button className="btn btn-ghost" onClick={onDone}>
          <ArrowLeftIcon size={16} aria-hidden="true" />
          Back
        </button>
      }
    >
      <div className="dv-form">
        <label className="field">
          <span className="label">Staff number</span>
          <input className="input mono" value={staffNo} onChange={(e) => setStaffNo(e.target.value.toUpperCase())} aria-label="Staff number" />
        </label>
        <FaceScan value={faceTest} onChange={setFaceTest} />
        <LeaveForm key={staffNo} staffNo={staffNo || undefined} face={() => captureFace(faceTest)} onDone={onDone} />
      </div>
    </Card>
  );
}

/**
 * Confirm items on the post's shared device (Fauzan, 6 Nov 2026): the guard types their staff number and looks at the
 * camera; only after the face check passes are their waiting items shown, and each one is confirmed by scanning its
 * label or tag. Nobody can confirm an item handed to another guard.
 */
function DeviceItems({ onDone }: { onDone: () => void }) {
  const a = useAction();
  const [staffNo, setStaffNo] = useState('');
  const [faceTest, setFaceTest] = useState<FaceTest>('match');
  const [face, setFace] = useState<FaceCapture | null>(null);
  const [list, setList] = useState<ItemDevicePending | null>(null);
  const check = async () => {
    const f = captureFace(faceTest);
    const r = await a.run(() => api.itemDevicePending(staffNo, f));
    if (r) {
      setFace(f);
      setList(r);
    }
  };
  const confirm = async (label: string) => {
    const r = await a.run(() => api.itemAct(`dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, { kind: 'device.confirm', staffNo, face, label }), 'Confirmed. Thank you.');
    if (r) setList(await api.itemDevicePending(staffNo, face).catch(() => list));
  };
  return (
    <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <div className="panel-head">
        <h3>Confirm items I received</h3>
        <button
          className="btn btn-sm"
          onClick={() => {
            setList(null);
            setFace(null);
            onDone();
          }}
        >
          Done
        </button>
      </div>
      {!list ? (
        <>
          <label className="field">
            <span className="label">Staff number</span>
            <input className="input mono" value={staffNo} onChange={(e) => setStaffNo(e.target.value.toUpperCase())} autoComplete="off" maxLength={30} />
          </label>
          <FaceScan value={faceTest} onChange={setFaceTest} />
          <button className="btn btn-primary" disabled={a.busy || !staffNo.trim()} onClick={check}>
            Check my face
          </button>
        </>
      ) : (
        <>
          <div>
            Hello {list.firstName} ({list.staffNo}). {list.waiting.length ? 'Scan each item you received:' : 'Nothing is waiting for you.'}
          </div>
          <div className="list">
            {list.waiting.map((w) => (
              <div key={w.label} className="list-item">
                <div>
                  <strong>{w.sku}</strong>
                  <div className="muted small mono">{w.label}</div>
                </div>
                <Chip tone="warn">Waiting</Chip>
              </div>
            ))}
          </div>
          {list.waiting.length > 0 && <ScanBox label="Scan the item" button="Confirm" busy={a.busy} onScan={confirm} autoFocus />}
          <span className="muted small">If something is wrong or missing, do not confirm it. Tell your supervisor.</span>
        </>
      )}
      <ErrorNotice error={a.error} />
    </section>
  );
}
