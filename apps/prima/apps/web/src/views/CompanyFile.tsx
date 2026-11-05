import { useState } from 'react';
import { api, type CompanyFileInput, type CompanyFiles } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * Company file (Central Admin 5B, Fauzan 2 Nov 2026). One corporate record per company: directors, shareholders,
 * beneficial owners, constitution and key papers. The company record (name, SSM number, addresses) is keyed once in the
 * company form and shown here. The Head of Company or Central Admin drafts; the Deputy Chief of Staff checks it against
 * the SSM extract and never checks their own draft. The app lodges nothing with SSM.
 */

type File = CompanyFiles[number];
const STATUS: Record<File['status'], ['ok' | 'warn' | 'info' | 'crit' | 'neutral', string]> = {
  none: ['neutral', 'Not yet keyed in'],
  draft: ['info', 'Draft, waiting for the SSM check'],
  checked: ['ok', 'Checked against SSM'],
  mismatch: ['crit', 'Differs from SSM'],
};

export function CompanyFilePanel() {
  const { data, error, reload } = useLoad(() => api.companyFiles(), []);
  const [open, setOpen] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="company files" />;
  const rank = (f: File) => (f.boLate.length || f.status === 'mismatch' ? 0 : f.can.check || f.stale.length || f.boDue.length ? 1 : 2);
  const rows = [...data].sort((a, b) => rank(a) - rank(b) || a.companyName.localeCompare(b.companyName));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Company files</h3>
      </div>
      <p className="muted small">
        The company secretary lodges with SSM; this file keeps the record. A file sent back by the Deputy Chief of Staff shows the differences: fix them and
        resubmit for the check.
      </p>
      <div className="list">
        {rows.map((f) => (
          <div className="item" key={f.profile.companyId}>
            <div className="item-main">
              <strong>{f.companyName}</strong>
              <div className="muted small">
                {f.regNo} · {f.profile.directors.length} directors · {(f.profile.shareholders ?? []).length} shareholders ·{' '}
                {(f.profile.beneficialOwners ?? []).length} beneficial owners
                {f.profile.file ? ` · saved by ${f.profile.file.draftBy}` : ''}
                {f.profile.file?.checkedBy ? ` · checked by ${f.profile.file.checkedBy} (${f.profile.file.ssmRef})` : ''}
              </div>
              {f.regNoMismatch && <p className="error small">The SSM number here differs from the company record.</p>}
              {f.boLate.map((b) => (
                <p key={b.name} className="error small">
                  {b.name}: SSM not notified, was due {dateLabel(b.dueOn)} (directors' legal flag)
                </p>
              ))}
              {f.boDue.map((b) => (
                <p key={b.name} className="small">
                  {b.name}: notify SSM by {dateLabel(b.dueOn)}
                </p>
              ))}
              {f.stale.map((s) => (
                <p key={s.id} className="small">
                  Update the file after: {s.title} (effective {dateLabel(s.effectiveOn)})
                </p>
              ))}
              {f.status === 'mismatch' && (
                <p className="small">
                  Sent back by {f.profile.file?.checkedBy}: {(f.profile.file?.mismatches ?? []).join('; ')}
                  {f.profile.file?.note ? ` (${f.profile.file.note})` : ''}. {f.can.edit ? 'Open, fix and resubmit for the check.' : ''}
                </p>
              )}
              {(f.profile.file?.history ?? []).length > 0 && (
                <details className="small">
                  <summary>Earlier checks ({(f.profile.file?.history ?? []).length})</summary>
                  <ul>
                    {(f.profile.file?.history ?? []).map((h, i) => (
                      <li key={i}>
                        {h.at.slice(0, 16).replace('T', ' ')} · {h.by} · {h.status === 'mismatch' ? `sent back: ${h.mismatches.join('; ')}` : 'checked'} ·{' '}
                        {h.ssmRef}
                        {h.note ? ` · ${h.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <button className="btn btn-sm" onClick={() => setOpen(open === f.profile.companyId ? '' : f.profile.companyId)}>
                {open === f.profile.companyId ? 'Close' : f.can.edit ? (f.status === 'mismatch' ? 'Fix and resubmit' : 'Open and edit') : 'Open'}
              </button>
              {open === f.profile.companyId && <FileDetail f={f} onDone={reload} />}
            </div>
            <Chip tone={STATUS[f.status][0]}>{STATUS[f.status][1]}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

type Line = Record<string, string>;
const toLines = <T extends object>(xs: T[] | undefined): Line[] =>
  (xs ?? []).map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v == null ? '' : String(v)])));

function Rows({
  title,
  cols,
  lines,
  setLines,
  edit,
}: {
  title: string;
  cols: [string, string, string?][];
  lines: Line[];
  setLines: (l: Line[]) => void;
  edit: boolean;
}) {
  const set = (i: number, k: string, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div>
      <h4>{title}</h4>
      {!lines.length && <p className="muted small">None on file.</p>}
      {lines.map((l, i) => (
        <div className="row" key={i}>
          {cols.map(([k, label, type]) =>
            edit ? (
              <input key={k} aria-label={label} placeholder={label} type={type ?? 'text'} value={l[k] ?? ''} onChange={(e) => set(i, k, e.target.value)} />
            ) : (
              <span key={k} className="small">
                {l[k] || '—'}
              </span>
            ),
          )}
          {edit && (
            <button className="btn btn-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {edit && (
        <button className="btn btn-sm" onClick={() => setLines([...lines, {}])}>
          Add
        </button>
      )}
    </div>
  );
}

function FileDetail({ f, onDone }: { f: File; onDone: () => void }) {
  const p = f.profile;
  const act = useAction();
  const edit = f.can.edit;
  const [directors, setDirectors] = useState(toLines(p.directors));
  const [holders, setHolders] = useState(toLines(p.shareholders));
  const [owners, setOwners] = useState(toLines(p.beneficialOwners));
  const [papers, setPapers] = useState(toLines(p.papers));
  const [constRef, setConstRef] = useState(p.constitution?.ref ?? '');
  const [constOn, setConstOn] = useState(p.constitution?.on ?? '');
  const [ssmRef, setSsmRef] = useState('');
  const [note, setNote] = useState('');
  const [diffs, setDiffs] = useState('');
  const save = () => {
    const input: CompanyFileInput = {
      directors: directors.map((d) => ({
        name: d.name ?? '',
        appointedOn: d.appointedOn ?? '',
      })),
      shareholders: holders.map((h) => ({
        name: h.name ?? '',
        kind: h.kind === 'company' ? 'company' : 'individual',
        shares: Number(h.shares),
        since: h.since || null,
      })),
      beneficialOwners: owners.map((o) => ({
        name: o.name ?? '',
        basis: o.basis ?? '',
        since: o.since ?? '',
        ssmNotifiedOn: o.ssmNotifiedOn || null,
      })),
      papers: papers.map((x) => ({
        name: x.name ?? '',
        ref: x.ref ?? '',
        on: x.on || null,
      })),
      constitution: constRef ? { adopted: true, ref: constRef, on: constOn || null } : null,
    };
    return act.run(
      () => api.saveCompanyFile(p.companyId, input).then(onDone),
      f.status === 'mismatch' ? 'Corrected and resubmitted for the SSM check.' : 'Saved as a draft for the SSM check.',
    );
  };
  const check = (ok: boolean) =>
    act.run(
      () =>
        api
          .checkCompanyFile(p.companyId, {
            ok,
            ssmRef,
            note,
            mismatches: diffs
              .split('\n')
              .map((d) => d.trim())
              .filter(Boolean),
          })
          .then(onDone),
      ok ? 'Confirmed against SSM.' : 'Sent back with the differences.',
    );
  return (
    <div className="panel">
      <p className="muted small">
        Secretary: {p.secretaryFirm} ({p.secretaryLicence}) · Auditor: {p.auditor} · Incorporated {dateLabel(p.incorporatedOn)} · Year end month {p.fyeMonth}
        {f.companyVerified ? ' · company record checked' : ' · company record still a draft'}
      </p>
      <Rows
        title="Directors"
        edit={edit}
        lines={directors}
        setLines={setDirectors}
        cols={[
          ['name', 'Name'],
          ['appointedOn', 'Appointed', 'date'],
        ]}
      />
      <Rows
        title="Shareholders"
        edit={edit}
        lines={holders}
        setLines={setHolders}
        cols={[
          ['name', 'Name'],
          ['kind', 'individual or company'],
          ['shares', 'Shares', 'number'],
          ['since', 'Since', 'date'],
        ]}
      />
      <Rows
        title="Beneficial owners"
        edit={edit}
        lines={owners}
        setLines={setOwners}
        cols={[
          ['name', 'Name'],
          ['basis', 'How they own or control'],
          ['since', 'Since', 'date'],
          ['ssmNotifiedOn', 'SSM notified on', 'date'],
        ]}
      />
      <h4>Constitution</h4>
      {edit ? (
        <div className="row">
          <input
            aria-label="Constitution reference"
            placeholder="Constitution reference (blank if none)"
            value={constRef}
            onChange={(e) => setConstRef(e.target.value)}
          />
          <input aria-label="Adopted on" type="date" value={constOn} onChange={(e) => setConstOn(e.target.value)} />
        </div>
      ) : (
        <p className="small">
          {p.constitution ? `${p.constitution.ref}${p.constitution.on ? `, adopted ${dateLabel(p.constitution.on)}` : ''}` : 'No constitution on file'}
        </p>
      )}
      <Rows
        title="Key papers"
        edit={edit}
        lines={papers}
        setLines={setPapers}
        cols={[
          ['name', 'Paper'],
          ['ref', 'Reference'],
          ['on', 'Dated', 'date'],
        ]}
      />
      {act.error && <p className="error small">{act.error.message}</p>}
      {edit && (
        <button className="btn btn-sm" disabled={act.busy} onClick={save}>
          {f.status === 'mismatch' ? 'Resubmit for the SSM check' : 'Save as draft'}
        </button>
      )}
      {f.can.check && (
        <div>
          <h4>Check against SSM</h4>
          <div className="row">
            <input
              aria-label="SSM extract reference"
              placeholder="SSM extract or profile reference"
              value={ssmRef}
              onChange={(e) => setSsmRef(e.target.value)}
            />
            <input aria-label="Reason" placeholder="Reason (needed to confirm)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <textarea aria-label="Differences" placeholder="Differences from SSM, one per line" value={diffs} onChange={(e) => setDiffs(e.target.value)} />
          <div className="row">
            <button className="btn btn-sm" disabled={act.busy} onClick={() => check(true)}>
              Matches SSM
            </button>
            <button className="btn btn-sm" disabled={act.busy} onClick={() => check(false)}>
              Send back with differences
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
