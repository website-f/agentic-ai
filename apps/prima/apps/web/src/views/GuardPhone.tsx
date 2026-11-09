import { useCallback, useEffect, useRef, useState } from 'react';
import { demoPin } from '@prima/core';
import { ApiError, guardPhone } from '../api';
import type { GuardDuty, GuardPhoneMe, GuardPhoneStatus } from '../api/guard-phone';
import { Chip, hhmm } from '../ui';
import { gps } from './Camera';
import { FaceCapture, FaceChallengeCapture } from './FaceCheck';

declare const __DEMO__: boolean;

/**
 * The guard's own phone (third audit item 2, Fauzan 5 Nov 2026): enrol with the office code, register the face, sign
 * in with face plus PIN, then the duty screen with a big SOS button. The phone sends a heartbeat every minute while
 * this screen is open; location goes only on duty. Opened at #guard-phone (the office link).
 */
export function GuardPhoneApp({ onLeave }: { onLeave: () => void }) {
  const [step, setStep] = useState<'enrol' | 'status' | 'duty'>(() => (guardPhone.device() ? (guardPhone.signedIn() ? 'duty' : 'status') : 'enrol'));
  return (
    <div className="signin">
      <div className="signin-card" style={{ maxWidth: 440 }}>
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">Prima Secure App</div>
            <div className="brand-sub">Telefon pengawal · Guard phone</div>
          </div>
        </div>
        {step === 'enrol' && <Enrol onDone={() => setStep('status')} />}
        {step === 'status' && <SignIn onSignedIn={() => setStep('duty')} onForget={() => setStep('enrol')} />}
        {step === 'duty' && <Duty onSignedOut={() => setStep(guardPhone.device() ? 'status' : 'enrol')} />}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onLeave}>
          Office staff sign-in
        </button>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The link from the office carries the guard, the phone and the code: #guard-phone?u=…&p=…&c=… */
function linkParams(): { userId: string; phoneId: string; code: string } {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  return { userId: q.get('u') ?? '', phoneId: q.get('p') ?? '', code: q.get('c') ?? '' };
}

function Enrol({ onDone }: { onDone: () => void }) {
  const [link, setLink] = useState(linkParams);
  const [code, setCode] = useState(link.code);
  const [staffNo, setStaffNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [demoName, setDemoName] = useState<string | null>(null);
  const ready = !!link.userId && !!link.phoneId;
  return (
    <div className="list" style={{ gap: 10 }}>
      <h1>Daftar telefon ini · Enrol this phone</h1>
      {!ready && (
        <p className="muted">
          Open the link the company office gave you, on this phone. It carries your enrolment. Buka pautan daripada pejabat syarikat pada telefon ini.
        </p>
      )}
      {guardPhone.demoCode && !ready && (
        <button
          className="btn btn-sm"
          onClick={() =>
            guardPhone.demoCode!().then(
              (c) => {
                setLink({ userId: c.userId, phoneId: c.phoneId, code: c.code });
                setCode(c.code);
                setStaffNo(c.staffNo);
                setDemoName(c.name);
              },
              (e) => setErr(errText(e)),
            )
          }
        >
          Test version: get a code from the company office
        </button>
      )}
      {demoName && <div className="notice small">Test version: code issued by the company office for {demoName}.</div>}
      {ready && (
        <>
          <label className="label" htmlFor="gp-code">
            Kod · Code
          </label>
          <input id="gp-code" className="input" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} />
          <label className="label" htmlFor="gp-staff">
            No. pekerja anda · Your staff number
          </label>
          <input id="gp-staff" className="input" value={staffNo} onChange={(e) => setStaffNo(e.target.value.toUpperCase())} maxLength={20} />
          <button
            className="btn btn-primary"
            disabled={busy || code.length < 8 || !staffNo}
            onClick={() => {
              setBusy(true);
              setErr(null);
              guardPhone
                .enrol({ ...link, code, staffNo })
                .then(() => {
                  history.replaceState(null, '', '#guard-phone');
                  onDone();
                })
                .catch((e) => setErr(errText(e)))
                .finally(() => setBusy(false));
            }}
          >
            Daftar · Enrol
          </button>
        </>
      )}
      {err && (
        <div className="notice" data-tone="crit">
          {err}
        </div>
      )}
    </div>
  );
}

function SignIn({ onSignedIn, onForget }: { onSignedIn: () => void; onForget: () => void }) {
  const [st, setSt] = useState<GuardPhoneStatus | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    guardPhone.status().then(setSt, (e) => {
      if (e instanceof ApiError && e.status === 403 && !guardPhone.device()) onForget();
      setErr(errText(e));
    });
  }, [onForget]);
  useEffect(load, [load]);

  const done = (p: Promise<unknown>, then: () => void) => {
    setBusy(true);
    setErr(null);
    p.then(then, (e) => setErr(errText(e))).finally(() => setBusy(false));
  };

  return (
    <div className="list" style={{ gap: 10 }}>
      <h1>Log masuk · Sign in</h1>
      {st && (
        <p className="muted">
          {st.name} · {st.staffNo}
        </p>
      )}
      {__DEMO__ && st && <div className="notice small">Test version: this sample guard's PIN is {demoPin(st.staffNo)}. Faces always match.</div>}
      {st?.lockedUntil && (
        <div className="notice" data-tone="crit">
          Too many wrong tries. This phone is locked until {hhmm(st.lockedUntil)}. Use SOS below if you need help now.
        </div>
      )}
      <label className="label" htmlFor="gp-pin">
        PIN
      </label>
      <input
        id="gp-pin"
        className="input"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
      />
      {st && (st.face === 'none' || st.face === 'refused') && (
        <>
          <p className="muted small">
            Daftar muka anda dahulu. HR akan menyemak gambar. Register your face first: take one photo; HR checks it before you can sign in.
          </p>
          <FaceCapture
            label="Daftar muka · Register my face"
            busy={busy || pin.length < 4}
            photoOnly={st.engine === 'server'}
            onCapture={(r) => done(guardPhone.registerFace(pin, r.photo, st.engine === 'server' ? null : r.descriptor), load)}
          />
        </>
      )}
      {st?.face === 'pending' && <div className="notice">Muka anda menunggu kelulusan HR. Your face is waiting for HR to approve it.</div>}
      {st?.face === 'approved' && !st.lockedUntil && (
        <>
          <p className="muted small">PIN dan muka · PIN and face. The PIN alone does not sign you in.</p>
          {st.engine === 'server' ? (
            <FaceChallengeCapture
              label="Imbas muka dan log masuk · Check face and sign in"
              busy={busy || pin.length < 4}
              start={async () => {
                const c = await guardPhone.challenge();
                if (c.engine !== 'server') throw new Error('The face check uses the phone engine here.');
                return c;
              }}
              onFrames={({ token, frames }) => done(guardPhone.signIn({ pin, token, frames }), onSignedIn)}
            />
          ) : (
            <FaceCapture
              label="Imbas muka dan log masuk · Check face and sign in"
              busy={busy || pin.length < 4}
              onCapture={(r) => done(guardPhone.signIn({ pin, descriptor: r.descriptor, live: r.live, photo: r.photo }), onSignedIn)}
            />
          )}
        </>
      )}
      {err && (
        <div className="notice" data-tone="crit">
          {err}
        </div>
      )}
      <SosButton />
    </div>
  );
}

