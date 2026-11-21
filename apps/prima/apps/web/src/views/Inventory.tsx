import { Select } from '../SearchSelect';
import { createContext, useContext, useState } from 'react';
import { api } from '../api';
import { saveFile } from '../save';
import { Chip, Loading, dateLabel, useAction, useLoad } from '../ui';
import { OpForm, type Field } from './ItPolicyPanel';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

/**
 * Kawalan Inventori (Part U, Fitri package; Fauzan's answers 14 Nov 2026): the monthly and the 6-monthly major stock
 * count (2-5 PM, stock in and out stopped), the variance decisions (the only book correction), the Monday opening
 * balance, the CSG/TNG course uniform buffer, the 7 KPIs with "data as at", the monthly report, the purchase match
 * list, the disposal cases and the damage charges HR reviews. The server checks every rule again; this screen only
 * offers the steps.
 */
type CountLine = { itemId: string; name: string; size: string | null; system: number; moved: number; physical: number | null; variance: number | null; reason: string | null; decision: { kind: string; by: string; reason: string; value: number | null } | null };
type Board = {
  storeId: string;
  can: { count: boolean; decide: boolean; mgmt: boolean; hr: boolean };
  settings: { countEveryDays: number; majorWindow: { from: string; to: string }; adjustOgmAbove: number; disposalApproveAbove: number; disposalDays: number; inStockReadyDays: number; recordsYears: number; legalFlag: string; kpiTargets: Record<string, number> };
  openCount: { id: string; kind: string; at: string; frozen: boolean; late: boolean; lines: CountLine[] } | null;
  countDue: boolean;
  majorDue: boolean;
  counts: { id: string; kind: string; at: string; status: string; witness: { name: string } | null; lines: CountLine[] }[];
  urgent: { id: string; status: string; by: string; at: string; d: { itemId: string; qty: number; reason: string } }[];
  repeatShort: string[];
  week: { monday: string; confirmed: boolean; late: boolean };
  buffer: { id: string; name: string; size: string | null; onHand: number; level: number | null; below: boolean; stockOut: boolean; suggest: { qty: number; weekly: number; leadDays: number } | null }[];
  bufferStale: { id: string; name: string; lastReview: string | null }[];
  suggestions: { id: string; name: string; s: { qty: number; weekly: number; leadDays: number } }[];
  kpi: Record<string, unknown> & { dataAsAt: string; sources: string[] };
  disposals: { id: string; ref: string; status: string; siteName: string | null; at: string; daysOpen: number | null; late: boolean; value: number | null; writeOff: number | null; lines: { n: number; name: string; qty: number; reason: string; outcome: string | null; method: string | null; done: unknown }[] }[];
  charges: { id: string; status: string; personName: string; staffNo: string; itemName: string; amount: number | null; cause: string; period: string; hr: { decision: string } | null; legalFlag: string; by: string }[];
  reports: { id: string; month: string; status: string; openItems: string[] }[];
  pastLife: { issueId: string; item: string; personName: string; since: string }[];
  dataAsAt: string;
};
const send = (op: string) => (i: Record<string, unknown>) => api.inventoryAct(op, i);

/**
 * P105: the store's items (from the store list on the same screen), so a field that names a store item is a
 * searchable pick-list by name instead of a typed record id nobody sees. Empty: the typed field stays.
 */
const StoreItems = createContext<{ id: string; label: string }[]>([]);
function useItemField() {
  const items = useContext(StoreItems);
  return (k: string, l: string): Field =>
    items.length ? { k, l, t: 'select', o: items.map((x) => x.id), labels: Object.fromEntries(items.map((x) => [x.id, x.label])) } : { k, l };
}
const REASONS = ['shortage', 'lost', 'damaged', 'counting_error', 'issue_not_recorded', 'receipt_not_recorded', 'other'];
const CAUSES = ['WEAR', 'ACCIDENT', 'NEGLIGENCE', 'MISUSE', 'UNKNOWN'];
const DISP_STATUS: Record<string, string> = { semakan: 'Semakan', kelulusan: 'Kelulusan', kaedah: 'Kaedah', pelaksanaan: 'Pelaksanaan', bukti: 'Bukti', selesai: 'Selesai', ditolak: 'Ditolak' };
const KPI_LABEL: Record<string, string> = {
  accuracyPct: 'Ketepatan stok %',
  unauthorised: 'Transaksi tanpa kelulusan',
  recordedPct: 'Pergerakan direkod lengkap %',
  uniformRecordPct: 'Uniform direkod kepada nama %',
  countCompletionPct: 'Kiraan dibuat %',
  investigatedPct: 'Varians disiasat %',
  stockOuts: 'Kehabisan stok kritikal',
  reachedStorePct: 'Pembelian sampai ke stor %',
};

