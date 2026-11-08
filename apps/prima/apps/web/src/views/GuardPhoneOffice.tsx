import { useEffect, useState } from 'react';
import { api, type GuardPhoneCode } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, hhmm, useAction, useLoad, type Tone } from '../ui';

const STATE: Record<'live' | 'late' | 'offline', { label: string; tone: Tone }> = {
  live: { label: 'Live', tone: 'ok' },
  late: { label: 'Late heartbeat', tone: 'warn' },
  offline: { label: 'Offline', tone: 'crit' },
};

function switchedOff(e: unknown): boolean {
  return typeof e === 'string' ? /switched off/.test(e) : !!e && /switched off/.test((e as { message?: string }).message ?? '');
}

/**
 * On a guard's record, for the company office and HR (the people who set PINs): enrol the guard's own phone with a
 * one-time code, see whether it is signed in, and retire it (lost, changed, or the guard left).
 */
export function GuardPhoneCard({ personId, companyId }: { personId: string; companyId: string }) {
  const act = useAction();
  const { data, error, reload } = useLoad(() => api.guardPhones(companyId), [companyId]);
  const [code, setCode] = useState<GuardPhoneCode | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  if (error && switchedOff(error)) return null;
  const mine = data?.filter((x) => x.personId === personId) ?? [];
  const active = mine.find((x) => x.status === 'active') ?? null;
  const link = code ? `${location.origin}${location.pathname}#guard-phone?u=${encodeURIComponent(code.userId)}&p=${encodeURIComponent(code.phoneId)}&c=${encodeURIComponent(code.code)}` : '';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div>Own phone sign-in (face plus PIN)</div>
          <div className="muted small">The guard opens a one-time link on their own phone. Only one phone at a time; SOS works from it at any time.</div>
        </div>
        {active ? (
          <Chip tone={active.signedIn ? 'ok' : 'neutral'}>{active.signedIn ? `Signed in${active.state ? `, ${STATE[active.state].label.toLowerCase()}` : ''}` : `Enrolled ${dateLabel(active.enrolledAt)}`}</Chip>
        ) : (
          <Chip tone="neutral">No phone</Chip>
        )}
      </div>
      <ErrorNotice error={act.error ?? (error && !switchedOff(error) ? error : null)} />
      {code && (
        <div className="notice">
          <div>
            Code for {code.name}: <strong data-no-translate>{code.code}</strong>, valid until {hhmm(code.expiresAt)} {dateLabel(code.expiresAt)}. Shown once.
          </div>
          <div className="small" style={{ wordBreak: 'break-all', marginTop: 4 }} data-no-translate>
            {link}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(link)}>
              Copy link
            </button>
            <span className="muted small">Send it to the guard's own phone only (WhatsApp to their number, or show it to scan in person).</span>
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        {active && retiring !== active.phoneId && (
          <button className="btn btn-sm" onClick={() => setRetiring(active.phoneId)}>
            Retire phone
          </button>
        )}
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={() =>
            act.run(() => api.guardPhoneCode(personId), active ? 'New code made. Enrolling the new phone retires the old one.' : 'Code made.').then((c) => {
              if (c) setCode(c);
              reload();
            })
          }
        >
          {active ? 'Code for a new phone' : 'Enrol phone'}
        </button>
      </div>
      {active && retiring === active.phoneId && (
        <div className="row" style={{ gap: 8 }}>
          <input className="input" aria-label="Reason" placeholder="Reason, e.g. phone lost, changed phone, left" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || reason.trim().length < 3}
            onClick={() =>
              act.run(() => api.revokeGuardPhone(active.phoneId, reason), 'Phone retired. Its sign-in ended now.').then((r) => {
                if (r) {
                  setRetiring(null);
                  setReason('');
                  reload();
                }
              })
            }
          >
            Retire
          </button>
        </div>
      )}
      {!data && !error && <Loading what="phones" />}
    </div>
  );
}

/**
 * CMS: guards signed in on their own phones, live, late or offline from the heartbeat, with the last on-duty location,
 * and SOS from phones still open. Acting on an SOS stays on the Emergencies tab, as for every alarm.
 */
export function GuardPhonesBoard() {
  const { data, error, reload } = useLoad(() => api.cmsGuardPhones(), []);
  useEffect(() => {
    const t = window.setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);
  if (error && switchedOff(error))
    return (
      <section className="panel">
        <div className="notice">Guards' own phone sign-in is switched off on this server. Guards stay on the JA app and the site device.</div>
      </section>
    );
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="guard phones" />;
  const c = data.counts;
  return (
    <>
      <div className="kpis">
        <Kpi label="Signed in" value={c.signedIn} note={`${c.onDuty} on duty`} />
        <Kpi label="Live" value={c.live} tone="ok" />
        <Kpi label="Late or offline" value={c.late + c.offline} tone={c.offline ? 'crit' : c.late ? 'warn' : 'ok'} note={`offline after ${data.rule.offlineAfterMin} min`} />
        <Kpi label="SOS open" value={c.sos} tone={c.sos ? 'crit' : 'ok'} />
      </div>
      {data.sos.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>SOS from phones</h2>
            <span className="muted small">Acknowledge and close them on the Emergencies tab.</span>
          </div>
          <div className="list">
            {data.sos.map((a) => (
              <div key={a.id} className="list-item">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div>
                    {a.source} · {a.companyName}
                  </div>
                  <div className="muted small">
                    {hhmm(a.at)} · {a.location ? `${a.location.lat.toFixed(5)}, ${a.location.lng.toFixed(5)}${a.location.accuracyM ? ` (±${a.location.accuracyM} m)` : ''}` : 'no location from the phone'}
                    {a.siteUnknown ? ' · site not known from the roster' : ''}
                  </div>
                </div>
                <Chip tone={a.status === 'new' ? 'crit' : 'warn'}>{a.status === 'new' ? 'New' : 'Acknowledged'}</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Guards on their own phones</h2>
          <span className="muted small">
            Heartbeat every {data.rule.heartbeatSec} s; offline after {data.rule.offlineAfterMin} min (rule {data.rule.id}). Location shows only on duty.
          </span>
        </div>
        <div className="list">
          {data.phones.length === 0 && <div className="empty">No guard is signed in on a phone.</div>}
          {data.phones.map((p) => (
            <div key={p.sessionId} className="list-item">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div>
                  {p.name} <span className="muted small">{p.staffNo}</span>
                </div>
                <div className="muted small">
                  {p.companyName}
                  {p.siteName ? ` · ${p.siteName}` : ' · off duty'} · last heartbeat {hhmm(p.lastSeenAt)}
                  {p.battery != null ? ` · battery ${p.battery}%` : ''}
                  {p.location ? ` · ${p.location.lat.toFixed(5)}, ${p.location.lng.toFixed(5)}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {p.sos && <Chip tone="crit">SOS</Chip>}
                <Chip tone={STATE[p.state].tone}>{STATE[p.state].label}</Chip>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
