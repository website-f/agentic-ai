import { Select } from '../../SearchSelect';
import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, SALE_PAPER_LABEL, STATE_LABEL, TAG_METHODS, TAG_METHOD_LABEL, labelDisplay, type BaseUom, type ItemCategory, type SalePaperKind, type TagMethod, type TrackingMode } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../../ui';
import { act, any, CAT_LABEL, FilterChips, partyName, readFile, rolesOf, skuName, STATE_TONE, TabIntro } from './shared';
import { Card, Empty, Search, Stat, Stats, Toolbar } from '../../kit';
import type { Role } from './shared';
import { Passport } from './Passport';

// After-sale care: health, service dates and expected life (Fauzan, 6 Nov 2026).
// Moved unchanged from views/Items.tsx in the P85 split; laid out by the item register styles (styles/items.css).

// ---------- After-sale care ----------

const CARE_LABEL = { overdue: 'Service overdue', end_of_life: 'Past expected life', due_soon: 'Service due soon', ok: 'Up to date', not_set: 'Interval not set' } as const;
const CARE_TONE = { overdue: 'crit', end_of_life: 'crit', due_soon: 'warn', ok: 'ok', not_set: 'neutral' } as const;

/**
 * After-sale care (Fauzan, 6 Nov 2026): even after a sale, the seller keeps looking after each unit's health,
 * maintenance and life as a service, and the owning company watches the same list. The seller records service checks;
 * the owner asks for service. Neither moves the item or changes the owner.
 */