/** P107: the damage / loss charges and the items past their useful life as data tables (this panel is in Malay). */
type Charge = Board['charges'][number];
const CHARGE_COLUMNS: DtColumn<Charge>[] = [
  { id: 'person', label: 'Nama', value: (c) => c.personName, render: (c) => `${c.personName} (${c.staffNo})`, phone: 'title' },
  { id: 'item', label: 'Barang', value: (c) => c.itemName, phone: 'sub' },
  { id: 'cause', label: 'Punca', value: (c) => c.cause },
  { id: 'amount', label: 'Jumlah', value: (c) => c.amount, sort: 'money', render: (c) => (c.amount === null ? 'menunggu harga' : `RM${c.amount.toFixed(2)}`) },
  { id: 'period', label: 'Gaji', value: (c) => (c.amount === null ? null : c.period), hideBelow: 1100 },
  { id: 'status', label: 'Status', value: (c) => c.status, render: (c) => <Chip tone={c.status === 'due' ? 'warn' : 'info'}>{c.status}</Chip> },
  { id: 'hr', label: 'HR', value: (c) => c.hr?.decision ?? null, hideBelow: 1200 },
];
const CHARGE_FILTERS: DtFilter<Charge>[] = [
  { id: 'status', label: 'Status', value: (c) => c.status },
  { id: 'period', label: 'Gaji', value: (c) => (c.amount === null ? null : c.period) },
  { id: 'cause', label: 'Punca', value: (c) => c.cause },
];
type PastLife = Board['pastLife'][number];
const PAST_LIFE_COLUMNS: DtColumn<PastLife>[] = [
  { id: 'item', label: 'Barang', value: (p) => p.item, render: (p) => <strong>{p.item}</strong>, phone: 'title' },
  { id: 'person', label: 'Dengan', value: (p) => p.personName, phone: 'sub' },
  { id: 'since', label: 'Sejak', value: (p) => p.since, sort: 'date' },
];

async function pdf(op: string, id: string) {
  const p = (await api.inventoryAct(op, { id })) as { name: string; base64: string };
  await saveFile(p.name, `data:application/pdf;base64,${p.base64}`);
  return p;
}

