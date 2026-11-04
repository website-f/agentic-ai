import { useState } from 'react';
import { api, type Memos } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Memos (Fauzan, 26 Oct 2026). Only the Chief of Staff publishes memos to all staff, and only the COO publishes
 * memos to all guards and officers. Readers acknowledge each memo, and the publisher sees who has read it.
 */

type Memo = Memos['memos'][number];

const AUDIENCE_LABEL: Record<Memo['audience'], string> = { STAFF: 'All staff', FIELD: 'All guards and officers' };
type Regions = Memos['states'];

const whereLabel = (m: Memo) => (m.states?.length ? `in ${m.states.join(', ')}` : 'everywhere');

export function MemosView() {
  const { data, error } = useLoad(() => api.memos(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="memos" />;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Memos</h1>
        <p className="muted">
          The Chief of Staff publishes memos to all staff. The COO publishes memos to all guards and officers. A memo can be limited to some states, such as
          Penang. Open a memo and tap "I have read this".
        </p>
      </div>
      {data.unread > 0 && (
        <div className="notice" data-tone="warn" role="status" style={{ marginBottom: 12 }}>
          {data.unread} memo{data.unread === 1 ? '' : 's'} not read yet.
        </div>
      )}
      {data.canPublish && <Publish audience={data.canPublish} regions={data.states} />}
      <section className="panel">
        <div className="panel-head">
          <h3>Memos</h3>
        </div>
        <div className="list">
          {data.memos.length === 0 && <div className="empty">No memos yet.</div>}
          {data.memos.map((m) => (
            <MemoLine key={m.id} m={m} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Publish({ audience, regions }: { audience: Memo['audience']; regions: Regions }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const toggle = (list: string[], on: boolean) => setStates(on ? [...new Set([...states, ...list])] : states.filter((s) => !list.includes(s)));
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>New memo to {AUDIENCE_LABEL[audience].toLowerCase()}</h3>
      </div>
      <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input className="input" aria-label="Title" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="textarea" aria-label="Memo" placeholder="Memo" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>
            Who sees it: {states.length ? states.join(', ') : 'everywhere'} (tick states to limit it)
          </legend>
          {regions.map((r) => (
            <div key={r.region} className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
              <label style={{ fontWeight: 600 }}>
                <input type="checkbox" checked={r.states.every((s) => states.includes(s))} onChange={(e) => toggle(r.states, e.target.checked)} /> {r.region}
              </label>
              {r.states.map((st) => (
                <label key={st}>
                  <input type="checkbox" checked={states.includes(st)} onChange={(e) => toggle([st], e.target.checked)} /> {st}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || title.trim().length < 3 || body.trim().length < 3}
            onClick={() =>
              act
                .run(() => api.publishMemo(audience, title, body, states), 'Memo published.')
                .then((r) => {
                  if (r) {
                    setTitle('');
                    setBody('');
                    setStates([]);
                  }
                })
            }
          >
            Publish
          </button>
        </div>
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}

function MemoLine({ m }: { m: Memo }) {
  const [open, setOpen] = useState(false);
  const act = useAction();
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <button
        className="row"
        style={{
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
          background: 'none',
          border: 0,
          padding: 0,
          textAlign: 'left',
          color: 'inherit',
          cursor: 'pointer',
        }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{m.title}</div>
          <div className="muted small">
            {AUDIENCE_LABEL[m.audience]} {whereLabel(m)} · {m.publishedBy} · {dateTimeLabel(m.publishedAt)}
          </div>
        </div>
        {m.forMe ? m.myRead ? <Chip tone="ok">Read</Chip> : <Chip tone="warn">Not read</Chip> : <Chip tone="info">{m.readCount} read</Chip>}
      </button>
      {open && (
        <>
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
          {m.forMe && !m.myRead && (
            <div>
              <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.readMemo(m.id), 'Marked read.')}>
                I have read this
              </button>
              <ErrorNotice error={act.error} />
            </div>
          )}
          {m.reads.length > 0 && <div className="muted small">Read by {m.reads.map((r) => r.name).join(', ')}.</div>}
        </>
      )}
    </div>
  );
}
