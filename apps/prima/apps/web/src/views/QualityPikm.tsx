/**
 * E9 PIKM records (Fauzan, 11 Nov 2026: "Tell Fitri to build"), a tab of Quality and compliance: the yearly medical
 * for guards 56 and over, the site risk briefing before deployment, personnel files kept 7 years, the client
 * information pack, and the office alarm and CCTV records. Each section shows only to the people who work it; the
 * server checks every step, and nobody checks or approves their own record.
 */
import { Select } from '../SearchSelect';
import { useState } from 'react';
import { MEDICAL_RESULT_LABEL, type MedicalResult, type PikmRecord, type ProofInput } from '@prima/core';
import { api, type PikmBoard } from '../api';
import { Card, Empty } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { Decide, todayMyt } from './newa-shared';

type Board = Extract<PikmBoard, { ready: true }>;
type Part = 'medical' | 'briefing' | 'retention' | 'pack' | 'systems';

const STATUS: Record<PikmRecord['status'], { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting for a check', tone: 'warn' },
  checked: { label: 'Checked', tone: 'ok' },
  returned: { label: 'Sent back', tone: 'crit' },
  cleared: { label: 'Cleared', tone: 'ok' },
  refused: { label: 'Refused', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'info' },
  sent: { label: 'Sent', tone: 'ok' },
};

function Status({ r }: { r: PikmRecord }) {
  return <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Chip>;
}

function Who({ r }: { r: PikmRecord }) {
  return (
    <div className="nw-steps">
      <span data-done="true">
        <span>Recorded by</span> {r.recorded.by}
      </span>
      {r.decided && (
        <span data-done={r.decided.ok}>
          <span>{r.decided.ok ? 'Checked by' : 'Sent back by'}</span> {r.decided.by} · “{r.decided.note}”
        </span>
      )}
    </div>
  );
}

function useStep() {
  const act = useAction();
  const run = (action: string, body: Record<string, unknown>, done: string) => act.run(() => api.pikmAct(action, body), done);
  return { act, run };
}

// ---------- Medical ----------

