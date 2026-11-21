import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { useRouteTab } from '../App';
import { Chip, ErrorNotice, Kpi, useAction, useLoad } from '../ui';

/**
 * Part P (Fitri package, FWM papers S1-S7 / T1-T3, Fauzan 13-14 Nov 2026): moves of foreign workers between hostels and
 * work sites (form BPPS), hostel needs (BPPK), the hostel list and checks (BRI), damage / loss (BKK) and repairs (BP).
 * BM first. Every button calls the server, which decides who may act; this screen only shows what came back.
 */

type Board = Awaited<ReturnType<typeof api.fwHostel>>;
type AnyRec = Record<string, unknown> & { id: string; status: string };

const fileToData = (f: File | undefined) =>
  new Promise<string>((res, rej) => {
    if (!f) return res('');
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

function Photos({ onChange, label }: { onChange: (v: string[]) => void; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="file" accept="image/jpeg,image/png" capture="environment" multiple onChange={async (e) => onChange(await Promise.all([...(e.target.files ?? [])].map(fileToData)))} />
    </label>
  );
}

function NoteAct({ label, onGo, busy, tone }: { label: string; onGo: (note: string) => void; busy: boolean; tone?: 'primary' }) {
  const [note, setNote] = useState('');
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      <input className="input" aria-label={`${label} comment`} placeholder="Ulasan / comment (perlu)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={`btn btn-sm${tone === 'primary' ? ' btn-primary' : ''}`} disabled={busy} onClick={() => onGo(note)}>
        {label}
      </button>
    </span>
  );
}

const ST: Record<string, string> = {
  submitted: 'Menunggu tandatangan',
  returned: 'Dipulangkan',
  rejected: 'Ditolak',
  approved: 'Diluluskan',
  released: 'Dilepaskan',
  moved: 'Dalam perjalanan',
  received: 'Diterima di tapak baru',
  closed: 'Ditutup',
  cancelled: 'Dibatalkan',
  fwm_checked: 'Disahkan FWM',
  ordered: 'Dipesan',
  delivered: 'Dihantar',
  reported: 'Dilaporkan',
  decided: 'Diputuskan',
  done: 'Siap',
  landlord: 'Tuan rumah',
};
const st = (x: string) => ST[x] ?? x;
const STEP_BM: Record<string, string> = {
  originPic: 'PIC tapak asal setuju lepaskan',
  newPic: 'PIC tapak baru setuju terima',
  fwm: 'FWM semak',
  hq: 'Ketua syarikat lulus (HQ)',
  ketua: 'Ketua Operasi lulus (OD / OGM)',
};
const CAUSE_BM: Record<string, string> = { WEAR: 'Haus biasa', ACCIDENT: 'Kemalangan', NEGLIGENCE: 'Kecuaian', MISUSE: 'Salah guna', VANDALISM: 'Vandalisme', UNKNOWN: 'Tidak diketahui' };

/**
 * P105: the steps after approval (release, on the way, receive) and FWM's close, each with the ticks the server asks
 * for. Upstream offered only the sign steps and a close that ticked the headcount and documents by itself.
 */
function MoveSteps({ m, role, busy, go }: { m: AnyRec & { newArrival?: boolean }; role: string; busy: boolean; go: (action: string, body: Record<string, unknown>, ok: string) => unknown }) {
  const [f, setF] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const tick = (k: string, l: string) => (
    <label className="row small" style={{ gap: 6, minHeight: 44 }}>
      <input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {l}
    </label>
  );
  const text = (k: string, l: string, type = 'text') => <input className="input" type={type} aria-label={l} placeholder={l} value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
  const list = (k: string) => String(f[k] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const ops = role === 'om' || role === 'company';
  if (m.status === 'approved' && !m.newArrival && ops)
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <strong className="small">Lepaskan pekerja (PIC tapak asal)</strong>
        {tick('attendanceChecked', 'Kehadiran disemak')}
        {tick('roomChecked', 'Bilik disemak')}
        {text('itemsReturned', 'Barang dipulangkan (pisah dengan koma)')}
        {text('note', 'Nota (pilihan)')}
        <Photos label="Gambar jika ada barang kurang" onChange={setPhotos} />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => go('releaseMove', { id: m.id, attendanceChecked: !!f.attendanceChecked, roomChecked: !!f.roomChecked, itemsReturned: list('itemsReturned'), note: f.note, photos }, 'Pekerja dilepaskan.')}>
          Lepaskan
        </button>
      </div>
    );
  if ((m.status === 'released' || (m.newArrival && m.status === 'approved')) && (ops || role === 'fwm'))
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <strong className="small">Dalam perjalanan</strong>
        {text('transport', 'Pengangkutan (cth. van syarikat)')}
        {text('on', 'Tarikh pindah', 'date')}
        {text('carries', 'Barang dibawa (pisah dengan koma)')}
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => go('transitMove', { id: m.id, transport: f.transport, on: f.on, carries: list('carries') }, 'Direkod dalam perjalanan.')}>
          Rekod perjalanan
        </button>
      </div>
    );
  if (m.status === 'moved' && ops)
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <strong className="small">Terima di tapak baru (PIC tapak baru)</strong>
        {tick('arrived', 'Pekerja sudah sampai')}
        <label className="small">
          Pengenalan disemak dengan{' '}
          <Select className="select" aria-label="Pengenalan" value={String(f.identity ?? '')} onChange={(e) => setF({ ...f, identity: e.target.value })}>
            <option value="">-</option>
            <option value="face">Wajah</option>
            <option value="card">Kad pekerja</option>
          </Select>
        </label>
        {tick('briefing', 'Taklimat keselamatan dan peraturan asrama diberi')}
        {text('room', 'Bilik (pilihan)')}
        {text('note', 'Nota (pilihan)')}
        <Photos label="Gambar jika ada barang kurang" onChange={setPhotos} />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => go('receiveMove', { id: m.id, arrived: !!f.arrived, identity: f.identity, briefing: !!f.briefing, room: f.room || null, note: f.note, photos }, 'Pekerja diterima; penginapan direkod.')}>
          Terima
        </button>
      </div>
    );
  if (m.status === 'received' && role === 'fwm')
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <strong className="small">Tutup pindah (FWM, selepas dikemas kini dalam JA)</strong>
        {text('jaRef', 'Rujukan JA')}
        {tick('headcountOk', 'Senarai pekerja dan bilangan betul')}
        {tick('documentsKept', 'Dokumen disimpan')}
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => go('closeMove', { id: m.id, jaRef: f.jaRef, headcountOk: !!f.headcountOk, documentsKept: !!f.documentsKept }, 'Pindah ditutup.')}>
          Tutup pindah
        </button>
      </div>
    );
  return null;
}

