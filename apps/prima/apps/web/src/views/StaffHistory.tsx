import { useState } from 'react';
import { staffHistoryRole } from '@prima/core';
import { api, type GroupHistory, type HistoryLookupResult } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * Group employment history (Fauzan, 4 Nov 2026: "guard sometimes leave the company a and join back company b. Or leave
 * for few year and come back to work in different company. So we need a database of all staff history").
 * Each company keeps its own employment record; Prima links the records of one person by IC or passport.
 * HR keeps the history and decides about rehiring with a reason. Outside HR (Fauzan, 4 Nov 2026), only the Regional OM
 * and above and FWM management see it, and only for the one person whose IC or passport they type. A person marked
 * "do not hire again" shows a red notice.
 */

const ROLE: Record<string, string> = { guard: 'Guard', supervisor: 'Officer', patrol_officer: 'Patrolling officer', office: 'Office staff' };
const ENDED: Record<string, string> = {
  resigned: 'Resigned',
  terminated: 'Terminated',
  contract_end: 'Contract ended',
  retired: 'Retired',
  transferred: 'Transferred in the group',
  absconded: 'Left without notice',
  unknown: 'Not recorded',
};
const REHIRE_TONE = { eligible: 'ok', check_first: 'warn', do_not_rehire: 'crit' } as const;

/** The red notice (Fauzan, 4 Nov 2026: "If the person are flag dont hire again. Then it will put red notice"). */
function DoNotHireNotice({ by, at }: { by?: string; at?: string }) {
  return (
    <div
      className="list-item"
      data-tone="crit"
      role="alert"
      aria-label="Do not hire again"
      style={{ background: 'var(--crit-bg, #fde8e8)', borderLeft: '4px solid var(--crit, #c62828)' }}
    >
      <div>
        <strong style={{ color: 'var(--crit, #c62828)' }}>DO NOT HIRE AGAIN.</strong> Do not offer this person a job.
        {by && (
          <span className="muted small">
            {' '}
            Decided by {by}
            {at ? `, ${dateLabel(at.slice(0, 10))}` : ''}.
          </span>
        )}
      </div>
    </div>
  );
}

function RehireChip({ r }: { r: { status: keyof typeof REHIRE_TONE; label: string } | null }) {
  if (!r) return <Chip tone="neutral">No rehire mark</Chip>;
  return <Chip tone={REHIRE_TONE[r.status]}>{r.label}</Chip>;
}

/** The group history tab on a staff or guard profile. */
export function GroupHistoryTab({ personId }: { personId: string }) {
  const h = useLoad(() => api.groupHistory(personId), [personId]);
  if (h.error) return <ErrorNotice error={h.error} />;
  if (!h.data) return <Loading what="group history" />;
  return <GroupHistoryBody d={h.data} reload={h.reload} />;
}

function GroupHistoryBody({ d, reload }: { d: GroupHistory; reload: () => void }) {
  const act = useAction();
  const [rehire, setRehire] = useState<{ status: string; reason: string }>({ status: '', reason: '' });
  const [old, setOld] = useState({ companyId: '', role: 'guard', jobTitle: '', from: '', to: '', ended: 'unknown', sourceRef: '' });
  const [link, setLink] = useState({ idFull: '', nationality: 'MY', reason: '' });
  const [sep, setSep] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<'' | 'rehire' | 'old' | 'link'>('');
  if (!d.linked)
    return (
      <div className="panel" aria-label="Group history">
        <p className="muted">{d.why}</p>
      </div>
    );
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    const r = await act.run(fn, ok);
    if (r !== undefined) {
      setOpen('');
      reload();
    }
  };
  const det = d.detail;
  return (
    <div className="stack" aria-label="Group history" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {d.doNotRehire && <DoNotHireNotice by={d.rehire?.setBy} at={d.rehire?.setAt} />}
      <div className="kpis">
        <Kpi label="First joined the group" value={dateLabel(d.firstJoinedOn)} />
        <Kpi
          label="Without a break since"
          value={d.continuousSince ? dateLabel(d.continuousSince) : 'Not working now'}
          note="A transfer in the group is no break"
        />
        <Kpi label="Times joined" value={d.timesJoined} tone={d.timesJoined > 1 ? 'warn' : 'ok'} />
        <Kpi label="Group companies" value={d.companies} />
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Rehire:</strong> <RehireChip r={d.rehire} />
        {d.rehire && (
          <span className="muted small">
            by {d.rehire.setBy}, {dateLabel(d.rehire.setAt.slice(0, 10))}
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Job</th>
              <th>From</th>
              <th>To</th>
              {det && <th>How it ended</th>}
              {det && <th>Discipline</th>}
            </tr>
          </thead>
          <tbody>
            {d.employments.map((e, i) => (
              <tr key={`${e.personId ?? 'old'}-${i}`} style={e.thisRecord ? { fontWeight: 600 } : undefined}>
                <td>
                  {e.companyName}
                  {e.thisRecord && <span className="muted small"> · this record</span>}
                  {e.source === 'old_file' && <span className="muted small"> · from an old file</span>}
                  {e.staffNo && <div className="muted small mono">{e.staffNo}</div>}
                </td>
                <td>{e.jobTitle ?? ROLE[e.role] ?? e.role}</td>
                <td>{dateLabel(e.from)}</td>
                <td>{e.to ? dateLabel(e.to) : e.status === 'left' ? 'Left (date not recorded)' : 'Now'}</td>
                {det && (
                  <td>
                    {e.ended ? (ENDED[e.ended] ?? e.ended) : '—'}
                    {e.endReason && <div className="muted small">{e.endReason}</div>}
                  </td>
                )}
                {det && (
                  <td className="small">
                    {e.discipline
                      ? [
                          e.discipline.warnings && `${e.discipline.warnings} warning${e.discipline.warnings === 1 ? '' : 's'}`,
                          e.discipline.proven && `${e.discipline.proven} proven at inquiry`,
                          e.discipline.dismissals && `${e.discipline.dismissals} dismissal`,
                          e.discipline.absences && `${e.discipline.absences} absence action${e.discipline.absences === 1 ? '' : 's'}`,
                        ]
                          .filter(Boolean)
                          .join(', ') || 'None'
                      : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.papers.length > 0 && (
        <div className="small">
          <strong>Training that stays with the person:</strong> {d.papers.map((p) => `${p.label} ${dateLabel(p.doneOn)} (${p.companyName})`).join(' · ')}
        </div>
      )}
      <div className="muted small">The KDN guard card and eSIMS vetting are applied for again by each employer; they never carry over.</div>
      {det && (
        <>
          {det.suggestion && (
            <div className="list-item" data-tone="warn">
              <div>
                <Chip tone="warn">Suggestion</Chip> {det.suggestion.why} Prima never decides; HR does.
              </div>
            </div>
          )}
          {d.can.carryPaper &&
            det.papers
              .filter((p) => !p.onThisRecord && !det.papers.some((x) => x.onThisRecord && x.type === p.type))
              .map((p) => (
                <div key={p.credentialId} className="row" style={{ gap: 8 }}>
                  <span className="small">
                    {p.label} {p.number}, {dateLabel(p.doneOn)} ({p.companyName})
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() =>
                      run(() => api.carryHistoryPaper({ personId: d.personId, credentialId: p.credentialId }), 'Certificate carried to this record.')
                    }
                  >
                    Carry to this record
                  </button>
                </div>
              ))}
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {d.can.setRehire && (
              <button className="btn btn-sm" onClick={() => setOpen(open === 'rehire' ? '' : 'rehire')}>
                Rehire decision
              </button>
            )}
            {d.can.addOldRecord && (
              <button className="btn btn-sm" onClick={() => setOpen(open === 'old' ? '' : 'old')}>
                Add employment from an old file
              </button>
            )}
            {d.can.link && (
              <button className="btn btn-sm" onClick={() => setOpen(open === 'link' ? '' : 'link')}>
                Link a record with another number
              </button>
            )}
          </div>
          {open === 'rehire' && (
            <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <label className="field">
                <span className="label">Decision</span>
                <select className="input" aria-label="Rehire decision" value={rehire.status} onChange={(e) => setRehire({ ...rehire, status: e.target.value })}>
                  <option value="">Choose</option>
                  <option value="eligible">Can be hired again</option>
                  <option value="check_first">Check with HR before hiring</option>
                  {d.can.setDoNotRehire && <option value="do_not_rehire">Do not hire again (HR Director, COO, OGM, Ops Director or CEO)</option>}
                </select>
              </label>
              <label className="field">
                <span className="label">Reason (kept by HR; a lookup shows only the decision)</span>
                <textarea
                  className="input"
                  aria-label="Rehire reason"
                  rows={2}
                  value={rehire.reason}
                  onChange={(e) => setRehire({ ...rehire, reason: e.target.value })}
                />
              </label>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !rehire.status}
                onClick={() =>
                  run(() => api.setRehire({ personId: d.personId, status: rehire.status as never, reason: rehire.reason }), 'Rehire decision saved.')
                }
              >
                Save decision
              </button>
            </div>
          )}
          {open === 'old' && (
            <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="grid-2">
                <label className="field">
                  <span className="label">Company</span>
                  <select
                    className="input"
                    aria-label="Old employment company"
                    value={old.companyId}
                    onChange={(e) => setOld({ ...old, companyId: e.target.value })}
                  >
                    <option value="">Choose</option>
                    {d.employers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Job</span>
                  <select className="input" aria-label="Old employment job" value={old.role} onChange={(e) => setOld({ ...old, role: e.target.value })}>
                    {Object.entries(ROLE).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">First day</span>
                  <input
                    className="input"
                    type="date"
                    aria-label="Old employment first day"
                    value={old.from}
                    onChange={(e) => setOld({ ...old, from: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="label">Last day</span>
                  <input
                    className="input"
                    type="date"
                    aria-label="Old employment last day"
                    value={old.to}
                    onChange={(e) => setOld({ ...old, to: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="label">How it ended</span>
                  <select className="input" aria-label="Old employment ended" value={old.ended} onChange={(e) => setOld({ ...old, ended: e.target.value })}>
                    {['resigned', 'terminated', 'contract_end', 'retired', 'absconded', 'unknown'].map((k) => (
                      <option key={k} value={k}>
                        {ENDED[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Old file or register</span>
                  <input
                    className="input"
                    aria-label="Old file reference"
                    value={old.sourceRef}
                    onChange={(e) => setOld({ ...old, sourceRef: e.target.value })}
                  />
                </label>
              </div>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  run(
                    () =>
                      api.addOldEmployment({
                        personId: d.personId,
                        ...old,
                        role: old.role as never,
                        ended: old.ended as never,
                        jobTitle: old.jobTitle || null,
                      }),
                    'Old employment added.',
                  )
                }
              >
                Add
              </button>
            </div>
          )}
          {open === 'link' && (
            <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="muted small">
                For a renewed passport or an old IC: give the number on the other record. Prima finds that record and links this one to the same person. The
                number is not kept.
              </div>
              <div className="grid-2">
                <label className="field">
                  <span className="label">IC or passport on the other record</span>
                  <input
                    className="input"
                    aria-label="Other record number"
                    autoComplete="off"
                    value={link.idFull}
                    onChange={(e) => setLink({ ...link, idFull: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="label">Nationality</span>
                  <select
                    className="input"
                    aria-label="Other record nationality"
                    value={link.nationality}
                    onChange={(e) => setLink({ ...link, nationality: e.target.value })}
                  >
                    <option value="MY">Malaysian</option>
                    <option value="NP">Nepali</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="label">Reason</span>
                <input className="input" aria-label="Link reason" value={link.reason} onChange={(e) => setLink({ ...link, reason: e.target.value })} />
              </label>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() =>
                  run(async () => {
                    const f = await api.historyLookup({ idFull: link.idFull, nationality: link.nationality as never });
                    if (!f.record) throw new Error('No record you may see has that number.');
                    return api.linkHistory({ personId: d.personId, toPersonId: f.record.personId, reason: link.reason });
                  }, 'Linked.')
                }
              >
                Find and link
              </button>
            </div>
          )}
          {det.links.length > 1 && (
            <details>
              <summary className="small">How these records are linked</summary>
              {det.links.map((l) => (
                <div key={l.personId} className="row small" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <span>
                    {l.companyName} {l.staffNo}: {l.method === 'id_match' ? 'same IC or passport' : `linked by ${l.linkedBy}: ${l.note ?? ''}`}
                  </span>
                  {l.method === 'hr_link' && d.can.link && (
                    <>
                      <input
                        className="input"
                        aria-label={`Separate reason ${l.staffNo}`}
                        placeholder="Reason to separate"
                        value={sep[l.personId] ?? ''}
                        onChange={(e) => setSep({ ...sep, [l.personId]: e.target.value })}
                      />
                      <button
                        className="btn btn-sm"
                        disabled={act.busy}
                        onClick={() => run(() => api.separateHistory({ personId: l.personId, reason: sep[l.personId] ?? '' }), 'Separated.')}
                      >
                        Separate
                      </button>
                    </>
                  )}
                </div>
              ))}
            </details>
          )}
          {det.rehireHistory.length > 0 && (
            <details>
              <summary className="small">Rehire decisions and reasons</summary>
              {det.rehireHistory.map((r, i) => (
                <div key={i} className="small" style={{ marginTop: 4 }}>
                  {dateLabel(r.at.slice(0, 10))} · {r.by}:{' '}
                  <RehireChip
                    r={{
                      status: r.status,
                      label: { eligible: 'Can be hired again', check_first: 'Check with HR before hiring', do_not_rehire: 'Do not hire again' }[r.status],
                    }}
                  />{' '}
                  {r.reason}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}

const MARK_LABEL: Record<string, string> = { eligible: 'Can be hired again', check_first: 'Check with HR before hiring', do_not_rehire: 'Do not hire again' };

/**
 * Look up one person by IC or passport (Fauzan, 4 Nov 2026): the Regional OM and above see a summary of that person;
 * HR and FWM management open the record itself. Never a list. The red notice shows when they are not to be hired again.
 */
export function HistoryLookupPanel() {
  const { me } = useApp();
  const act = useAction();
  const role = staffHistoryRole(me.user);
  const [f, setF] = useState({ idFull: '', nationality: role === 'fwm' ? 'NP' : 'MY' });
  const [asked, setAsked] = useState<{ idFull: string; nationality: string } | null>(null);
  const [r, setR] = useState<HistoryLookupResult | null>(null);
  const [open, setOpen] = useState<{ personId: string; name: string } | null>(null);
  const [mark, setMark] = useState({ status: '', reason: '' });
  if (!role) return null;
  const lookup = async (q: { idFull: string; nationality: string }) => {
    const out = await act.run(() => api.historyLookup({ idFull: q.idFull, nationality: q.nationality as never }));
    if (out) {
      setR(out);
      setAsked(q);
      setF({ ...f, idFull: '' });
      if (out.record) setOpen(out.record);
    }
  };
  const s = r?.summary;
  return (
    <section className="panel" aria-label="Look up staff history">
      <div className="panel-head">
        <div>
          <h2>Look up staff history</h2>
          <div className="muted small">
            Type the IC or passport to see that one person's history in the group. The number is not kept; each lookup is recorded with the masked number.
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field">
          <span className="label">IC or passport</span>
          <input
            className="input"
            aria-label="IC or passport to look up"
            autoComplete="off"
            value={f.idFull}
            onChange={(e) => setF({ ...f, idFull: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Nationality</span>
          <select className="input" aria-label="Nationality to look up" value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })}>
            {role !== 'fwm' && <option value="MY">Malaysian</option>}
            <option value="NP">Nepali</option>
          </select>
        </label>
        <button className="btn btn-primary btn-sm" disabled={act.busy || f.idFull.trim().length < 6} onClick={() => lookup({ ...f })}>
          Look up
        </button>
      </div>
      <ErrorNotice error={act.error} />
      {r && (
        <div aria-label="Lookup result" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {r.doNotRehire && <DoNotHireNotice by={r.rehire?.setBy} at={r.rehire?.setAt} />}
          <div>
            <span className="mono">{r.idMasked}</span>:{' '}
            {r.known ? (
              <>
                {s!.employments.length} employment{s!.employments.length === 1 ? '' : 's'} in the group, joined {s!.timesJoined} time
                {s!.timesJoined === 1 ? '' : 's'}
                {s!.lastLeftOn ? `, last left ${dateLabel(s!.lastLeftOn)}` : ''}
                {s!.employedNow ? '; still employed in the group' : ''}. {r.rehire ? <RehireChip r={r.rehire} /> : <Chip tone="neutral">No rehire mark</Chip>}
              </>
            ) : (
              'not found in the group.'
            )}
          </div>
          {!r.doNotRehire && <div className="small">{r.advice}</div>}
          {s && !r.record && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Job</th>
                      <th>From</th>
                      <th>To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.employments.map((e, i) => (
                      <tr key={i}>
                        <td>
                          {e.companyName}
                          {e.source === 'old_file' && <span className="muted small"> · from an old file</span>}
                        </td>
                        <td>{e.jobTitle ?? ROLE[e.role] ?? e.role}</td>
                        <td>{dateLabel(e.from)}</td>
                        <td>{e.to ? dateLabel(e.to) : e.status === 'left' ? 'Left (date not recorded)' : 'Now'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.papers.length > 0 && (
                <div className="small">
                  <strong>Training that stays with the person:</strong>{' '}
                  {s.papers.map((p) => `${p.label} ${dateLabel(p.doneOn)} (${p.companyName})`).join(' · ')}
                </div>
              )}
            </>
          )}
          {r.record && (
            <button className="btn btn-sm" onClick={() => setOpen(r.record)}>
              Open the full history
            </button>
          )}
          {r.rehireNotes && r.rehireNotes.length > 0 && (
            <details>
              <summary className="small">Rehire decisions and reasons</summary>
              {r.rehireNotes.map((n, i) => (
                <div key={i} className="small" style={{ marginTop: 4 }}>
                  {dateLabel(n.at.slice(0, 10))} · {n.by}: <RehireChip r={{ status: n.status, label: MARK_LABEL[n.status] }} /> {n.reason}
                </div>
              ))}
            </details>
          )}
          {r.can.mark && asked && (
            <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <label className="field">
                <span className="label">Your decision</span>
                <select
                  className="input"
                  aria-label="Lookup rehire decision"
                  value={mark.status}
                  onChange={(e) => setMark({ ...mark, status: e.target.value })}
                >
                  <option value="">Choose</option>
                  <option value="do_not_rehire">Do not hire again</option>
                  <option value="check_first">Check with HR before hiring</option>
                  <option value="eligible">Can be hired again</option>
                </select>
              </label>
              <label className="field">
                <span className="label">Reason</span>
                <textarea
                  className="input"
                  aria-label="Lookup rehire reason"
                  rows={2}
                  value={mark.reason}
                  onChange={(e) => setMark({ ...mark, reason: e.target.value })}
                />
              </label>
              <div className="muted small">Type the same IC or passport again above to confirm the person.</div>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !mark.status || f.idFull.trim().length < 6}
                onClick={async () => {
                  const out = await act.run(
                    () => api.markByLookup({ idFull: f.idFull, nationality: f.nationality as never, status: mark.status as never, reason: mark.reason }),
                    'Decision saved.',
                  );
                  if (out) {
                    setMark({ status: '', reason: '' });
                    await lookup({ ...f });
                  }
                }}
              >
                Save decision
              </button>
            </div>
          )}
        </div>
      )}
      {open && (
        <Drawer title={open.name} sub="Group employment history" onClose={() => setOpen(null)}>
          <GroupHistoryTab personId={open.personId} />
        </Drawer>
      )}
    </section>
  );
}

/** HR: people who came back, the rehire marks and records still to link. FWM management: counts and linking only. */
export function GroupHistoryPanel() {
  const b = useLoad(() => api.groupHistoryBoard().catch(() => null), []);
  const act = useAction();
  const [open, setOpen] = useState<{ personId: string; name: string } | null>(null);
  const [tab, setTab] = useState<'returning' | 'marked'>('returning');
  if (b.loading && !b.data) return <Loading what="group history" />;
  const d = b.data;
  if (!d) return null;
  const rows = tab === 'returning' ? d.returning : d.marked;
  return (
    <section className="panel" aria-label="Group employment history">
      <div className="panel-head">
        <div>
          <h2>Group employment history</h2>
          <div className="muted small">
            One person across the group's companies. Each company keeps its own employment record; Prima links them by IC or passport. Rehiring is HR's decision
            with a reason.
          </div>
        </div>
        {d.canLinkExisting && (
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={async () => {
              const r = await act.run(
                () => api.linkExistingRecords(),
                (x) => `Linked ${x.linked} record${x.linked === 1 ? '' : 's'}.`,
              );
              if (r) b.reload();
            }}
          >
            Link existing records ({d.counts.unlinked})
          </button>
        )}
      </div>
      {!d.linkingOn && (
        <div className="list-item" data-tone="warn">
          Linking is off until IT sets the key for the history (the same Key Vault secret as staff PINs).
        </div>
      )}
      <div className="kpis">
        <Kpi label="People" value={d.counts.people} />
        <Kpi label="Came back or moved" value={d.counts.returning} note={`${d.counts.severalCompanies} in more than one company`} />
        <Kpi label="Check before hiring" value={d.counts.checkFirst} tone={d.counts.checkFirst ? 'warn' : 'ok'} />
        <Kpi label="Do not hire again" value={d.counts.doNotRehire} tone={d.counts.doNotRehire ? 'crit' : 'ok'} />
        <Kpi label="Not linked yet" value={d.counts.unlinked} tone={d.counts.unlinked ? 'warn' : 'ok'} note="No IC or passport match yet" />
      </div>
      <ErrorNotice error={act.error} />
      {!d.lists && <div className="muted small">FWM opens a person only by typing their passport number in the lookup.</div>}
      {d.lists && (
        <>
          <div className="tabbar" role="tablist" aria-label="History lists">
            <button role="tab" aria-selected={tab === 'returning'} onClick={() => setTab('returning')}>
              Came back or moved ({d.returning.length})
            </button>
            <button role="tab" aria-selected={tab === 'marked'} onClick={() => setTab('marked')}>
              Rehire marks ({d.marked.length})
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Companies</th>
                  <th>Joined</th>
                  <th className="hide-sm">Now at</th>
                  <th>Rehire</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.groupPersonId}
                    className={r.personId ? 'clickable' : undefined}
                    onClick={() => r.personId && setOpen({ personId: r.personId, name: r.name })}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div className="muted small mono">{r.staffNo}</div>
                    </td>
                    <td className="small">{r.companies.join(', ')}</td>
                    <td>
                      {r.timesJoined}×<div className="muted small">first {dateLabel(r.firstJoinedOn)}</div>
                    </td>
                    <td className="hide-sm small">{r.nowAt.length ? r.nowAt.join(', ') : 'Not working in the group'}</td>
                    <td>
                      <RehireChip r={r.rehire} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <div className="empty">Nobody here yet.</div>}
          </div>
        </>
      )}
      {open && (
        <Drawer title={open.name} sub="Group employment history" onClose={() => setOpen(null)}>
          <GroupHistoryTab personId={open.personId} />
        </Drawer>
      )}
    </section>
  );
}
