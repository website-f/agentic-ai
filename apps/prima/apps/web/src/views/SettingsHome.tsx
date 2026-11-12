import { useMemo, useState } from 'react';
import { api } from '../api';
import type { SettingsHomeView } from '../api/types';
import { Card, Empty, PageHead, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useLoad, type Tone } from '../ui';
import '../styles/settings-home.css';

/**
 * J7 (Fauzan, 11 Nov 2026): one Settings home in Prima. Every setting staff enter from 18 Nov, who owns it, where to
 * set it, and whether it is set yet ("Not set" badges). Read-only: amounts are never shown here; each screen keeps them.
 */
type Row = SettingsHomeView['rows'][number];

const STATE: Record<Row['state'], [Tone, string]> = {
  set: ['ok', 'Set'],
  not_set: ['warn', 'Not set'],
  not_installed: ['neutral', 'Not installed'],
  later: ['info', 'Decided later'],
  server_off: ['neutral', 'Server setting, off'],
  no_screen: ['crit', 'No screen yet'],
  owner_only: ['neutral', 'Owner sees it'],
};

const FILTERS: { id: 'all' | 'todo' | 'set'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'Still to do' },
  { id: 'set', label: 'Set' },
];

export function SettingsHomeView() {
  const { data, error } = useLoad(() => api.settingsHome(), []);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'set'>('all');
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        (filter === 'all' || (filter === 'set' ? r.state === 'set' : r.state === 'not_set' || r.state === 'no_screen')) &&
        (!words || `${r.title} ${r.what} ${r.owner}`.toLowerCase().includes(words)),
    );
  }, [data, q, filter]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="settings" />;
  const c = data.counts;
  return (
    <div className="sh">
      <PageHead
        title="Settings"
        sub="Every setting staff enter in Prima, who keeps it and whether it is set yet. Rates are entered with the date they start; nothing here is a preset number."
      />
      <Stats>
        <Stat label="Set" value={c.set} tone="ok" />
        <Stat label="Not set" value={c.notSet} tone={c.notSet ? 'warn' : 'ok'} />
        <Stat label="No screen yet" value={c.noScreen} tone={c.noScreen ? 'crit' : 'ok'} />
        <Stat label="Not installed" value={c.notInstalled} tone={c.notInstalled ? 'warn' : 'ok'} />
      </Stats>
      <Toolbar
        end={
          <div className="sh-filters" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`btn btn-sm${filter === f.id ? ' btn-primary' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search settings" label="Search settings" />
      </Toolbar>
      {!rows.length && <Empty title="No setting matches." />}
      {data.groups.map((g) => {
        const list = rows.filter((r) => r.group === g.id);
        if (!list.length) return null;
        return (
          <Card key={g.id} title={g.label} flush>
            <ul className="sh-list">
              {list.map((r) => (
                <SettingLine key={r.id} r={r} />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function SettingLine({ r }: { r: Row }) {
  const [tone, label] = STATE[r.state];
  return (
    <li className="sh-row" data-state={r.state}>
      <div className="sh-main">
        <div className="sh-title">{r.title}</div>
        <div className="sh-what">{r.what}</div>
        <div className="sh-meta">
          <span>Owner: {r.owner}</span>
          {r.where && <span>On the screen: {r.where}</span>}
          {r.dueOn && <span>Due {dateLabel(r.dueOn)}</span>}
        </div>
        <div className="sh-detail">{r.detail}</div>
      </div>
      <div className="sh-side">
        <Chip tone={tone}>{label}</Chip>
        {r.view && (
          <a className="btn btn-sm" href={`#${r.view}`}>
            Open
          </a>
        )}
      </div>
    </li>
  );
}