export function InventoryPanel({ items = [] }: { items?: { id: string; label: string }[] }) {
  const { data, error } = useLoad(() => api.inventoryAct('board', {}) as Promise<Board>, []);
  const act = useAction();
  if (error) return null;
  if (!data) return <Loading what="inventory control" />;
  const k = data.kpi;
  return (
    <StoreItems.Provider value={items}>
    <section className="panel">
      <div className="panel-head">
        <h3>Kawalan Inventori</h3>
        <span className="muted small">Data setakat {data.dataAsAt.slice(0, 16).replace('T', ' ')} · sumber: {k.sources.join(', ')}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {data.openCount?.frozen && <Chip tone={data.openCount.late ? 'crit' : 'warn'}>Kiraan stok besar sedang berjalan: stok keluar masuk dibekukan</Chip>}
        {data.countDue && <Chip tone="warn">Kiraan bulanan perlu dibuat (setiap {data.settings.countEveryDays} hari)</Chip>}
        {data.majorDue && <Chip tone="warn">Kiraan besar 6 bulanan ({data.settings.majorWindow.from}-{data.settings.majorWindow.to}) belum dibuat</Chip>}
        <Chip tone={data.week.confirmed ? 'ok' : data.week.late ? 'warn' : 'info'}>Baki pembukaan minggu {dateLabel(data.week.monday)}: {data.week.confirmed ? 'disahkan' : 'belum'}</Chip>
      </div>
      <h4>KPI bulan ini</h4>
      <div className="muted small">
        {Object.entries(KPI_LABEL)
          .map(([key, l]) => `${l}: ${k[key] ?? 'tiada data'}${data.settings.kpiTargets[key] !== undefined ? ` (sasaran ${data.settings.kpiTargets[key]})` : ''}`)
          .join(' · ')}
      </div>
      {data.can.count && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {!data.openCount && (
            <>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.inventoryAct('countStart', { kind: 'monthly' }), 'Kiraan bulanan dibuka.')}>
                Mula kiraan bulanan
              </button>
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.inventoryAct('countStart', { kind: 'major' }), 'Kiraan besar dibuka; stok dibekukan.')}>
                Mula kiraan besar (bekukan stok)
              </button>
            </>
          )}
          {!data.week.confirmed && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.inventoryAct('weekClose', {}), 'Baki pembukaan disahkan.')}>
              Sahkan baki pembukaan minggu ini
            </button>
          )}
        </div>
      )}
      {data.openCount && <OpenCount c={data.openCount} canCount={data.can.count} canMgmt={data.can.mgmt} />}
      {data.counts.filter((c) => c.status === 'variance').map((c) => (
        <Variances key={c.id} c={c} canDecide={data.can.decide} canMgmt={data.can.mgmt} limit={data.settings.adjustOgmAbove} />
      ))}
      {data.repeatShort.length > 0 && <p className="small">Isu berulang (kurang 3 kali berturut-turut): {data.repeatShort.join(', ')}</p>}
      {data.buffer.length > 0 && (
        <>
          <h4>Simpanan uniform kursus CSG/TNG</h4>
          {data.buffer.map((b) => (
            <div key={b.id} className="item small">
              {b.name} {b.size ?? ''}: {b.onHand} ada, simpanan {b.level ?? 'belum ditetapkan'} {b.below && <Chip tone="crit">Bawah simpanan</Chip>} {b.stockOut && <Chip tone="crit">Habis</Chip>}
              {b.suggest && <span className="muted"> · cadangan pesan {b.suggest.qty} (guna {b.suggest.weekly}/minggu, tempoh {b.suggest.leadDays} hari)</span>}
            </div>
          ))}
        </>
      )}
      {data.bufferStale.length > 0 && <p className="muted small">Paras simpanan perlu disemak semula: {data.bufferStale.map((b) => b.name).join(', ')}</p>}
      {data.can.mgmt && (
        <OpForm title="Tetapkan simpanan kursus (OGM)" op="buffer" send={send('buffer')} fields={[(items.length ? { k: 'itemId', l: 'Barang', t: 'select', o: items.map((x) => x.id), labels: Object.fromEntries(items.map((x) => [x.id, x.label])) } : { k: 'itemId', l: 'ID barang' }) as Field, { k: 'level', l: 'Paras simpanan', t: 'number' }, { k: 'reason', l: 'Sebab (pengambilan kursus)' }]} />
      )}
      {data.suggestions.length > 0 && <p className="muted small">Cadangan pesanan (bukan automatik): {data.suggestions.map((s) => `${s.name} ${s.s.qty}`).join(', ')}</p>}
      <h4>Kes pelupusan</h4>
      {data.can.count && <NewDisposal />}
      {data.disposals.map((d) => (
        <Disposal key={d.id} d={d} can={data.can} days={data.settings.disposalDays} />
      ))}
      {data.charges.length > 0 && (
        <>
          <h4>Caj kerosakan / kehilangan barang syarikat</h4>
          <p className="muted small">{data.settings.legalFlag}</p>
          {/* P107: the charges as a data table; HR's review and the price form stay open under each row that needs them. */}
          <DataTable
            label="Caj kerosakan / kehilangan barang syarikat"
            stateKey="purchasing.inv-charges"
            rows={data.charges}
            rowKey={(c) => c.id}
            columns={CHARGE_COLUMNS}
            filters={CHARGE_FILTERS}
            searchText={(c) => c.staffNo}
            phoneFacts={5}
            rowDetail={(c) => {
              const hr = data.can.hr && (c.status === 'due' || c.status === 'waiting_price');
              const price = c.status === 'waiting_price';
              if (!hr && !price) return null;
              return (
                <div data-no-row-click style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {hr && (
                    <OpForm
                      title="Semakan HR"
                      op="chargeHr"
                      send={send('chargeHr')}
                      fixed={{ id: c.id }}
                      fields={[{ k: 'decision', l: 'Keputusan', t: 'select', o: ['keep', 'reduce', 'spread', 'cancel'] }, { k: 'amount', l: 'Jumlah dikurangkan (RM)', t: 'number' }, { k: 'months', l: 'Bulan (ansuran)', t: 'number' }, { k: 'note', l: 'Sebab' }]}
                    />
                  )}
                  {price && <OpForm title="Masukkan harga" op="chargePrice" send={send('chargePrice')} fixed={{ id: c.id }} fields={[{ k: 'unitPrice', l: 'Harga seunit (RM)', t: 'number' }, { k: 'note', l: 'Sumber harga' }]} />}
                </div>
              );
            }}
          />
        </>
      )}
      {data.pastLife.length > 0 && (
        <>
          <h4>Melepasi jangka hayat</h4>
          <p className="muted small">Semak setiap satu untuk baiki, guna semula atau lupus.</p>
          {/* P107: a data table (search, sort, pages) in place of one line per item. */}
          <DataTable
            label="Melepasi jangka hayat"
            stateKey="purchasing.inv-past-life"
            rows={data.pastLife}
            rowKey={(p) => p.issueId}
            columns={PAST_LIFE_COLUMNS}
            filters={[{ id: 'item', label: 'Barang', value: (p) => p.item }]}
          />
        </>
      )}
      <h4>Laporan bulanan</h4>
      {data.can.decide && <OpForm title="Sediakan laporan bulan lepas" op="reportBuild" send={send('reportBuild')} fields={[{ k: 'month', l: 'Bulan (YYYY-MM, kosong = bulan lepas)' }]} />}
      {data.reports.map((r) => (
        <div key={r.id} className="item small">
          {r.month} <Chip tone={r.status === 'reviewed' ? 'ok' : 'info'}>{r.status}</Chip> {r.openItems.length ? `· ${r.openItems.length} perkara terbuka` : ''}{' '}
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => pdf('reportPdf', r.id), 'Laporan dimuat turun.')}>
            PDF
          </button>
          {data.can.decide && (r.status === 'draft' || r.status === 'returned') && <OpForm title="Hantar" op="reportSubmit" send={send('reportSubmit')} fixed={{ id: r.id }} fields={[{ k: 'comments', l: 'Ulasan', t: 'area' }, { k: 'actions', l: 'Tindakan', t: 'area' }]} />}
          {data.can.mgmt && r.status === 'submitted' && <OpForm title="Semak (OGM)" op="reportReview" send={send('reportReview')} fixed={{ id: r.id }} fields={[{ k: 'ok', l: 'Diterima', t: 'check' }, { k: 'note', l: 'Catatan' }]} />}
        </div>
      ))}
      <Match />
      <p className="muted small">Rekod inventori, kiraan dan pelupusan disimpan sekurang-kurangnya {data.settings.recordsYears} tahun.</p>
    </section>
    </StoreItems.Provider>
  );
}