export function Care({ data }: { data: ItemBoard }) {
  const a = useAction();
  const roles = rolesOf(data);
  const [filter, setFilter] = useState<'attention' | 'overdue' | 'requests' | 'all'>('attention');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<'service' | 'request'>('service');
  const [cond, setCond] = useState<'good' | 'worn' | 'damaged'>('good');
  const [note, setNote] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [shown, setShown] = useState(100);
  const handles = (p: string | null, ...rs: Role[]) => !!p && (roles.get(p) ?? []).some((r) => rs.includes(r as Role));
  const needs = (c: ItemBoard['care'][number]) => ['overdue', 'end_of_life', 'due_soon'].includes(c.status) || !!c.openServiceRequest;
  const pick = (c: ItemBoard['care'][number]) =>
    filter === 'all' ? true : filter === 'attention' ? needs(c) : filter === 'overdue' ? c.status === 'overdue' || c.status === 'end_of_life' : !!c.openServiceRequest;
  const term = q.trim().toLowerCase();
  const rows = data.care
    .filter((c) => pick(c) && (!term || skuName(data, c.skuId).toLowerCase().includes(term) || labelDisplay(c.token).toLowerCase().includes(term) || partyName(data, c.ownerPartyId).toLowerCase().includes(term)))
    .sort((x, y) => (x.nextDue ?? '9999').localeCompare(y.nextDue ?? '9999'));
  const count = (k: keyof typeof CARE_LABEL) => data.care.filter((c) => c.status === k).length;
  return (
    <div className="it-stack">
      <TabIntro
        title="After-sale care"
        sub="Health, service dates and expected life of every unit your company owns, holds or sold and still looks after. The seller records service checks; the owner can ask for service. Where no interval is set it says so; nothing is assumed."
      />
      <Stats>
        <Stat label="Service overdue" value={count('overdue')} tone={count('overdue') ? 'crit' : 'ok'} onClick={() => setFilter('overdue')} />
        <Stat label="Due in 14 days" value={count('due_soon')} tone={count('due_soon') ? 'warn' : 'ok'} onClick={() => setFilter('attention')} />
        <Stat label="Past expected life" value={count('end_of_life')} tone={count('end_of_life') ? 'crit' : 'ok'} onClick={() => setFilter('overdue')} />
        <Stat label="Service requests open" value={data.care.filter((c) => c.openServiceRequest).length} tone={data.care.some((c) => c.openServiceRequest) ? 'warn' : 'ok'} onClick={() => setFilter('requests')} />
        <Stat label="Interval not set" value={count('not_set')} tone="neutral" />
      </Stats>
      <Card title="Units" flush>
        <div className="it-pad">
          <Toolbar>
            <Search value={q} onChange={(v) => (setQ(v), setShown(100))} placeholder="Search item, label or owner" />
          </Toolbar>
          <FilterChips
            label="Show"
            value={filter}
            onChange={(k) => (setFilter(k), setShown(100))}
            options={[
              ['attention', 'Needs attention', data.care.filter(needs).length],
              ['overdue', 'Overdue or past life', count('overdue') + count('end_of_life')],
              ['requests', 'Service requests', data.care.filter((c) => c.openServiceRequest).length],
              ['all', 'All', data.care.length],
            ]}
          />
        </div>
        {!rows.length ? (
          <Empty title={data.care.length ? (filter === 'attention' && !term ? 'Nothing needs attention.' : 'Nothing matches.') : 'No units to look after yet.'}>
            {data.care.length ? (filter === 'attention' && !term ? 'Every unit is within its service dates.' : 'Change the search or choose another filter.') : 'Units tracked one by one show here once registered; set each type\'s service interval under Item types.'}
          </Empty>
        ) : (
          <ul className="it-rows">
            {rows.slice(0, shown).map((c) => {
              const seller = handles(c.seller, 'store', 'manager', 'it');
              const owner = handles(c.ownerPartyId, 'store', 'manager', 'it', 'ops') || handles(c.holderPartyId, 'store', 'manager', 'it', 'ops');
              return (
                <li key={c.itemId} className="it-row it-row-col">
                  <span className="it-row-line">
                    <button className="it-link" type="button" onClick={() => setLabel(c.token)}>
                      {skuName(data, c.skuId)}
                    </button>
                    <Chip tone={CARE_TONE[c.status]}>{CARE_LABEL[c.status]}</Chip>
                  </span>
                  <span className="mono small muted">{labelDisplay(c.token)}</span>
                  <span className="muted small">
                    Owner {partyName(data, c.ownerPartyId)}
                    {c.seller ? ` · sold by ${partyName(data, c.seller)} (after-sale care)` : ''} · condition {c.condition} · last check {dateLabel(c.lastCheck.slice(0, 10))}
                    {c.nextDue ? ` · next service ${dateLabel(c.nextDue)}` : ''} · age {c.ageMonths} month(s){c.lifeEnds ? `, life ends ${dateLabel(c.lifeEnds)}` : ''} · {c.services} service(s)
                    {c.openServiceRequest ? ` · service request ${c.openServiceRequest} open` : ''}
                  </span>
                  {(seller || owner) && (
                    <span className="it-row-actions">
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => {
                          setOpen(open === c.itemId && mode === 'service' ? null : c.itemId);
                          setMode('service');
                        }}
                      >
                        Record service check
                      </button>
                      {owner && c.seller && !c.openServiceRequest && (
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => {
                            setOpen(open === c.itemId && mode === 'request' ? null : c.itemId);
                            setMode('request');
                          }}
                        >
                          Ask {partyName(data, c.seller)} for service
                        </button>
                      )}
                    </span>
                  )}
                  {open === c.itemId && (
                    <span className="it-form">
                      {mode === 'service' && (
                        <select className="input" aria-label="Condition found" value={cond} onChange={(e) => setCond(e.target.value as typeof cond)}>
                          <option value="good">Good</option>
                          <option value="worn">Worn</option>
                          <option value="damaged">Damaged</option>
                        </select>
                      )}
                      <input className="input" aria-label={mode === 'service' ? 'What was checked or serviced' : 'What is wrong'} placeholder={mode === 'service' ? 'What was checked or serviced' : 'What is wrong or what service is needed'} value={note} onChange={(e) => setNote(e.target.value)} />
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={a.busy}
                        onClick={() =>
                          a
                            .run(
                              () => act(mode === 'service' ? { kind: 'item.service', label: c.token, condition: cond, note } : { kind: 'service.request', label: c.token, note }),
                              mode === 'service' ? 'Service check recorded.' : 'Service requested.',
                            )
                            .then((r) => {
                              if (r) {
                                setOpen(null);
                                setNote('');
                              }
                            })
                        }
                      >
                        Save
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > shown && (
          <div className="it-pad">
            <button className="btn" type="button" onClick={() => setShown(shown + 300)}>
              Show more (<span>{rows.length - shown}</span> more)
            </button>
          </div>
        )}
      </Card>
      <ErrorNotice error={a.error} />
      {label && <Passport data={data} code={label} onClose={() => setLabel(null)} />}
    </div>
  );
}

/** Service interval and expected life per item type, entered by a central store manager with the source. */
export function CareSettings({ data }: { data: ItemBoard }) {
  const a = useAction();
  const roles = rolesOf(data);
  const mgr = ['goodwill', 'pwvsb', 'merdeka'].some((p) => (roles.get(p) ?? []).includes('manager')) || (roles.get('merdeka') ?? []).includes('it');
  const [sku, setSku] = useState('');
  const [every, setEvery] = useState('');
  const [life, setLife] = useState('');
  const [why, setWhy] = useState('');
  const set = data.skus.filter((s) => s.care);
  if (!mgr && !set.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Service interval and expected life</h3>
      </div>
      <p className="muted">How often a unit of each type is checked or serviced, and how long it should last. Entered from the maker's manual, contract or policy; never assumed.</p>
      <div className="list">
        {!set.length && <div className="empty">Not set for any item type yet.</div>}
        {set.map((s) => (
          <div key={s.id} className="list-item">
            <div>
              <strong>{s.code}</strong>
              <div className="muted small">
                Check every {s.care!.everyDays ?? 'not set'} days · expected life {s.care!.lifeMonths ?? 'not set'} months · {s.care!.reason} ({s.care!.by})
              </div>
            </div>
          </div>
        ))}
      </div>
      {mgr && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <Select className="input" aria-label="Item type" value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">Item type…</option>
            {data.skus
              .filter((s) => s.tracking !== 'BULK')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
          </Select>
          <input className="input" style={{ width: 130 }} inputMode="numeric" aria-label="Days between checks" placeholder="Days between checks" value={every} onChange={(e) => setEvery(e.target.value)} />
          <input className="input" style={{ width: 130 }} inputMode="numeric" aria-label="Expected life in months" placeholder="Life in months" value={life} onChange={(e) => setLife(e.target.value)} />
          <input className="input" aria-label="Source" placeholder="Source: maker manual, contract, policy" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={a.busy || !sku}
            onClick={() =>
              a.run(() => act({ kind: 'sku.care', skuId: sku, everyDays: every.trim() ? Number(every) : null, lifeMonths: life.trim() ? Number(life) : null, reason: why }), 'Saved.')
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </section>
  );
}
