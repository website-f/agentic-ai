import { Select } from '../SearchSelect';
import { openProofItem } from '../save';
import { useState } from 'react';
import { TENDER_BID_PART_LABEL, TENDER_PAPER_LABEL, type ProofInput, type TenderBidPart, type TenderDecisionChoice, type TenderPaperKind, type TenderQuery, type TenderRecord } from '@prima/core';
import { api, type Commercial } from '../api';
import { Chip, notify, ErrorNotice, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { DocList, ProofPicker } from './Proof';
import { StepRow } from './TenderProtocol';

type Row = Commercial['tenders'][number];

const KINDS = Object.keys(TENDER_PAPER_LABEL) as TenderPaperKind[];
const CHECK_LABEL = {
  PREPARER: 'Signed by the person who prepared it',
  CHECK: 'Checked by the Marketing Manager or Deputy',
  MANAGER: 'Signed by the company manager: all verified by the guidelines',
} as const;
const SIGN_AS = { PREPARER: 'preparer', CHECK: 'Marketing check', MANAGER: 'company manager' } as const;

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
                  <button className="link-button" style={{ fontWeight: 600 }} onClick={() => openProofItem(p.name, p.doc!).then((m) => m && notify(m))}>
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
          <Select className="select" aria-label="Kind of paper" value={kind} onChange={(e) => setKind(e.target.value as TenderPaperKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {TENDER_PAPER_LABEL[k]}
              </option>
            ))}
          </Select>
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
                  <button className="btn btn-sm" onClick={() => openProofItem(f.doc!.name, f.doc!).then((m) => m && notify(m))}>
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
                  <ProofPicker site={null} refText="File" items={file} onChange={(x) => setFile(x.slice(-1))} documentsOnly required noLinks />
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
              <Select
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
              </Select>
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
  // Marketing desk bids need no separate checklist review (Fauzan, 22 Nov 2026): the executive confirms by working it.
  const desk = t.desk === 'MARKETING';
  const ready = desk || !!t.checklistReview;
  const reviewing = doa && working && row.checklist.length > 0 && !t.checklistReview && !desk;
  return (
    <section>
      <h3>
        {t.proposal ? 'Proposal checklist' : 'Tender checklist'}{' '}
        {row.checklist.length > 0 && (
          <Chip tone={done === row.checklist.length ? 'ok' : 'warn'}>
            {done} of {row.checklist.length} done
          </Chip>
        )}{' '}
        {row.checklist.length > 0 &&
          !desk &&
          (t.checklistReview ? <Chip tone="ok">Checked by Director Office</Chip> : <Chip tone="warn">Director Office to check</Chip>)}
      </h3>
      {row.checklist.length === 0 && (
        <p className="muted">{hasArahan ? 'Not drafted yet.' : 'Upload the arahan petender first; the checklist is drafted from the papers.'}</p>
      )}
      {(canPrepare || doa) && working && hasArahan && (
        <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.draftTenderChecklist(t.id), desk ? 'Checklist drafted. Read it, then work through it.' : 'Checklist drafted. The Director Office checks it next.')}
          >
            {row.checklist.length ? 'Draft again from the papers' : 'Draft checklist from the papers'}
          </button>
          <span className="muted small">
            {reader.readsFiles ? `By ${reader.name}` : 'Test version: a sample draft; the files are not read yet.'}
          </span>
        </div>
      )}
      {t.checklistRead && row.checklist.length > 0 && (
        <p className="muted small">
          Drafted {dateTimeLabel(t.checklistRead.at)} from the text of {t.checklistRead.read.length} paper{t.checklistRead.read.length === 1 ? '' : 's'}.
          {t.checklistRead.unread.length > 0 && <strong> Not readable by the app, read by hand: {t.checklistRead.unread.join(', ')}.</strong>} Items marked
          "Not found in the papers" are usual for this kind of tender: check whether they are asked.
        </p>
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
                sub: `${c.item.source === 'ai' ? 'Drafted from the papers' : 'Added by Director Office'}${c.item.ref ? ` · ${c.item.ref}` : ''}`,
              }}
              done={c.done}
              plan={c.plan}
              docs={c.docs}
              canDo={canPrepare && working && ready}
              canPlan={canPrepare && working && ready}
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
/** Working hours Marketing staff spent on a desk bid (Fauzan, 22 Nov 2026); needed before the bid is lodged. */
/**
 * The company's tender portal logins from the shared login list (Marketing item AH10, Fauzan 23 Nov 2026): who holds
 * each, the backup and where the password is kept. Prima never shows or keeps a password.
 */
