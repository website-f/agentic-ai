import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { Loading, useLoad } from '../ui';
import { OpForm, type Field } from './ItPolicyPanel';

/**
 * "Polisi senjata" (Part R, arms, vault, licence and bulletproof jacket policies; circulars in force 1 Nov 2026, the
 * others 18 Nov 2026): damaged firearms and inspections, staff arms licences, vault applications and access, buying
 * firearms and ammunition from licensed dealers, bulletproof jackets, and the dealer licence preparation (trading stays
 * off). Every rule is checked again on the server; this screen only offers the steps.
 */

type Rec = { id: string; kind: string; ref: string; status: string; at: string; by: string; companyId: string | null; firearmId?: string | null; vaultId?: string | null; requestId?: string | null; d: Record<string, unknown> };
type Board = {
  role: 'arms_control' | 'company' | 'stores';
  docs: { code: string; title: string; inForce: string }[];
  docLists: Record<string, string[]>;
  tiles: {
    licenceApps: { id: string; ref: string; status: string; days: number }[];
    licencesExpiring: { credentialId: string; category: string | null; expiresOn: string; renewalOpen: boolean }[];
    vaultApps: { id: string; ref: string; status: string; days: number }[];
    firearmsOutOfUse: { id: string; tag: string; status: string }[];
    damage: { id: string; ref: string; tag: string; category: string | null; ageHours: number; pastTarget: boolean }[];
    maintenance: { firearmId: string; tag: string; status: string; last: string | null; due: string | null; state: string }[];
    buys: { requestId: string; ref: string; state: string; waitingPolice: boolean; followUpDue: boolean; windowDay: number | null; windowState: string | null; dealerProblem: string | null }[];
    jacketsQuarantined: number;
    jacketsWarranty: { id: string; ref: string; warrantyEnd: string }[];
    vaultsBlocked: { id: string; name: string }[];
    monthly: { month: string; due: string; missing: { firearmId: string; tag: string; companyId: string }[]; state: string };
    extinguishers: { vaultId: string; name: string; expiresOn: string | null; state: string }[];
    completeness: { companyId: string; firearms: number; vaults: number; licences: number; missing: string[]; complete: boolean }[];
    missedDates: { kind: 'licence' | 'vault'; ref: string; companyId: string; since: string }[];
  };
  records: Rec[];
  readiness: { companyId: string; lines: { line: string; state: string; ref: string | null }[] }[];
  keepYears: { arms: number; jackets: number };
};

const KIND_BM: Record<string, string> = {
  damage: 'Laporan kerosakan',
  inspect: 'Pemeriksaan senjata',
  repair: 'Pembaikan',
  licenceApp: 'Permohonan lesen',
  vaultApp: 'Permohonan bilik kebal',
  vaultChange: 'Perubahan bilik kebal',
  vaultLog: 'Log bilik kebal',
  vaultInspect: 'Pemeriksaan bilik kebal',
  buyPack: 'Pek permohonan belian',
  armsGrn: 'Penerimaan senjata',
  jacket: 'Jaket kalis peluru',
  jacketBuy: 'Belian jaket',
  jacketGrn: 'Penerimaan jaket',
  jacketInspect: 'Pemeriksaan jaket',
  dealerApp: 'Permohonan lesen peniaga',
  readiness: 'Kesediaan dagangan',
};

