import { useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';

/**
 * PDPA officer department check (Fauzan, 23 Nov 2026: "Do the gap"). The officer's Do today (B1), who downloaded
 * personal data (B2), the client's PDPA onboarding step (B3), lost or stolen devices and staff questions in one inbox
 * (B4, D2), the keep periods and the weekly clean-up OK (B5, D1). While the officer is away the Chief of Staff acts on
 * breaches, data requests and the inbox (D3).
 */

const TONE: Record<string, Tone> = { crit: 'crit', warn: 'warn', info: 'info', neutral: 'info', ok: 'ok' };

export function PdpaTodayPanel() {
  const { data, error } = useLoad(() => api.pdpaOfficerToday(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="Do today" />;
  if (!data.length) return null;
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head">
        <h3>Do today</h3>
        <Chip tone={data.some((d) => d.tone === 'crit') ? 'crit' : 'warn'}>{data.length}</Chip>
      </div>
      <div className="list">
        {data.map((t, i) => (
          <div className="list-item" key={i}>
            <div>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div className="muted small">{t.detail}</div>
            </div>
            <Chip tone={TONE[t.tone] ?? 'info'}>{t.tag}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Staff questions about their own data and lost or stolen devices, for the officer (or the Chief of Staff covering). */
export function InboxPanel() {
  const { data, error } = useLoad(() => api.pdpaOfficerInbox(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the inbox" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Inbox</h3>
        <Chip tone={data.rows.some((r) => !r.handled) ? 'warn' : 'ok'}>{data.rows.filter((r) => !r.handled).length} open</Chip>
      </div>
      {!data.installed && (
        <div className="notice" data-tone="warn" role="status">
          The inbox is not installed in the database yet (module pdpa-officer-v1). It is installed when the CEO runs the database update.
        </div>
      )}
      <p className="muted small" style={{ padding: '0 16px' }}>
        Questions staff send with the Ask about my data button, and lost or stolen devices reported to IT. A question becomes a data request with its 21 days counted from the day it was
        asked. A device is either a breach case (72 hours from the report) or closed with the reason no personal data was exposed.
      </p>
      <div className="list">
        {data.rows.length === 0 && <div className="empty">Nothing here.</div>}
        {data.rows.map((r) => (
          <InboxLine key={r.id} r={r} acts={!!data.acts} companies={data.companies} />
        ))}
      </div>
    </section>
  );
}

type InboxRow = Awaited<ReturnType<typeof api.pdpaOfficerInbox>>['rows'][number];

function InboxLine({ r, acts, companies }: { r: InboxRow; acts: boolean; companies: { id: string; name: string }[] }) {
  const [note, setNote] = useState('');
  const [companyId, setCompanyId] = useState('');
  const act = useAction();
  const run = (action: string) => act.run(() => api.pdpaOfficerAct('handle', { id: r.id, action, note, companyId: companyId || undefined }), 'Saved.');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.kind === 'ask' ? `${r.personName}: ${r.askKind?.toLowerCase().replace('_', ' ')}` : `Device: ${r.detail}`}
          </div>
          <div className="muted small">
            {r.kind === 'ask' ? r.detail : `Reported by ${r.personName}${r.sourceRef ? ` · ${r.sourceRef}` : ''}`} · {r.companyName ?? 'Group'} · {dateTimeLabel(r.at)}
          </div>
          {r.handled && (
            <div className="muted small">
              {r.handled.outcome.replace('_', ' ')}
              {r.handled.ref ? ` (${r.handled.ref})` : ''} · {r.handled.by}, {dateTimeLabel(r.handled.at)}
              {r.handled.note ? ` · ${r.handled.note}` : ''}
            </div>
          )}
        </div>
        <Chip tone={r.handled ? 'ok' : r.kind === 'device' ? 'crit' : 'warn'}>{r.handled ? 'Handled' : `${r.daysOpen} day${r.daysOpen === 1 ? '' : 's'} open`}</Chip>
      </div>
      {acts && !r.handled && (
        <>
          {r.kind === 'ask' && !r.companyId && (
            <select className="select" aria-label="Company that holds the data" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Company that holds the data</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <input className="input" aria-label="Note" placeholder={r.kind === 'device' ? 'Why no personal data was exposed (to close)' : 'Reason (to close without a request)'} value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {r.kind === 'ask' ? (
              <>
                <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => run('request')}>
                  Log as data request
                </button>
                <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => run('close')}>
                  Close with reason
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => run('breach')}>
                  Open a breach case
                </button>
                <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => run('no_breach')}>
                  No personal data exposed
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Who downloaded pay, medical, bank or personal details, when and why (read only). */
export function DownloadsPanel() {
  const { data, error } = useLoad(() => api.pdpaOfficerDownloads(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="downloads" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Personal data downloads</h3>
        <Chip tone="info">{`Last ${data.days} days`}</Chip>
      </div>
      <p className="muted small" style={{ padding: '0 16px' }}>
        Every download of pay, medical, bank or personal details, with the reason the person gave. Each file carries its reference. Read only.
      </p>
      {data.top.length > 0 && (
        <div className="muted small" style={{ padding: '0 16px 8px' }}>
          Most rows downloaded: {data.top.map((t) => `${t.by} (${t.rows})`).join(', ')}
        </div>
      )}
      <div className="list">
        {data.rows.length === 0 && <div className="empty">No downloads of personal data.</div>}
        {data.rows.map((r) => (
          <div className="list-item" key={`${r.ref}-${r.at}`}>
            <div>
              <div style={{ fontWeight: 600 }}>
                {r.by} · {r.screen} · {r.rows} row{r.rows === 1 ? '' : 's'}
              </div>
              <div className="muted small">
                {dateTimeLabel(r.at)} · {r.company} · reason: {r.reason || 'none given'} · {r.ref}
              </div>
            </div>
            <Chip tone={r.sensitivity === 'medical' || r.sensitivity === 'bank' ? 'warn' : 'info'}>{r.sensitivity ?? ''}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

/** B3: clients whose PDPA onboarding step is open; only the PDPA officer closes it. */
export function ClientStepsPanel({ officer }: { officer: boolean }) {
  const { data, error } = useLoad(() => api.pdpaOfficerClientSteps(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="client onboarding" />;
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head">
        <h3>Client onboarding: PDPA step</h3>
        <Chip tone={data.length ? 'warn' : 'ok'}>{data.length} open</Chip>
      </div>
      <p className="muted small" style={{ padding: '0 16px' }}>
        A new client becomes active only when the PDPA officer closes this step: from the client's signed consent, or with the reason no consent is needed.
      </p>
      <div className="list">
        {data.length === 0 && <div className="empty">No client is waiting.</div>}
        {data.map((s) => (
          <ClientStepLine key={s.accountId} s={s} officer={officer} />
        ))}
      </div>
    </section>
  );
}

type ClientStepRow = Awaited<ReturnType<typeof api.pdpaOfficerClientSteps>>[number];

function ClientStepLine({ s, officer }: { s: ClientStepRow; officer: boolean }) {
  const [caseId, setCaseId] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  const given = s.consentCases.filter((c) => c.decision === 'given');
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{s.client}</div>
          <div className="muted small">
            {s.companyName} · {s.stage} · {s.consentCases.length ? s.consentCases.map((c) => `${c.product}: ${c.decision}`).join(', ') : 'no client consent case yet'}
          </div>
        </div>
        <Chip tone="warn">PDPA step open</Chip>
      </div>
      {officer && (
        <>
          <select className="select" aria-label="Client consent case" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">No consent needed (say why below)</option>
            {given.map((c) => (
              <option key={c.id} value={c.id}>
                Consent given: {c.product} ({c.title})
              </option>
            ))}
          </select>
          <input className="input" aria-label="Note" placeholder={caseId ? 'Note (optional)' : 'Why no consent is needed, e.g. no camera or tracker at this client'} value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || (!caseId && note.trim().length < 10)}
              onClick={() => act.run(() => api.pdpaOfficerAct('client-step', { accountId: s.accountId, caseId: caseId || undefined, note }), 'Step closed.')}
            >
              Close the PDPA step
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** B5 and D1: every keep period in one list, the clean-up runs and the PDPA officer's weekly OK. */
export function KeepPanel() {
  const { data, error } = useLoad(() => api.pdpaOfficerKeep(), []);
  const [reason, setReason] = useState('');
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="keep periods" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Keep periods</h3>
        <Chip tone={data.ok ? 'ok' : 'warn'}>{data.ok ? `Clean-up OK until ${dateLabel(data.ok.validUntil)}` : 'No clean-up OK this week'}</Chip>
      </div>
      <div className="list">
        {data.rows.map((r) => (
          <div className="list-item" key={r.what}>
            <div>
              <div style={{ fontWeight: 600 }}>{r.what}</div>
              <div className="muted small">
                {r.keep} · {r.how} · rule {r.rule} ({r.label})
              </div>
            </div>
            <Chip tone={r.state === 'unknown' ? 'warn' : 'ok'}>{r.state === 'unknown' ? 'Unknown' : 'Set'}</Chip>
          </div>
        ))}
      </div>
      <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontWeight: 600 }}>Clean-up of data past its keep period</div>
        <div className="muted small">
          The daily clean-up deletes site gate records, CMS clips and location readings past their keep period only while your OK is valid ({data.okDays} days). Records on an open legal
          hold or a case are never deleted.
        </div>
        {!data.installed && (
          <div className="notice" data-tone="warn" role="status">
            The clean-up OK is not installed in the database yet (module pdpa-officer-v1). Until it is, the clean-up deletes nothing.
          </div>
        )}
        {data.canOk && !data.ok && (
          <>
            <input className="input" aria-label="What you checked" placeholder="What you checked, e.g. no open legal hold or case needs the records due" value={reason} onChange={(e) => setReason(e.target.value)} />
            <ErrorNotice error={act.error} />
            <div>
              <button className="btn btn-primary btn-sm" disabled={act.busy || reason.trim().length < 10} onClick={() => act.run(() => api.pdpaOfficerAct('purge-ok', { reason }), 'OK given.').then((x) => x && setReason(''))}>
                Give this week's OK
              </button>
            </div>
          </>
        )}
      </div>
      {data.oks.length > 0 && (
        <div className="list">
          {data.oks.map((o) => (
            <div className="list-item" key={o.id}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  OK {dateLabel(o.okOn)} to {dateLabel(o.validUntil)} · {o.by}
                </div>
                <div className="muted small">
                  {o.reason} · {o.runs.length ? o.runs.map((x) => `${dateTimeLabel(x.at)}: ${x.what}`).join('; ') : 'no run yet'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {data.runs.length > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {data.runs.map((r, i) => (
            <div className="list-item" key={i}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.summary}</div>
                <div className="muted small">
                  {r.by} · {dateTimeLabel(r.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** D2: any staff member asks the PDPA officer about their own personal data (on My details). */
export function AskMyDataPanel() {
  const { data, error } = useLoad(() => api.pdpaMyAsks(), []);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [detail, setDetail] = useState('');
  const act = useAction();
  if (error || !data || !data.installed) return null;
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head">
        <h3>My personal data (PDPA)</h3>
        {!open && (
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Ask about my data
          </button>
        )}
      </div>
      <p className="muted small" style={{ padding: '0 16px' }}>
        You may ask to see, correct or take a copy of your personal data, withdraw a consent or stop a use of it. The PDPA officer answers within {data.days} days. Tanya pegawai PDPA tentang
        data peribadi anda.
      </p>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 16px 12px' }}>
          <select className="select" aria-label="What you want" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">What do you want to do?</option>
            {data.kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.en} / {k.bm}
              </option>
            ))}
          </select>
          <textarea className="textarea" aria-label="Which data" placeholder="Which data, in a few words" value={detail} onChange={(e) => setDetail(e.target.value)} />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || !kind || detail.trim().length < 5}
              onClick={() =>
                act.run(() => api.pdpaOfficerAct('ask', { kind, detail }), 'Sent to the PDPA officer.').then((r) => {
                  if (r) {
                    setOpen(false);
                    setKind('');
                    setDetail('');
                  }
                })
              }
            >
              Send
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {data.rows.length > 0 && (
        <div className="list">
          {data.rows.map((r) => (
            <div className="list-item" key={r.id}>
              <div>
                <div style={{ fontWeight: 600 }}>{data.kinds.find((k) => k.kind === r.askKind)?.en ?? r.askKind}</div>
                <div className="muted small">
                  {r.detail} · asked {dateLabel(r.at.slice(0, 10))}
                  {r.handled ? ` · ${r.handled.outcome === 'request' ? `logged as ${r.handled.ref}` : r.handled.note || 'closed'}` : ` · answer due by ${dateLabel(r.dueOn)}`}
                </div>
              </div>
              <Chip tone={r.handled ? 'ok' : 'warn'}>{r.handled ? (r.handled.outcome === 'request' ? 'Being answered' : 'Closed') : 'Sent'}</Chip>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