/** One press sends SOS to CMS with the location. It works without the PIN or face: the enrolled phone is enough. */
function SosButton({ onSent }: { onSent?: () => void } = {}) {
  const [arming, setArming] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const send = async () => {
    setErr(null);
    try {
      const fix = await gps();
      const r = await guardPhone.sos(fix);
      onSent?.();
      setSent(r.repeated ? 'SOS sudah dihantar; lokasi dikemas kini. SOS already sent; location updated.' : 'SOS dihantar ke CMS. SOS sent to CMS. Stay safe; CMS will call you.');
    } catch (e) {
      setErr(`${errText(e)} Call CMS or 999 now.`);
    }
  };
  return (
    <div className="list" style={{ gap: 6, marginTop: 12 }}>
      <button
        className="btn btn-danger"
        style={{ fontSize: 22, padding: '18px 12px', fontWeight: 700 }}
        aria-label="SOS: hold to send an emergency alert to CMS"
        onPointerDown={() => {
          setArming(true);
          timer.current = window.setTimeout(() => {
            setArming(false);
            void send();
          }, 1500);
        }}
        onPointerUp={() => {
          setArming(false);
          if (timer.current) clearTimeout(timer.current);
        }}
        onPointerLeave={() => {
          setArming(false);
          if (timer.current) clearTimeout(timer.current);
        }}
        onKeyDown={(e) => e.key === 'Enter' && void send()}
      >
        {arming ? 'Tahan… Hold…' : 'SOS'}
      </button>
      <div className="muted small">Tekan dan tahan 1.5 saat · Press and hold for 1.5 seconds.</div>
      {sent && (
        <div className="notice" data-tone="ok">
          {sent}
        </div>
      )}
      {err && (
        <div className="notice" data-tone="crit">
          {err}
        </div>
      )}
    </div>
  );
}

const LOCATION_TEXT: Record<string, string> = {
  kept: 'Lokasi dihantar · Location sent',
  none: 'Tiada GPS · No GPS fix from the phone',
  off_duty: 'Luar waktu tugas: lokasi tidak dihantar · Off duty: location not sent',
  too_soon: 'Lokasi dihantar · Location sent',
};

