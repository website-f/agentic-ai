import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { Card, Empty, Steps, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';
import '../styles/gov.css';

/**
 * Emergency delegation and succession register (masterplan §243, Fauzan 3 Nov 2026; Arisha main round 5, 3 Nov 2026).
 * Critical posts and who could step in; who acts for whom, over what, from when to when, and why. Evidence first
 * (competency, and the board resolution for succession), then one leader approves (CEO, COO or Chief of
 * Staff; Fauzan 3 Nov 2026), never the person who recorded the line or the person who acts. Access is asked of IT for a limited time
 * through a help request; Prima grants nothing. A register only: it gives nobody access or approval rights in Prima.
 */
type Kind = 'EMERGENCY' | 'SUCCESSION' | 'LEAVE_COVER';
type Readiness = 'ready_now' | 'ready_later' | 'not_ready';
const KIND: Record<Kind, string> = { EMERGENCY: 'Emergency', SUCCESSION: 'Succession', LEAVE_COVER: 'Leave cover' };
const READY: Record<Readiness, string> = { ready_now: 'Ready now', ready_later: 'Ready later', not_ready: 'Not ready' };
const READY_TONE: Record<Readiness, 'ok' | 'info' | 'warn'> = { ready_now: 'ok', ready_later: 'info', not_ready: 'warn' };
const EVIDENCE = { hr_training: 'HR training record', hr_appraisal: 'HR appraisal', document: 'Other document' } as const;
const STATE = {
  pending: ['Waiting for approval', 'warn'],
  active: ['In force', 'ok'],
  not_started: ['Approved, not started', 'info'],
  expired: ['Past its end date', 'neutral'],
  ended: ['Ended', 'neutral'],
} as const;

export function DelegationsPanel() {
  const { data, error, reload } = useLoad(() => api.delegationBoard(), []);
  const act = useAction();
  const [f, setF] = useState({
    companyId: '',
    kind: 'EMERGENCY' as Kind,
    criticalRoleId: '',
    post: '',
    holderId: '',
    holderName: '',
    delegateId: '',
    scope: '',
    from: '',
    to: '',
    reason: '',
  });
  const [c, setC] = useState({ post: '', holderId: '', holderName: '', whyCritical: '', successorId: '', readiness: 'ready_now' as Readiness });
  const [addPost, setAddPost] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const [ev, setEv] = useState<Record<string, { kind: keyof typeof EVIDENCE; ref: string; boardRef: string; boardOn: string }>>({});
  const [acc, setAcc] = useState<Record<string, { systems: string; until: string }>>({});
  const [pick, setPick] = useState<Record<string, string[]>>({});
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="delegation register" />;
  const companyId = f.companyId || data.canRecordFor[0]?.id || '';
  const critFor = data.criticalRoles.filter((r) => r.role.companyId === companyId && r.canKeep);
  const n = (id: string) => (note[id] ?? '').trim();
  const canRecord = data.installed && data.canRecordFor.length > 0;
  return (
    <section className="gv-stack" aria-label="Delegation register">
      <p className="notice" data-tone="info">
        {data.note} One leader (the CEO, the COO or the Chief of Staff) approves each line after its evidence is in. A succession is approved only by the
        Chairman, or by the CEO with the Chairman’s consent. Never the person who recorded it or the person who acts.
      </p>
      {!data.installed && (
        <p className="notice" data-tone="warn">
          The delegation register is not set up on this database yet. Ask the release owner to install it.
        </p>
      )}

      <Card
        title="Critical posts"
        sub="Posts the companies cannot run without, who holds them and who could step in."
        flush
        actions={
          canRecord && (
            <button className="btn btn-sm" aria-expanded={addPost} onClick={() => setAddPost(!addPost)}>
              Add a critical post
            </button>
          )
        }
      >
        {canRecord && addPost && (
          <div className="gv-card-intro">
            <div className="gv-box" aria-label="Add a critical post">
              <div className="gv-form">
                <label className="field">
                  <span className="label">Critical post</span>
                  <input aria-label="Critical post" placeholder="Critical post" value={c.post} onChange={(e) => setC({ ...c, post: e.target.value })} />
                </label>
                <label className="field">
                  <span className="label">Holder</span>
                  <Select aria-label="Critical post holder" value={c.holderId} onChange={(e) => setC({ ...c, holderId: e.target.value })}>
                    <option value="">Holder not in the list</option>
                    {data.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </label>
                {!c.holderId && (
                  <label className="field">
                    <span className="label">Holder name</span>
                    <input
                      aria-label="Critical post holder name"
                      placeholder='Holder or "vacant"'
                      value={c.holderName}
                      onChange={(e) => setC({ ...c, holderName: e.target.value })}
                    />
                  </label>
                )}
                <label className="field gv-span">
                  <span className="label">Why it is critical</span>
                  <input
                    aria-label="Why critical"
                    placeholder="Why it is critical"
                    value={c.whyCritical}
                    onChange={(e) => setC({ ...c, whyCritical: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="label">Successor</span>
                  <Select aria-label="Successor" value={c.successorId} onChange={(e) => setC({ ...c, successorId: e.target.value })}>
                    <option value="">No successor yet</option>
                    {data.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </label>
                {c.successorId && (
                  <label className="field">
                    <span className="label">Readiness</span>
                    <Select aria-label="Successor readiness" value={c.readiness} onChange={(e) => setC({ ...c, readiness: e.target.value as Readiness })}>
                      {(Object.keys(READY) as Readiness[]).map((k) => (
                        <option key={k} value={k}>
                          {READY[k]}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
              </div>
              <div className="gv-form-foot">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || c.post.trim().length < 2 || c.whyCritical.trim().length < 5}
                  onClick={() =>
                    act.run(
                      () =>
                        api
                          .addCriticalRole(companyId, {
                            post: c.post,
                            holderId: c.holderId || null,
                            holderName: c.holderName,
                            whyCritical: c.whyCritical,
                            successors: c.successorId ? [{ userId: c.successorId, readiness: c.readiness }] : [],
                          })
                          .then(() => {
                            setC({ post: '', holderId: '', holderName: '', whyCritical: '', successorId: '', readiness: 'ready_now' });
                            reload();
                          }),
                      'Critical post added.',
                    )
                  }
                >
                  Add critical post
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setAddPost(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {!data.criticalRoles.length && <Empty title="No critical posts listed yet." />}
        <ul className="gv-list" aria-label="Critical posts">
          {data.criticalRoles.map(({ role: r, covered, leftSuccessors, reviewDue, canKeep }) => (
            <li className="gv-item item" key={r.id} data-tone={covered ? undefined : 'warn'}>
              <div className="gv-item-head">
                <div className="gv-item-main">
                  <div className="gv-item-title">
                    {r.post}: {r.holderName}
                  </div>
                  <div className="gv-item-meta">
                    {r.whyCritical} · review by {dateLabel(r.reviewOn)}
                  </div>
                </div>
                <div className="gv-item-state">
                  {reviewDue && <Chip tone="warn">Review due</Chip>}
                  <Chip tone={covered ? 'ok' : 'warn'}>{covered ? 'Covered' : 'No cover'}</Chip>
                </div>
              </div>
              <div className="gv-chips" aria-label={`Successors for ${r.post}`}>
                <span className="muted small">Successors:</span>
                {r.successors.length ? (
                  r.successors.map((s, i) => (
                    <Chip key={i} tone={READY_TONE[s.readiness as Readiness] ?? 'neutral'}>
                      {s.name} ({READY[s.readiness as Readiness]})
                    </Chip>
                  ))
                ) : (
                  <span className="small">none</span>
                )}
              </div>
              {leftSuccessors.length > 0 && <div className="gv-lines">Left (account closed, not cover): {leftSuccessors.join(', ')}</div>}
              {canKeep && reviewDue && (
                <div className="gv-inline">
                  <input
                    aria-label={`Review note for ${r.post}`}
                    placeholder="Review note"
                    value={note[r.id] ?? ''}
                    onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={act.busy || !n(r.id)}
                    onClick={() => act.run(() => api.criticalRoleStep(r.id, 'review', { note: n(r.id) }).then(reload), 'Reviewed.')}
                  >
                    Reviewed
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {canRecord && (
        <Card title="Record a delegation" sub="Who acts for whom, over what, from when to when, and why.">
          <div className="gv-stack-sm" aria-label="Record a delegation">
            <div className="gv-form">
              <label className="field">
                <span className="label">For</span>
                <Select aria-label="For" value={companyId} onChange={(e) => setF({ ...f, companyId: e.target.value, criticalRoleId: '' })}>
                  {data.canRecordFor.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">Kind</span>
                <Select aria-label="Kind of delegation" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>
                  {(Object.keys(KIND) as Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND[k]}
                    </option>
                  ))}
                </Select>
              </label>
              {critFor.length > 0 && (
                <label className="field">
                  <span className="label">Critical post covered</span>
                  <Select aria-label="Critical post covered" value={f.criticalRoleId} onChange={(e) => setF({ ...f, criticalRoleId: e.target.value })}>
                    <option value="">Not a listed critical post</option>
                    {critFor.map((r) => (
                      <option key={r.role.id} value={r.role.id}>
                        {r.role.post} ({r.role.holderName})
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {!f.criticalRoleId && (
                <>
                  <label className="field">
                    <span className="label">Post</span>
                    <input aria-label="Post" placeholder="Post, e.g. Company Manager" value={f.post} onChange={(e) => setF({ ...f, post: e.target.value })} />
                  </label>
                  <label className="field">
                    <span className="label">Post holder</span>
                    <Select aria-label="Post holder" value={f.holderId} onChange={(e) => setF({ ...f, holderId: e.target.value })}>
                      <option value="">Holder not in the list</option>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.title ? `, ${p.title}` : ''}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {!f.holderId && (
                    <label className="field">
                      <span className="label">Holder name</span>
                      <input
                        aria-label="Holder name"
                        placeholder='Holder name or "vacant"'
                        value={f.holderName}
                        onChange={(e) => setF({ ...f, holderName: e.target.value })}
                      />
                    </label>
                  )}
                </>
              )}
              <label className="field">
                <span className="label">Person who acts</span>
                <Select aria-label="Person who acts" value={f.delegateId} onChange={(e) => setF({ ...f, delegateId: e.target.value })}>
                  <option value="">Who acts</option>
                  {data.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.title ? `, ${p.title}` : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span className="label">May act on</span>
                <input aria-label="May act on" placeholder="What they may act on" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">From</span>
                <input aria-label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">To</span>
                <input aria-label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
              </label>
              <label className="field gv-span">
                <span className="label">Why</span>
                <input aria-label="Why" placeholder="Why" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </label>
            </div>
            <div className="gv-form-foot">
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !f.delegateId || !f.from || f.reason.trim().length < 5}
                onClick={() =>
                  act.run(
                    () =>
                      api
                        .addDelegation(companyId, {
                          kind: f.kind,
                          criticalRoleId: f.criticalRoleId || null,
                          post: f.post,
                          holderId: f.holderId || null,
                          holderName: f.holderName,
                          delegateId: f.delegateId,
                          scope: f.scope,
                          from: f.from,
                          to: f.to || null,
                          reason: f.reason,
                        })
                        .then(() => {
                          setF({ ...f, criticalRoleId: '', post: '', holderId: '', holderName: '', delegateId: '', scope: '', reason: '' });
                          reload();
                        }),
                    'Delegation recorded; add the evidence, then a leader approves.',
                  )
                }
              >
                Record delegation
              </button>
            </div>
          </div>
        </Card>
      )}
      {act.error && <p className="error small">{act.error.message}</p>}

      <Card title="Delegation lines" sub={`${data.rows.length} on the register`} flush>
        {!data.rows.length && <Empty title="No delegation lines yet." />}
        <ul className="gv-list">
          {data.rows.map((row) => {
            const d = row.delegation;
            const e = ev[d.id] ?? { kind: 'hr_training' as const, ref: '', boardRef: '', boardOn: '' };
            const a = acc[d.id] ?? { systems: '', until: '' };
            const work = d.holderId ? (data.openWork[d.holderId] ?? []) : [];
            const chosen = pick[d.id] ?? [];
            const step = (action: Parameters<typeof api.delegationStep>[1], done: string, body?: Parameters<typeof api.delegationStep>[3]) =>
              act.run(
                () =>
                  api.delegationStep(d.id, action, n(d.id), body).then(() => {
                    setNote({ ...note, [d.id]: '' });
                    reload();
                  }),
                done,
              );
            const anyAction =
              row.canApprove ||
              row.canEnd ||
              row.canRevoke ||
              row.canEvidence ||
              row.canRequestAccess ||
              row.canRemoveAccess ||
              row.canTransfer ||
              row.canHandBack;
            const pending = row.state === 'pending';
            const closed = row.state === 'ended' || row.state === 'expired';
            const steps: { label: string; state: StepState; note?: string }[] = [
              { label: 'Recorded', state: 'done', note: d.by },
              {
                label: 'Evidence',
                state: row.missing.length ? (pending ? 'now' : 'todo') : 'done',
                note: row.missing.length ? `Add ${row.missing.join(' and ')}` : undefined,
              },
              {
                label: 'Leader approval',
                state: pending ? (row.missing.length ? 'todo' : 'now') : (d.approvals ?? []).length ? 'done' : closed ? 'stopped' : 'done',
                note: (d.approvals ?? []).map((x) => x.by).join(', ') || undefined,
              },
              { label: 'Acting', state: row.state === 'active' ? 'done' : closed ? 'stopped' : row.state === 'not_started' ? 'now' : 'todo' },
            ];
            return (
              <li className="gv-item item" key={d.id} data-tone={pending ? 'warn' : undefined}>
                <div className="gv-item-head">
                  <div className="gv-item-main">
                    <strong className="gv-item-title">
                      {d.post}: {d.delegateName} acts for {d.holderName}
                    </strong>
                    <div className="gv-item-meta">
                      {KIND[d.kind]} · {d.scope} · from {dateLabel(d.from)}
                      {d.to ? ` to ${dateLabel(d.to)}` : ' until ended'} · recorded by {d.by}: {d.reason}
                    </div>
                  </div>
                  <div className="gv-item-state">
                    <Chip tone={STATE[row.state][1]}>{STATE[row.state][0]}</Chip>
                  </div>
                </div>
                <Steps steps={steps} />
                <div className="gv-lines">
                  <div aria-label={`Evidence for ${d.post}`}>
                    {d.competency
                      ? `Competency: ${EVIDENCE[d.competency.kind]} ${d.competency.ref} (${d.competency.note})`
                      : 'Competency evidence: not given yet'}
                    {d.kind === 'SUCCESSION' &&
                      (d.board ? ` · Board resolution ${d.board.resolutionRef} of ${dateLabel(d.board.on)}` : ' · Board resolution: not given yet')}
                  </div>
                  <div>
                    {(d.approvals ?? []).map((x) => `Approved by ${x.by}: ${x.note}`).join(' · ') || 'No approvals yet'}
                    {row.state === 'pending' && row.approvalsNeeded > 0
                      ? d.kind === 'SUCCESSION'
                        ? ' · the Chairman approves (or consents after the CEO)'
                        : ` · ${row.approvalsNeeded} more leader approval${row.approvalsNeeded === 1 ? '' : 's'} needed`
                      : ''}
                    {row.missing.length ? ` · add ${row.missing.join(' and ')} first` : ''}
                    {row.awaitingChairman ? ' · approved by the CEO, waiting for the Chairman’s consent' : ''}
                    {row.approversShort ? ' · nobody who may approve it is left: record it again by someone else' : ''}
                    {row.delegateClosed && !d.ended ? ` · ${d.delegateName}'s account is closed: end this line` : ''}
                    {d.ended ? ` · ${d.ended.revoked ? 'revoked' : 'ended'} by ${d.ended.by}: ${d.ended.note}` : ''}
                  </div>
                  {d.access && (
                    <div aria-label={`Access for ${d.post}`}>
                      Access asked of IT ({d.access.ticketRef}
                      {row.accessTicket ? `, ${row.accessTicket.status}${row.accessTicket.resolution ? `: ${row.accessTicket.resolution}` : ''}` : ''}) until{' '}
                      {dateLabel(d.access.until)}: {d.access.systems}
                      {d.access.removal
                        ? ` · removal asked (${d.access.removal.ticketRef}${row.removalTicket ? `, ${row.removalTicket.status}` : ''})`
                        : row.accessToRemove
                          ? ' · removal not asked yet'
                          : ''}
                      . Prima grants nothing; IT changes the provider by hand.
                    </div>
                  )}
                  {(d.transfers ?? []).length > 0 && (
                    <div>Work handed over: {(d.transfers ?? []).map((x) => `${x.title}${x.returned ? ' (handed back)' : ''}`).join(', ')}</div>
                  )}
                </div>
                {anyAction && (
                  <div className="gv-box">
                    <label className="field">
                      <span className="label">Reason for what you do next</span>
                      <input
                        aria-label={`Note for ${d.post}`}
                        placeholder="Reason (required)"
                        value={note[d.id] ?? ''}
                        onChange={(x) => setNote({ ...note, [d.id]: x.target.value })}
                      />
                    </label>
                    {row.canEvidence && (
                      <div className="gv-form">
                        <Select
                          aria-label={`Competency evidence kind for ${d.post}`}
                          value={e.kind}
                          onChange={(x) => setEv({ ...ev, [d.id]: { ...e, kind: x.target.value as keyof typeof EVIDENCE } })}
                        >
                          {(Object.keys(EVIDENCE) as (keyof typeof EVIDENCE)[]).map((k) => (
                            <option key={k} value={k}>
                              {EVIDENCE[k]}
                            </option>
                          ))}
                        </Select>
                        <input
                          aria-label={`Competency reference for ${d.post}`}
                          placeholder="Record or document reference"
                          value={e.ref}
                          onChange={(x) => setEv({ ...ev, [d.id]: { ...e, ref: x.target.value } })}
                        />
                        {d.kind === 'SUCCESSION' && (
                          <>
                            <input
                              aria-label={`Board resolution for ${d.post}`}
                              placeholder="Board resolution reference"
                              value={e.boardRef}
                              onChange={(x) => setEv({ ...ev, [d.id]: { ...e, boardRef: x.target.value } })}
                            />
                            <input
                              aria-label={`Board resolution date for ${d.post}`}
                              type="date"
                              value={e.boardOn}
                              onChange={(x) => setEv({ ...ev, [d.id]: { ...e, boardOn: x.target.value } })}
                            />
                          </>
                        )}
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || (!e.ref.trim() && !e.boardRef.trim())}
                          onClick={() =>
                            step('evidence', 'Evidence recorded.', {
                              ...(e.ref.trim() ? { competencyKind: e.kind, competencyRef: e.ref } : {}),
                              ...(e.boardRef.trim() ? { boardRef: e.boardRef, boardOn: e.boardOn } : {}),
                            })
                          }
                        >
                          Record evidence
                        </button>
                      </div>
                    )}
                    {row.canRequestAccess && (
                      <div className="gv-form">
                        <input
                          aria-label={`Systems for ${d.post}`}
                          placeholder="Systems and level, e.g. shared mailbox read"
                          value={a.systems}
                          onChange={(x) => setAcc({ ...acc, [d.id]: { ...a, systems: x.target.value } })}
                        />
                        <input
                          aria-label={`Access until for ${d.post}`}
                          type="date"
                          value={a.until}
                          onChange={(x) => setAcc({ ...acc, [d.id]: { ...a, until: x.target.value } })}
                        />
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || !n(d.id) || !a.systems.trim() || !a.until}
                          onClick={() => step('access', 'Access asked of IT; nothing was granted by Prima.', { systems: a.systems, until: a.until })}
                        >
                          Ask IT for access
                        </button>
                      </div>
                    )}
                    {row.canTransfer && work.length > 0 && (
                      <div className="gv-form">
                        <select
                          multiple
                          aria-label={`Open work of ${d.holderName}`}
                          value={chosen}
                          onChange={(x) => setPick({ ...pick, [d.id]: Array.from(x.target.selectedOptions).map((o) => o.value) })}
                        >
                          {work
                            .filter((t) => !(d.transfers ?? []).some((x) => x.taskId === t.id && !x.returned))
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.title}
                              </option>
                            ))}
                        </select>
                        <button
                          className="btn btn-sm"
                          disabled={act.busy || !n(d.id) || !chosen.length}
                          onClick={() => step('transfer', 'Work handed over.', { taskIds: chosen })}
                        >
                          Hand over work
                        </button>
                      </div>
                    )}
                    <div className="gv-btns">
                      {row.canApprove && (
                        <button className="btn btn-sm btn-primary" disabled={act.busy || !n(d.id)} onClick={() => step('approve', 'Approved.')}>
                          Approve
                        </button>
                      )}
                      {row.canRemoveAccess && (
                        <button className="btn btn-sm" disabled={act.busy || !n(d.id)} onClick={() => step('access-remove', 'Removal asked of IT.')}>
                          Ask IT to remove access
                        </button>
                      )}
                      {row.canHandBack && (
                        <button className="btn btn-sm" disabled={act.busy || !n(d.id)} onClick={() => step('handback', 'Work handed back.')}>
                          Hand work back
                        </button>
                      )}
                      {row.canEnd && (
                        <button className="btn btn-sm btn-ghost" disabled={act.busy || !n(d.id)} onClick={() => step('end', 'Ended.')}>
                          End
                        </button>
                      )}
                      {row.canRevoke && (
                        <button className="btn btn-sm btn-ghost" disabled={act.busy || !n(d.id)} onClick={() => step('revoke', 'Revoked.')}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