function OpenCount({ c, canCount, canMgmt }: { c: NonNullable<Board['openCount']>; canCount: boolean; canMgmt: boolean }) {
  const itemField = useItemField();
  const act = useAction();
  const [v, setV] = useState<Record<string, { physical: string; reason: string; note: string }>>({});
  const [w, setW] = useState({ staffNo: '', pin: '' });
  return (
    <div className="panel" style={{ marginTop: 6 }}>
      <strong>Kiraan {c.kind === 'major' ? 'besar' : 'bulanan'} dibuka {c.at.slice(0, 16).replace('T', ' ')}</strong>{' '}
      <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => pdf('countPdf', c.id), 'Borang kiraan dimuat turun.')}>
        Borang kiraan (PDF)
      </button>
      <table className="table small">
        <thead>
          <tr>
            <th>Barang</th>
            <th>Sistem</th>
            <th>Fizikal</th>
            <th>Sebab varians</th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.itemId}>
              <td>
                {l.name}
                {l.size ? ` (${l.size})` : ''}
              </td>
              <td>{l.system - l.moved}</td>
              <td>
                {canCount ? (
                  <input className="input" style={{ width: 70 }} aria-label={`Fizikal ${l.name}`} value={v[l.itemId]?.physical ?? (l.physical === null ? '' : String(l.physical))} onChange={(e) => setV({ ...v, [l.itemId]: { physical: e.target.value, reason: v[l.itemId]?.reason ?? '', note: v[l.itemId]?.note ?? '' } })} />
                ) : (
                  (l.physical ?? '-')
                )}
              </td>
              <td>
                {canCount ? (
                  <Select className="select" aria-label={`Sebab ${l.name}`} value={v[l.itemId]?.reason ?? l.reason ?? ''} onChange={(e) => setV({ ...v, [l.itemId]: { physical: v[l.itemId]?.physical ?? '', reason: e.target.value, note: v[l.itemId]?.note ?? '' } })}>
                    <option value="">-</option>
                    {REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                ) : (
                  (l.reason ?? '')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canCount && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() =>
              act.run(
                () =>
                  api.inventoryAct('countLine', {
                    id: c.id,
                    lines: Object.entries(v)
                      .filter(([, x]) => x.physical !== '')
                      .map(([itemId, x]) => ({ itemId, physical: Number(x.physical), reason: x.reason || null, note: x.note })),
                  }),
                'Kiraan disimpan.',
              )
            }
          >
            Simpan kiraan
          </button>
          <input className="input" style={{ width: 110 }} placeholder="No. staf saksi" aria-label="No. staf saksi" value={w.staffNo} onChange={(e) => setW({ ...w, staffNo: e.target.value })} />
          <input className="input" style={{ width: 80 }} type="password" placeholder="PIN" aria-label="PIN saksi" value={w.pin} onChange={(e) => setW({ ...w, pin: e.target.value })} />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.inventoryAct('countFinish', { id: c.id, witness: w }), 'Kiraan selesai.')}>
            Selesai dengan saksi
          </button>
        </div>
      )}
      {canMgmt && c.frozen && (
        <OpForm title="Benarkan satu pergerakan segera (OGM)" op="urgent" send={send('urgent')} fields={[itemField('itemId', 'Barang'), { k: 'qty', l: 'Kuantiti', t: 'number' }, { k: 'reason', l: 'Kenapa tidak boleh tunggu' }]} />
      )}
    </div>
  );
}

