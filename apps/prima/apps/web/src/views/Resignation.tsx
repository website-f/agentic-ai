/**
 * E10 Staff resignation (Fauzan, 11 Nov 2026: "Tell Fitri to build"). The procedure in the handbook in English and
 * Malay, and the steps: the staff member resigns on their Clock screen (or HR enters the signed letter), HR accepts
 * and confirms the last day, and a shorter notice needs the HR Director. Notice: 1 month under 1 year of service,
 * 3 months for 1 year or more, never shorter than the Employment Act s.12. The server checks every step.
 */
import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { ProofInput, Resignation } from '@prima/core';
import { api, type MyResignation, type ResignationBoard } from '../api';
import { Card, Empty } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { Decide, todayMyt } from './newa-shared';

const STATUS: Record<Resignation['status'], { label: string; tone: Tone }> = {
  submitted: { label: 'Waiting for HR', tone: 'warn' },
  waiver_waiting: { label: 'Shorter notice: waiting for the HR Director', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'ok' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

function Steps({ r }: { r: Resignation }) {
  return (
    <div className="nw-steps">
      <span data-done="true">
        <span>Notice given</span> {dateLabel(r.noticeOn)}
      </span>
      <span>
        <span>Earliest last day</span> {dateLabel(r.earliestLastDay)}
      </span>
      {r.accepted && (
        <span data-done="true">
          <span>Last day</span> {dateLabel(r.accepted.lastDayOn)} · {r.accepted.by}
        </span>
      )}
      {r.shortNotice?.decided && (
        <span data-done={r.shortNotice.decided.approve}>
          <span>{r.shortNotice.decided.approve ? 'Shorter notice agreed by' : 'Shorter notice refused by'}</span> {r.shortNotice.decided.by} · “{r.shortNotice.decided.note}”
        </span>
      )}
    </div>
  );
}

/** The procedure text in both languages. */
function Procedure({ p }: { p: MyResignation['procedure'] }) {
  const [lang, setLang] = useState<'ms' | 'en'>('ms');
  const t = p[lang];
  return (
    <div className="nw-stack" style={{ gap: 6 }}>
      <div className="nw-actions">
        <button className="btn btn-sm" aria-pressed={lang === 'ms'} onClick={() => setLang('ms')}>
          Bahasa Melayu
        </button>
        <button className="btn btn-sm" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
          English
        </button>
      </div>
      <div data-no-translate>
        <strong>{t.title}</strong>
        <p className="nw-text">{t.body}</p>
      </div>
    </div>
  );
}

/** On the staff member's own Clock screen. */
export function MyResignationSection() {
  const { data, error } = useLoad(() => api.myResignation(), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ lastDayOn: '', reason: '' });
  const act = useAction();
  if (error) return null;
  if (!data) return <Loading what="resignation" />;
  if (!data.allowed && !data.rows.length) return null;
  const live = data.rows.find((r) => r.status !== 'withdrawn') ?? null;
  return (
    <Card title="Resign" sub="The resignation procedure in the handbook. Give notice here; HR confirms your last day.">
      <div className="nw-stack">
        {!data.ready && <p className="nw-note">Resigning in Prima is not switched on yet. Give HR a signed letter.</p>}
        {data.notice && !live && (
          <p className="nw-note">
            <span>If you resign today, your notice is</span> {data.notice.months === 1 ? '1 month' : `${data.notice.months} months`}
            {' · '}
            <span>earliest last day</span> {dateLabel(data.notice.earliestLastDay)}
          </p>
        )}
        {live && (
          <div className="nw-list">
            <div className="nw-item">
              <div className="nw-item-main">
                <strong>
                  <span>Resignation</span> {dateLabel(live.noticeOn)}
                </strong>
                <Steps r={live} />
              </div>
              <div className="nw-item-side">{live.reason}</div>
              <div className="nw-item-end">
                <Chip tone={STATUS[live.status].tone}>{STATUS[live.status].label}</Chip>
                {(live.status === 'submitted' || live.status === 'waiver_waiting') && (
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.resignAct('withdraw', { id: live.id }), 'Resignation withdrawn.')}>
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {data.ready && data.allowed && !live && !open && (
          <div className="nw-actions">
            <button className="btn" onClick={() => setOpen(true)}>
              I want to resign
            </button>
          </div>
        )}
        {open && data.notice && (
          <div className="nw-stack">
            <div className="nw-form">
              <label className="field">
                <span className="label">Last day you ask for</span>
                <input className="input" type="date" min={todayMyt()} value={f.lastDayOn || data.notice.earliestLastDay} onChange={(e) => setF({ ...f, lastDayOn: e.target.value })} aria-label="Last day you ask for" />
              </label>
              <label className="field">
                <span className="label">Reason (optional)</span>
                <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Reason (optional)" />
              </label>
            </div>
            {f.lastDayOn && f.lastDayOn < data.notice.earliestLastDay && <p className="nw-note">An earlier last day than the notice needs HR to agree and the HR Director to decide.</p>}
            <div className="nw-actions">
              <button
                className="btn btn-primary"
                disabled={act.busy}
                onClick={async () => {
                  const ok = await act.run(() => api.resignAct('submit', { lastDayOn: f.lastDayOn || data.notice!.earliestLastDay, reason: f.reason }), 'Resignation sent to HR.');
                  if (ok) setOpen(false);
                }}
              >
                Give notice
              </button>
              <button className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <ErrorNotice error={act.error} />
          </div>
        )}
        <details>
          <summary>Read the resignation procedure</summary>
          <Procedure p={data.procedure} />
        </details>
      </div>
    </Card>
  );
}

function AcceptForm({ row }: { row: ResignationBoard['rows'][number] }) {
  const r = row.r;
  const [lastDayOn, setLastDayOn] = useState(r.askedLastDay);
  const [note, setNote] = useState('');
  const [shortReason, setShortReason] = useState('');
  const act = useAction();
  const short = lastDayOn < r.earliestLastDay;
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">Confirmed last day</span>
          <input className="input" type="date" value={lastDayOn} onChange={(e) => setLastDayOn(e.target.value)} aria-label="Confirmed last day" />
        </label>
        <label className="field">
          <span className="label">Comment</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Comment" />
        </label>
        {short && (
          <label className="field nw-wide">
            <span className="label">Why a shorter notice (the HR Director decides)</span>
            <input className="input" value={shortReason} onChange={(e) => setShortReason(e.target.value)} aria-label="Why a shorter notice" />
          </label>
        )}
      </div>
      <div className="nw-actions">
        <button className="btn btn-sm btn-primary" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.resignAct('accept', { id: r.id, lastDayOn, note, shortReason }), short ? 'Sent to the HR Director for the shorter notice.' : 'Accepted. The last day is on the staff record.')}>
          {short ? 'Ask the HR Director' : 'Accept'}
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function EnterLetter({ b, onDone }: { b: ResignationBoard; onDone: () => void }) {
  const [f, setF] = useState({ personId: '', noticeOn: todayMyt(), lastDayOn: '', reason: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="nw-stack">
      <div className="nw-form">
        <label className="field">
          <span className="label">Staff member</span>
          <Select className="input" aria-label="Staff member" value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
            <option value="">Choose</option>
            {b.staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.staffNo})
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Date on the letter</span>
          <input className="input" type="date" value={f.noticeOn} onChange={(e) => setF({ ...f, noticeOn: e.target.value })} aria-label="Date on the letter" />
        </label>
        <label className="field">
          <span className="label">Last day asked (if the letter says)</span>
          <input className="input" type="date" value={f.lastDayOn} onChange={(e) => setF({ ...f, lastDayOn: e.target.value })} aria-label="Last day asked" />
        </label>
        <label className="field">
          <span className="label">Reason (optional)</span>
          <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Reason (optional)" />
        </label>
      </div>
      <ProofPicker site={null} refText="Resignation" items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !f.personId || !proof.length}
          onClick={async () => {
            const ok = await act.run(() => api.resignAct('submit', { ...f, lastDayOn: f.lastDayOn || undefined, proof }), 'Letter entered. Another HR person accepts it.');
            if (ok) onDone();
          }}
        >
          Enter the letter
        </button>
        <button className="btn" onClick={onDone}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** HR's list on the HR screen (staff movement group). */
export function ResignationsPanel() {
  const { data, error } = useLoad(() => api.resignationBoard(), []);
  const [entering, setEntering] = useState(false);
  const act = useAction();
  if (error || !data) return null;
  if (!data.ready)
    return (
      <Card title="Resignations">
        <Empty title="Resigning in Prima is not switched on yet.">The database part waits for the CEO to install it. Record leaving on the staff record as before.</Empty>
      </Card>
    );
  return (
    <Card
      title="Resignations"
      sub="Notice: 1 month under 1 year of service, 3 months for 1 year or more, never shorter than the Employment Act s.12. HR accepts and confirms the last day; a shorter notice needs the HR Director."
      actions={
        data.canEnter && !entering ? (
          <button className="btn btn-sm" onClick={() => setEntering(true)}>
            Enter a signed letter
          </button>
        ) : undefined
      }
    >
      <div className="nw-stack">
        {entering && <EnterLetter b={data} onDone={() => setEntering(false)} />}
        <ErrorNotice error={act.error} />
        {data.rows.length === 0 ? (
          <Empty title="No resignation on record." />
        ) : (
          <div className="nw-list">
            {data.rows.map((row) => (
              <div key={row.r.id} className="nw-item">
                <div className="nw-item-main">
                  <strong>
                    {row.r.name} ({row.r.staffNo})
                  </strong>
                  <span className="nw-note">{row.r.noticeLabel}</span>
                  <Steps r={row.r} />
                  {row.r.shortNotice && !row.r.shortNotice.decided && <span className="nw-note">“{row.r.shortNotice.reason}”</span>}
                </div>
                <div className="nw-item-side">
                  <span>
                    <span>Asked for</span> {dateLabel(row.r.askedLastDay)}
                  </span>
                  {row.daysLeft != null && <span>{row.daysLeft}</span>}
                </div>
                <div className="nw-item-end">
                  <Chip tone={STATUS[row.r.status].tone}>{STATUS[row.r.status].label}</Chip>
                </div>
                {row.canAccept && <AcceptForm row={row} />}
                {row.canWaive && (
                  <div className="nw-item-act">
                    <Decide busy={act.busy} approveLabel="Agree the shorter notice" refuseLabel="Refuse" onDecide={(approve, note) => void act.run(() => api.resignAct('waiver_decide', { id: row.r.id, approve, note }), approve ? 'Agreed. The last day is on the staff record.' : 'Refused. HR accepts with the full notice.')} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** HR publishes the procedure into the handbook with its Malay copy (the existing policy steps; staff acknowledge it). */
export function ResignationPolicyCard() {
  const { data } = useLoad(() => api.resignationBoard().catch(() => null), []);
  const pol = useLoad(() => api.hrPolicies().catch(() => null), []);
  const [checker, setChecker] = useState('');
  const act = useAction();
  if (!data || !data.canEnter || !pol.data) return null;
  const p = data.procedure;
  const existing = pol.data.rows.find((r) => r.title === p.en.title);
  return (
    <Card title="Resignation procedure for the handbook" sub="The standard text with the approved notice periods, in English and Malay. Publishing it asks every office staff member to read and acknowledge it.">
      <div className="nw-stack">
        <Procedure p={p} />
        {existing && (
          <p className="nw-note">
            <span>In the handbook: version</span> {existing.version} · {dateLabel(existing.publishedOn)}
          </p>
        )}
        <label className="field">
          <span className="label">Who checked the Malay text</span>
          <input className="input" value={checker} onChange={(e) => setChecker(e.target.value)} aria-label="Who checked the Malay text" />
        </label>
        <div className="nw-actions">
          <button
            className="btn btn-primary"
            disabled={act.busy || checker.trim().length < 3}
            onClick={() =>
              act.run(
                () =>
                  api.publishPolicy({
                    id: existing?.id ?? null,
                    kind: 'handbook',
                    title: p.en.title,
                    body: p.en.body,
                    audience: 'office',
                    material: true,
                    copies: [{ lang: 'ms', title: p.ms.title, body: p.ms.body, translator: checker }],
                  }),
                'Published in the handbook. Staff are asked to acknowledge it.',
              )
            }
          >
            {existing ? 'Publish as a new version' : 'Publish in the handbook'}
          </button>
        </div>
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}
