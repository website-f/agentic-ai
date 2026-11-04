import { api } from '../api';
import { ErrorNotice, dateTimeLabel, useAction } from '../ui';

/** One COO accept or return made in the reader's place (Fauzan, 31 Oct 2026). */
export interface CooNoticeRow {
  noticeId: string;
  kind: 'work' | 'fwm';
  recId: string;
  title: string;
  by: string;
  what: 'accept' | 'return';
  note: string;
  at: string;
}

/**
 * The COO's accepts and returns of work the reader was in charge of checking. Seen marks only that one notice, so a
 * newer notice that arrived after the screen loaded stays until it is seen too.
 */
export function CooNoticesPanel({ notices }: { notices: CooNoticeRow[] | undefined }) {
  const act = useAction();
  if (!notices?.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>The COO or CEO decided these in your place</h3>
      </div>
      <div className="list">
        {notices.map((n) => (
          <div key={n.noticeId} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{n.title}</div>
              <div className="muted small">
                {n.by} {n.what === 'accept' ? 'accepted it' : 'sent it back'} · {dateTimeLabel(n.at)}
                {n.note ? ` · Reason: ${n.note}` : ''}
              </div>
            </div>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.seenCooNotice(n.kind, n.recId, n.noticeId), 'Noted.')}>
              Seen
            </button>
          </div>
        ))}
      </div>
      <ErrorNotice error={act.error} />
    </section>
  );
}
