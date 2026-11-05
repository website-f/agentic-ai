import { useRef, useState } from 'react';
import type { ItImportKind, ItImportPreview } from '@prima/core';
import { api } from '../api';
import { Chip, ErrorNotice, useAction } from '../ui';
import { Card, Steps } from '../kit';

/**
 * The CEO's batch import of open IT work (Fauzan, 31 Oct 2026, task T9): give the rows, review the preview, approve the
 * batch once. New items only. Rows with errors and repeats are left out and listed; nothing already in Prima changes.
 */
const HEADINGS: Record<ItImportKind, string> = {
  tickets: 'Title, Requester, Channel (Teams, email, phone, in person), Urgency (P1, P2, P3), and optionally About, Date raised, Detail, IT person',
  jobs: 'Title, Doer, Due date, Urgency (P1, P2, P3), and optionally Kind, Technical (yes or no), Detail',
};

function newBatchId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `b-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ItImport() {
  const look = useAction();
  const act = useAction();
  const [kind, setKind] = useState<ItImportKind>('tickets');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<(ItImportPreview & { batchId: string }) | null>(null);
  const [skip, setSkip] = useState<number[]>([]);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<{ created: string[]; skipped: { row: number; why: string }[]; already: boolean } | null>(null);

  // Each change to the input starts a new round; a preview or file read that finishes after a later change is dropped.
  const round = useRef(0);
  const lastReader = useRef<FileReader | null>(null);
  // Set the instant a step starts, before the screen shows it, so a click that lands in between is still refused.
  const pending = useRef({ preview: false, reading: false, approve: false });
  // Any change to the input drops the preview, so what is approved is always what was previewed.
  const reset = () => {
    round.current++;
    setPreview(null);
    setSkip([]);
    setResult(null);
  };
  const readFile = (f: File | undefined) => {
    if (!f || pending.current.approve) return;
    reset();
    const mine = round.current;
    const r = new FileReader();
    lastReader.current = r;
    pending.current.reading = true;
    setReading(true);
    // Only the latest file read ends the loading state; an older one finishing late leaves it on.
    r.onloadend = () => {
      if (lastReader.current !== r) return;
      pending.current.reading = false;
      setReading(false);
    };
    r.onload = () => {
      if (mine !== round.current) return;
      setText(String(r.result ?? ''));
      setSource((s) => (s.trim() ? s : f.name));
      round.current++;
    };
    r.readAsText(f);
  };
  const doPreview = () => {
    if (pending.current.approve || pending.current.reading || pending.current.preview) return;
    pending.current.preview = true;
    const mine = round.current;
    void look
      .run(() => api.itAct('importPreview', { kind, text, source }) as Promise<ItImportPreview>)
      .finally(() => (pending.current.preview = false))
      .then((p) => {
        if (!p || mine !== round.current) return;
        // Previewing the same rows again keeps the batch and the rows left out, so a retry returns the first receipt.
        setPreview((old) => (old && old.previewToken === p.previewToken ? old : { ...p, batchId: newBatchId() }));
        setSkip((s) => s.filter((n) => p.rows.some((r) => r.row === n && !r.errors.length && !r.duplicateOf)));
        setResult(null);
      });
  };
  // While approving, nothing on the screen can change; while a preview or file is still loading, nothing can be approved.
  const locked = act.busy;
  const loading = look.busy || reading;
  const blocked = !preview || preview.missingColumns.length > 0 || preview.problems.length > 0;
  const going = preview && !blocked ? preview.rows.filter((r) => !r.errors.length && !r.duplicateOf && !skip.includes(r.row)).length : 0;
  const approve = () => {
    if (pending.current.preview || pending.current.reading || pending.current.approve) return;
    pending.current.approve = true;
    // Starting an approval ends the round: any preview or file read still pending can no longer change the screen.
    round.current++;
    void act
      .run(
        () => api.itAct('importApprove', { kind, text, source, batchId: preview!.batchId, previewToken: preview!.previewToken, skipRows: skip }) as Promise<NonNullable<typeof result>>,
        (r) => (r.already ? 'This batch was already imported.' : `Imported ${r.created.length}.`),
      )
      .finally(() => (pending.current.approve = false))
      .then((r) => r && setResult(r));
  };
  /** An edit to the input, refused while an approval runs. */
  const edit = (change: () => void) => {
    if (pending.current.approve) return;
    change();
    reset();
  };

  const stage = result ? 3 : preview ? 2 : text.trim() ? 1 : 0;
  return (
    <Card
      title="Import open IT work"
      sub="New items only. Nothing already in Prima changes."
      footer={
        preview && !result ? (
          <>
            <span className="muted small ix-foot-note">{preview.rows.length - going} left out</span>
            <button className="btn btn-primary" disabled={act.busy || loading || going === 0 || blocked} onClick={approve}>
              Approve and add {going}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="ix-stack">
        <Steps
          steps={[
            { label: 'Give the rows', state: stage > 0 ? 'done' : 'now', note: 'Paste or choose a CSV' },
            { label: 'Check the preview', state: stage > 1 ? 'done' : stage === 1 ? 'now' : 'todo' },
            { label: 'Approve the batch once', state: stage > 2 ? 'done' : stage === 2 ? 'now' : 'todo' },
          ]}
        />
        <p className="ix-meta">
          Paste rows copied from Excel with their heading row, or choose a CSV file. Check the preview, then approve the batch once. Only new items are
          added; rows with errors or repeats are left out. If anything changes after the preview, approving stops and asks you to preview again. Use dummy rows until real data is approved.
        </p>
        <div className="ix-fields">
          <label className="field">
            <span className="label">What to import</span>
            <select
              className="select"
              disabled={locked}
              aria-label="What to import"
              value={kind}
              onChange={(e) => edit(() => setKind(e.target.value as ItImportKind))}
            >
              <option value="tickets">Open help requests</option>
              <option value="jobs">Open IT jobs</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Where the rows come from</span>
            <input
              className="input"
              disabled={locked}
              aria-label="Where the rows come from"
              placeholder="Where from: file name, email subject and date, or SharePoint link"
              value={source}
              onChange={(e) => edit(() => setSource(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="label">CSV file</span>
            <input className="input" type="file" disabled={locked} accept=".csv,text/csv,text/plain" aria-label="CSV file" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
        </div>
        <label className="field">
          <span className="label">Rows</span>
          <textarea
            className="textarea"
            disabled={locked}
            aria-label="Rows"
            rows={8}
            placeholder="Paste the rows here, heading row first"
            value={text}
            onChange={(e) => edit(() => setText(e.target.value))}
          />
          <span className="muted small">Columns: {HEADINGS[kind]}.</span>
        </label>
        <div className="ix-actions">
          <button className="btn" disabled={loading || locked || !text.trim() || source.trim().length < 3} onClick={doPreview}>
            Preview
          </button>
        </div>
        <ErrorNotice error={look.error} />
        {preview && !result && (
          <>
            <p className="ix-meta">
              Columns read:{' '}
              {Object.entries(preview.mapping)
                .map(([f, h]) => `${h} → ${f}`)
                .join(', ') || 'none'}
              .
            </p>
            {preview.problems.map((p) => (
              <p key={p} className="notice" data-tone="crit">
                {p} Fix it in the sheet and preview again.
              </p>
            ))}
            {preview.missingColumns.length > 0 && (
              <p className="notice" data-tone="crit">
                Missing columns: {preview.missingColumns.join(', ')}. Add them to the heading row and preview again.
              </p>
            )}
            <ul className="ix-rows ix-rows-boxed">
              {preview.rows.map((r) => {
                const v = r.ticket ?? r.job;
                const left = r.errors.length > 0 || !!r.duplicateOf;
                return (
                  <li key={r.row} className="ix-import-row">
                    <div className="ix-import-head">
                      <span className="ix-meta">Row {r.row}</span>
                      <strong>{v?.title ?? '(not readable)'}</strong>
                      {r.errors.length > 0 ? (
                        <Chip tone="crit">Left out: error</Chip>
                      ) : r.duplicateOf ? (
                        <Chip tone="warn">Left out: repeats {r.duplicateOf}</Chip>
                      ) : blocked ? (
                        <Chip tone="crit">Not added until the table is fixed</Chip>
                      ) : skip.includes(r.row) ? (
                        <Chip tone="unknown">Left out by you</Chip>
                      ) : (
                        <Chip tone="ok">Will be added</Chip>
                      )}
                    </div>
                    {r.ticket && (
                      <span className="small">
                        {r.ticket.priority} · {r.ticket.category} · for {r.ticket.raisedFor} by {r.ticket.channel.replace('_', ' ')} · raised {r.ticket.at.slice(0, 10)}
                        {r.ticket.itPerson ? ` · with ${r.ticket.itPerson}` : ''}
                      </span>
                    )}
                    {r.job && (
                      <span className="small">
                        {r.job.priority} · {r.job.kind} · {r.job.doer} · due {r.job.dueOn}
                        {r.job.technical ? ' · IT Lead checks' : ''}
                      </span>
                    )}
                    {v?.detail && <span className="small ix-pre">Detail: {v.detail}</span>}
                    {r.errors.map((e) => (
                      <span key={e} className="small ix-crit">
                        {e}
                      </span>
                    ))}
                    {r.warnings.map((w) => (
                      <span key={w} className="muted small">
                        {w}
                      </span>
                    ))}
                    <span className="muted small">Source: {r.sourceRef}</span>
                    {!left && (
                      <label className="ix-check small">
                        <input
                          type="checkbox"
                          checked={skip.includes(r.row)}
                          disabled={locked}
                          onChange={(e) => {
                            if (pending.current.approve) return;
                            const on = e.target.checked;
                            setSkip((s) => (on ? [...s, r.row] : s.filter((x) => x !== r.row)));
                          }}
                        />{' '}
                        Leave this row out
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
            <ErrorNotice error={act.error} />
          </>
        )}
        {result && (
          <div className="notice" data-tone="ok">
            {result.already ? 'This batch was already imported: ' : 'Added: '}
            {result.created.join(', ')}.{result.skipped.length ? ` Left out: ${result.skipped.map((s) => `row ${s.row} (${s.why})`).join('; ')}` : ''}
          </div>
        )}
      </div>
    </Card>
  );
}
