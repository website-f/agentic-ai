import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, SALE_PAPER_LABEL, STATE_LABEL, TAG_METHODS, TAG_METHOD_LABEL, labelDisplay, type BaseUom, type ItemCategory, type SalePaperKind, type TagMethod, type TrackingMode } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../../ui';
import { act, any, CAT_LABEL, partyName, readFile, rolesOf, skuName, STATE_TONE } from './shared';
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
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<'service' | 'request'>('service');
  const [cond, setCond] = useState<'good' | 'worn' | 'damaged'>('good');
  const [note, setNote] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const handles = (p: string | null, ...rs: Role[]) => !!p && (roles.get(p) ?? []).some((r) => rs.includes(r as Role));
  const rows = data.care
    .filter((c) => filter === 'all' || ['overdue', 'end_of_life', 'due_soon'].includes(c.status) || c.openServiceRequest)
    .sort((x, y) => (x.nextDue ?? '9999').localeCompare(y.nextDue ?? '9999'));
  const count = (k: keyof typeof CARE_LABEL) => data.care.filter((c) => c.status === k).length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>After-sale care: health, service and life</h3>
      </div>
      <p className="muted">
        Every unit your company owns, holds or sold and still looks after. The seller keeps servicing what it sold, and the owning company sees the same dates
        and can ask for service. Service intervals and expected life come from each item type; where none is set it says so, and nothing is assumed.
      </p>
      <div className="kpis">
        <Kpi label="Service overdue" value={count('overdue')} tone={count('overdue') ? 'crit' : 'ok'} />
        <Kpi label="Due in 14 days" value={count('due_soon')} tone={count('due_soon') ? 'warn' : 'ok'} />
        <Kpi label="Past expected life" value={count('end_of_life')} tone={count('end_of_life') ? 'crit' : 'ok'} />
        <Kpi label="Service requests open" value={data.care.filter((c) => c.openServiceRequest).length} tone={data.care.some((c) => c.openServiceRequest) ? 'warn' : 'ok'} />
        <Kpi label="Interval not set" value={count('not_set')} tone="neutral" />
      </div>
      <div className="seg" style={{ margin: '8px 0' }}>
        <button aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>
          Needs attention
        </button>
        <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All ({data.care.length})
        </button>
      </div>
      <div className="list">
        {!rows.length && <div className="empty">Nothing needs attention.</div>}
        {rows.slice(0, 200).map((c) => {
          const seller = handles(c.seller, 'store', 'manager', 'it');
          const owner = handles(c.ownerPartyId, 'store', 'manager', 'it', 'ops') || handles(c.holderPartyId, 'store', 'manager', 'it', 'ops');
          return (
            <div key={c.itemId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <button className="link-button" onClick={() => setLabel(c.token)} style={{ textAlign: 'left' }}>
                  <strong>{skuName(data, c.skuId)}</strong>
                  <div className="muted small mono">{labelDisplay(c.token)}</div>
                </button>
                <Chip tone={CARE_TONE[c.status]}>{CARE_LABEL[c.status]}</Chip>
              </div>
              <div className="muted small">
                Owner {partyName(data, c.ownerPartyId)}
                {c.seller ? ` · sold by ${partyName(data, c.seller)} (after-sale care)` : ''} · condition {c.condition} · last check {dateLabel(c.lastCheck.slice(0, 10))}
                {c.nextDue ? ` · next service ${dateLabel(c.nextDue)}` : ''} · age {c.ageMonths} month(s){c.lifeEnds ? `, life ends ${dateLabel(c.lifeEnds)}` : ''} · {c.services} service(s)
                {c.openServiceRequest ? ` · service request ${c.openServiceRequest} open` : ''}
              </div>
              {(seller || owner) && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm"
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
                      onClick={() => {
                        setOpen(open === c.itemId && mode === 'request' ? null : c.itemId);
                        setMode('request');
                      }}
                    >
                      Ask {partyName(data, c.seller)} for service
                    </button>
                  )}
                </div>
              )}
              {open === c.itemId && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {mode === 'service' && (
                    <select className="input" aria-label="Condition found" value={cond} onChange={(e) => setCond(e.target.value as typeof cond)}>
                      <option value="good">Good</option>
                      <option value="worn">Worn</option>
                      <option value="damaged">Damaged</option>
                    </select>
                  )}
                  <input className="input" aria-label={mode === 'service' ? 'What was checked or serviced' : 'What is wrong'} placeholder={mode === 'service' ? 'What was checked or serviced' : 'What is wrong or what service is needed'} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button
                    className="btn btn-sm"
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
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ErrorNotice error={a.error} />
      {label && <Passport data={data} code={label} onClose={() => setLabel(null)} />}
    </section>
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
          <select className="input" aria-label="Item type" value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">Item type…</option>
            {data.skus
              .filter((s) => s.tracking !== 'BULK')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
          </select>
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
