import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type PdpaBoard, type PdpaConsentInput, type PdpaRegisterBoard, type PdpaRegisterInput } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { PlusIcon } from '@phosphor-icons/react';
import { ImportButton } from './ImportDrawer';

/**
 * Real-use PDPA registers (5 Nov 2026). The PDPA officer keeps the personal data register (what personal data the group
 * holds, why, on what basis, for how long, who sees it) and the consent register (who signed which consent, and who
 * withdrew). The Operations Director and group leaders see both and change nothing. The breach register lists every
 * breach, open or closed, kept at least 2 years.
 */

type Row = PdpaRegisterBoard['rows'][number];
type Item = Row['item'];
type Subject = Item['subjects'][number];
type Basis = Item['basis'];

const SUBJECT_LABEL: Record<Subject, string> = {
  guard: 'Guards',
  staff: 'Staff',
  applicant: 'Job applicants',
  client: 'Clients',
  visitor: 'Visitors',
  driver: 'Drivers',
  tenant: 'Tenants',
  other: 'Others',
};

const BASIS_LABEL: Record<Basis, string> = {
  CONSENT: 'Consent',
  EXPLICIT_CONSENT: 'Explicit consent (sensitive data)',
  CONTRACT: 'Needed for the job or contract',
  LEGAL_DUTY: 'Required by law',
  VITAL_INTEREST: 'To protect life or health',
  JUSTICE: 'Legal claims or court',
};

const STATE: Record<Row['state'], { label: string; tone: Tone }> = {
  incomplete: { label: 'Needs work', tone: 'crit' },
  review_due: { label: 'Review due', tone: 'warn' },
  ok: { label: 'Reviewed', tone: 'ok' },
  retired: { label: 'Retired', tone: 'neutral' },
};

const EMPTY: PdpaRegisterInput = {
  companyId: null,
  activity: '',
  system: '',
  subjects: [],
  dataKinds: '',
  sensitive: false,
  purpose: '',
  basis: 'CONTRACT',
  retentionDays: null,
  disposal: '',
  sharedWith: '',
  outsideMalaysia: '',
  ownerDept: '',
  noticeGiven: false,
  dpia: 'not_needed',
};

const toInput = (i: Item): PdpaRegisterInput => ({
  companyId: i.companyId,
  activity: i.activity,
  system: i.system,
  subjects: i.subjects,
  dataKinds: i.dataKinds,
  sensitive: i.sensitive,
  purpose: i.purpose,
  basis: i.basis,
  retentionDays: i.retentionDays,
  disposal: i.disposal,
  sharedWith: i.sharedWith,
  outsideMalaysia: i.outsideMalaysia,
  ownerDept: i.ownerDept,
  noticeGiven: i.noticeGiven,
  dpia: i.dpia,
});

export function RegisterPanel() {
  const { data, error } = useLoad(() => api.pdpaRegisterBoard(), []);
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="personal data register" />;
  const officer = data.canKeep;
  const rows = data.rows.filter((r) => showRetired || r.state !== 'retired');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Personal data register</h3>
        {officer && !adding && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon size={14} weight="bold" aria-hidden="true" />
              Add register entry
            </button>
            <ImportButton kind="pdpaRegisterItem" />
          </div>
        )}
      </div>
      <p className="muted small">
        Every kind of personal data the group keeps: why, on what basis, for how long and who sees it. Each entry is reviewed at least every{' '}
        {data.rules.reviewDays} days. An entry with something missing shows as needing work, never as fine.
      </p>
      <div className="kpis">
        <Kpi label="Entries" value={data.counts.entries} />
        <Kpi label="Needs work" value={data.counts.incomplete} tone={data.counts.incomplete ? 'crit' : 'ok'} />
        <Kpi label="Review due" value={data.counts.reviewDue} tone={data.counts.reviewDue ? 'warn' : 'ok'} />
        <Kpi label="Sensitive data" value={data.counts.sensitive} />
        <Kpi label="Live consents" value={data.counts.consents} />
      </div>
      {adding && <RegisterForm id={null} init={EMPTY} companies={data.companies} onDone={() => setAdding(false)} />}
      <label className="small">
        <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired entries
      </label>
      <div className="list">
        {rows.length === 0 && <div className="empty">No entries yet. The PDPA officer adds each kind of personal data the group keeps.</div>}
        {rows.map((r) => (
          <RegisterLine key={r.item.id} r={r} officer={officer} companies={data.companies} />
        ))}
      </div>
    </section>
  );
}

