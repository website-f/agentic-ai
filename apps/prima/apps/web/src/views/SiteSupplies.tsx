import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api } from '../api';
import { Chip, Loading, dateLabel, useAction, useLoad } from '../ui';
import { OpForm } from './ItPolicyPanel';
import { ProofPicker } from './Proof';
import { saveFile } from '../save';
import { useApp } from '../App';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

/**
 * P105: the OM picks the site by name from the sites they cover (every company they see), instead of typing a site
 * record id that no screen shows. The list is read once when the form opens.
 */
export function SitePick({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { me } = useApp();
  const { data } = useLoad(
    () =>
      Promise.all(
        (me?.companies ?? []).map((c) =>
          api
            .sites(c.id)
            .then((rows) => rows.map((r) => ({ id: r.site.id, name: r.site.name, company: c.name })))
            .catch(() => [] as { id: string; name: string; company: string }[]),
        ),
      ).then((x) => x.flat()),
    [],
  );
  if (!data) return <Loading what="your sites" />;
  if (!data.length) return <input className="input" placeholder="ID tapak" aria-label="ID tapak" value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <Select className="select" aria-label="Tapak" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pilih tapak</option>
      {data.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} · {s.company}
        </option>
      ))}
    </Select>
  );
}

/**
 * Permohonan Pesanan Barang (Part T, Fitri package; Fauzan's answers 13 Nov 2026): one site supplies request for
 * cleaning (KBK), Nepali guard (PKK Nepal) and local guard (PKK) sites. The OM enters it for the supervisor or
 * patrolling officer; the app builds the summary. Then the first check (Nepal), the OGM's confirmation, the store's
 * stock check, Procurement's issue-or-buy, and the issue (a site delivery or the guard handover; bulk to the site is
 * counted first). Every rule is checked again on the server; this screen only offers the steps.
 */

type Line = {
  n: number;
  itemName: string;
  size: string | null;
  qty: number;
  confirmedQty: number | null;
  personName: string | null;
  staffNo: string | null;
  area: string | null;
  purpose: string;
  storeCan: number | null;
  decision: 'issue' | 'buy' | null;
  purRequestId: string | null;
  issued: { via: string; refId: string; at: string } | null;
  released?: { by: string; reason: string } | null;
  allowance: { pieces: number; early: boolean; paid: { receiptNo: string; amount: number } | null } | null;
  changes: { from: number; to: number; reason: string; by: string }[];
};
type Row = {
  id: string;
  ref: string;
  contract: string;
  siteName: string;
  status: string;
  statusLabel: string;
  requestedBy: string;
  requestedById: string;
  requestedAt: string;
  startedBy: { role: string; name: string };
  alsoSentBy: { channel: string | null; ref: string };
  lines: Line[];
  summary: { item: string; size: string | null; qty: number; guards: number }[];
  steps: { step: string; by: string; at: string; note: string }[];
  storeStages?: { stage: string; by: string; at: string }[];
  deliveryMethod?: string | null;
  times?: { order: number | null; receiving: number | null; preparation: number | null; delivery: number | null; readyTargetDays: number | null; readyWorkingDays: number | null; readyLate: boolean; buyingNotice: string | null };
  myTurn: boolean;
  waitDays: number;
};
type Bulk = { id: string; ref: string; siteName: string; omUserId: string; sentAt: string; counted: { at: string } | null; lines: { n: number; itemName: string; qty: number; personName: string | null; arrived: number | null; damaged: number | null; handedOut: string | null }[] };
type Board = {
  rows: Row[];
  byStep: Record<string, number>;
  bulks: Bulk[];
  overdue: string[];
  minmax: { id: string; siteName: string; supplyName: string; min: number | null; max: number | null; reason: string; by: string }[];
  storeFlags: { id: string; name: string; onHand: number; min: number; max: number | null; flag: string }[];
  settings: { handOutDays: number; primaOnlyFrom: string | null; contracts: Record<string, { label: string; firstCheck: boolean; bulkCount: boolean; responsible: boolean }> };
  labels: Record<string, string>;
  canSet: boolean;
  canStart?: boolean;
  watcher: boolean;
  channels: string[];
};
type Options = {
  site: { id: string; name: string };
  asOffice?: boolean;
  receivers?: { id: string; name: string }[];
  contract: string;
  contractSet: boolean;
  setting: { label: string; startedBy: string; firstCheck: boolean };
  items: { id: string; name: string; kind: string; size: string | null; onHand: number; onTheWay: number; min: number; max: number | null; kit?: { name: string; qty: number }[] | null; partOf?: string[] }[];
  supplies: { id: string; name: string; unit: string; onHand: number | null; daysLeft: number | null; min: number | null; max: number | null }[];
  equipment: { id: string; name: string; required: number; working: number | null }[];
};

