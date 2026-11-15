import { api } from '../api';
import { Chip, Loading, useLoad } from '../ui';
import { OpForm, type Field } from './ItPolicyPanel';

/**
 * "Pejabat" (Part S, the maintenance unit's circular and policies, in force 18 Nov 2026): office repairs and JMB
 * reports, office inventory, office asset disposal, building purchase records, office rent and periodic visits.
 * Two faces: the Asset Management section for the unit, the Asset Director, Finance and leaders, and the staff form
 * under Claims and requests. Every rule is checked again on the server; this screen only offers the steps.
 */

type Rec = { id: string; kind: string; ref: string; status: string; at: string; by: string; companyId: string | null; unitId?: string | null; itemId?: string | null; requesterId?: string | null; d: Record<string, unknown> };
type Board = {
  role: 'unit' | 'director' | 'finance' | 'leader' | 'hr' | 'office_head' | 'staff';
  inForce: string;
  docs: readonly { code: string; title: string }[];
  steps: readonly { bm: string; en: string }[];
  examples: Record<'MINOR' | 'MEDIUM' | 'CRITICAL', readonly string[]>;
  visitLines: string[];
  canSend: boolean;
  records: Rec[];
  mine: Rec[];
  alerts: { id: string; ref: string; kind: string; late: string }[];
  missing: Record<string, string[]>;
  policyReviewOn: string;
};

const KIND_BM: Record<string, string> = {
  repair: 'Penyelenggaraan pejabat',
  jmb: 'Laporan JMB',
  invItem: 'Inventori pejabat',
  invUpdate: 'Kemaskini inventori',
  disposal: 'Pelupusan aset pejabat',
  buildingBuy: 'Pembelian bangunan',
  bldConfirm: 'Pengesahan rekod bangunan',
  mgmtAgreement: 'Perjanjian pengurusan',
  officeTenancy: 'Sewaan pejabat',
  rentMonth: 'Rekod sewa pejabat',
  visitPlan: 'Jadual lawatan berkala',
  visit: 'Lawatan berkala',
};
const ITEM_KEYS = ['name', 'location', 'serial', 'brandModel', 'quantity', 'condition', 'boughtOn', 'responsible', 'price'];
const send = (input: Record<string, unknown>) => {
  // "checks.x" becomes one checks object and "group.x" a nested object; the op travels in the address.
  const { op, ...rest } = input;
  const out: Record<string, unknown> = {};
  const checks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith('checks.')) checks[k.slice(7)] = v === true;
    else if (k.includes('.')) {
      const [g, x] = k.split('.');
      if (v !== '' && v !== undefined) out[g] = { ...((out[g] as object) ?? {}), [x]: v };
    } else out[k] = v;
  }
  if (Object.keys(checks).length) out.checks = checks;
  if (op === 'repairQuotes') {
    out.quotes = [1, 2, 3].filter((n) => out[`q${n}`]).map((n) => ({ contractor: out[`q${n}`], price: out[`p${n}`] }));
    for (const n of [1, 2, 3]) delete out[`q${n}`], delete out[`p${n}`];
  }
  if (op === 'invSubmit') {
    const line = Object.fromEntries(ITEM_KEYS.filter((k) => out[k] !== undefined && out[k] !== '').map((k) => [k, out[k]]));
    for (const k of ITEM_KEYS) delete out[k];
    out.lines = [line];
  }
  // Ticked means "not right"; unticked means fine (so an untouched box never sends a refusal).
  if ('notFixed' in out) (out.fixed = out.notFixed !== true), delete out.notFixed;
  if ('wrong' in out) (out.ok = out.wrong !== true), delete out.wrong;
  if ('notRight' in out) (out.ok = out.notRight !== true), delete out.notRight;
  return api.officeAmAct(String(op), out);
};
const F = (props: { title: string; op: string; fields: Field[]; fixed?: Record<string, unknown> }) => <OpForm {...props} send={send} />;
const REASON: Field = { k: 'reason', l: 'Sebab (reason)' };
const DOCS: Field = { k: 'docs', l: 'Dokumen', t: 'proof' };
const PHOTOS: Field = { k: 'photos', l: 'Gambar', t: 'photos' };
const ON: Field = { k: 'on', l: 'Tarikh', t: 'date' };
const DAMAGE_TYPES = ['furniture', 'fitting', 'aircond', 'lights', 'wiring', 'plumbing', 'door', 'roof', 'safety_equipment', 'other', 'computer', 'laptop', 'phone', 'printer', 'network', 'it_device'] as const;
const AREAS = ['own_unit', 'lobby', 'lift', 'stairs', 'common_pipes', 'common_lights', 'fire_system', 'roof', 'car_park', 'outside'] as const;
const CRITERIA = ['damaged_not_worth_repair', 'repair_above_value', 'obsolete', 'not_used', 'unsafe', 'no_function', 'no_spare_parts'] as const;
const METHODS = ['throw_away', 'recycle', 'licensed_contractor', 'transfer', 'donation', 'sale', 'other'] as const;
const STAGES = ['documents', 'sent_bank', 'valuation', 'agreements', 'handover', 'registered'] as const;
const CHEQUE = ['payer', 'payee', 'spelling', 'amount', 'date', 'number', 'matches'] as const;