function RegisterLine({ r, officer, companies }: { r: Row; officer: boolean; companies: PdpaRegisterBoard['companies'] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction();
  const i = r.item;
  const s = STATE[r.state];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {i.activity}
            {i.sensitive ? ' · sensitive' : ''}
          </div>
          <div className="muted small">
            {r.companyName} · {i.system} · {i.subjects.map((x) => SUBJECT_LABEL[x]).join(', ')}
          </div>
          <div className="muted small">
            {BASIS_LABEL[i.basis]} · {i.retentionDays ? `kept ${i.retentionDays} days` : 'retention not set'}
            {r.needsConsent ? ` · ${r.consentsGiven} consents, ${r.consentsWithdrawn} withdrawn` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={s.tone}>{s.label}</Chip>
          <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>
      {open && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>Data: {i.dataKinds}</div>
          <div>Purpose: {i.purpose}</div>
          <div>Disposal: {i.disposal || 'not set'}</div>
          <div>Shared with: {i.sharedWith || 'nobody outside the group'}</div>
          <div>Outside Malaysia: {i.outsideMalaysia || 'no'}</div>
          <div>
            Owner: {i.ownerDept || 'not set'} · PDPA notice {i.noticeGiven ? 'given' : 'not given'} · impact assessment{' '}
            {i.dpia === 'done' ? 'done' : i.dpia === 'needed' ? 'needed' : 'not needed'}
          </div>
          <div className="muted">
            {i.reviewedOn ? `Reviewed ${dateLabel(i.reviewedOn)} by ${i.reviewedBy}` : 'Never reviewed'}
            {r.reviewDue ? ` · next review by ${dateLabel(r.reviewDue)}` : ''} · changed {dateTimeLabel(i.updatedAt)} by {i.updatedBy}
          </div>
          {i.retired && (
            <div className="muted">
              Retired {dateLabel(i.retired.on)} by {i.retired.by}: {i.retired.reason}
            </div>
          )}
          {r.problems.map((p) => (
            <div key={p} style={{ color: 'var(--crit)' }}>
              {p}
            </div>
          ))}
          {officer && r.state !== 'retired' && !editing && (
            <>
              <input className="input" aria-label="Review or retire note" placeholder="Note (needed to retire)" value={note} onChange={(e) => setNote(e.target.value)} />
              <ErrorNotice error={act.error} />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || r.problems.length > 0}
                  title={r.problems.length ? 'Fix what is missing first' : undefined}
                  onClick={() => act.run(() => api.pdpaRegisterStep(i.id, 'review', note), 'Marked reviewed.').then((x) => x && setNote(''))}
                >
                  Mark reviewed
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={act.busy || note.trim().length < 3}
                  onClick={() => act.run(() => api.pdpaRegisterStep(i.id, 'retire', note), 'Entry retired.').then((x) => x && setNote(''))}
                >
                  Retire
                </button>
              </div>
            </>
          )}
          {editing && <RegisterForm id={i.id} init={toInput(i)} companies={companies} onDone={() => setEditing(false)} />}
        </div>
      )}
    </div>
  );
}

