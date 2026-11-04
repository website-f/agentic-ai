import { useState } from 'react';
import { api, type BcmBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/** Today in Malaysia, so a date field starts filled in. */
const todayMy = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * Business continuity (V15, Fauzan 24 Oct 2026). Every system keeps copies in Malaysia: the cloud, Fauzan's own server
 * and an emergency server. IT records each backup, restore test and drill; a copy with no record is unknown.
 */

type Sys = BcmBoard['systems'][number];
const SITE: Record<Sys['system']['copies'][number]['site'], string> = { CLOUD: 'Cloud copy', OWN_SERVER: 'Own server', EMERGENCY: 'Emergency server' };
const TONE = { crit: 'crit', unknown: 'warn', warn: 'warn', ok: 'ok' } as const;
const LABEL = { crit: 'Red', unknown: 'Unknown', warn: 'Behind target', ok: 'Tested and current' } as const;

export function ContinuityView() {
  const { data, error } = useLoad(() => api.bcmBoard(), []);
  const [tab, setTab] = useState<'systems' | 'playbooks'>('systems');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="continuity" />;
  const k = data.kpis;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Continuity</h1>
        <p className="muted">
          Every system keeps copies in Malaysia: the cloud, our own server and an emergency server. A copy counts only when it was backed up within its target
          and restored in a test in the last {data.rule.restoreTestMonths} months. No record means unknown.
        </p>
        <p className="notice" data-tone="info">
          Prima is not hosted yet, so every entry here is test data. Recovery targets are proposals for IT and Fauzan to confirm.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Systems" value={k.systems} />
        <Kpi label="Red" value={k.red} tone={k.red ? 'crit' : 'ok'} />
        <Kpi label="Unknown" value={k.unknown} tone={k.unknown ? 'warn' : 'ok'} />
        <Kpi label="Tested and current" value={k.ok} tone="ok" />
        <Kpi label="Drills due" value={k.drillsDue} tone={k.drillsDue ? 'warn' : 'ok'} />
      </div>
      <div className="tabbar" role="tablist" aria-label="Continuity">
        <button role="tab" aria-selected={tab === 'systems'} onClick={() => setTab('systems')}>
          Systems and copies
        </button>
        <button role="tab" aria-selected={tab === 'playbooks'} onClick={() => setTab('playbooks')}>
          Playbooks
        </button>
      </div>
      {tab === 'systems' && (
        <section className="panel">
          <div className="list">
            {data.systems.map((s) => (
              <SystemLine key={s.system.id} s={s} it={data.role === 'it'} />
            ))}
          </div>
        </section>
      )}
      {tab === 'playbooks' && <Playbooks data={data} />}
    </div>
  );
}

function SystemLine({ s, it }: { s: Sys; it: boolean }) {
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{s.system.name}</div>
          <div className="muted small">
            {s.system.impact} · back within {s.system.rtoHours} h, losing at most {s.system.rpoHours} h of data
          </div>
        </div>
        <Chip tone={TONE[s.state]}>{LABEL[s.state]}</Chip>
      </div>
      {s.copies.map((c) => (
        <CopyLine key={c.index} s={s} c={c} it={it} />
      ))}
    </div>
  );
}

function CopyLine({ s, c, it }: { s: Sys; c: Sys['copies'][number]; it: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ on: todayMy(), ok: true, hours: '', loss: '', note: '' });
  const t = c.copy.lastRestoreTest;
  return (
    <div style={{ borderLeft: '3px solid var(--border, #ddd)', paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            {SITE[c.copy.site]}: {c.copy.where}
          </div>
          <div className="muted small">
            {c.copy.lastBackupAt ? `Backed up ${dateTimeLabel(c.copy.lastBackupAt)} (${c.backupAgeHours} h ago)` : 'No backup on record'} ·{' '}
            {t
              ? `restore test ${dateLabel(t.on)}: ${t.ok ? `passed in ${t.hours} h, ${t.dataLossMinutes} min of data lost` : `failed${t.note ? `, ${t.note}` : ''}`}`
              : 'never restored in a test'}
          </div>
          {c.problems.length > 0 && <div className="small">{c.problems.join('. ')}.</div>}
        </div>
        <Chip tone={TONE[c.state]}>{LABEL[c.state]}</Chip>
      </div>
      {it && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.bcmRecord(s.system.id, c.index, 'backup', {}), 'Backup recorded.')}
          >
            Backup done now
          </button>
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>
            Record restore test
          </button>
        </div>
      )}
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" type="date" aria-label="Test date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          <select className="input" aria-label="Result" value={f.ok ? 'ok' : 'fail'} onChange={(e) => setF({ ...f, ok: e.target.value === 'ok' })}>
            <option value="ok">Passed</option>
            <option value="fail">Failed</option>
          </select>
          <input
            className="input"
            aria-label="Hours to restore"
            placeholder="Hours to restore"
            inputMode="decimal"
            value={f.hours}
            onChange={(e) => setF({ ...f, hours: e.target.value })}
          />
          <input
            className="input"
            aria-label="Minutes of data lost"
            placeholder="Minutes of data lost"
            inputMode="numeric"
            value={f.loss}
            onChange={(e) => setF({ ...f, loss: e.target.value })}
          />
          <input className="input" aria-label="Note" placeholder="Note (what failed)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () =>
                  api.bcmRecord(s.system.id, c.index, 'restore', { on: f.on, ok: f.ok, hours: Number(f.hours), dataLossMinutes: Number(f.loss), note: f.note }),
                'Restore test recorded.',
              )
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Playbooks({ data }: { data: BcmBoard }) {
  return (
    <section className="panel">
      <p className="muted small">Each playbook is drilled at least every {data.rule.drillMonths} months. Paper fallbacks are kept at every site.</p>
      <div className="list">
        {data.playbooks.map((p) => (
          <PlaybookLine key={p.playbook.id} p={p} it={data.role === 'it'} />
        ))}
      </div>
    </section>
  );
}

function PlaybookLine({ p, it }: { p: BcmBoard['playbooks'][number]; it: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ on: todayMy(), findings: '', actionsOpen: '0' });
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600 }}>{p.playbook.title}</div>
        <Chip tone={p.state === 'ok' ? 'ok' : 'warn'}>{p.state === 'ok' ? 'Drilled' : p.state === 'overdue' ? 'Drill overdue' : 'Never drilled'}</Chip>
      </div>
      <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
        {p.playbook.steps.map((st, i) => (
          <li key={i}>{st}</li>
        ))}
      </ol>
      {p.last && (
        <div className="muted small">
          Last drill {dateLabel(p.last.on)} by {p.last.by}: {p.last.findings} ({p.last.actionsOpen} actions open)
        </div>
      )}
      {it && (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>
          Record a drill
        </button>
      )}
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" type="date" aria-label="Drill date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          <input
            className="input"
            aria-label="Findings"
            placeholder="What was found"
            value={f.findings}
            onChange={(e) => setF({ ...f, findings: e.target.value })}
          />
          <input
            className="input"
            aria-label="Actions open"
            placeholder="Actions open"
            inputMode="numeric"
            value={f.actionsOpen}
            onChange={(e) => setF({ ...f, actionsOpen: e.target.value })}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() =>
              act.run(() => api.bcmDrill(p.playbook.id, { on: f.on, findings: f.findings, actionsOpen: Number(f.actionsOpen) }), 'Drill recorded.')
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
