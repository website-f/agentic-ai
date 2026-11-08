// The site board (P85; paper section 4): what is expected at a site (at the site, or with people whose latest shift is
// there), who holds it, its condition, when it was last confirmed and what is waiting. An audit scan records what was
// seen; it never moves anything, changes the owner or bills anyone.
import { Select } from '../../SearchSelect';
import { useState } from 'react';
import { BuildingsIcon, EyeIcon, WarningIcon } from '@phosphor-icons/react';
import { STATE_LABEL, type ItemState } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Card, Empty, Stat, Stats } from '../../kit';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../../ui';
import { Scanner } from './Scanner';
import { STATE_TONE, act } from './shared';

export function SiteBoard({ data }: { data: ItemBoard }) {
  const [siteId, setSiteId] = useState(data.siteChoices[0]?.id ?? '');
  if (!data.siteChoices.length) return <Card title="Site board"><Empty title="No sites to show.">The site board is for the stores, managers and supervisors of a site, and the OM of its area.</Empty></Card>;
  return (
    <div className="it-stack">
      <Card title="Site board" sub="Expected items, holders, condition, last confirmed check and what is waiting.">
        <Select className="input it-big" aria-label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {data.siteChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Card>
      {siteId && <Board siteId={siteId} />}
    </div>
  );
}

function Board({ siteId }: { siteId: string }) {
  const { data: b, error, reload } = useLoad(() => api.itemSiteBoard(siteId), [siteId]);
  const a = useAction();
  const [audit, setAudit] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  if (error) return <ErrorNotice error={error} />;
  if (!b) return <Loading what="site board" />;
  return (
    <div className="it-stack">
      <Stats>
        <Stat label="Expected here" value={b.totals.units} icon={<BuildingsIcon size={16} />} tone="info" />
        <Stat label="Waiting to confirm" value={b.totals.waiting} tone={b.totals.waiting ? 'warn' : 'ok'} />
        <Stat label="Overdue returns" value={b.totals.overdue} tone={b.totals.overdue ? 'crit' : 'ok'} />
        <Stat label="Not seen in 30 days" value={b.totals.notSeen30} tone={b.totals.notSeen30 ? 'warn' : 'ok'} icon={<WarningIcon size={16} />} />
      </Stats>
      {b.canCheck && (
        <Card
          title="Audit scan"
          sub={b.note}
          actions={
            <button className="btn" type="button" onClick={() => setAudit(!audit)} aria-pressed={audit}>
              <EyeIcon size={16} aria-hidden="true" /> {audit ? 'Stop' : 'Start'}
            </button>
          }
        >
          {audit && (
            <Scanner
              purpose="observe"
              title={`Audit scan at ${b.site.name}`}
              continuous
              busy={a.busy}
              onResult={({ verdict, entry }) =>
                verdict.outcome === 'ok' &&
                a.run(
                  () => act({ kind: 'observe', siteId: b.site.id, scan: entry }),
                  (r) => {
                    const x = (r as { result: { expectedHere: boolean } }).result;
                    setSeen((s) => [`${verdict.label ?? ''}${x.expectedHere ? '' : ' (not expected here: a case is open)'}`, ...s].slice(0, 20));
                    reload();
                    return x.expectedHere ? 'Seen here.' : 'Not expected here: a case is open to check it.';
                  },
                )
              }
            />
          )}
          {seen.length > 0 && (
            <ul className="it-rows">
              {seen.map((s, k) => (
                <li key={k} className="it-row">
                  <span className="mono">{s}</span>
                </li>
              ))}
            </ul>
          )}
          <ErrorNotice error={a.error} />
        </Card>
      )}
      <Card title={`At ${b.site.name}`} flush>
        {!b.rows.length ? (
          <Empty title="Nothing is recorded here." />
        ) : (
          <ul className="it-rows">
            {b.rows.map((r) => (
              <li key={r.itemId} className="it-row it-row-col" data-tone={r.overdue || r.openCases ? 'warn' : undefined}>
                <span className="it-row-line">
                  <span className="it-row-main">
                    <strong>
                      {r.sku}
                      {r.size ? ` ${r.size}` : ''}
                    </strong>
                    <span className="mono muted">{r.label}</span>
                  </span>
                  <Chip tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state as ItemState]}</Chip>
                </span>
                <span className="muted">
                  {r.holder} · {r.condition} · last confirmed {r.lastConfirmed ? dateLabel(r.lastConfirmed.slice(0, 10)) : 'never'}
                  {r.waiting ? ' · waiting for the person to confirm' : ''}
                  {r.overdue ? ' · overdue back to the owner' : ''}
                  {r.openCases ? ` · ${r.openCases} open case(s)` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {b.lots.length > 0 && (
          <ul className="it-rows">
            {b.lots.map((l) => (
              <li key={l.id} className="it-row">
                <span>{l.sku} (by quantity)</span>
                <span className="it-qty">{l.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
