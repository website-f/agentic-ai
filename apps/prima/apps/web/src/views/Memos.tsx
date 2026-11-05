import { useState } from 'react';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { api, type Memos } from '../api';
import { Card, PageHead, Search } from '../kit';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/selfservice.css';

/**
 * Memos (Fauzan, 26 Oct 2026). Only the Chief of Staff publishes memos to all staff, and only the COO publishes
 * memos to all guards and officers. Readers acknowledge each memo, and the publisher sees who has read it.
 */

type Memo = Memos['memos'][number];

const AUDIENCE_LABEL: Record<Memo['audience'], string> = { STAFF: 'All staff', FIELD: 'All guards and officers' };
type Regions = Memos['states'];

const whereLabel = (m: Memo) => (m.states?.length ? `in ${m.states.join(', ')}` : 'everywhere');

const PAGE_SUB =
  'The Chief of Staff publishes memos to all staff. The COO publishes memos to all guards and officers. A memo can be limited to some states, such as Penang. Open a memo and tap "I have read this".';

export function MemosView() {
  const { data, error } = useLoad(() => api.memos(), []);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [q, setQ] = useState('');
  if (error)
    return (
      <div className="page ss">
        <PageHead title="Memos" sub={PAGE_SUB} />
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page ss">
        <PageHead title="Memos" sub={PAGE_SUB} />
        <Loading what="memos" />
      </div>
    );
  const needle = q.trim().toLowerCase();
  const shown = data.memos
    .filter((m) => filter === 'all' || (m.forMe && !m.myRead))
    .filter((m) => !needle || [m.title, m.body, m.publishedBy].some((x) => x.toLowerCase().includes(needle)));
  return (
    <div className="page ss">
      <PageHead title="Memos" sub={PAGE_SUB} />
      {data.unread > 0 && (
        <div className="notice" data-tone="warn" role="status">
          {data.unread} memo{data.unread === 1 ? '' : 's'} not read yet.
        </div>
      )}
      <div className={data.canPublish ? 'ss-cols' : undefined}>
        <Card title="Memos" flush>
          <div className="ss-tools">
            <div className="seg" role="group" aria-label="Which memos">
              <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All
                <span className="ss-count">{data.memos.length}</span>
              </button>
              <button aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
                Not read
                <span className="ss-count">{data.unread}</span>
              </button>
            </div>
            <Search value={q} onChange={setQ} placeholder="Search memos" />
          </div>
          <ul className="ss-rows">
            {data.memos.length === 0 && <li className="empty">No memos yet.</li>}
            {data.memos.length > 0 && shown.length === 0 && <li className="empty">Nothing here.</li>}
            {shown.map((m) => (
              <li key={m.id}>
                <MemoLine m={m} />
              </li>
            ))}
          </ul>
        </Card>
        {data.canPublish && <Publish audience={data.canPublish} regions={data.states} />}
      </div>
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
    <Card
      title={`New memo to ${AUDIENCE_LABEL[audience].toLowerCase()}`}
      footer={
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
      }
    >
      <div className="ss-form">
        <label className="field">
          <span className="label">Title</span>
          <input className="input" aria-label="Title" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Memo</span>
          <textarea className="textarea" aria-label="Memo" placeholder="Memo" rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <fieldset className="ss-regions">
          <legend>Who sees it: {states.length ? states.join(', ') : 'everywhere'} (tick states to limit it)</legend>
          {regions.map((r) => (
            <div key={r.region} className="ss-region">
              <label className="ss-region-name">
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
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}

function MemoLine({ m }: { m: Memo }) {
  const [open, setOpen] = useState(false);
  const act = useAction();
  const unread = m.forMe && !m.myRead;
  return (
    <div className="ss-memo" data-unread={unread ? '' : undefined}>
      <button className="ss-row" data-tone={unread ? 'warn' : undefined} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ss-row-main">
          <span className="ss-row-title">{m.title}</span>
          <span className="ss-meta">
            {AUDIENCE_LABEL[m.audience]} {whereLabel(m)} · {m.publishedBy} · {dateTimeLabel(m.publishedAt)}
          </span>
        </span>
        <span className="ss-actions">
          {m.forMe ? m.myRead ? <Chip tone="ok">Read</Chip> : <Chip tone="warn">Not read</Chip> : <Chip tone="info">{m.readCount} read</Chip>}
          {open ? <CaretUpIcon size={16} className="ss-chev" aria-hidden="true" /> : <CaretDownIcon size={16} className="ss-chev" aria-hidden="true" />}
        </span>
      </button>
      {open && (
        <div className="ss-memo-body">
          <div className="ss-memo-text">{m.body}</div>
          {m.forMe && !m.myRead && (
            <div className="ss-actions">
              <button className="btn btn-primary" disabled={act.busy} onClick={() => act.run(() => api.readMemo(m.id), 'Marked read.')}>
                I have read this
              </button>
            </div>
          )}
          <ErrorNotice error={act.error} />
          {m.reads.length > 0 && <div className="ss-note">Read by {m.reads.map((r) => r.name).join(', ')}.</div>}
        </div>
      )}
    </div>
  );
}
