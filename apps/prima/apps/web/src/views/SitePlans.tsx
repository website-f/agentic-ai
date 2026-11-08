// Site stock and fittings (Inventory monitors every site, guard uniforms included), the per-site fittings plan with
// contract-end take back, and guard / patrolling officer duty plans (Fauzan, 4 Nov 2026). Execution of guard duties
// stays in the JA app or another app; Prima prepares and publishes the plan.
import { useEffect, useState } from 'react';
import { SITE_KIT_CATEGORY_LABEL, SITE_KIT_OWNER_LABEL, dateOf, KPM_GUARD_RULES, kpmGuardKit, kpmGuardTerms, type SiteKitCategory, type SiteKitItem, type SiteKitOwner } from '@prima/core';
import { api, type CleaningProofInput, type GuardTermsInput, type OfficerHoursInput } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, hhmm, useAction, useLoad } from '../ui';
import { ReturnSpec, TimeMarkedPhoto } from './Cleaning';

// ---------- Site stock and fittings ----------

export function SiteStockView() {
  const { me, setCompanyId } = useApp();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [mode, setMode] = useState<'board' | 'fittings'>('board');
  const board = useLoad(() => api.inventorySites(), []);
  const b = board.data;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Site stock and fittings</h1>
          <p>Cleaning supplies and equipment, guard uniforms and site fittings at every site you can see. Inventory monitors; the OM who covers the site records.</p>
        </div>
        <div className="seg">
          <button aria-pressed={mode === 'board'} onClick={() => setMode('board')}>
            All sites
          </button>
          <button aria-pressed={mode === 'fittings'} onClick={() => setMode('fittings')}>
            Fittings for one site
          </button>
        </div>
      </div>
      {mode === 'board' && (
        <>
          <ErrorNotice error={board.error} />
          {!b && !board.error && <Loading what="site stock" />}
          {b && (
            <>
              <section className="kpis">
                <Kpi label="Sites" value={b.totals.sites} />
                <Kpi label="Cleaning stock flags" value={b.totals.cleaningFlags} tone={b.totals.cleaningFlags ? 'warn' : 'ok'} />
                <Kpi label="Guards with no uniform on record" value={b.totals.noUniform} tone={b.totals.noUniform ? 'crit' : 'ok'} />
                <Kpi label="Issues not confirmed / disputed" value={`${b.totals.unconfirmed} / ${b.totals.disputed}`} tone={b.totals.disputed ? 'warn' : 'neutral'} />
                <Kpi label="Fittings short or broken" value={b.totals.fittingsShort} tone={b.totals.fittingsShort ? 'warn' : 'ok'} note={`${b.totals.fittingsCheckDue} checks due`} />
                <Kpi label="Not recovered at contract end" value={b.totals.notRecovered} tone={b.totals.notRecovered ? 'crit' : 'ok'} />
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Sites</h2>
                  <Chip tone="neutral">
                    Supplies over {b.rule.value.overUsePct}% or under {b.rule.value.underUsePct}% of budget are flagged
                  </Chip>
                </div>
                {!b.rows.length && <div className="empty">Nothing to show.</div>}
                <div className="list">
                  {b.rows.map((r) => (
                    <div key={r.siteId} className="list-item" style={{ flexDirection: 'column' }}>
                      <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.siteName}</div>
                          <div className="small muted">{r.companyName}</div>
                        </div>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            setCompanyId(r.companyId);
                            setSiteId(r.siteId);
                            setMode('fittings');
                          }}
                        >
                          Fittings
                        </button>
                      </div>
                      {r.cleaning && (
                        <div className="row small" style={{ gap: 4 }}>
                          <span className="label">Cleaning</span>
                          {r.cleaning.flagged.map((f) => (
                            <Chip key={f.name} tone={f.flags.includes('over_use') || f.flags.includes('short_delivery') ? 'crit' : f.flags.includes('no_check') ? 'unknown' : 'warn'}>
                              {f.name}: {f.flags.map((x) => x.replace('_', ' ')).join(', ')}
                              {f.usePct != null ? ` (${f.usePct}%)` : ''}
                            </Chip>
                          ))}
                          {r.cleaning.equipmentShort.map((e) => (
                            <Chip key={e.name} tone="warn">
                              {e.name}: {e.working ?? '–'}/{e.required} working
                              {e.broken ? `, ${e.broken} broken` : ''}
                            </Chip>
                          ))}
                          {r.cleaning.pendingDeliveries > 0 && <Chip tone="info">{r.cleaning.pendingDeliveries} deliveries not yet received</Chip>}
                          <span className="muted">Last check {r.cleaning.lastCheck ? dateLabel(r.cleaning.lastCheck) : 'none'}</span>
                        </div>
                      )}
                      {r.security && (
                        <div className="row small" style={{ gap: 4 }}>
                          <span className="label">Guards ({r.security.guards})</span>
                          {r.security.noUniform.length > 0 && (
                            <Chip tone="crit" title={r.security.noUniform.map((p) => p.name).join(', ')}>
                              {r.security.noUniform.length} with no uniform on record
                            </Chip>
                          )}
                          {r.security.unconfirmed > 0 && <Chip tone="warn">{r.security.unconfirmed} not confirmed by the guard</Chip>}
                          {r.security.disputed > 0 && <Chip tone="warn">{r.security.disputed} disputed</Chip>}
                          {r.security.lostWaiting > 0 && <Chip tone="warn">{r.security.lostWaiting} lost or damaged waiting</Chip>}
                          {r.security.held.slice(0, 5).map((h) => (
                            <Chip key={h.kind + h.name} tone="neutral">
                              {h.qty} × {h.name}
                            </Chip>
                          ))}
                        </div>
                      )}
                      {r.fittings && (
                        <div className="row small" style={{ gap: 4 }}>
                          <span className="label">Fittings</span>
                          {r.fittings.items.map((i) => (
                            <Chip key={i.name} tone={i.working == null ? 'unknown' : 'warn'}>
                              {i.name}: {i.working ?? 'not recorded'}/{i.required}
                              {i.broken ? `, ${i.broken} broken` : ''}
                            </Chip>
                          ))}
                          {r.fittings.checkDue && <Chip tone="warn">Monthly check due</Chip>}
                          {r.fittings.notRecovered > 0 && <Chip tone="crit">{r.fittings.notRecovered} not recovered</Chip>}
                          {!r.fittings.items.length && !r.fittings.checkDue && <Chip tone="ok">All in place</Chip>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
      {mode === 'fittings' && <FittingsPicker siteId={siteId} setSiteId={setSiteId} today={dateOf(me.now)} />}
    </div>
  );
}

function FittingsPicker({ siteId, setSiteId, today }: { siteId: string | null; setSiteId: (s: string) => void; today: string }) {
  const { companyId } = useApp();
  const sites = useLoad(() => api.sites(companyId), [companyId]);
  useEffect(() => {
    if (!siteId && sites.data?.length) setSiteId(sites.data[0].site.id);
  }, [sites.data, siteId, setSiteId]);
  return (
    <>
      <div className="row">
        <select className="select" aria-label="Site" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)} style={{ maxWidth: 380 }}>
          {siteId && !sites.data?.some((s) => s.site.id === siteId) && <option value={siteId}>{siteId}</option>}
          {sites.data?.map((s) => (
            <option key={s.site.id} value={s.site.id}>
              {s.site.code} · {s.site.name}
            </option>
          ))}
        </select>
      </div>
      {siteId && <Fittings siteId={siteId} today={today} />}
    </>
  );
}

const CATS = Object.keys(SITE_KIT_CATEGORY_LABEL) as SiteKitCategory[];
const OWNERS = Object.keys(SITE_KIT_OWNER_LABEL) as SiteKitOwner[];

function Fittings({ siteId, today }: { siteId: string; today: string }) {
  const { me } = useApp();
  const k = useLoad(() => api.siteKit(siteId), [siteId]);
  const [items, setItems] = useState<SiteKitItem[]>([]);
  const [rec, setRec] = useState<null | 'install' | 'check'>(null);
  const act = useAction();
  useEffect(() => setItems(k.data?.kit?.items ?? []), [k.data?.kit?.version, siteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = k.data;
  if (k.error) return <ErrorNotice error={k.error} />;
  if (!d) return <Loading what="fittings" />;
  const manage = d.access === 'manage';
  const dirty = JSON.stringify(items) !== JSON.stringify(d.kit?.items ?? []);
  const set = (i: number, p: Partial<SiteKitItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const mgmt = me.user.role === 'director' || (me.user.role === 'pwvsb_officer' && (me.user.opsTier === 'coo' || me.user.opsTier === 'ceo'));
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Fittings plan: {d.site.name}</h2>
          <div className="row">
            <Chip tone={manage ? 'info' : 'neutral'}>{manage ? 'You manage this site' : 'View only'}</Chip>
            {d.status?.checkDue && <Chip tone="warn">Monthly check due</Chip>}
            {d.status?.lastRecord && <Chip tone="neutral">Last record {dateLabel(d.status.lastRecord)}</Chip>}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Kind</th>
                <th>Needed</th>
                <th>Owner</th>
                <th>In place / working</th>
                <th>At contract end</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const st = d.status?.items.find((x) => x.item.id === it.id);
                return (
                  <tr key={it.id}>
                    <td>
                      <input className="input" disabled={!manage} value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Item name" />
                    </td>
                    <td>
                      <select className="select" disabled={!manage} value={it.category} onChange={(e) => set(i, { category: e.target.value as SiteKitCategory })}>
                        {CATS.map((c) => (
                          <option key={c} value={c}>
                            {SITE_KIT_CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input" type="number" min={0} disabled={!manage} value={it.required} onChange={(e) => set(i, { required: Number(e.target.value) })} style={{ width: 70 }} aria-label={`${it.name} needed`} />
                    </td>
                    <td>
                      <select className="select" disabled={!manage} value={it.owner} onChange={(e) => set(i, { owner: e.target.value as SiteKitOwner })}>
                        {OWNERS.map((o) => (
                          <option key={o} value={o}>
                            {SITE_KIT_OWNER_LABEL[o]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {st?.inPlace == null ? (
                        <Chip tone="unknown">Not recorded</Chip>
                      ) : (
                        <Chip tone={(st.short ?? 0) > 0 || (st.broken ?? 0) > 0 ? 'warn' : 'ok'}>
                          {st.working}/{st.inPlace} working{st.broken ? `, ${st.broken} broken` : ''}
                        </Chip>
                      )}
                    </td>
                    <td>
                      <select className="select" disabled={!manage || it.owner === 'client'} value={it.atEnd ?? 'take_back'} onChange={(e) => set(i, { atEnd: e.target.value as 'take_back' | 'hand_over' })}>
                        <option value="take_back">Take back</option>
                        <option value="hand_over">Hand over (contract says)</option>
                      </select>
                      {it.atEnd === 'hand_over' && <input className="input" disabled={!manage} placeholder="Contract clause" value={it.handOverRef ?? ''} onChange={(e) => set(i, { handOverRef: e.target.value })} aria-label="Contract clause" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!items.length && <div className="empty">No fittings planned for this site.</div>}
        {manage && (
          <div className="panel-body row">
            <button
              className="btn btn-sm"
              onClick={() => {
                let n = items.length + 1;
                while (items.some((x) => x.id === `item-${n}`)) n++;
                setItems([...items, { id: `item-${n}`, name: 'New item', category: 'furniture', required: 1, owner: 'company', note: '', atEnd: 'take_back', handOverRef: '' }]);
              }}
            >
              Add an item
            </button>
            <button
              className="btn btn-sm"
              title="Adds the equipment a KPM guard contract asks for; change the numbers to the site's shifts"
              onClick={() => {
                const raw = window.prompt('Most guards on any one shift at this site?', '1');
                if (raw == null) return;
                const m = Math.max(1, Number(raw) || 1);
                const add = kpmGuardKit(m, m * 2).filter((x) => !items.some((y) => y.id === x.id));
                setItems([...items, ...add]);
              }}
            >
              Add KPM guard equipment
            </button>
            <button className="btn btn-primary btn-sm" disabled={!dirty || act.busy} onClick={() => act.run(() => api.saveSiteKit(siteId, items, d.kit?.version ?? null), 'Fittings plan saved.')}>
              Save plan
            </button>
            <button className="btn btn-sm" disabled={!d.kit || dirty} onClick={() => setRec('install')}>
              Record install
            </button>
            <button className="btn btn-sm" disabled={!d.kit || dirty} onClick={() => setRec('check')}>
              Record monthly check
            </button>
          </div>
        )}
        <ErrorNotice error={act.error} />
      </section>
      {d.kit && d.kit.records.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Records</h2>
          </div>
          <div className="list">
            {[...d.kit.records].reverse().slice(0, 12).map((r) => (
              <div key={r.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {r.kind === 'install' ? 'Install' : r.kind === 'check' ? 'Monthly check' : 'Contract end'} · {dateLabel(r.date)}
                  </div>
                  <div className="small muted">
                    By {r.by}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
                <Chip tone="neutral">{r.lines.length} lines</Chip>
              </div>
            ))}
          </div>
        </section>
      )}
      <CloseOut siteId={siteId} today={today} manage={manage} mgmt={mgmt} />
      {rec && d.kit && <KitRecordDrawer siteId={siteId} kind={rec} items={d.kit.items} version={d.kit.version} today={today} onClose={() => setRec(null)} />}
    </>
  );
}

function KitRecordDrawer({ siteId, kind, items, version, today, onClose }: { siteId: string; kind: 'install' | 'check'; items: SiteKitItem[]; version: number; today: string; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, { inPlace: string; broken: string }>>({});
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<CleaningProofInput | null>(null);
  const act = useAction();
  const lines = items
    .filter((i) => kind === 'check' || vals[i.id]?.inPlace?.trim())
    .map((i) => ({ itemId: i.id, inPlace: Number(vals[i.id]?.inPlace || 0), broken: Number(vals[i.id]?.broken || 0) }));
  return (
    <Drawer title={kind === 'install' ? 'Record install' : 'Monthly check'} onClose={onClose}>
      <div style={{ display: 'grid', gap: 10 }}>
        {kind === 'check' && <div className="small muted">A check counts every item on the list (0 if none).</div>}
        {items.map((i) => (
          <div key={i.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span>{i.name}</span>
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" type="number" min={0} placeholder="in place" value={vals[i.id]?.inPlace ?? ''} onChange={(e) => setVals({ ...vals, [i.id]: { broken: vals[i.id]?.broken ?? '', inPlace: e.target.value } })} style={{ width: 80 }} aria-label={`${i.name} in place`} />
              <input className="input" type="number" min={0} placeholder="broken" value={vals[i.id]?.broken ?? ''} onChange={(e) => setVals({ ...vals, [i.id]: { inPlace: vals[i.id]?.inPlace ?? '', broken: e.target.value } })} style={{ width: 80 }} aria-label={`${i.name} broken`} />
            </span>
          </div>
        ))}
        <TimeMarkedPhoto date={today} value={proof} onChange={setProof} />
        <label className="field">
          <span className="label">Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !proof || !lines.length}
          onClick={async () => {
            const r = await act.run(() => api.recordSiteKit(siteId, { kind, date: today, lines, note, proof: proof! }, version), 'Recorded.');
            if (r) onClose();
          }}
        >
          Save
        </button>
      </div>
    </Drawer>
  );
}

function CloseOut({ siteId, today, manage, mgmt }: { siteId: string; today: string; manage: boolean; mgmt: boolean }) {
  const c = useLoad(() => api.closeOutList(siteId), [siteId]);
  const [open, setOpen] = useState(false);
  const [gift, setGift] = useState<{ ref: string; name: string } | null>(null);
  const d = c.data;
  if (c.error) return <ErrorNotice error={c.error} />;
  if (!d || !d.lines.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Contract end: take everything back</h2>
        {d.closed && <Chip tone={d.notRecovered ? 'crit' : 'ok'}>{d.notRecovered ? `${d.notRecovered} not recovered` : 'All recovered'}</Chip>}
      </div>
      <div className="small muted panel-body">Every item comes back unless the contract hands it over, or the COO or CEO approves giving it with a reason.</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>In place</th>
              <th>May hand over</th>
              <th>Back / handed over</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.ref}>
                <td>
                  {l.name}
                  <div className="small muted">
                    {l.atEnd === 'hand_over' ? `Contract: ${l.handOverRef}` : l.gift ? `Approved by ${l.gift.by}: ${l.gift.reason}` : 'Take back'}
                  </div>
                </td>
                <td className="mono">{l.inPlace}</td>
                <td className="mono">{l.mayGive}</td>
                <td className="mono">
                  {l.takenBack} / {l.handedOver}
                  {l.notRecovered ? <Chip tone="crit">{l.notRecovered} missing</Chip> : null}
                </td>
                <td>
                  {mgmt && l.atEnd !== 'hand_over' && (
                    <button className="btn btn-sm" onClick={() => setGift({ ref: l.ref, name: l.name })}>
                      Approve giving
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manage && (
        <div className="panel-body">
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Record take back at contract end
          </button>
        </div>
      )}
      {open && <TakeBackDrawer siteId={siteId} lines={d.lines} today={today} onClose={() => setOpen(false)} />}
      {gift && <GiftDrawer siteId={siteId} item={gift} onClose={() => setGift(null)} />}
    </section>
  );
}

function GiftDrawer({ siteId, item, onClose }: { siteId: string; item: { ref: string; name: string }; onClose: () => void }) {
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const act = useAction();
  return (
    <Drawer title="Approve giving to the client" sub={item.name} onClose={onClose}>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="field">
          <span className="label">How many</span>
          <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Reason (required)</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !reason.trim()}
          onClick={async () => {
            const r = await act.run(() => api.approveSiteGift(siteId, { ref: item.ref, qty: Number(qty), reason }), 'Approved. The OM may hand it over at contract end.');
            if (r) onClose();
          }}
        >
          Approve
        </button>
      </div>
    </Drawer>
  );
}

function TakeBackDrawer({ siteId, lines, today, onClose }: { siteId: string; lines: { ref: string; name: string; inPlace: number; mayGive: number; handedOver: number }[]; today: string; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, { back: string; given: string }>>({});
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<CleaningProofInput | null>(null);
  const act = useAction();
  const out = lines.filter((l) => vals[l.ref]?.back?.trim() || vals[l.ref]?.given?.trim()).map((l) => ({ ref: l.ref, takenBack: Number(vals[l.ref]?.back || 0), handedOver: Number(vals[l.ref]?.given || 0) }));
  return (
    <Drawer title="Take back at contract end" onClose={onClose}>
      <div style={{ display: 'grid', gap: 10 }}>
        {lines.map((l) => (
          <div key={l.ref} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span>
              {l.name} <span className="small muted">({l.inPlace} in place)</span>
            </span>
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" type="number" min={0} placeholder="back" value={vals[l.ref]?.back ?? ''} onChange={(e) => setVals({ ...vals, [l.ref]: { given: vals[l.ref]?.given ?? '', back: e.target.value } })} style={{ width: 70 }} aria-label={`${l.name} taken back`} />
              <input className="input" type="number" min={0} max={l.mayGive - l.handedOver} disabled={l.mayGive - l.handedOver <= 0} placeholder="given" value={vals[l.ref]?.given ?? ''} onChange={(e) => setVals({ ...vals, [l.ref]: { back: vals[l.ref]?.back ?? '', given: e.target.value } })} style={{ width: 70 }} aria-label={`${l.name} handed over`} />
            </span>
          </div>
        ))}
        <TimeMarkedPhoto date={today} value={proof} onChange={setProof} label="Time-marked photo of the items collected" />
        <label className="field">
          <span className="label">Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !proof || !out.length}
          onClick={async () => {
            const r = await act.run(() => api.recordTakeBack(siteId, { date: today, lines: out, note, proof: proof! }), 'Take back recorded.');
            if (r) onClose();
          }}
        >
          Save
        </button>
      </div>
    </Drawer>
  );
}

// ---------- Guard and patrolling officer duty plans ----------

export function DutyView() {
  const { me, companyId } = useApp();
  const today = dateOf(me.now);
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<'posts' | 'routes'>('posts');
  const [siteId, setSiteId] = useState('');
  const [officerId, setOfficerId] = useState('');
  const sites = useLoad(() => api.sites(companyId), [companyId]);
  const officers = useLoad(() => api.dutyOfficers(), []);
  useEffect(() => {
    if (!siteId && sites.data?.length) setSiteId(sites.data[0].site.id);
  }, [sites.data, siteId]);
  useEffect(() => {
    if (!officerId && officers.data?.length) setOfficerId(officers.data[0].id);
  }, [officers.data, officerId]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Guard duty plans</h1>
          <p>Minute-by-minute duties for each post from the roster, and each patrolling officer's daily route. Prima plans and publishes; the JA app (or the app in use) runs the work and reports back monthly.</p>
        </div>
        <div className="row">
          <div className="seg">
            <button aria-pressed={mode === 'posts'} onClick={() => setMode('posts')}>
              Posts
            </button>
            <button aria-pressed={mode === 'routes'} onClick={() => setMode('routes')}>
              Officer routes
            </button>
          </div>
          <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
      </div>
      {mode === 'posts' && (
        <>
          <select className="select" aria-label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} style={{ maxWidth: 380 }}>
            {sites.data?.map((s) => (
              <option key={s.site.id} value={s.site.id}>
                {s.site.code} · {s.site.name}
              </option>
            ))}
          </select>
          {siteId && <PostPlan siteId={siteId} date={date} />}
        </>
      )}
      {mode === 'routes' && (
        <>
          <ErrorNotice error={officers.error} />
          {officers.data && !officers.data.length && <div className="empty">No patrolling officers on sites you cover.</div>}
          {!!officers.data?.length && (
            <select className="select" aria-label="Officer" value={officerId} onChange={(e) => setOfficerId(e.target.value)} style={{ maxWidth: 380 }}>
              {officers.data.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.sites} sites
                </option>
              ))}
            </select>
          )}
          {officerId && <RoutePlan officerId={officerId} date={date} />}
        </>
      )}
    </div>
  );
}

type Duty = { id: string; who: string; whoName: string; kind: string; title: string; start: string; end: string; minutes: number };

function DutyColumns({ tasks }: { tasks: Duty[] }) {
  const by = new Map<string, Duty[]>();
  for (const t of tasks) by.set(t.who, [...(by.get(t.who) ?? []), t]);
  if (!tasks.length) return <div className="empty">Nothing planned.</div>;
  return (
    <div className="table-wrap">
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${by.size}, minmax(220px, 1fr))`, gap: 12, padding: 12 }}>
        {[...by.entries()].map(([who, list]) => (
          <div key={who}>
            <div style={{ fontWeight: 600 }}>{list[0].whoName}</div>
            <ol className="timeline" style={{ marginTop: 8 }}>
              {list.map((t) => (
                <li key={t.id}>
                  <time>
                    {hhmm(t.start)}
                    <br />
                    {hhmm(t.end)}
                  </time>
                  <div>
                    <div style={{ fontWeight: t.kind === 'patrol' || t.kind === 'visit' ? 600 : 400 }}>{t.title}</div>
                    <div className="small muted">{t.minutes} min</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function PostPlan({ siteId, date }: { siteId: string; date: string }) {
  const p = useLoad(() => api.dutyPosts(siteId, date), [siteId, date]);
  const act = useAction();
  const d = p.data;
  if (p.error) return <ErrorNotice error={p.error} />;
  if (!d) return <Loading what="duty plan" />;
  const plan = d.saved ?? d.preview;
  return (
    <>
      <ContractTerms siteId={siteId} d={d} />
      <section className="panel">
        <div className="panel-head">
          <h2>{d.saved ? 'Published duty plan' : 'Preview (not published)'}</h2>
          <div className="row">
            <Chip tone="neutral">Round every {d.site.patrolEvery} min</Chip>
            {d.site.armed && <Chip tone="crit">Armed site</Chip>}
            {d.outOfDate && <Chip tone="warn">Roster changed since publishing</Chip>}
            {d.saved && <Chip tone="ok">Published by {d.saved.publishedBy}</Chip>}
            {d.access === 'manage' ? (
              <button className="btn btn-primary btn-sm" disabled={act.busy || (!!d.saved && !d.outOfDate)} onClick={() => act.run(() => api.publishDutyPosts(siteId, date), 'Duty plan published.')}>
                {d.saved ? 'Publish again' : 'Publish'}
              </button>
            ) : (
              <Chip tone="neutral">View only</Chip>
            )}
          </div>
        </div>
        <ErrorNotice error={act.error} />
        {plan.warnings.length > 0 && (
          <div className="notice" data-tone="warn">
            {plan.warnings.join(' ')}
          </div>
        )}
        <DutyColumns tasks={plan.tasks} />
      </section>
      <ReturnSpec spec={d.returnSpec} title="What the JA app (or the app in use) sends back each month" />
    </>
  );
}

type PostsView = Awaited<ReturnType<typeof api.dutyPosts>>;
const RM = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The site's contract terms (Fauzan, 4 Nov 2026, from the KPM guard contract): guards each shift needs and the rate per
 * guard-hour. The plan checks the roster against them and shows what a gap would cost under the contract's deductions.
 */
function ContractTerms({ siteId, d }: { siteId: string; d: PostsView }) {
  const t = d.terms;
  const manage = d.access === 'manage';
  const [edit, setEdit] = useState<GuardTermsInput | null>(null);
  const act = useAction();
  const start = () =>
    setEdit(
      t
        ? { contractRef: t.contractRef, ratePerGuardHour: t.ratePerGuardHour, shifts: t.shifts.map((x) => ({ ...x })), minCheckpoints: t.minCheckpoints, officerVisitDays: t.officerVisitDays, dailyReportBy: t.dailyReportBy, guardRules: t.guardRules ?? null }
        : { contractRef: '', ratePerGuardHour: null, ...kpmGuardTerms(1), guardRules: null },
    );
  const NO_RULES: NonNullable<GuardTermsInput['guardRules']> = { maxAge: null, malaysiansOnly: false, csgWithinMonths: null, vettingWithinWorkingDays: null, urineTestWithinDays: null, maxRelatives: null };
  const gr = edit?.guardRules ?? NO_RULES;
  const setGr = (patch: Partial<typeof NO_RULES>) => edit && setEdit({ ...edit, guardRules: { ...gr, ...patch } });
  const setShift = (i: number, patch: Partial<GuardTermsInput['shifts'][number]>) => edit && setEdit({ ...edit, shifts: edit.shifts.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Contract terms</h2>
        <div className="row">
          {t ? <Chip tone="neutral">{t.contractRef || 'No reference'}</Chip> : <Chip tone="unknown">Not entered</Chip>}
          {manage && !edit && (
            <button className="btn btn-sm" onClick={start}>
              {t ? 'Change terms' : 'Enter the contract terms'}
            </button>
          )}
        </div>
      </div>
      {!t && !edit && <div className="small muted panel-body">Enter the guards each shift needs and the rate per guard-hour from the client's contract, so the plan checks the roster and shows what a gap would cost.</div>}
      {t && d.cover && !edit && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shift</th>
                  <th>Hours</th>
                  <th>Contract needs</th>
                  <th>On the roster</th>
                  <th>If not filled</th>
                </tr>
              </thead>
              <tbody>
                {d.cover.cover.map((c) => (
                  <tr key={c.name + c.start}>
                    <td>
                      {c.name} {c.start}-{c.end}
                    </td>
                    <td className="mono">{c.hours}</td>
                    <td className="mono">{c.required}</td>
                    <td className="mono">
                      {c.rostered} {c.short > 0 ? <Chip tone="crit">{c.short} short</Chip> : <Chip tone="ok">Covered</Chip>}
                    </td>
                    <td className="mono">{c.short > 0 ? (c.deduction != null ? `≈ ${RM(c.deduction)}` : 'No rate entered') : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.cover.offTimes.length > 0 && (
            <div className="notice" data-tone="warn">
              Guards are rostered at {d.cover.offTimes.join(', ')}, which is not a shift time in the contract. They are not counted as cover. Change the roster or the terms.
            </div>
          )}
          <div className="small panel-body">
            {t.ratePerGuardHour != null ? `${RM(t.ratePerGuardHour)} per guard-hour · month's price ≈ ${RM(d.cover.monthlyPrice!)} · each missed clocking ≈ ${RM(d.cover.missedClockingCost!)}` : 'No rate per guard-hour entered.'}
            {' · '}Guard tour points: at least {t.minCheckpoints} ({d.site.checkpoints} set)
            {t.officerVisitDays ? ` · Officer visits at least every ${t.officerVisitDays} days` : ''}
            {t.dailyReportBy ? ` · Daily report to the premise administrator by ${t.dailyReportBy} next day` : ''}
          </div>
          {d.ruleClashes.length > 0 && (
            <div className="panel-body">
              <div className="label">Contract and our rules differ (our rules apply)</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Topic</th>
                      <th>Our rule</th>
                      <th>Contract</th>
                      <th>What it means here</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ruleClashes.map((c) => (
                      <tr key={c.topic}>
                        <td>
                          <Chip tone="warn">{c.topic}</Chip>
                        </td>
                        <td className="small">{c.ours}</td>
                        <td className="small">{c.contract}</td>
                        <td className="small">{c.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <details className="panel-body small">
            <summary>Contract deductions (KPM Lampiran A3, estimates only: the client decides)</summary>
            <ul>
              {d.deductionRules.map((r) => (
                <li key={r.key}>
                  {r.what}: <span className="mono">{r.formula}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {edit && (
        <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <label className="field">
              <span className="label">Contract reference</span>
              <input className="input" value={edit.contractRef} onChange={(e) => setEdit({ ...edit, contractRef: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Rate per guard-hour (RM)</span>
              <input className="input" type="number" min={0} step="0.01" value={edit.ratePerGuardHour ?? ''} onChange={(e) => setEdit({ ...edit, ratePerGuardHour: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 120 }} />
            </label>
            <label className="field">
              <span className="label">Guard tour points (least)</span>
              <input className="input" type="number" min={0} value={edit.minCheckpoints} onChange={(e) => setEdit({ ...edit, minCheckpoints: Number(e.target.value) || 0 })} style={{ width: 90 }} />
            </label>
            <label className="field">
              <span className="label">Officer visit every (days)</span>
              <input className="input" type="number" min={1} value={edit.officerVisitDays ?? ''} onChange={(e) => setEdit({ ...edit, officerVisitDays: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 90 }} />
            </label>
            <label className="field">
              <span className="label">Daily report by</span>
              <input className="input" type="time" value={edit.dailyReportBy ?? ''} onChange={(e) => setEdit({ ...edit, dailyReportBy: e.target.value || null })} />
            </label>
          </div>
          <div className="label">What the contract says about the guards (compared with our rules and flagged; our rules apply)</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field">
              <span className="label">Oldest age allowed</span>
              <input className="input" type="number" min={0} value={gr.maxAge ?? ''} onChange={(e) => setGr({ maxAge: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 80 }} />
            </label>
            <label className="field">
              <span className="label">CSG within (months)</span>
              <input className="input" type="number" min={0} value={gr.csgWithinMonths ?? ''} onChange={(e) => setGr({ csgWithinMonths: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 80 }} />
            </label>
            <label className="field">
              <span className="label">KDN vetting within (working days)</span>
              <input className="input" type="number" min={0} value={gr.vettingWithinWorkingDays ?? ''} onChange={(e) => setGr({ vettingWithinWorkingDays: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 100 }} />
            </label>
            <label className="field">
              <span className="label">Urine test within (days)</span>
              <input className="input" type="number" min={0} value={gr.urineTestWithinDays ?? ''} onChange={(e) => setGr({ urineTestWithinDays: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 80 }} />
            </label>
            <label className="field">
              <span className="label">Most related guards</span>
              <input className="input" type="number" min={0} value={gr.maxRelatives ?? ''} onChange={(e) => setGr({ maxRelatives: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 80 }} />
            </label>
            <label className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={gr.malaysiansOnly} onChange={(e) => setGr({ malaysiansOnly: e.target.checked })} />
              Malaysians only
            </label>
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...edit, guardRules: { ...KPM_GUARD_RULES } })}>
              KPM contract rules
            </button>
          </div>
          <div className="label">Shifts and guards the contract needs</div>
          {edit.shifts.map((x, i) => (
            <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" aria-label="Shift name" value={x.name} onChange={(e) => setShift(i, { name: e.target.value })} style={{ maxWidth: 140 }} />
              <input className="input" type="time" aria-label="Shift start" value={x.start} onChange={(e) => setShift(i, { start: e.target.value })} />
              <input className="input" type="time" aria-label="Shift end" value={x.end} onChange={(e) => setShift(i, { end: e.target.value })} />
              <input className="input" type="number" min={0} aria-label="Guards" value={x.guards} onChange={(e) => setShift(i, { guards: Number(e.target.value) || 0 })} style={{ width: 80 }} />
              <span className="small">guards</span>
              {edit.shifts.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...edit, shifts: edit.shifts.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {edit.shifts.length < 4 && (
              <button className="btn btn-sm" onClick={() => setEdit({ ...edit, shifts: [...edit.shifts, { name: `Shift ${edit.shifts.length + 1}`, start: '08:00', end: '20:00', guards: 1 }] })}>
                Add a shift
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...edit, ...kpmGuardTerms(edit.shifts[0]?.guards || 1), guardRules: { ...KPM_GUARD_RULES } })}>
              Use the KPM school contract (2 x 12 h, 4 points, weekly visit, report by 9am)
            </button>
          </div>
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy}
              onClick={async () => {
                const r = await act.run(() => api.saveDutyTerms(siteId, edit, t?.version ?? null), 'Contract terms saved.');
                if (r) setEdit(null);
              }}
            >
              Save terms
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function RoutePlan({ officerId, date }: { officerId: string; date: string }) {
  // The officer's hours are flexible, day or night (Fauzan, 4 Nov 2026): the OM sets them and the route follows.
  const [hours, setHours] = useState<OfficerHoursInput | null>(null);
  const [draft, setDraft] = useState<OfficerHoursInput | null>(null);
  useEffect(() => {
    setHours(null);
    setDraft(null);
  }, [officerId, date]);
  const r = useLoad(() => api.dutyRoute(officerId, date, hours), [officerId, date, hours?.start, hours?.end, hours?.mealMin]);
  const act = useAction();
  const d = r.data;
  useEffect(() => {
    if (d && !draft) setDraft(d.hours);
  }, [d, draft]);
  if (r.error)
    return (
      <>
        <ErrorNotice error={r.error} />
        <button className="btn btn-sm" onClick={() => { setHours(null); setDraft(null); }}>
          Back to the usual hours
        </button>
      </>
    );
  if (!d) return <Loading what="route" />;
  const changed = !!hours;
  const plan = changed || !d.saved ? d.preview : d.saved;
  const hm = (s: string) => /^\d{2}:\d{2}$/.test(s);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{d.saved ? 'Published route' : 'Preview (not published)'}</h2>
        <div className="row">
          {d.saved && <Chip tone="ok">Published by {d.saved.publishedBy}</Chip>}
          {d.access === 'manage' ? (
            <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.publishDutyRoute(officerId, date, d.saved?.publishedAt ?? null, d.hours), 'Route published.')}>
              {d.saved ? 'Publish again' : 'Publish'}
            </button>
          ) : (
            <Chip tone="neutral">View only</Chip>
          )}
        </div>
      </div>
      {draft && (
        <div className="panel-body row" style={{ alignItems: 'flex-end' }}>
          <label className="field">
            <span className="label">Starts</span>
            <input className="input" type="time" aria-label="Officer starts" disabled={d.access !== 'manage'} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Ends (next day if earlier)</span>
            <input className="input" type="time" aria-label="Officer ends" disabled={d.access !== 'manage'} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Meal break (min)</span>
            <input className="input" type="number" min={0} max={120} aria-label="Meal break minutes" disabled={d.access !== 'manage'} value={draft.mealMin} onChange={(e) => setDraft({ ...draft, mealMin: Number(e.target.value) })} style={{ width: 90 }} />
          </label>
          {d.access === 'manage' && (
            <button className="btn btn-sm" disabled={!hm(draft.start) || !hm(draft.end) || (draft.start === d.hours.start && draft.end === d.hours.end && draft.mealMin === d.hours.mealMin)} onClick={() => setHours(draft)}>
              Plan with these hours
            </button>
          )}
          {changed && <Chip tone="warn">Not published yet at these hours</Chip>}
        </div>
      )}
      <ErrorNotice error={act.error} />
      {plan.warnings.length > 0 && (
        <div className="notice" data-tone="warn">
          {plan.warnings.join(' ')}
        </div>
      )}
      <DutyColumns tasks={plan.tasks} />
    </section>
  );
}
