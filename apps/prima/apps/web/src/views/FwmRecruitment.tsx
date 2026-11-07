import { useState } from 'react';
import { FW_CONTRACT_LANGUAGE_LABEL, FW_RECRUIT_STEP_LABEL, type FwContractLanguage, type FwRecruitStep, type ProofInput } from '@prima/core';
import { api, type FwmRecruitment } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';

/**
 * Foreign worker recruitment steps (Fauzan, 6 Nov 2026, IWAY answer 7). FWM records, for each worker being recruited,
 * the agency's licence, the embassy's confirmation, the interview, the age from the passport (18 to 60) and the
 * contract signed in English and Malay before travel. The FWM Manager or Deputy clears the worker to travel; on arrival
 * the file links to the staff record and the arrival fee check confirms zero recruitment fees.
 */

type Row = FwmRecruitment['files'][number];
type Status = Row['file']['status'];

const LANGS: FwContractLanguage[] = ['en', 'ms', 'ne', 'bn', 'my', 'id', 'other'];

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  open: { label: 'In progress', tone: 'warn' },
  cleared: { label: 'Cleared to travel', tone: 'ok' },
  arrived: { label: 'Arrived', tone: 'ok' },
  stopped: { label: 'Stopped', tone: 'neutral' },
};

const ZERO_FEE: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: 'Zero fee: not asked yet', tone: 'unknown' },
  asked: { label: 'Zero fee: asked', tone: 'ok' },
  confirmed: { label: 'Zero fee confirmed', tone: 'ok' },
  fee_open: { label: 'Fee found, follow-up open', tone: 'crit' },
  fee_closed: { label: 'Fee found, follow-up closed', tone: 'warn' },
};

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function FwmRecruitmentPanel() {
  const { data, error } = useLoad(() => api.fwmRecruitment(), []);
  const [show, setShow] = useState<'active' | 'all'>('active');
  const [opening, setOpening] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="recruitment files" />;
  const rows = show === 'active' ? data.files.filter((r) => r.file.status === 'open' || r.file.status === 'cleared' || (r.file.status === 'arrived' && !r.complete)) : data.files;
  return (
    <>
      <div className="kpis">
        <Kpi label="In progress" value={data.counts.inProgress} note={`${data.counts.readyToClear} ready to clear`} />
        <Kpi label="Cleared to travel" value={data.counts.cleared} />
        <Kpi label="Arrived, fee not asked" value={data.counts.waitingFeeCheck} tone={data.counts.waitingFeeCheck ? 'unknown' : 'ok'} note="Unknown, not green" />
        {data.counts.feesFound !== null && <Kpi label="Fees found" value={data.counts.feesFound} tone={data.counts.feesFound ? 'crit' : 'ok'} />}
        <Kpi label="All steps done" value={data.counts.complete} tone="ok" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Recruitment steps</h2>
          <div className="row" style={{ gap: 6 }}>
            <select className="select" aria-label="Show files" value={show} onChange={(e) => setShow(e.target.value as 'active' | 'all')}>
              <option value="active">Files still in progress</option>
              <option value="all">All files</option>
            </select>
            {data.canOpen && !opening && (
              <button className="btn btn-primary btn-sm" onClick={() => setOpening(true)}>
                New recruitment file
              </button>
            )}
          </div>
        </div>
        {!data.confidential && (
          <p className="muted small" style={{ padding: '0 12px' }}>
            You see which steps are done for your company's recruits. Notes, the passport's date of birth and the worker's fee answer stay with FWM and the group leaders.
          </p>
        )}
        {opening && <OpenForm companies={data.companies} onDone={() => setOpening(false)} />}
        <div className="list">
          {rows.length === 0 && <div className="empty">{data.files.length ? 'Nothing in progress.' : 'No recruitment file yet.'}</div>}
          {rows.map((r) => (
            <FileRow key={r.file.id} r={r} confidential={data.confidential} />
          ))}
        </div>
        <p className="muted small" style={{ padding: '8px 12px' }}>
          {data.rules.steps.source} {data.rules.languages.source}
        </p>
      </section>
    </>
  );
}

