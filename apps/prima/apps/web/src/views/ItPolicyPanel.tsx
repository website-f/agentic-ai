import { Select } from '../SearchSelect';
import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api } from '../api';
import { ErrorNotice, Loading, useAction, useLoad } from '../ui';
import { ProofPicker } from './Proof';

/**
 * "Polisi IT" (Merdeka Network IT policies, Part Q6-Q24, effective 18 Nov 2026): equipment requests from any
 * department, the technical assessment, quotes compared, the Finance budget check, receiving and quarantine, register
 * details before handover, disposal with three approvals, the data wipe log, refurbishment and end-of-life reviews,
 * rental agreements per company and returns, the Microsoft 365 account register and account requests, new domains and
 * domain security, and the IP register. Every rule is checked again on the server.
 */

type Rec = { id: string; kind: string; ref: string; status: string; at: string; by: string; requesterId?: string; lineManagerId?: string; purchaseId?: string; assetId?: string; companyId?: string | null; d: Record<string, unknown> };
type PurchaseRow = {
  purchaseId: string;
  ref: string;
  stage: string | null;
  daysInStage: number;
  late: boolean;
  quotes: { physical: number; online: number; ok: boolean; expired: number; problems?: string[] } & Record<string, unknown>;
  comparison: { supplier: string; type: string; price: number; warrantyMonths: number; leadDays: number; technicalFit: string; capability: string; expired: boolean; payFirst: boolean }[];
  recommendation: { supplier: string; reason: string } | null;
  route: string;
  paidFirstUndelivered: boolean;
  budget: { available: string; comment: string } | null;
  budgetMissing: boolean;
  grn: { ref: string; status: string; doNo: string; quarantine: string[] }[];
  docsMissing: string[];
  keepUntil: string;
};
type Board = {
  role: 'staff' | 'manager' | 'it' | 'reader' | 'party';
  effective: string;
  docs: { code: string; title: string }[];
  mine: Rec[];
  records?: Rec[];
  purchases?: PurchaseRow[];
  dues?: { assetId: string; tag: string; what: string; label: string }[];
  m365Review?: { id: string; email: string; type: string; problems: string[] }[];
  licenceUse?: { licence: string; used: number; bought: number | null }[];
  domainSecurity?: { domain: string; lock: string; twoFa: string; tone: 'ok' | 'warn' | 'crit' }[];
  noAgreement?: string[];
  quarantine?: string[];
  wipeReadOnly?: boolean;
  settings?: Record<string, unknown>;
  stageDays?: Record<string, number>;
  retentionYears?: number;
  disposalTimes?: { id: string; ref: string; stage: string; days: number; target: number; late: boolean; whole: { days: number; target: number; late: boolean } }[];
  accountsLate?: { id: string; ref: string; days: number }[];
  ipLate?: { id: string; name: string; days: number }[];
  webProjects?: (Rec & { late: string | null })[];
};

const WEB_FIELDS: Field[] = [
  { k: 'companyId', l: 'Company id' },
  { k: 'kind', l: 'New website or major redesign', t: 'select', o: ['new', 'redesign'] },
  { k: 'siteName', l: 'Website name' },
  { k: 'scope', l: 'Scope and functions wanted', t: 'area' },
  { k: 'contact', l: 'Contact details to show' },
  { k: 'ideas', l: 'Design and content ideas', t: 'area' },
  { k: 'profile', l: 'Company profile (text)', t: 'area' },
  { k: 'businessOwnerId', l: 'Business owner (person id)' },
  { k: 'contentOwnerId', l: 'Content owner (person id)' },
  { k: 'technicalKeeperId', l: 'Technical keeper in IT (person id)' },
  { k: 'contentApproverId', l: 'Content approver (person id)' },
  { k: 'files', l: 'Logo, company profile and photos', t: 'photos' },
];