function RegisterForm({ id, init, companies, onDone }: { id: string | null; init: PdpaRegisterInput; companies: PdpaRegisterBoard['companies']; onDone: () => void }) {
  const [f, setF] = useState<PdpaRegisterInput>(init);
  const act = useAction();
  const set = (p: Partial<PdpaRegisterInput>) => setF({ ...f, ...p });
  const toggle = (k: Subject) => set({ subjects: f.subjects.includes(k) ? f.subjects.filter((x) => x !== k) : [...f.subjects, k] });
  const ready = f.activity.trim().length >= 3 && f.system.trim() && f.dataKinds.trim() && f.purpose.trim().length >= 3 && f.subjects.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
      <Select className="select" aria-label="Company" disabled={!!id} value={f.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value || null })}>
        <option value="">PWVSB (group)</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <input className="input" aria-label="Activity" placeholder="Activity, e.g. Staff clock-in location" value={f.activity} onChange={(e) => set({ activity: e.target.value })} />
      <input className="input" aria-label="Where it is kept" placeholder="Where it is kept, e.g. Prima Clock, JA, paper file" value={f.system} onChange={(e) => set({ system: e.target.value })} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Whose data">
        {(Object.keys(SUBJECT_LABEL) as Subject[]).map((k) => (
          <label key={k} className="small">
            <input type="checkbox" checked={f.subjects.includes(k)} onChange={() => toggle(k)} /> {SUBJECT_LABEL[k]}
          </label>
        ))}
      </div>
      <textarea className="textarea" aria-label="Kinds of personal data" placeholder="Kinds of personal data, e.g. name, staff number, GPS location" value={f.dataKinds} onChange={(e) => set({ dataKinds: e.target.value })} />
      <label className="small">
        <input type="checkbox" checked={f.sensitive} onChange={(e) => set({ sensitive: e.target.checked })} /> Sensitive data (health, face or fingerprint, religion, criminal record)
      </label>
      <textarea className="textarea" aria-label="Purpose" placeholder="Purpose" value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} />
      <Select className="select" aria-label="Legal basis" value={f.basis} onChange={(e) => set({ basis: e.target.value as Basis })}>
        {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
          <option key={b} value={b}>
            {BASIS_LABEL[b]}
          </option>
        ))}
      </Select>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input
          className="input"
          type="number"
          min={1}
          aria-label="Retention in days"
          placeholder="Kept for (days)"
          value={f.retentionDays ?? ''}
          onChange={(e) => set({ retentionDays: e.target.value ? Number(e.target.value) : null })}
        />
        <input className="input" aria-label="Disposal" placeholder="How it is disposed of" value={f.disposal} onChange={(e) => set({ disposal: e.target.value })} />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" aria-label="Shared with" placeholder="Shared with (outside the group)" value={f.sharedWith} onChange={(e) => set({ sharedWith: e.target.value })} />
        <input className="input" aria-label="Outside Malaysia" placeholder="Country outside Malaysia, if any" value={f.outsideMalaysia} onChange={(e) => set({ outsideMalaysia: e.target.value })} />
        <input className="input" aria-label="Owner department" placeholder="Owner department" value={f.ownerDept} onChange={(e) => set({ ownerDept: e.target.value })} />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="small">
          <input type="checkbox" checked={f.noticeGiven} onChange={(e) => set({ noticeGiven: e.target.checked })} /> PDPA notice given to the people
        </label>
        <select className="select" aria-label="Impact assessment" value={f.dpia} onChange={(e) => set({ dpia: e.target.value as PdpaRegisterInput['dpia'] })}>
          <option value="not_needed">Impact assessment not needed</option>
          <option value="needed">Impact assessment needed</option>
          <option value="done">Impact assessment done</option>
        </select>
      </div>
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={() => act.run(() => api.savePdpaRegisterItem(id, f), 'Saved.').then((r) => r && onDone())}
        >
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ConsentsPanel() {
  const { data, error } = useLoad(() => api.pdpaRegisterBoard(), []);
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="consent register" />;
  const officer = data.role === 'officer';
  const consentItems = data.rows.filter((r) => r.needsConsent && r.state !== 'retired');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Consent register</h3>
        {officer && !adding && consentItems.length > 0 && (
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            <PlusIcon size={14} weight="bold" aria-hidden="true" />
            Record consent
          </button>
        )}
      </div>
      <p className="muted small">
        Each person's signed consent for an entry that relies on consent (face sign-in, location, dashcam), with the signed form attached. A withdrawal is
        kept on the register, never deleted. Use the staff or guard number, never the IC number.
      </p>
      {adding && <ConsentForm items={consentItems} onDone={() => setAdding(false)} />}
      <div className="list">
        {data.consents.length === 0 && <div className="empty">No consents recorded yet.</div>}
        {data.consents.map((r) => (
          <ConsentLine key={r.consent.id} r={r} officer={officer} />
        ))}
      </div>
    </section>
  );
}

