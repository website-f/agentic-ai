import { useState } from 'react';
import { ArrowsClockwiseIcon, ClipboardTextIcon, HardDrivesIcon, QuestionIcon, WarningOctagonIcon } from '@phosphor-icons/react';
import { api, type BcmBoard } from '../api';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/gov.css';

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
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="continuity" />
      </div>
    );
  const k = data.kpis;
  const it = data.role === 'it';
  return (
    <div className="page gv-page">
      <PageHead
        title="Continuity"
        sub={`Every system keeps copies in Malaysia: the cloud, our own server and an emergency server. A copy counts only when it was backed up within its target and restored in a test in the last ${data.rule.restoreTestMonths} months. No record means unknown.`}
      >
        <p className="notice" data-tone="info">
          Prima is not hosted yet, so every entry here is test data. Recovery targets are proposals for IT and Fauzan to confirm.
        </p>
      </PageHead>
      <Stats>
        <Stat label="Systems" value={k.systems} icon={<HardDrivesIcon size={16} />} tone="info" />
        <Stat label="Red" value={k.red} tone={k.red ? 'crit' : 'ok'} icon={<WarningOctagonIcon size={16} />} />
        <Stat label="Unknown" value={k.unknown} tone={k.unknown ? 'warn' : 'ok'} icon={<QuestionIcon size={16} />} note="No record means unknown" />
        <Stat label="Tested and current" value={k.ok} tone="ok" icon={<ArrowsClockwiseIcon size={16} />} />
        <Stat
          label="Drills due"
          value={k.drillsDue}
          tone={k.drillsDue ? 'warn' : 'ok'}
          icon={<ClipboardTextIcon size={16} />}
          note={`Every playbook drilled every ${data.rule.drillMonths} months`}
        />
      </Stats>
      <div className="tabbar" role="tablist" aria-label="Continuity">
        <button role="tab" aria-selected={tab === 'systems'} onClick={() => setTab('systems')}>
          Systems and copies
        </button>
        <button role="tab" aria-selected={tab === 'playbooks'} onClick={() => setTab('playbooks')}>
          Playbooks
        </button>
      </div>
      {tab === 'systems' && (
        <div className="gv-stack">
          {!data.systems.length && (
            <Card>
              <Empty title="No systems listed." />
            </Card>
          )}
          {data.systems.map((s) => (
            <SystemCard key={s.system.id} s={s} it={it} />
          ))}
        </div>
      )}
      {tab === 'playbooks' && <Playbooks data={data} />}
    </div>
  );
}

