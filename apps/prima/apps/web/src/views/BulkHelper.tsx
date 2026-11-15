import { Select } from '../SearchSelect';
import { useMemo, useState } from 'react';
import { BULK_FILING_LABEL, RECORD_KINDS, applyImportMapping, parseCsv, suggestFiling, suggestImportMapping, type FilingKind, type RecordKind } from '@prima/core';
import { api } from '../api';
import { Chip, ErrorNotice, useAction } from '../ui';
import { readAsDataUrl } from './Proof';

/**
 * Data manager (K8 / N2, Fauzan 11 Nov 2026): suggests which field each column of a bulk file goes to and flags rows
 * that look wrong or repeated. Worked out on this screen by fixed rules; nothing is sent anywhere and nothing is saved
 * until the normal "Check the file" and "Import" steps.
 */
export function ColumnHelper({ csv, kind, onKind, onCsv }: { csv: string; kind: RecordKind; onKind: (k: RecordKind) => void; onCsv: (csv: string) => void }) {
  const [open, setOpen] = useState(false);
  const table = useMemo(() => (open && csv.trim() ? parseCsv(csv) : []), [open, csv]);
  const s = useMemo(() => (table.length ? suggestImportMapping(table, kind) : null), [table, kind]);
  const [map, setMap] = useState<(string | null)[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!open)
    return (
      <button className="btn btn-ghost btn-sm" disabled={!csv.trim()} onClick={() => setOpen(true)}>
        Suggest columns
      </button>
    );
  if (!s) return <div className="muted small">Attach the file first.</div>;
  const current = map ?? s.best.columns.map((c) => c.fieldKey);
  const fields = RECORD_KINDS[kind].fields;
  return (
    <div className="card small" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontWeight: 600 }}>Suggested columns (check each one)</div>
      {s.kinds[0] && s.kinds[0].kind !== kind && (
        <div>
          This file looks more like <strong>{s.kinds[0].label}</strong>.{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => (setMap(null), onKind(s.kinds[0].kind))}>
            Use {s.kinds[0].label}
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="small">
          <thead>
            <tr>
              <th>Column in the file</th>
              <th>Goes to</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.best.columns.map((c, i) => (
              <tr key={i}>
                <td>{c.header || `(column ${i + 1})`}</td>
                <td>
                  <Select aria-label={`Field for ${c.header}`} value={current[i] ?? ''} onChange={(e) => setMap(current.map((v, k) => (k === i ? e.target.value || null : v)))}>
                    <option value="">Leave out</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? ' (needed)' : ''}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>{map === null ? <Chip tone={c.confidence === 'sure' ? 'ok' : c.confidence === 'unsure' ? 'warn' : 'neutral'}>{c.confidence === 'sure' ? 'Sure' : c.confidence === 'unsure' ? 'Check' : 'Not placed'}</Chip> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.best.missing.length > 0 && <div className="muted">Needed and not in the file: {s.best.missing.join(', ')}.</div>}
      {s.rowFlags.length > 0 && (
        <div>
          Rows to look at:{' '}
          {s.rowFlags.slice(0, 10).map((r) => (
            <span key={r.row}>
              row {r.row} ({r.problems.join(' ')}){' '}
            </span>
          ))}
        </div>
      )}
      {err && <div className="notice" data-tone="crit">{err}</div>}
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm"
          onClick={() => {
            try {
              onCsv(applyImportMapping(table, current));
              setOpen(false);
              setMap(null);
              setErr(null);
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Use these columns
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="muted">Then press "Check the file": every row still goes through the same checks as the form.</div>
    </div>
  );
}

type Row = ReturnType<typeof suggestFiling>[number] & { data: string };

/**
 * File manager (K8 / N2): many papers at once. It suggests the person and the paper from each file name; HR checks
 * each line. Hiring papers are filed to the person's HR file under HR's own rights; any other paper is held with
 * where to place it by hand. Unsure lines are never filed without HR choosing the person.
 */
export function FileHelper({ people }: { people: { id: string; name: string; staffNo: string }[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState<Record<number, string>>({});
  const act = useAction();
  const pick = async (files: FileList | null) => {
    if (!files) return;
    const list = [...files].slice(0, 50).filter((f) => f.size <= 700_000);
    const datas = await Promise.all(list.map((f) => readAsDataUrl(f)));
    setRows(suggestFiling(list.map((f) => f.name), people).map((s, i) => ({ ...s, data: datas[i] })));
    setDone({});
  };
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch, confidence: 'sure' } : r)));
  return (
    <div className="card small" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontWeight: 600 }}>File many papers</div>
      <input type="file" multiple accept=".pdf,image/*" aria-label="Papers" onChange={(e) => void pick(e.target.files)} />
      <div className="muted">Up to 50 files of 700 KB each. Name files with the staff number and the paper (for example SS-0001 perjanjian.pdf).</div>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{r.file}</span>
          <Select aria-label="Person" value={r.personId ?? ''} onChange={(e) => set(i, { personId: e.target.value || null, personName: people.find((p) => p.id === e.target.value)?.name ?? null })}>
            <option value="">Choose the person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.staffNo} {p.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Paper" value={r.kind} onChange={(e) => { const k = e.target.value as FilingKind; set(i, { kind: k, direct: BULK_FILING_LABEL[k].direct, place: BULK_FILING_LABEL[k].place, kindLabel: BULK_FILING_LABEL[k].label }); }}>
            {(Object.keys(BULK_FILING_LABEL) as FilingKind[]).map((k) => (
              <option key={k} value={k}>
                {BULK_FILING_LABEL[k].label}
              </option>
            ))}
          </Select>
          {done[i] ? (
            <Chip tone="ok">{done[i]}</Chip>
          ) : r.direct ? (
            <button
              className="btn btn-sm"
              disabled={act.busy || !r.personId || r.confidence !== 'sure'}
              title={r.confidence !== 'sure' ? 'Check the person and the paper first' : undefined}
              onClick={() =>
                act
                  .run(() => api.uploadHiringDoc(r.personId!, r.kind as 'AGREEMENT' | 'AGREEMENT_STAMPED' | 'VETTING_CERT', [{ kind: 'document', name: r.file, data: r.data }]), 'Filed.')
                  .then((x) => x !== undefined && setDone({ ...done, [i]: 'Filed' }))
              }
            >
              File to HR papers
            </button>
          ) : (
            <span className="muted">Held: place it in {r.place}.</span>
          )}
          {r.confidence !== 'sure' && <Chip tone="warn">Check</Chip>}
        </div>
      ))}
      <ErrorNotice error={act.error} />
    </div>
  );
}
