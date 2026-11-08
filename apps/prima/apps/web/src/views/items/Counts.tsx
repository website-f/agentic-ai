// Counts (P85; paper section 10): scope, cut-off, freeze and blind; scanning in continuous mode; close, recount and a
// manager's review before any case is opened. Not scanned means "not found yet", never lost; nothing is adjusted.
import { Select } from '../../SearchSelect';
import { useState } from 'react';
import { ClipboardTextIcon } from '@phosphor-icons/react';
import { api, type ItemBoard } from '../../api';
import { Card, Empty, Facts, Stat, Stats } from '../../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../../ui';
import { Scanner } from './Scanner';
import { act, rolesOf } from './shared';

export function Counts({ data }: { data: ItemBoard }) {
  const a = useAction();
  const roles = rolesOf(data);
  const parties = data.parties.filter((p) => (roles.get(p.id) ?? []).some((r) => ['store', 'manager', 'ops', 'it'].includes(r)));
  const [partyId, setPartyId] = useState(parties[0]?.id ?? '');
  const [site, setSite] = useState('');
  const [skus, setSkus] = useState<string[]>([]);
  const [cutoff, setCutoff] = useState('');
  const [freeze, setFreeze] = useState(false);
  const [blind, setBlind] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const sites = data.siteChoices.filter((s) => s.companyId === partyId);
  return (
    <div className="it-stack">
      <Card title="Start a count" sub="The expected list is taken at the cut-off. Moves after it are listed, not counted against the store. Freezing moves is for small counts (200 units or fewer).">
        <div className="it-form">
          <label className="isc-field">
            Company
            <Select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="isc-field">
            Where
            <Select className="input" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">The company's store</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="isc-field">
            Item types (none chosen: all)
            <select className="input it-multi" multiple value={skus} onChange={(e) => setSkus([...e.target.selectedOptions].map((o) => o.value))}>
              {data.skus
                .filter((s) => s.tracking !== 'BULK')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
            </select>
          </label>
          <label className="isc-field">
            Cut-off (empty: now)
            <input className="input" type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          </label>
          <label className="isc-choice">
            <input type="checkbox" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} /> Freeze moves of these units until the count closes
          </label>
          <label className="isc-choice">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind count (the counter does not see what is expected)
          </label>
          <button
            className="btn btn-primary it-big"
            type="button"
            disabled={a.busy || !partyId}
            onClick={() =>
              a
                .run(() => act({ kind: 'count.start', partyId, siteId: site || undefined, skuIds: skus, cutoffAt: cutoff ? `${cutoff}:00+08:00` : undefined, freeze, blind }), 'Count started.')
                .then((r) => r && setOpen((r as { result: { id: string } }).result.id))
            }
          >
            <ClipboardTextIcon size={18} aria-hidden="true" /> Start count
          </button>
          <ErrorNotice error={a.error} />
        </div>
      </Card>
      <Card title="Counts" flush>
        {!data.counts.length ? (
          <Empty title="No counts yet." />
        ) : (
          <ul className="it-rows">
            {data.counts
              .slice()
              .reverse()
              .map((c) => (
                <li key={c.id}>
                  <button className="it-row it-row-btn" type="button" onClick={() => setOpen(c.id)}>
                    <span className="it-row-main">
                      <strong>
                        {c.where.label}
                        {c.parentCountId ? ' (recount)' : ''}
                      </strong>
                      <span className="muted">
                        Cut-off {dateTimeLabel(c.cutoffAt)} · {c.found.length} found{c.blind && !c.closed ? '' : ` of ${c.expectedCount}`}
                        {c.extra.length ? `, ${c.extra.length} extra` : ''}
                      </span>
                    </span>
                    <Chip tone={c.review ? 'ok' : c.closed ? 'warn' : 'info'}>{c.review ? 'Reviewed' : c.closed ? 'Closed, to review' : c.snapshotAt === null ? 'Planned' : 'Counting'}</Chip>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Card>
      {open && <CountSession id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CountSession({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: d, error, reload } = useLoad(() => api.itemCount(id), [id]);
  const a = useAction();
  const [note, setNote] = useState('');
  const [log, setLog] = useState<{ label: string; status: string }[]>([]);
  if (error) return <Drawer title="Count" onClose={onClose}><ErrorNotice error={error} /></Drawer>;
  if (!d) return <Drawer title="Count" onClose={onClose}><Loading what="count" /></Drawer>;
  const c = d.count;
  const run = (x: Parameters<typeof act>[0], msg: string) => a.run(() => act(x), msg).then((r) => r && reload());
  return (
    <Drawer title={c.where.label} sub={`Cut-off ${dateTimeLabel(c.cutoffAt)}${c.freeze ? ' · moves frozen' : ''}${c.blind ? ' · blind' : ''}`} onClose={onClose}>
      <div className="it-stack">
        <Stats>
          <Stat label="Found" value={c.found.length} tone="ok" />
          <Stat label="Expected" value={c.blind && !c.closed ? 'Hidden' : c.expectedCount} />
          <Stat label="Extra" value={c.extra.length} tone={c.extra.length ? 'warn' : undefined} />
          <Stat label="Typed" value={d.manual} tone={d.flagged ? 'crit' : undefined} note={d.flagged ? 'Many typed: a manager looks first' : undefined} />
        </Stats>
        {!c.closed && (
          <Card title="Scan" sub="Keep scanning; each label counts once. Another company's label shows as not found and is reported without its details.">
            <Scanner
              purpose="count"
              contextId={c.id}
              title={`Count at ${c.where.label}`}
              continuous
              busy={a.busy}
              onResult={async ({ verdict, entry }) => {
                if (verdict.outcome === 'duplicate' || verdict.outcome === 'needs_manual_proof') return;
                const r = (await a.run(() => act({ kind: 'count.scanBatch', countId: c.id, scans: [entry] }))) as { result: { results: { status: string; label: string | null }[] } } | undefined;
                if (r) {
                  setLog((l) => [{ label: r.result.results[0]?.label ?? 'Unknown label', status: r.result.results[0]?.status ?? '' }, ...l].slice(0, 20));
                  reload();
                }
              }}
            />
            <ul className="it-rows">
              {log.map((x, k) => (
                <li key={k} className="it-row">
                  <span className="mono">{x.label}</span>
                  <Chip tone={x.status === 'expected' ? 'ok' : x.status === 'extra' ? 'warn' : x.status === 'already' ? 'info' : 'crit'}>{x.status.replace('_', ' ')}</Chip>
                </li>
              ))}
            </ul>
            <button className="btn it-big" type="button" disabled={a.busy} onClick={() => run({ kind: 'count.close', countId: c.id }, 'Count closed. Recount what was not found, then a manager reviews it.')}>
              Close the count
            </button>
          </Card>
        )}
        {c.closed && (
          <Card title="Result" sub={c.review ? `Reviewed by ${c.review.by}: ${c.review.cases} case(s) opened.` : 'Not found yet is not lost. Recount, then a manager who did not count reviews it; only then are cases opened.'}>
            <Facts
              items={[
                ['Not found yet', d.notFound.map((x) => x.label).join(', ') || 'None'],
                ['Extra (not expected here)', d.extra.map((x) => x.label).join(', ') || 'None'],
                ['Moved after the cut-off', d.movedAfterCutoff.map((x) => x.label).join(', ') || 'None'],
                ['Recounts', d.recounts.length ? d.recounts.map((r) => `${r.found.length} found${r.closed ? '' : ' (open)'}`).join('; ') : 'None'],
              ]}
            />
            {!c.review && !c.parentCountId && (
              <div className="it-form">
                {(d.notFound.length > 0 || d.extra.length > 0) && !d.recounts.some((r) => !r.closed) && (
                  <button className="btn" type="button" disabled={a.busy} onClick={() => run({ kind: 'count.recount', countId: c.id }, 'Recount started for the not found and extra units.')}>
                    Recount the differences
                  </button>
                )}
                {d.canReview && (
                  <>
                    <input className="input" placeholder="What you checked" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn btn-primary" type="button" disabled={a.busy || note.trim().length < 3} onClick={() => run({ kind: 'count.review', countId: c.id, note }, 'Reviewed. Cases are open for each difference.')}>
                      Review and open cases
                    </button>
                  </>
                )}
              </div>
            )}
          </Card>
        )}
        <ErrorNotice error={a.error} />
      </div>
    </Drawer>
  );
}