const send = (op: string) => (i: Record<string, unknown>) => api.siteSuppliesAct(op, i);
const CONTRACT: Record<string, string> = { KBK: 'KBK', PKK_NEPAL: 'PKK Nepal', PKK: 'PKK Tempatan' };
const STAGE: Record<string, string> = { prepared: 'Stok disediakan', pic: 'Disemak oleh PIC', ready: 'Sedia untuk dihantar' };

/** P107: the requests' columns and filters (Malay, like the rest of this panel). */
const statusTone = (r: Row) => (r.status === 'ditolak' ? 'crit' : r.status === 'siap' ? 'ok' : 'warn');
const ROW_COLUMNS: DtColumn<Row>[] = [
  { id: 'ref', label: 'Rujukan', value: (r) => r.ref, render: (r) => <strong>{r.ref}</strong>, phone: 'title' },
  { id: 'site', label: 'Tapak', value: (r) => r.siteName, phone: 'sub' },
  {
    id: 'status',
    label: 'Status',
    value: (r) => r.statusLabel,
    render: (r) => (
      <>
        <Chip tone={statusTone(r)}>{r.statusLabel}</Chip> {r.myTurn && <Chip tone="info">Giliran anda</Chip>}
      </>
    ),
  },
  { id: 'contract', label: 'Kontrak', value: (r) => CONTRACT[r.contract] ?? r.contract, hideBelow: 1100 },
  { id: 'startedBy', label: 'Dimulakan oleh', value: (r) => r.startedBy.name, hideBelow: 1300 },
  {
    id: 'requested',
    label: 'Dimasukkan',
    value: (r) => r.requestedAt.slice(0, 10),
    sort: 'date',
    render: (r) => (
      <>
        {dateLabel(r.requestedAt.slice(0, 10))}
        <div className="muted small">oleh {r.requestedBy}</div>
        {r.alsoSentBy.channel ? <div className="muted small">{`juga dihantar melalui ${r.alsoSentBy.channel} ${r.alsoSentBy.ref}`}</div> : null}
      </>
    ),
  },
  { id: 'wait', label: 'Menunggu', value: (r) => r.waitDays, sort: 'number', render: (r) => `${r.waitDays} hari` },
];
const ROW_FILTERS: DtFilter<Row>[] = [
  { id: 'status', label: 'Status', value: (r) => r.statusLabel },
  { id: 'contract', label: 'Kontrak', value: (r) => r.contract, optionLabel: (v) => CONTRACT[v] ?? v },
  {
    id: 'turn',
    label: 'Giliran',
    value: (r) => (r.myTurn ? 'mine' : 'other'),
    options: [
      { value: 'mine', label: 'Giliran anda' },
      { value: 'other', label: 'Bukan giliran anda' },
    ],
  },
];