const send = (input: Record<string, unknown>) => {
  // Fields named "checks.x" become one checks object; the op travels in the address.
  const { op, ...rest } = input;
  const out: Record<string, unknown> = {};
  const checks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith('checks.')) checks[k.slice(7)] = v === true;
    else out[k] = v;
  }
  if (Object.keys(checks).length) out.checks = checks;
  return api.armsPolicyAct(String(op), out);
};
const F = (props: { title: string; op: string; fields: Field[]; fixed?: Record<string, unknown> }) => <OpForm {...props} send={send} />;
const checks = (keys: readonly string[]): Field[] => keys.map((k) => ({ k: `checks.${k}`, l: k, t: 'check' as const }));
const REASON: Field = { k: 'reason', l: 'Sebab (reason)' };
const DOCS: Field = { k: 'docs', l: 'Dokumen', t: 'proof' };
const ON: Field = { k: 'on', l: 'Tarikh', t: 'date' };
/** V16: "Sejarah" of a firearm, vault or licence, from the audit log. */
function History() {
  const [entity, setEntity] = useState('firearm');
  const [id, setId] = useState('');
  const [rows, setRows] = useState<{ at: string; by: string; what: string; note: string }[] | null>(null);
  const [err, setErr] = useState('');
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <Select className="select" aria-label="Record" value={entity} onChange={(e) => setEntity(e.target.value)}>
        <option value="firearm">Senjata</option>
        <option value="vault">Bilik kebal</option>
        <option value="credential">Lesen</option>
      </Select>
      <input className="input" aria-label="Record id" placeholder="Record id" value={id} onChange={(e) => setId(e.target.value)} />
      <button className="btn btn-sm" onClick={() => api.armsPolicyAct('history', { entity, id }).then((r) => (setRows(r as never), setErr(''))).catch((e: Error) => setErr(e.message))}>
        Sejarah
      </button>
      {err && <span className="small">{err}</span>}
      {rows && (
        <ul className="small" style={{ width: '100%' }}>
          {rows.length === 0 && <li>Tiada perubahan direkod.</li>}
          {rows.map((r, n) => (
            <li key={n}>
              {r.at.slice(0, 16).replace('T', ' ')} {r.by}: {r.what} {r.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const INSPECT = ['outerClean', 'rustCrackWear', 'serialMatch', 'statusNotes', 'noIsolationNeeded'] as const;
const GRN = ['quantity', 'type', 'serials', 'deliveryOrder', 'invoice', 'condition', 'approvalLetter', 'supplier'] as const;
const JACKET_RECEIVE = ['quantity', 'brand', 'model', 'size', 'condition', 'label', 'serial', 'productDocs', 'testCertificate', 'warranty', 'matchesPo'] as const;
const JACKET_INSPECT = ['outside', 'carrier', 'stitching', 'fasteners', 'label', 'serial', 'panel', 'dampOrDamage', 'dateWarranty'] as const;
const VAULT_STEPS = ['council', 'sent_ipd', 'ipd_registered', 'inspection_letter', 'inspections', 'supported', 'approved', 'access_set', 'done'] as const;

function RecordActions({ r, b }: { r: Rec; b: Board }) {
  const id = { id: r.id };
  switch (r.kind) {
    case 'damage':
      if (r.status === 'closed') return null;
      return (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <F title="Kategori" op="damageCategory" fixed={id} fields={[{ k: 'category', l: 'Category', t: 'select', o: ['LIGHT', 'MEDIUM', 'CRITICAL'] }, REASON]} />
          <F title="Semakan pengurus / pengarah" op="damageReview" fixed={id} fields={[REASON]} />
          {r.d.negligence ? <F title="Pautkan kes HR" op="negligenceLink" fixed={id} fields={[{ k: 'hrCaseRef', l: 'HR case reference' }]} /> : null}
        </div>
      );
    case 'licenceApp':
      return (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <F title="Langkah" op="licStep" fixed={id} fields={[{ k: 'step', l: 'Step', t: 'select', o: ['hr', 'records', 'need', 'check', 'support', 'submit', 'stage', 'decision', 'book', 'appeal', 'close'] }, REASON, { k: 'declaration', l: 'Declaration (records check)' }, ON, { k: 'ipdRef', l: 'IPD reference' }, { k: 'stage', l: 'Stage', t: 'select', o: ['thumbprint', 'biometric', 'eligibility', 'investigation', 'interview'] }, { k: 'decision', l: 'Decision', t: 'select', o: ['approved', 'refused'] }, { k: 'number', l: 'Licence number' }, { k: 'issuedOn', l: 'Issued on', t: 'date' }, { k: 'expiresOn', l: 'Expires on', t: 'date' }, DOCS]} />
          <F title="Dokumen" op="licStep" fixed={{ ...id, step: 'doc' }} fields={[{ k: 'key', l: 'Document', t: 'select', o: b.docLists.licence ?? [] }, DOCS]} />
          {r.status === 'submitted' && <F title="Susulan" op="followUp" fixed={id} fields={[{ k: 'outcome', l: 'Outcome' }]} />}
        </div>
      );
    case 'vaultApp':
      return (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <F title="Langkah" op="vaultStep" fixed={id} fields={[{ k: 'step', l: 'Step', t: 'select', o: VAULT_STEPS }, ON, { k: 'ref', l: 'Reference' }, { k: 'expiresOn', l: 'Approval expires (last step)', t: 'date' }, { k: 'supported', l: 'Supported (tick if yes)', t: 'check' }, { k: 'backTo', l: 'Back to (after appeal)', t: 'select', o: VAULT_STEPS }, REASON, DOCS]} />
          <F title="Dokumen" op="vaultStep" fixed={id} fields={[{ k: 'doc', l: 'Document', t: 'select', o: b.docLists.vault ?? [] }, DOCS]} />
          <F title="Susulan" op="followUp" fixed={id} fields={[{ k: 'outcome', l: 'Outcome' }]} />
        </div>
      );
    case 'vaultInspect':
      return r.status === 'closed' || r.status === 'ok' ? null : <F title="Tindakan selesai" op="vaultActionDone" fixed={id} fields={[{ k: 'index', l: 'Action number (from 0)', t: 'number' }, { k: 'note', l: 'What was done' }]} />;
    case 'armsGrn':
      return r.status === 'mismatch' ? <F title="Sahkan" op="grnConfirm" fixed={id} fields={[REASON]} /> : null;
    case 'jacketBuy':
      return (
        <F
          title="Langkah"
          op="jacketBuyStep"
          fixed={id}
          fields={[{ k: 'step', l: 'Step', t: 'select', o: ['need', 'spec', 'choose'] }, { k: 'spec', l: 'Specification' }, { k: 'supplier', l: 'Supplier chosen' }, REASON]}
        />
      );
    case 'jacket':
      return (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.status === 'available' && <F title="Keluarkan" op="jacketIssue" fixed={id} fields={[{ k: 'guard', l: 'Guard' }, { k: 'staffNo', l: 'Staff no.' }, { k: 'siteId', l: 'Site' }, { k: 'condition', l: 'Condition' }, { k: 'guardConfirmed', l: 'Guard confirms', t: 'check' }, { k: 'slip', l: 'Signed slip photo', t: 'photos' }]} />}
          {r.status === 'issued' && <F title="Pulangkan" op="jacketReturn" fixed={id} fields={[{ k: 'condition', l: 'Condition on return' }]} />}
          {r.status === 'issued' && <F title="Serah tugas" op="jacketHandover" fixed={id} fields={[{ k: 'returnCondition', l: 'Condition on return' }, { k: 'guard', l: 'Next guard' }, { k: 'staffNo', l: 'Staff no.' }, { k: 'guardConfirmed', l: 'Next guard confirms', t: 'check' }, { k: 'slip', l: 'Signed slip photo', t: 'photos' }]} />}
          <F title="Periksa" op="jacketInspect" fixed={id} fields={[...checks(JACKET_INSPECT), { k: 'result', l: 'Result', t: 'select', o: ['BOLEH_DIGUNAKAN', 'PERLU_PEMERIKSAAN_LANJUT', 'DIKUARANTIN', 'PERLU_DIGANTI'] }, { k: 'note', l: 'Note' }, { k: 'photos', l: 'Photos', t: 'photos' }]} />
          {r.status === 'quarantine' && <F title="Keputusan" op="jacketDecide" fixed={id} fields={[{ k: 'decision', l: 'Decision', t: 'select', o: ['reuse', 'replace', 'dispose', 'maker_repair'] }, REASON]} />}
          <F title="Hilang" op="jacketLoss" fixed={id} fields={[{ k: 'place', l: 'Where' }, { k: 'what', l: 'What happened' }, { k: 'action', l: 'Action taken' }]} />
        </div>
      );
    case 'dealerApp':
      return (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <F title="Dokumen" op="dealerStep" fixed={{ ...id, step: 'doc' }} fields={[{ k: 'key', l: 'Document', t: 'select', o: b.docLists.dealer ?? [] }, DOCS]} />
          <F title="Langkah" op="dealerStep" fixed={id} fields={[{ k: 'step', l: 'Step', t: 'select', o: ['approve', 'submitted', 'inspection', 'refused', 'issued'] }, ON, { k: 'to', l: 'Sent to' }, { k: 'ref', l: 'Reference' }, { k: 'number', l: 'Licence number' }, REASON, DOCS]} />
        </div>
      );
    default:
      return null;
  }
}

function summary(r: Rec): string {
  const d = r.d;
  if (r.kind === 'damage') return `${String(d.tag)}: ${String(d.what)}${d.category ? ` (${String(d.category)})` : ''}`;
  if (r.kind === 'jacket') return `${String(d.model)} ${String(d.serial)}${d.holder ? `, dengan ${String(d.holder)}` : ''}`;
  if (r.kind === 'licenceApp') return `${String(d.type)} ${String(d.category)}`;
  if (r.kind === 'armsGrn') return `${(d.firearms as unknown[] | undefined)?.length ?? 0} firearm(s), ${String(d.roundsCounted ?? 0)} rounds`;
  return '';
}

function BuyRow({ x, b }: { x: Board['tiles']['buys'][number]; b: Board }) {
  const rid = { requestId: x.requestId };
  return (
    <tr>
      <td>{x.ref}</td>
      <td>{x.state}</td>
      <td>{x.windowState ? `${x.windowState} (hari ${x.windowDay})` : '-'}</td>
      <td className="small">{x.dealerProblem ?? (x.followUpDue ? 'Susulan IPD perlu' : '')}</td>
      <td>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <F title="Borang belian" op="buyForm" fixed={rid} fields={[{ k: 'purpose', l: 'Purpose' }, { k: 'firearmKind', l: 'Firearm type', t: 'select', o: ['Shotgun', 'Revolver', 'Pistol'] }, { k: 'firearmQty', l: 'Firearms', t: 'number' }, { k: 'calibre', l: 'Calibre' }, { k: 'rounds', l: 'Rounds', t: 'number' }, { k: 'location', l: 'Location' }, { k: 'justification', l: 'Operational justification' }, { k: 'extraReason', l: 'Reason for more than the need' }]} />
          <F title="Dokumen pek" op="packFile" fixed={rid} fields={[{ k: 'key', l: 'Document', t: 'select', o: b.docLists.pack ?? [] }, DOCS]} />
          <F title="Hantar ke IPD" op="ipdSent" fixed={rid} fields={[ON, { k: 'ipdRef', l: 'IPD reference' }, DOCS]} />
          <F title="Peringkat polis" op="ipdStage" fixed={rid} fields={[{ k: 'stage', l: 'Stage', t: 'select', o: ['IPD', 'IPK', 'BUKIT_AMAN', 'VISIT'] }, ON, { k: 'note', l: 'Note' }]} />
          <F title="Surat kelulusan" op="approvalLetter" fixed={rid} fields={[{ k: 'permitNo', l: 'Permit number' }, ON, { k: 'validUntil', l: 'Valid until', t: 'date' }, { k: 'firearmKind', l: 'Firearm type', t: 'select', o: ['Shotgun', 'Revolver', 'Pistol'] }, { k: 'firearmQty', l: 'Firearms', t: 'number' }, { k: 'calibre', l: 'Calibre' }, { k: 'rounds', l: 'Rounds', t: 'number' }, { k: 'conditions', l: 'Conditions' }, { k: 'holderName', l: 'Licence holder' }, DOCS]} />
          <F title="Pesanan" op="order" fixed={rid} fields={[{ k: 'poRef', l: 'Order reference' }]} />
          <F title="Terima" op="armsGrn" fixed={rid} fields={[...checks(GRN), { k: 'roundsCounted', l: 'Rounds counted', t: 'number' }, { k: 'calibre', l: 'Calibre' }, { k: 'doNo', l: 'DO number' }, { k: 'invoiceNo', l: 'Invoice number' }, { k: 'note', l: 'What does not match' }, DOCS]} />
          <F title="Bajet (Kewangan)" op="armsBudget" fixed={rid} fields={[{ k: 'available', l: 'Budget available', t: 'select', o: ['yes', 'no'] }, { k: 'comment', l: 'Comment' }]} />
        </div>
      </td>
    </tr>
  );
}

export function ArmsPolicyPanel() {
  const { data: b, error } = useLoad(() => api.armsPolicyAct('board', {}) as Promise<Board>, []);
  if (error) return null; // Outside the arms wall: nothing to show.
  if (!b) return <Loading what="arms policies" />;
  const t = b.tiles;
  const firearms = [...t.firearmsOutOfUse.map((f) => ({ id: f.id, tag: `${f.tag} (${f.status})` })), ...t.maintenance.map((f) => ({ id: f.firearmId, tag: f.tag }))];
  const firearmField: Field = { k: 'firearmId', l: 'Firearm', t: 'select', o: [...new Set(firearms.map((f) => f.id))] };
  const ac = b.role === 'arms_control';
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2>Polisi senjata</h2>
      <p className="small">
        Senjata rosak, pemeriksaan, lesen senjata kakitangan, bilik kebal, belian senjata dan peluru, jaket kalis peluru, dan persediaan lesen peniaga. Dagangan senjata kekal
        DITUTUP. Rekod disimpan {b.keepYears.arms} tahun (jaket {b.keepYears.jackets} tahun).
      </p>
      {b.role !== 'stores' && (
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">Senjata tidak boleh digunakan</div>
            <div className="kpi-value">{t.firearmsOutOfUse.length}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Laporan kerosakan terbuka</div>
            <div className="kpi-value">{t.damage.length}</div>
            <div className="kpi-note">{t.damage.filter((x) => x.pastTarget).length} lewat sasaran</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Penyelenggaraan</div>
            <div className="kpi-value">{t.maintenance.filter((x) => x.state === 'overdue' || x.state === 'due soon').length}</div>
            <div className="kpi-note">setiap 120 hari</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Lesen untuk diperbaharui (90 hari)</div>
            <div className="kpi-value">{t.licencesExpiring.filter((x) => !x.renewalOpen).length}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Rekod bulanan {t.monthly.month} (sebelum 28hb)</div>
            <div className="kpi-value">{t.monthly.missing.length}</div>
            <div className="kpi-note">{t.monthly.state === 'late' ? 'LEWAT' : t.monthly.state === 'reminder' ? 'peringatan 21hb' : t.monthly.state}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Alat pemadam api bilik kebal</div>
            <div className="kpi-value">{t.extinguishers.filter((x) => x.state !== 'ok').length}</div>
            <div className="kpi-note">tiada / 30 hari / tamat</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Bilik kebal dalam permohonan</div>
            <div className="kpi-value">{t.vaultsBlocked.length}</div>
            <div className="kpi-note">tiada senjata boleh disimpan</div>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        {b.role !== 'stores' && (
          <>
            <F title="Laporkan kerosakan" op="damageReport" fields={[firearmField, { k: 'what', l: 'What is wrong' }, { k: 'category', l: 'Category', t: 'select', o: ['LIGHT', 'MEDIUM', 'CRITICAL'] }, { k: 'how', l: 'How it happened' }, { k: 'firstAction', l: 'First action' }, { k: 'negligence', l: 'Possible negligence', t: 'check' }, { k: 'negligenceFacts', l: 'Facts (if negligence)' }, { k: 'photos', l: 'Photos', t: 'photos' }]} />
            <F title="Pemeriksaan senjata" op="inspect" fields={[firearmField, ...checks(INSPECT), { k: 'maintenance', l: 'Maintenance done' }, { k: 'materials', l: 'Materials used' }, { k: 'findings', l: 'Findings' }, { k: 'photos', l: 'Photos', t: 'photos' }]} />
            <F title="Rekod bulanan senjata" op="monthly" fields={[{ k: 'firearmId', l: 'Firearm', t: 'select', o: t.monthly.missing.map((x) => x.firearmId) }, { k: 'month', l: 'Month (YYYY-MM)' }, { k: 'dutyOfficer', l: 'Duty officer' }, { k: 'condition', l: 'Condition', t: 'select', o: ['GOOD', 'NEEDS_ATTENTION', 'UNUSABLE'] }, { k: 'damage', l: 'Damage found (type TIADA_MASALAH if none)' }, { k: 'checkOn', l: 'Check date', t: 'date' }, { k: 'nextMaintenanceOn', l: 'Next maintenance (blank = +120 days)', t: 'date' }, { k: 'maintenanceDone', l: 'Maintenance done this month', t: 'check' }, { k: 'photo', l: 'Firearm photo', t: 'photos' }, { k: 'maintenanceForm', l: 'Maintenance form', t: 'proof' }]} />
            <F title="Alat pemadam api" op="extinguisher" fields={[{ k: 'vaultId', l: 'Vault', t: 'select', o: t.extinguishers.map((x) => x.vaultId) }, { k: 'serial', l: 'Serial' }, { k: 'location', l: 'Location in the vault' }, { k: 'lastServiceOn', l: 'Last service', t: 'date' }, { k: 'expiresOn', l: 'Expiry', t: 'date' }, { k: 'certificate', l: 'Certificate', t: 'proof' }]} />
            <F title="Tukar status" op="setStatus" fields={[firearmField, { k: 'status', l: 'Status', t: 'select', o: ['NEEDS_MAINTENANCE', 'UNDER_INSPECTION', 'UNUSABLE'] }, REASON]} />
            {ac && <F title="Sahkan guna semula" op="reuse" fields={[firearmField, { k: 'reason', l: 'What was checked' }, DOCS]} />}
            <F title="Hantar / terima pembaikan" op="repairSent" fields={[{ k: 'requestId', l: 'Service request id' }, { k: 'note', l: "Dealer's receipt note" }, DOCS]} />
            <F title="Pembaikan kembali" op="repairBack" fields={[{ k: 'requestId', l: 'Service request id' }, DOCS]} />
            <F title="Permohonan lesen" op="licenceApp" fields={[{ k: 'personId', l: 'Staff (person id)' }, { k: 'category', l: 'Category', t: 'select', o: ['PELESEN_A', 'AMRA', 'CNU', 'BODYGUARD', 'OTHER'] }, { k: 'categoryOther', l: 'Other licence name' }, { k: 'type', l: 'Type', t: 'select', o: ['NEW', 'RENEWAL'] }]} />
            <F title="Status lesen" op="licState" fields={[{ k: 'credentialId', l: 'Licence (credential id)' }, { k: 'state', l: 'State', t: 'select', o: ['active', 'suspended', 'cancelled'] }, REASON]} />
            <F title="Permohonan bilik kebal" op="vaultApp" fields={[{ k: 'companyId', l: 'Company' }, { k: 'name', l: 'Vault name' }, { k: 'kind', l: 'Kind', t: 'select', o: ['COMPANY_ARMOURY', 'POLICE_STATION', 'CLIENT_SAFE'] }, { k: 'liaison', l: 'Liaison (role)' }]} />
            <F title="Kebenaran akses" op="vaultAuth" fields={[{ k: 'vaultId', l: 'Vault id' }, { k: 'name', l: 'Name' }, { k: 'personId', l: 'Person id' }, { k: 'letterRef', l: 'Letter reference' }, { k: 'letterOn', l: 'Letter date', t: 'date' }, REASON]} />
            <F title="Batal akses" op="vaultAuthRemove" fields={[{ k: 'vaultId', l: 'Vault id' }, { k: 'name', l: 'Name' }, REASON]} />
            <F title="Log bilik kebal" op="vaultLog" fields={[{ k: 'vaultId', l: 'Vault id' }, { k: 'person', l: 'Who entered' }, { k: 'purpose', l: 'Purpose' }, { k: 'witness', l: 'Witness' }]} />
            <F title="Pemeriksaan bilik kebal" op="vaultInspect" fields={[{ k: 'vaultId', l: 'Vault id' }, ...checks(['inventory', 'accessList', 'approval', 'sop']), { k: 'faults', l: 'Faults' }, { k: 'serious', l: 'Serious', t: 'check' }, { k: 'photos', l: 'Photos', t: 'photos' }]} />
            <F title="Perubahan bilik kebal" op="vaultChange" fields={[{ k: 'vaultId', l: 'Vault id' }, { k: 'what', l: 'What changes' }, { k: 'policeNeeded', l: 'Police approval needed', t: 'check' }, { k: 'policeRef', l: 'Police reference' }, REASON]} />
          </>
        )}
        <F title="Daftar jaket" op="jacket" fields={[{ k: 'serial', l: 'Serial' }, { k: 'maker', l: 'Maker' }, { k: 'model', l: 'Model' }, { k: 'size', l: 'Size' }, { k: 'level', l: 'Protection level' }, { k: 'standard', l: 'Standard' }, { k: 'madeOn', l: 'Made on', t: 'date' }, { k: 'warrantyEnd', l: 'Warranty end', t: 'date' }, { k: 'serviceLifeEnd', l: 'Service life end', t: 'date' }, { k: 'location', l: 'Location' }, DOCS]} />
        <F title="Mohon jaket" op="jacketBuy" fields={[{ k: 'project', l: 'Project or location' }, { k: 'purpose', l: 'Purpose' }, { k: 'guards', l: 'Guards', t: 'number' }, { k: 'held', l: 'Held now', t: 'number' }, { k: 'needed', l: 'Needed', t: 'number' }, { k: 'justification', l: 'Justification' }, { k: 'estCost', l: 'Estimated cost (RM)', t: 'number' }]} />
        {b.role !== 'company' && <F title="Terima jaket" op="jacketGrn" fields={[{ k: 'buyId', l: 'Purchase id' }, ...checks(JACKET_RECEIVE), { k: 'qty', l: 'Quantity', t: 'number' }, { k: 'note', l: 'What does not match' }]} />}
        {b.role !== 'stores' && <F title="Permohonan lesen peniaga" op="dealerApp" fields={[{ k: 'companyId', l: 'Company' }, { k: 'placeOfBusiness', l: 'Place of business' }]} />}
        {ac && <F title="Kelulusan stor dagangan" op="tradeStore" fields={[{ k: 'vaultId', l: 'Vault id' }, { k: 'ref', l: 'Police reference' }, ON, { k: 'placeOfBusiness', l: 'Place of business' }, DOCS]} />}
        {ac && <F title="Rekod kesediaan" op="readiness" fields={[{ k: 'companyId', l: 'Company' }, { k: 'line', l: 'Line', t: 'select', o: ['policeViewSharedVault', 'counselOpinion', 'kdnCircular2017', 'importRoute', 'stockInsurance', 'sqlAccounts', 'staffLicences'] }, { k: 'ref', l: 'Reference' }, ON, { k: 'note', l: 'Note' }, DOCS]} />}
      </div>
      {b.role !== 'stores' && <History />}
      {b.role !== 'stores' && t.completeness.some((c) => !c.complete) && (
        <>
          <h3>Rekod belum lengkap (setiap syarikat)</h3>
          <ul className="small">
            {t.completeness.filter((c) => !c.complete).map((c) => (
              <li key={c.companyId}>
                {c.companyId}: {c.firearms} senjata, {c.vaults} bilik kebal, {c.licences} lesen CNU / Bodyguard; belum lengkap: {c.missing.slice(0, 8).join('; ')}
                {c.missing.length > 8 ? ` (+${c.missing.length - 8})` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {b.role !== 'stores' && t.missedDates.length > 0 && (
        <p className="notice" data-tone="crit">
          <span>Tarikh permohonan terlepas: {t.missedDates.map((x) => `${x.kind} ${x.ref} (${x.since})`).join(', ')}</span>
        </p>
      )}
      {b.role !== 'stores' && t.buys.length > 0 && (
        <>
          <h3>Belian senjata dan peluru</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Step</th>
                <th>14-day window</th>
                <th>Problem</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.buys.map((x) => (
                <BuyRow key={x.requestId} x={x} b={b} />
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>Rekod</h3>
      {b.records.length === 0 ? (
        <p className="small">Tiada rekod lagi.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Jenis</th>
              <th>Status</th>
              <th>Butiran</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {b.records.map((r) => (
              <tr key={r.id}>
                <td>{r.ref}</td>
                <td>{KIND_BM[r.kind] ?? r.kind}</td>
                <td>{r.status}</td>
                <td className="small">{summary(r)}</td>
                <td>
                  <RecordActions r={r} b={b} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ac && b.readiness.length > 0 && (
        <>
          <h3>Kesediaan dagangan (kekal DITUTUP)</h3>
          {b.readiness.map((c) => (
            <p key={c.companyId} className="small">
              <strong>{c.companyId}</strong>: {c.lines.map((l) => `${l.line} ${l.state === 'DONE' ? 'siap' : 'TIDAK DIKETAHUI'}`).join(', ')}
            </p>
          ))}
        </>
      )}
      <details>
        <summary>Dokumen polisi ({b.docs.length})</summary>
        <ul className="small">
          {b.docs.map((d) => (
            <li key={d.code}>
              {d.code} {d.title} (berkuat kuasa {d.inForce})
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