function MedicalForm({ b, personId, onDone }: { b: Board; personId: string; onDone: () => void }) {
  const [f, setF] = useState({ examinedOn: todayMyt(), result: 'fit' as MedicalResult, restrictions: '', clinic: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const { act, run } = useStep();
  const who = b.medical!.due.find((d) => d.personId === personId);
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">Date of the medical</span>
          <input className="input" type="date" value={f.examinedOn} onChange={(e) => setF({ ...f, examinedOn: e.target.value })} aria-label="Date of the medical" />
        </label>
        <label className="field">
          <span className="label">Result</span>
          <Select className="input" aria-label="Result" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as MedicalResult })}>
            {(Object.keys(MEDICAL_RESULT_LABEL) as MedicalResult[]).map((k) => (
              <option key={k} value={k}>
                {MEDICAL_RESULT_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Clinic or doctor</span>
          <input className="input" value={f.clinic} onChange={(e) => setF({ ...f, clinic: e.target.value })} aria-label="Clinic or doctor" />
        </label>
        {f.result !== 'fit' && (
          <label className="field nw-wide">
            <span className="label">Restrictions the doctor gave</span>
            <input className="input" value={f.restrictions} onChange={(e) => setF({ ...f, restrictions: e.target.value })} aria-label="Restrictions the doctor gave" />
          </label>
        )}
      </div>
      <ProofPicker site={null} refText={who?.staffNo ?? 'Medical'} items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !proof.length}
          onClick={async () => {
            const ok = await run('medical_record', { personId, ...f, proof }, 'Medical recorded. Another HR person checks it.');
            if (ok) onDone();
          }}
        >
          Save the medical
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function MedicalPart({ b }: { b: Board }) {
  const m = b.medical!;
  const [open, setOpen] = useState<string | null>(null);
  const { act, run } = useStep();
  return (
    <div className="nw-stack">
      <Card title="Guards due for the yearly medical" sub={`PIKM 7.1: every guard and officer aged ${m.fromAge} and over sees a doctor every 12 months. Shown 60 days before it is due.`}>
        {m.due.length === 0 ? (
          <Empty title="Nobody is due." />
        ) : (
          <div className="nw-list">
            {m.due.map((d) => (
              <div key={d.personId} className="nw-item">
                <div className="nw-item-main">
                  <strong>
                    {d.name} ({d.staffNo})
                  </strong>
                  <span className="nw-note">
                    {d.companyName} · {d.age}
                  </span>
                </div>
                <div className="nw-item-side">{d.dueOn ? dateLabel(d.dueOn) : ''}</div>
                <div className="nw-item-end">
                  <Chip tone={d.state === 'due_soon' ? 'warn' : 'crit'}>{d.state === 'missing' ? 'No medical on record' : d.state === 'overdue' ? 'Overdue' : 'Due soon'}</Chip>
                  {m.canRecord && open !== d.personId && (
                    <button className="btn btn-sm" onClick={() => setOpen(d.personId)}>
                      Record the medical
                    </button>
                  )}
                </div>
                {open === d.personId && <MedicalForm b={b} personId={d.personId} onDone={() => setOpen(null)} />}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Medical records">
        <ErrorNotice error={act.error} />
        {m.rows.length === 0 ? (
          <Empty title="No medical recorded yet." />
        ) : (
          <div className="nw-list">
            {m.rows.map(({ record: r, person, companyName, canCheck }) => (
              <div key={r.id} className="nw-item">
                <div className="nw-item-main">
                  <strong>{person}</strong>
                  <span className="nw-note">
                    {MEDICAL_RESULT_LABEL[r.result!]}
                    {r.restrictions ? ` · ${r.restrictions}` : ''} · {r.clinic}
                  </span>
                  <Who r={r} />
                </div>
                <div className="nw-item-side">
                  <span>{companyName}</span>
                  <span>
                    {dateLabel(r.examinedOn!)} → {dateLabel(r.nextDueOn!)}
                  </span>
                </div>
                <div className="nw-item-end">
                  <Status r={r} />
                </div>
                {canCheck && (
                  <div className="nw-item-act">
                    <Decide busy={act.busy} approveLabel="Checked" refuseLabel="Send back" placeholder="Comment (needed to check or send back)" onDecide={(ok, note) => void run('medical_check', { id: r.id, ok, note }, ok ? 'Checked.' : 'Sent back.')} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Briefing ----------

function BriefingForm({ b, onDone }: { b: Board; onDone: () => void }) {
  const br = b.briefing!;
  const [siteId, setSiteId] = useState(br.toBrief[0]?.siteId ?? br.sites[0]?.id ?? '');
  const site = br.sites.find((s) => s.id === siteId);
  const suggested = br.toBrief.filter((x) => x.siteId === siteId).map((x) => x.personId);
  const [picked, setPicked] = useState<string[]>(suggested);
  const [briefedOn, setBriefedOn] = useState(todayMyt());
  const [risks, setRisks] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const { act, run } = useStep();
  const guards = br.guards.filter((g) => g.companyId === site?.companyId);
  return (
    <div className="nw-stack">
      <div className="nw-form">
        <label className="field">
          <span className="label">Site</span>
          <Select
            className="input"
            aria-label="Site"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setPicked(br.toBrief.filter((x) => x.siteId === e.target.value).map((x) => x.personId));
            }}
          >
            {br.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="label">Date of the briefing</span>
          <input className="input" type="date" value={briefedOn} onChange={(e) => setBriefedOn(e.target.value)} aria-label="Date of the briefing" />
        </label>
        <label className="field nw-wide">
          <span className="label">The site risks explained</span>
          <textarea className="input" rows={3} value={risks} onChange={(e) => setRisks(e.target.value)} aria-label="The site risks explained" />
        </label>
        <label className="field nw-wide">
          <span className="label">Who was briefed</span>
          <Select
            className="input"
            aria-label="Who was briefed"
            multiple
            value={picked}
            onChange={(e) => setPicked([...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value))}
            style={{ minHeight: 120 }}
          >
            {guards.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.staffNo})
              </option>
            ))}
          </Select>
        </label>
      </div>
      <ProofPicker site={null} refText="Briefing" items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button
          className="btn btn-primary"
          disabled={act.busy || !proof.length || !picked.length}
          onClick={async () => {
            const ok = await run('briefing_record', { siteId, briefedOn, risks, personIds: picked, proof }, 'Briefing recorded. Another person checks it.');
            if (ok) onDone();
          }}
        >
          Save the briefing
        </button>
        <button className="btn" onClick={onDone}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function BriefingPart({ b }: { b: Board }) {
  const br = b.briefing!;
  const [open, setOpen] = useState(false);
  const { act, run } = useStep();
  return (
    <div className="nw-stack">
      <Card
        title="Guards to brief before their first shift"
        sub="PIKM 9.4: the guards hear the site's risks before they start there. Guards rostered at a site for the first time in the next 7 days."
        actions={
          br.canRecord && !open ? (
            <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
              Record a briefing
            </button>
          ) : undefined
        }
      >
        {open ? (
          <BriefingForm b={b} onDone={() => setOpen(false)} />
        ) : br.toBrief.length === 0 ? (
          <Empty title="Nobody to brief." />
        ) : (
          <div className="nw-list">
            {br.toBrief.map((x) => (
              <div key={`${x.siteId}-${x.personId}`} className="nw-item">
                <div className="nw-item-main">
                  <strong>{x.name}</strong>
                  <span className="nw-note">
                    {x.siteName} · {x.companyName}
                  </span>
                </div>
                <div className="nw-item-side">
                  <span>First shift</span> {dateLabel(x.firstOn)}
                </div>
                <div className="nw-item-end">
                  <Chip tone="warn">To brief</Chip>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Briefings recorded">
        <ErrorNotice error={act.error} />
        {br.rows.length === 0 ? (
          <Empty title="No briefing recorded yet." />
        ) : (
          <div className="nw-list">
            {br.rows.map(({ record: r, siteName, people, companyName, canCheck }) => (
              <div key={r.id} className="nw-item">
                <div className="nw-item-main">
                  <strong>{siteName}</strong>
                  <span className="nw-note">{r.risks}</span>
                  <span className="nw-note">{people.join(', ')}</span>
                  <Who r={r} />
                </div>
                <div className="nw-item-side">
                  <span>{companyName}</span>
                  <span>{dateLabel(r.briefedOn!)}</span>
                </div>
                <div className="nw-item-end">
                  <Status r={r} />
                </div>
                {canCheck && (
                  <div className="nw-item-act">
                    <Decide busy={act.busy} approveLabel="Checked" refuseLabel="Send back" placeholder="Comment (needed to check or send back)" onDecide={(ok, note) => void run('briefing_check', { id: r.id, ok, note }, ok ? 'Checked.' : 'Sent back.')} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Retention ----------

function RetentionPart({ b }: { b: Board }) {
  const rt = b.retention!;
  const [note, setNote] = useState('');
  const { act, run } = useStep();
  return (
    <div className="nw-stack">
      <Card title="Personnel files of people who left" sub={`Kept ${rt.keepYears} years after the last working day (PIKM). After that HR may propose clearing a file; the HR Director decides. A file under a legal hold stays. Prima never deletes the record line.`}>
        <ErrorNotice error={act.error} />
        {rt.files.length === 0 ? (
          <Empty title="Nobody has left yet." />
        ) : (
          <div className="nw-list">
            {rt.files.map((f) => (
              <div key={f.personId} className="nw-item">
                <div className="nw-item-main">
                  <strong>
                    {f.name} ({f.staffNo})
                  </strong>
                  <span className="nw-note">{f.companyName}</span>
                </div>
                <div className="nw-item-side">
                  <span>
                    <span>Last day</span> {dateLabel(f.lastDayOn)}
                  </span>
                  <span>
                    <span>Kept until</span> {dateLabel(f.keepUntil)}
                  </span>
                </div>
                <div className="nw-item-end">
                  {f.mayClear && rt.canPropose ? (
                    <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => void run('retention_propose', { personId: f.personId, note }, 'Proposed. The HR Director decides.')}>
                      Propose clearing
                    </button>
                  ) : (
                    <Chip tone="neutral">Kept</Chip>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {rt.canPropose && rt.files.some((f) => f.mayClear) && (
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason for clearing" placeholder="Reason for clearing (needed)" style={{ marginTop: 8 }} />
        )}
      </Card>
      {rt.rows.length > 0 && (
        <Card title="Proposals to clear a file">
          <div className="nw-list">
            {rt.rows.map(({ record: r, person, companyName, canDecide }) => (
              <div key={r.id} className="nw-item">
                <div className="nw-item-main">
                  <strong>{person}</strong>
                  <span className="nw-note">“{r.recorded.note}”</span>
                  <Who r={r} />
                </div>
                <div className="nw-item-side">
                  <span>{companyName}</span>
                  <span>
                    <span>Kept until</span> {dateLabel(r.keepUntil!)}
                  </span>
                </div>
                <div className="nw-item-end">
                  <Status r={r} />
                </div>
                {canDecide && (
                  <div className="nw-item-act">
                    <Decide busy={act.busy} approveLabel="Clear the file" refuseLabel="Keep the file" onDecide={(ok, note2) => void run('retention_decide', { id: r.id, ok, note: note2 }, ok ? 'Cleared.' : 'Kept.')} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Client pack ----------

function PackPart({ b }: { b: Board }) {
  const cp = b.clientPack!;
  const [f, setF] = useState({ companyId: b.companies[0]?.id ?? '', clientName: '', membership: '' });
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState({ on: todayMyt(), to: '', how: 'Email' });
  const { act, run } = useStep();
  return (
    <div className="nw-stack">
      {cp.canPrepare && (
        <Card title="Prepare a client information pack" sub="PIKM 9.3: on request, the client gets the licence, the company registration, the membership and the insurance. Prima fills them from the records; the company manager or the ACT Director approves before it goes.">
          <div className="nw-form">
            {b.companies.length > 1 && (
              <label className="field">
                <span className="label">Company</span>
                <Select className="input" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
                  {b.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="field">
              <span className="label">Client who asked</span>
              <input className="input" value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} aria-label="Client who asked" />
            </label>
            <label className="field">
              <span className="label">Association membership (number)</span>
              <input className="input" value={f.membership} onChange={(e) => setF({ ...f, membership: e.target.value })} aria-label="Association membership (number)" />
            </label>
          </div>
          <div className="nw-actions" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" disabled={act.busy || f.clientName.trim().length < 3} onClick={() => void run('pack_prepare', f, 'Pack prepared. The company manager approves it.')}>
              Prepare the pack
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </Card>
      )}
      <Card title="Client packs">
        {cp.rows.length === 0 ? (
          <Empty title="No pack prepared yet." />
        ) : (
          <div className="nw-list">
            {cp.rows.map(({ record: r, companyName, canDecide, canSend }) => (
              <div key={r.id} className="nw-item">
                <div className="nw-item-main">
                  <strong>{r.clientName}</strong>
                  <div className="nw-steps">
                    {(r.items ?? []).map((i) => (
                      <span key={i.key} data-done={i.ok}>
                        {i.ok ? '✓' : '✗'} <span>{i.label}</span>
                        {i.expiresOn ? ` · ${dateLabel(i.expiresOn)}` : ''}
                      </span>
                    ))}
                  </div>
                  <Who r={r} />
                  {r.sent && (
                    <span className="nw-note">
                      <span>Sent</span> {dateLabel(r.sent.on)} · {r.sent.to} · {r.sent.how}
                    </span>
                  )}
                </div>
                <div className="nw-item-side">{companyName}</div>
                <div className="nw-item-end">
                  <Status r={r} />
                  {canSend && sending !== r.id && (
                    <button className="btn btn-sm" onClick={() => setSending(r.id)}>
                      Record it sent
                    </button>
                  )}
                </div>
                {canDecide && (
                  <div className="nw-item-act">
                    <Decide busy={act.busy} onDecide={(ok, note) => void run('pack_decide', { id: r.id, ok, note }, ok ? 'Approved. Send it to the client.' : 'Refused.')} />
                  </div>
                )}
                {sending === r.id && (
                  <div className="nw-item-act">
                    <div className="nw-form">
                      <label className="field">
                        <span className="label">Date sent</span>
                        <input className="input" type="date" value={sent.on} onChange={(e) => setSent({ ...sent, on: e.target.value })} aria-label="Date sent" />
                      </label>
                      <label className="field">
                        <span className="label">Sent to</span>
                        <input className="input" value={sent.to} onChange={(e) => setSent({ ...sent, to: e.target.value })} aria-label="Sent to" />
                      </label>
                      <label className="field">
                        <span className="label">How</span>
                        <input className="input" value={sent.how} onChange={(e) => setSent({ ...sent, how: e.target.value })} aria-label="How" />
                      </label>
                    </div>
                    <div className="nw-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={act.busy}
                        onClick={async () => {
                          const ok = await run('pack_sent', { id: r.id, ...sent }, 'Recorded as sent.');
                          if (ok) setSending(null);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Office alarm and CCTV ----------

function VisitForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [f, setF] = useState({ on: todayMyt(), contractor: '', result: '', nextServiceOn: '' });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const { act, run } = useStep();
  return (
    <div className="nw-item-act">
      <div className="nw-form">
        <label className="field">
          <span className="label">Service date</span>
          <input className="input" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} aria-label="Service date" />
        </label>
        <label className="field">
          <span className="label">Serviced by</span>
          <input className="input" value={f.contractor} onChange={(e) => setF({ ...f, contractor: e.target.value })} aria-label="Serviced by" />
        </label>
        <label className="field">
          <span className="label">Next service</span>
          <input className="input" type="date" value={f.nextServiceOn} onChange={(e) => setF({ ...f, nextServiceOn: e.target.value })} aria-label="Next service" />
        </label>
        <label className="field nw-wide">
          <span className="label">What they found</span>
          <input className="input" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} aria-label="What they found" />
        </label>
      </div>
      <ProofPicker site={null} refText="Service" items={proof} onChange={setProof} documentsOnly required />
      <div className="nw-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !proof.length}
          onClick={async () => {
            const ok = await run('system_visit', { id, ...f, proof }, 'Service visit recorded. ACT checks it.');
            if (ok) onDone();
          }}
        >
          Save the visit
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function SystemsPart({ b }: { b: Board }) {
  const os = b.officeSystems!;
  const [adding, setAdding] = useState(false);
  const [visit, setVisit] = useState<string | null>(null);
  const [f, setF] = useState({ companyId: b.companies[0]?.id ?? '', system: 'alarm', installer: '', place: '', installedOn: '', nextServiceOn: '' });
  const { act, run } = useStep();
  const dueTone: Record<string, Tone> = { overdue: 'crit', due_soon: 'warn', ok: 'ok', unknown: 'neutral' };
  const dueLabel: Record<string, string> = { overdue: 'Service overdue', due_soon: 'Service due soon', ok: 'Service up to date', unknown: 'No service date' };
  return (
    <Card
      title="Office alarm and CCTV"
      sub="PIKM 6.3: who installed each office alarm and CCTV, every service visit with the report, and the next service. ACT checks the record."
      actions={
        os.canRecord && !adding ? (
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            Add an alarm or CCTV
          </button>
        ) : undefined
      }
    >
      <div className="nw-stack">
        {adding && (
          <div className="nw-stack">
            <div className="nw-form">
              {b.companies.length > 1 && (
                <label className="field">
                  <span className="label">Company</span>
                  <Select className="input" aria-label="Company" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
                    {b.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <label className="field">
                <span className="label">System</span>
                <Select className="input" aria-label="System" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })}>
                  <option value="alarm">Intruder alarm</option>
                  <option value="cctv">CCTV</option>
                </Select>
              </label>
              <label className="field">
                <span className="label">Office</span>
                <input className="input" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} aria-label="Office" />
              </label>
              <label className="field">
                <span className="label">Installer</span>
                <input className="input" value={f.installer} onChange={(e) => setF({ ...f, installer: e.target.value })} aria-label="Installer" />
              </label>
              <label className="field">
                <span className="label">Installed on</span>
                <input className="input" type="date" value={f.installedOn} onChange={(e) => setF({ ...f, installedOn: e.target.value })} aria-label="Installed on" />
              </label>
              <label className="field">
                <span className="label">Next service</span>
                <input className="input" type="date" value={f.nextServiceOn} onChange={(e) => setF({ ...f, nextServiceOn: e.target.value })} aria-label="Next service" />
              </label>
            </div>
            <div className="nw-actions">
              <button
                className="btn btn-primary"
                disabled={act.busy}
                onClick={async () => {
                  const ok = await run('system_record', f, 'Recorded.');
                  if (ok) setAdding(false);
                }}
              >
                Save
              </button>
              <button className="btn" onClick={() => setAdding(false)}>
                Close
              </button>
            </div>
          </div>
        )}
        <ErrorNotice error={act.error} />
        {os.rows.length === 0 ? (
          <Empty title="No office alarm or CCTV on record." />
        ) : (
          <div className="nw-list">
            {os.rows.map(({ record: r, companyName, due, canVisit, canCheck }) => (
              <div key={r.id} className="nw-item">
                <div className="nw-item-main">
                  <strong>
                    {r.system === 'alarm' ? 'Intruder alarm' : 'CCTV'} · {r.place}
                  </strong>
                  <span className="nw-note">
                    <span>Installer</span> {r.installer}
                    {r.installedOn ? ` · ${dateLabel(r.installedOn)}` : ''}
                  </span>
                  {(r.visits ?? []).slice(-3).map((v, i) => (
                    <span key={i} className="nw-note">
                      {dateLabel(v.on)} · {v.contractor}: {v.result}
                    </span>
                  ))}
                  <Who r={r} />
                </div>
                <div className="nw-item-side">
                  <span>{companyName}</span>
                  {r.nextServiceOn && (
                    <span>
                      <span>Next service</span> {dateLabel(r.nextServiceOn)}
                    </span>
                  )}
                </div>
                <div className="nw-item-end">
                  <Chip tone={dueTone[due]}>{dueLabel[due]}</Chip>
                  <Status r={r} />
                  {canVisit && visit !== r.id && (
                    <button className="btn btn-sm" onClick={() => setVisit(r.id)}>
                      Record a service visit
                    </button>
                  )}
                </div>
                {visit === r.id && <VisitForm id={r.id} onDone={() => setVisit(null)} />}
                {canCheck && (
                  <div className="nw-item-act">
                    <Decide busy={act.busy} approveLabel="Checked" refuseLabel={null} placeholder="Comment (needed to check)" onDecide={(_ok, note) => void run('system_check', { id: r.id, note }, 'Checked.')} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** The "PIKM records" tab of Quality and compliance. */
export function PikmPanel() {
  const { data, error } = useLoad(() => api.pikmBoard(), []);
  const [pick, setPick] = useState<Part | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="PIKM records" />;
  if (!data.ready)
    return (
      <Card>
        <Empty title="PIKM records are not switched on yet.">The database part waits for the CEO to install it.</Empty>
      </Card>
    );
  const parts = (
    [
      ['medical', 'Medical 56+', !!data.medical, data.medical?.due.length ?? 0],
      ['briefing', 'Risk briefing', !!data.briefing, data.briefing?.toBrief.length ?? 0],
      ['retention', '7-year records', !!data.retention, data.retention?.rows.filter((r) => r.canDecide).length ?? 0],
      ['pack', 'Client pack', !!data.clientPack, data.clientPack?.rows.filter((r) => r.canDecide).length ?? 0],
      ['systems', 'Alarm and CCTV', !!data.officeSystems, data.officeSystems?.rows.filter((r) => r.due !== 'ok').length ?? 0],
    ] as [Part, string, boolean, number][]
  ).filter((p) => p[2]);
  if (!parts.length) return <Empty title="Nothing here for your job." />;
  const part = pick && parts.some((p) => p[0] === pick) ? pick : parts[0][0];
  return (
    <div className="nw-stack">
      <div className="nw-tabs" role="tablist" aria-label="PIKM records">
        {parts.map(([id, label, , count]) => (
          <button key={id} role="tab" className="btn btn-sm" aria-selected={part === id} data-active={part === id || undefined} onClick={() => setPick(id)}>
            {label}
            {count > 0 && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </div>
      {part === 'medical' && <MedicalPart b={data} />}
      {part === 'briefing' && <BriefingPart b={data} />}
      {part === 'retention' && <RetentionPart b={data} />}
      {part === 'pack' && <PackPart b={data} />}
      {part === 'systems' && <SystemsPart b={data} />}
    </div>
  );
}
