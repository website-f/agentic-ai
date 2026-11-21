import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { useApp } from '../App';
import { api, type SelfAuditBoard } from '../api';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { ClientCodesPanel, FixForm } from './ClientCodes';
import { ProofPicker } from './Proof';
import { SopHelp } from '../sop/SopHelp';

/**
 * The company's yearly self-audit (Fauzan, 6 Nov 2026: "a self audit must be done by company every year. With reminder.
 * In company or in each site or everything"). The Company Manager or the company's admin executives do it; ACT and group
 * leadership see it. Each site's client requirements open from here too, so ACT can reach them.
 */

const STATE: Record<SelfAuditBoard['status'][number]['state'], { t: string; tone: Tone }> = {
  not_done: { t: 'Not done yet', tone: 'warn' },
  ok: { t: 'Done', tone: 'ok' },
  soon: { t: 'Due soon', tone: 'info' },
  due: { t: 'Due now', tone: 'crit' },
  overdue: { t: 'Overdue', tone: 'crit' },
};

export function SelfAuditView() {
  const { companyId } = useApp();
  const board = useLoad(() => api.selfAuditBoard(companyId), [companyId]);
  const [form, setForm] = useState(false);
  const [codesFor, setCodesFor] = useState<string | null>(null);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  if (board.error)
    return (
      <div className="page">
        <ErrorNotice error={board.error} />
      </div>
    );
  if (!board.data)
    return (
      <div className="page">
        <Loading what="self-audit" />
      </div>
    );
  const b = board.data;
  const codesSite = codesFor ? b.status.find((r) => r.siteId === codesFor) : undefined;
  const openedAudit = openAudit ? b.audits.find((a) => a.id === openAudit) : undefined;
  if (form)
    return (
      <div className="page">
        <SelfAuditForm b={b} onDone={() => setForm(false)} />
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <h1>Yearly self-audit: {b.company.name}</h1>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
          {b.canDo && (
            <button className="btn btn-primary" onClick={() => setForm(true)}>
              Do a self-audit
            </button>
          )}
          <SopHelp id="gov-self-audit" />
        </span>
      </div>
      <span className="muted small">
        Every company checks itself once every {b.rule.value.selfAuditEveryMonths} months: the company office, each site, or everything at once. Reminders come {b.rule.value.selfAuditRemindDays.join(', ')} days before it is due.
        {!b.canDo && ' The Company Manager or the company\'s admin executives do it; you can see it.'}
      </span>
      <section className="panel">
        <div className="panel-head">
          <h3>Where it stands</h3>
        </div>
        {/* P107: the company office and each site as a table; "Client requirements" opens that site's list under it. */}
        <DataTable
          label="Where it stands"
          stateKey="gov.selfaudit.status"
          rows={b.status}
          rowKey={(r) => r.siteId ?? 'company'}
          columns={STATUS_COLUMNS}
          filters={STATUS_FILTERS}
          rowTone={(r) => (STATE[r.state].tone === 'crit' ? 'crit' : r.state === 'not_done' ? 'warn' : undefined)}
          rowEnd={(r) =>
            r.siteId ? (
              <button className="btn btn-sm btn-ghost" aria-pressed={codesFor === r.siteId} onClick={() => setCodesFor(codesFor === r.siteId ? null : r.siteId)}>
                Client requirements
              </button>
            ) : null
          }
        />
        {codesSite?.siteId && (
          <div className="panel-body">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <strong>{codesSite.label}</strong>
              <button className="btn btn-sm btn-ghost" onClick={() => setCodesFor(null)}>
                Close
              </button>
            </div>
            <ClientCodesPanel siteId={codesSite.siteId} />
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Self-audits done</h3>
        </div>
        <DataTable
          label="Self-audits done"
          stateKey="gov.selfaudit.done"
          rows={b.audits}
          rowKey={(a) => a.id}
          columns={DONE_COLUMNS}
          filters={DONE_FILTERS}
          onRowClick={(a) => setOpenAudit(a.id)}
          rowTone={(a) => (a.open ? 'warn' : undefined)}
          empty={<div className="empty">None yet.</div>}
        />
      </section>
      {openedAudit && (
        <Drawer title={openedAudit.ref} sub={`${scopeLabel(openedAudit)} · ${openedAudit.doneOn} by ${openedAudit.by.name}`} onClose={() => setOpenAudit(null)}>
          <AuditRow a={openedAudit} canDo={b.canDo} />
        </Drawer>
      )}
    </div>
  );
}

type StatusRow = SelfAuditBoard['status'][number];
type DoneAudit = SelfAuditBoard['audits'][number];
const stateText = (r: StatusRow) => (r.state === 'soon' ? `Due in ${r.daysLeft} days` : STATE[r.state].t);
const STATUS_COLUMNS: DtColumn<StatusRow>[] = [
  { id: 'where', label: 'Where', value: (r) => r.label, render: (r) => <strong>{r.label}</strong>, phone: 'title' },
  { id: 'last', label: 'Last done', value: (r) => r.lastDoneOn, sort: 'date', render: (r) => (r.lastDoneOn ? dateLabel(r.lastDoneOn) : 'No self-audit recorded') },
  { id: 'due', label: 'Due', value: (r) => r.dueOn, sort: 'date' },
  { id: 'state', label: 'Status', value: (r) => r.daysLeft, sort: 'number', search: false, render: (r) => <Chip tone={STATE[r.state].tone}>{stateText(r)}</Chip> },
];
const STATUS_FILTERS: DtFilter<StatusRow>[] = [{ id: 'state', label: 'Status', value: (r) => r.state, options: Object.entries(STATE).map(([value, s]) => ({ value, label: s.t })) }];
const scopeLabel = (a: DoneAudit) => (a.scope === 'all' ? 'Company and all sites' : a.scope === 'site' ? `Site ${a.siteName}` : 'Company office');
const DONE_COLUMNS: DtColumn<DoneAudit>[] = [
  { id: 'ref', label: 'Reference', value: (a) => a.ref, render: (a) => <strong>{a.ref}</strong>, phone: 'title' },
  { id: 'scope', label: 'Covers', value: (a) => scopeLabel(a), phone: 'sub' },
  { id: 'done', label: 'Done on', value: (a) => a.doneOn, sort: 'date' },
  { id: 'by', label: 'By', value: (a) => a.by.name },
  { id: 'open', label: 'To fix', value: (a) => a.open, sort: 'number', search: false, render: (a) => (a.open ? <Chip tone="warn">{a.open} to fix</Chip> : <Chip tone="ok">Nothing open</Chip>) },
];
const DONE_FILTERS: DtFilter<DoneAudit>[] = [
  { id: 'scope', label: 'Covers', value: (a) => a.scope, options: [{ value: 'all', label: 'Company and all sites' }, { value: 'company', label: 'Company office' }, { value: 'site', label: 'One site' }] },
  { id: 'open', label: 'To fix', value: (a) => (a.open ? 'open' : 'none'), options: [{ value: 'open', label: 'Something to fix' }, { value: 'none', label: 'Nothing open' }] },
];

function AuditRow({ a, canDo }: { a: SelfAuditBoard['audits'][number]; canDo: boolean }) {
  const [fix, setFix] = useState<string | null>(null);
  return (
    <div>
      <div className="list">
        {a.lines.map((l) => (
          <div key={l.key} className="list-item small" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span>
                {l.text}
                {l.note ? <span className="muted"> · {l.note}</span> : null}
                {l.fix ? <span className="muted"> · fixed {l.fix.at.slice(0, 10)}: {l.fix.note}</span> : null}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <Chip tone={l.result === 'ok' || l.fix ? 'ok' : l.result === 'na' ? 'neutral' : 'crit'}>{l.result === 'ok' ? 'OK' : l.result === 'na' ? 'N/A' : l.fix ? 'Fixed' : 'Not right'}</Chip>
                {canDo && l.result === 'not_ok' && !l.fix && (
                  <button className="btn btn-sm" onClick={() => setFix(l.key)}>
                    Record fix
                  </button>
                )}
              </span>
            </div>
            {fix === l.key && <FixForm site={null} documentsOnly onSave={(note, proof) => api.fixSelfAuditLine(a.id, l.key, { note, proof })} onDone={() => setFix(null)} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SelfAuditForm({ b, onDone }: { b: SelfAuditBoard; onDone: () => void }) {
  const [scope, setScope] = useState<'company' | 'site' | 'all'>('all');
  const [siteId, setSiteId] = useState(b.sites[0]?.id ?? '');
  const items = scope === 'company' ? b.items.company : scope === 'site' ? b.items.site : [...b.items.company, ...b.items.site];
  const [answers, setAnswers] = useState<Record<string, { result: 'ok' | 'not_ok' | 'na'; note: string }>>({});
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const answered = items.filter((it) => answers[it.key]).length;
  const set = (k: string, v: Partial<{ result: 'ok' | 'not_ok' | 'na'; note: string }>) => setAnswers((a) => ({ ...a, [k]: { result: a[k]?.result ?? 'ok', note: a[k]?.note ?? '', ...v } }));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Yearly self-audit</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          {(
            [
              ['all', 'Company and all sites'],
              ['company', 'Company office'],
              ['site', 'One site'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} aria-pressed={scope === k} onClick={() => setScope(k)}>
              {t}
            </button>
          ))}
        </div>
        {scope === 'site' && (
          <label className="field">
            <span className="label">Site</span>
            <Select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {b.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {items.map((it) => (
          <div key={it.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small">{it.text}</span>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {(['ok', 'not_ok', 'na'] as const).map((r) => (
                <button key={r} aria-pressed={answers[it.key]?.result === r} onClick={() => set(it.key, { result: r })}>
                  {r === 'ok' ? 'OK' : r === 'not_ok' ? 'Not right' : 'N/A'}
                </button>
              ))}
            </div>
            {answers[it.key] && answers[it.key].result !== 'ok' && (
              <input className="input" value={answers[it.key].note} maxLength={400} placeholder={answers[it.key].result === 'na' ? 'Why it does not apply' : 'What is wrong'} onChange={(e) => set(it.key, { note: e.target.value })} />
            )}
          </div>
        ))}
        <ProofPicker site={null} refText="Self-audit" items={proof} onChange={setProof} documentsOnly />
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || answered < items.length}
          onClick={async () => {
            const lines = items.map((it) => ({ key: it.key, result: answers[it.key].result, note: answers[it.key].note }));
            if (await act.run(() => api.saveSelfAudit(b.company.id, { scope, siteId: scope === 'site' ? siteId : null, lines, proof }), 'Self-audit saved')) onDone();
          }}
        >
          Save self-audit ({answered}/{items.length} answered)
        </button>
      </div>
    </section>
  );
}
