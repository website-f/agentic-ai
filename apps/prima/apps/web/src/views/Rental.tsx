import { useState } from 'react';
import { api } from '../api';
import { saveFile } from '../save';
import { Chip, Loading, dateLabel, useAction, useLoad } from '../ui';
import { OpForm, type Field } from './ItPolicyPanel';

/**
 * Rumah Sewa (Part V, Fitri package; the Prisma Wiramaju rental papers and Fauzan's answers of 14 Nov 2026): one
 * place for a rental home from Kosong to Telah Disewa and back: the letting file, the application and the deposit
 * request, the agreement and LHDN stamping, the monthly rent with the zakat part, arrears and the notice, moving out
 * with the deposit statement, and repairs (who pays). The server checks every rule again; this screen only offers the
 * steps. Only Finance confirms money; only the checked LHDN certificate makes an agreement "Disetem".
 */
type Rec = { id: string; kind: string; ref: string; status: string; unitId: string | null; unitCode: string; d: Record<string, any>; at: string; by: string };
type Board = {
  role: 'director' | 'team' | 'finance' | 'oversee';
  settings: { values: Record<string, any>; templates: Record<string, { v: number; note: string; at: string }[]>; officers: string[]; primaOnlyFrom: string | null };
  papers: { code: string; title: string; inForce: string }[];
  units: { id: string; code: string; name: string; owner: string; status: string; rentalStatus: string; tenant: string | null; rent: number | null; stamped: boolean | null; readiness: string[] | null }[];
  owners: Rec[];
  listings: Rec[];
  agents: Rec[];
  applications: (Rec & { clock: { total: number; waiting: number; team: number; late: boolean } | null; gate: string[] | null })[];
  agreements: (Rec & { deadline: string | null })[];
  collections: (Rec & { owes: { owes: number; shortfall: number; zPaid: number; tPaid: number } })[];
  invoiceMissing: { unit: string; period: string; late: boolean }[];
  bankLines: Rec[];
  zakat: Rec[];
  zakatList: { unit: string; body: string; approved: number; received: number; short: number; to: string; release: boolean }[];
  arrearsDue: { unitId: string; unit: string; months: number; owes: number }[];
  arrears: Rec[];
  moveouts: Rec[];
  repairs: Rec[];
  panels: Rec[];
  oldDeposits: Rec[];
  depositHeld: { kind: string; total: number }[];
  perKind: Record<string, { billed: number; confirmed: number }>;
  late: { what: string; ref: string; unit: string; since: string; who: string }[];
};
const send = (op: string, map?: (i: Record<string, unknown>) => Record<string, unknown>) => (i: Record<string, unknown>) => api.amRentalAct(op, map ? map(i) : i);
const BM: Record<string, string> = {
  KOSONG: 'Kosong', DIIKLANKAN: 'Diiklankan', DALAM_PROSES: 'Dalam Proses Sewaan', TELAH_DISEWA: 'Telah Disewa',
  DITERIMA: 'Diterima', MENUNGGU_DOKUMEN: 'Menunggu Dokumen', LENGKAP: 'Lengkap', DINILAI: 'Dinilai', UNTUK_KEPUTUSAN: 'Untuk Keputusan', LULUS: 'Lulus', TIDAK_LULUS: 'Tidak Lulus', DISERAH: 'Kunci diserah',
  DRAF: 'Draf', DIHANTAR: 'Dihantar kepada penyewa', PINDAAN: 'Pindaan', VERSI_AKHIR: 'Versi akhir', DITANDATANGANI_PENYEWA: 'Ditandatangani (penyewa)', DITANDATANGANI_PEMILIK: 'Ditandatangani (pemilik)', SEDIA_BAYARAN: 'Sedia untuk bayaran duti', NOTIS_DIHANTAR: 'Notis dihantar', BUKTI_PENYEWA: 'Bukti penyewa diterima', BAYARAN_DISAHKAN: 'Bayaran penyewa disahkan', DIBAYAR_LHDN: 'Dibayar kepada LHDN', DISETEM: 'Disetem', DISERAHKAN: 'Diserahkan kepada penyewa', DIFAILKAN: 'Difailkan',
  INVOIS_DIKELUARKAN: 'Invois dikeluarkan', INVOIS_DIHANTAR: 'Invois dihantar', BUKTI_DITERIMA: 'Bukti diterima', DALAM_SEMAKAN: 'Dalam Semakan', DISAHKAN_KEWANGAN: 'Disahkan Kewangan', RESIT_DIKELUARKAN: 'Resit dikeluarkan', SELESAI: 'Selesai',
};
const bm = (s: string) => BM[s] ?? s.replace(/_/g, ' ').toLowerCase();
const ID: Field = { k: 'id', l: 'Record' };
const NOTE: Field = { k: 'note', l: 'Comment / reason' };
const PROOF: Field = { k: 'proof', l: 'Proof', t: 'proof' };
const step = (op: string, s: string) => send(op, (i) => ({ ...i, step: s }));
const list = (x: unknown) => String(x ?? '').split(',').map((y) => y.trim()).filter(Boolean);
const pairs = (x: unknown) => list(x).map((p) => { const [item, count] = p.split(':'); return { item: item.trim(), count: Number(count ?? 1) }; });

