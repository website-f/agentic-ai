import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackClose } from './back-close';
import type { AlertItem } from '@prima/core';
import { api } from './api';
import type { MyAlerts } from './api/types';
import { Chip, Drawer } from './ui';
import { AlertPrefsPanel } from './views/AlertPrefs';

/**
 * The in-app alert bell (Fauzan, 5 Nov 2026): the same alerts that go to Teams and email also show inside Prima.
 * The badge counts red items not opened yet in this browser; the list shows everything still waiting, red first.
 * Reading only: each line opens the screen where the work is done.
 */
const SEEN = (userId: string) => `prima.alerts.seen.${userId}`;
const REFRESH_MS = 120_000;
const TONE = { crit: 'crit', warn: 'warn', info: 'info', neutral: 'neutral', ok: 'ok' } as const;
const TONE_LABEL = { crit: 'Urgent', warn: 'Needs action', info: 'For your information', neutral: 'For your information', ok: 'Done' } as const;

function readSeen(userId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN(userId)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(userId: string, keys: string[]) {
  try {
    localStorage.setItem(SEEN(userId), JSON.stringify(keys.slice(-500)));
  } catch {
    /* private window: the badge simply counts again next visit */
  }
}

export function AlertBell({ userId, canOpen, onOpen }: { userId: string; canOpen: (view: string) => boolean; onOpen: (view: string) => void }) {
  const [data, setData] = useState<MyAlerts | null>(null);
  const [open, setOpen] = useState(false);
  // J6: each person chooses which alerts they receive (urgent safety alerts cannot be switched off).
  const [prefs, setPrefs] = useState(false);
  // P96: the phone's Back closes the alerts panel.
  useBackClose(open, () => setOpen(false));
  const [seen, setSeen] = useState<Set<string>>(() => readSeen(userId));
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    // A hidden tab does not ask again; it catches up when the person comes back.
    if (typeof document !== 'undefined' && document.hidden) return;
    api
      .myAlerts()
      .then(setData)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', load);
    };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const items = data?.items ?? [];
  const fresh = items.filter((i) => i.tone === 'crit' && !seen.has(i.key)).length;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const keys = [...new Set([...seen, ...items.filter((i) => i.tone === 'crit').map((i) => i.key)])];
      saveSeen(userId, keys);
      setSeen(new Set(keys));
    }
  };
  const go = (i: AlertItem) => {
    setOpen(false);
    onOpen(i.view);
  };
  return (
    <div className="alert-bell" ref={box}>
      <button
        className="btn btn-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={fresh ? `Alerts: ${fresh} new urgent` : 'Alerts'}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {fresh > 0 && <span className="alert-badge">{fresh}</span>}
      </button>
      {open && (
        <div className="alert-panel panel" role="dialog" aria-label="Alerts">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Alerts</strong>
            <span className="muted small">{items.length} waiting</span>
          </div>
          {!items.length && <p className="muted">Nothing is waiting for you.</p>}
          <ul className="alert-list">
            {items.slice(0, 30).map((i) => (
              <li key={i.key}>
                <button className="alert-line" onClick={() => go(i)} disabled={!canOpen(i.view)}>
                  <Chip tone={TONE[i.tone]}>{TONE_LABEL[i.tone]}</Chip>
                  <span>
                    <strong>{i.tag}</strong>: {i.title}
                    {i.detail && <span className="muted small"> · {i.detail}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {items.length > 30 && <p className="muted small">And {items.length - 30} more on your home screen.</p>}
          <p className="muted small">
            {data?.email || data?.teamsChannel ? 'These alerts are also sent to your email and Teams.' : 'Email and Teams alerts are not switched on yet.'}
          </p>
          <button className="btn btn-sm" type="button" onClick={() => (setOpen(false), setPrefs(true))}>
            Choose my alerts
          </button>
        </div>
      )}
      {/* Outside the header (its stacking would clip the drawer on a phone). */}
      {prefs &&
        createPortal(
        <Drawer title="My alerts" sub="Choose what you are told about. Urgent safety alerts always come." onClose={() => (setPrefs(false), load())}>
          <AlertPrefsPanel onDone={() => (setPrefs(false), load())} />
        </Drawer>,
          document.body,
        )}
    </div>
  );
}