function OpenForm({ companies, onDone }: { companies: { id: string; name: string }[]; onDone: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [candidateName, setName] = useState('');
  const [passportLast4, setLast4] = useState('');
  const [country, setCountry] = useState('NP');
  const [agency, setAgency] = useState('');
  const [plannedTravelOn, setTravel] = useState('');
  const act = useAction();
  const ready = !!companyId && candidateName.trim().length >= 3 && passportLast4.replace(/[^A-Za-z0-9]/g, '').length === 4 && /^[A-Za-z]{2}$/.test(country) && agency.trim().length >= 2;
  return (
    <div className="panel" style={{ margin: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select className="select" aria-label="Permit company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
        <option value="">Company that will hold the permit</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Worker's name" placeholder="Worker's name as on the passport" value={candidateName} onChange={(e) => setName(e.target.value)} />
      <div className="grid-2">
        <input className="input" aria-label="Passport last 4" placeholder="Passport: last 4 characters only" maxLength={4} value={passportLast4} onChange={(e) => setLast4(e.target.value)} />
        <input className="input" aria-label="Country" placeholder="Country code (NP = Nepal)" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
      </div>
      <input className="input" aria-label="Recruiting agency" placeholder="Recruiting agency" value={agency} onChange={(e) => setAgency(e.target.value)} />
      <label className="field">
        <span className="label">Planned travel date (can be set later)</span>
        <input className="input" type="date" aria-label="Planned travel date" value={plannedTravelOn} onChange={(e) => setTravel(e.target.value)} />
      </label>
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={async () => {
            const ok = await act.run(() => api.openFwRecruitFile({ companyId, candidateName, passportLast4, country, agency, plannedTravelOn: plannedTravelOn || null }), 'Recruitment file opened.');
            if (ok) onDone();
          }}
        >
          Open file
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function stepDetail(s: Row['steps'][number]): string {
  const r = s.record;
  if (!r) return 'Not recorded';
  const when = `${dateLabel(r.on)} by ${r.by}`;
  if (s.step === 'AGENCY_LICENCE') return `${r.licenceNo ? `Licence ${r.licenceNo}, ` : ''}valid to ${r.licenceExpiresOn ? dateLabel(r.licenceExpiresOn) : '?'} · ${when}`;
  if (s.step === 'EMBASSY') return `${r.reference ? `Ref ${r.reference} · ` : ''}${when}`;
  if (s.step === 'INTERVIEW') return `${r.passed ? 'Passed' : 'Not passed'}, interviewed by ${r.interviewer ?? '?'} · ${when}`;
  if (s.step === 'AGE') return `${r.passed ? 'Within 18 to 60' : 'Outside 18 to 60'}${r.age != null ? ` (age ${r.age})` : ''} · ${when}`;
  return `Signed in ${(r.languages ?? []).map((l) => FW_CONTRACT_LANGUAGE_LABEL[l]).join(', ')} · ${when}`;
}

function FileRow({ r, confidential }: { r: Row; confidential: boolean }) {
  const f = r.file;
  const [mode, setMode] = useState<FwRecruitStep | 'clear' | 'arrive' | 'stop' | 'travel' | null>(null);
  const [papers, setPapers] = useState(false);
  const docs = useLoad(() => (papers ? api.fwmDocs(f.id) : Promise.resolve([])), [f.id, papers]);
  const st = STATUS[f.status];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{f.candidateName}</div>
          <div className="muted small">
            Passport …{f.passportLast4} · {f.country} · {r.companyName} · agency {f.agency}
          </div>
          <div className="small">
            Travel: {f.plannedTravelOn ? dateLabel(f.plannedTravelOn) : 'not set'}
            {f.clearedBy ? ` · cleared by ${f.clearedBy}` : ''}
            {f.arrivedOn ? ` · arrived ${dateLabel(f.arrivedOn)}` : ''}
            {r.person ? ` · staff ${r.person.staffNo}` : ''}
          </div>
          {f.status === 'stopped' && f.stopReason && <div className="small">Stopped: {f.stopReason}</div>}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Chip tone={st.tone}>{st.label}</Chip>
          {r.zeroFee && <Chip tone={ZERO_FEE[r.zeroFee].tone}>{ZERO_FEE[r.zeroFee].label}</Chip>}
        </div>
      </div>
      <div className="list" style={{ gap: 2 }}>
        {r.steps.map((s) => (
          <div key={s.step} className="row small" style={{ justifyContent: 'space-between', gap: 6 }}>
            <span>
              <strong>{s.label}</strong>: {stepDetail(s)}
              {confidential && s.record?.note ? <span className="muted"> · {s.record.note}</span> : null}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Chip tone={!s.record ? 'unknown' : s.record.passed ? 'ok' : 'crit'}>{!s.record ? 'To do' : s.record.passed ? 'Done' : 'Failed'}</Chip>
              {r.canRecord && (
                <button className="btn btn-sm" onClick={() => setMode(s.step)}>
                  {s.record ? 'Record again' : 'Record'}
                </button>
              )}
            </span>
          </div>
        ))}
        <div className="row small" style={{ justifyContent: 'space-between', gap: 6 }}>
          <span>
            <strong>Zero recruitment fees (on arrival)</strong>:{' '}
            {f.status !== 'arrived' ? 'asked privately after arrival, in the Recruitment and welfare tab' : r.zeroFee === 'waiting' ? 'record the arrival fee check in the Recruitment and welfare tab' : 'see the arrival fee check'}
          </span>
        </div>
      </div>
      {r.missing.length > 0 && f.status === 'open' && <div className="muted small">Before travel: {r.missing.join('; ')}.</div>}
      {confidential && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" aria-expanded={papers} onClick={() => setPapers(!papers)}>
            {papers ? 'Hide papers' : 'Papers'}
          </button>
          {r.canRecord && !mode && (
            <button className="btn btn-sm" onClick={() => setMode('travel')}>
              {f.plannedTravelOn ? 'Change travel date' : 'Set travel date'}
            </button>
          )}
          {r.canClear && !mode && (
            <button className="btn btn-primary btn-sm" onClick={() => setMode('clear')}>
              Clear to travel
            </button>
          )}
          {r.canArrive && !mode && (
            <button className="btn btn-primary btn-sm" onClick={() => setMode('arrive')}>
              Record arrival
            </button>
          )}
          {r.canStop && !mode && (
            <button className="btn btn-sm" onClick={() => setMode('stop')}>
              Stop
            </button>
          )}
        </div>
      )}
      {papers && docs.data && (docs.data.length ? <DocList docs={docs.data} /> : <div className="muted small">No papers attached.</div>)}
      {mode && mode !== 'clear' && mode !== 'arrive' && mode !== 'stop' && mode !== 'travel' && <StepForm r={r} step={mode} onDone={() => setMode(null)} />}
      {mode === 'clear' || mode === 'arrive' || mode === 'stop' || mode === 'travel' ? <FileAction r={r} kind={mode} onDone={() => setMode(null)} /> : null}
    </div>
  );
}

function StepForm({ r, step, onDone }: { r: Row; step: FwRecruitStep; onDone: () => void }) {
  const again = !!r.steps.find((s) => s.step === step)?.record;
  const [on, setOn] = useState(today());
  const [licenceNo, setLicenceNo] = useState('');
  const [licenceExpiresOn, setExpiry] = useState('');
  const [reference, setReference] = useState('');
  const [interviewer, setInterviewer] = useState('');
  const [passed, setPassed] = useState<'' | 'yes' | 'no'>('');
  const [dob, setDob] = useState('');
  const [languages, setLanguages] = useState<FwContractLanguage[]>(['en', 'ms']);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const paper = step !== 'INTERVIEW';
  const ready =
    (!again || reason.trim().length >= 5) &&
    (!paper || proof.length > 0) &&
    (step === 'AGENCY_LICENCE'
      ? licenceNo.trim().length >= 3 && !!licenceExpiresOn
      : step === 'EMBASSY'
        ? reference.trim().length >= 3
        : step === 'INTERVIEW'
          ? interviewer.trim().length >= 3 && !!passed && (passed === 'yes' || note.trim().length >= 5)
          : step === 'AGE'
            ? !!dob
            : languages.includes('en') && languages.includes('ms'));
  const hint: Record<FwRecruitStep, string> = {
    AGENCY_LICENCE: 'Check the agency\'s licence is valid until the worker travels. Attach a copy.',
    EMBASSY: 'The embassy\'s confirmation for this worker. Attach the letter or approval.',
    INTERVIEW: 'Who interviewed the worker and the result. A worker who does not pass stops the file.',
    AGE: 'Type the date of birth exactly as printed on the passport and attach that page. The age is counted to the planned travel date and must be 18 to 60.',
    CONTRACT: 'English and Malay are a must; add the worker\'s mother tongue if used. Signed before travel. Attach the signed contract.',
  };
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>{FW_RECRUIT_STEP_LABEL[step]}</div>
      <div className="muted small">{hint[step]}</div>
      <label className="field">
        <span className="label">{step === 'CONTRACT' ? 'Date signed' : step === 'AGE' ? 'Date the passport was checked' : 'Date'}</span>
        <input className="input" type="date" aria-label="Date of the step" value={on} onChange={(e) => setOn(e.target.value)} />
      </label>
      {step === 'AGENCY_LICENCE' && (
        <div className="grid-2">
          <input className="input" aria-label="Licence number" placeholder="Licence number" value={licenceNo} onChange={(e) => setLicenceNo(e.target.value)} />
          <label className="field">
            <span className="label">Licence valid until</span>
            <input className="input" type="date" aria-label="Licence valid until" value={licenceExpiresOn} onChange={(e) => setExpiry(e.target.value)} />
          </label>
        </div>
      )}
      {step === 'EMBASSY' && <input className="input" aria-label="Embassy reference" placeholder="Reference on the embassy's confirmation" value={reference} onChange={(e) => setReference(e.target.value)} />}
      {step === 'INTERVIEW' && (
        <div className="grid-2">
          <input className="input" aria-label="Interviewer" placeholder="Interviewed by" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
          <select className="select" aria-label="Interview result" value={passed} onChange={(e) => setPassed(e.target.value as '' | 'yes' | 'no')}>
            <option value="">Result</option>
            <option value="yes">Passed</option>
            <option value="no">Not passed</option>
          </select>
        </div>
      )}
      {step === 'AGE' && (
        <label className="field">
          <span className="label">Date of birth on the passport</span>
          <input className="input" type="date" aria-label="Date of birth on the passport" value={dob} onChange={(e) => setDob(e.target.value)} />
        </label>
      )}
      {step === 'CONTRACT' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {LANGS.map((l) => (
            <label key={l} className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={languages.includes(l)} onChange={(e) => setLanguages(e.target.checked ? [...languages, l] : languages.filter((x) => x !== l))} />
              {FW_CONTRACT_LANGUAGE_LABEL[l]}
            </label>
          ))}
        </div>
      )}
      <input className="input" aria-label="Step note" placeholder={step === 'INTERVIEW' && passed === 'no' ? 'Why the worker did not pass (needed)' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} />
      {again && <input className="input" aria-label="Why recorded again" placeholder="Why this step is recorded again (needed)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required={paper} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={async () => {
            const ok = await act.run(
              () =>
                api.recordFwRecruitStep(
                  r.file.id,
                  step,
                  {
                    on,
                    ...(step === 'AGENCY_LICENCE' ? { licenceNo, licenceExpiresOn } : {}),
                    ...(step === 'EMBASSY' ? { reference } : {}),
                    ...(step === 'INTERVIEW' ? { interviewer, passed: passed === 'yes' } : {}),
                    ...(step === 'AGE' ? { dob } : {}),
                    ...(step === 'CONTRACT' ? { languages } : {}),
                    note,
                    reason,
                  },
                  proof,
                ),
              `${FW_RECRUIT_STEP_LABEL[step]} recorded.`,
            );
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FileAction({ r, kind, onDone }: { r: Row; kind: 'clear' | 'arrive' | 'stop' | 'travel'; onDone: () => void }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(kind === 'arrive' ? today() : r.file.plannedTravelOn ?? '');
  const [staffNo, setStaffNo] = useState('');
  const act = useAction();
  const ready =
    kind === 'clear' ? true : kind === 'stop' ? text.trim().length >= 5 : kind === 'arrive' ? !!date && staffNo.trim().length > 0 : !!date && (!r.file.plannedTravelOn || text.trim().length >= 5);
  const label = { clear: 'Clear to travel', arrive: 'Record arrival', stop: 'Stop this recruitment', travel: 'Save travel date' }[kind];
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {kind === 'clear' && <div className="muted small">All five steps are on record and fit the travel date. Clearing lets the worker travel.</div>}
      {(kind === 'arrive' || kind === 'travel') && (
        <label className="field">
          <span className="label">{kind === 'arrive' ? 'Arrival date' : 'Planned travel date'}</span>
          <input className="input" type="date" aria-label={kind === 'arrive' ? 'Arrival date' : 'Planned travel date'} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      {kind === 'arrive' && <input className="input" aria-label="Staff number" placeholder="Worker's staff number in the permit company" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} />}
      <input
        className="input"
        aria-label={kind === 'stop' ? 'Why it stops' : 'Note'}
        placeholder={kind === 'stop' ? 'Why the recruitment is not going ahead (needed)' : kind === 'travel' && r.file.plannedTravelOn ? 'Why the date changed (needed)' : 'Note'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={async () => {
            const id = r.file.id;
            const ok = await act.run(
              () =>
                kind === 'clear'
                  ? api.clearFwRecruitFile(id, { note: text })
                  : kind === 'arrive'
                    ? api.recordFwRecruitArrival(id, { arrivedOn: date, staffNo: staffNo.trim() })
                    : kind === 'stop'
                      ? api.stopFwRecruitFile(id, { reason: text })
                      : api.setFwRecruitTravel(id, { plannedTravelOn: date, reason: text }),
              `${label}: done.`,
            );
            if (ok) onDone();
          }}
        >
          {label}
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