export function RentalPanel() {
  const { data, error } = useLoad(() => api.amRentalAct('board', {}) as Promise<Board>, []);
  const [tab, setTab] = useState<'today' | 'letting' | 'apps' | 'agree' | 'rent' | 'arrears' | 'out' | 'repair' | 'setup'>('today');
  const act = useAction();
  if (error) return <p className="small muted">Rekod rumah sewa belum dipasang dalam pangkalan data ini (modul am-rental-v1, dijalankan oleh CEO).</p>;
  if (!data) return <Loading what="rumah sewa" />;
  const team = data.role === 'team' || data.role === 'director';
  const fin = data.role === 'finance';
  const tabs: [typeof tab, string][] = [['today', `Hari ini (${data.late.length})`], ['letting', 'Iklan'], ['apps', 'Permohonan'], ['agree', 'Perjanjian & setem'], ['rent', 'Kutipan sewa'], ['arrears', 'Tunggakan'], ['out', 'Keluar & deposit'], ['repair', 'Pembaikan'], ['setup', 'Tetapan & kertas']];
  return (
    <div className="panel">
      <h3>Rumah sewa</h3>
      <div className="tabs" role="tablist" aria-label="Rental home sections" style={{ flexWrap: 'wrap' }}>
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      {tab === 'today' && (
        <>
          <ul className="list">
            {data.late.map((x, k) => (
              <li key={k}><Chip tone={/Asset Director|critical/i.test(x.what + x.who) ? 'crit' : 'warn'}>{x.who}</Chip> {x.unit} {x.ref}: {x.what}</li>
            ))}
            {!data.late.length && <li className="muted">Tiada yang lewat.</li>}
          </ul>
          <table className="table"><thead><tr><th>Unit</th><th>Status</th><th>Penyewa</th><th>Sewa</th><th>Setem</th><th>Sebelum iklan</th></tr></thead><tbody>
            {data.units.map((u) => (
              <tr key={u.id}><td>{u.code}</td><td>{bm(u.rentalStatus)}</td><td>{u.tenant ?? '-'}</td><td>{u.rent ?? '-'}</td><td>{u.stamped == null ? '-' : u.stamped ? 'Ya' : 'Belum'}</td><td className="small">{u.readiness?.length ? `Jangan iklan lagi: ${u.readiness.join('; ')}` : ''}</td></tr>
            ))}
          </tbody></table>
        </>
      )}
      {tab === 'letting' && (
        <>
          {team && <OpForm title="Buka fail sewaan" op="listingOpen" send={send('listingOpen')} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.map((u) => u.id) }]} />}
          {team && <OpForm title="Butiran unit" op="unitInfo" send={send('unitInfo', (i) => ({ ...i, facilities: list(i.facilities), moveInKeys: pairs(i.moveInKeys), indahWaterOwn: i.indahWaterOwn !== 'no' }))} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.map((u) => u.id) }, { k: 'bedrooms', l: 'Bilik tidur', t: 'number' }, { k: 'bathrooms', l: 'Bilik air', t: 'number' }, { k: 'building', l: 'Jenis bangunan', t: 'select', o: ['TERRACE', 'MULTI_STOREY', 'OTHER'] }, { k: 'propertyKind', l: 'Jenis harta', t: 'select', o: ['HOUSE', 'LAND', 'BUILDING', 'OFFICE', 'SHOP'] }, { k: 'address', l: 'Alamat' }, { k: 'facilities', l: 'Kemudahan' }, { k: 'availableOn', l: 'Boleh masuk', t: 'date' }, { k: 'contactPhone', l: 'No. hubungan' }, { k: 'indahWaterOwn', l: 'Akaun Indah Water sendiri', t: 'yn' }, { k: 'minIncome', l: 'Pendapatan minimum unit (luar jadual)', t: 'number' }, { k: 'moveInKeys', l: 'Kunci (item:bilangan, ...)' }, { k: 'photos', l: 'Foto unit', t: 'photos' }]} />}
          {data.listings.map((l) => (
            <div key={l.id} className="panel">
              <strong>{l.unitCode} {l.ref}</strong> <Chip tone="info">{bm(l.status)}</Chip>
              <div className="small">Sewa {l.d.terms ? `RM${l.d.terms.rent}, deposit RM${l.d.terms.deposit} (${l.d.terms.approved ? 'diluluskan' : 'menunggu Pengarah Aset'})` : 'belum dicadang'}; iklan: {(l.d.adverts ?? []).map((a: any) => `${a.platform}${a.takenDown ? ' (diturunkan)' : ''}`).join(', ') || '-'}; pertanyaan: {(l.d.enquiries ?? []).length}</div>
              {team && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <OpForm title="Cadang sewa" op="terms" fixed={{ id: l.id }} send={send('terms')} fields={[{ k: 'rent', l: 'Sewa', t: 'number' }, { k: 'deposit', l: 'Deposit', t: 'number' }, { k: 'termMonths', l: 'Tempoh (bulan)', t: 'number' }, { k: 'why', l: 'Sebab (jika berbeza)' }]} />
                  {data.role === 'director' && <OpForm title="Lulus sewa" op="termsDecide" fixed={{ id: l.id }} send={send('termsDecide', (i) => ({ ...i, approve: i.decision !== 'reject' }))} fields={[{ k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'reject'] }, NOTE]} />}
                  <OpForm title="Iklan" op="advert" fixed={{ id: l.id }} send={send('advert')} fields={[{ k: 'platform', l: 'Platform', t: 'select', o: data.settings.values.platforms }, { k: 'link', l: 'Pautan' }, { k: 'photosChecked', l: 'Foto terkini, jelas, tiada maklumat peribadi', t: 'check' }, { k: 'screenshot', l: 'Tangkapan skrin', t: 'proof' }]} />
                  <OpForm title="Pertanyaan" op="enquiry" fixed={{ id: l.id }} send={send('enquiry')} fields={[{ k: 'name', l: 'Nama' }, { k: 'phone', l: 'Telefon' }, { k: 'at', l: 'Tarikh dan masa (YYYY-MM-DDTHH:MM)' }, { k: 'channel', l: 'Saluran', t: 'select', o: ['WHATSAPP', 'PHONE', 'OTHER'] }, { k: 'source', l: 'Sumber', t: 'select', o: ['DIRECT', 'AGENT'] }, { k: 'agentId', l: 'Ejen (jika ejen)' }, { k: 'told', l: 'Maklumat yang diberi' }]} />
                  <OpForm title="Saringan / balasan" op="enquiryStep" fixed={{ id: l.id }} send={send('enquiryStep')} fields={[{ k: 'n', l: 'No. pertanyaan', t: 'number' }, { k: 'step', l: 'Langkah', t: 'select', o: ['reply', 'screen', 'viewing', 'note'] }, { k: 'result', l: 'Keputusan saringan', t: 'select', o: ['BERMINAT_LAYAK', 'PERLU_MAKLUMAT', 'TIDAK_LAYAK', 'TIDAK_BERMINAT'] }, { k: 'reason', l: 'Sebab (dalaman; sama untuk semua)' }, { k: 'on', l: 'Tarikh tontonan', t: 'date' }, { k: 'text', l: 'Nota' }]} />
                  <OpForm title="Turunkan iklan" op="takedown" fixed={{ id: l.id }} send={send('takedown')} fields={[{ k: 'platform', l: 'Platform', t: 'select', o: data.settings.values.platforms }, { k: 'screenshot', l: 'Bukti', t: 'proof' }]} />
                  <OpForm title="Pembetulan iklan" op="correction" fixed={{ id: l.id }} send={send('correction', (i) => ({ ...i, told: list(i.told).map(Number) }))} fields={[{ k: 'field', l: 'Butiran salah' }, { k: 'wrong', l: 'Salah' }, { k: 'right', l: 'Betul' }, { k: 'told', l: 'Pertanyaan yang telah dimaklumkan (no.)' }, PROOF]} />
                  <OpForm title="Cadang ejen" op="agentPropose" fixed={{ listingId: l.id }} send={send('agentPropose')} fields={[{ k: 'name', l: 'Nama ejen' }, { k: 'company', l: 'Syarikat' }, { k: 'phone', l: 'Telefon' }, { k: 'why', l: 'Sebab' }]} />
                </div>
              )}
            </div>
          ))}
          {data.agents.map((a) => (
            <div key={a.id} className="small">Ejen {a.d.name} ({a.unitCode}) <Chip tone="info">{a.status}</Chip>
              {data.role === 'director' && <OpForm title="Keputusan ejen / bayaran" op="agentStep" fixed={{ id: a.id }} send={send('agentStep', (i) => ({ ...i, approve: i.decision !== 'reject' }))} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['decide', 'feeApprove'] }, { k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'reject'] }, { k: 'feeMonths', l: 'Yuran (bulan sewa)', t: 'number' }, NOTE]} />}
              {team && <OpForm title="Mohon bayaran ejen" op="agentStep" fixed={{ id: a.id, step: 'feeRequest' }} send={send('agentStep', (i) => ({ ...i, docs: { approval: i.approval, terms: i.terms, serviceProof: i.serviceProof, invoice: i.invoice } }))} fields={[{ k: 'approval', l: 'Kelulusan', t: 'check' }, { k: 'terms', l: 'Terma yuran', t: 'check' }, { k: 'serviceProof', l: 'Bukti perkhidmatan', t: 'check' }, { k: 'invoice', l: 'Invois', t: 'check' }, { k: 'files', l: 'Dokumen', t: 'proof' }]} />}
            </div>
          ))}
        </>
      )}
      {tab === 'apps' && (
        <>
          {team && (
            <OpForm title="Borang permohonan AST/BOR/PS/001" op="application" send={send('application', (i) => ({ unitId: i.unitId, conditionsExplained: i.conditionsExplained, applicantType: i.applicantType || 'PERSON', applicant: { name: i.name, ic: i.ic, phone: i.phone, email: i.email, address: i.address, employer: i.employer, job: i.job, net: Number(i.net || 0) }, spouse: i.spouseName ? { name: i.spouseName, net: Number(i.spouseNet || 0) } : null, company: i.ssmNo ? { ssmNo: i.ssmNo } : null, occupants: i.occupants, cars: i.cars, motorcycles: i.motorcycles, pets: i.pets === 'yes', purpose: i.purpose, moveInOn: i.moveInOn, declarationSigned: i.declarationSigned, annexSignedOn: i.annexSignedOn, related: { yes: i.relatedYes === 'yes', staffUserId: i.relatedId, details: i.relatedDetails }, source: i.source || 'DIRECT', agentId: i.agentId, enquiryAt: i.enquiryAt, docs: i.docs }))} fields={[
              { k: 'unitId', l: 'Unit', t: 'select', o: data.units.map((u) => u.id) }, { k: 'conditionsExplained', l: 'Syarat diterangkan', t: 'check' }, { k: 'applicantType', l: 'Jenis pemohon', t: 'select', o: ['PERSON', 'COMPANY'] },
              { k: 'name', l: 'Nama penuh' }, { k: 'ic', l: 'No. KP' }, { k: 'phone', l: 'Telefon' }, { k: 'email', l: 'Emel' }, { k: 'address', l: 'Alamat tetap' }, { k: 'employer', l: 'Majikan' }, { k: 'job', l: 'Jawatan' }, { k: 'net', l: 'Pendapatan bersih', t: 'number' },
              { k: 'spouseName', l: 'Nama pasangan' }, { k: 'spouseNet', l: 'Pendapatan pasangan', t: 'number' }, { k: 'ssmNo', l: 'No. SSM (syarikat)' },
              { k: 'occupants', l: 'Penghuni', t: 'number' }, { k: 'cars', l: 'Kereta', t: 'number' }, { k: 'motorcycles', l: 'Motosikal', t: 'number' }, { k: 'pets', l: 'Haiwan', t: 'yn' }, { k: 'purpose', l: 'Tujuan' }, { k: 'moveInOn', l: 'Tarikh masuk', t: 'date' },
              { k: 'relatedYes', l: 'Ada kaitan dengan staf?', t: 'yn' }, { k: 'relatedId', l: 'Staf berkaitan (id)' }, { k: 'relatedDetails', l: 'Butiran kaitan' },
              { k: 'declarationSigned', l: 'Akuan ditandatangani', t: 'check' }, { k: 'annexSignedOn', l: 'Lampiran syarat ditandatangani', t: 'date' }, { k: 'source', l: 'Sumber', t: 'select', o: ['DIRECT', 'AGENT'] }, { k: 'agentId', l: 'Ejen' }, { k: 'enquiryAt', l: 'Masa pertanyaan (YYYY-MM-DDTHH:MM)' }, { k: 'docs', l: 'Borang, KP, slip gaji', t: 'proof' },
            ]} />
          )}
          {team && <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.amRentalAct('purge', {}), 'Permohonan lama dibersihkan.')}>Bersihkan permohonan gagal (6 bulan)</button>}
          {data.applications.map((a) => (
            <div key={a.id} className="panel">
              <strong>{a.unitCode} {a.ref}</strong> <Chip tone={a.clock?.late ? 'crit' : 'info'}>{bm(a.status)}</Chip>{' '}
              <span className="small">{a.d.applicant?.name ?? a.d.applicantName ?? ''} {a.clock ? `· ${a.clock.team} hari bekerja (menunggu ${a.clock.waiting})` : ''} {a.d.dpr ? `· ${a.d.dpr.no} RM${a.d.dpr.total}` : ''} {a.d.depositFull ? '· deposit penuh disahkan' : ''}</span>
              {a.d.assessment && <ul className="small">{a.d.assessment.rules.map((r: any) => <li key={r.rule}>{r.rule}: {r.ok === null ? '-' : r.ok ? 'lulus' : 'kurang'} ({r.note})</li>)}</ul>}
              {a.gate?.length ? <div className="small">Kunci belum: {a.gate.join('; ')}</div> : null}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {team && <OpForm title="Langkah permohonan" op="appStep" fixed={{ id: a.id }} send={send('appStep', (i) => ({ ...i, missing: list(i.missing), approve: i.decision !== 'reject' }))} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['waitDocs', 'docsIn', 'check', 'assess', 'forDecision', 'decide', 'told', 'dpr', 'depositProof', 'utility', 'handoverDate'] }, { k: 'missing', l: 'Dokumen kurang' }, { k: 'recommendation', l: 'Cadangan pasukan' }, { k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'reject'] }, { k: 'account', l: 'Akaun', t: 'select', o: ['TNB', 'AIR', 'IWK'] }, { k: 'on', l: 'Tarikh serahan', t: 'date' }, { k: 'amount', l: 'Amaun', t: 'number' }, NOTE, PROOF, { k: 'docs', l: 'Dokumen', t: 'proof' }]} />}
                {data.role !== 'oversee' && fin && <OpForm title="Sahkan deposit (bank)" op="appStep" fixed={{ id: a.id, step: 'depositConfirm' }} send={send('appStep')} fields={[{ k: 'result', l: 'Keputusan', t: 'select', o: ['CONFIRMED', 'DALAM_SEMAKAN'] }, { k: 'amount', l: 'Amaun dalam bank', t: 'number' }, { k: 'bankRef', l: 'Rujukan penyata' }, { k: 'payer', l: 'Pembayar', t: 'select', o: ['TENANT', 'ZAKAT', 'COMPANY', 'OTHER'] }, { k: 'payerName', l: 'Nama pembayar' }, NOTE]} />}
                {data.role === 'oversee' && <OpForm title="Persetujuan Pengerusi / Naib Pengerusi" op="appStep" fixed={{ id: a.id, step: 'consent' }} send={send('appStep', (i) => ({ ...i, consent: i.decision !== 'reject' }))} fields={[{ k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'reject'] }, NOTE]} />}
                {team && a.status === 'LULUS' && <OpForm title="Serah kunci" op="keys" fixed={{ id: a.id }} send={send('keys', (i) => ({ ...i, keys: pairs(i.keys) }))} fields={[{ k: 'keys', l: 'Kunci (item:bilangan, ...)' }, { k: 'photos', l: 'Foto serahan', t: 'photos' }, { k: 'tenantAck', l: 'Akuan penyewa', t: 'proof' }, { k: 'override', l: 'Pengarah Aset: sebab teruskan tanpa syarat' }]} />}
              </div>
            </div>
          ))}
        </>
      )}
      {tab === 'agree' && (
        <>
          {team && <OpForm title="Buka perjanjian (selepas deposit penuh)" op="agreementOpen" send={send('agreementOpen')} fields={[{ k: 'appId', l: 'Permohonan', t: 'select', o: data.applications.filter((a) => a.d.depositFull).map((a) => a.id) }]} />}
          {data.agreements.map((g) => (
            <div key={g.id} className="panel">
              <strong>{g.unitCode} {g.ref}</strong> <Chip tone={g.deadline && g.deadline <= new Date().toISOString().slice(0, 10) ? 'crit' : 'info'}>{bm(g.status)}</Chip> <span className="small">{g.deadline ? `tarikh akhir setem ${dateLabel(g.deadline)}` : ''} · sewa RM{g.d.fields?.rent} · v{(g.d.versions ?? []).length}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {team && <OpForm title="Langkah perjanjian" op="agreementStep" fixed={{ id: g.id }} send={send('agreementStep', (i) => ({ ...i, approve: i.decision !== 'reject', sheet: Object.fromEntries(['state', 'date', 'landlord', 'tenant', 'copies', 'description', 'rent', 'address', 'type', 'file'].map((k) => [k, i.sheetChecked === true])), checks: Object.fromEntries(['names', 'premises', 'date', 'amount', 'readable'].map((k) => [k, i.certChecked === true])) }))} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['change', 'changeDecide', 'check', 'send', 'comment', 'final', 'sign', 'edsSubmit', 'stampNotice', 'stampTenantProof', 'stampCert', 'lhdnIssue', 'handover', 'file'] }, { k: 'field', l: 'Medan (pindaan)' }, { k: 'value', l: 'Nilai baharu' }, { k: 'n', l: 'No. pindaan', t: 'number' }, { k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'reject'] }, { k: 'party', l: 'Pihak', t: 'select', o: ['TENANT', 'OWNER'] }, { k: 'signer', l: 'Penandatangan' }, { k: 'witness', l: 'Saksi' }, { k: 'sheetChecked', l: 'Setiap baris lembaran LHDN disemak', t: 'check' }, { k: 'submittedOn', l: 'Tarikh hantar e-DS', t: 'date' }, { k: 'lhdnRef', l: 'Rujukan LHDN' }, { k: 'assessedDuty', l: 'Duti ditaksir LHDN', t: 'number' }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'certChecked', l: 'Sijil disemak (nama, premis, tarikh, amaun, jelas)', t: 'check' }, { k: 'certRef', l: 'No. sijil' }, { k: 'where', l: 'Lokasi fail asal' }, NOTE, PROOF]} />}
                {data.role === 'oversee' && <OpForm title="Persetujuan pindaan sewa / deposit / tempoh" op="agreementStep" fixed={{ id: g.id, step: 'changeConsent' }} send={send('agreementStep', (i) => ({ ...i, consent: i.decision !== 'reject' }))} fields={[{ k: 'n', l: 'No. pindaan', t: 'number' }, { k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'reject'] }, NOTE]} />}
                {fin && <OpForm title="Kewangan: duti setem" op="agreementStep" fixed={{ id: g.id }} send={send('agreementStep')} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['stampConfirm', 'stampPay'] }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'bankRef', l: 'Rujukan bank' }, { k: 'method', l: 'Kaedah', t: 'select', o: ['FPX_BYRHASIL', 'VIRTUAL_ACCOUNT', 'CORPORATE_BANKING'] }, PROOF]} />}
              </div>
            </div>
          ))}
        </>
      )}
      {tab === 'rent' && (
        <>
          {data.invoiceMissing.length > 0 && <p className="small"><Chip tone={data.invoiceMissing.some((x) => x.late) ? 'crit' : 'warn'}>Invois</Chip> Tiada invois {data.invoiceMissing[0].period}: {data.invoiceMissing.map((x) => x.unit).join(', ')}</p>}
          {fin && <OpForm title="Rekod invois SQL Account" op="invoice" send={send('invoice')} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.filter((u) => u.tenant).map((u) => u.id) }, { k: 'period', l: 'Bulan (YYYY-MM)' }, { k: 'invoiceNo', l: 'No. invois' }, { k: 'invoiceOn', l: 'Tarikh invois', t: 'date' }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'differenceNote', l: 'Sebab beza (jika ada)' }]} />}
          {fin && <OpForm title="Baris bank tidak dikenal pasti" op="bankLine" send={send('bankLine')} fields={[{ k: 'ownerEntity', l: 'Syarikat pemilik' }, { k: 'on', l: 'Tarikh', t: 'date' }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'ref', l: 'Rujukan' }]} />}
          {team && <OpForm title="Kelulusan zakat" op="zakat" send={send('zakat', (i) => ({ ...i, release: i.release === true }))} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.filter((u) => u.tenant).map((u) => u.id) }, { k: 'body', l: 'Badan zakat' }, { k: 'letterRef', l: 'Rujukan surat' }, { k: 'monthly', l: 'Amaun sebulan', t: 'number' }, { k: 'from', l: 'Dari', t: 'date' }, { k: 'to', l: 'Hingga', t: 'date' }, { k: 'refPattern', l: 'Corak rujukan (PA...)' }, { k: 'release', l: 'Ini surat pelepasan kepada penyewa', t: 'check' }, { k: 'id', l: 'Rekod zakat (untuk pelepasan)' }, { k: 'ref', l: 'Rujukan pelepasan' }, PROOF]} />}
          <table className="table"><thead><tr><th>Unit</th><th>Bulan</th><th>Invois</th><th>Zakat / penyewa</th><th>Status</th><th>Baki penyewa</th><th></th></tr></thead><tbody>
            {data.collections.map((c) => (
              <tr key={c.id}>
                <td>{c.unitCode}</td><td>{c.d.period}</td><td>{c.d.invoiceNo} RM{c.d.amount}</td><td>{c.d.zakatPart} / {c.d.tenantPart}</td><td>{bm(c.status)}</td><td>{c.owes.owes ? `RM${c.owes.owes}${c.owes.shortfall ? ` (zakat kurang RM${c.owes.shortfall})` : ''}` : '-'}</td>
                <td>
                  {team && <OpForm title="Langkah" op="collectionStep" fixed={{ id: c.id }} send={send('collectionStep')} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['sent', 'proof', 'semakanContact', 'close', 'zakatTold'] }, { k: 'channel', l: 'Saluran', t: 'select', o: ['WHATSAPP', 'EMAIL'] }, { k: 'method', l: 'Cara bayar', t: 'select', o: ['TRANSFER', 'FPX', 'CDM', 'CHEQUE'] }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'on', l: 'Tarikh bayar', t: 'date' }, { k: 'ref', l: 'Rujukan' }, { k: 'chequeNo', l: 'No. cek' }, { k: 'chequeBank', l: 'Bank cek' }, { k: 'payer', l: 'Pembayar', t: 'select', o: ['TENANT', 'ZAKAT'] }, { k: 'answer', l: 'Jawapan penyewa' }, PROOF]} />}
                  {fin && <OpForm title="Kewangan" op="collectionStep" fixed={{ id: c.id }} send={send('collectionStep', (i) => ({ ...i, cleared: i.cleared === true }))} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['confirm', 'bounce', 'receipt'] }, { k: 'result', l: 'Keputusan', t: 'select', o: ['CONFIRMED', 'DALAM_SEMAKAN'] }, { k: 'n', l: 'No. bukti / pengesahan', t: 'number' }, { k: 'amount', l: 'Amaun dalam bank', t: 'number' }, { k: 'on', l: 'Tarikh dalam bank', t: 'date' }, { k: 'bankRef', l: 'Rujukan penyata' }, { k: 'payer', l: 'Pembayar', t: 'select', o: ['TENANT', 'ZAKAT'] }, { k: 'cleared', l: 'Cek telah dijelaskan', t: 'check' }, NOTE]} />}
                </td>
              </tr>
            ))}
          </tbody></table>
          {data.bankLines.length > 0 && (
            <ul className="small">{data.bankLines.map((b) => <li key={b.id}>{b.d.on} RM{b.d.amount} {b.d.ref} <Chip tone="info">{b.status}</Chip>
              {team && b.status === 'UNMATCHED' && <OpForm title="Padankan" op="bankLineStep" fixed={{ id: b.id, step: 'match' }} send={send('bankLineStep')} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.filter((u) => u.tenant).map((u) => u.id) }, { k: 'period', l: 'Bulan' }, { k: 'payer', l: 'Pembayar', t: 'select', o: ['TENANT', 'ZAKAT'] }, { k: 'how', l: 'Cara dikenal pasti' }]} />}
              {fin && b.status === 'PROPOSED' && <button className="btn btn-sm" onClick={() => act.run(() => api.amRentalAct('bankLineStep', { id: b.id, step: 'confirm' }), 'Disahkan.')}>Sahkan padanan</button>}
            </li>)}</ul>
          )}
          {data.zakatList.length > 0 && <table className="table"><thead><tr><th>Bayaran zakat</th><th>Badan</th><th>Lulus</th><th>Diterima</th><th>Kurang</th><th>Hingga</th></tr></thead><tbody>{data.zakatList.map((z, k) => <tr key={k}><td>{z.unit}</td><td>{z.body}</td><td>{z.approved}</td><td>{z.received}</td><td>{z.short}</td><td>{z.to}</td></tr>)}</tbody></table>}
          {(team || fin) && <button className="btn btn-sm" onClick={() => act.run(async () => { const r = (await api.amRentalAct('export', {})) as { name: string; csv: string }; await saveFile(r.name, `data:text/csv;base64,${btoa(unescape(encodeURIComponent(r.csv)))}`); return r; }, 'Dieksport.')}>Eksport Excel (CSV) bulan ini</button>}
        </>
      )}
      {tab === 'arrears' && (
        <>
          {data.arrearsDue.map((x) => (
            <div key={x.unitId} className="small"><Chip tone="crit">3 bulan</Chip> {x.unit}: {x.months} bulan, RM{x.owes} {team && <button className="btn btn-sm" onClick={() => act.run(() => api.amRentalAct('arrearsOpen', { unitId: x.unitId }), 'Kes dibuka.')}>Buka kes</button>}</div>
          ))}
          {data.arrears.map((a) => (
            <div key={a.id} className="panel">
              <strong>{a.unitCode} {a.ref}</strong> <Chip tone="warn">{a.status}</Chip> <span className="small">{a.d.financeAmount ? `RM${a.d.financeAmount.amount} (Kewangan)` : 'menunggu Kewangan'} {a.d.payBy ? `· bayar sebelum ${a.d.payBy}` : ''} {a.d.notice?.deadline ? `· kosongkan sebelum ${a.d.notice.deadline}` : ''}</span>
              {a.status === 'REFERRED' && <p className="small">Peringatan undang-undang: mengambil semula milikan perlu perintah mahkamah (Akta Relief Spesifik 1950 s.7(2), s.8). Kunci tukar hanya selepas pengesahan bertulis peguam syarikat.</p>}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {(team || fin) && <OpForm title="Langkah tunggakan" op="arrearsStep" fixed={{ id: a.id }} send={send('arrearsStep', (i) => ({ ...i, present: list(i.present), vacated: i.vacated === 'yes', stay: i.stay === 'yes', pendingSettled: i.pendingSettled === true, noOpenIssue: i.noOpenIssue === true }))} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['confirm', 'contact', 'paid', 'hold', 'notice', 'noticeApprove', 'noticeDeliver', 'log', 'day14', 'continue', 'decide', 'lawyerConfirm', 'lockout', 'referIssue', 'close'] }, { k: 'amount', l: 'Amaun (Kewangan)', t: 'number' }, { k: 'pendingSettled', l: 'Bayaran dalam semakan telah diselesaikan', t: 'check' }, { k: 'method', l: 'Saluran', t: 'select', o: ['CALL', 'WHATSAPP', 'EMAIL'] }, { k: 'reply', l: 'Jawapan' }, { k: 'promiseOn', l: 'Janji bayar', t: 'date' }, { k: 'officerId', l: 'Pegawai diberi kuasa', t: 'select', o: data.settings.officers }, { k: 'letterOn', l: 'Tarikh surat', t: 'date' }, { k: 'vacated', l: 'Dikosongkan?', t: 'yn' }, { k: 'stay', l: 'Penyewaan diteruskan?', t: 'yn' }, { k: 'route', l: 'Tindakan', t: 'select', o: ['LAWYER', 'PLAN', 'LOCKOUT'] }, { k: 'ref', l: 'Rujukan surat peguam' }, { k: 'present', l: 'Staf hadir' }, { k: 'belongings', l: 'Barang penyewa' }, { k: 'keptAt', l: 'Disimpan di' }, { k: 'noOpenIssue', l: 'Tiada isu terbuka', t: 'check' }, NOTE, PROOF, { k: 'photos', l: 'Foto', t: 'photos' }]} />}
              </div>
            </div>
          ))}
        </>
      )}
      {tab === 'out' && (
        <>
          {team && <OpForm title="Notis keluar" op="moveoutOpen" send={send('moveoutOpen')} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.filter((u) => u.tenant).map((u) => u.id) }, { k: 'receivedOn', l: 'Notis diterima', t: 'date' }, { k: 'proposedOn', l: 'Tarikh keluar', t: 'date' }, { k: 'shortReason', l: 'Sebab notis pendek' }, { k: 'arrearsId', l: 'Kes tunggakan (jika selepas notis)' }, PROOF]} />}
          {team && <OpForm title="Deposit lama (sekali)" op="oldDeposit" send={send('oldDeposit')} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.map((u) => u.id) }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'paidOn', l: 'Dibayar pada', t: 'date' }, { k: 'propertyKind', l: 'Jenis harta', t: 'select', o: ['HOUSE', 'LAND', 'BUILDING', 'OFFICE', 'SHOP'] }, { k: 'id', l: 'Semakan kedua: rekod' }, PROOF]} />}
          {data.depositHeld.length > 0 && <p className="small">Deposit dipegang: {data.depositHeld.map((x) => `${x.kind} RM${x.total}`).join('; ')}</p>}
          {data.moveouts.map((m) => (
            <div key={m.id} className="panel">
              <strong>{m.unitCode} {m.ref}</strong> <Chip tone="info">{m.status}</Chip> <span className="small">{m.d.keys ? `periksa sebelum ${m.d.keys.inspectBy}` : ''} {m.d.statement ? `· pulangan RM${m.d.statement.refund}${m.d.statement.owed ? `, terhutang RM${m.d.statement.owed}` : ''}` : ''}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {(team || fin) && <OpForm title="Langkah keluar" op="moveoutStep" fixed={{ id: m.id }} send={send('moveoutStep', (i) => ({ ...i, items: pairs(i.items), rooms: list(i.rooms).map((room) => ({ room, photos: i.photos })), checks: Object.fromEntries(['walls_ceiling', 'floor', 'doors_windows', 'pipes_sanitary', 'lights_switches', 'cabinets_furniture', 'cleanliness'].map((k) => [k, String(i.checklist ?? 'ok')])), accounts: list(i.accounts).map((a) => { const [account, status, amount] = a.split(':'); return { account, status, amount: Number(amount || 0), estimate: Number(amount || 0), followUpOn: i.followUpOn }; }), refundUndisputed: i.refundUndisputed === true }))} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['date', 'keys', 'inspect', 'utilities', 'statement', 'statementSent', 'dispute', 'refer', 'close', 'figures', 'statementCheck', 'refund', 'heldSettle', 'statementApprove', 'disputeDecide'] }, { k: 'on', l: 'Tarikh', t: 'date' }, { k: 'time', l: 'Masa (HH:MM)' }, { k: 'at', l: 'Masa serahan kunci (YYYY-MM-DDTHH:MM)' }, { k: 'items', l: 'Kunci diterima (item:bilangan)' }, { k: 'tenantSign', l: 'Tandatangan penyewa (Borang Serahan Kunci)', t: 'proof' }, { k: 'rooms', l: 'Bilik' }, { k: 'checklist', l: 'Senarai semak (ringkas)' }, { k: 'accounts', l: 'Akaun (TNB:PAID, AIR:OWED:50, IWK:BILL_PENDING:30)' }, { k: 'followUpOn', l: 'Susulan bil', t: 'date' }, { k: 'unpaidRent', l: 'Sewa tertunggak (Kewangan)', t: 'number' }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'method', l: 'Kaedah', t: 'select', o: ['TRANSFER'] }, { k: 'payee', l: 'Penerima', t: 'select', o: ['TENANT', 'ZAKAT'] }, { k: 'ref', l: 'Rujukan' }, { k: 'account', l: 'Akaun bil tertangguh' }, NOTE, { k: 'photos', l: 'Foto', t: 'photos' }, PROOF]} />}
              </div>
            </div>
          ))}
        </>
      )}
      {tab === 'repair' && (
        <>
          {team && <OpForm title="Laporan kerosakan" op="repairReport" send={send('repairReport', (i) => ({ ...i, sharedArea: i.sharedArea === true, photosAsked: i.photosAsked === true }))} fields={[{ k: 'unitId', l: 'Unit', t: 'select', o: data.units.filter((u) => u.tenant).map((u) => u.id) }, { k: 'tenantLevel', l: 'Tahap (penyewa)', t: 'select', o: ['MINOR', 'MEDIUM', 'CRITICAL'] }, { k: 'level', l: 'Tahap (pasukan)', t: 'select', o: ['MINOR', 'MEDIUM', 'CRITICAL'] }, { k: 'levelReason', l: 'Sebab tukar tahap' }, { k: 'location', l: 'Lokasi dalam rumah' }, { k: 'description', l: 'Penerangan ringkas' }, { k: 'noticedOn', l: 'Mula disedari', t: 'date' }, { k: 'accessTime', l: 'Masa akses dipersetujui' }, { k: 'sharedArea', l: 'Kawasan bersama (JMB)', t: 'check' }, { k: 'photosAsked', l: 'Foto diminta daripada penyewa', t: 'check' }, { k: 'photos', l: 'Foto / video', t: 'photos' }]} />}
          {team && <OpForm title="Kontraktor panel" op="panel" send={send('panel', (i) => ({ ...i, quotes: list(i.quotes), rates: pairs(i.rates).map((r) => ({ item: r.item, rate: r.count })) }))} fields={[{ k: 'trade', l: 'Bidang', t: 'select', o: ['PLUMBING', 'ELECTRICAL', 'AIRCOND', 'GENERAL'] }, { k: 'contractor', l: 'Kontraktor' }, { k: 'quotes', l: '3 sebut harga (nama, ...)' }, { k: 'rates', l: 'Senarai kadar (item:RM, ...)' }, PROOF]} />}
          {data.repairs.map((r) => (
            <div key={r.id} className="panel">
              <strong>{r.unitCode} {r.ref}</strong> <Chip tone={r.d.level === 'CRITICAL' ? 'crit' : 'info'}>{r.d.level}</Chip> <Chip tone="info">{r.status}</Chip> <span className="small">{r.d.location}: {r.d.description} {r.d.decision ? `· ${r.d.decision.outcome}` : ''} {r.d.cost != null ? `· RM${r.d.cost}` : ''}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {(team || fin || data.role === 'oversee') && <OpForm title="Langkah pembaikan" op="repairStep" fixed={{ id: r.id }} send={send('repairStep', (i) => ({ ...i, approve: i.decision !== 'reject', answers: Object.fromEntries(['atHandover', 'wornByAge', 'misuse', 'routineServicing', 'noticedVsReported', 'lateMadeWorse', 'agreementSays'].map((q) => [q, i[q]])), quotes: list(i.quotes).map((q) => { const [contractor, price, warrantyMonths] = q.split(':'); return { contractor, price: Number(price || 0), warrantyMonths: Number(warrantyMonths || 0) }; }), scopeOk: i.scopeOk === true, upheld: i.upheld === 'yes', done: i.done === true }))} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['inspect', 'contractorFinding', 'decide', 'quotes', 'approve', 'consent', 'decisionSent', 'emergency', 'work', 'change', 'complete', 'tenantFix', 'objection', 'objectionReply', 'told', 'waterRefund', 'waterApprove', 'jmb', 'return', 'resume', 'close', 'pay', 'charge', 'chargePaid'] },
                  { k: 'atHandover', l: '1 Ada semasa serahan?' }, { k: 'wornByAge', l: '2 Haus kerana usia?' }, { k: 'misuse', l: '3 Salah guna / cuai?' }, { k: 'routineServicing', l: '4 Servis rutin dibuat?' }, { k: 'noticedVsReported', l: '5 Bila disedari / dilapor?' }, { k: 'lateMadeWorse', l: '6 Lewat lapor memburukkan?' }, { k: 'agreementSays', l: '8 Perjanjian kata?' }, { k: 'finding', l: 'Dapatan bertulis' },
                  { k: 'outcome', l: 'Siapa bayar', t: 'select', o: ['OWNER', 'TENANT', 'UNCLEAR'] }, { k: 'quotes', l: 'Sebut harga (kontraktor:RM:waranti bulan, ...)' }, { k: 'chosen', l: 'Dipilih (0, 1, 2)', t: 'number' }, { k: 'fewerReason', l: 'Kurang 3 sebut harga', t: 'select', o: ['EMERGENCY', 'SPECIALIST', 'PANEL', 'NO_OTHER_SUPPLIER', 'OTHER_SPECIAL'] },
                  { k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'reject'] }, { k: 'instructedBy', l: 'Arahan oleh (kecemasan)' }, { k: 'on', l: 'Tarikh pembaikan', t: 'date' }, { k: 'contractor', l: 'Kontraktor' }, { k: 'cause', l: 'Punca (kontraktor)' }, { k: 'fee', l: 'Yuran pemeriksaan', t: 'number' }, { k: 'cost', l: 'Kos baharu', t: 'number' }, { k: 'scopeOk', l: 'Ikut skop diluluskan', t: 'check' }, { k: 'test', l: 'Ujian (cth. aircond sejuk)' }, { k: 'upheld', l: 'Bantahan diterima?', t: 'yn' }, { k: 'done', l: 'Penyewa dimaklumkan kerja siap', t: 'check' },
                  { k: 'foundOn', l: 'Bocor dijumpai', t: 'date' }, { k: 'repairedOn', l: 'Dibaiki', t: 'date' }, { k: 'avgBefore', l: 'Purata bil 3 bulan sebelum', t: 'number' }, { k: 'invoiceNo', l: 'No. invois SQL Account' }, { k: 'ref', l: 'Rujukan' }, NOTE, { k: 'photos', l: 'Foto', t: 'photos' }, { k: 'after', l: 'Foto selepas', t: 'photos' }, { k: 'report', l: 'Laporan siap', t: 'proof' }, { k: 'invoice', l: 'Invois kontraktor', t: 'proof' }, PROOF]} />}
              </div>
            </div>
          ))}
        </>
      )}
      {tab === 'setup' && (
        <>
          {data.role === 'director' && <OpForm title="Syarikat pemilik" op="owner" send={send('owner', (i) => ({ ...i, edsRole: i.edsRole === 'yes', eSignAllowed: i.eSignAllowed === 'yes', edsStaffIds: list(i.edsStaffIds), signatories: list(i.signatories).map((x) => { const [name, kind, authorityRef, authorityOn] = x.split(':'); return { name, kind: kind || 'DIRECTOR', authorityRef, authorityOn }; }) }))} fields={[{ k: 'ownerEntity', l: 'Syarikat pemilik (seperti pada unit)' }, { k: 'companyNo', l: 'No. syarikat' }, { k: 'address', l: 'Alamat' }, { k: 'bankName', l: 'Bank' }, { k: 'bankAccount', l: 'No. akaun' }, { k: 'edsRole', l: 'Peranan e-Duti Setem syarikat ada?', t: 'yn' }, { k: 'edsStaffIds', l: 'Staf dibenarkan guna e-DS (id)' }, { k: 'eSignAllowed', l: 'E-tandatangan dibenarkan?', t: 'yn' }, { k: 'eSignLawyerRef', l: 'Rujukan pengesahan peguam (e-tandatangan)' }, { k: 'signatories', l: 'Penandatangan (nama:DIRECTOR atau nama:ASSET_DIRECTOR:rujukan kuasa:YYYY-MM-DD)' }, { k: 'reason', l: 'Sebab' }]} />}
          {data.role === 'director' && <OpForm title="Templat (perjanjian, notis)" op="setSettings" send={send('setSettings')} fields={[{ k: 'template', l: 'Templat', t: 'select', o: ['agreement', 'notice', 'decision', 'stampNotice'] }, { k: 'file', l: 'Fail templat', t: 'proof' }, { k: 'reason', l: 'Sebab versi baharu' }]} />}
          {data.role === 'director' && <OpForm title="Pegawai diberi kuasa (notis)" op="setSettings" send={send('setSettings', (i) => ({ ...i, officers: list(i.officers) }))} fields={[{ k: 'officers', l: 'Id pegawai' }, { k: 'reason', l: 'Sebab' }]} />}
          <ul className="small">
            {data.owners.map((o) => <li key={o.id}>{o.d.ownerEntity}: {o.d.bankName} {o.d.bankAccount} · e-DS {o.d.edsRole ? 'ada' : 'tiada'} · {(o.d.signatories ?? []).length} penandatangan</li>)}
            {Object.entries(data.settings.templates).map(([k, l]) => <li key={k}>Templat {k}: v{l.at(-1)?.v} ({l.at(-1)?.note})</li>)}
          </ul>
          <h4>Kertas dasar (dalam Prima dari 18 Nov 2026)</h4>
          <ul className="small">{data.papers.map((p) => <li key={p.code}>{p.code}: {p.title} (berkuat kuasa {dateLabel(p.inForce)})</li>)}</ul>
          <p className="small muted">Prima merekod; ia tidak memindahkan wang, log masuk ke e-Duti Setem atau menghantar mesej sendiri. Wang disahkan hanya oleh Kewangan daripada bank.</p>
        </>
      )}
    </div>
  );
}
