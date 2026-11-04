import { useState } from 'react';
import { api, type MyItems } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, useLoad } from '../ui';

type Row = MyItems['items'][number];

/**
 * Items the store issued to this person (Fauzan, 27 Oct 2026). They confirm they received each one, or say what is
 * wrong. Procurement sees anything not confirmed or disputed. Never charged to them.
 */
export function MyItemsPanel() {
  const { data, error } = useLoad(() => api.myItems(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data || !data.items.length) return null;
  const open = data.items.filter((i) => !i.issue.acknowledged).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Items issued to me</h3>
        {open > 0 && <Chip tone="warn">{open} to confirm</Chip>}
      </div>
      <p className="muted small">Check each item and confirm you received it. Company items go back to the store when you leave. Nothing is charged to you.</p>
      <div className="list">
        {data.items.map((r) => (
          <ItemLine key={r.issue.id} r={r} />
        ))}
      </div>
    </section>
  );
}

function ItemLine({ r }: { r: Row }) {
  const act = useAction();
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState('');
  const i = r.issue;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {i.qty} x {r.itemName}
          </div>
          <div className="muted small">
            Issued {dateLabel(i.issuedAt.slice(0, 10))} by {i.issuedBy}
            {i.serial ? ` · serial ${i.serial}` : ''}
            {i.returned ? ` · returned ${dateLabel(i.returned.at.slice(0, 10))}` : ''}
            {i.confirmedAt ? ` · you confirmed ${dateLabel(i.confirmedAt.slice(0, 10))}` : ''}
          </div>
          {i.disputed && <div className="small">You said: {i.disputed.note}. The store will contact you.</div>}
        </div>
        {i.acknowledged ? <Chip tone="ok">Received</Chip> : i.disputed ? <Chip tone="crit">Reported</Chip> : <Chip tone="warn">Please confirm</Chip>}
      </div>
      {!i.acknowledged && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.confirmMyItem(i.id, true, ''), 'Thank you, confirmed.')}
          >
            I received it
          </button>
          {!i.disputed && (
            <button className="btn btn-sm" onClick={() => setWrong(!wrong)}>
              Something is wrong
            </button>
          )}
        </div>
      )}
      {wrong && !i.acknowledged && !i.disputed && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            aria-label="What is wrong"
            placeholder="Not received, wrong size, damaged…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !note.trim()}
            onClick={() => act.run(() => api.confirmMyItem(i.id, false, note), 'Sent to the store.')}
          >
            Send to the store
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
