import { useState } from 'react';
import {
  ATTENDANCE_ISSUE_LABEL,
  DISCIPLINE_LABEL,
  FOLLOW_UP_LABEL,
  fromMs,
  type AttendanceIssueView,
  type DisciplineStep,
  type FollowUpKind,
  type ProofInput,
} from '@prima/core';
import { api } from '../api';
import { Chip, Drawer, ErrorNotice, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';

export const ISSUE_TONE: Record<AttendanceIssueView['issue'], Tone> = {
  NO_SHOW: 'crit',
  POST_EMPTY: 'crit',
  FACE_NOT_MATCHED: 'crit',
  OUTSIDE_GEOFENCE: 'crit',
  NOT_ROSTERED: 'crit',
  EARLY_LEAVE: 'warn',
  LATE: 'warn',
};

export function isAbsence(i: Pick<AttendanceIssueView, 'issue'>): boolean {
  return i.issue === 'NO_SHOW' || i.issue === 'POST_EMPTY';
}

/** Short state of an alert: still repeating, closed by what, or left without action after the shift. */
export function AlertState({ i, every }: { i: AttendanceIssueView; every: number }) {
  if (i.repeating)
    return (
      <Chip tone="crit" title={`Alerted ${i.alertsSent} times; next at ${hhmm(i.nextAlertAt)}`}>
        Alert ×{i.alertsSent}, every {every} min
      </Chip>
    );
  if (i.open) return <Chip tone="warn">No action recorded</Chip>;
  const last = i.actions.find((a) => (isAbsence(i) ? a.kind === 'REPLACEMENT' || a.kind === 'EXCUSED' : true)) ?? i.actions[i.actions.length - 1];
  return <Chip tone="ok">{last ? FOLLOW_UP_LABEL[last.kind] : 'Closed'}</Chip>;
}

/** What the PIC or CMS can do about one alert (Shahirah's comments on the attendance sheet). */
export function FollowUpDrawer({
  i,
  canFollowUp,
  canDiscipline,
  canReplace,
  canDesk,
  stepIn,
  onClose,
}: {
  i: AttendanceIssueView;
  canFollowUp: boolean;
  canDiscipline: boolean;
  canReplace: boolean;
  canDesk?: boolean;
  /** Operations may act for the company once the PIC has not acted in time (rule OPS-STEP-IN). */
  stepIn?: { afterMin: number; siteIds: string[] } | null;
  onClose: () => void;
}) {
  const absence = isAbsence(i);
  const shiftOn = new Date(i.shiftEnd).getTime() > Date.now() || i.repeating;
  const stepFrom = new Date(i.raisedAt).getTime() + (stepIn?.afterMin ?? 0) * 60_000;
  const mayStepIn = !!stepIn && !canFollowUp && absence && i.open && stepIn.siteIds.includes(i.siteId);
  const stepping = mayStepIn && Date.now() >= stepFrom;
  if (stepping) {
    canFollowUp = true;
    canReplace = true;
  }
  const kinds: FollowUpKind[] = [
    ...(canFollowUp || canDesk ? (['STAFF_ALERTED'] as const) : []),
    ...(canReplace && absence && i.shiftId && shiftOn ? (['REPLACEMENT'] as const) : []),
    ...(canFollowUp ? (['EXCUSED'] as const) : []),
    ...(canDiscipline && i.personId ? (['DISCIPLINE'] as const) : []),
  ];
  const [kind, setKind] = useState<FollowUpKind | null>(kinds[0] ?? null);
  const [note, setNote] = useState('');
  const [person, setPerson] = useState('');
  const [step, setStep] = useState<DisciplineStep | null>(null);
  const [days, setDays] = useState(1);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const needsProof = kind === 'EXCUSED' || kind === 'DISCIPLINE';
  const { run, busy, error } = useAction();
  const cands = useLoad(() => (kind === 'REPLACEMENT' && i.shiftId ? api.candidates(i.shiftId) : Promise.resolve(null)), [kind, i.shiftId]);
  const options = (cands.data?.candidates ?? []).filter((c) => !c.blocked && c.person.id !== i.personId).slice(0, 12);

  const submit = () =>
    run(
      () =>
        api.followUpAttendance({
          shiftId: i.shiftId,
          attendanceId: i.shiftId ? null : i.attendanceId,
          issue: i.issue,
          kind: kind!,
          note,
          replacementPersonId: kind === 'REPLACEMENT' ? person || null : null,
          discipline: kind === 'DISCIPLINE' ? step : null,
          suspensionDays: kind === 'DISCIPLINE' && step === 'SUSPENSION' ? days : null,
          proof: needsProof ? proof : [],
        }),
      kind === 'REPLACEMENT' ? 'Replacement sent. It shows under the post on the attendance sheet.' : `${FOLLOW_UP_LABEL[kind!]} recorded`,
    ).then((r) => r && onClose());

  return (
    <Drawer
      title={ATTENDANCE_ISSUE_LABEL[i.issue]}
      sub={`${i.personName ?? i.postName} · ${i.siteName}${i.postName ? ` · ${i.postName}` : ''}`}
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <AlertState i={i} every={5} />
          <Chip tone="neutral">
            Shift {hhmm(i.shiftStart)}–{hhmm(i.shiftEnd)}
          </Chip>
          <Chip tone="info">
            PIC: {i.pic.name} ({i.pic.title})
          </Chip>
        </div>
        <p className="muted small">
          {absence
            ? 'The alert repeats until a replacement or buffer guard is sent, the guard clocks in, or the absence is excused with a reason.'
            : 'The alert repeats until someone records an action.'}{' '}
          Disciplinary action is the company's decision; the app only records it.
        </p>

        {i.actions.length > 0 && (
          <div className="list">
            {i.actions.map((a) => (
              <div key={a.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <div style={{ fontWeight: 600 }}>
                  {FOLLOW_UP_LABEL[a.kind]}
                  {a.discipline ? `: ${DISCIPLINE_LABEL[a.discipline]}` : ''}
                </div>
                <div className="muted small">
                  {dateTimeLabel(a.at)} · {a.by}
                  {a.byDesk === 'cms' ? ' (CMS)' : a.byDesk === 'operations' ? ' (operations, for the company)' : ''}
                </div>
                {a.note && <div className="small">{a.note}</div>}
                {a.proofIds?.length ? <div className="muted small">{a.proofIds.length} document(s) attached as proof</div> : null}
              </div>
            ))}
          </div>
        )}

        {stepping && (
          <div className="notice" data-tone="warn">
            The company PIC has not acted for {stepIn!.afterMin} minutes. You can alert the guard, send a replacement or excuse the absence for the company. It
            is recorded as done by operations; discipline and closing stay with the company.
          </div>
        )}
        {mayStepIn && !stepping && (
          <div className="empty">The company PIC acts first. If nothing is done by {hhmm(fromMs(stepFrom))}, you can step in for the company.</div>
        )}
        {kinds.length === 0 && !mayStepIn && <div className="empty">You can see this alert but not act on it. The company's PIC acts.</div>}
        {kinds.length > 0 && (
          <>
            <div className="seg" role="group" aria-label="Action" style={{ flexWrap: 'wrap' }}>
              {kinds.map((k) => (
                <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k === 'STAFF_ALERTED' ? 'Guard contacted' : k === 'REPLACEMENT' ? 'Send replacement' : k === 'EXCUSED' ? 'Excuse' : 'Discipline'}
                </button>
              ))}
            </div>
            {kind === 'REPLACEMENT' && (
              <label className="field">
                <span className="label">Replacement or buffer guard</span>
                <select className="select" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Replacement guard">
                  <option value="">{cands.loading ? 'Loading…' : 'Choose a guard who passes the checks'}</option>
                  {options.map((c) => (
                    <option key={c.person.id} value={c.person.id}>
                      {c.person.name} · {c.person.staffNo}
                      {c.sameBranch ? '' : ' · other branch'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'DISCIPLINE' && i.personId && (
              <DisciplinePicker companyId={i.companyId} personId={i.personId} step={step} setStep={setStep} days={days} setDays={setDays} />
            )}
            <label className="field">
              <span className="label">
                {kind === 'EXCUSED' ? 'Reason (required)' : kind === 'DISCIPLINE' ? 'Reason and what the guard said (required)' : 'Note'}
              </span>
              <input
                className="input"
                aria-label="Follow-up note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  kind === 'EXCUSED'
                    ? 'Medical certificate (guard must inform within 48 hours), approved leave…'
                    : kind === 'STAFF_ALERTED'
                      ? 'Called the guard, on the way, ETA 20 min'
                      : kind === 'REPLACEMENT'
                        ? 'Buffer guard from the branch'
                        : 'Absent without notice'
                }
              />
            </label>
            {needsProof && <ProofPicker site={null} refText={i.siteName} items={proof} onChange={setProof} documentsOnly required />}
            <ErrorNotice error={error} />
            <div>
              <button
                className="btn btn-primary"
                disabled={busy || !kind || (kind === 'REPLACEMENT' && !person) || (kind === 'DISCIPLINE' && !step) || (needsProof && !proof.length)}
                onClick={submit}
              >
                Record
              </button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/** The group handbook ladder for this guard: what was given before, what is suggested, and what the law allows yet. */
function DisciplinePicker({
  companyId,
  personId,
  step,
  setStep,
  days,
  setDays,
}: {
  companyId: string;
  personId: string;
  step: DisciplineStep | null;
  setStep: (s: DisciplineStep) => void;
  days: number;
  setDays: (n: number) => void;
}) {
  const h = useLoad(() => api.disciplineHistory(companyId, personId), [companyId, personId]);
  if (h.error) return <ErrorNotice error={h.error} />;
  if (!h.data) return <div className="muted small">Loading the guard's record…</div>;
  const d = h.data;
  const chosen = d.options.find((o) => o.id === step);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="small">
        <strong>Group handbook, same for every guard.</strong> {d.activeWarnings} step{d.activeWarnings === 1 ? '' : 's'} on record in the last{' '}
        {d.handbook.value.warningValidMonths} months. Suggested next: <strong>{DISCIPLINE_LABEL[d.suggested]}</strong>.
      </div>
      {d.records.length > 0 && (
        <div className="muted small">Before: {d.records.map((r) => `${r.discipline ? DISCIPLINE_LABEL[r.discipline] : ''} (${r.date})`).join(', ')}</div>
      )}
      <label className="field">
        <span className="label">Step the company decided</span>
        <select className="select" value={step ?? ''} onChange={(e) => setStep(e.target.value as DisciplineStep)} aria-label="Disciplinary step">
          <option value="">Choose a step</option>
          {d.options.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.allowed}>
              {o.label}
              {o.id === d.suggested ? ' (suggested)' : ''}
              {o.allowed ? '' : ` — ${o.reason}`}
            </option>
          ))}
        </select>
      </label>
      {chosen && <div className="muted small">{chosen.law}</div>}
      {step === 'SUSPENSION' && (
        <label className="field">
          <span className="label">Days without wages (1 to {d.handbook.value.suspensionMaxDays})</span>
          <input
            className="input"
            type="number"
            min={1}
            max={d.handbook.value.suspensionMaxDays}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Suspension days"
          />
        </label>
      )}
      <div className="muted small">No fines or pay deductions as punishment (Employment Act s.24). Unpaid absence is handled in payroll, not here.</div>
    </div>
  );
}
