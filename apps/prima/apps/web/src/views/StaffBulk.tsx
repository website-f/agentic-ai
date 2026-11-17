import { useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsLeftRightIcon, IdentificationBadgeIcon } from '@phosphor-icons/react';
import { api, type StaffMovements } from '../api';
import { Chip, RefreshContext, notify } from '../ui';
import { Select } from '../SearchSelect';
import { activateDrawer } from '../drawer-focus';
import { useBackClose } from '../back-close';
import '../styles/staff-bulk.css';

/**
 * P111 (Fitri, 17 Nov 2026: "make the HR and re-sorting the data available by multi select and change their designation
 * and company. make it seamless"): on the staff list, HR ticks people and changes their job title (designation) or moves
 * them to another group company in one go.
 *
 * A bulk change is only a loop over the existing one-person action, with one shared reason, one person at a time:
 * - Change designation: api.changeStaffJobTitle (HR's own right, as in Edit staff details; the reason goes to the audit log).
 * - Change company: api.prepareStaffMovement as a transfer (the receiving company head, then the HR Director approve each
 *   one, and nothing changes before the date it takes effect). Never applied directly.
 * The server checks every call; each person's outcome (done, sent for approval, refused with why) is shown afterwards.
 */

export interface BulkPerson {
  id: string;
  name: string;
  staffNo: string;
  role: string;
  status: string;
  leaving: boolean;
  companyId: string;
  jobTitle: string | null;
}

type Mode = 'title' | 'company';
type Prep = NonNullable<StaffMovements['prep']>;
type Outcome = { id: string; name: string; kind: 'done' | 'sent' | 'refused'; message?: string };

/** Today in Malaysia (the server's day), for the date a transfer takes effect. */
function todayMyt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Who the action leaves out before any call, with the same reason the server gives. */
function leftOutWhy(p: BulkPerson, mode: Mode): string | null {
  if (p.role !== 'office') return 'Guards and officers come from the JA Group app.';
  if (p.status === 'left') return 'This person has left.';
  if (mode === 'company' && (p.status !== 'active' || p.leaving)) return 'Only an active staff member who is not leaving can be moved.';
  return null;
}

