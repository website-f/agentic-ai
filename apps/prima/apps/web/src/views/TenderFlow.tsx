import { saveFile } from '../save';
import { useState } from 'react';
import { TENDER_BID_PART_LABEL, TENDER_PAPER_LABEL, type ProofInput, type TenderBidPart, type TenderDecisionChoice, type TenderPaperKind, type TenderQuery, type TenderRecord } from '@prima/core';
import { api, type Commercial } from '../api';
import { Chip, notify, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../ui';
import { DocList, ProofPicker } from './Proof';
import { StepRow } from './TenderProtocol';

type Row = Commercial['tenders'][number];

const KINDS = Object.keys(TENDER_PAPER_LABEL) as TenderPaperKind[];
const CHECK_LABEL = { PREPARER: 'Signed by the person who prepared it', MANAGER: 'Signed by the company manager: all verified by the guidelines' } as const;

/** Tender papers: the notice, the arahan petender, the specification and forms (Fauzan, 25 Oct 2026). */
export function TenderPapers({ row, canUpload }: { row: Row; canUpload: boolean }) {
  const [kind, setKind] = useState<TenderPaperKind>('ARAHAN');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [open, setOpen] = useState(false);
  const act = useAction();
  const working = row.tender.status === 'open' || row.tender.status === 'preparing';
  return (
    <section>
      <h3>Tender papers {!row.papers.some((p) => p.kind === 'ARAHAN') && working && <Chip tone="warn">Arahan petender not uploaded</Chip>}</h3>
      {row.papers.length === 0 && <p className="muted">No papers uploaded yet.</p>}
      {row.papers.length > 0 && (
        <div className="list">
          {row.papers.map((p) => (
            <div key={p.docId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div>
                {p.doc ? (
                  <button className="link-button" style={{ fontWeight: 600 }} onClick={() => saveFile(p.name, p.doc!.data).then((m) => m && notify(m))}>
                    {p.name}
                  </button>
                ) : (
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                )}
                <div className="muted small">
                  {p.by}, {dateTimeLabel(p.at)}
                </div>
              </div>
              <div>
                <Chip tone="neutral">{TENDER_PAPER_LABEL[p.kind]}</Chip>
              </div>
            </div>
          ))}
        </div>
      )}
      {canUpload && working && !open && (
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
          Upload papers
        </button>
      )}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <select className="select" aria-label="Kind of paper" value={kind} onChange={(e) => setKind(e.target.value as TenderPaperKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {TENDER_PAPER_LABEL[k]}
              </option>
            ))}
          </select>
          <ProofPicker site={null} refText="Tender" items={proof} onChange={setProof} documentsOnly required />
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !proof.length}
              onClick={async () => {
                const r = await act.run(() => api.addTenderPapers(row.tender.id, kind, proof), 'Papers uploaded.');
                if (r) {
                  setProof([]);
                  setOpen(false);
                }
              }}
            >
              Save papers
            </button>
            <button className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const PARTS = Object.keys(TENDER_BID_PART_LABEL) as TenderBidPart[];

/**
 * Bid files (Fauzan, 28 Oct 2026): every file is named as the tender asks, never by the company name, and the technical
 * part carries no company name anywhere. The app refuses a wrong name, and a technical file whose text or properties
 * carry the name; the preparer then confirms each technical file was checked page by page.
 */
export function TenderBidFiles({ row, canPrepare, doa }: { row: Row; canPrepare: boolean; doa: boolean }) {
  const t = row.tender;
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState<{ id?: string; part: TenderBidPart; required: string }[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [file, setFile] = useState<ProofInput[]>([]);
  const working = t.status === 'open' || t.status === 'preparing';
  const signed = (t.verifications ?? []).length > 0;
  const canList = (canPrepare || doa) && working && !signed;
  const canUpload = canPrepare && working && !signed;
  const files = row.bidFiles;
  if (!files.length && !canList && !working) return null;
  return (
    <section>
      <h3>
        Bid files {working && row.bidFileGaps.length > 0 && <Chip tone="warn">{row.bidFileGaps.length} to do</Chip>}
      </h3>
      <p className="muted small">
        Name every file exactly as the tender asks, never by the company name. The technical part must not show the company name anywhere: letterhead,
        logo, stamp, header, footer, watermark or the file&apos;s properties.
      </p>
      {!editing && files.length === 0 && <p className="muted">No file names listed yet. List the files the tender asks for, by their exact names.</p>}
      {!editing && files.length > 0 && (
        <div className="list">
          {files.map((f) => (
            <div key={f.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }} data-no-translate>
                    {f.required}
                  </div>
                  <div className="muted small">
                    {TENDER_BID_PART_LABEL[f.part]}
                    {f.doc && f.at ? ` · uploaded by ${f.by}, ${dateTimeLabel(f.at)}` : ''}
                    {f.confirmedBy && f.confirmedAt ? ` · checked by ${f.confirmedBy}, ${dateTimeLabel(f.confirmedAt)}` : ''}
                  </div>
                  {f.part === 'TEKNIKAL' && f.doc && !f.confirmedBy && (
                    <div className="small" style={{ marginTop: 4 }}>
                      {f.scan?.readText
                        ? 'No company name found in the text or file properties the app can read. Check pictures, stamps and scanned pages by eye.'
                        : 'The app cannot read the text of this file (picture or scan). Check every page by eye.'}
                    </div>
                  )}
                </div>
                <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                  {!f.doc ? (
                    <Chip tone="warn">Not uploaded</Chip>
                  ) : f.part === 'TEKNIKAL' && !f.confirmedBy ? (
                    <Chip tone="warn">To check</Chip>
                  ) : (
                    <Chip tone="ok">Ready</Chip>
                  )}
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {f.doc && (
                  <button className="btn btn-sm" onClick={() => saveFile(f.doc!.name, f.doc!.data).then((m) => m && notify(m))}>
                    Open
                  </button>
                )}
                {canUpload && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setUploading(uploading === f.id ? null : f.id);
                      setFile([]);
                    }}
                  >
                    {uploading === f.id ? 'Cancel' : f.doc ? 'Upload again' : 'Upload'}
                  </button>
                )}
                {canUpload && f.part === 'TEKNIKAL' && f.doc && !f.confirmedBy && (
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={act.busy}
                    onClick={() => act.run(() => api.confirmTenderBidFile(t.id, f.id), 'Checked: no company name.')}
                  >
                    I checked every page: no company name
                  </button>
                )}
              </div>
              {uploading === f.id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p className="small">
                    The file must be named <strong data-no-translate>{f.required}</strong>.
                  </p>
                  <ProofPicker site={null} refText="File" items={file} onChange={(x) => setFile(x.slice(-1))} documentsOnly required />
                  <div>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={act.busy || !file.length}
                      onClick={async () => {
                        const r = await act.run(() => api.uploadTenderBidFile(t.id, f.id, file), 'File uploaded.');
                        if (r) {
                          setUploading(null);
                          setFile([]);
                        }
                      }}
                    >
                      Save file
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((f, i) => (
            <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select
                className="select"
                aria-label="Part of the bid"
                value={f.part}
                onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, part: e.target.value as TenderBidPart } : x)))}
              >
                {PARTS.map((p) => (
                  <option key={p} value={p}>
                    {TENDER_BID_PART_LABEL[p]}
                  </option>
                ))}
              </select>
              <input
                className="input"
                style={{ flex: 1, minWidth: 160 }}
                aria-label="File name the tender asks for"
                placeholder="File name the tender asks for, e.g. Dokumen Teknikal.pdf"
                value={f.required}
                onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, required: e.target.value } : x)))}
              />
              <button className="btn btn-sm btn-ghost" aria-label="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <div>
            <button className="btn btn-sm" onClick={() => setList([...list, { part: 'TEKNIKAL', required: '' }])}>
              Add a file
            </button>
          </div>
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || list.some((f) => f.required.trim().length < 3)}
              onClick={async () => {
                const r = await act.run(() => api.setTenderBidFiles(t.id, list), 'File names saved.');
                if (r) setEditing(false);
              }}
            >
              Save file names
            </button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {!editing && <ErrorNotice error={act.error} />}
      {!editing && canList && (
        <button
          className="btn btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => {
            setList(files.length ? files.map((f) => ({ id: f.id, part: f.part, required: f.required })) : [{ part: 'TEKNIKAL', required: '' }]);
            setEditing(true);
          }}
        >
          {files.length ? 'Change file names' : 'List the file names'}
        </button>
      )}
    </section>
  );
}