/** V9 / V-X6 / V8: steps past their working-day targets (flags, never blocks). */
function LateSection({ b }: { b: Board }) {
  const disp = (b.disposalTimes ?? []).filter((x) => x.late || x.whole.late);
  const web = (b.webProjects ?? []).filter((x) => x.late);
  const late = (b.purchases ?? []).filter((p) => p.late || (p as PurchaseRow & { whole?: { late: boolean } }).whole?.late);
  if (!disp.length && !(b.accountsLate ?? []).length && !(b.ipLate ?? []).length && !web.length && !late.length) return null;
  return (
    <div className="panel">
      <h3>Lewat sasaran / past the target</h3>
      <ul className="small">
        {late.map((p) => (
          <li key={p.purchaseId}>
            {p.ref}: {p.stage ?? 'purchase'} {p.daysInStage} working day(s){(p as PurchaseRow & { whole?: { days: number; target: number; late: boolean } }).whole?.late ? `; whole purchase ${(p as PurchaseRow & { whole: { days: number; target: number } }).whole.days} of ${(p as PurchaseRow & { whole: { days: number; target: number } }).whole.target}` : ''}
          </li>
        ))}
        {disp.map((x) => (
          <li key={x.id}>
            {x.ref}: disposal {x.stage} {x.days} of {x.target} working days; whole {x.whole.days} of {x.whole.target}
          </li>
        ))}
        {(b.accountsLate ?? []).map((x) => (
          <li key={x.id}>{x.ref}: Microsoft 365 account not ready, {x.days} working days after approval</li>
        ))}
        {(b.ipLate ?? []).map((x) => (
          <li key={x.id}>{x.name}: not in the IP register, {x.days} working days after the change</li>
        ))}
        {web.map((x) => (
          <li key={x.id}>
            {x.ref}: {x.late}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** V10: what the IT briefing forbids (shown to everyone). */
const IT_FORBIDDEN_BM = [
  'Jangan kongsi kata laluan dengan sesiapa, termasuk rakan sekerja dan IT.',
  'Emel syarikat dibuka hanya selepas kelulusan (permohonan akaun M365, kelulusan CoS).',
  'Jangan guna emel peribadi untuk kerja syarikat.',
  'Jangan beli langganan Microsoft atau perisian lain untuk syarikat di luar pembelian IT.',
];

export type Field = { k: string; l: string; t?: 'text' | 'number' | 'date' | 'select' | 'yn' | 'check' | 'proof' | 'photos' | 'list' | 'area'; o?: readonly string[] };

const KIND_BM: Record<string, string> = {
  request: 'Permohonan peralatan IT',
  assessment: 'Penilaian teknikal',
  quoteInfo: 'Sebut harga',
  budget: 'Semakan bajet',
  grn: 'Penerimaan (GRN)',
  assetDetail: 'Butiran daftar',
  disposal: 'Pelupusan',
  wipe: 'Log pemadaman data',
  refurb: 'Baik pulih',
  eol: 'Penilaian akhir hayat',
  agreement: 'Perjanjian sewaan',
  rentalReturn: 'Pemulangan peranti',
  m365: 'Akaun M365',
  acctReq: 'Permohonan akaun',
  domainReq: 'Domain baharu',
  domainSec: 'Keselamatan domain',
  ip: 'Daftar harta intelek',
  webProject: 'Laman web baharu',
  settings: 'Tetapan',
};

/** One small form that sends one policy action (the IT door by default; the arms policy panel passes its own). */
export function OpForm({ title, op, fields, fixed = {}, done = 'Saved.', send: sendTo }: { title: string; op: string; fields: Field[]; fixed?: Record<string, unknown>; done?: string; send?: (input: Record<string, unknown>) => Promise<unknown> }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, unknown>>({});
  const set = (k: string, x: unknown) => setV((p) => ({ ...p, [k]: x }));
  const send = () => {
    const out: Record<string, unknown> = { op, ...fixed };
    for (const f of fields) {
      const x = v[f.k];
      if (f.t === 'list') out[f.k] = String(x ?? '').split(',').map((y) => y.trim()).filter(Boolean);
      else if (f.t === 'check') out[f.k] = x === true;
      else if (f.t === 'proof' || f.t === 'photos') out[f.k] = (x as ProofInput[] | undefined) ?? [];
      else if (x !== undefined) out[f.k] = x;
    }
    void act.run(() => (sendTo ? sendTo(out) : api.itAct('policyAct', out)), done).then((r) => r && (setV({}), setOpen(false)));
  };
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        {title}
      </button>
    );
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <strong>{title}</strong>
      {fields.map((f) =>
        f.t === 'select' || f.t === 'yn' ? (
          <label key={f.k} className="small">
            {f.l}{' '}
            <Select className="select" aria-label={f.l} value={String(v[f.k] ?? '')} onChange={(e) => set(f.k, e.target.value)}>
              <option value="">-</option>
              {(f.t === 'yn' ? ['yes', 'no', 'unknown'] : f.o ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          </label>
        ) : f.t === 'check' ? (
          <label key={f.k} className="small">
            <input type="checkbox" checked={v[f.k] === true} onChange={(e) => set(f.k, e.target.checked)} /> {f.l}
          </label>
        ) : f.t === 'proof' || f.t === 'photos' ? (
          <ProofPicker key={f.k} site={null} refText={f.l} items={(v[f.k] as ProofInput[]) ?? []} onChange={(x) => set(f.k, x)} documentsOnly={f.t === 'proof'} />
        ) : f.t === 'area' ? (
          <textarea key={f.k} className="input" aria-label={f.l} placeholder={f.l} value={String(v[f.k] ?? '')} onChange={(e) => set(f.k, e.target.value)} />
        ) : (
          <input
            key={f.k}
            className="input"
            type={f.t === 'number' ? 'number' : f.t === 'date' ? 'date' : 'text'}
            aria-label={f.l}
            placeholder={f.t === 'list' ? `${f.l} (comma between)` : f.l}
            value={String(v[f.k] ?? '')}
            onChange={(e) => set(f.k, f.t === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          />
        ),
      )}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={send}>
          Send
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

const REASON: Field = { k: 'reason', l: 'Reason (sebab)' };
const DECISION: Field = { k: 'decision', l: 'Decision', t: 'select', o: ['approve', 'reject'] };
const REQUEST_FIELDS: Field[] = [
  { k: 'item', l: 'Item needed' },
  { k: 'qty', l: 'Quantity', t: 'number' },
  { k: 'purpose', l: 'What it is for' },
  { k: 'neededBy', l: 'Needed by', t: 'date' },
  { k: 'usage', l: 'Who uses it and how' },
  { k: 'department', l: 'Department' },
  { k: 'costCentre', l: 'Cost centre' },
  { k: 'priority', l: 'How urgent', t: 'select', o: ['P1', 'P2', 'P3', 'P4'] },
  { k: 'justification', l: 'Justification', t: 'select', o: ['operational', 'productivity', 'compliance', 'replacement'] },
  { k: 'replacesTag', l: 'Asset tag it replaces (replacement only)' },
  { k: 'attachment', l: 'Supporting document (optional)', t: 'proof' },
];
const ACCT_FIELDS: Field[] = [
  { k: 'kind', l: 'Kind of account', t: 'select', o: ['newJoiner', 'shared', 'department', 'service', 'guest', 'special'] },
  { k: 'lineManagerId', l: 'Line manager (Prima user id)' },
  { k: 'fullName', l: 'Full name on the account' },
  { k: 'department', l: 'Department' },
  { k: 'jobTitle', l: 'Job title' },
  { k: 'emailWanted', l: 'Email address wanted' },
  { k: 'justification', l: 'Justification' },
  { k: 'apps', l: 'Apps needed (Teams, SharePoint...)' },
  { k: 'accessLevel', l: 'Access level' },
];

/** Staff side: ask for IT equipment, a Microsoft 365 account or a domain, and follow what you asked. */
function MineSection({ b }: { b: Board }) {
  return (
    <div className="panel">
      <h3>Permohonan saya</h3>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <OpForm title="Mohon peralatan IT" op="request" fields={REQUEST_FIELDS} done="Request sent to IT." />
        <OpForm title="Mohon akaun Microsoft 365" op="acctReq" fields={ACCT_FIELDS} done="Sent to your line manager." />
        <OpForm title="Mohon domain baharu" op="domainReq" fields={[{ k: 'name', l: 'Proposed domain' }, { k: 'purpose', l: 'Purpose' }, { k: 'justification', l: 'Business justification' }, { k: 'users', l: 'Expected users', t: 'number' }]} done="Sent to the CEO." />
        <OpForm title="Mohon laman web baharu (ketua syarikat)" op="webProject" fields={WEB_FIELDS} done="Sent to IT." />
      </div>
      {b.mine.length ? (
        <table className="table small">
          <tbody>
            {b.mine.map((r) => (
              <tr key={r.id}>
                <td>{r.ref}</td>
                <td>{KIND_BM[r.kind] ?? r.kind}</td>
                <td>{r.status}</td>
                <td>
                  {r.kind === 'acctReq' && r.status === 'submitted' && r.lineManagerId && r.requesterId !== r.lineManagerId && (
                    <OpForm title="Support as line manager" op="acctStep" fixed={{ id: r.id, step: 'support' }} fields={[DECISION, REASON]} />
                  )}
                  {r.kind === 'webProject' && (r.status === 'approved' || r.status === 'built') && <WebOwnerStep r={r} />}
                  {r.kind === 'webProject' && r.status === 'uat_ok' && (
                    <OpForm title="Lulus terbit / approve publishing" op="webStep" fixed={{ id: r.id, step: 'publish' }} fields={[{ k: 'https', l: 'HTTPS is on', t: 'check' }, { k: 'liveUrl', l: 'Live address (https://)' }, REASON]} done="Live." />
                  )}
                  {r.kind === 'wipe' && !r.d.backup && <OpForm title="Tick: my business data was backed up" op="wipeBackup" fixed={{ id: r.id }} fields={[]} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Nothing asked yet.</p>
      )}
    </div>
  );
}

function WebOwnerStep({ r }: { r: Rec }) {
  if (r.status === 'approved') return <OpForm title="Sahkan reka bentuk dan kandungan" op="webStep" fixed={{ id: r.id, step: 'content' }} fields={[REASON]} done="Confirmed." />;
  return <OpForm title="UAT: uji sebelum terbit" op="webStep" fixed={{ id: r.id, step: 'uat' }} fields={[{ k: 'pass', l: 'UAT passed', t: 'check' }, REASON]} done="UAT recorded." />;
}

function summary(r: Rec): string {
  const d = r.d;
  const pick = ['item', 'qty', 'brandModel', 'reason', 'condition', 'method', 'outcome', 'email', 'type', 'fullName', 'name', 'domain', 'lock', 'twoFa', 'doNo', 'available', 'billing', 'start', 'missing', 'registrantFlag'];
  return pick
    .filter((k) => d[k] != null && d[k] !== '' && !(Array.isArray(d[k]) && !(d[k] as unknown[]).length))
    .map((k) => `${k}: ${Array.isArray(d[k]) ? (d[k] as unknown[]).join(', ') : String(d[k])}`)
    .slice(0, 5)
    .join(' · ');
}

/** The actions that fit one record, for the person looking at it; the server decides who may. */
function RecordActions({ r, b }: { r: Rec; b: Board }) {
  const it = b.role === 'manager' || b.role === 'it';
  const out: JSX.Element[] = [];
  if (r.kind === 'request' && r.status === 'submitted' && it) {
    out.push(<OpForm key="p" title="Jadikan pembelian IT" op="requestToPurchase" fixed={{ id: r.id }} fields={[{ k: 'kind', l: 'Asset kind', t: 'select', o: ['LAPTOP', 'DESKTOP', 'PHONE', 'TABLET', 'PRINTER', 'NETWORK', 'CCTV', 'OTHER'] }, { k: 'unitPrice', l: 'Estimated unit price (RM)', t: 'number' }, { k: 'ownerId', l: 'Owner company id (blank = Merdeka)' }]} done="IT purchase opened." />);
    out.push(<OpForm key="d" title="Decline" op="requestDecline" fixed={{ id: r.id }} fields={[REASON]} />);
  }
  if (r.kind === 'disposal') {
    if (r.status === 'asked' && it) out.push(<OpForm key="i" title="Record the inspection" op="disposalInspect" fixed={{ id: r.id }} fields={[{ k: 'repairable', l: 'Repairable', t: 'check' }, { k: 'repairOptions', l: 'Repair options' }, { k: 'repairCost', l: 'Repair cost (RM)', t: 'number' }, { k: 'photos', l: 'Photos of the device', t: 'photos' }]} />);
    if (['inspected', 'manager', 'head'].includes(r.status)) out.push(<OpForm key="a" title="Approve or reject" op="disposalDecide" fixed={{ id: r.id }} fields={[DECISION, REASON]} />);
    if (r.status === 'approved' && b.role === 'manager')
      out.push(
        <OpForm
          key="x"
          title="Record the disposal as done"
          op="disposalDone"
          fixed={{ id: r.id }}
          fields={[{ k: 'method', l: 'Method', t: 'select', o: ['ewaste', 'tradein', 'salvage', 'takeback'] }, { k: 'vendor', l: 'Vendor' }, { k: 'certNo', l: 'Disposal certificate number' }, { k: 'value', l: 'Disposal value (RM, 0 allowed)', t: 'number' }, { k: 'tradeInRef', l: 'Trade-in reference' }, { k: 'vendorAck', l: 'Vendor acknowledgement' }, { k: 'certificate', l: 'Disposal certificate', t: 'proof' }, { k: 'photos', l: 'Photos of the equipment', t: 'photos' }]}
        />,
      );
  }
  if (r.kind === 'wipe' && r.status === 'done' && it) out.push(<OpForm key="c" title="Check the wipe" op="wipeCheck" fixed={{ id: r.id }} fields={[{ k: 'reason', l: 'What you checked' }]} />);
  if (r.kind === 'grn' && (r.d.quarantine as string[] | undefined)?.length && it)
    out.push(<OpForm key="r" title="Release a unit from quarantine" op="grnRelease" fixed={{ id: r.id }} fields={[{ k: 'assetId', l: 'Asset id', t: 'select', o: r.d.quarantine as string[] }, REASON]} />);
  if (r.kind === 'agreement' && r.status !== 'signed' && b.role === 'manager')
    out.push(<OpForm key="s" title="Record the signed copy" op="agreementSigned" fixed={{ id: r.id }} fields={[{ k: 'link', l: 'SharePoint link (https://)' }, { k: 'signedOn', l: 'Signed on', t: 'date' }, { k: 'forA', l: 'Signed for Merdeka (Pihak A), by role' }, { k: 'forB', l: 'Signed for the company (Pihak B), by role' }, { k: 'witness', l: 'Witness (role)' }]} />);
  if (r.kind === 'agreement') out.push(<AgreementPrint key="pr" r={r} />);
  if (r.kind === 'acctReq') {
    if (r.status === 'supported' && it) out.push(<OpForm key="v" title="IT verify" op="acctStep" fixed={{ id: r.id, step: 'verify' }} fields={[DECISION, { k: 'existingUser', l: 'Existing user found', t: 'yn' }, { k: 'duplicate', l: 'Duplicate account', t: 'yn' }, { k: 'licenceFree', l: 'Licence available', t: 'yn' }, { k: 'domainOk', l: 'Domain correct', t: 'yn' }, REASON]} />);
    if (r.status === 'verified') out.push(<OpForm key="cos" title="CoS approve" op="acctStep" fixed={{ id: r.id, step: 'cos' }} fields={[DECISION, REASON]} />);
  }
  if (r.kind === 'domainReq') {
    if (r.status === 'submitted') out.push(<OpForm key="ceo" title="CEO approve" op="domainStep" fixed={{ id: r.id, step: 'ceo' }} fields={[DECISION, REASON]} />);
    if (r.status === 'approved' && it)
      out.push(<OpForm key="b" title="Record the purchase" op="domainStep" fixed={{ id: r.id, step: 'bought' }} fields={[{ k: 'registrar', l: 'Registrar', t: 'select', o: ((b.settings?.registrars as string[]) ?? []) }, { k: 'registrant', l: 'Registrant (the company)' }, { k: 'autoRenew', l: 'Auto-renew', t: 'yn' }, { k: 'lock', l: 'Registrar lock', t: 'yn' }, { k: 'twoFa', l: 'Registrar 2FA', t: 'yn' }, { k: 'dns', l: 'DNS set', t: 'yn' }, { k: 'handover', l: 'Handover note' }]} />);
    if (r.status === 'bought' && it) out.push(<OpForm key="ac" title="Activate (M365 verification)" op="domainStep" fixed={{ id: r.id, step: 'active' }} fields={[{ k: 'verification', l: 'Microsoft 365 domain verification screenshot', t: 'photos' }]} />);
  }
  if (r.kind === 'webProject') {
    if (r.status === 'submitted' && it) out.push(<OpForm key="wc" title="IT check" op="webStep" fixed={{ id: r.id, step: 'check' }} fields={[REASON]} />);
    if (r.status === 'checked' && it) out.push(<OpForm key="we" title="Scope and cost estimate" op="webStep" fixed={{ id: r.id, step: 'estimate' }} fields={[{ k: 'scope', l: 'IT scope', t: 'area' }, { k: 'cost', l: 'Estimated cost (RM)', t: 'number' }, { k: 'buildDays', l: 'Build time (working days)', t: 'number' }, REASON]} />);
    if (r.status === 'estimated') out.push(<OpForm key="wceo" title="CEO approve cost and scope" op="webStep" fixed={{ id: r.id, step: 'ceo' }} fields={[DECISION, REASON]} />);
    if (r.status === 'content_ok' && it) out.push(<OpForm key="wb" title="Built and tested inside" op="webStep" fixed={{ id: r.id, step: 'built' }} fields={[{ k: 'previewUrl', l: 'Preview address (https://)' }, { k: 'internalTest', l: 'Internal test passed', t: 'check' }, REASON]} />);
  }
  if (r.kind === 'ip') {
    if (r.status === 'active' && it) out.push(<OpForm key="ia" title="Ask to decommission" op="ipDecommission" fixed={{ id: r.id, step: 'ask' }} fields={[REASON]} />);
    if (r.status === 'decommission_asked') out.push(<OpForm key="ic" title="CEO approve decommission" op="ipDecommission" fixed={{ id: r.id, step: 'ceo' }} fields={[REASON]} />);
  }
  return out.length ? <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{out}</div> : null;
}

/** The rental agreement terms as a page to print and sign outside Prima. */
function AgreementPrint({ r }: { r: Rec }) {
  const [open, setOpen] = useState(false);
  const d = r.d;
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(!open)}>
        {open ? 'Hide agreement' : 'Show agreement to print'}
      </button>
      {open && (
        <div className="panel print-area">
          <h3>Perjanjian Sewaan Peralatan IT {String(d.agreementNo || r.ref)}</h3>
          <p>Pihak A: Merdeka Network Sdn Bhd · Pihak B: syarikat {String(r.companyId ?? '')}</p>
          <ul className="small">
            <li>Mula {String(d.start)}{d.end ? `, tamat ${String(d.end)}` : ', berterusan sehingga ditamatkan'}</li>
            <li>Kadar: mengikut jadual kadar sewaan yang diluluskan ({d.rateBasis === 'year' ? 'setahun' : 'sebulan'}), dibilkan {String(d.billing)}</li>
            <li>Bayaran dalam {String(d.paymentDays)} hari dari invois</li>
            <li>Notis penamatan {String(d.noticeDays)} hari; tempoh membetulkan pelanggaran {String(d.cureDays ?? '-')} hari</li>
            <li>Penggantian peranti rosak dalam {String(d.replaceAfterDays ?? '-')} hari kerja; laporan kecacatan dalam {String(d.defectDays ?? '-')} hari</li>
            <li>Peranti dan aksesori dipulangkan dalam keadaan baik; yang hilang dicaj mengikut nilai buku</li>
          </ul>
          <p className="small">Ditandatangani untuk Pihak A: ______________ &nbsp; Pihak B: ______________ &nbsp; Saksi: ______________</p>
          <p className="muted small">Signed copies are filed in SharePoint and linked here. Prima does not sign or send the agreement.</p>
          <button className="btn btn-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      )}
    </>
  );
}

function PurchasesSection({ b }: { b: Board }) {
  const it = b.role === 'manager' || b.role === 'it';
  const rows = b.purchases ?? [];
  if (!rows.length) return null;
  return (
    <div className="panel">
      <h3>Pembelian IT: tempoh, sebut harga, bajet dan dokumen</h3>
      {rows.map((p) => (
        <div key={p.purchaseId} style={{ borderTop: '1px solid var(--line, #ddd)', padding: '6px 0' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong>{p.ref}</strong>
            {p.stage && (
              <span className="chip" data-tone={p.late ? 'crit' : 'ok'}>
                {p.stage}: {p.daysInStage} working day(s){p.late ? ' · lewat' : ''}
              </span>
            )}
            <span className="chip" data-tone={p.quotes.ok ? 'ok' : 'warn'}>
              {p.quotes.physical} physical + {p.quotes.online} online quote(s)
            </span>
            {p.route === 'b' && <span className="chip" data-tone={p.paidFirstUndelivered ? 'crit' : 'warn'}>bayaran dahulu{p.paidFirstUndelivered ? ' · not delivered yet' : ''}</span>}
            {p.budgetMissing && <span className="chip" data-tone="warn">no budget check</span>}
            {p.budget && <span className="chip">bajet {p.budget.available}</span>}
          </div>
          {p.comparison.length > 0 && (
            <table className="table small">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Type</th>
                  <th>RM</th>
                  <th>Warranty (mo)</th>
                  <th>Lead (days)</th>
                  <th>Technical fit</th>
                  <th>Capability</th>
                </tr>
              </thead>
              <tbody>
                {p.comparison.map((q) => (
                  <tr key={q.supplier + q.type}>
                    <td>
                      {q.supplier}
                      {p.recommendation?.supplier === q.supplier ? ' (recommended)' : ''}
                      {q.expired ? ' · expired' : ''}
                      {q.payFirst ? ' · pay first' : ''}
                    </td>
                    <td>{q.type}</td>
                    <td>{q.price.toFixed(2)}</td>
                    <td>{q.warrantyMonths}</td>
                    <td>{q.leadDays}</td>
                    <td>{q.technicalFit}</td>
                    <td>{q.capability}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.docsMissing.length > 0 && <div className="muted small">Documents still missing: {p.docsMissing.join(', ')} · keep until {p.keepUntil}</div>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {it && (
              <>
                <OpForm title="Technical assessment" op="assess" fixed={{ purchaseId: p.purchaseId }} fields={[{ k: 'brandModel', l: 'Recommended brand or model' }, { k: 'spec', l: 'Specification', t: 'area' }, { k: 'compatible', l: 'Compatible with our systems', t: 'yn' }, { k: 'compatibleNote', l: 'Compatibility note' }, { k: 'estCost', l: 'Estimated cost (RM)', t: 'number' }, { k: 'alternatives', l: 'Alternatives' }, { k: 'leadTime', l: 'Lead time' }, { k: 'security', l: 'Security notes' }, { k: 'buyAnywayReason', l: 'Reason to buy although spares exist' }]} />
                <QuotesForm purchaseId={p.purchaseId} />
                {p.comparison.length > 0 && <OpForm title="Recommend a supplier" op="recommend" fixed={{ purchaseId: p.purchaseId }} fields={[{ k: 'supplier', l: 'Supplier', t: 'select', o: [...new Set(p.comparison.map((q) => q.supplier))] }, { k: 'reason', l: 'Reason for the recommendation' }]} />}
                <OpForm title="Receive and inspect (GRN)" op="grn" fixed={{ purchaseId: p.purchaseId }} fields={[{ k: 'doNo', l: 'Delivery order number' }, { k: 'invoiceNo', l: 'Tax invoice number' }, { k: 'qty', l: 'Quantity received', t: 'number' }, { k: 'inspectedOn', l: 'Inspected on', t: 'date' }, { k: 'packageOk', l: 'Packaging intact', t: 'yn' }, { k: 'specOk', l: 'Matches the specification', t: 'yn' }, { k: 'physicalOk', l: 'No physical damage', t: 'yn' }, { k: 'functionOk', l: 'Works (function test)', t: 'yn' }, { k: 'accessoriesOk', l: 'Accessories complete', t: 'yn' }, { k: 'failedAssetIds', l: 'Asset ids that failed', t: 'list' }, { k: 'warrantyCert', l: 'Warranty certificate reference' }, { k: 'note', l: 'What does not match' }]} />
              </>
            )}
            {b.role === 'party' && <OpForm title="Budget check (Finance)" op="budget" fixed={{ purchaseId: p.purchaseId }} fields={[{ k: 'available', l: 'Budget available', t: 'select', o: ['yes', 'no'] }, { k: 'allocation', l: 'Budget line or allocation' }, { k: 'comment', l: 'Comment' }]} />}
          </div>
        </div>
      ))}
    </div>
  );
}

type QuoteRow = Record<string, string | number | boolean>;
function QuotesForm({ purchaseId }: { purchaseId: string }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const blank = (): QuoteRow => ({ supplier: '', type: 'physical', quoteNo: '', quoteDate: '', price: '', warrantyMonths: '', leadDays: '', expiresOn: '', technicalFit: '', capability: '', link: '', payFirst: false, payFirstTerms: '' });
  const [rows, setRows] = useState<QuoteRow[]>([blank(), blank(), blank(), { ...blank(), type: 'online' }]);
  const set = (i: number, k: string, x: string | boolean) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Record quotes
      </button>
    );
  const cols: [string, string, string?][] = [['supplier', 'Supplier'], ['quoteNo', 'Quote no.'], ['quoteDate', 'Date', 'date'], ['price', 'RM', 'number'], ['warrantyMonths', 'Warranty (mo)', 'number'], ['leadDays', 'Lead (days)', 'number'], ['expiresOn', 'Valid until', 'date'], ['technicalFit', 'Technical fit'], ['capability', 'Supplier capability'], ['link', 'Online link']];
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <strong>Quotes (3 physical + 1 online, rule IT-BUY)</strong>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          <Select className="select" aria-label="Quote type" value={String(r.type)} onChange={(e) => set(i, 'type', e.target.value)}>
            <option>physical</option>
            <option>online</option>
          </Select>
          {cols.map(([k, l, t]) => (
            <input key={k} className="input" style={{ maxWidth: 140 }} type={t ?? 'text'} aria-label={l} placeholder={l} value={String(r[k])} onChange={(e) => set(i, k, e.target.value)} />
          ))}
          <label className="small">
            <input type="checkbox" checked={r.payFirst === true} onChange={(e) => set(i, 'payFirst', e.target.checked)} /> pay first
          </label>
          {r.payFirst === true && <input className="input" aria-label="Payment terms" placeholder="Supplier's payment terms" value={String(r.payFirstTerms)} onChange={(e) => set(i, 'payFirstTerms', e.target.value)} />}
        </div>
      ))}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="btn btn-sm" onClick={() => setRows((p) => [...p, blank()])}>
          Add a quote
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={() =>
            void act
              .run(() => api.itAct('policyAct', { op: 'quoteInfo', purchaseId, quotes: rows.filter((r) => String(r.supplier).trim()).map((r) => ({ ...r, price: Number(r.price), warrantyMonths: Number(r.warrantyMonths), leadDays: Number(r.leadDays) })) }), 'Quotes saved.')
              .then((x) => x && setOpen(false))
          }
        >
          Save quotes
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

const ASSET_FIELDS: Field[] = [
  { k: 'assetId', l: 'Asset id' },
  { k: 'brand', l: 'Brand' },
  { k: 'category', l: 'Category' },
  { k: 'vendor', l: 'Vendor' },
  { k: 'poNo', l: 'PO number' },
  { k: 'invoiceNo', l: 'Invoice number' },
  { k: 'cost', l: 'Purchase cost (RM)', t: 'number' },
  { k: 'deployedOn', l: 'Deployed on', t: 'date' },
  { k: 'department', l: 'Department' },
  { k: 'amc', l: 'Maintenance contract (AMC)' },
  { k: 'processor', l: 'Processor' },
  { k: 'ram', l: 'RAM' },
  { k: 'storage', l: 'Storage' },
  { k: 'os', l: 'Operating system' },
  { k: 'conditionAtHandover', l: 'Condition at handover' },
  { k: 'custodianName', l: 'Custodian' },
  { k: 'location', l: 'Location' },
  { k: 'ackFormLink', l: 'Signed acknowledgement form link' },
  { k: 'accessories', l: 'Accessories issued (adapter, cable, dock, bag, keyboardMouse)', t: 'list' },
  { k: 'purchaseUnknown', l: 'Maklumat pembelian tiada (old asset, no purchase evidence)', t: 'check' },
  { k: 'note', l: 'Note' },
];

/** IT tools that start a record: register details, disposal, wipe, refurbish, end of life, agreements, M365, IP. */
function ItTools({ b }: { b: Board }) {
  const mgr = b.role === 'manager';
  return (
    <div className="panel">
      <h3>Rekod IT</h3>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <OpForm title="Butiran daftar aset" op="assetDetail" fields={ASSET_FIELDS} />
        <OpForm title="Mohon pelupusan" op="disposalAsk" fields={[{ k: 'assetId', l: 'Asset id' }, { k: 'reason', l: 'Reason', t: 'select', o: ['beyond_repair', 'end_of_life', 'obsolete', 'physical_damage'] }, { k: 'condition', l: 'Condition found' }]} />
        <OpForm title="Log pemadaman data" op="wipe" fields={[{ k: 'assetId', l: 'Asset id' }, { k: 'reason', l: 'Why', t: 'select', o: ['dispose', 'return', 'reissue', 'refurbish'] }, { k: 'method', l: 'Method', t: 'select', o: ['secure_erase', 'disk_destroyed', 'factory_reset', 'not_applicable'] }, { k: 'storageSerial', l: 'Disk serial' }, { k: 'evidence', l: 'Wipe tool report or photo', t: 'photos' }]} />
        <RefurbForm />
        <OpForm title="Penilaian akhir hayat" op="eol" fields={[{ k: 'assetId', l: 'Asset id' }, { k: 'outcome', l: 'Outcome', t: 'select', o: ['keep', 'refurbish', 'reassign', 'retire'] }, REASON]} />
        <ReturnForm />
        {mgr && <OpForm title="Perjanjian sewaan baharu" op="agreement" fields={[{ k: 'companyId', l: 'Company id' }, { k: 'agreementNo', l: 'Agreement number' }, { k: 'start', l: 'Start', t: 'date' }, { k: 'end', l: 'End (blank = until ended)', t: 'date' }, { k: 'rateBasis', l: 'Rate basis', t: 'select', o: ['month', 'year'] }, { k: 'billing', l: 'Billing', t: 'select', o: ['monthly', 'quarterly', 'yearly'] }, { k: 'paymentDays', l: 'Payment days (30)', t: 'number' }, { k: 'noticeDays', l: 'Notice days (30)', t: 'number' }, { k: 'cureDays', l: 'Days to fix a breach', t: 'number' }, { k: 'replaceAfterDays', l: 'Replace a faulty device within (working days)', t: 'number' }, { k: 'defectDays', l: 'Report a defect within (days)', t: 'number' }, REASON]} />}
        <OpForm title="Akaun M365 (daftar)" op="m365" fields={[{ k: 'type', l: 'Type', t: 'select', o: ['licensed', 'shared', 'service', 'guest'] }, { k: 'email', l: 'Email' }, { k: 'displayName', l: 'Display name' }, { k: 'ownerName', l: 'Owner (a person, by role)' }, { k: 'ownerUserId', l: 'Owner Prima user id' }, { k: 'department', l: 'Department' }, { k: 'licence', l: 'Licence', t: 'select', o: ((b.settings?.licences as string[]) ?? ['Business Basic', 'Business Standard', 'Business Premium', 'E3', 'none']) }, { k: 'createdOn', l: 'Created on', t: 'date' }, { k: 'approvalRef', l: 'Approval reference' }, { k: 'mfa', l: 'MFA registered', t: 'yn' }, { k: 'guestExpiry', l: 'Guest expiry', t: 'date' }, { k: 'onboardingId', l: 'Joiner checklist id' }, { k: 'trainingOn', l: 'Training given on', t: 'date' }, { k: 'status', l: 'Status', t: 'select', o: ['active', 'blocked', 'deleted'] }, { k: 'companyId', l: 'Company id' }, { k: 'note', l: 'Note' }]} />
        <OpForm title="Keselamatan domain" op="domainSec" fields={[{ k: 'domain', l: 'Domain' }, { k: 'lock', l: 'Registrar lock', t: 'yn' }, { k: 'twoFa', l: 'Registrar 2FA', t: 'yn' }, { k: 'note', l: 'Note' }]} />
        <OpForm title="Daftar harta intelek" op="ip" fields={[{ k: 'name', l: 'Asset name' }, { k: 'type', l: 'Type', t: 'select', o: ['logo', 'brand_guidelines', 'company_profile', 'presentation', 'brochure', 'template', 'marketing', 'digital_media', 'source_code', 'trademark', 'copyright', 'other'] }, { k: 'companyId', l: 'Owner company id' }, { k: 'description', l: 'Description' }, { k: 'custodian', l: 'Custodian (role)' }, { k: 'provider', l: 'Provider' }, { k: 'registeredOn', l: 'Registered on', t: 'date' }, { k: 'expiresOn', l: 'Expires on', t: 'date' }, { k: 'storageLink', l: 'SharePoint link' }, { k: 'accessWhere', l: 'Where access is kept (never the password)' }, { k: 'docs', l: 'Documents' }, { k: 'outsideApproved', l: 'Outside use approved', t: 'check' }]} />
        {mgr && <OpForm title="Tetapan polisi IT" op="setSettings" fields={[{ k: 'namingConvention', l: 'Asset naming convention' }, { k: 'licences', l: 'Microsoft 365 licence names', t: 'list' }, { k: 'registrars', l: 'Approved registrars', t: 'list' }, REASON]} />}
      </div>
    </div>
  );
}

const REFURB = ['hardware', 'cleaning', 'battery', 'disk', 'ramCpu', 'screenKeyboard', 'chargingPort', 'osReinstalled', 'securityUpdates', 'accountsRemoved', 'dataWiped', 'companySoftware', 'functionTest'] as const;
function RefurbForm() {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [parts, setParts] = useState('');
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Senarai semak baik pulih
      </button>
    );
  return (
    <div className="panel">
      <input className="input" aria-label="Asset id" placeholder="Asset id" value={assetId} onChange={(e) => setAssetId(e.target.value)} />
      {REFURB.map((k) => (
        <label key={k} className="small" style={{ marginRight: 8 }}>
          <input type="checkbox" checked={!!checks[k]} onChange={(e) => setChecks((p) => ({ ...p, [k]: e.target.checked }))} /> {k}
        </label>
      ))}
      <input className="input" aria-label="Parts replaced" placeholder="Parts replaced" value={parts} onChange={(e) => setParts(e.target.value)} />
      <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.itAct('policyAct', { op: 'refurb', assetId, checks, partsReplaced: parts }), 'Saved.').then((x) => x && setOpen(false))}>
        Save
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

const ACC = ['adapter', 'cable', 'dock', 'bag', 'keyboardMouse'] as const;
function ReturnForm() {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [returned, setReturned] = useState<Record<string, boolean>>({});
  const [condition, setCondition] = useState('');
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Peranti dipulangkan
      </button>
    );
  return (
    <div className="panel">
      <input className="input" aria-label="Asset id" placeholder="Asset id" value={assetId} onChange={(e) => setAssetId(e.target.value)} />
      {ACC.map((k) => (
        <label key={k} className="small" style={{ marginRight: 8 }}>
          <input type="checkbox" checked={!!returned[k]} onChange={(e) => setReturned((p) => ({ ...p, [k]: e.target.checked }))} /> {k} returned
        </label>
      ))}
      <input className="input" aria-label="Condition" placeholder="Condition found" value={condition} onChange={(e) => setCondition(e.target.value)} />
      <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.itAct('policyAct', { op: 'rentalReturn', assetId, returned, condition }), 'Return recorded.').then((x) => x && setOpen(false))}>
        Save
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

export function ItPolicyPanel() {
  const { data: b, error } = useLoad(() => api.itAct('policyAct', { op: 'board' }) as Promise<Board>, []);
  const [kind, setKind] = useState('ALL');
  if (error) return <ErrorNotice error={error} />;
  if (!b) return <Loading what="IT policies" />;
  const it = b.role === 'manager' || b.role === 'it';
  const recs = (b.records ?? []).filter((r) => r.kind !== 'settings' && (kind === 'ALL' || r.kind === kind));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="panel">
        <h3>Polisi IT Merdeka Network (berkuat kuasa {b.effective})</h3>
        <ul className="small">
          {b.docs.map((d) => (
            <li key={d.code}>
              {d.code}: {d.title}
            </li>
          ))}
        </ul>
        <p className="muted small">The signed BM copy and the checked English copy are kept in the HR policy library; staff acknowledge them there.</p>
      </div>
      <div className="panel">
        <h3>Dilarang / not allowed</h3>
        <ul className="small">
          {IT_FORBIDDEN_BM.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
      <MineSection b={b} />
      {it && <LateSection b={b} />}
      {b.role !== 'staff' && (
        <>
          <PurchasesSection b={b} />
          {it && <ItTools b={b} />}
          {(b.dues?.length ?? 0) > 0 && (
            <div className="panel">
              <h3>Kerja berkala aset</h3>
              <ul className="small">
                {b.dues!.slice(0, 50).map((d) => (
                  <li key={d.assetId + d.what}>
                    {d.tag}: {d.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(b.quarantine?.length ?? 0) > 0 && <p className="notice" data-tone="warn">Kuarantin: {b.quarantine!.join(', ')}</p>}
          {(b.noAgreement?.length ?? 0) > 0 && <p className="notice" data-tone="warn">Using Merdeka devices with no signed rental agreement: {b.noAgreement!.join(', ')}</p>}
          {(b.m365Review?.some((r) => r.problems.length) ?? false) && (
            <div className="panel">
              <h3>Semakan akaun M365</h3>
              <ul className="small">
                {b.m365Review!.filter((r) => r.problems.length).map((r) => (
                  <li key={r.id}>
                    {r.email} ({r.type}): {r.problems.join(', ')}
                  </li>
                ))}
              </ul>
              {(b.licenceUse ?? []).map((l) => (
                <div key={l.licence} className="muted small">
                  {l.licence}: {l.used} used{l.bought != null ? ` of ${l.bought} bought` : ''}
                </div>
              ))}
            </div>
          )}
          {(b.domainSecurity?.length ?? 0) > 0 && (
            <div className="panel">
              <h3>Keselamatan domain</h3>
              {b.domainSecurity!.map((d) => (
                <span key={d.domain} className="chip" data-tone={d.tone} style={{ marginRight: 6 }}>
                  {d.domain}: lock {d.lock}, 2FA {d.twoFa}
                </span>
              ))}
            </div>
          )}
          <div className="panel">
            <div className="row" style={{ gap: 6 }}>
              <h3>Rekod</h3>
              <Select className="select" aria-label="Record kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="ALL">All</option>
                {Object.entries(KIND_BM)
                  .filter(([k]) => k !== 'settings')
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </Select>
            </div>
            {b.wipeReadOnly && <p className="muted small">PDPA officer: the data wipe log, read only.</p>}
            {recs.length ? (
              <table className="table small">
                <tbody>
                  {recs.slice(0, 200).map((r) => (
                    <tr key={r.id}>
                      <td>{r.ref}</td>
                      <td>{KIND_BM[r.kind] ?? r.kind}</td>
                      <td>{r.status}</td>
                      <td>{summary(r)}</td>
                      <td>{!b.wipeReadOnly && <RecordActions r={r} b={b} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">No records.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
