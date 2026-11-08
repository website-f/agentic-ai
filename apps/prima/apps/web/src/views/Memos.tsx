import { useState } from 'react';
import { CaretDownIcon, CaretUpIcon, PlusIcon } from '@phosphor-icons/react';
import { api, type Memos } from '../api';
import { Card, PageHead, Search } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/selfservice.css';

/**
 * Memos (Fauzan, 26 Oct 2026; real use 5 Nov 2026). Only the Chief of Staff publishes memos to all staff, and only the
 * COO publishes memos to all guards and officers. Each memo has a reference number and a read-by date; readers
 * acknowledge it, and the publisher sees who has not read it, reminds them, or withdraws or replaces the memo with a reason.
 */

type Memo = Memos['memos'][number];

const AUDIENCE_LABEL: Record<Memo['audience'], string> = {
  STAFF: 'All staff',
  FIELD: 'All guards and officers',
  TEAM: 'My team',
};
type Regions = Memos['states'];

const whereLabel = (m: Pick<Memo, 'states' | 'audience'>) => (m.audience === 'TEAM' ? '' : m.states?.length ? `in ${m.states.join(', ')}` : 'everywhere');
const audienceLabel = (m: Pick<Memo, 'audience' | 'publishedBy'>) => (m.audience === 'TEAM' ? `Team of ${m.publishedBy}` : AUDIENCE_LABEL[m.audience]);

const PAGE_SUB =
  'The Chief of Staff publishes memos to all staff. The COO publishes memos to all guards and officers. A memo can be limited to some states, such as Penang. Managers can send a memo to their own team. Open a memo and tap "I have read this" by its read-by date.';