export function FwHostelPanel() {
  const v = useLoad(() => api.fwHostel(), []);
  const act = useAction();
  // P121: a link may open one of these tabs (#hostels/needs).
  const [asked, setTab] = useRouteTab<'hostels' | 'moves' | 'needs' | 'damage' | 'repairs'>('hostels', ['hostels', 'moves', 'needs', 'damage', 'repairs']);
  const [form, setForm] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  if (v.error) return null;
  const d = v.data as Board | undefined;
  if (!d) return null;
  const go = (action: string, body: Record<string, unknown>, ok: string) => act.run(() => api.fwHostelAct(action, body), ok).then((r) => r && (setForm(null), setF({}), setPhotos([]), v.reload()));
  const t = d.tiles as unknown as Record<string, number>;
  const hostels = (d.hostels ?? []) as { hostel: { id: string; name: string; beds: number; supervisor: { name: string | null } | null; cert: { expiresOn: string } | null }; residents: number; over: boolean; certState: string; checks: Record<string, unknown>; inventory: { name: string; good: number; damaged: number; missing: number }[]; openDamage: number; openMaint: number }[];
  const moves = (d.moves ?? []) as { move: AnyRec & { workers: { name: string; staffNo: string }[]; type: string; startOn: string; warnings: string[]; form: string }; canSign: string[]; notClosedHours: number; moveLate?: { days: number; target: number; escalate: boolean } | null }[];
  const needs = (d.needs ?? []) as (AnyRec & { hostelName: string; items: { name: string; qty: number }[]; form: string })[];
  const damages = ((d as { damages?: unknown[] }).damages ?? []) as (AnyRec & { hostelId: string; lines: { item: string; qty: number }[]; penalty: { amount: number; status: string } | null })[];
  const maints = ((d as { maints?: unknown[] }).maints ?? []) as (AnyRec & { hostelName: string; what: string; critical: boolean })[];
  const role = d.role;
  // Asset Management has only the needs and repairs tabs: open on needs rather than on a tab it cannot see.
  const tab = role === 'asset' && asked !== 'needs' && asked !== 'repairs' ? 'needs' : asked;
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3>Hostel pekerja asing / Foreign worker hostels</h3>
      </div>
      <ErrorNotice error={act.error} />
      <div className="kpis">
        {'movesWaiting' in t && <Kpi label="Pindah menunggu / Moves waiting" value={t.movesWaiting} tone={t.movesWaiting ? 'warn' : 'ok'} />}
        {'movesNotClosed24h' in t && <Kpi label="Belum ditutup 24 j" value={t.movesNotClosed24h} tone={t.movesNotClosed24h ? 'crit' : 'ok'} />}
        {'hostelsOver' in t && <Kpi label="Lebih katil / Over beds" value={t.hostelsOver} tone={t.hostelsOver ? 'crit' : 'ok'} />}
        {'checksOverdue' in t && <Kpi label="Semakan lewat / Checks late" value={t.checksOverdue} tone={t.checksOverdue ? 'warn' : 'ok'} />}
        {'needsWaiting' in t && <Kpi label="Keperluan / Needs" value={t.needsWaiting} />}
        {'needsToOrder' in t && <Kpi label="Needs to order" value={t.needsToOrder} tone={t.needsToOrder ? 'warn' : 'ok'} />}
        {'repairsToOrder' in t && <Kpi label="Repairs to order" value={t.repairsToOrder} tone={t.repairsToOrder ? 'warn' : 'ok'} />}
      </div>
      <div className="tabbar" role="tablist" aria-label="Hostel care">
        {role !== 'asset' && (
          <button role="tab" aria-selected={tab === 'hostels'} onClick={() => setTab('hostels')}>
            Hostel
          </button>
        )}
        {role !== 'asset' && (
          <button role="tab" aria-selected={tab === 'moves'} onClick={() => setTab('moves')}>
            Pindah hostel / site
          </button>
        )}
        <button role="tab" aria-selected={tab === 'needs'} onClick={() => setTab('needs')}>
          Keperluan hostel
        </button>
        {role !== 'asset' && (
          <button role="tab" aria-selected={tab === 'damage'} onClick={() => setTab('damage')}>
            Kerosakan / kehilangan
          </button>
        )}
        <button role="tab" aria-selected={tab === 'repairs'} onClick={() => setTab('repairs')}>
          Penyelenggaraan
        </button>
      </div>

      {tab === 'hostels' && role !== 'asset' && (
        <div className="list">
          {hostels.length === 0 && <div className="empty">No hostels to show.</div>}
          {hostels.map((h) => (
            <div key={h.hostel.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <strong>{h.hostel.name}</strong>
                <span className="row" style={{ gap: 4 }}>
                  <Chip tone={h.over ? 'crit' : 'ok'}>
                    {h.residents}/{h.hostel.beds} katil
                  </Chip>
                  <Chip tone={h.certState === 'ok' ? 'ok' : 'warn'}>{h.certState === 'ok' ? 'Sijil OK' : h.certState === 'expired' ? 'Sijil tamat' : 'Tiada sijil'}</Chip>
                  {(h.checks.weeklyLate as boolean) && <Chip tone="warn">Semakan mingguan lewat</Chip>}
                  {(h.checks.monthlyLate as boolean) && <Chip tone="warn">Lawatan bulanan lewat</Chip>}
                </span>
              </div>
              <div className="muted small">
                Penyelia / supervisor: {h.hostel.supervisor?.name ?? 'not set'} · damage open {h.openDamage} · repairs open {h.openMaint} · items {h.inventory.length}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {(role === 'om' || role === 'company' || role === 'fwm') && (
                  <button className="btn btn-sm" onClick={() => setForm(`check:${h.hostel.id}`)}>
                    Semakan mingguan / Weekly check
                  </button>
                )}
                {(role === 'om' || role === 'company') && (
                  <button className="btn btn-sm" onClick={() => setForm(`damage:${h.hostel.id}`)}>
                    Lapor kerosakan
                  </button>
                )}
                {(role === 'om' || role === 'company') && (
                  <button className="btn btn-sm" onClick={() => setForm(`need:${h.hostel.id}`)}>
                    Mohon keperluan
                  </button>
                )}
                {(role === 'om' || role === 'company') && (
                  <button className="btn btn-sm" onClick={() => setForm(`maint:${h.hostel.id}`)}>
                    Mohon baik pulih
                  </button>
                )}
                {role === 'fwm' && (
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => go('openCount', { id: h.hostel.id }, 'First count opened.')}>
                    Buka kiraan pertama (BRI)
                  </button>
                )}
              </div>
              {form === `check:${h.hostel.id}` && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <Photos label="2 photos (needed)" onChange={setPhotos} />
                  <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => go('recordCheck', { id: h.hostel.id, freq: 'weekly', ticks: { clean: true, safe: true, working: true }, photos }, 'Check recorded.')}>
                    Bersih, selamat, berfungsi / Save
                  </button>
                </div>
              )}
              {form === `damage:${h.hostel.id}` && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <input className="input" placeholder="Barang / item" value={String(f.item ?? '')} onChange={(e) => setF({ ...f, item: e.target.value })} />
                  <Select className="input" value={String(f.cause ?? 'UNKNOWN')} onChange={(e) => setF({ ...f, cause: e.target.value })}>
                    {['WEAR', 'ACCIDENT', 'NEGLIGENCE', 'MISUSE', 'VANDALISM', 'UNKNOWN'].map((c) => (
                      <option key={c} value={c}>
                        {CAUSE_BM[c]}
                      </option>
                    ))}
                  </Select>
                  <input className="input" placeholder="Nota / note" value={String(f.note ?? '')} onChange={(e) => setF({ ...f, note: e.target.value })} />
                  <Photos label="Photos (needed)" onChange={setPhotos} />
                  <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => go('reportDamage', { id: h.hostel.id, lines: [{ item: f.item, qty: 1 }], cause: f.cause ?? 'UNKNOWN', suggested: 'none', note: f.note, photos }, 'Sent to FWM.')}>
                    Hantar ke FWM
                  </button>
                </div>
              )}
              {form === `need:${h.hostel.id}` && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <input className="input" placeholder="Barang / item" value={String(f.item ?? '')} onChange={(e) => setF({ ...f, item: e.target.value })} />
                  <input className="input" type="number" min={1} placeholder="Kuantiti / qty" value={String(f.qty ?? '')} onChange={(e) => setF({ ...f, qty: e.target.value })} />
                  <Select className="input" value={String(f.reason ?? 'REPLACE_DAMAGED')} onChange={(e) => setF({ ...f, reason: e.target.value })}>
                    {Object.entries((d as { reasons?: { need: Record<string, { ms: string }> } }).reasons?.need ?? {}).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r.ms}
                      </option>
                    ))}
                  </Select>
                  <input className="input" placeholder="Justifikasi (perlu)" value={String(f.justification ?? '')} onChange={(e) => setF({ ...f, justification: e.target.value })} />
                  <input className="input" type="date" aria-label="Tarikh perlu / needed by" value={String(f.neededBy ?? '')} onChange={(e) => setF({ ...f, neededBy: e.target.value })} />
                  <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => go('raiseNeed', { id: h.hostel.id, items: [{ name: f.item, qty: Number(f.qty) }], reason: f.reason ?? 'REPLACE_DAMAGED', justification: f.justification, neededBy: f.neededBy }, 'Need sent to FWM.')}>
                    Hantar
                  </button>
                </div>
              )}
              {form === `maint:${h.hostel.id}` && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <input className="input" placeholder="Apa yang rosak / what is damaged" value={String(f.what ?? '')} onChange={(e) => setF({ ...f, what: e.target.value })} />
                  <label className="row small" style={{ gap: 6 }}>
                    <input type="checkbox" checked={!!f.critical} onChange={(e) => setF({ ...f, critical: e.target.checked })} /> Kritikal (elektrik, air, bocor besar, bahaya)
                  </label>
                  <Select className="input" value={String(f.costBy ?? 'company')} onChange={(e) => setF({ ...f, costBy: e.target.value })}>
                    <option value="company">Syarikat / company</option>
                    <option value="landlord">Tuan rumah / landlord</option>
                    <option value="other">Lain-lain / other</option>
                  </Select>
                  <Photos label="Before photos (needed)" onChange={setPhotos} />
                  <p className="muted small">Company-paid repairs need 3 contractor quotes (2 only with the Asset Director's reason); add them on the request.</p>
                  <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => go('requestMaint', { id: h.hostel.id, what: f.what, critical: !!f.critical, costBy: f.costBy ?? 'company', before: photos, quotes: f.quotes ?? [] }, 'Repair request sent.')}>
                    Hantar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'moves' && role !== 'asset' && (
        <div className="list">
          {moves.length === 0 && <div className="empty">Tiada permohonan pindah / no moves.</div>}
          {moves.map((r) => (
            <div key={r.move.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span>
                  <span className="mono small">{r.move.form}</span> {r.move.type} · {r.move.workers.map((w) => w.name).join(', ')} · mula {r.move.startOn}
                </span>
                <Chip tone={r.move.status === 'closed' ? 'ok' : r.move.status === 'rejected' ? 'crit' : 'info'}>{st(r.move.status)}</Chip>
              </div>
              {r.move.warnings.length > 0 && <div className="small">{r.move.warnings.join(' · ')}</div>}
              {r.canSign.map((step) => (
                <div key={step} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="small">{STEP_BM[step] ?? step}:</span>
                  <NoteAct label="Lulus / Approve" tone="primary" busy={act.busy} onGo={(note) => go('decideMove', { id: r.move.id, step, decision: 'approve', note }, 'Signed.')} />
                  <NoteAct label="Tolak / Reject" busy={act.busy} onGo={(note) => go('decideMove', { id: r.move.id, step, decision: 'reject', note }, 'Rejected.')} />
                  {step === 'fwm' && <NoteAct label="Pulangkan / Return" busy={act.busy} onGo={(note) => go('decideMove', { id: r.move.id, step, decision: 'return', note }, 'Returned to the OM.')} />}
                </div>
              ))}
              {r.moveLate && <Chip tone="crit">{`Lewat: ${r.moveLate.days} hari bekerja selepas lulus (sasaran ${r.moveLate.target})`}</Chip>}
              {r.notClosedHours >= 24 && <Chip tone="crit">{`Belum ditutup ${r.notClosedHours} jam selepas diterima`}</Chip>}
              <MoveSteps m={r.move} role={role} busy={act.busy} go={go} />
            </div>
          ))}
        </div>
      )}

      {tab === 'needs' && (
        <div className="list">
          {needs.length === 0 && <div className="empty">Tiada / none.</div>}
          {needs.map((n) => (
            <div key={n.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span>
                  <span className="mono small">{n.form}</span> {n.hostelName}: {n.items.map((i) => `${i.qty} x ${i.name}`).join(', ')}
                </span>
                <Chip tone="info">{st(n.status)}</Chip>
              </div>
              {role === 'fwm' && n.status === 'submitted' && <NoteAct label="Sahkan / Verify" tone="primary" busy={act.busy} onGo={(note) => go('decideNeed', { id: n.id, step: 'fwm', note }, 'Verified.')} />}
              {role === 'sector' && n.status === 'fwm_checked' && (
                <>
                  <NoteAct label="Lulus / Approve" tone="primary" busy={act.busy} onGo={(note) => go('decideNeed', { id: n.id, step: 'approve', note }, 'Approved.')} />
                  <Select aria-label="Sebab tolak / reason refused" value={String(f[`rej-${n.id}`] ?? '')} onChange={(e) => setF({ ...f, [`rej-${n.id}`]: e.target.value })}>
                    <option value="">Sebab tolak / reason refused…</option>
                    <option value="FORM_INCOMPLETE">Borang tidak lengkap</option>
                    <option value="NOT_JUSTIFIED">Alasan tidak wajar</option>
                    <option value="WRONG_DETAILS">Maklumat salah</option>
                    <option value="AGAINST_POLICY">Bercanggah dengan polisi</option>
                    <option value="NO_BUDGET">Tiada bajet</option>
                    <option value="OTHER">Lain-lain (tulis)</option>
                  </Select>
                  <NoteAct label="Tolak / Reject" busy={act.busy} onGo={(note) => go('decideNeed', { id: n.id, step: 'reject', note, rejectReason: f[`rej-${n.id}`] ?? null }, 'Rejected.')} />
                </>
              )}
              {role === 'asset' && n.status === 'approved' && (
                <span className="row" style={{ gap: 4 }}>
                  <input className="input" aria-label="Estimated cost" placeholder="Anggaran RM" value={String(f[`cost:${n.id}`] ?? '')} onChange={(e) => setF({ ...f, [`cost:${n.id}`]: e.target.value })} />
                  <NoteAct label="Order" tone="primary" busy={act.busy} onGo={(reason) => go('orderNeed', { id: n.id, estCost: Number(f[`cost:${n.id}`]), reason }, 'Purchase request raised.')} />
                </span>
              )}
              {role === 'asset' && n.status === 'ordered' && <NoteAct label="Delivered on (YYYY-MM-DD)" busy={act.busy} onGo={(on) => go('needDelivered', { id: n.id, on }, 'Delivery recorded.')} />}
              {(role === 'om' || role === 'company') && n.status === 'delivered' && (
                <span>
                  <Photos label="Photo of the goods at the hostel" onChange={setPhotos} />
                  <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('needReceived', { id: n.id, photo: photos[0] }, 'Receipt confirmed.')}>
                    Terima / Received
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'damage' && (
        <div className="list">
          {damages.length === 0 && <div className="empty">Tiada / none.</div>}
          {damages.map((x) => (
            <div key={x.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{x.lines.map((l) => `${l.qty} x ${l.item}`).join(', ')}</span>
                <Chip tone={x.status === 'closed' ? 'ok' : 'warn'}>{st(x.status)}</Chip>
              </div>
              {x.penalty && (
                <div className="small">
                  Bayaran pekerja / worker pays: RM{x.penalty.amount.toFixed(2)} · {x.penalty.status}
                </div>
              )}
              {role === 'fwm' && x.status === 'reported' && <NoteAct label="Keputusan FWM (tiada caj) / Decide, no charge" busy={act.busy} onGo={(finding) => go('decideDamage', { id: x.id, action: 'repair', finding }, 'Decided.')} />}
              {role === 'fwm' && x.status === 'decided' && <NoteAct label="Tutup / Close" busy={act.busy} onGo={(note) => go('closeDamage', { id: x.id, note }, 'Closed.')} />}
            </div>
          ))}
        </div>
      )}

      {tab === 'repairs' && (
        <div className="list">
          {maints.length === 0 && <div className="empty">Tiada / none.</div>}
          {maints.map((m) => (
            <div key={m.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {m.hostelName}: {m.what}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  {m.critical && <Chip tone="crit">Kritikal</Chip>}
                  <Chip tone="info">{st(m.status)}</Chip>
                </span>
              </div>
              {role === 'fwm' && m.status === 'reported' && <NoteAct label="Semak / Check" tone="primary" busy={act.busy} onGo={(note) => go('maintStep', { id: m.id, step: 'fwm', note }, 'Checked.')} />}
              {role === 'sector' && m.status === 'fwm_checked' && <NoteAct label="Lulus / Approve" tone="primary" busy={act.busy} onGo={(note) => go('maintStep', { id: m.id, step: 'approve', note }, 'Approved.')} />}
              {role === 'asset' && m.status === 'approved' && <NoteAct label="Open work order (2-quote reason if needed)" busy={act.busy} onGo={(twoQuotesReason) => go('maintStep', { id: m.id, step: 'order', twoQuotesReason }, 'Work order opened.')} />}
              {(role === 'om' || role === 'company') && (m.status === 'ordered' || m.status === 'landlord') && (
                <span>
                  <Photos label="After photos (needed)" onChange={setPhotos} />
                  <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => go('maintStep', { id: m.id, step: 'done', after: photos, note: 'Complete as scoped' }, 'Work confirmed.')}>
                    Kerja siap / Work complete
                  </button>
                </span>
              )}
              {(role === 'fwm' || role === 'asset') && m.status === 'done' && (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => go('maintStep', { id: m.id, step: 'close' }, 'Closed.')}>
                  Tutup / Close
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
