// J6 (P100, Fauzan 11 Nov 2026): each person chooses the alerts they receive. Urgent alerts by email on or off, the
// daily digest on or off, and topics they do not want. Urgent safety alerts (rule ALERT-SAFETY-LOCKED) cannot be
// switched off: they are always sent and always in the bell. Home's to-do list still shows all of a person's work.
import { useEffect, useState } from 'react';
import { LockSimpleIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { Card } from '../kit';
import { ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import { hasText } from './nb-shared';
import '../styles/items.css';
import '../styles/p100-newb.css';

export function AlertPrefsPanel({ onDone }: { onDone?: () => void }) {
  const { data, error } = useLoad(() => api.myAlertPrefs(), []);
  const act = useAction();
  const [urgent, setUrgent] = useState(true);
  const [digest, setDigest] = useState(true);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!data) return;
    setUrgent(data.urgent);
    setDigest(data.digest);
    setMuted(new Set(data.muted));
  }, [data]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your alert choices" />;
  const topics = data.topics.filter((t) => hasText(q, t.tag));
  const flip = (tag: string) => setMuted((s) => (s.has(tag) ? new Set([...s].filter((x) => x !== tag)) : new Set([...s, tag])));
  return (
    <div className="it-stack">
      {!data.ready && <p className="nb-note">Choosing alerts is not installed here yet. Until it is, you get every urgent alert and the daily digest.</p>}
      <Card title="How you are told" flush>
        <label className="nb-toggle">
          <span className="nb-toggle-text">
            <strong>Urgent alerts by email</strong>
            <span>Red items, as soon as they appear. Urgent safety alerts come even when this is off.</span>
          </span>
          <input type="checkbox" checked={urgent} disabled={!data.ready} onChange={(e) => setUrgent(e.target.checked)} />
        </label>
        <label className="nb-toggle" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="nb-toggle-text">
            <strong>Daily digest by email</strong>
            <span>Once a day at 8 am: everything still waiting for you.</span>
          </span>
          <input type="checkbox" checked={digest} disabled={!data.ready} onChange={(e) => setDigest(e.target.checked)} />
        </label>
      </Card>
      <Card title="Topics" sub="Untick a topic you do not want in email or the bell. Your Home to-do list still shows all your work." flush>
        <div className="it-pad">
          <input className="input" type="search" placeholder="Search topics" aria-label="Search topics" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="it-rows it-rows-tight">
          {topics.map((t) => (
            <li key={t.tag}>
              <label className="nb-toggle">
                <span className="nb-toggle-text">
                  <strong>{t.tag}</strong>
                  {t.safety && (
                    <span className="nb-lock">
                      <LockSimpleIcon size={12} aria-hidden="true" /> Urgent safety alert: cannot be switched off
                    </span>
                  )}
                </span>
                <input type="checkbox" checked={t.safety || !muted.has(t.tag)} disabled={t.safety || !data.ready} onChange={() => flip(t.tag)} aria-label={t.tag} />
              </label>
            </li>
          ))}
        </ul>
      </Card>
      <p className="muted small">
        {data.updatedAt ? `Last saved ${dateTimeLabel(data.updatedAt)}.` : 'Not saved yet: you get every urgent alert and the daily digest.'} Email and Teams alerts go out only once IT switches them on.
      </p>
      <div className="nb-actions">
        {onDone && (
          <button className="btn" type="button" onClick={onDone}>
            Close
          </button>
        )}
        <button
          className="btn btn-primary"
          type="button"
          disabled={act.busy || !data.ready}
          onClick={async () => {
            const r = await act.run(() => api.setMyAlertPrefs({ urgent, digest, muted: [...muted].filter((t) => !data.safety.includes(t)) }), 'Your alert choices are saved.');
            if (r && onDone) onDone();
          }}
        >
          Save my choices
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}