function TenderPortalLogins({ tenderId }: { tenderId: string }) {
  const { data, error } = useLoad(() => api.tenderPortalLogins(tenderId), [tenderId]);
  if (error || !data) return null;
  return (
    <div className="small" style={{ marginTop: 8, display: 'grid', gap: 4 }}>
      <strong>Portal login for lodging</strong>
      {!data.installed && <span className="muted">The shared login list is not installed yet.</span>}
      {data.installed && data.logins.length === 0 && (
        <span className="muted">
          No ePerolehan or tender portal login for this company names you on the shared login list. Ask IT to add you to the company's login there.
        </span>
      )}
      {data.logins.map((l) => (
        <div key={l.id} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span style={{ overflowWrap: 'anywhere' }}>
            {l.url ? (
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.system}
              </a>
            ) : (
              l.system
            )}{' '}
            · {l.placeLabel} · owner {l.owner}, backup {l.backup}
            {l.twoFa ? ` · code phone: ${l.twoFa}` : ''}
          </span>
          {!l.named && <Chip tone="warn">You are not named on it: ask IT</Chip>}
          {(l.state === 'overdue' || l.state === 'leaver' || l.state === 'leaver_late') && <Chip tone="warn">Password change due</Chip>}
        </div>
      ))}
    </div>
  );
}