function Variances({ c, canDecide, canMgmt, limit }: { c: Board['counts'][number]; canDecide: boolean; canMgmt: boolean; limit: number }) {
  return (
    <div className="panel" style={{ marginTop: 6 }}>
      <strong>Laporan varians: kiraan {c.at.slice(0, 10)}</strong> {c.witness ? <span className="muted small">saksi {c.witness.name}</span> : null}
      {c.lines.map((l) => (
        <div key={l.itemId} className="item small">
          {l.name}: {l.variance! > 0 ? '+' : ''}
          {l.variance} ({l.reason}) {l.decision ? <Chip tone={l.decision.kind === 'awaiting_ogm' ? 'warn' : 'ok'}>{l.decision.kind}</Chip> : null}
          {canDecide && (!l.decision || l.decision.kind === 'refused') && (
            <OpForm
              title="Putuskan"
              op="variance"
              send={send('variance')}
              fixed={{ countId: c.id, itemId: l.itemId }}
              fields={[{ k: 'action', l: 'Tindakan', t: 'select', o: ['explain', 'adjust'] }, { k: 'reason', l: 'Sebab, bukti dan tindakan pembetulan' }, { k: 'cause', l: 'Punca', t: 'select', o: CAUSES }, { k: 'personId', l: 'Orang bertanggungjawab (kecuaian / salah guna)' }, { k: 'photo', l: 'Gambar', t: 'photos' }]}
            />
          )}
          {canMgmt && l.decision?.kind === 'awaiting_ogm' && <OpForm title={`Lulus pelarasan melebihi RM${limit}`} op="varianceOgm" send={send('varianceOgm')} fixed={{ countId: c.id, itemId: l.itemId }} fields={[{ k: 'ok', l: 'Lulus', t: 'check' }, { k: 'note', l: 'Sebab' }]} />}
        </div>
      ))}
    </div>
  );
}