export function MemosView() {
  const { data, error } = useLoad(() => api.memos(), []);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [q, setQ] = useState('');
  const [writing, setWriting] = useState(false);
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
    .filter((m) => filter === 'all' || (m.forMe && !m.myRead && m.status === 'active'))
    .filter((m) => !needle || [m.title, m.body, m.publishedBy, m.ref ?? ''].some((x) => x.toLowerCase().includes(needle)));
  return (
    <div className="page ss">
      <PageHead
        title="Memos"
        sub={PAGE_SUB}
        actions={
          data.canPublish.length > 0 ? (
            <button className="btn btn-primary" onClick={() => setWriting(true)}>
              <PlusIcon size={16} /> New memo
            </button>
          ) : undefined
        }
      />
      {data.unread > 0 && (
        <div className="notice" data-tone="warn" role="status">
          {`${data.unread} memo${data.unread === 1 ? '' : 's'} not read yet${data.overdue ? `, ${data.overdue} past the read-by date` : ''}.`}
        </div>
      )}
      <div>
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
            {data.memos.length === 0 && (
              <li className="empty">
                No memos yet.{' '}
                {data.canPublish.length > 0 && (
                  <button className="btn btn-sm" onClick={() => setWriting(true)}>
                    Write the first memo
                  </button>
                )}
              </li>
            )}
            {data.memos.length > 0 && shown.length === 0 && <li className="empty">Nothing here.</li>}
            {shown.map((m) => (
              <li key={m.id}>
                <MemoLine m={m} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {writing && (
        <Drawer title="New memo" sub="Readers acknowledge it by the read-by date, and you see who has not read it." onClose={() => setWriting(false)}>
          <Publish
            audiences={data.canPublish}
            teamSize={data.teamSize}
            regions={data.states}
            days={data.readWithinDays}
            replaceable={data.replaceable}
            onDone={() => setWriting(false)}
          />
        </Drawer>
      )}
    </div>
  );
}

function plusDays(days: number): string {
  return new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

function Publish({
  audiences,
  teamSize,
  regions,
  days,
  replaceable,
  onDone,
}: {
  audiences: Memo['audience'][];
  teamSize: number;
  regions: Regions;
  days: number;
  replaceable: Memos['replaceable'];
  onDone: () => void;
}) {
  const [audience, setAudience] = useState<Memo['audience']>(audiences[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [readBy, setReadBy] = useState(plusDays(days));
  const [replaces, setReplaces] = useState('');
  const [reach, setReach] = useState<number | null>(null);
  const toggle = (list: string[], on: boolean) => {
    setReach(null);
    setStates(on ? [...new Set([...states, ...list])] : states.filter((s) => !list.includes(s)));
  };
  const act = useAction();
  return (
    <div className="ss-form">
      <label className="field">
        <span className="label">Send to</span>
        <select
          className="select"
          aria-label="Memo to"
          value={audience}
          onChange={(e) => {
            setAudience(e.target.value as Memo['audience']);
            setReplaces('');
            setStates([]);
            setReach(null);
          }}
        >
          {audiences.map((a) => (
            <option key={a} value={a}>
              {a === 'TEAM' ? `My team (${teamSize} people who report to me)` : AUDIENCE_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Title</span>
        <input className="input" aria-label="Title" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Memo</span>
        <textarea className="textarea" aria-label="Memo" placeholder="Memo" rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Read by</span>
        <input className="input" type="date" aria-label="Read by" value={readBy} onChange={(e) => setReadBy(e.target.value)} />
      </label>
      {replaceable.some((r) => r.audience === audience) && (
        <label className="field">
          <span className="label">Replaces an earlier memo (optional)</span>
          <select className="select" aria-label="Replaces" value={replaces} onChange={(e) => setReplaces(e.target.value)}>
            <option value="">No, this is a new memo</option>
            {replaceable
              .filter((r) => r.audience === audience)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ref}: {r.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {audience !== 'TEAM' && (
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
      )}
      <ErrorNotice error={act.error} />
      {reach === null ? (
        <div className="ss-actions">
          <button
            className="btn btn-primary"
            disabled={act.busy || title.trim().length < 3 || body.trim().length < 3 || !readBy}
            onClick={() => act.run(() => api.memoReach(audience, states)).then((r) => r && setReach(r.count))}
          >
            Check and publish
          </button>
          {title.trim().length > 0 && title.trim().length < 3 && <span className="muted small">The title needs at least 3 characters.</span>}
        </div>
      ) : (
        <div className="notice" data-tone="info">
          <div>
            {`This memo goes to ${reach} ${audience === 'STAFF' ? 'staff' : audience === 'FIELD' ? 'guards and officers' : 'people in your team'}${audience === 'TEAM' ? '' : ` ${whereLabel({ states, audience })}`}, to read by ${dateLabel(readBy)}.`}
            {replaces ? ' The earlier memo will show as replaced.' : ''} It cannot be edited after publishing; you can withdraw or replace it with a reason.
          </div>
          <div className="ss-actions">
            <button
              className="btn btn-primary"
              disabled={act.busy}
              onClick={() =>
                act
                  .run(
                    () =>
                      api.publishMemo(audience, title, body, states, {
                        readBy,
                        replaces: replaces || null,
                      }),
                    'Memo published.',
                  )
                  .then((r) => {
                    if (r) onDone();
                  })
              }
            >
              {act.busy ? 'Publishing…' : 'Publish now'}
            </button>
            <button className="btn" onClick={() => setReach(null)}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ m }: { m: Memo }) {
  if (m.status === 'withdrawn') return <Chip tone="neutral">Withdrawn</Chip>;
  if (m.status === 'replaced') return <Chip tone="neutral">Replaced</Chip>;
  if (m.forMe) return m.myRead ? <Chip tone="ok">Read</Chip> : <Chip tone={m.lateForMe ? 'crit' : 'warn'}>{m.lateForMe ? 'Not read, late' : 'Not read'}</Chip>;
  if (m.tracker && m.expectedCount != null) return <Chip tone={m.notReadCount ? 'warn' : 'ok'}>{`${m.readCount} of ${m.expectedCount} read`}</Chip>;
  return <Chip tone="info">{m.readCount} read</Chip>;
}

function MemoLine({ m }: { m: Memo }) {
  const [open, setOpen] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [why, setWhy] = useState('');
  const act = useAction();
  const unread = m.forMe && !m.myRead && m.status === 'active';
  return (
    <div className="ss-memo" data-unread={unread ? '' : undefined}>
      <button className="ss-row" data-tone={unread ? (m.lateForMe ? 'crit' : 'warn') : undefined} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ss-row-main">
          <span className="ss-row-title" style={{ textDecoration: m.status === 'active' ? undefined : 'line-through' }}>
            {m.title}
          </span>
          <span className="ss-meta">
            {m.ref ? `${m.ref} · ` : ''}
            {audienceLabel(m)} {whereLabel(m)} · {m.publishedBy} · {dateTimeLabel(m.publishedAt)}
            {m.readBy ? ` · read by ${dateLabel(m.readBy)}` : ''}
          </span>
        </span>
        <span className="ss-actions">
          <StatusChip m={m} />
          {open ? <CaretUpIcon size={16} className="ss-chev" aria-hidden="true" /> : <CaretDownIcon size={16} className="ss-chev" aria-hidden="true" />}
        </span>
      </button>
      {open && (
        <div className="ss-memo-body">
          {m.status === 'withdrawn' && m.withdrawn && (
            <div className="notice" data-tone="warn">
              Withdrawn by {m.withdrawn.by}, {dateTimeLabel(m.withdrawn.at)}: {m.withdrawn.reason}
            </div>
          )}
          {m.status === 'replaced' && (
            <div className="notice" data-tone="warn">
              Replaced by {m.replacedByRef ?? 'a newer memo'}. Read the newer memo.
            </div>
          )}
          {m.replacesRef && <div className="ss-note">This memo replaces {m.replacesRef}.</div>}
          <div className="ss-memo-text">{m.body}</div>
          {m.forMe && !m.myRead && m.status === 'active' && (
            <div className="ss-actions">
              <button className="btn btn-primary" disabled={act.busy} onClick={() => act.run(() => api.readMemo(m.id), 'Marked read.')}>
                I have read this
              </button>
            </div>
          )}
          {m.tracker && (
            <div className="small">
              <div>
                Read by {m.readCount}
                {m.expectedCount != null ? ` of ${m.expectedCount}` : ''}.
                {(m.reminders ?? []).length > 0 &&
                  ` Reminded ${m.reminders!.length} time${m.reminders!.length === 1 ? '' : 's'}, last ${dateTimeLabel(m.reminders!.at(-1)!.at)}.`}
              </div>
              {m.notRead.length > 0 && (
                <details>
                  <summary>Not read yet ({m.notReadCount})</summary>
                  <div className="muted">
                    {m.notRead.map((u) => u.name).join(', ')}
                    {(m.notReadCount ?? 0) > m.notRead.length ? ` and ${(m.notReadCount ?? 0) - m.notRead.length} more` : ''}
                  </div>
                </details>
              )}
              {m.reads.length > 0 && (
                <details>
                  <summary>Read ({m.reads.length})</summary>
                  <div className="muted">{m.reads.map((r) => r.name).join(', ')}</div>
                </details>
              )}
            </div>
          )}
          {m.canManage && (
            <div className="ss-actions">
              <button className="btn btn-sm" disabled={act.busy || !m.notReadCount} onClick={() => act.run(() => api.remindMemo(m.id), 'Reminder recorded.')}>
                Remind those who have not read
              </button>
              <button className="btn btn-sm" onClick={() => setWithdraw(!withdraw)}>
                Withdraw
              </button>
            </div>
          )}
          {withdraw && (
            <div className="ss-actions">
              <input
                className="input"
                aria-label="Reason for withdrawing"
                placeholder="Why it is withdrawn"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || why.trim().length < 5}
                onClick={() =>
                  act
                    .run(() => api.withdrawMemo(m.id, why), 'Memo withdrawn.')
                    .then((r) => {
                      if (r) setWithdraw(false);
                    })
                }
              >
                Withdraw the memo
              </button>
            </div>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}
