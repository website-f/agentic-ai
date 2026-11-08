import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { useApp } from '../App';
import { api, type SelfAuditBoard } from '../api';
import { Chip, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';
import { ClientCodesPanel, FixForm } from './ClientCodes';
import { ProofPicker } from './Proof';

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
        {b.canDo && (
          <button className="btn btn-primary" onClick={() => setForm(true)}>
            Do a self-audit
          </button>
        )}
      </div>
      <span className="muted small">
        Every company checks itself once every {b.rule.value.selfAuditEveryMonths} months: the company office, each site, or everything at once. Reminders come {b.rule.value.selfAuditRemindDays.join(', ')} days before it is due.
        {!b.canDo && ' The Company Manager or the company\'s admin executives do it; you can see it.'}
      </span>
      <section className="panel">
        <div className="panel-head">
          <h3>Where it stands</h3>
        </div>
        <div className="list">
          {b.status.map((r) => (
            <div key={r.siteId ?? 'company'} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  <div className="muted small">{r.lastDoneOn ? `Last done ${r.lastDoneOn} · due ${r.dueOn}` : 'No self-audit recorded'}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Chip tone={STATE[r.state].tone}>{r.state === 'soon' ? `Due in ${r.daysLeft} days` : STATE[r.state].t}</Chip>
                  {r.siteId && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setCodesFor(codesFor === r.siteId ? null : r.siteId)}>
                      Client requirements
                    </button>
                  )}
                </div>
              </div>
              {r.siteId && codesFor === r.siteId && <ClientCodesPanel siteId={r.siteId} />}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Self-audits done</h3>
        </div>
        <div className="list">
          {b.audits.length === 0 && <div className="empty">None yet.</div>}
          {b.audits.map((a) => (
            <AuditRow key={a.id} a={a} canDo={b.canDo} />
          ))}
        </div>
      </section>
    </div>
  );
}

function AuditRow({ a, canDo }: { a: SelfAuditBoard['audits'][number]; canDo: boolean }) {
  const [fix, setFix] = useState<string | null>(null);
  return (
    <details className="list-item" style={{ display: 'block' }}>
      <summary style={{ cursor: 'pointer' }}>
        {a.ref} · {a.scope === 'all' ? 'Company and all sites' : a.scope === 'site' ? `Site ${a.siteName}` : 'Company office'} · {a.doneOn} by {a.by.name}{' '}
        {a.open ? <Chip tone="warn">{a.open} to fix</Chip> : <Chip tone="ok">Nothing open</Chip>}
      </summary>
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
    </details>
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
