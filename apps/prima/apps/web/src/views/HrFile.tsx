import { useState } from 'react';
import { HIRING_DOC_LABEL, HOSPITAL_DOC_LABEL, HOSPITAL_STAGE_LABEL, LEAVE_LABEL, type HospitalClaimStage, type ProofInput } from '@prima/core';
import { api, type GuardProfile, type HiringDocKind } from '../api';
import { Chip, ErrorNotice, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import { DocList, ProofPicker } from './Proof';

/**
 * A worker's HR file (Shahirah, 26 Oct 2026): the hiring papers every worker must have, every MC uploaded and approved,
 * the hospitalisation claim papers with a tracker, and the claims and disciplinary policies in plain view.
 */

export function HiringChecklist({ d }: { d: GuardProfile }) {
  const h = d.hiring;
  const [adding, setAdding] = useState<HiringDocKind | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const missing = h.items.filter((i) => !i.done).length;
  const mcGap = h.mc.total - h.mc.withDoc;
  return (
    <section>
      <h3>Hiring checklist</h3>
      <div className="list">
        {h.items.map((i) => (
          <div key={i.kind} className="list-item" style={{ flexWrap: 'wrap' }}>
            <div>
              <div>{i.label}</div>
              <div className="muted small">{i.done ? `Uploaded by ${i.by}, ${dateTimeLabel(i.at!)}` : 'Not on file'}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Chip tone={i.done ? 'ok' : 'warn'}>{i.done ? 'On file' : 'Missing'}</Chip>
              {h.canUpload && adding !== i.kind && (
                <button className="btn btn-sm" onClick={() => setAdding(i.kind as HiringDocKind)}>
                  {i.done ? 'Replace' : 'Upload'}
                </button>
              )}
            </div>
            {adding === i.kind && <HiringUpload personId={d.person.id} kind={i.kind as HiringDocKind} onDone={() => setAdding(null)} />}
          </div>
        ))}
        <div className="list-item">
          <div>
            <div>Medical certificates (MC)</div>
            <div className="muted small">
              {h.mc.total} on record, {h.mc.withDoc} with the MC uploaded, {h.mc.approved} approved{h.mc.waiting ? `, ${h.mc.waiting} waiting` : ''}. Approved
              by the {h.mc.approver}.
            </div>
          </div>
          <Chip tone={mcGap ? 'crit' : h.mc.waiting ? 'warn' : 'ok'}>{mcGap ? `${mcGap} without MC` : h.mc.waiting ? 'Waiting' : 'Complete'}</Chip>
        </div>
      </div>
      <p className="muted small">
        {missing ? `${missing} paper${missing > 1 ? 's' : ''} missing. ` : 'All hiring papers on file. '}
        Every MC must be uploaded; the app does not accept sick leave without one.
      </p>
      {h.items.some((i) => i.done) && (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowDocs(!showDocs)}>
          {showDocs ? 'Hide the papers' : 'Open the papers'}
        </button>
      )}
      {showDocs && <PersonDocs personId={d.person.id} filter={(caption) => Object.values(HIRING_DOC_LABEL).includes(caption)} />}
    </section>
  );
}

function PersonDocs({ personId, filter }: { personId: string; filter: (caption: string) => boolean }) {
  const docs = useLoad(() => api.personDocs(personId), [personId]);
  if (docs.error) return <ErrorNotice error={docs.error} />;
  if (!docs.data) return <div className="muted small">Loading…</div>;
  return <DocList docs={docs.data.filter((x) => filter(x.caption))} />;
}

function HiringUpload({ personId, kind, onDone }: { personId: string; kind: HiringDocKind; onDone: () => void }) {
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <ProofPicker site={null} refText="HR" items={proof} onChange={setProof} documentsOnly required />
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length}
          onClick={async () => {
            if (await act.run(() => api.uploadHiringDoc(personId, kind, proof), 'Saved to the file.')) onDone();
          }}
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

const STAGE_TONE: Record<HospitalClaimStage, 'info' | 'warn' | 'ok' | 'crit'> = {
  collecting: 'warn',
  submitted: 'info',
  approved: 'ok',
  paid: 'ok',
  rejected: 'crit',
};
const NEXT_STAGE: Partial<Record<HospitalClaimStage, HospitalClaimStage>> = { collecting: 'submitted', submitted: 'approved', approved: 'paid' };

/** Hospitalisation: the claim papers and where the claim is, one card per stay. */
export function HospitalClaims({ d }: { d: GuardProfile }) {
  const stays = d.leave.requests.filter((q) => q.kind === 'HOSPITAL' && q.hospitalClaim);
  if (!stays.length) return null;
  return (
    <section>
      <h3>Hospitalisation claims</h3>
      {stays.map((q) => (
        <HospitalClaimCard key={q.id} q={q} canEdit={d.hiring.canUpload} />
      ))}
    </section>
  );
}

