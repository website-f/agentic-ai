import { useState } from 'react';
import type { TenderProtocolStep } from '@prima/core';
import { api, type Commercial } from '../api';
import { Chip, Drawer, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../ui';
import { DocList } from './Proof';

type Protocol = Commercial['protocol'];
type Row = Commercial['tenders'][number];

const BEFORE_LABEL = { preparing: 'Before pricing starts', submitted: 'Before submitting' } as const;
const AUTO_LABEL = { MANAGER: "Ticked by the company manager's signature", SLIP: 'Ticked by the submission slip' } as const;

/** Steps in their guide sections, in order. */
function groupSteps<T extends { section?: string }>(steps: T[]): [string, T[]][] {
  const out: [string, T[]][] = [];
  for (const s of steps) {
    const key = s.section ?? 'Other steps';
    const last = out.at(-1);
    if (last && last[0] === key) last[1].push(s);
    else out.push([key, [s]]);
  }
  return out;
}

/**
 * The tender protocol set by the Director Office Administrator (Fauzan, 25 Oct 2026). Admin staff follow it on every
 * tender; a tender cannot move on with a step not done.
 */
export function ProtocolPanel({ p }: { p: Protocol }) {
  const [editing, setEditing] = useState(false);
  const pr = p.protocol;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Tender protocol</h3>
          <div className="muted small">
            Set by the Director Office Administrator · version {pr.version}
            {pr.setBy ? ` · ${pr.setBy}, ${dateLabel(pr.setAt.slice(0, 10))}` : ''}
          </div>
        </div>
        <div className="row">
          {pr.placeholder && <Chip tone="warn">Placeholder steps</Chip>}
          {p.canEdit && (
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              Edit protocol
            </button>
          )}
        </div>
      </div>
      {groupSteps(pr.steps).map(([section, steps]) => (
        <details key={section} className="protocol-section">
          <summary>
            <span style={{ fontWeight: 600 }}>{section}</span> <span className="muted small">· {steps.length} items</span>
          </summary>
          <div className="list">
            {steps.map((s) => (
              <div key={s.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {s.code ? `${s.code} ` : ''}
                    {s.label}
                  </div>
                  {s.detail && <div className="muted small">{s.detail}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <Chip tone="neutral">{BEFORE_LABEL[s.before]}</Chip>
                  {s.needsDocument && <span className="muted small">Document needed</span>}
                  {s.managerOnly && <span className="muted small">Company manager only</span>}
                  {s.auto && <span className="muted small">{AUTO_LABEL[s.auto]}</span>}
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
      {pr.steps.length === 0 && <div className="empty">No protocol set yet.</div>}
      <p className="muted small">
        Tick each item when it is done. At the end the person who prepared the bid signs, then the company manager signs that all is verified by the guidelines,
        and the submission slip is uploaded.
      </p>
      {editing && <ProtocolEditor p={pr} onClose={() => setEditing(false)} />}
    </section>
  );
}

function ProtocolEditor({ p, onClose }: { p: Protocol['protocol']; onClose: () => void }) {
  const [steps, setSteps] = useState<(Omit<TenderProtocolStep, 'id'> & { id?: string })[]>(p.steps.map((s) => ({ ...s })));
  const [note, setNote] = useState('');
  const act = useAction();
  const patch = (i: number, v: Partial<TenderProtocolStep>) => setSteps(steps.map((s, k) => (k === i ? { ...s, ...v } : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };
  return (
    <Drawer title="Edit tender protocol" sub={`Version ${p.version + 1} applies to every company's tenders`} onClose={onClose}>
      {steps.map((s, i) => (
        <div key={i} className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="field">
            <span className="label">Step {i + 1}</span>
            <input className="input" aria-label={`Step ${i + 1} name`} value={s.label} onChange={(e) => patch(i, { label: e.target.value })} />
          </label>
          <textarea
            className="input"
            rows={2}
            aria-label={`Step ${i + 1} detail`}
            placeholder="What to do"
            value={s.detail}
            onChange={(e) => patch(i, { detail: e.target.value })}
          />
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <select
              className="select"
              aria-label={`Step ${i + 1} due`}
              value={s.before}
              onChange={(e) => patch(i, { before: e.target.value as TenderProtocolStep['before'] })}
            >
              <option value="preparing">Before preparing</option>
              <option value="submitted">Before submitting</option>
            </select>
            <label className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={s.needsDocument} onChange={(e) => patch(i, { needsDocument: e.target.checked })} /> Needs a document
            </label>
            <button className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              ↑
            </button>
            <button className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down">
              ↓
            </button>
            <button className="btn btn-sm" onClick={() => setSteps(steps.filter((_, k) => k !== i))} disabled={steps.length === 1}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        className="btn"
        disabled={steps.length >= 60}
        onClick={() => setSteps([...steps, { label: '', detail: '', before: 'submitted', needsDocument: false }])}
      >
        Add step
      </button>
      <label className="field">
        <span className="label">What changed</span>
        <input
          className="input"
          aria-label="What changed"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Group protocol issued by the Director Office"
        />
      </label>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || note.trim().length < 3 || steps.some((s) => !s.label.trim())}
          onClick={async () => {
            const r = await act.run(() => api.setTenderProtocol({ steps, note }), 'Tender protocol saved. Every company follows it from now.');
            if (r) onClose();
          }}
        >
          Save protocol
        </button>
      </div>
      <p className="muted small">Steps already done on a tender stay done. A new step applies to tenders that have not passed it yet.</p>
    </Drawer>
  );
}

/** The protocol steps on one tender, by guide section, with who did each and when. */
export function TenderSteps({ row, canPrepare, isManager }: { row: Row; canPrepare: boolean; isManager: boolean }) {
  const t = row.tender;
  const working = (t.status === 'open' || t.status === 'preparing') && !(t.verifications ?? []).length;
  const done = row.protocol.filter((s) => s.finished).length;
  return (
    <section>
      <h3>
        Tender guide{' '}
        <Chip tone={done === row.protocol.length ? 'ok' : 'warn'}>
          {done} of {row.protocol.length} done
        </Chip>
      </h3>
      {groupSteps(row.protocol.map((p) => ({ ...p, section: p.step.section }))).map(([section, items]) => {
        const n = items.filter((x) => x.finished).length;
        const waiting = items.some((x) => x.done?.status === 'na' && !x.done.naConfirmedBy);
        return (
          <details
            key={section}
            className="protocol-section"
            open={working && n < items.length && items.some((x) => x.step.before === (t.status === 'open' ? 'preparing' : 'submitted'))}
          >
            <summary>
              <span style={{ fontWeight: 600 }}>{section}</span>{' '}
              <Chip tone={n === items.length ? 'ok' : 'warn'}>
                {n}/{items.length}
              </Chip>
              {waiting && (
                <>
                  {' '}
                  <Chip tone="warn">T/B to confirm</Chip>
                </>
              )}
            </summary>
            <div className="list">
              {items.map((s) => (
                <StepRow
                  key={s.step.id}
                  t={t.id}
                  item={{
                    id: s.step.id,
                    label: `${s.step.code ? `${s.step.code} ` : ''}${s.step.label}`,
                    detail: s.step.detail,
                    needsDocument: s.step.needsDocument,
                    sub: s.step.auto ? AUTO_LABEL[s.step.auto] : `${BEFORE_LABEL[s.step.before]}${s.step.managerOnly ? ' · company manager records it' : ''}`,
                  }}
                  done={s.done}
                  plan={s.plan}
                  docs={s.docs}
                  canDo={canPrepare && working && !s.step.auto && (!s.step.managerOnly || isManager)}
                  canPlan={canPrepare && working && !s.step.auto}
                  canConfirm={row.canConfirmNa && working}
                />
              ))}
            </div>
          </details>
        );
      })}
    </section>
  );
}

type Done = Row['protocol'][number]['done'];
type Docs = Row['protocol'][number]['docs'];
type Plan = Row['protocol'][number]['plan'];

export function StepRow({
  t,
  item,
  done,
  plan,
  docs,
  canDo,
  canPlan,
  canConfirm,
  extra,
}: {
  t: string;
  item: { id: string; label: string; detail: string; needsDocument: boolean; sub: string };
  done: Done;
  plan: Plan;
  docs: Docs;
  canDo: boolean;
  canPlan: boolean;
  canConfirm: boolean;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState<null | 'plan'>(null);
  const [pic, setPic] = useState(plan?.pic ?? '');
  const [due, setDue] = useState(plan?.due ?? '');
  const [naNote, setNaNote] = useState('');
  const act = useAction();
  const na = done?.status === 'na';
  const naWaiting = na && !done?.naConfirmedBy;
  const close = () => setOpen(null);
  // Fauzan, 26 Oct 2026: just tick when it is done; untick a mistake before the bid is signed.
  const tick = (on: boolean) =>
    act.run(() => (on ? api.doTenderStep(t, item.id, '', []) : api.undoTenderStep(t, item.id)), on ? `${item.label} done.` : `${item.label} unticked.`);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        {canDo && !na && (
          <input
            type="checkbox"
            style={{ width: 22, height: 22, marginTop: 2, flexShrink: 0 }}
            checked={!!done}
            disabled={act.busy}
            aria-label={`Done: ${item.label}`}
            onChange={(e) => tick(e.target.checked)}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{item.label}</div>
          <div className="muted small">
            {item.sub}
            {plan ? ` · PIC ${plan.pic}${plan.due ? `, by ${dateLabel(plan.due)}` : ''}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {extra}
          {!done ? (
            <Chip tone="warn">Not done</Chip>
          ) : na ? (
            <Chip tone={naWaiting ? 'warn' : 'neutral'}>{naWaiting ? 'T/B, to confirm' : 'T/B'}</Chip>
          ) : (
            <Chip tone="ok">Done</Chip>
          )}
        </div>
      </div>
      {done && (
        <>
          <div className="small">
            {na ? 'Not applicable: ' : ''}
            {done.note === 'Done' ? '' : done.note}
            {done.ref ? <span className="muted"> · ref {done.ref}</span> : null}{' '}
            <span className="muted">
              · {done.by}, {dateTimeLabel(done.at)}
              {done.naConfirmedBy ? ` · confirmed by ${done.naConfirmedBy}${done.naConfirmNote ? `: ${done.naConfirmNote}` : ''}` : ''}
            </span>
          </div>
          <DocList docs={docs} />
        </>
      )}
      {naWaiting && canConfirm && (
        <>
          <input
            className="input"
            aria-label="T/B comment"
            placeholder="Comment (needed to confirm; a short one is fine)"
            value={naNote}
            onChange={(e) => setNaNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !naNote.trim()}
              onClick={() => act.run(() => api.confirmTenderNa(t, item.id, true, naNote), 'T/B confirmed.')}
            >
              Confirm T/B
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy}
              onClick={() => act.run(() => api.confirmTenderNa(t, item.id, false, naNote), 'T/B refused; the item is open again.')}
            >
              Refuse
            </button>
          </div>
        </>
      )}
      {!done && <ErrorNotice error={act.error} />}
      {!done && !open && canPlan && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {canPlan && (
            <button className="btn btn-sm" onClick={() => setOpen('plan')}>
              {plan ? 'Change PIC' : 'Set PIC and date'}
            </button>
          )}
        </div>
      )}
      {open === 'plan' && (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 140 }}
              aria-label="Person in charge"
              placeholder="Person in charge"
              value={pic}
              onChange={(e) => setPic(e.target.value)}
            />
            <input className="input" type="date" aria-label="Finish by" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !pic.trim()}
              onClick={async () => {
                const r = await act.run(() => api.planTenderStep(t, item.id, pic, due || null), 'PIC saved.');
                if (r) close();
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={close}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Steps still to do before the tender can move to this status. */
export function stepsMissing(row: Row, to: 'preparing' | 'submitted'): string[] {
  const label = (l: string, d: Done) => (d?.status === 'na' && !d.naConfirmedBy ? `${l} (T/B to confirm)` : l);
  const steps = row.protocol
    .filter((s) => !s.finished && !s.step.auto && (s.step.before === 'preparing' || s.step.before === to))
    .map((s) => label(s.step.code ? `${s.step.code} ${s.step.label}` : s.step.label, s.done));
  const items = to === 'submitted' ? row.checklist.filter((c) => !c.finished).map((c) => label(c.item.label, c.done)) : [];
  const decision = row.tender.decision?.choice === 'TERUSKAN' ? [] : ['Decision to teruskan'];
  return [...decision, ...steps, ...items];
}