function NewDisposal() {
  const itemField = useItemField();
  return (
    <OpForm
      title="Mohon pelupusan (satu barang)"
      op="disposalRequest"
      send={(i) => api.inventoryAct('disposalRequest', { storeId: i.storeId, siteId: i.siteId || undefined, lines: [{ itemId: i.itemId || undefined, name: i.name, qty: Number(i.qty), reason: i.reason, condition: i.condition, location: i.location, photo: i.photo }] })}
      fields={[
        itemField('itemId', 'Barang stor (kosong untuk barang tapak)'),
        { k: 'name', l: 'Nama barang (barang tapak)' },
        { k: 'siteId', l: 'ID tapak (barang tapak)' },
        { k: 'qty', l: 'Kuantiti', t: 'number' },
        { k: 'reason', l: 'Sebab', t: 'select', o: ['damaged', 'worn_obsolete', 'unsafe', 'not_worth_repairing', 'not_needed', 'unsuitable', 'past_life', 'surplus', 'contract_ended', 'not_for_new_contract'] },
        { k: 'condition', l: 'Keadaan sekarang' },
        { k: 'location', l: 'Lokasi' },
        { k: 'photo', l: 'Gambar', t: 'photos' },
      ]}
    />
  );
}

function Disposal({ d, can, days }: { d: Board['disposals'][number]; can: Board['can']; days: number }) {
  const act = useAction();
  const line = d.lines[0];
  return (
    <div className="item small">
      <strong>{d.ref}</strong> {d.siteName ?? 'stor'} <Chip tone={d.status === 'selesai' ? 'ok' : d.late ? 'crit' : 'warn'}>{DISP_STATUS[d.status] ?? d.status}</Chip>
      {d.daysOpen !== null ? ` · ${d.daysOpen} daripada ${days} hari bekerja` : ''}
      {d.writeOff !== null ? ` · hapus kira RM${d.writeOff} (Kewangan putuskan)` : ''}
      <div className="muted">{d.lines.map((l) => `${l.n}. ${l.name} x${l.qty} (${l.reason}) ${l.outcome ?? ''} ${l.method ?? ''}`).join(' · ')}</div>
      <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => pdf('disposalPdf', d.id), 'Borang pelupusan dimuat turun.')}>
        Borang (PDF)
      </button>
      {can.decide && d.status === 'semakan' && (
        <OpForm
          title="Semak (baris 1)"
          op="disposalReview"
          send={(i) => api.inventoryAct('disposalReview', { id: d.id, note: i.note, personId: i.personId || undefined, photo: i.photo, lines: d.lines.map((l) => ({ n: l.n, outcome: l.n === line.n ? i.outcome : i.outcome, cause: i.cause || null })) })}
          fields={[{ k: 'outcome', l: 'Keputusan', t: 'select', o: ['reuse', 'repair', 'transfer', 'recycle', 'dispose', 'return_client'] }, { k: 'cause', l: 'Punca', t: 'select', o: CAUSES }, { k: 'personId', l: 'Orang bertanggungjawab (kecuaian / salah guna)' }, { k: 'photo', l: 'Gambar', t: 'photos' }, { k: 'note', l: 'Catatan semakan' }]}
        />
      )}
      {can.mgmt && d.status === 'kelulusan' && <OpForm title="Lulus (OGM)" op="disposalApprove" send={send('disposalApprove')} fixed={{ id: d.id }} fields={[{ k: 'ok', l: 'Lulus', t: 'check' }, { k: 'note', l: 'Sebab' }]} />}
      {can.decide && d.status === 'kaedah' && (
        <OpForm
          title="Pilih kaedah"
          op="disposalMethod"
          send={(i) => api.inventoryAct('disposalMethod', { id: d.id, lines: d.lines.map((l) => ({ n: l.n, method: i.method, destination: i.destination, price: i.price, buyer: i.buyer, contractor: i.contractor, quote: i.quote })) })}
          fields={[
            { k: 'method', l: 'Kaedah', t: 'select', o: ['normal_waste', 'recycle', 'third_party', 'sale', 'destroy', 'return_supplier', 'e_waste', 'scheduled_waste'] },
            { k: 'destination', l: 'Ke mana' },
            { k: 'price', l: 'Harga jualan (RM)', t: 'number' },
            { k: 'buyer', l: 'Pembeli' },
            { k: 'contractor', l: 'Kontraktor' },
            { k: 'quote', l: 'Sebut harga kontraktor (RM)', t: 'number' },
          ]}
        />
      )}
      {(can.count || can.decide) && d.status === 'pelaksanaan' && (
        <OpForm
          title="Laksana (baris 1)"
          op="disposalExecute"
          send={(i) => api.inventoryAct('disposalExecute', { id: d.id, n: line.n, photos: i.photos, marksRemoved: i.marksRemoved, wipeRef: i.wipeRef, witness: i.witnessNo ? { staffNo: i.witnessNo, pin: i.witnessPin } : undefined })}
          fields={[{ k: 'photos', l: 'Gambar sebelum dan selepas', t: 'photos' }, { k: 'marksRemoved', l: 'Tanda syarikat / klien / kontrak dibuang', t: 'check' }, { k: 'wipeRef', l: 'Rujukan padam data / frekuensi radio' }, { k: 'witnessNo', l: 'No. staf saksi' }, { k: 'witnessPin', l: 'PIN saksi' }]}
        />
      )}
      {(d.status === 'pelaksanaan' || d.status === 'bukti') && (
        <OpForm title="Tambah bukti" op="disposalEvidence" send={(i) => api.inventoryAct('disposalEvidence', { id: d.id, n: line.n, kind: i.kind, ref: i.ref, file: i.file })} fields={[{ k: 'kind', l: 'Jenis', t: 'select', o: ['receipt', 'certificate', 'doe_note', 'contractor_note', 'other'] }, { k: 'ref', l: 'Nombor dokumen' }, { k: 'file', l: 'Dokumen', t: 'proof' }]} />
      )}
      {can.decide && d.status === 'bukti' && (
        <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.inventoryAct('disposalClose', { id: d.id }), 'Kes ditutup (SELESAI).')}>
          Tutup kes
        </button>
      )}
    </div>
  );
}