function RepairForm({ b }: { b: Board }) {
  const examples = [...b.examples.MINOR, ...b.examples.MEDIUM, ...b.examples.CRITICAL];
  return (
    <F
      title="Lapor kerosakan pejabat (report office damage)"
      op="repairRequest"
      fields={[
        { k: 'damageType', l: 'Jenis kerosakan', t: 'select', o: DAMAGE_TYPES },
        { k: 'example', l: 'Contoh (sets the level)', t: 'select', o: examples },
        { k: 'level', l: 'Tahap (raise only)', t: 'select', o: ['MINOR', 'MEDIUM', 'CRITICAL'] },
        { k: 'raiseReason', l: 'Why the level is raised' },
        { k: 'area', l: 'Kawasan', t: 'select', o: AREAS },
        { k: 'address', l: 'Pejabat / alamat' },
        { k: 'description', l: 'Butiran kerosakan', t: 'area' },
        { k: 'foundOn', l: 'Tarikh dikesan', t: 'date' },
        { k: 'suggested', l: 'Cadangan tindakan' },
        { k: 'contact', l: 'No. telefon' },
        { k: 'earlierRef', l: 'Rujukan permohonan terdahulu' },
        PHOTOS,
      ]}
    />
  );
}

function RecordActions({ r, b }: { r: Rec; b: Board }) {
  const id = { id: r.id };
  const unit = b.role === 'unit';
  const ad = b.role === 'director';
  const fin = b.role === 'finance';
  const lead = b.role === 'leader';
  switch (r.kind) {
    case 'repair':
      return (
        <>
          {unit && r.status === 'submitted' && <F title="Semak" op="repairCheck" fixed={id} fields={[{ k: 'outcome', l: 'Keputusan', t: 'select', o: ['accept', 'return', 'minor'] }, { k: 'unitId', l: 'Building id (link)' }, REASON]} />}
          {unit && (r.status === 'checked' || r.status === 'visit_set') && <F title="Lawatan tapak" op="repairVisit" fixed={id} fields={[ON, { k: 'contractor', l: 'Kontraktor dijemput' }, { k: 'found', l: 'Penemuan' }, { k: 'cause', l: 'Punca' }, DOCS]} />}
          {unit && ['visited', 'quoted', 'turned_down', 'checked'].includes(r.status) && <F title="Sebut harga (3)" op="repairQuotes" fixed={id} fields={[{ k: 'q1', l: 'Contractor 1' }, { k: 'p1', l: 'Price 1', t: 'number' }, { k: 'q2', l: 'Contractor 2' }, { k: 'p2', l: 'Price 2', t: 'number' }, { k: 'q3', l: 'Contractor 3' }, { k: 'p3', l: 'Price 3', t: 'number' }, DOCS]} />}
          {(unit || ad) && r.status === 'quoted' && <F title="Pilih sebut harga" op="repairPick" fixed={id} fields={[{ k: 'contractor', l: 'Kontraktor' }, REASON]} />}
          {(ad || lead) && r.status === 'for_approval' && <F title="Lulus / tolak" op="repairApprove" fixed={id} fields={[{ k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'turn_down'] }, REASON]} />}
          {ad && r.d.level === 'CRITICAL' && !r.d.makeSafe && <F title="Kerja selamat segera" op="repairEmergency" fixed={id} fields={[{ k: 'contractor', l: 'Kontraktor' }, { k: 'price', l: 'Harga', t: 'number' }, REASON]} />}
          {unit && r.status === 'approved' && <F title="Mula kerja" op="repairStart" fixed={id} fields={[]} />}
          {unit && ['in_progress', 'approved'].includes(r.status) && <F title="Tarikh baharu" op="repairDue" fixed={id} fields={[ON, REASON]} />}
          {unit && r.status === 'in_progress' && <F title="Kerja siap" op="repairDone" fixed={id} fields={[ON, PHOTOS]} />}
          {ad && r.status === 'work_done' && <F title="Sahkan bagi pemohon (hari 5)" op="repairConfirm" fixed={id} fields={[REASON]} />}
          {fin && r.status === 'payment_requested' && <F title="Pautkan bayaran" op="payLink" fixed={id} fields={[{ k: 'paymentId', l: 'Finance payment id' }]} />}
          {(fin || unit) && r.status === 'payment_requested' && <F title="Resit bayaran" op="payReceipt" fixed={id} fields={[]} />}
          {unit && <F title="Resit (Teams/emel)" op="receiptAttach" fixed={id} fields={[{ k: 'via', l: 'Via', t: 'select', o: ['teams', 'email'] }, { k: 'amount', l: 'Amaun', t: 'number' }, { k: 'ref', l: 'Rujukan' }, DOCS]} />}
          {unit && ['paid', 'confirmed', 'payment_requested'].includes(r.status) && <F title="Laporan pembaikan" op="repairReport" fixed={id} fields={[{ k: 'what', l: 'Kerja dibuat' }, { k: 'parts', l: 'Alat ganti' }, { k: 'cost', l: 'Kos', t: 'number' }, { k: 'warrantyEnd', l: 'Waranti tamat', t: 'date' }]} />}
          {unit && r.status === 'paid' && <F title="Tutup rekod" op="repairClose" fixed={id} fields={[REASON]} />}
          {b.missing[r.id]?.length ? <span className="small muted"> Missing: {b.missing[r.id].join(', ')}</span> : null}
        </>
      );
    case 'jmb':
      return unit ? <F title="Langkah JMB" op="jmbStep" fixed={id} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['reported', 'followUp', 'fixed', 'toWorkOrder'] }, ON, { k: 'jmbRef', l: 'Rujukan JMB' }, { k: 'note', l: 'Catatan' }, REASON, PHOTOS]} /> : null;
    case 'invUpdate':
      return (
        <>
          {unit && r.status === 'submitted' && <F title="Semak kemaskini" op="invCheck" fixed={id} fields={[{ k: 'outcome', l: 'Keputusan', t: 'select', o: ['ok', 'return'] }, { k: 'refuseLines', l: 'Refuse line numbers', t: 'list' }, REASON]} />}
          {ad && r.status === 'checked' && <F title="Sahkan" op="invConfirm" fixed={id} fields={[{ k: 'outcome', l: 'Keputusan', t: 'select', o: ['ok', 'return'] }, REASON]} />}
          {unit && r.status === 'confirmed' && <F title="Failkan" op="invFile" fixed={id} fields={[]} />}
        </>
      );
    case 'invItem':
      return (
        <>
          <F title="Lapor (pindah/rosak/hilang)" op="invReport" fixed={{ itemId: r.id }} fields={[{ k: 'what', l: 'Apa', t: 'select', o: ['moved', 'damaged', 'lost', 'not_mine'] }, { k: 'location', l: 'Lokasi baharu' }, { k: 'note', l: 'Catatan' }, PHOTOS]} />
          {r.status === 'confirmed' && <F title="Mohon pelupusan" op="dispRequest" fixed={{ itemId: r.id }} fields={[{ k: 'criteria', l: 'Kriteria', t: 'list' }, { k: 'method', l: 'Kaedah', t: 'select', o: METHODS }, REASON, { k: 'valueNow', l: 'Nilai semasa', t: 'number' }, PHOTOS, { k: 'trueTick', l: 'Maklumat ini benar', t: 'check' }]} />}
        </>
      );
    case 'disposal':
      return (
        <>
          {unit && r.status === 'submitted' && <F title="Periksa" op="dispInspect" fixed={id} fields={[{ k: 'outcome', l: 'Keputusan', t: 'select', o: ['not_fit', 'reuse', 'repair', 'fit'] }, { k: 'condition', l: 'Keadaan' }, REASON, PHOTOS]} />}
          {unit && ['collected', 'repair_proposed'].includes(r.status) && <F title="Laporan pelupusan" op="dispReport" fixed={id} fields={[{ k: 'condition', l: 'Keadaan' }, { k: 'method', l: 'Kaedah', t: 'select', o: METHODS }, { k: 'valueNow', l: 'Nilai buku', t: 'number' }, { k: 'outsideGroup', l: 'Outside the group', t: 'check' }]} />}
          {(ad || lead) && r.status === 'for_approval' && <F title="Lulus / tolak" op="dispApprove" fixed={id} fields={[{ k: 'decision', l: 'Keputusan', t: 'select', o: ['approve', 'refuse'] }, { k: 'method', l: 'Kaedah', t: 'select', o: METHODS }, REASON]} />}
          {unit && r.status === 'refused' && <F title="Pulangkan" op="dispPutBack" fixed={id} fields={[{ k: 'to', l: 'Ke', t: 'select', o: ['place', 'store'] }, PHOTOS]} />}
          {unit && r.status === 'approved' && <F title="Laksana" op="dispCarryOut" fixed={id} fields={[{ k: 'witness', l: 'Saksi' }, { k: 'contractor', l: 'Kontraktor berlesen' }, { k: 'licence', l: 'No. lesen' }, { k: 'marksRemoved', l: 'Tanda syarikat ditanggalkan', t: 'check' }, DOCS]} />}
          {fin && ['approved', 'carried_out'].includes(r.status) && <F title="Wang jualan" op="dispCarryOut" fixed={id} fields={[{ k: 'saleMoney', l: 'Amaun', t: 'number' }, { k: 'receiptNo', l: 'No. resit' }]} />}
          {unit && r.status === 'carried_out' && <F title="Tutup" op="dispClose" fixed={id} fields={[REASON]} />}
        </>
      );
    case 'buildingBuy':
      return (
        <>
          {(r.status === 'waiting_instruction' || r.status === 'waiting_new_instruction') && <F title="Lulus arahan (pemberi arahan)" op="bldApproveInstruction" fixed={id} fields={[REASON]} />}
          <F title="Peringkat" op="bldStage" fixed={id} fields={[{ k: 'stage', l: 'Peringkat', t: 'select', o: STAGES }, ON, { k: 'note', l: 'Catatan' }, DOCS]} />
          <F title="Log bank" op="bldBankLog" fixed={id} fields={[{ k: 'how', l: 'Cara', t: 'select', o: ['call', 'email', 'meeting', 'letter'] }, { k: 'officer', l: 'Pegawai (nama dan jawatan)' }, { k: 'what', l: 'Butiran' }, { k: 'next', l: 'Langkah seterusnya' }, DOCS]} />
          <F title="Keputusan bank" op="bldDecision" fixed={id} fields={[{ k: 'approved', l: 'Approved', t: 'check' }, { k: 'bank', l: 'Bank' }, { k: 'loanAmount', l: 'Pinjaman', t: 'number' }, { k: 'monthly', l: 'Bulanan', t: 'number' }, { k: 'tenureMonths', l: 'Tempoh (bulan)', t: 'number' }, { k: 'costs', l: 'Kos lain', t: 'number' }, REASON, DOCS]} />
          {fin && <F title="Jurang dibiayai" op="bldGap" fixed={id} fields={[{ k: 'source', l: 'Sumber wang' }, { k: 'paymentRef', l: 'Rujukan' }]} />}
          {fin && <F title="Wang pendahuluan" op="bldDownPayment" fixed={id} fields={[{ k: 'bankRef', l: 'Rujukan bank' }, ON, { k: 'firstOn', l: 'Bayaran pertama', t: 'date' }, { k: 'lastOn', l: 'Bayaran akhir', t: 'date' }]} />}
          {fin && <F title="Pautkan pinjaman" op="bldLoanLink" fixed={id} fields={[{ k: 'regularId', l: 'Regular payment id' }]} />}
          {(ad || lead) && <F title="Arahan baharu" op="bldGap" fixed={{ ...id, newInstruction: true }} fields={[{ k: 'givenBy', l: 'Oleh', t: 'select', o: ['ceo', 'chairman', 'vice_chairman'] }, { k: 'what', l: 'Arahan' }, DOCS]} />}
          {r.status === 'approved' || r.status === 'instructed' ? <F title="Borang pembelian" op="bldForm" fixed={id} fields={[{ k: 'use', l: 'Kegunaan', t: 'select', o: ['OWN_USE', 'RENTAL'] }, { k: 'department', l: 'Jabatan' }, { k: 'paidTo', l: 'Sewa dibayar kepada (company id)' }, { k: 'spaRef', l: 'Rujukan SPA' }, { k: 'titleNo', l: 'No. hakmilik' }, { k: 'code', l: 'Kod bangunan' }, { k: 'name', l: 'Nama bangunan' }, { k: 'town', l: 'Bandar' }, { k: 'state', l: 'Negeri' }, { k: 'sizeSqft', l: 'Saiz (kps)', t: 'number' }, { k: 'spa', l: 'SPA', t: 'proof' }]} /> : null}
          {unit && r.status === 'form_submitted' && <F title="Daftar bangunan" op="bldRegister" fixed={id} fields={[{ k: 'insuranceExpiry', l: 'Insurans tamat', t: 'date' }, { k: 'assessmentDue', l: 'Cukai taksiran', t: 'date' }, { k: 'quitRentDue', l: 'Cukai tanah', t: 'date' }]} />}
        </>
      );
    case 'bldConfirm':
      return (
        <>
          {b.role === 'office_head' && ['asked', 'called'].includes(r.status) && <F title="Sahkan / betulkan" op="bldConfirmAnswer" fixed={id} fields={[{ k: 'corrections', l: 'Pembetulan (kosong = betul)', t: 'area' }]} />}
          {unit && r.status === 'asked' && <F title="Telefon HQ" op="bldConfirmCall" fixed={id} fields={[{ k: 'note', l: 'Catatan' }]} />}
          {unit && r.status === 'corrected' && <F title="Terima pembetulan" op="bldConfirmAccept" fixed={id} fields={[{ k: 'note', l: 'Apa diubah' }]} />}
        </>
      );
    case 'officeTenancy':
      return (
        <>
          <F title="Semakan penyewa" op="tenancyCheck" fixed={id} fields={[{ k: 'line', l: 'Semakan', t: 'select', o: ['ssm', 'kdnLicence', 'kdnAddress', 'pbtLicence'] }, { k: 'state', l: 'Status', t: 'select', o: ['done', 'not_needed'] }, { k: 'ref', l: 'Rujukan' }, { k: 'expiresOn', l: 'Tamat', t: 'date' }, REASON, DOCS]} />
          {r.status === 'checking' && <F title="Terma sewaan" op="tenancyTerms" fixed={id} fields={[{ k: 'rent', l: 'Sewa bulanan', t: 'number' }, { k: 'deposit', l: 'Deposit', t: 'number' }, { k: 'startOn', l: 'Mula', t: 'date' }, { k: 'endOn', l: 'Tamat', t: 'date' }, { k: 'dueDay', l: 'Hari bayar', t: 'number' }, { k: 'account', l: 'Akaun pemilik (bank, 4 digit akhir)' }]} />}
          {fin && r.status === 'active' && <F title="Invois (SQL Account)" op="rentInvoice" fixed={{ tenancyId: r.id }} fields={[{ k: 'period', l: 'Bulan (YYYY-MM)' }, { k: 'invoiceNo', l: 'No. invois SQL Account' }, { k: 'amount', l: 'Amaun', t: 'number' }]} />}
        </>
      );
    case 'rentMonth':
      return (
        <>
          {r.status === 'invoiced' && <F title="Semak invois" op="rentInvoiceCheck" fixed={id} fields={[{ k: 'wrong', l: 'Wrong: send back to Finance', t: 'check' }, REASON]} />}
          {r.status === 'checked' && <F title="Hantar invois" op="rentSent" fixed={id} fields={[ON, { k: 'to', l: 'Dihantar kepada' }, DOCS]} />}
          {['sent', 'checked', 'returned', 'bounced', 'late'].includes(r.status) && <F title="Bayaran diterima" op="rentReceived" fixed={id} fields={[{ k: 'method', l: 'Cara', t: 'select', o: ['CHEQUE', 'TRANSFER', 'CASH', 'EWALLET'] }, { k: 'amount', l: 'Amaun', t: 'number' }, ON, { k: 'chequeNo', l: 'No. cek' }, { k: 'bank', l: 'Bank' }, { k: 'chequeDate', l: 'Tarikh cek', t: 'date' }, { k: 'payee', l: 'Penerima pada cek' }, { k: 'ref', l: 'Rujukan pindahan' }, { k: 'receiptNo', l: 'No. resit rasmi (tunai)' }, { k: 'txnId', l: 'ID transaksi (e-dompet)' }, { k: 'ownerAccount', l: "Owner company's merchant account", t: 'check' }, PHOTOS]} />}
          {r.status === 'received' && <F title="Serah / terima cek" op="rentHandover" fixed={id} fields={[{ k: 'step', l: 'Langkah', t: 'select', o: ['give', 'take'] }]} />}
          {r.status === 'with_pic' && <F title="Semak cek" op="rentChequeCheck" fixed={id} fields={[...CHEQUE.map((k) => ({ k: `checks.${k}`, l: k, t: 'check' as const })), REASON, { k: 'toldHow', l: 'Penyewa dimaklumkan melalui' }]} />}
          {['cheque_ok', 'received_cash'].includes(r.status) && <F title="Bank-in" op="rentDeposit" fixed={id} fields={[ON, { k: 'slipNo', l: 'No. slip' }, { k: 'sent', l: 'Slip sent to the tenant', t: 'check' }, PHOTOS]} />}
          {fin && r.status === 'deposited' && <F title="Padan penyata (bayar)" op="rentMatch" fixed={id} fields={[{ k: 'statementRef', l: 'Baris penyata' }, { k: 'receiptNo', l: 'No. resit rasmi SQL Account' }]} />}
          {fin && ['deposited', 'paid'].includes(r.status) && <F title="Cek tak laku" op="rentBounce" fixed={id} fields={[REASON, { k: 'charges', l: 'Caj bank', t: 'number' }]} />}
        </>
      );
    case 'visitPlan':
      return ad && r.status === 'draft' ? <F title="Lulus jadual" op="visitPlanApprove" fixed={id} fields={[REASON]} /> : unit && r.status === 'active' ? <F title="Buka lawatan" op="visitOpen" fixed={{ planId: r.id }} fields={[{ k: 'gps', l: 'GPS' }, PHOTOS]} /> : null;
    case 'visit':
      return (
        <>
          {(b.role === 'office_head' || b.role === 'staff') && !r.d.rep && <F title="Sahkan akses (wakil pejabat)" op="visitAccess" fixed={id} fields={[]} />}
          {unit && r.status === 'open' && <F title="Senarai semak" op="visitRecord" fixed={id} fields={[{ k: 'line', l: 'Baris', t: 'select', o: b.visitLines }, { k: 'state', l: 'Status', t: 'select', o: ['ok', 'issue', 'na'] }, { k: 'note', l: 'Catatan' }, PHOTOS]} />}
          {unit && r.status === 'open' && <F title="Penemuan" op="visitFinding" fixed={id} fields={[{ k: 'line', l: 'Baris', t: 'select', o: b.visitLines }, { k: 'level', l: 'Tahap', t: 'select', o: ['MINOR', 'MEDIUM', 'CRITICAL'] }, { k: 'type', l: 'Jenis', t: 'select', o: ['early_damage', 'safety_risk', 'non_compliance', 'not_working', 'wearing'] }, { k: 'area', l: 'Kawasan', t: 'select', o: AREAS }, { k: 'note', l: 'Penemuan' }, { k: 'fixedOnVisit', l: 'Fixed on the visit (no cost)', t: 'check' }, { k: 'useStopped', l: 'Use stopped', t: 'check' }, PHOTOS]} />}
          <F title="Semakan susulan" op="visitFollowUp" fixed={id} fields={[{ k: 'finding', l: 'No. penemuan', t: 'number' }, { k: 'notRight', l: 'Not right', t: 'check' }, { k: 'cancel', l: 'Cancel the finding', t: 'check' }, { k: 'note', l: 'Catatan' }, REASON, PHOTOS]} />
          {unit && r.status === 'open' && <F title="Tutup lawatan" op="visitClose" fixed={id} fields={[REASON]} />}
        </>
      );
    default:
      return null;
  }
}