function ConsentLine({ r, officer }: { r: PdpaRegisterBoard['consents'][number]; officer: boolean }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  const c = r.consent;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {c.subjectName} ({c.subjectRef})
          </div>
          <div className="muted small">
            {r.activity} · notice {c.noticeVersion} · signed {dateLabel(c.givenOn)}
          </div>
          {c.withdrawn && (
            <div className="muted small">
              Withdrawn {dateLabel(c.withdrawn.on)}: {c.withdrawn.note}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={c.withdrawn ? 'neutral' : 'ok'}>{c.withdrawn ? 'Withdrawn' : 'Consent given'}</Chip>
          {officer && !c.withdrawn && (
            <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide' : 'Withdraw'}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" type="date" aria-label="Date withdrawn" max={new Date().toLocaleDateString('en-CA')} min={c.givenOn} value={on} onChange={(e) => setOn(e.target.value)} />
          <input className="input" aria-label="How withdrawn" placeholder="How the person withdrew, and what stops now" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !on || note.trim().length < 3}
            onClick={() => act.run(() => api.withdrawPdpaConsent(c.id, on, note), 'Withdrawal recorded.').then((x) => x && setOpen(false))}
          >
            Record withdrawal
          </button>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
  );
}

function ConsentForm({ items, onDone }: { items: PdpaRegisterBoard['rows']; onDone: () => void }) {
  const [f, setF] = useState<PdpaConsentInput>({
    registerId: items[0]?.item.id ?? '',
    subjectName: '',
    subjectRef: '',
    subjectKind: items[0]?.item.subjects[0] ?? 'staff',
    noticeVersion: '',
    givenOn: '',
  });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const set = (p: Partial<PdpaConsentInput>) => setF({ ...f, ...p });
  const item = items.find((r) => r.item.id === f.registerId)?.item;
  const ready = f.registerId && f.subjectName.trim().length >= 2 && f.subjectRef.trim() && f.noticeVersion.trim() && f.givenOn && proof.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      <Select
        className="select"
        aria-label="Register entry"
        value={f.registerId}
        onChange={(e) => {
          const next = items.find((r) => r.item.id === e.target.value)?.item;
          set({ registerId: e.target.value, subjectKind: next?.subjects[0] ?? f.subjectKind });
        }}
      >
        {items.map((r) => (
          <option key={r.item.id} value={r.item.id}>
            {r.item.activity}
          </option>
        ))}
      </Select>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" aria-label="Name" placeholder="Name" value={f.subjectName} onChange={(e) => set({ subjectName: e.target.value })} />
        <input className="input" aria-label="Staff or guard number" placeholder="Staff or guard number" value={f.subjectRef} onChange={(e) => set({ subjectRef: e.target.value })} />
        <Select className="select" aria-label="Who" value={f.subjectKind} onChange={(e) => set({ subjectKind: e.target.value as Subject })}>
          {(item?.subjects ?? []).map((k) => (
            <option key={k} value={k}>
              {SUBJECT_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" aria-label="Notice version" placeholder="Notice version, e.g. v1 Oct 2026" value={f.noticeVersion} onChange={(e) => set({ noticeVersion: e.target.value })} />
        <input className="input" type="date" aria-label="Date signed" max={new Date().toLocaleDateString('en-CA')} value={f.givenOn} onChange={(e) => set({ givenOn: e.target.value })} />
      </div>
      <ProofPicker site={null} refText="PDPA consent" items={proof} onChange={setProof} documentsOnly />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          title={!proof.length ? 'Attach the signed consent form' : undefined}
          onClick={() => act.run(() => api.recordPdpaConsent(f, proof), 'Consent recorded.').then((r) => r && onDone())}
        >
          Record consent
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Every breach, open or closed, with the register details. Closed entries are kept at least the legal period. */
export function BreachRegisterPanel({ data }: { data: PdpaBoard }) {
  const rows = data.cases.filter((c) => c.kind === 'BREACH');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Breach register</h3>
        <span className="muted small">Kept at least {data.rules.keepYears} years after closing</span>
      </div>
      <p className="muted small">
        Every personal data breach, notified or not. Closed breaches stay here and cannot be removed before the keep date.
      </p>
      {data.counts.registerIncomplete > 0 && (
        <div className="notice" data-tone="warn" style={{ marginBottom: 8 }}>
          {`${data.counts.registerIncomplete} open breach${data.counts.registerIncomplete === 1 ? '' : 'es'} without the data involved or the cause.`}
        </div>
      )}
      <div className="table-wrap">
        <table className="small">
          <thead>
            <tr>
              <th>Found</th>
              <th>Company</th>
              <th>What happened</th>
              <th>Data involved</th>
              <th>People</th>
              <th>Cause</th>
              <th>Commissioner told</th>
              <th>People told</th>
              <th>Action taken</th>
              <th>Status</th>
              <th>Keep until</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="muted">
                  No breaches recorded.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{dateTimeLabel(c.breach!.detectedAt)}</td>
                <td>{c.companyName}</td>
                <td>{c.title}</td>
                <td>{c.breach!.dataKinds || <span style={{ color: 'var(--crit)' }}>Not recorded</span>}</td>
                <td>{c.breach!.affected}</td>
                <td>{c.breach!.cause || <span style={{ color: 'var(--crit)' }}>Not recorded</span>}</td>
                <td>{c.breach!.commissionerAt ? dateTimeLabel(c.breach!.commissionerAt) : c.clock?.commissionerLate ? 'Late, not told' : 'Not yet'}</td>
                <td>{c.breach!.subjectsAt ? dateTimeLabel(c.breach!.subjectsAt) : c.breach!.significantHarm ? 'Not yet' : 'Not needed'}</td>
                <td>{c.breach!.remedy || '-'}</td>
                <td>{c.status === 'closed' ? 'Closed' : 'Open'}</td>
                <td>{c.keepUntil ? dateLabel(c.keepUntil) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