/** The buttons in the table's ticked-rows bar. Each shows only to those the server lets do it. */
export function StaffBulkBar({
  ticked,
  canTitle,
  prep,
  companyId,
  titles,
  onUntick,
  onDone,
}: {
  ticked: BulkPerson[];
  canTitle: boolean;
  prep: Prep | null;
  companyId: string;
  titles: string[];
  onUntick: () => void;
  onDone: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <>
      {canTitle && (
        <button type="button" className="btn" onClick={() => setMode('title')}>
          <IdentificationBadgeIcon size={16} weight="bold" aria-hidden="true" />
          Change designation
        </button>
      )}
      {prep && (
        <button type="button" className="btn" onClick={() => setMode('company')}>
          <ArrowsLeftRightIcon size={16} weight="bold" aria-hidden="true" />
          Change company
        </button>
      )}
      <button type="button" className="btn btn-ghost" onClick={onUntick}>
        Untick all
      </button>
      {mode && (
        <StaffBulkDialog
          mode={mode}
          people={ticked}
          prep={prep}
          companyId={companyId}
          titles={titles}
          onClose={() => setMode(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}

function StaffBulkDialog({
  mode,
  people,
  prep,
  companyId,
  titles,
  onClose,
  onDone,
}: {
  mode: Mode;
  people: BulkPerson[];
  prep: Prep | null;
  companyId: string;
  titles: string[];
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const titleId = useId();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const { bump } = useContext(RefreshContext);
  // The people and the reasons are fixed when the dialog opens, so ticking more behind it changes nothing.
  const [list] = useState(() => people.map((p) => ({ p, why: leftOutWhy(p, mode) })));
  const go = list.filter((x) => !x.why).map((x) => x.p);
  const out = list.filter((x) => x.why);
  const [step, setStep] = useState<'form' | 'confirm' | 'running' | 'result'>('form');
  const [jobTitle, setJobTitle] = useState('');
  const [toCompanyId, setTo] = useState('');
  const [branchId, setBranch] = useState('');
  const [effectiveOn, setOn] = useState(todayMyt);
  const [reason, setReason] = useState('');
  const [doneCount, setDoneCount] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const employers = (prep?.employers ?? []).filter((c) => c.id !== companyId);
  const target = employers.find((c) => c.id === toCompanyId);
  const branches = target?.branches ?? [];
  // One branch at the new company: chosen for them.
  useEffect(() => {
    setBranch(branches.length === 1 ? branches[0].id : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toCompanyId]);
  const busyRef = useRef(false);
  busyRef.current = step === 'running';
  const close = useRef(onClose);
  close.current = () => {
    if (!busyRef.current) onClose();
  };
  useEffect(() => (box.current ? activateDrawer(box.current, () => close.current()) : undefined), []);
  useBackClose(true, () => close.current());

  const cleanTitle = jobTitle.trim().replace(/\s+/g, ' ');
  const ready =
    go.length > 0 &&
    reason.trim().length >= 5 &&
    (mode === 'title' ? cleanTitle.length >= 2 : !!toCompanyId && !!branchId && /^\d{4}-\d{2}-\d{2}$/.test(effectiveOn));

  const run = async () => {
    setStep('running');
    const res: Outcome[] = [];
    for (const p of go) {
      try {
        if (mode === 'title') {
          await api.changeStaffJobTitle(p.id, cleanTitle, reason.trim());
          res.push({ id: p.id, name: p.name, kind: 'done' });
        } else {
          await api.prepareStaffMovement({
            personId: p.id,
            kind: 'transfer',
            toCompanyId,
            effectiveOn,
            reason: reason.trim(),
            jobTitle: null,
            department: null,
            reportsTo: null,
            basicPay: null,
            branchId,
            staffNo: p.staffNo,
            until: null,
          });
          res.push({ id: p.id, name: p.name, kind: 'sent' });
        }
      } catch (e) {
        res.push({ id: p.id, name: p.name, kind: 'refused', message: e instanceof Error ? e.message : String(e) });
      }
      setDoneCount(res.length);
      setOutcomes([...res]);
    }
    const ok = res.filter((r) => r.kind !== 'refused').map((r) => r.id);
    if (ok.length) {
      onDone(ok);
      bump();
    }
    if (!res.some((r) => r.kind === 'refused')) {
      notify(mode === 'title' ? 'Designation changed.' : 'Sent for approval.');
      onClose();
      return;
    }
    setStep('result');
  };

  const count = (k: Outcome['kind']) => outcomes.filter((o) => o.kind === k).length;
  const heading = mode === 'title' ? 'Change designation' : 'Change company';

  // On the document's body, so the phone's tab bar never sits over the sheet (the page's own layers stay below it).
  return createPortal(
    <div className="sb-layer">
      <div className="scrim dt-dialog-scrim" onClick={() => close.current()} />
      <div ref={box} className="dt-dialog sb-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="dt-dialog-title">
          {heading}
        </h2>

        {step === 'form' && (
          <>
            <dl className="sb-facts">
              <div>
                <dt>Ticked</dt>
                <dd className="num">{people.length}</dd>
              </div>
              <div>
                <dt>{mode === 'title' ? 'Will change' : 'Will be sent'}</dt>
                <dd className="num">{go.length}</dd>
              </div>
            </dl>
            {out.length > 0 && <LeftOut rows={out.map((x) => ({ name: x.p.name, why: x.why! }))} />}
            {go.length > 0 && mode === 'title' && (
              <>
                <label className="field">
                  <span className="label">New job title</span>
                  <input className="input" list={listId} value={jobTitle} maxLength={80} autoComplete="off" onChange={(e) => setJobTitle(e.target.value)} />
                  <datalist id={listId}>
                    {titles.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </label>
                <p className="muted small">
                  The job title changes at once for each person, with your reason in the audit log. A promotion with new pay goes through Staff movement on
                  the HR page.
                </p>
              </>
            )}
            {go.length > 0 && mode === 'company' && (
              <>
                <div className="sb-grid">
                  <label className="field">
                    <span className="label">New company</span>
                    <Select className="select" aria-label="New company" value={toCompanyId} onChange={(e) => setTo(e.target.value)}>
                      <option value="">Choose</option>
                      {employers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="field">
                    <span className="label">Branch at the new company</span>
                    <Select className="select" aria-label="Branch at the new company" value={branchId} onChange={(e) => setBranch(e.target.value)}>
                      <option value="">Choose</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="field">
                    <span className="label">Takes effect on</span>
                    <input className="input" type="date" value={effectiveOn} onChange={(e) => setOn(e.target.value)} />
                  </label>
                </div>
                <p className="muted small">
                  Each one is a transfer: the receiving company head, then the HR Director, approve it, and nothing changes before the date it takes effect. By
                  law the new company is a new employment. Each person keeps their staff number; if it is already used at the new company, that person is
                  refused and can be sent from Staff movement on the HR page.
                </p>
              </>
            )}
            {go.length > 0 && (
              <label className="field">
                <span className="label">Reason (needed, 5 characters or more)</span>
                <textarea className="textarea" rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the new org chart" />
              </label>
            )}
            <div className="dt-dialog-actions">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              {go.length > 0 && (
                <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => setStep('confirm')}>
                  Continue
                </button>
              )}
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p className="sb-ask">{mode === 'title' ? 'Change the job title of these people?' : 'Send these transfers for approval?'}</p>
            <dl className="sb-facts sb-facts-wide">
              <div>
                <dt>People</dt>
                <dd className="num">{go.length}</dd>
              </div>
              {mode === 'title' ? (
                <div>
                  <dt>New job title</dt>
                  <dd data-no-translate>{cleanTitle}</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>New company</dt>
                    <dd data-no-translate>{target?.name}</dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd data-no-translate>{branches.find((b) => b.id === branchId)?.name}</dd>
                  </div>
                  <div>
                    <dt>Takes effect on</dt>
                    <dd>{effectiveOn}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Reason</dt>
                <dd data-no-translate>{reason.trim()}</dd>
              </div>
            </dl>
            <ul className="dt-dialog-names" data-no-translate>
              {go.slice(0, 6).map((p) => (
                <li key={p.id}>
                  {p.name}
                  {mode === 'title' && p.jobTitle ? <span className="muted"> · {p.jobTitle}</span> : null}
                </li>
              ))}
            </ul>
            {go.length > 6 && (
              <p className="muted small">
                <span>And more:</span> <span className="num">{go.length - 6}</span>
              </p>
            )}
            <div className="dt-dialog-actions">
              <button type="button" className="btn" onClick={() => setStep('form')}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void run()}>
                {mode === 'title' ? 'Yes, change them' : 'Yes, send for approval'}
              </button>
            </div>
          </>
        )}

        {step === 'running' && (
          <div className="sb-progress" role="status" aria-live="polite">
            <span>Working…</span>{' '}
            <span className="num">
              {doneCount} / {go.length}
            </span>
            <progress max={go.length} value={doneCount} aria-label="Progress" />
          </div>
        )}

        {step === 'result' && (
          <>
            <dl className="sb-facts">
              <div>
                <dt>{mode === 'title' ? 'Done' : 'Sent for approval'}</dt>
                <dd className="num">{count(mode === 'title' ? 'done' : 'sent')}</dd>
              </div>
              <div>
                <dt>Refused</dt>
                <dd className="num" data-tone="crit">
                  {count('refused')}
                </dd>
              </div>
            </dl>
            <ul className="sb-results">
              {outcomes.map((o) => (
                <li key={o.id}>
                  <span className="sb-name" data-no-translate>
                    {o.name}
                  </span>
                  {o.kind === 'done' && <Chip tone="ok">Done</Chip>}
                  {o.kind === 'sent' && <Chip tone="warn">Waiting for approval</Chip>}
                  {o.kind === 'refused' && <Chip tone="crit">Refused</Chip>}
                  {o.message && <span className="sb-why">{o.message}</span>}
                </li>
              ))}
            </ul>
            {mode === 'company' && count('sent') > 0 && (
              <p className="muted small">The receiving company head, then the HR Director, approve each one under Staff movement on the HR page.</p>
            )}
            <div className="dt-dialog-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function LeftOut({ rows }: { rows: { name: string; why: string }[] }) {
  return (
    <div className="sb-leftout">
      <p className="small">
        <strong>Left out</strong>
      </p>
      <ul className="sb-results">
        {rows.slice(0, 8).map((r, i) => (
          <li key={i}>
            <span className="sb-name" data-no-translate>
              {r.name}
            </span>
            <span className="sb-why">{r.why}</span>
          </li>
        ))}
      </ul>
      {rows.length > 8 && (
        <p className="muted small">
          <span>And more:</span> <span className="num">{rows.length - 8}</span>
        </p>
      )}
    </div>
  );
}