export function SiteSuppliesPanel({ canAsk, hideIfNothing }: { canAsk?: boolean; hideIfNothing?: boolean }) {
  const { data, error } = useLoad(() => api.siteSuppliesAct('board', {}) as Promise<Board>, []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return null;
  if (!data) return <Loading what="supplies requests" />;
  // Someone who only monitors the store sees the panel when they may start a request or have one to act on.
  if (hideIfNothing && !canAsk && !data.canStart && !data.canSet && data.rows.length === 0) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Permohonan Pesanan Barang (bekalan tapak)</h3>
        <span className="muted small">
          {Object.entries(data.byStep)
            .map(([k, v]) => `${data.labels[k]} ${v}`)
            .join(' · ') || 'Tiada permohonan terbuka'}
        </span>
      </div>
      <p className="muted small">
        Langkah: OM minta (untuk penyelia atau peronda) · semakan awal (Nepal) · OGM sahkan · stor semak stok · Perolehan putuskan keluar atau beli · stor keluarkan · tapak terima dan kira. Uniform tambahan dibayar dengan resit, bukan dari gaji. Kerosakan atau kehilangan kerana kecuaian atau salah guna (diputuskan pengurus) dicaj pada gaji berikutnya dan disemak HR.
      </p>
      {data.channels.length > 1 && <p className="muted small">Tempoh peralihan: borang kertas, e-mel dan SharePoint masih dihantar juga. Prima sahaja bermula {data.settings.primaOnlyFrom ?? '(tarikh belum ditetapkan)'}.</p>}
      {(canAsk || data.canStart) && <NewRequest />}
      {data.canSet && (
        <OpForm
          title="Tetapan jenis kontrak"
          op="settings"
          send={send('settings')}
          fields={[
            { k: 'contract', l: 'Jenis kontrak', t: 'select', o: ['KBK', 'PKK_NEPAL', 'PKK'] },
            { k: 'reason', l: 'Sebab' },
            { k: 'handOutDays', l: 'Hari untuk menyerahkan barang pukal', t: 'number' },
            { k: 'primaOnlyFrom', l: 'Prima sahaja mulai (YYYY-MM-DD)', t: 'date' },
            { k: 'deputyUserId', l: 'Timbalan pengesah (ID pengguna)' },
          ]}
        />
      )}
      {/* P107: the requests as a data table (search, filters, sort, pages; a card per request on a phone). Clicking a
          request opens its lines and steps under it, as the reference link did. This panel is written in Malay. */}
      <DataTable
        label="Permohonan Pesanan Barang"
        stateKey="purchasing.site-supplies"
        rows={data.rows}
        rowKey={(r) => r.id}
        columns={ROW_COLUMNS}
        filters={ROW_FILTERS}
        searchPlaceholder="Cari rujukan, tapak atau nama"
        searchText={(r) => `${r.alsoSentBy.channel ?? ''} ${r.alsoSentBy.ref}`}
        onRowClick={(r) => setOpen(open === r.id ? null : r.id)}
        phoneFacts={5}
        rowDetail={(r) =>
          open === r.id ? (
            <div data-no-row-click>
              <Detail r={r} />
            </div>
          ) : null
        }
        empty={<p className="muted small">Tiada permohonan.</p>}
      />
      {data.bulks.length > 0 && (
        <>
          <h4>Penghantaran pukal ke tapak (kira dahulu, kemudian serah)</h4>
          {data.bulks.map((b) => (
            <BulkLine key={b.id} b={b} overdue={data.overdue.includes(b.id)} />
          ))}
        </>
      )}
      {data.minmax.length > 0 && (
        <>
          <h4>Min/Max tapak menunggu kelulusan OGM</h4>
          {data.minmax.map((m) => (
            <div key={m.id} className="item small">
              {m.siteName}: {m.supplyName} Min {m.min ?? 'belum ditetapkan'}, Max {m.max ?? 'belum ditetapkan'} ({m.reason}, {m.by}){' '}
              <OpForm title="Putuskan" op="decideMinMax" send={send('decideMinMax')} fixed={{ id: m.id }} fields={[{ k: 'ok', l: 'Lulus', t: 'check' }, { k: 'note', l: 'Catatan' }]} />
            </div>
          ))}
        </>
      )}
      {data.storeFlags.length > 0 && (
        <>
          <h4>Stor: di bawah Min atau melebihi Max</h4>
          {data.storeFlags.map((f) => (
            <div key={f.id} className="item small">
              {f.name}: {f.onHand} ada · Min {f.min} · Max {f.max ?? 'belum ditetapkan'} <Chip tone="warn">{f.flag === 'below_min' ? 'Bawah Min' : 'Lebih Max'}</Chip>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function Detail({ r }: { r: Row }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [dec, setDec] = useState<Record<number, { decision: string; unitPrice: string }>>({});
  const [method, setMethod] = useState('');
  const run = (op: string, i: Record<string, unknown>, done: string) => act.run(() => api.siteSuppliesAct(op, { id: r.id, note, ...i }), done);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <table className="table small">
        <thead>
          <tr>
            <th>#</th>
            <th>Barang</th>
            <th>Pengawal</th>
            <th>Minta</th>
            <th>Lulus</th>
            <th>Stor boleh beri</th>
            <th>Keputusan</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.n}>
              <td>{l.n}</td>
              <td>
                {l.itemName}
                {l.size ? ` (${l.size})` : ''}
                {l.area ? ` · ${l.area}` : ''}
                {l.purpose ? <div className="muted">{l.purpose}</div> : null}
              </td>
              <td>
                {l.personName ? `${l.personName} (${l.staffNo})` : '-'}
                {l.allowance?.paid ? <div className="muted">Dibayar sendiri, resit {l.allowance.paid.receiptNo}</div> : null}
                {l.allowance?.early ? <div className="muted">Dalam 6 bulan dari helai terakhir</div> : null}
              </td>
              <td>{l.qty}</td>
              <td>
                {r.status === 'kelulusan' && r.myTurn ? <input className="input" style={{ width: 60 }} aria-label={`Lulus baris ${l.n}`} value={qty[l.n] ?? String(l.qty)} onChange={(e) => setQty({ ...qty, [l.n]: e.target.value })} /> : (l.confirmedQty ?? '-')}
                {l.changes.map((c, k) => (
                  <div key={k} className="muted">
                    {c.from} → {c.to}: {c.reason}
                  </div>
                ))}
              </td>
              <td>{l.storeCan ?? '-'}</td>
              <td>
                {r.status === 'diluluskan' && r.myTurn && l.storeCan !== null ? (
                  <>
                    <Select className="select" aria-label={`Keputusan baris ${l.n}`} value={dec[l.n]?.decision ?? ''} onChange={(e) => setDec({ ...dec, [l.n]: { decision: e.target.value, unitPrice: dec[l.n]?.unitPrice ?? '' } })}>
                      <option value="">-</option>
                      <option value="issue">Keluarkan dari stor</option>
                      <option value="buy">Beli</option>
                    </Select>
                    {dec[l.n]?.decision === 'buy' && (
                      <input className="input" style={{ width: 70 }} placeholder="RM seunit" aria-label={`Harga anggaran baris ${l.n}`} value={dec[l.n]?.unitPrice ?? ''} onChange={(e) => setDec({ ...dec, [l.n]: { decision: 'buy', unitPrice: e.target.value } })} />
                    )}
                  </>
                ) : l.decision === 'buy' ? (
                  'Beli'
                ) : l.decision === 'issue' ? (
                  'Dari stor'
                ) : (
                  '-'
                )}
              </td>
              <td>{l.issued ? `Dikeluarkan (${l.issued.via === 'delivery' ? 'penghantaran tapak' : l.issued.via === 'bulk' ? 'pukal' : 'serahan'})` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted small">
        Ringkasan: {r.summary.map((x) => `${x.item}${x.size ? ` (${x.size})` : ''} ${x.qty}${x.guards ? `, ${x.guards} pengawal` : ''}`).join('; ')}
      </div>
      {r.times && (
        <div className="muted small">
          Masa (jam): pesanan {r.times.order ?? '-'} · penerimaan {r.times.receiving ?? '-'} · penyediaan {r.times.preparation ?? '-'} · penghantaran {r.times.delivery ?? '-'}
          {r.times.readyTargetDays !== null ? ` · ${r.times.readyWorkingDays ?? 0} daripada ${r.times.readyTargetDays} hari bekerja untuk siap dihantar` : ''}
          {r.times.readyLate ? ' · LEWAT' : ''}
          {r.times.buyingNotice ? ` · ${r.times.buyingNotice}` : ''}
        </div>
      )}
      {(r.storeStages ?? []).length > 0 && <div className="muted small">Stor: {(r.storeStages ?? []).map((s) => `${STAGE[s.stage] ?? s.stage} (${s.by})`).join(' · ')}</div>}
      <div className="muted small">
        {r.steps.map((s, k) => (
          <div key={k}>
            {dateLabel(s.at.slice(0, 10))} {s.step} oleh {s.by}
            {s.note ? `: ${s.note}` : ''}
          </div>
        ))}
      </div>
      {r.myTurn && (
        <>
          <input className="input" placeholder="Catatan / sebab" aria-label="Catatan" value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {r.status === 'baharu' && <button className="btn btn-sm" disabled={act.busy} onClick={() => run('submit', {}, 'Dihantar.')}>Hantar</button>}
            {r.status === 'semakan_awal' && (
              <>
                <button className="btn btn-sm" disabled={act.busy} onClick={() => run('firstCheck', { ok: true }, 'Semakan awal selesai.')}>Lengkap dan sepadan dengan jadual</button>
                <button className="btn btn-sm" disabled={act.busy} onClick={() => run('firstCheck', { ok: false }, 'Dikembalikan.')}>Kembalikan</button>
              </>
            )}
            {r.status === 'kelulusan' && (
              <>
                <button
                  className="btn btn-sm"
                  disabled={act.busy}
                  onClick={() =>
                    run(
                      'confirm',
                      { approve: true, changes: r.lines.filter((l) => qty[l.n] !== undefined && Number(qty[l.n]) !== l.qty).map((l) => ({ n: l.n, qty: Number(qty[l.n]), reason: note })) },
                      'Pesanan disahkan.',
                    )
                  }
                >
                  Sahkan pesanan
                </button>
                <button className="btn btn-sm" disabled={act.busy} onClick={() => run('confirm', { approve: false }, 'Ditolak.')}>Tolak</button>
              </>
            )}
            {r.status === 'diluluskan' && r.lines.some((l) => l.storeCan === null) && <button className="btn btn-sm" disabled={act.busy} onClick={() => run('stockCheck', {}, 'Semakan stok direkod.')}>Rekod semakan stok</button>}
            {r.status === 'diluluskan' && !r.lines.some((l) => l.storeCan === null) && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => run('decide', { lines: Object.entries(dec).map(([n, x]) => ({ n: Number(n), decision: x.decision, unitPrice: Number(x.unitPrice) })) }, 'Keputusan direkod.')}>
                Rekod keputusan
              </button>
            )}
            {r.status === 'tindakan' &&
              (['prepared', 'pic', 'ready'] as const)
                .filter((k) => !(r.storeStages ?? []).some((s) => s.stage === k))
                .slice(0, 1)
                .map((k) => (
                  <button key={k} className="btn btn-sm" disabled={act.busy} onClick={() => run('stage', { stage: k }, `${STAGE[k]} direkod.`)}>
                    {STAGE[k]}
                  </button>
                ))}
            {r.status === 'tindakan' && (
              <Select className="select" aria-label="Kaedah penghantaran" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Kaedah penghantaran</option>
                <option value="own_vehicle">Kenderaan sendiri</option>
                <option value="courier">Kurier</option>
                <option value="supplier">Pembekal hantar</option>
                <option value="collected">Diambil</option>
              </Select>
            )}
            {r.status === 'tindakan' && <button className="btn btn-sm" disabled={act.busy} onClick={() => run('issue', method ? { method } : {}, 'Dikeluarkan.')}>Keluarkan baris yang sedia</button>}
          </div>
        </>
      )}
      {r.status === 'tindakan' && <button className="btn btn-sm" disabled={act.busy} onClick={() => run('close', {}, 'Siap.')}>Tutup (Siap)</button>}
      {r.lines.some((l) => l.issued && l.issued.via !== 'issue') && (
        <button
          className="btn btn-sm"
          disabled={act.busy}
          onClick={() =>
            act.run(async () => {
              const p = (await api.siteSuppliesAct('doPdf', { id: r.id })) as { name: string; base64: string };
              await saveFile(p.name, `data:application/pdf;base64,${p.base64}`);
              return p;
            }, 'DO dimuat turun (salinan stor dan salinan tapak).')
          }
        >
          Cetak DO (2 salinan)
        </button>
      )}
      {r.status === 'tindakan' &&
        r.lines
          .filter((l) => l.decision === 'issue' && !l.issued && !l.released)
          .map((l) => <OpForm key={l.n} title={`Lepaskan simpanan baris ${l.n} (OGM)`} op="release" send={send('release')} fixed={{ id: r.id, n: l.n }} fields={[{ k: 'reason', l: 'Sebab' }]} />)}
    </div>
  );
}

function BulkLine({ b, overdue }: { b: Bulk; overdue: boolean }) {
  const act = useAction();
  const [counts, setCounts] = useState<Record<number, { arrived: string; damaged: string }>>({});
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [note, setNote] = useState('');
  const [po, setPo] = useState('');
  const [signed, setSigned] = useState(false);
  return (
    <div className="item small">
      <strong>{b.ref}</strong> {b.siteName} · dihantar {dateLabel(b.sentAt.slice(0, 10))} {b.counted ? <Chip tone="ok">Dikira</Chip> : <Chip tone="warn">Belum dikira</Chip>} {overdue && <Chip tone="crit">Belum diserahkan</Chip>}
      {b.lines.map((l) => (
        <div key={l.n}>
          {l.itemName} x{l.qty}
          {l.personName ? ` untuk ${l.personName}` : ''}
          {b.counted ? ` · tiba ${l.arrived}, rosak ${l.damaged}` : ''}
          {!b.counted && (
            <>
              {' '}
              <input className="input" style={{ width: 60 }} placeholder="Tiba" aria-label={`Tiba ${l.itemName}`} value={counts[l.n]?.arrived ?? ''} onChange={(e) => setCounts({ ...counts, [l.n]: { arrived: e.target.value, damaged: counts[l.n]?.damaged ?? '0' } })} />
              <input className="input" style={{ width: 60 }} placeholder="Rosak" aria-label={`Rosak ${l.itemName}`} value={counts[l.n]?.damaged ?? ''} onChange={(e) => setCounts({ ...counts, [l.n]: { arrived: counts[l.n]?.arrived ?? '', damaged: e.target.value } })} />
            </>
          )}
          {b.counted && l.personName && !l.handedOut && (
            <>
              {' '}
              <input className="input" style={{ width: 140 }} placeholder="ID peronda (pilihan)" aria-label="Peronda" value={po} onChange={(e) => setPo(e.target.value)} />
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.siteSuppliesAct('handOut', { id: b.id, n: l.n, ...(po ? { patrolPersonId: po } : {}) }), 'Diserahkan. Pengawal menandatangani di telefon anda (Barang saya).')}>
                Serah kepada pengawal
              </button>
            </>
          )}
          {l.handedOut ? ' · diserahkan' : ''}
        </div>
      ))}
      {!b.counted && (
        <>
          <ProofPicker site={null} refText="Gambar barang yang tiba" items={proof} onChange={setProof} documentsOnly />
          <input className="input" placeholder="Catatan (wajib jika kurang atau rosak)" aria-label="Catatan kiraan" value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="small">
            <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} /> Salinan tapak DO ditandatangani (gambar dilampirkan)
          </label>
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.siteSuppliesAct('bulkCount', { id: b.id, proof, note, doSigned: signed, lines: b.lines.map((l) => ({ n: l.n, arrived: Number(counts[l.n]?.arrived ?? 0), damaged: Number(counts[l.n]?.damaged ?? 0) })) }), 'Kiraan direkod.')}
          >
            Rekod kiraan di tapak
          </button>
        </>
      )}
    </div>
  );
}