type MatchRow = { ref: string; line: string; problem: string; k: number };
/** The kind of mismatch, from the server's wording (inventory-control.ts match). */
const matchKind = (p: string) =>
  p.startsWith('invoice without') ? 'invoice' : p.startsWith('received but not linked') ? 'unlinked' : p.startsWith('received ') ? 'qty' : p.startsWith('not in the store') ? 'late' : 'other';
const MATCH_COLUMNS: DtColumn<MatchRow>[] = [
  { id: 'ref', label: 'Rujukan', value: (r) => r.ref, render: (r) => <strong>{r.ref}</strong>, phone: 'title' },
  { id: 'line', label: 'Barang', value: (r) => r.line, phone: 'sub' },
  { id: 'problem', label: 'Masalah', value: (r) => r.problem },
];
const MATCH_FILTERS: DtFilter<MatchRow>[] = [
  {
    id: 'kind',
    label: 'Masalah',
    value: (r) => matchKind(r.problem),
    options: [
      { value: 'invoice', label: 'Invois tanpa terimaan barang' },
      { value: 'unlinked', label: 'Tidak dipautkan ke barang stor' },
      { value: 'qty', label: 'Kuantiti diterima berbeza' },
      { value: 'late', label: 'Belum masuk stor atau daftar' },
    ],
  },
];

function Match() {
  const { data } = useLoad(() => api.inventoryAct('match', {}).catch(() => null) as Promise<{ rows: { ref: string; line: string; problem: string }[]; dataAsAt: string } | null>, []);
  if (!data || !data.rows.length) return null;
  return (
    <>
      <h4>Padanan pembelian ke stor</h4>
      <span className="muted small">Data setakat {data.dataAsAt.slice(0, 16).replace('T', ' ')}</span>
      {/* P107: every row the server sends, paged by the table (the screen showed only the first 50). */}
      <DataTable
        label="Padanan pembelian ke stor"
        stateKey="purchasing.inv-match"
        rows={data.rows.map((r, k) => ({ ...r, k }))}
        rowKey={(r) => String(r.k)}
        columns={MATCH_COLUMNS}
        filters={MATCH_FILTERS}
      />
    </>
  );
}