function SystemCard({ s, it }: { s: Sys; it: boolean }) {
  return (
    <Card title={s.system.name} sub={s.system.impact} actions={<Chip tone={TONE[s.state]}>{LABEL[s.state]}</Chip>}>
      <div className="gv-stack-sm">
        <div className="gv-sys-targets">
          <Chip tone="neutral">Back within {s.system.rtoHours} h</Chip>
          <Chip tone="neutral">Losing at most {s.system.rpoHours} h of data</Chip>
        </div>
        <div className="gv-copies">
          {s.copies.map((c) => (
            <CopyTile key={c.index} s={s} c={c} it={it} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function CopyTile({ s, c, it }: { s: Sys; c: Sys['copies'][number]; it: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ on: todayMy(), ok: true, hours: '', loss: '', note: '' });
  const t = c.copy.lastRestoreTest;
  return (
    <div className="gv-copy" data-tone={TONE[c.state]}>
      <div className="gv-copy-head">
        <div>
          <div className="gv-copy-name">{SITE[c.copy.site]}</div>
          <div className="gv-copy-where">{c.copy.where}</div>
        </div>
        <Chip tone={TONE[c.state]}>{LABEL[c.state]}</Chip>
      </div>
      <dl className="gv-kv">
        <div>
          <dt>Last backup</dt>
          <dd>{c.copy.lastBackupAt ? `${dateTimeLabel(c.copy.lastBackupAt)} (${c.backupAgeHours} h ago)` : 'No backup on record'}</dd>
        </div>
        <div>
          <dt>Last restore test</dt>
          <dd>
            {t
              ? `${dateLabel(t.on)}: ${t.ok ? `passed in ${t.hours} h, ${t.dataLossMinutes} min of data lost` : `failed${t.note ? `, ${t.note}` : ''}`}`
              : 'Never restored in a test'}
          </dd>
        </div>
      </dl>
      {c.problems.length > 0 && (
        <ul className="gv-problems">
          {c.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {it && (
        <div className="gv-btns">
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.bcmRecord(s.system.id, c.index, 'backup', {}), 'Backup recorded.')}
          >
            Backup done now
          </button>
          <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            Record restore test
          </button>
        </div>
      )}
      {open && (
        <div className="gv-box">
          <div className="gv-form">
            <label className="field">
              <span className="label">Test date</span>
              <input className="input" type="date" aria-label="Test date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Result</span>
              <select className="select" aria-label="Result" value={f.ok ? 'ok' : 'fail'} onChange={(e) => setF({ ...f, ok: e.target.value === 'ok' })}>
                <option value="ok">Passed</option>
                <option value="fail">Failed</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Hours to restore</span>
              <input
                className="input"
                aria-label="Hours to restore"
                placeholder="Hours to restore"
                inputMode="decimal"
                value={f.hours}
                onChange={(e) => setF({ ...f, hours: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Minutes of data lost</span>
              <input
                className="input"
                aria-label="Minutes of data lost"
                placeholder="Minutes of data lost"
                inputMode="numeric"
                value={f.loss}
                onChange={(e) => setF({ ...f, loss: e.target.value })}
              />
            </label>
            <label className="field gv-span">
              <span className="label">Note</span>
              <input className="input" aria-label="Note" placeholder="Note (what failed)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </label>
          </div>
          <div className="gv-form-foot">
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
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Playbooks({ data }: { data: BcmBoard }) {
  return (
    <Card title="Playbooks" sub={`Each playbook is drilled at least every ${data.rule.drillMonths} months. Paper fallbacks are kept at every site.`} flush>
      {!data.playbooks.length && <Empty title="No playbooks yet." />}
      <ul className="gv-list">
        {data.playbooks.map((p) => (
          <li key={p.playbook.id}>
            <PlaybookLine p={p} it={data.role === 'it'} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PlaybookLine({ p, it }: { p: BcmBoard['playbooks'][number]; it: boolean }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ on: todayMy(), findings: '', actionsOpen: '0' });
  const tone = p.state === 'ok' ? 'ok' : 'warn';
  return (
    <div className="gv-item" data-tone={tone === 'warn' ? 'warn' : undefined}>
      <div className="gv-item-head">
        <div className="gv-item-main">
          <div className="gv-item-title">{p.playbook.title}</div>
          <div className="gv-item-meta">
            {p.last
              ? `Last drill ${dateLabel(p.last.on)} by ${p.last.by}: ${p.last.findings} (${p.last.actionsOpen} actions open)`
              : 'No drill on record'}
          </div>
        </div>
        <div className="gv-item-state">
          <Chip tone={tone}>{p.state === 'ok' ? 'Drilled' : p.state === 'overdue' ? 'Drill overdue' : 'Never drilled'}</Chip>
          {it && (
            <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              Record a drill
            </button>
          )}
        </div>
      </div>
      <ol className="gv-ol">
        {p.playbook.steps.map((st, i) => (
          <li key={i}>
            <span>{st}</span>
          </li>
        ))}
      </ol>
      {open && (
        <div className="gv-box">
          <div className="gv-form">
            <label className="field">
              <span className="label">Drill date</span>
              <input className="input" type="date" aria-label="Drill date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Actions open</span>
              <input
                className="input"
                aria-label="Actions open"
                placeholder="Actions open"
                inputMode="numeric"
                value={f.actionsOpen}
                onChange={(e) => setF({ ...f, actionsOpen: e.target.value })}
              />
            </label>
            <label className="field gv-span">
              <span className="label">What was found</span>
              <input
                className="input"
                aria-label="Findings"
                placeholder="What was found"
                value={f.findings}
                onChange={(e) => setF({ ...f, findings: e.target.value })}
              />
            </label>
          </div>
          <div className="gv-form-foot">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() =>
                act.run(() => api.bcmDrill(p.playbook.id, { on: f.on, findings: f.findings, actionsOpen: Number(f.actionsOpen) }), 'Drill recorded.')
              }
            >
              Save
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