type Draft = { stockItemId: string; qty: string; staffNo: string; supplyId: string; equipmentId: string; purpose: string; area: string; size: string; receiptNo: string; amount: string; maxReason: string };
const empty = (): Draft => ({ stockItemId: '', qty: '1', staffNo: '', supplyId: '', equipmentId: '', purpose: '', area: '', size: '', receiptNo: '', amount: '', maxReason: '' });

function NewRequest() {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [opt, setOpt] = useState<Options | null>(null);
  const [lines, setLines] = useState<Draft[]>([empty()]);
  const [startedByName, setStarted] = useState('');
  const [alsoSentBy, setAlso] = useState('');
  const [alsoSentRef, setAlsoRef] = useState('');
  const [paper, setPaper] = useState<ProofInput[]>([]);
  const [notes, setNotes] = useState('');
  const [receiverUserId, setReceiver] = useState('');
  const [forNewSite, setNewSite] = useState(false);
  if (!open)
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Minta bekalan untuk tapak
      </button>
    );
  const set = (k: number, p: Partial<Draft>) => setLines(lines.map((l, i) => (i === k ? { ...l, ...p } : l)));
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <strong>Permohonan Pesanan Barang</strong>
      <div style={{ display: 'flex', gap: 6 }}>
        <SupplySitePick value={siteId} onChange={setSiteId} />
        <button className="btn btn-sm" disabled={act.busy || !siteId} onClick={() => act.run(async () => setOpt((await api.siteSuppliesAct('options', { siteId })) as Options), 'Senarai dimuatkan.')}>
          Muat tapak
        </button>
      </div>
      {opt && (
        <>
          <div className="small">
            {opt.site.name}: <Chip tone="info">{opt.setting.label}</Chip> {!opt.contractSet && <span className="muted">(jenis kontrak belum ditetapkan; tetapkan di bawah jika salah)</span>}
          </div>
          <OpForm title="Tetapkan jenis kontrak tapak" op="siteType" send={send('siteType')} fixed={{ siteId: opt.site.id }} fields={[{ k: 'contract', l: 'Jenis', t: 'select', o: ['KBK', 'PKK_NEPAL', 'PKK'] }, { k: 'reason', l: 'Sebab' }]} />
          {opt.asOffice && (
            <>
              <label className="small">
                OM yang menerima di tapak{' '}
                <Select className="select" aria-label="OM yang menerima" value={receiverUserId} onChange={(e) => setReceiver(e.target.value)}>
                  <option value="">Pilih OM</option>
                  {(opt.receivers ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </label>
              {!(opt.receivers ?? []).length && <span className="muted small">Tiada OM untuk tapak ini lagi. Tetapkan OM tapak dahulu.</span>}
            </>
          )}
          <label className="small">
            <input type="checkbox" checked={forNewSite} onChange={(e) => setNewSite(e.target.checked)} /> Barang untuk tapak baharu (mula operasi)
          </label>
          {!opt.asOffice && opt.setting.startedBy !== 'om' && <input className="input" placeholder={opt.setting.startedBy === 'supervisor' ? 'Nama penyelia yang meminta' : 'Nama peronda yang meminta'} aria-label="Dimulakan oleh" value={startedByName} onChange={(e) => setStarted(e.target.value)} />}
          {lines.map((l, k) => {
            const item = opt.items.find((x) => x.id === l.stockItemId);
            return (
              <div key={k} className="item small" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Select className="select" aria-label={`Barang ${k + 1}`} value={l.stockItemId} onChange={(e) => set(k, { stockItemId: e.target.value })}>
                  <option value="">Barang</option>
                  {opt.items.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.size ? ` (${x.size})` : ''}
                      {x.kit ? ` · SET: ${x.kit.map((p) => `${p.qty} ${p.name}`).join(', ')}` : ` · stor ${x.onHand} · dalam perjalanan ${x.onTheWay}`}
                      {x.partOf?.length ? ` · bahagian ${x.partOf.join(', ')}` : ''}
                    </option>
                  ))}
                </Select>
                <input className="input" style={{ width: 60 }} title={item?.kit ? 'Bilangan set' : undefined} aria-label={`Kuantiti ${k + 1}`} value={l.qty} onChange={(e) => set(k, { qty: e.target.value })} />
                <input className="input" style={{ width: 110 }} placeholder="No. staf (pengawal)" aria-label={`No staf ${k + 1}`} value={l.staffNo} onChange={(e) => set(k, { staffNo: e.target.value })} />
                {opt.contract === 'KBK' && (
                  <Select className="select" aria-label={`Bekalan tapak ${k + 1}`} value={l.supplyId || (l.equipmentId ? `eq:${l.equipmentId}` : '')} onChange={(e) => (e.target.value.startsWith('eq:') ? set(k, { equipmentId: e.target.value.slice(3), supplyId: '' }) : set(k, { supplyId: e.target.value, equipmentId: '' }))}>
                    <option value="">Bekalan / peralatan tapak</option>
                    {opt.supplies.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} · ada {x.onHand ?? '?'} · {x.daysLeft ?? '?'} hari · Min {x.min ?? 'belum ditetapkan'} · Max {x.max ?? 'belum ditetapkan'}
                      </option>
                    ))}
                    {opt.equipment.map((x) => (
                      <option key={x.id} value={`eq:${x.id}`}>
                        {x.name} · perlu {x.required} · berfungsi {x.working ?? '?'}
                      </option>
                    ))}
                  </Select>
                )}
                <input className="input" placeholder="Tujuan" aria-label={`Tujuan ${k + 1}`} value={l.purpose} onChange={(e) => set(k, { purpose: e.target.value })} />
                <input className="input" style={{ width: 100 }} placeholder="Kawasan" aria-label={`Kawasan ${k + 1}`} value={l.area} onChange={(e) => set(k, { area: e.target.value })} />
                {item?.kind === 'UNIFORM' && l.staffNo && (
                  <>
                    <input className="input" style={{ width: 100 }} placeholder="Resit (helai ke-4 ke atas)" aria-label={`Resit ${k + 1}`} value={l.receiptNo} onChange={(e) => set(k, { receiptNo: e.target.value })} />
                    <input className="input" style={{ width: 70 }} placeholder="RM" aria-label={`Amaun ${k + 1}`} value={l.amount} onChange={(e) => set(k, { amount: e.target.value })} />
                  </>
                )}
                <input className="input" style={{ width: 120 }} placeholder="Sebab melebihi Max" aria-label={`Sebab Max ${k + 1}`} value={l.maxReason} onChange={(e) => set(k, { maxReason: e.target.value })} />
              </div>
            );
          })}
          <button className="btn btn-sm" onClick={() => setLines([...lines, empty()])}>
            Tambah baris
          </button>
          <textarea className="input" placeholder="Catatan" aria-label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="small">
            Juga dihantar melalui{' '}
            <Select className="select" aria-label="Juga dihantar melalui" value={alsoSentBy} onChange={(e) => setAlso(e.target.value)}>
              <option value="">Prima sahaja</option>
              <option value="paper">Borang kertas</option>
              <option value="email">E-mel</option>
              <option value="sharepoint">SharePoint</option>
            </Select>
          </label>
          {alsoSentBy && <input className="input" placeholder="No. item SharePoint / rujukan" aria-label="Rujukan saluran" value={alsoSentRef} onChange={(e) => setAlsoRef(e.target.value)} />}
          {alsoSentBy === 'paper' && <ProofPicker site={null} refText="Gambar borang kertas" items={paper} onChange={setPaper} documentsOnly />}
          <button
            className="btn"
            disabled={act.busy}
            onClick={() =>
              act
                .run(
                  () =>
                    api.siteSuppliesAct('request', {
                      siteId: opt.site.id,
                      startedByName,
                      receiverUserId: receiverUserId || null,
                      forNewSite,
                      notes,
                      alsoSentBy: alsoSentBy || null,
                      alsoSentRef,
                      paperPhoto: paper,
                      lines: lines
                        .filter((l) => l.stockItemId)
                        .map((l) => ({
                          stockItemId: l.stockItemId,
                          qty: Number(l.qty),
                          staffNo: l.staffNo,
                          supplyId: l.supplyId || null,
                          equipmentId: l.equipmentId || null,
                          purpose: l.purpose,
                          area: l.area,
                          maxReason: l.maxReason,
                          ...(l.receiptNo ? { paid: { receiptNo: l.receiptNo, amount: Number(l.amount) } } : {}),
                        })),
                    }),
                  'Permohonan dihantar. Anda boleh melihat setiap langkah di sini.',
                )
                .then((x) => x && (setOpen(false), setLines([empty()]), setOpt(null)))
            }
          >
            Hantar permohonan
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The sites the person may ask supplies for, by name (23 Nov 2026); falls back to typing the site ID. The office's
 * SitePick above stays for the equipment screens; the supplies form uses the server's own scoped list.
 */
function SupplySitePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useLoad(() => api.siteSuppliesAct('sites', {}).catch(() => []) as Promise<{ id: string; name: string; sector: string | null }[]>, []);
  if (!data || !data.length) return <input className="input" placeholder="ID tapak" aria-label="ID tapak" value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <Select className="select" aria-label="Tapak" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pilih tapak</option>
      {data.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
          {x.sector === 'government' ? ' · kerajaan (stor Goodwill)' : x.sector === 'private' ? ' · swasta' : ''}
        </option>
      ))}
    </Select>
  );
}