function TenderHours({ row, canPrepare }: { row: Row; canPrepare: boolean }) {
  const t = row.tender;
  const act = useAction();
  const [hours, setHours] = useState('');
  const log = t.workLog ?? [];
  const total = log.reduce((n, w) => n + w.hours, 0);
  const h = Number(hours);
  const working = t.status === 'open' || t.status === 'preparing';
  return (
    <div style={{ marginTop: 8 }}>
      <div className="small">
        <strong>Working hours on this bid:</strong> {log.length ? `${total} hours (${log.map((w) => `${w.by} ${w.hours}`).join(', ')})` : 'none recorded yet'}
      </div>
      {canPrepare && working && (
        <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="number"
            min={0.25}
            max={100}
            step={0.25}
            aria-label="Hours worked"
            placeholder="Hours you worked, e.g. 1.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || !(h >= 0.25)}
            onClick={() => act.run(() => api.recordTenderHours(t.id, h, ''), 'Hours recorded.').then(() => setHours(''))}
          >
            Add hours
          </button>
          {!log.length && <span className="muted small">Needed before the bid is lodged.</span>}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

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
        {(t.desk === 'MARKETING' ? (['PREPARER', 'CHECK', 'MANAGER'] as const) : (['PREPARER', 'MANAGER'] as const)).map((l) => {
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
      {(t.checkCaught ?? []).length > 0 && (
        <div className="muted small" style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Found by the Marketing check</div>
          {(t.checkCaught ?? []).map((c, i) => (
            <div key={i}>
              {c.by}, {dateTimeLabel(c.at)}: {c.items.join('; ')}
            </div>
          ))}
        </div>
      )}
      {row.myCheck && t.status === 'preparing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {missing.length > 0 && <p className="muted small">Finish these before signing: {missing.join(', ')}.</p>}
          <p className="small">
            {row.myCheck === 'PREPARER'
              ? 'I prepared this bid and every item is done by the guide.'
              : row.myCheck === 'CHECK'
                ? 'I checked this bid against the tender papers: nothing compulsory is missing.'
                : 'I have verified that all is done by the guidelines.'}
          </p>
          {row.myCheck === 'CHECK' && t.desk === 'MARKETING' ? (
            <textarea
              className="input"
              aria-label="Check note"
              rows={3}
              placeholder="Comment to sign. To send back, write what the check found, one item per line."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          ) : (
            <input
              className="input"
              aria-label="Check note"
              placeholder={row.myCheck !== 'PREPARER' ? 'Comment (needed to sign or send back; a short one is fine to sign)' : 'Note (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          <ErrorNotice error={act.error} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || missing.length > 0 || (row.myCheck !== 'PREPARER' && !note.trim())}
              onClick={() => act.run(() => api.verifyTender(t.id, true, note), 'Signed.')}
            >
              Sign as {SIGN_AS[row.myCheck]}
            </button>
            {row.myCheck !== 'PREPARER' && (
              <button
                className="btn btn-sm"
                disabled={act.busy || note.trim().length < 3}
                onClick={() => act.run(() => api.verifyTender(t.id, false, note), t.desk === 'MARKETING' ? 'Sent back to Marketing.' : 'Sent back to the admin team.')}
              >
                Send back
              </button>
            )}
          </div>
        </div>
      )}
      <TenderAiCheckPanel row={row} />
      {t.desk === 'MARKETING' && <TenderHours row={row} canPrepare={canPrepare} />}
      {t.desk === 'MARKETING' && !t.proposal && t.status === 'preparing' && <TenderPortalLogins tenderId={t.id} />}
      {t.status === 'preparing' && !row.nextCheck && canPrepare && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <p className="small">
            {t.proposal ? 'The proposal is signed. Send it to the client, then upload a copy of what was sent.' : 'The bid is signed. Lodge it, then upload the tender submission slip here.'}
          </p>
          <ProofPicker site={null} refText="Slip" items={slip} onChange={setSlip} documentsOnly required />
          <input
            className="input"
            aria-label="Submission note"
            placeholder={t.proposal ? 'How and to whom it was sent' : 'Where and how it was lodged'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !slip.length || (t.desk === 'MARKETING' && !(t.workLog ?? []).length)}
              onClick={() => act.run(() => api.submitTender(t.id, note, slip), t.proposal ? `${t.ref} sent. Copy kept.` : `${t.ref} submitted. Slip kept as proof.`)}
            >
              {t.proposal ? 'Record that it was sent' : 'Record submission'}
            </button>
          </div>
        </div>
      )}
      {t.status === 'submitted' && (
        <>
          <p className="small">
            {t.proposal ? 'Sent to the client' : 'Submitted'}{t.submission ? ` by ${t.submission.by}, ${dateTimeLabel(t.submission.at)}` : ''}.{t.submission?.note ? ` ${t.submission.note}` : ''}
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
      {/* P80: words, not the guide's capitals and "6d": "Short window · 6 days to closing". */}
      {p.level === 'URGENT' ? 'Urgent' : 'Short window'} · {p.days <= 0 ? `${p.what} today` : `${p.days} day${p.days === 1 ? '' : 's'} to ${p.what}`}
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
        {(['briefing', 'siteVisit'] as const).map((k) => {
          const ev = r[k];
          return (
            <Field
              key={k}
              label={k === 'briefing' ? 'Briefing' : 'Site visit'}
              value={
                ev
                  ? `${ev.mandatory ? 'Mandatory' : 'Not mandatory'}${ev.on ? `, ${dateLabel(ev.on)}` : ''}${ev.mofNamedOnly ? ', MOF-named person only' : ''}${ev.outcome ? `. ${ev.outcome}` : ''}`
                  : 'Not recorded'
              }
            />
          );
        })}
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

/**
 * The IT part of a desk bid (Marketing item AH12): Marketing sends it to IT, IT drafts, checks and prices it and hands
 * it back; Marketing lodges the bid. Marketing sees where IT stands, not the IT files or the IT price.
 */
export function TenderItPart({ row }: { row: Row }) {
  const t = row.tender;
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'tender' | 'quotation'>('tender');
  const [codes, setCodes] = useState('');
  const it = row.itPart;
  const working = t.status === 'open' || t.status === 'preparing';
  if (t.desk !== 'MARKETING' || (!it && !(row.canWork && working))) return null;
  const STAGE = { preparing: 'IT is preparing', handed_over: 'Handed to Marketing', submitted: 'Lodged', won: 'Won', lost: 'Lost', dropped: 'Dropped by IT' } as const;
  return (
    <section>
      <h3>IT part</h3>
      {it ? (
        <div className="list-item">
          <div className="small">
            {it.partsDone} of {it.partsTotal} IT parts done · {it.stepsDone} of {it.stepsTotal} steps
            {it.handedOver ? ` · handed over by ${it.handedOver.by} on ${dateTimeLabel(it.handedOver.at)}` : ' · the bid cannot be lodged before IT hands it over'}
          </div>
          <Chip tone={it.handedOver ? 'ok' : 'warn'}>{STAGE[it.stage as keyof typeof STAGE] ?? it.stage}</Chip>
        </div>
      ) : !open ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted small">An IT tender? IT writes the technical part and the IT price; Marketing lodges.</span>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Send the IT part to IT
          </button>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field">
            <span className="label">Kind</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'tender' | 'quotation')}>
              <option value="tender">Open tender</option>
              <option value="quotation">Quotation (sebut harga)</option>
            </select>
          </label>
          <label className="field">
            <span className="label">IT codes asked (comma between)</span>
            <input className="input" value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="e.g. 210101" />
          </label>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () => api.sendTenderToIt(t.id, kind, codes.split(',').map((c) => c.trim()).filter(Boolean), []),
                'Sent to IT.',
              )
            }
          >
            Send
          </button>
          <button className="btn btn-sm" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

type TenderEvent = NonNullable<TenderRecord['briefing']>;

/** A briefing or a site visit in the tender record: mandatory or not, date, place, and whether only the MOF-named person may go. */
function EventEditor({ label, value, onChange }: { label: string; value: TenderEvent | null; onChange: (v: TenderEvent | null) => void }) {
  return (
    <div>
      <label className="field">
        <span className="label">{label}</span>
        <select
          className="select"
          value={value ? (value.mandatory ? 'yes' : 'no') : ''}
          onChange={(e) =>
            onChange(e.target.value ? { on: value?.on ?? null, mandatory: e.target.value === 'yes', place: value?.place ?? '', outcome: value?.outcome ?? '', mofNamedOnly: value?.mofNamedOnly ?? false } : null)
          }
        >
          <option value="">Not recorded</option>
          <option value="yes">Mandatory</option>
          <option value="no">Not mandatory or none</option>
        </select>
      </label>
      {value && (
        <div className="grid-2">
          <label className="field">
            <span className="label">{label} date</span>
            <input className="input" type="date" value={value.on ?? ''} onChange={(e) => onChange({ ...value, on: e.target.value || null })} />
          </label>
          <label className="field">
            <span className="label">Place</span>
            <input className="input" value={value.place} onChange={(e) => onChange({ ...value, place: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Outcome</span>
            <input className="input" value={value.outcome} onChange={(e) => onChange({ ...value, outcome: e.target.value })} />
          </label>
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!value.mofNamedOnly} onChange={(e) => onChange({ ...value, mofNamedOnly: e.target.checked })} />
            Only the person named on the company's MOF certificate may attend
          </label>
        </div>
      )}
    </div>
  );
}

const ATT_STATE = {
  NAME: { label: 'Nobody named', tone: 'warn' },
  NAMED: { label: 'Named', tone: 'info' },
  RECORD: { label: 'Record attendance', tone: 'warn' },
  DONE: { label: 'Attended', tone: 'ok' },
  MISSED: { label: 'Missed', tone: 'crit' },
} as const;

/**
 * Who goes to the buyer's briefing and site visit, and the attendance slip (Marketing item AH13, 23 Nov 2026). The
 * company names its person from day 1; Marketing cannot go in the company's place where only the MOF-named person may.
 */
export function TenderAttendancePanel({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const items = row.attendance ?? [];
  if (!items.length) return null;
  const working = row.tender.status === 'open' || row.tender.status === 'preparing';
  return (
    <section>
      <h3>Briefing and site visit</h3>
      <div className="list">
        {items.map((a) => (
          <AttendanceRow key={a.kind} tenderId={row.tender.id} a={a} canEdit={canEdit && working} />
        ))}
      </div>
    </section>
  );
}

function AttendanceRow({ tenderId, a, canEdit }: { tenderId: string; a: NonNullable<Row['attendance']>[number]; canEdit: boolean }) {
  const act = useAction();
  const [name, setName] = useState('');
  const [mof, setMof] = useState(false);
  const [missed, setMissed] = useState(false);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const st = ATT_STATE[a.state];
  const when = a.on ? `${dateLabel(a.on)}${a.days != null && a.days > 0 ? ` (in ${a.days} day${a.days === 1 ? '' : 's'})` : ''}` : 'date not recorded';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {a.label}
            {a.mandatory ? ' · mandatory' : ''}
          </div>
          <div className="muted small">
            {when}
            {a.place ? ` · ${a.place}` : ''}
            {a.mofNamedOnly ? ' · only the person named on the MOF certificate may attend' : ''}
          </div>
          {a.entry && (
            <div className="small">
              {a.entry.attendee ? `${a.entry.attendee}${a.entry.mofNamed ? ' (on the MOF certificate)' : ''}, named by ${a.entry.namedBy}` : ''}
              {a.entry.result ? ` · ${a.entry.result.attended ? 'attended, slip kept' : `missed: ${a.entry.result.note}`} (${a.entry.result.by})` : ''}
            </div>
          )}
        </div>
        <Chip tone={st.tone}>{st.label}</Chip>
      </div>
      {canEdit && (a.state === 'NAME' || a.state === 'NAMED') && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" aria-label={`Who attends the ${a.label.toLowerCase()}`} placeholder={a.entry ? 'Change the person' : 'Who will attend'} value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 240 }} />
          <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={mof} onChange={(e) => setMof(e.target.checked)} /> Named on our MOF certificate
          </label>
          <button
            className="btn btn-sm"
            disabled={act.busy || name.trim().length < 3 || (a.mofNamedOnly && !mof)}
            onClick={() => act.run(() => api.nameTenderAttendee(tenderId, a.kind, name.trim(), mof), 'Person named.').then((r) => r !== undefined && setName(''))}
          >
            {a.entry ? 'Change' : 'Name'}
          </button>
        </div>
      )}
      {canEdit && a.state === 'RECORD' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={missed} onChange={(e) => setMissed(e.target.checked)} /> Nobody attended
          </label>
          {missed ? (
            <input className="input" aria-label="Why nobody attended" placeholder="Why nobody attended" value={note} onChange={(e) => setNote(e.target.value)} />
          ) : (
            <ProofPicker site={null} refText="Attendance slip" items={proof} onChange={setProof} documentsOnly required />
          )}
          <div>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || (missed ? note.trim().length < 5 : proof.length === 0)}
              onClick={() => act.run(() => api.recordTenderAttendance(tenderId, a.kind, !missed, note.trim(), missed ? [] : proof), 'Attendance recorded.')}
            >
              Save attendance
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
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
      <EventEditor label="Briefing" value={r.briefing ?? null} onChange={(v) => setR({ ...r, briefing: v })} />
      <EventEditor label="Site visit" value={r.siteVisit ?? null} onChange={(v) => setR({ ...r, siteVisit: v })} />
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
            <Select className="select" aria-label="Decision" value={choice} onChange={(e) => setChoice(e.target.value as TenderDecisionChoice)}>
              {(Object.keys(DECISION) as TenderDecisionChoice[]).map((k) => (
                <option key={k} value={k}>
                  {DECISION[k].label}
                </option>
              ))}
            </Select>
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              aria-label="Reason"
              placeholder={choice === 'TERUSKAN' ? 'Reason or key issue (needed; a short one is fine)' : 'Reason (required)'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ErrorNotice error={act.error} />
          <div>
            <button
              className="btn btn-sm"
              disabled={act.busy || (choice === 'TERUSKAN' ? !reason.trim() : reason.trim().length < 3)}
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

/**
 * The AI check (Fauzan, 23 Nov 2026: "Yes, AI checks once, person answers"): when the preparer signs, AI reads the tender
 * papers once and lists what the checklist misses or states differently, with the words from the paper. The Marketing
 * Manager or Deputy answers each point before the Marketing check. AI never ticks or signs.
 */
function TenderAiCheckPanel({ row }: { row: Row }) {
  const t = row.tender;
  const ai = t.aiCheck;
  if (!ai) return null;
  const open = ai.flags.filter((f) => !f.answer).length;
  const canAnswer = row.myCheck === 'CHECK';
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600 }}>
        AI check of the papers{' '}
        {ai.error ? <Chip tone="warn">Could not run</Chip> : open ? <Chip tone="warn">{open} to answer</Chip> : <Chip tone="ok">{ai.flags.length ? 'All answered' : 'Nothing found'}</Chip>}
      </div>
      <p className="muted small">
        {ai.error ??
          `Read once on ${dateTimeLabel(ai.at)}: ${ai.read.join(', ') || 'no paper'}.${ai.unread.length ? ` Not read: ${ai.unread.join(', ')}.` : ''} The Marketing Manager or Deputy answers each point before the Marketing check; AI never ticks or signs.`}
      </p>
      <div className="list">
        {ai.flags.map((f) => (
          <AiFlagRow key={f.id} tenderId={t.id} flag={f} canAnswer={canAnswer} />
        ))}
      </div>
    </div>
  );
}

function AiFlagRow({ tenderId, flag, canAnswer }: { tenderId: string; flag: NonNullable<Row['tender']['aiCheck']>['flags'][number]; canAnswer: boolean }) {
  const act = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div>
        <Chip tone={flag.kind === 'MISSING' ? 'warn' : 'info'}>{flag.kind === 'MISSING' ? 'Not on the checklist' : 'Differs from the checklist'}</Chip> <strong>{flag.what}</strong>
        <div className="muted small">
          {flag.paper}: "{flag.quote}"
        </div>
      </div>
      {flag.answer ? (
        <div className="small">
          {flag.answer.status === 'FIXED' ? 'Fixed' : 'Not needed'}: {flag.answer.note} <span className="muted">({flag.answer.by}, {dateTimeLabel(flag.answer.at)})</span>
        </div>
      ) : canAnswer ? (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <input className="input" aria-label="Answer" placeholder="What was fixed, or why it is not needed" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.answerTenderAiFlag(tenderId, flag.id, 'FIXED', note), 'Answered.')}>
            Fixed
          </button>
          <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.answerTenderAiFlag(tenderId, flag.id, 'NOT_NEEDED', note), 'Answered.')}>
            Not needed
          </button>
        </div>
      ) : (
        <span className="muted small">Waiting for the Marketing Manager or Deputy.</span>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