function Duty({ onSignedOut }: { onSignedOut: () => void }) {
  const [me, setMe] = useState<GuardPhoneMe | null>(null);
  const [beat, setBeat] = useState<{ at: string; location: string; onDuty: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    guardPhone.me().then(setMe, (e) => {
      if (e instanceof ApiError && e.status === 401) onSignedOut();
      else setErr(errText(e));
    });
  }, [onSignedOut]);
  useEffect(load, [load]);

  // Heartbeat while this screen is open: every rule interval, with the location only when the phone has a fix.
  useEffect(() => {
    if (!me) return;
    let stop = false;
    const tick = async () => {
      const fix = await gps();
      const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
      const battery = nav.getBattery ? Math.round((await nav.getBattery().catch(() => ({ level: NaN }))).level * 100) : null;
      try {
        const r = await guardPhone.heartbeat(fix, Number.isFinite(battery) ? battery : null);
        if (!stop) setBeat({ at: r.session.lastSeenAt, location: r.location, onDuty: r.onDuty });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onSignedOut();
        if (!stop) setErr(errText(e));
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), me.rule.heartbeatSec * 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [me, onSignedOut]);

  if (!me)
    return (
      <div className="list">
        {err ? (
          <div className="notice" data-tone="crit">
            {err}
          </div>
        ) : (
          <div className="muted">Loading…</div>
        )}
        <SosButton />
      </div>
    );
  return (
    <div className="list" style={{ gap: 10 }}>
      <h1>{me.name}</h1>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Chip tone="ok">Log masuk · Signed in {hhmm(me.session.startedAt)}</Chip>
        {beat && <Chip tone={beat.onDuty ? 'info' : 'neutral'}>{beat.onDuty ? 'Bertugas · On duty' : 'Luar tugas · Off duty'}</Chip>}
      </div>
      {me.duty ? (
        <p>
          {me.duty.siteName} · {hhmm(me.duty.start)} to {hhmm(me.duty.end)}
        </p>
      ) : (
        <p className="muted">Tiada syif sekarang · No shift on now.</p>
      )}
      <SosButton onSent={load} />
      {me.sos.length > 0 && (
        <div className="notice" data-tone="warn">
          SOS {hhmm(me.sos[0].at)}: {me.sos[0].status === 'new' ? 'menunggu CMS · waiting for CMS' : `CMS ${me.sos[0].ackBy ?? ''} sedang membantu · is on it`}
        </div>
      )}
      {beat && (
        <div className="muted small">
          {LOCATION_TEXT[beat.location] ?? beat.location} · {hhmm(beat.at)}. Keep this screen open while on duty.
        </div>
      )}
      {err && (
        <div className="notice" data-tone="crit">
          {err}
        </div>
      )}
      <MyDuty />
      <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => guardPhone.signOut().then(onSignedOut)}>
        Log keluar · Sign out
      </button>
    </div>
  );
}

/**
 * P93 (Fitri, 9 Nov 2026: foreign workers "might get their own login just for guard kind of things"): the guard's own
 * duty on the phone, view only: reminders (papers running out, the next shift), the next shifts and the last clock-ins.
 * Clocking in itself stays on the site device. Short lines in Malay and English, for guards whose first language is
 * neither.
 */
const H2 = { fontSize: '1rem', margin: '6px 0 0' } as const;
const UL = { margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: '0.9rem' } as const;

function MyDuty() {
  const [duty, setDuty] = useState<GuardDuty | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    guardPhone.duty().then(setDuty, (e) => setErr(errText(e)));
  }, []);
  if (err) return <div className="muted small">{err}</div>;
  if (!duty) return null;
  const day = (d: string) => new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="list" style={{ gap: 8 }}>
      {duty.reminders.length > 0 && (
        <>
          <h2 style={H2}>Peringatan · Reminders</h2>
          {duty.reminders.map((r, i) => (
            <div key={i} className="notice small" data-tone={r.tone === 'info' ? undefined : r.tone}>
              {r.text}
            </div>
          ))}
        </>
      )}
      <h2 style={H2}>Syif saya · My shifts</h2>
      {duty.roster.length === 0 ? (
        <p className="muted small">Tiada syif dalam 14 hari · No shift in the next 14 days.</p>
      ) : (
        <ul style={UL}>
          {duty.roster.slice(0, 7).map((r) => (
            <li key={r.id}>
              <b>{day(r.date)}</b> {hhmm(r.start)} to {hhmm(r.end)} · {r.siteName}
            </li>
          ))}
        </ul>
      )}
      <h2 style={H2}>Rekod masuk kerja · My clock-ins</h2>
      {duty.clockRecord.length === 0 ? (
        <p className="muted small">Tiada rekod · Nothing yet.</p>
      ) : (
        <ul style={UL}>
          {duty.clockRecord.slice(0, 5).map((c) => (
            <li key={c.shiftId}>
              <b>{day(c.date)}</b> {c.siteName} · {c.clockIn ? `in ${hhmm(c.clockIn)}${c.clockOut ? `, out ${hhmm(c.clockOut)}` : ''}` : 'tiada · none'}
              {c.status === 'late' ? ' · lewat · late' : c.status === 'no_show' ? ' · tidak hadir · not attended' : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Masuk dan keluar kerja di peranti tapak · Clock in and out on the site device.</p>
    </div>
  );
}