function HospitalClaimCard({ q, canEdit }: { q: GuardProfile['leave']['requests'][number]; canEdit: boolean }) {
  const c = q.hospitalClaim!;
  const act = useAction();
  const [adding, setAdding] = useState<string | null>(null);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [insurer, setInsurer] = useState(c.insurer ?? '');
  const [note, setNote] = useState('');
  const [log, setLog] = useState(false);
  const received = c.docs.filter((x) => x.status !== 'missing').length;
  const next = NEXT_STAGE[c.stage];
  const update = (input: Parameters<typeof api.updateHospitalClaim>[1], p: ProofInput[] = [], ok = 'Claim updated.') =>
    act.run(() => api.updateHospitalClaim(q.id, input, p), ok);
  return (
    <div className="panel" style={{ padding: 10, marginBottom: 10 }}>
      <div className="panel-head">
        <div>
          <div style={{ fontWeight: 600 }}>
            {dateLabel(q.from)}
            {q.to !== q.from ? ` to ${dateLabel(q.to)}` : ''} · {q.days} d
          </div>
          <div className="muted small">
            {q.clinic || 'Hospital not written'} · {received} of {c.docs.length} papers · {c.insurer ?? 'insurer not set'}
          </div>
        </div>
        <Chip tone={STAGE_TONE[c.stage]}>{HOSPITAL_STAGE_LABEL[c.stage]}</Chip>
      </div>
      <div className="list">
        {c.docs.map((x) => (
          <div key={x.item} className="list-item" style={{ flexWrap: 'wrap' }}>
            <div>
              <div>{HOSPITAL_DOC_LABEL[x.item]}</div>
              {x.at && (
                <div className="muted small">
                  {x.by}, {dateTimeLabel(x.at)}
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Chip tone={x.status === 'received' ? 'ok' : x.status === 'not_needed' ? 'neutral' : 'warn'}>
                {x.status === 'received' ? 'Received' : x.status === 'not_needed' ? 'Not needed' : 'Missing'}
              </Chip>
              {canEdit && c.stage === 'collecting' && x.status === 'missing' && adding !== x.item && (
                <>
                  <button className="btn btn-sm" onClick={() => (setAdding(x.item), setProof([]))}>
                    Add
                  </button>
                  {x.item === 'GUARANTEE_LETTER' && (
                    <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => update({ item: x.item, status: 'not_needed' })}>
                      Not needed
                    </button>
                  )}
                </>
              )}
            </div>
            {adding === x.item && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <ProofPicker site={null} refText="Hospital" items={proof} onChange={setProof} documentsOnly required />
                <div className="row">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={act.busy || !proof.length}
                    onClick={async () => {
                      if (await update({ item: x.item, status: 'received' }, proof, 'Paper received.')) setAdding(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {canEdit && next && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {c.stage === 'collecting' && (
            <label className="field">
              <span className="label">Insurer</span>
              <input
                className="input"
                value={insurer}
                onChange={(e) => setInsurer(e.target.value)}
                aria-label="Insurer"
                placeholder="Group hospitalisation insurer or SPIKPA"
              />
            </label>
          )}
          <label className="field">
            <span className="label">Note (claim number, reason)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Claim note" />
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={async () => {
                if (await update({ stage: next, insurer: c.stage === 'collecting' ? insurer : null, note })) setNote('');
              }}
            >
              Mark {HOSPITAL_STAGE_LABEL[next].toLowerCase()}
            </button>
            {c.stage === 'submitted' && (
              <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => update({ stage: 'rejected', note })}>
                Insurer rejected it
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <button className="btn btn-ghost btn-sm" onClick={() => setLog(!log)}>
        {log ? 'Hide history' : `History (${c.history.length})`}
      </button>
      {log && (
        <div className="list">
          {c.history.map((h, i) => (
            <div key={i} className="list-item">
              <span className="small">{h.text}</span>
              <span className="muted small">
                {h.by}, {dateTimeLabel(h.at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MedicalHistory({ d }: { d: GuardProfile }) {
  if (!d.medical) return null;
  return (
    <section>
      <h3>Illness details, last 12 months</h3>
      <div className="list">
        {d.medical.length === 0 && <div className="empty">No MC in the last 12 months.</div>}
        {d.medical.map((m) => (
          <div key={m.id} className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>{m.illness}</div>
              <div className="muted small">
                {LEAVE_LABEL[m.kind]} · {dateLabel(m.from)}
                {m.to !== m.from ? ` to ${dateLabel(m.to)}` : ''} ({m.days} d){m.clinic ? ` · ${m.clinic}` : ''}
              </div>
            </div>
            <Chip tone={m.status === 'approved' ? 'ok' : m.status === 'rejected' ? 'crit' : 'warn'}>{m.status}</Chip>
          </div>
        ))}
      </div>
      <p className="muted small">Medical details are seen only by the worker, their company and HR.</p>
    </section>
  );
}

export function ClaimsPolicy({ d, self }: { d: GuardProfile; self?: boolean }) {
  const r = d.policies.claims;
  return (
    <section>
      <h3>What can be claimed</h3>
      <div className="list">
        {r.value.map((c) => (
          <div key={c.clause} className="list-item">
            <div>
              <div>
                <span className="mono small">{c.clause}</span> {c.item}
              </div>
              {c.note && <div className="muted small">{c.note}</div>}
            </div>
            <Chip tone={c.covered === 'Yes' ? 'ok' : c.covered === 'No' ? 'crit' : 'info'}>{c.covered}</Chip>
          </div>
        ))}
      </div>
      <p className="muted small">
        {self ? null : <>{r.id} · Draft. {r.source}</>}
      </p>
    </section>
  );
}

export function DisciplinePolicy({ d }: { d: GuardProfile }) {
  const r = d.policies.discipline;
  return (
    <section>
      <details>
        <summary style={{ fontWeight: 600, cursor: 'pointer' }}>Disciplinary policy and who decides</summary>
        <div className="list" style={{ marginTop: 8 }}>
          {r.value.steps.map((s, i) => (
            <div key={s.step} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <div style={{ fontWeight: 600 }}>
                {i + 1}. {s.step}
              </div>
              <div className="small">{s.when}</div>
              <div className="muted small">
                Decided by: {s.by} · Kept on record: {s.keep}
              </div>
            </div>
          ))}
        </div>
        <ul className="small" style={{ paddingLeft: 18 }}>
          {r.value.principles.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="muted small">
          {r.id} · Draft. {r.source}
        </p>
      </details>
    </section>
  );
}