/** The checklist drafted by the AI agent from the papers and checked by the Director Office Administrator. */
export function TenderChecklist({ row, canPrepare, doa, reader }: { row: Row; canPrepare: boolean; doa: boolean; reader: Commercial['reader'] }) {
  const t = row.tender;
  const act = useAction();
  const [remove, setRemove] = useState<string[]>([]);
  const [add, setAdd] = useState('');
  const [addDoc, setAddDoc] = useState(false);
  const [note, setNote] = useState('');
  const working = (t.status === 'open' || t.status === 'preparing') && !(t.verifications ?? []).length;
  const hasArahan = row.papers.some((p) => p.kind === 'ARAHAN');
  const done = row.checklist.filter((c) => c.done).length;
  const reviewing = doa && working && row.checklist.length > 0 && !t.checklistReview;
  return (
    <section>
      <h3>
        Tender checklist{' '}
        {row.checklist.length > 0 && (
          <Chip tone={done === row.checklist.length ? 'ok' : 'warn'}>
            {done} of {row.checklist.length} done
          </Chip>
        )}{' '}
        {row.checklist.length > 0 &&
          (t.checklistReview ? <Chip tone="ok">Checked by Director Office</Chip> : <Chip tone="warn">Director Office to check</Chip>)}
      </h3>
      {row.checklist.length === 0 && (
        <p className="muted">{hasArahan ? 'Not drafted yet.' : 'Upload the arahan petender first; the AI agent drafts the checklist from the papers.'}</p>
      )}
      {(canPrepare || doa) && working && hasArahan && (
        <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.draftTenderChecklist(t.id), 'Checklist drafted. The Director Office checks it next.')}
          >
            {row.checklist.length ? 'Draft again from the papers' : 'Draft checklist from the papers'}
          </button>
          <span className="muted small">
            {reader.readsFiles ? `By ${reader.name}` : 'Test version: a sample draft, the AI agent does not read the files yet.'}
          </span>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {row.checklist.length > 0 && (
        <div className="list">
          {row.checklist.map((c) => (
            <StepRow
              key={c.item.id}
              t={t.id}
              item={{
                id: c.item.id,
                label: c.item.label,
                detail: c.item.detail,
                needsDocument: c.item.needsDocument,
                sub: `${c.item.source === 'ai' ? 'Drafted by AI agent' : 'Added by Director Office'}${c.item.ref ? ` · ${c.item.ref}` : ''}`,
              }}
              done={c.done}
              plan={c.plan}
              docs={c.docs}
              canDo={canPrepare && working && !!t.checklistReview}
              canPlan={canPrepare && working && !!t.checklistReview}
              canConfirm={row.canConfirmNa && working}
              extra={
                reviewing && !c.done ? (
                  <label className="small row" style={{ gap: 4 }}>
                    <input
                      type="checkbox"
                      aria-label={`Remove ${c.item.label}`}
                      checked={remove.includes(c.item.id)}
                      onChange={(e) => setRemove(e.target.checked ? [...remove, c.item.id] : remove.filter((x) => x !== c.item.id))}
                    />
                    Remove
                  </label>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      {t.checklistReview && (
        <p className="muted small">
          Checked by {t.checklistReview.by}, {dateTimeLabel(t.checklistReview.at)}: {t.checklistReview.note}
        </p>
      )}
      {reviewing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              aria-label="Add an item"
              placeholder="Add an item the agent missed"
              value={add}
              onChange={(e) => setAdd(e.target.value)}
            />
            <label className="small row" style={{ gap: 4 }}>
              <input type="checkbox" checked={addDoc} onChange={(e) => setAddDoc(e.target.checked)} /> Needs a document
            </label>
          </div>
          <input className="input" aria-label="Review note" placeholder="Note on your check" value={note} onChange={(e) => setNote(e.target.value)} />
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 3}
              onClick={() =>
                act.run(
                  () => api.reviewTenderChecklist(t.id, { remove, add: add.trim() ? [{ label: add.trim(), needsDocument: addDoc }] : [], note }),
                  'Checklist checked. The admin team works it now.',
                )
              }
            >
              Confirm checklist
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Fauzan, 26 Oct 2026: the preparer signs, the company manager signs that all is verified, then the submission slip. */
export function TenderChecks({ row, canPrepare, missing }: { row: Row; canPrepare: boolean; missing: string[] }) {
  const t = row.tender;
  const act = useAction();
  const [note, setNote] = useState('');
  const [slip, setSlip] = useState<ProofInput[]>([]);
  const given = t.verifications ?? [];
  if (t.status !== 'preparing' && t.status !== 'submitted') return null;
  return (
    <section>
      <h3>Signatures and submission</h3>
      <div className="list">
        {(['PREPARER', 'MANAGER'] as const).map((l) => {
          const v = given.find((x) => x.level === l);
          return (
            <div key={l} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{CHECK_LABEL[l]}</div>
                {v && (
                  <div className="muted small">
                    {v.by}, {dateTimeLabel(v.at)}
                    {v.note ? ` · ${v.note}` : ''}
                  </div>
                )}
              </div>
              {v ? <Chip tone="ok">Signed</Chip> : row.nextCheck === l ? <Chip tone="warn">Waiting</Chip> : <Chip tone="neutral">Later</Chip>}
            </div>
          );
        })}
      </div>
      {row.myCheck && t.status === 'preparing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {missing.length > 0 && <p className="muted small">Finish these before signing: {missing.join(', ')}.</p>}
          <p className="small">
            {row.myCheck === 'PREPARER' ? 'I prepared this bid and every item is done by the guide.' : 'I have verified that all is done by the guidelines.'}
          </p>
          <input
            className="input"
            aria-label="Check note"
            placeholder={row.myCheck === 'MANAGER' ? 'Note (required to send back)' : 'Note (optional)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || missing.length > 0}
              onClick={() => act.run(() => api.verifyTender(t.id, true, note), 'Signed.')}
            >
              Sign as {row.myCheck === 'PREPARER' ? 'preparer' : 'company manager'}
            </button>
            {row.myCheck === 'MANAGER' && (
              <button
                className="btn btn-sm"
                disabled={act.busy || note.trim().length < 3}
                onClick={() => act.run(() => api.verifyTender(t.id, false, note), 'Sent back to the admin team.')}
              >
                Send back
              </button>
            )}
          </div>
        </div>
      )}
      {t.status === 'preparing' && !row.nextCheck && canPrepare && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <p className="small">The bid is signed. Lodge it, then upload the tender submission slip here.</p>
          <ProofPicker site={null} refText="Slip" items={slip} onChange={setSlip} documentsOnly required />
          <input
            className="input"
            aria-label="Submission note"
            placeholder="Where and how it was lodged"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !slip.length}
              onClick={() => act.run(() => api.submitTender(t.id, note, slip), `${t.ref} submitted. Slip kept as proof.`)}
            >
              Record submission
            </button>
          </div>
        </div>
      )}
      {t.status === 'submitted' && (
        <>
          <p className="small">
            Submitted{t.submission ? ` by ${t.submission.by}, ${dateTimeLabel(t.submission.at)}` : ''}.{t.submission?.note ? ` ${t.submission.note}` : ''}
          </p>
          {row.slip.length ? <DocList docs={row.slip} /> : <p className="muted small">No submission slip on file (submitted before the app).</p>}
        </>
      )}
    </section>
  );
}

const DECISION = {
  TERUSKAN: { label: 'Teruskan', tone: 'ok' },
  TANGGUH: { label: 'Tangguh, perlu penjelasan', tone: 'warn' },
  TIDAK_BIDA: { label: 'Tidak layak / tidak bida', tone: 'crit' },
} as const;
const rm2 = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const yes = (v: boolean | null | undefined, y: string, n: string) => (v == null ? 'Not recorded' : v ? y : n);

/** Priority by the nearest buyer date: URGENT at 3 days or less, SHORT WINDOW at 7 (guide V1.0 section 01). */
export function PriorityChip({ p }: { p: Row['priority'] }) {
  if (!p || !p.level) return null;
  return (
    <Chip tone={p.level === 'URGENT' ? 'crit' : 'warn'} title={`${p.days} days to the ${p.what}`}>
      {p.level === 'URGENT' ? 'URGENT' : 'SHORT WINDOW'} · {p.days <= 0 ? 'today' : `${p.days}d`} to {p.what}
    </Chip>
  );
}

/** Tender record and mandatory dates, the decision, and the price check (guide V1.0 section 01 and the data list). */
export function TenderRecordPanel({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const t = row.tender;
  const r = t.record ?? {};
  const [editing, setEditing] = useState(false);
  const working = t.status === 'open' || t.status === 'preparing';
  const posts = (r.dayPosts ?? 0) + (r.nightPosts ?? 0);
  return (
    <section>
      <h3>
        Tender record <PriorityChip p={row.priority} /> {t.leadOnly && <Chip tone="unknown">Lead only, not confirmed</Chip>}
      </h3>
      <div className="grid-2">
        <Field label="Advertised" value={r.adOn ? dateLabel(r.adOn) : 'Not recorded'} />
        <Field label="Closes (MYT)" value={`${dateLabel(t.closesOn)}${r.closesAt ? `, ${r.closesAt}` : ''}`} />
        <Field
          label="Briefing / site visit"
          value={
            r.briefing
              ? `${r.briefing.mandatory ? 'Mandatory' : 'Not mandatory'}${r.briefing.on ? `, ${dateLabel(r.briefing.on)}` : ''}${r.briefing.outcome ? `. ${r.briefing.outcome}` : ''}`
              : 'Not recorded'
          }
        />
        <Field label="Questions to the buyer by" value={r.queriesBy ? dateLabel(r.queriesBy) : 'Not recorded'} />
        <Field label="Submission" value={r.submissionMethod || 'Not recorded'} />
        <Field label="Offer valid" value={r.validityDays ? `${r.validityDays} days` : 'Not recorded'} />
        <Field
          label="Contract"
          value={
            r.contractMonths
              ? `${r.contractMonths} months${r.contractStart ? `, ${dateLabel(r.contractStart)} to ${r.contractEnd ? dateLabel(r.contractEnd) : '?'}` : ''}`
              : 'Not recorded'
          }
        />
        <Field
          label="Eligibility"
          value={
            [
              r.mofCodes?.length ? `MOF ${r.mofCodes.join(', ')}` : null,
              r.kdnArea ? `KDN ${r.kdnArea}` : null,
              r.bumiputeraOnly == null ? null : r.bumiputeraOnly ? 'Bumiputera only' : 'Not Bumiputera only',
              r.locality || null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Not recorded'
          }
        />
        <Field
          label="Coverage"
          value={posts ? `${r.dayPosts ?? 0} day + ${r.nightPosts ?? 0} night posts${r.shiftHours ? `, ${r.shiftHours} h shifts` : ''}` : 'Not recorded'}
        />
        <Field
          label="Indicative price"
          value={r.indicativeTotal ? `${rm2(r.indicativeTotal)} for the term, ${yes(r.sstIncluded, 'SST included', 'without SST')}` : 'Not recorded'}
        />
        {r.fees && <Field label="Fees" value={r.fees} />}
        {r.officialLink && (
          <div>
            <div className="label">Official link</div>
            <a href={r.officialLink} target="_blank" rel="noreferrer" className="small">
              {r.officialLink.replace(/^https:\/\//, '')}
            </a>
          </div>
        )}
      </div>
      {canEdit && working && !editing && (
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
          Edit record
        </button>
      )}
      {editing && <RecordEditor row={row} onClose={() => setEditing(false)} />}
      <PriceCheck row={row} />
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="small">{value}</div>
    </div>
  );
}

function RecordEditor({ row, onClose }: { row: Row; onClose: () => void }) {
  const t = row.tender;
  const [r, setR] = useState<TenderRecord>({ ...(t.record ?? {}) });
  const [lead, setLead] = useState(!!t.leadOnly);
  const act = useAction();
  const text = (k: keyof TenderRecord, label: string, type = 'text') => (
    <label className="field">
      <span className="label">{label}</span>
      <input
        className="input"
        type={type}
        value={(r[k] as string | number | null | undefined) ?? ''}
        onChange={(e) => setR({ ...r, [k]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null })}
      />
    </label>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <div className="grid-2">
        {text('adOn', 'Advertised on', 'date')}
        {text('closesAt', 'Closing time (HH:MM MYT)')}
        {text('queriesBy', 'Questions by', 'date')}
        {text('docsBy', 'Buy documents by', 'date')}
        {text('submissionMethod', 'Submission method')}
        {text('validityDays', 'Offer valid (days)', 'number')}
        {text('contractMonths', 'Contract months', 'number')}
        {text('contractStart', 'Contract start', 'date')}
        {text('indicativeTotal', 'Indicative price, whole term (RM)', 'number')}
        {text('indicativeSource', 'Where the indicative price is')}
        {text('dayPosts', 'Day posts', 'number')}
        {text('nightPosts', 'Night posts', 'number')}
        {text('shiftHours', 'Shift hours', 'number')}
        {text('priceUnit', 'Price schedule unit')}
        {text('kdnArea', 'KDN licence area')}
        {text('locality', 'State / locality rule')}
        {text('officialLink', 'Official link (https://)')}
      </div>
      <label className="field">
        <span className="label">Briefing or site visit</span>
        <select
          className="select"
          value={r.briefing ? (r.briefing.mandatory ? 'yes' : 'no') : ''}
          onChange={(e) =>
            setR({
              ...r,
              briefing: e.target.value
                ? { on: r.briefing?.on ?? null, mandatory: e.target.value === 'yes', place: r.briefing?.place ?? '', outcome: r.briefing?.outcome ?? '' }
                : null,
            })
          }
        >
          <option value="">Not recorded</option>
          <option value="yes">Mandatory</option>
          <option value="no">Not mandatory or none</option>
        </select>
      </label>
      {r.briefing && (
        <div className="grid-2">
          <label className="field">
            <span className="label">Briefing date</span>
            <input
              className="input"
              type="date"
              value={r.briefing.on ?? ''}
              onChange={(e) => setR({ ...r, briefing: { ...r.briefing!, on: e.target.value || null } })}
            />
          </label>
          <label className="field">
            <span className="label">Outcome</span>
            <input className="input" value={r.briefing.outcome} onChange={(e) => setR({ ...r, briefing: { ...r.briefing!, outcome: e.target.value } })} />
          </label>
        </div>
      )}
      <label className="field">
        <span className="label">SST</span>
        <select
          className="select"
          value={r.sstIncluded == null ? '' : r.sstIncluded ? 'yes' : 'no'}
          onChange={(e) => setR({ ...r, sstIncluded: e.target.value === '' ? null : e.target.value === 'yes' })}
        >
          <option value="">Not recorded</option>
          <option value="yes">Indicative includes SST</option>
          <option value="no">Without SST</option>
        </select>
      </label>
      <label className="row small" style={{ gap: 4 }}>
        <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} /> Lead only: the official notice is not confirmed yet
      </label>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={async () => {
            const res = await act.run(() => api.setTenderRecord(t.id, r, lead), 'Tender record saved.');
            if (res) onClose();
          }}
        >
          Save record
        </button>
        <button className="btn btn-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Average contract revenue per guard-hour from the indicative price: indicative / months / 30.5 / posts / shift hours,
 * with the data list's reduction scenarios. Not a wage and not an approved bid.
 */
function PriceCheck({ row }: { row: Row }) {
  const h = row.hourly;
  const lines = row.tender.record?.priceLines ?? [];
  const sum = lines.reduce((a, l) => a + l.monthly * l.months, 0);
  const ind = row.tender.record?.indicativeTotal ?? null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="label">Price check</div>
      {!h.ok ? (
        <p className="muted small">Waiting for: {h.missing.join(', ')}. The check is not worked out with a missing input.</p>
      ) : (
        <>
          <p className="small">
            {rm2(h.monthly)} a month over {h.posts} posts gives about <strong>{rm2(h.hourly)}</strong> per guard-hour of average contract revenue.
          </p>
          <table className="price-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="num">Term total</th>
                <th className="num">Per hour</th>
              </tr>
            </thead>
            <tbody>
              {h.scenarios.map((s) => (
                <tr key={s.cut}>
                  <td>{s.cut === 0 ? 'As indicative' : `${s.cut}% lower`}</td>
                  <td className="num">{rm2(s.total)}</td>
                  <td className="num">{rm2(s.hourly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">This is not a wage rate and not an approved bid. Management approves the company's own price (guide 04.09).</p>
        </>
      )}
      {lines.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 8 }}>
            Price schedule
          </div>
          <table className="price-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Monthly</th>
                <th className="num">Term</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.item}>
                  <td>{l.item}</td>
                  <td className="num">{rm2(l.monthly)}</td>
                  <td className="num">{rm2(l.monthly * l.months)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 600 }}>Total</td>
                <td className="num">{rm2(lines.reduce((a, l) => a + l.monthly, 0))}</td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {rm2(sum)}
                </td>
              </tr>
            </tbody>
          </table>
          {ind != null &&
            (Math.abs(sum - ind) < 0.5 ? (
              <p className="small">The lines add up to the indicative price.</p>
            ) : (
              <p className="small" style={{ color: 'var(--crit)' }}>
                The lines add up to {rm2(sum)}, not the indicative {rm2(ind)}. Check before pricing.
              </p>
            ))}
        </>
      )}
    </div>
  );
}

/** Teruskan, Tangguh or Tidak bida with the reason; the company manager or the Director Office decides. */
export function TenderDecisionPanel({ row }: { row: Row }) {
  const t = row.tender;
  const [choice, setChoice] = useState<TenderDecisionChoice>('TERUSKAN');
  const [reason, setReason] = useState('');
  const act = useAction();
  const d = t.decision;
  return (
    <section>
      <h3>Decision</h3>
      {d ? (
        <p className="small">
          <Chip tone={DECISION[d.choice].tone}>{DECISION[d.choice].label}</Chip> {d.reason}{' '}
          <span className="muted">
            · {d.by}, {dateTimeLabel(d.at)}
          </span>
        </p>
      ) : (
        <p className="muted small">No decision yet. Pricing starts only after the decision to teruskan.</p>
      )}
      {row.canDecide && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <select className="select" aria-label="Decision" value={choice} onChange={(e) => setChoice(e.target.value as TenderDecisionChoice)}>
              {(Object.keys(DECISION) as TenderDecisionChoice[]).map((k) => (
                <option key={k} value={k}>
                  {DECISION[k].label}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              aria-label="Reason"
              placeholder={choice === 'TERUSKAN' ? 'Reason or key issue (optional)' : 'Reason (required)'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ErrorNotice error={act.error} />
          <div>
            <button
              className="btn btn-sm"
              disabled={act.busy || (choice !== 'TERUSKAN' && reason.trim().length < 3)}
              onClick={() => act.run(() => api.decideTender(t.id, choice, reason), 'Decision recorded.')}
            >
              {d ? 'Change decision' : 'Record decision'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const QUERY_STATUS = {
  open: { label: 'To send', tone: 'warn' },
  sent: { label: 'Sent, waiting', tone: 'info' },
  answered: { label: 'Answered', tone: 'ok' },
} as const;

/** Questions and conflicts referred to the buyer in writing before closing. */
export function TenderQueries({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const t = row.tender;
  const qs = t.queries ?? [];
  const [text, setText] = useState('');
  const [ref, setRef] = useState('');
  const act = useAction();
  const working = t.status === 'open' || t.status === 'preparing';
  return (
    <section>
      <h3>
        Questions to the buyer{' '}
        {qs.length > 0 && (
          <Chip tone={qs.every((q) => q.status === 'answered') ? 'ok' : 'warn'}>
            {qs.filter((q) => q.status === 'answered').length} of {qs.length} answered
          </Chip>
        )}
      </h3>
      {qs.length === 0 && <p className="muted small">None recorded.</p>}
      <div className="list">
        {qs.map((q) => (
          <QueryRow key={q.id} t={t.id} q={q} canEdit={canEdit && working} />
        ))}
      </div>
      {canEdit && working && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <input
            className="input"
            aria-label="New question"
            placeholder="New question or conflict for the buyer"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              aria-label="Question reference"
              placeholder="Page or clause"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || text.trim().length < 5}
              onClick={async () => {
                const r = await act.run(() => api.addTenderQuery(t.id, text, ref), 'Question added.');
                if (r) {
                  setText('');
                  setRef('');
                }
              }}
            >
              Add
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
    </section>
  );
}

function QueryRow({ t, q, canEdit }: { t: string; q: TenderQuery; canEdit: boolean }) {
  const [answer, setAnswer] = useState('');
  const [open, setOpen] = useState(false);
  const act = useAction();
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div className="small" style={{ minWidth: 0 }}>
          {q.text}
          {q.ref && <span className="muted"> · {q.ref}</span>}
        </div>
        <Chip tone={QUERY_STATUS[q.status].tone}>{QUERY_STATUS[q.status].label}</Chip>
      </div>
      {q.answer && <div className="small">Answer: {q.answer}</div>}
      {canEdit && q.status !== 'answered' && !open && (
        <div className="row">
          {q.status === 'open' && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setTenderQuery(t, q.id, 'sent', ''), 'Marked sent.')}>
              Mark sent
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Record answer
          </button>
        </div>
      )}
      {open && (
        <>
          <input
            className="input"
            aria-label="Buyer's answer"
            placeholder="The buyer's written answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || answer.trim().length < 3}
              onClick={async () => {
                const r = await act.run(() => api.setTenderQuery(t, q.id, 'answered', answer), 'Answer recorded.');
                if (r) setOpen(false);
              }}
            >
              Save answer
            </button>
            <button className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