function RecordList({ b, recs }: { b: Board; recs: Rec[] }) {
  if (!recs.length) return <p className="muted small">Tiada rekod.</p>;
  const late = new Map(b.alerts.map((a) => [a.id, a.late]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {recs.map((r) => (
        <div key={r.id} className="panel">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>{r.ref}</strong>
            <span className="small">{KIND_BM[r.kind] ?? r.kind}</span>
            <Chip tone={r.status === 'closed' || r.status === 'paid' || r.status === 'filed' ? 'ok' : 'info'}>{r.status}</Chip>
            {r.d.level ? <Chip tone={r.d.level === 'CRITICAL' ? 'crit' : r.d.level === 'MEDIUM' ? 'warn' : 'neutral'}>{String(r.d.level)}</Chip> : null}
            {late.get(r.id) ? <Chip tone="warn">{late.get(r.id)}</Chip> : null}
            <span className="small muted">{String(r.d.place ?? r.d.name ?? r.d.address ?? r.d.tenant ?? r.d.period ?? '')}</span>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <RecordActions r={r} b={b} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Steps({ b }: { b: Board }) {
  return (
    <details className="small">
      <summary>Tatacara (7 langkah) dan dokumen yang berkuat kuasa {b.inForce}</summary>
      <ol>
        {b.steps.map((s) => (
          <li key={s.bm}>
            {s.bm}
            <br />
            <span className="muted">{s.en}</span>
          </li>
        ))}
      </ol>
      <ul>
        {b.docs.map((d) => (
          <li key={d.code}>
            {d.code}: {d.title}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The Asset Management "Pejabat" section: the unit, the Asset Director, Finance and leaders. */
export function OfficeAmPanel() {
  const { data: b, error } = useLoad(() => api.officeAmAct('board', {}) as Promise<Board>, []);
  if (error) return <p className="muted small">Office records are not available here.</p>;
  if (!b) return <Loading what="office records" />;
  const unit = b.role === 'unit';
  const ad = b.role === 'director';
  const lead = b.role === 'leader';
  const fin = b.role === 'finance';
  const by = (kinds: string[]) => b.records.filter((r) => kinds.includes(r.kind));
  return (
    <section className="panel">
      <h2>Pejabat (office repairs, inventory, disposal, buildings, rent, visits)</h2>
      <Steps b={b} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        <RepairForm b={b} />
        {(unit || ad) && <F title="Tetapan (settings)" op="setSettings" fields={[{ k: 'repair.quotesNeeded', l: 'Quotes needed', t: 'number' }, REASON]} />}
        {unit && <F title="Kemaskini inventori" op="invSubmit" fields={[{ k: 'companyId', l: 'Company' }, { k: 'name', l: 'Item' }, { k: 'location', l: 'Lokasi' }, { k: 'serial', l: 'No. siri' }, { k: 'brandModel', l: 'Jenama / model' }, { k: 'price', l: 'Harga', t: 'number' }, { k: 'boughtOn', l: 'Tarikh beli', t: 'date' }, { k: 'firstLoad', l: 'First load (by 31 Dec 2026)', t: 'check' }, DOCS]} />}
        {unit && <F title="Hak kemaskini (on/off)" op="invAccess" fields={[{ k: 'userId', l: 'User id' }, { k: 'on', l: 'On', t: 'check' }, REASON]} />}
        {(unit || ad) && <F title="Muat turun untuk SharePoint" op="spExport" fields={[{ k: 'companyId', l: 'Company (blank = all)' }]} />}
        {(ad || lead) && <F title="Arahan pembelian bangunan" op="bldInstruct" fields={[{ k: 'givenBy', l: 'Oleh', t: 'select', o: ['ceo', 'chairman', 'vice_chairman'] }, { k: 'companyId', l: 'Syarikat pembeli' }, { k: 'address', l: 'Alamat' }, { k: 'price', l: 'Harga', t: 'number' }, { k: 'seller', l: 'Penjual' }, { k: 'conditions', l: 'Syarat' }, { k: 'boardResolution', l: 'Board resolution', t: 'check' }, REASON, DOCS]} />}
        {unit && <F title="Minta pengesahan bangunan (15hb)" op="bldConfirmAsk" fields={[{ k: 'period', l: 'Bulan (YYYY-MM)' }]} />}
        {ad && <F title="Perjanjian pengurusan" op="mgmtAgreement" fields={[{ k: 'ownerCompanyId', l: 'Owner company' }, { k: 'managingCompanyId', l: 'Managing company' }, { k: 'unitIds', l: 'Building ids', t: 'list' }, { k: 'startOn', l: 'Mula', t: 'date' }, { k: 'endOn', l: 'Tamat', t: 'date' }, { k: 'feeBasis', l: 'Asas fi (entered)' }, DOCS]} />}
        {unit && <F title="Buka sewaan pejabat" op="tenancyOpen" fields={[{ k: 'unitId', l: 'Building id' }, { k: 'tenant', l: 'Syarikat penyewa' }, { k: 'tenantCompanyId', l: 'Group company (intercompany)' }, { k: 'ssm', l: 'No. SSM' }, { k: 'address', l: 'Alamat' }, { k: 'contactRole', l: 'Jawatan PIC' }, { k: 'invoiceEmail', l: 'Emel invois' }]} />}
        {unit && <F title="Jadual lawatan berkala" op="visitPlan" fields={[{ k: 'place', l: 'Tempat' }, { k: 'placeKind', l: 'Jenis', t: 'select', o: ['office', 'own_use', 'empty_unit'] }, { k: 'companyId', l: 'Company' }, { k: 'unitId', l: 'Building id' }, { k: 'everyMonths', l: 'Setiap (bulan)', t: 'number' }, { k: 'nextDue', l: 'Lawatan seterusnya', t: 'date' }, REASON]} />}
        {unit && <F title="Butiran bangunan (strata, meter)" op="unitDetails" fields={[{ k: 'unitId', l: 'Building id' }, { k: 'use', l: 'Kegunaan', t: 'select', o: ['OWN_USE', 'RENTAL'] }, { k: 'office', l: 'Office building', t: 'check' }, REASON]} />}
      </div>
      {b.alerts.length > 0 && (
        <p className="small">
          <Chip tone="warn">{b.alerts.length} lewat sasaran</Chip> {b.alerts.slice(0, 6).map((a) => `${a.ref}: ${a.late}`).join('; ')}
        </p>
      )}
      {(fin || unit || ad || lead) && (
        <>
          <h3>Penyelenggaraan dan JMB</h3>
          <RecordList b={b} recs={by(['repair', 'jmb'])} />
          <h3>Inventori dan pelupusan</h3>
          <RecordList b={b} recs={by(['invUpdate', 'invItem', 'disposal'])} />
          <h3>Pembelian bangunan</h3>
          <RecordList b={b} recs={by(['buildingBuy', 'bldConfirm', 'mgmtAgreement'])} />
          <h3>Sewa pejabat</h3>
          <RecordList b={b} recs={by(['officeTenancy', 'rentMonth'])} />
          <h3>Lawatan berkala</h3>
          <RecordList b={b} recs={by(['visitPlan', 'visit'])} />
        </>
      )}
    </section>
  );
}

/** Claims and requests: any staff member reports office damage; the office sends inventory updates and answers. */
export function OfficeRequestPanel() {
  const { data: b, error } = useLoad(() => api.officeAmAct('board', {}) as Promise<Board>, []);
  if (error || !b) return null;
  if (['unit', 'director', 'finance', 'leader'].includes(b.role)) return null;
  const office = b.records.filter((r) => r.requesterId !== undefined && !b.mine.some((m) => m.id === r.id));
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <h2>Penyelenggaraan pejabat (office repair)</h2>
      <Steps b={b} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        <RepairForm b={b} />
        {b.canSend && <F title="Kemaskini inventori pejabat" op="invSubmit" fields={[{ k: 'name', l: 'Item' }, { k: 'location', l: 'Lokasi' }, { k: 'serial', l: 'No. siri' }, { k: 'brandModel', l: 'Jenama / model' }, { k: 'quantity', l: 'Kuantiti', t: 'number' }, { k: 'condition', l: 'Keadaan', t: 'select', o: ['new', 'good', 'worn', 'damaged'] }, { k: 'boughtOn', l: 'Tarikh beli', t: 'date' }, { k: 'responsible', l: 'Pemegang' }, { k: 'firstLoad', l: 'First load (by 31 Dec 2026)', t: 'check' }, DOCS]} />}
      </div>
      <h3>Permohonan saya</h3>
      {b.mine.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {b.mine.map((r) => (
            <div key={r.id} className="panel">
              <strong>{r.ref}</strong> <span className="small">{KIND_BM[r.kind] ?? r.kind}</span> <Chip tone="info">{r.status}</Chip>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {r.kind === 'repair' && r.status === 'on_hold' && <F title="Lengkapkan" op="repairResubmit" fixed={{ id: r.id }} fields={[{ k: 'description', l: 'Butiran' }, { k: 'note', l: 'Apa ditambah' }, PHOTOS]} />}
                {r.kind === 'repair' && r.status === 'work_done' && <F title="Sahkan siap / belum" op="repairConfirm" fixed={{ id: r.id }} fields={[{ k: 'notFixed', l: 'Belum baik (not fixed)', t: 'check' }, { k: 'reason', l: 'Catatan' }]} />}
                {r.kind === 'invUpdate' && r.status === 'returned_to_office' && <F title="Betulkan dan hantar" op="invResubmit" fixed={{ id: r.id }} fields={[{ k: 'note', l: 'Apa dibetulkan' }, DOCS]} />}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Tiada permohonan.</p>
      )}
      {office.length > 0 && (
        <>
          <h3>Pejabat saya</h3>
          <RecordList b={b} recs={office} />
        </>
      )}
    </section>
  );
}
