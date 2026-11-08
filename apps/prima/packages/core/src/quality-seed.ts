import type { CompAssessment } from "./quality";
import type { CompItem } from "./quality";
import type { CompProfile } from "./quality";
import type { QmsEntry } from "./quality";
import type { QmsFoundationItem } from "./quality";
import type { QmsRequirement } from "./quality";
import type { QmsSignal } from "./quality";
import { addDays } from "./time";
import { myt } from "./time";
import type { Dataset } from "./types";
import type { IsoDate } from "./types";
import type { PersonRole } from "./types";
import type { QmsItem } from "./quality-ops";
import type { QmsNonconformity } from "./quality-ops";
import type { SupplierRating } from "./quality-ops";



type Row = [ref: string, title: string, owner: string, workflow: string, area: string, signal: QmsSignal];

const ISO: Row[] = [
  ['4.1', 'Know the internal and external issues that affect the business', 'Chief Executive Officer', 'Governance risks (being built)', 'CORPORATE', 'foundation'],
  ['4.2', 'Know the interested parties and what they need (clients, KDN, staff, owners)', 'Chief Executive Officer', 'Client CRM; licences', 'CORPORATE', 'foundation'],
  ['4.3', 'Approved scope of the quality system, and any exclusions with reasons', 'Chief Executive Officer', 'This register (applicability)', 'CORPORATE', 'foundation'],
  ['4.4', 'Processes mapped with owners, inputs, outputs, measures and risks', 'Chief of Staff', 'Work KPIs (being built)', 'CORPORATE', 'foundation'],
  ['5.1', 'Top management leads and is accountable for the quality system', 'Chief Executive Officer', 'Meetings (management review)', 'CORPORATE', 'none'],
  ['5.1.2', 'Customer focus: client requirements and satisfaction kept in view', 'Company Manager', 'Client CRM; client reports', 'BILLING', 'none'],
  ['5.2', 'Quality policy approved, communicated and available', 'Chief Executive Officer', 'Memos; staff acknowledgements', 'CORPORATE', 'foundation'],
  ['5.3', 'Roles, responsibilities and authorities assigned and communicated', 'Chief of Staff', 'Staff directory; delegation limits', 'CORPORATE', 'none'],
  ['6.1', 'Risks and opportunities identified, actions planned and checked', 'ACT Director', 'Governance risk register (being built)', 'CORPORATE', 'none'],
  ['6.2', 'Quality objectives set, measured, with plans, owners and deadlines', 'Company Manager', 'Work KPIs (being built)', 'CORPORATE', 'none'],
  ['6.3', 'Changes to the quality system planned in a controlled way', 'Chief of Staff', 'Improvements (ACT)', 'CORPORATE', 'none'],
  ['7.1', 'Resources: people, premises, equipment, environment provided', 'Company Manager', 'Roster; assets; procurement', 'ROSTER', 'none'],
  ['7.1.5', 'Monitoring and measuring equipment fit for use, calibrated where needed', 'Company Manager', 'Assets (where measuring equipment applies)', 'ASSETS', 'none'],
  ['7.1.6', 'Knowledge needed for the work kept and shared', 'Chief of Staff', 'Post instructions; SOP library', 'CORPORATE', 'none'],
  ['7.2', 'Competence: what each role needs, assessed, with training and its effect checked', 'HR Director', 'Competency matrix (this screen)', 'LICENSING', 'competency'],
  ['7.3', 'Awareness: staff know the policy, objectives and their part', 'HR Director', 'Code of conduct acknowledgements', 'LICENSING', 'none'],
  ['7.4', 'Internal and external communication planned', 'Chief of Staff', 'Memos; client reports', 'CORPORATE', 'none'],
  ['7.5', 'Documented information controlled: approved, versioned, reviewed, kept', 'IT Manager', 'SharePoint proof by link (being built)', 'IT', 'none'],
  ['8.1', 'Operations planned and controlled to deliver the service', 'Company Manager', 'Contracts and mobilisation (being built)', 'ROSTER', 'none'],
  ['8.2', 'Client requirements reviewed before a contract is accepted', 'Company Manager', 'Client CRM; tenders', 'TENDERS', 'none'],
  ['8.3', 'Design and development controlled, where tailored solutions are designed', 'Operations Director', 'Where applicable only', 'CORPORATE', 'none'],
  ['8.4', 'Suppliers and outsourced work evaluated, monitored and re-evaluated', 'Procurement Executive', 'Procurement suppliers', 'PURCHASING', 'none'],
  ['8.5', 'Service delivered under control: instructions, competent staff, checks', 'Company Manager', 'Attendance, patrols, cases', 'PATROL', 'competency'],
  ['8.6', 'Service checked before it is released or handed over', 'Company Manager', 'Site readiness; client acknowledgement', 'ROSTER', 'none'],
  ['8.7', 'Nonconforming service contained, corrected and recorded', 'Company Manager', 'Complaints and cases', 'PATROL', 'none'],
  ['9.1', 'Performance monitored, measured, analysed and evaluated', 'Company Manager', 'Work KPIs (being built)', 'CORPORATE', 'none'],
  ['9.1.2', 'Client satisfaction monitored', 'Company Manager', 'Monthly client acknowledgement', 'BILLING', 'none'],
  ['9.2', 'Internal audits planned and done by competent, independent auditors', 'ACT Lead', 'ACT audit plan', 'CORPORATE', 'act_findings'],
  ['9.3', 'Management review held with the required inputs and decisions recorded', 'Chief Executive Officer', 'Meetings (being built)', 'CORPORATE', 'none'],
  ['10.2', 'Nonconformity and corrective action: contain, find the cause, fix, check it worked', 'ACT Lead', 'ACT findings', 'CORPORATE', 'act_findings'],
  ['10.3', 'Continual improvement', 'ACT Lead', 'ACT improvements', 'CORPORATE', 'none'],
];

// PIKM-KDN/SIRIM 1:2022 (draft), Code of practice for private security companies, Part 1: management. Received from
// Fauzan on 8 Nov 2026 (published draft on pikm.my). Clause numbers are the code's; titles are our own one-line summaries,
// not the code's text. Part 2 (security screening) is cited by the code but not received yet, so it stays a placeholder.
const PIKM: Row[] = [
  ['4.1', 'Follow the laws, regulations, directives and authority instructions that apply (the code lists them in Annex A)', 'Chief Executive Officer', 'Governance obligations; licences', 'CORPORATE', 'licences'],
  ['4.2', 'Top management sets policies and resources; licence kept valid, never rented out; branches opened only with approval', 'Chief Executive Officer', 'Licences; branches; company secretary', 'CORPORATE', 'licences'],
  ['5.1', 'Ownership: share split in writing, approved changes only, owners and directors screened and kept out of other agencies, records ready', 'Company Secretary', 'Company secretary; screening case file', 'CORPORATE', 'none'],
  ['5.2', 'Organisation structure with roles, authority and accountability defined', 'Chief of Staff', 'Staff directory; delegation limits', 'CORPORATE', 'none'],
  ['5.3', 'Finances: required paid-up capital, working capital and reserve, financial controls, audited yearly accounts', 'Finance Director', 'Finance; external audit', 'CORPORATE', 'none'],
  ['5.4', 'Insurance matched to the risks of the work (liability, fidelity, indemnity, motor and others); copies to clients on request', 'Finance Director', 'Insurance register', 'CORPORATE', 'none'],
  ['6.1', 'Competence: decided per role, ensured, gaps acted on and the effect checked, records kept, enough competent officers for each contract', 'HR Director', 'Competency matrix (this screen)', 'LICENSING', 'competency'],
  ['6.2', 'Communication inside and outside; service values for officers; a way to settle client feedback and complaints', 'Company Manager', 'Memos; service faults', 'PATROL', 'none'],
  ['6.3', 'Office or operations centre keeps records securely; alarm and CCTV with installer and service records; approval before moving or renaming', 'Company Manager', 'Assets; IT; licences', 'ASSETS', 'none'],
  ['6.4', 'Documents and records: known location, access by authorised people only, reviewed and approved, current copies where work is done, archived, backed up', 'Chief of Staff', 'Controlled documents (this screen)', 'IT', 'none'],
  ['7.1', 'Recruitment and employment: enough people, lawful pay, personal records with next of kin, PDPA, foreign worker rules, housing standards, checks before hiring, medicals (yearly from age 56)', 'HR Director', 'HR; screening case file; foreign workers; hostels', 'LICENSING', 'none'],
  ['7.2.1', 'Every security officer receives the code of conduct covering the duties the code lists', 'HR Director', 'Guard code of conduct acknowledgements', 'LICENSING', 'none'],
  ['7.2.2', 'Uniforms provided, within the rules, clean and tidy on duty', 'Company Manager', 'Equipment issue (stores)', 'PURCHASING', 'none'],
  ['7.2.3', 'Equipment used within the law, with procedures for its safety and control', 'Company Manager', 'Equipment; Arms Control', 'ARMS', 'none'],
  ['8.1', 'Training policy approved by top management; every officer CSG-qualified; training effect checked; training records kept', 'HR Director', 'Competency matrix; training log', 'LICENSING', 'competency'],
  ['8.2', 'Induction training by a competent person before an officer is deployed', 'HR Director', 'Competency matrix', 'LICENSING', 'competency'],
  ['8.3-8.5', 'On-site, specialised and in-service training as the contract and changes need', 'Company Manager', 'Competency matrix (refreshers)', 'LICENSING', 'competency'],
  ['8.6', 'Training for top management, supervisors and office staff', 'HR Director', 'Training log', 'LICENSING', 'none'],
  ['8.7', 'Shareholders and directors attend the courses the authorities run', 'Company Secretary', 'Company secretary', 'CORPORATE', 'none'],
  ['9.1', 'Quotation and terms agreed before service; the contract covers the listed terms; both sides keep a copy', 'Company Manager', 'Contracts', 'BILLING', 'none'],
  ['9.2', 'Due diligence on each client: a legitimate reason to need security', 'Company Manager', 'Client due diligence (client file)', 'BILLING', 'none'],
  ['9.3', 'Client information obtained, assessed and safeguarded; our licence, SSM, membership and insurance details given on request', 'Company Manager', 'Client file; company documents', 'BILLING', 'none'],
  ['9.4', 'Site risk assessment before deployment (Annex D checklist), recorded and told to the officers', 'Operations Manager', 'Mobilisation: site survey and risk', 'ROSTER', 'none'],
  ['9.5.1', 'Assignment instructions agreed with the client, changes endorsed by both, a copy at the site, required contents, officers briefed', 'Company Manager', 'Assignment instructions (contract)', 'ROSTER', 'none'],
  ['10', 'Management effectiveness monitored, measured and evaluated, with an improvement action plan', 'Chief Executive Officer', 'Management review; Work KPIs', 'CORPORATE', 'act_findings'],
  ['Part 2', 'Security screening of individuals (PIKM 2): text not received yet', 'HR Director', 'Screening case file', 'LICENSING', 'none'],
];

const PROFILES: Record<PersonRole, CompItem[]> = {
  guard: [
    { id: 'g-kdn', label: 'KDN guard card, or vetting submitted', kind: 'credential', credentialTypes: ['KDN_GUARD_CARD', 'KDN_VETTING'], refreshMonths: null },
    { id: 'g-csg', label: 'Certified Security Guard (CSG) training', kind: 'credential', credentialTypes: ['CSG_TRAINING'], refreshMonths: null },
    { id: 'g-access', label: 'Access control, visitor and vehicle log', kind: 'skill', refreshMonths: 12 },
    { id: 'g-report', label: 'Incident report and handover writing', kind: 'skill', refreshMonths: 12 },
    { id: 'g-emerg', label: 'Fire, first response and emergency steps', kind: 'skill', refreshMonths: 12 },
    { id: 'g-post', label: 'Knows the post instructions of the site', kind: 'skill', refreshMonths: 12 },
  ],
  supervisor: [
    { id: 's-kdn', label: 'KDN guard card, or vetting submitted', kind: 'credential', credentialTypes: ['KDN_GUARD_CARD', 'KDN_VETTING'], refreshMonths: null },
    { id: 's-csg', label: 'Certified Security Guard (CSG) training', kind: 'credential', credentialTypes: ['CSG_TRAINING'], refreshMonths: null },
    { id: 's-shift', label: 'Running a shift: briefing, posts, replacements', kind: 'skill', refreshMonths: 12 },
    { id: 's-inspect', label: 'Site inspection and guard checks', kind: 'skill', refreshMonths: 12 },
    { id: 's-incident', label: 'Incident handling and first investigation', kind: 'skill', refreshMonths: 12 },
  ],
  patrol_officer: [
    { id: 'p-kdn', label: 'KDN guard card, or vetting submitted', kind: 'credential', credentialTypes: ['KDN_GUARD_CARD', 'KDN_VETTING'], refreshMonths: null },
    { id: 'p-csg', label: 'Certified Security Guard (CSG) training', kind: 'credential', credentialTypes: ['CSG_TRAINING'], refreshMonths: null },
    { id: 'p-patrol', label: 'Patrol route checks and guard visits', kind: 'skill', refreshMonths: 12 },
    { id: 'p-incident', label: 'Incident handling and first investigation', kind: 'skill', refreshMonths: 12 },
  ],
  office: [
    { id: 'o-prima', label: 'Prima use and personal data care (PDPA)', kind: 'training', refreshMonths: 24 },
    { id: 'o-job', label: 'Core skills of the job, checked by the manager', kind: 'skill', refreshMonths: 12 },
  ],
};

const ROLE_NAME: Record<PersonRole, string> = { guard: 'Guard', supervisor: 'Officer (stationed)', patrol_officer: 'Patrolling officer', office: 'Office staff' };

/** The starter requirement list: ISO 9001:2015 and PIKM 1:2022 (draft) clauses with our own summaries; PIKM Part 2 stays a placeholder. */
export function starterRequirements(by: { by: string; byId: string }, at: string): QmsRequirement[] {
  const rows = (std: 'ISO9001' | 'PIKM', list: Row[]) =>
    list.map(
      ([ref, title, ownerTitle, workflow, actArea, signal]): QmsRequirement => ({
        id: `qr-${std.toLowerCase()}-${ref.replace(/[^0-9a-z]+/gi, '-').toLowerCase()}`,
        standard: std,
        edition: std === 'ISO9001' ? '2015' : '1:2022 draft',
        ref,
        title,
        placeholder: std === 'PIKM' && ref === 'Part 2',
        ownerTitle,
        workflow,
        actArea,
        signal,
        retired: false,
        ...by,
        at,
        history: [],
      }),
    );
  return [...rows('ISO9001', ISO), ...rows('PIKM', PIKM)];
}

/** Starter role profiles (version 1). On a real install they arrive as proposals for the HR Director. */
export function starterProfiles(proposed: { by: string; byId: string; at: string }): CompProfile[] {
  return (Object.keys(PROFILES) as PersonRole[]).map((role) => ({
    id: `cp-${role}-v1`,
    role,
    name: ROLE_NAME[role],
    version: 1,
    items: PROFILES[role],
    status: 'proposed',
    proposed: { ...proposed, note: 'Starting profile from the PIKM and ISO review (proposal for approval)' },
    decision: null,
  }));
}

export function seedQuality(ds: Dataset, today: IsoDate) {
  const at = (daysAgo: number) => myt(addDays(today, -daysAgo), '10:00');
  const act = ds.users.find((u) => u.id === 'u-audit');
  const actOther = ds.users.find((u) => u.id === 'u-act-aud2') ?? act;
  const hr = ds.users.find((u) => u.id === 'u-pwvsb-hr');
  const cos = ds.users.find((u) => u.leadership === 'cos');
  const by = { by: act?.name ?? 'ACT Lead (mock)', byId: act?.id ?? 'u-audit' };

  ds.qmsRequirements.push(...starterRequirements(by, at(1)));
  // In the test version the starter profiles show as already agreed (mock decision) so the matrix can be tried.
  for (const p of starterProfiles({ by: hr?.name ?? 'PWVSB HR', byId: hr?.id ?? 'u-pwvsb-hr', at: at(20) }))
    ds.compProfiles.push({ ...p, status: 'approved', decision: { by: cos?.name ?? 'Chief of Staff (mock)', byId: cos?.id ?? 'u-cos', at: at(19), note: 'Agreed as the starting point (mock)', agree: true } });

  // A few assessments in Sasa so the matrix shows each state.
  const sasa = ds.people.filter((p) => p.companyId === 'co-sasa' && p.status === 'active');
  const assessor = ds.users.find((u) => u.id === 'u-sv-sasa');
  const manager = ds.users.find((u) => u.id === 'u-cm-sasa');
  const guards = sasa.filter((p) => p.role === 'guard').slice(0, 12);
  guards.forEach((g, i) => {
    const items = PROFILES.guard.filter((x) => x.kind !== 'credential');
    items.forEach((item, j) => {
      if ((i + j) % 4 === 3) return; // some not assessed yet
      const competent = (i * 7 + j) % 9 !== 0;
      const daysAgo = i % 5 === 0 ? 350 : 20 + i * 3;
      const assessedOn = addDays(today, -daysAgo);
      const a: CompAssessment = {
        id: `ca-seed-${g.id}-${item.id}`,
        companyId: g.companyId,
        personId: g.id,
        itemId: item.id,
        profileVersion: 1,
        result: competent ? 'competent' : 'not_yet',
        method: j % 2 ? 'practical' : 'observation',
        note: competent ? 'Did it correctly on shift (mock)' : 'Needs coaching on the steps (mock)',
        evidenceRef: '',
        assessedOn,
        nextDueOn: competent && item.refreshMonths ? addDays(assessedOn, Math.round(item.refreshMonths * 30.44)) : null,
        afterTraining: i % 3 === 0 ? 'In-house refresher course (mock)' : null,
        assessor: assessor?.name ?? 'Site Officer (mock)',
        assessorId: assessor?.id ?? 'u-sv-sasa',
        at: myt(assessedOn, '15:00'),
      };
      ds.compAssessments.push(a);
    });
  });
  const office = sasa.filter((p) => p.role === 'office').slice(0, 3);
  office.forEach((o, i) =>
    ds.compAssessments.push({
      id: `ca-seed-${o.id}-o-job`,
      companyId: o.companyId,
      personId: o.id,
      itemId: 'o-job',
      profileVersion: 1,
      result: 'competent',
      method: 'interview',
      note: 'Handles billing and filing correctly (mock)',
      evidenceRef: '',
      assessedOn: addDays(today, -(40 + i * 10)),
      nextDueOn: addDays(today, -(40 + i * 10) + 365),
      afterTraining: null,
      assessor: manager?.name ?? 'Company Manager (mock)',
      assessorId: manager?.id ?? 'u-cm-sasa',
      at: at(40 + i * 10),
    }),
  );

  // Register entries for Sasa: one checked, one linked but not checked, one does not apply.
  const entry = (reqRef: string, companyId: string, patch: Partial<QmsEntry>): void => {
    const req = ds.qmsRequirements.find((r) => r.standard === 'ISO9001' && r.ref === reqRef);
    if (!req || !ds.companies.some((c) => c.id === companyId)) return;
    ds.qmsEntries.push({ id: `${req.id}--${companyId}`, companyId, requirementId: req.id, applies: true, appliesNote: null, evidence: [], gaps: [], reviews: [], ...patch });
  };
  entry('9.2', 'co-sasa', {
    evidence: [
      {
        id: 'qe-seed-1',
        kind: 'prima_record',
        label: 'ACT audit plan with the attendance audit done this half-year (mock)',
        ref: 'ACT audit plan, area ATTENDANCE',
        linkedBy: actOther?.name ?? 'ACT (mock)',
        linkedById: actOther?.id ?? 'u-act-aud2',
        at: at(12),
        check: { ...by, at: at(10), note: 'Plan and the audit record match (mock)', ok: true },
      },
    ],
  });
  entry('7.2', 'co-sasa', {
    evidence: [
      {
        id: 'qe-seed-2',
        kind: 'document',
        label: 'Sasa training calendar 2026 (mock)',
        ref: 'SharePoint: HR/Training/2026 calendar (mock link, content not checked)',
        linkedBy: manager?.name ?? 'Company Manager (mock)',
        linkedById: manager?.id ?? 'u-cm-sasa',
        at: at(3),
        check: null,
      },
    ],
  });
  // QMS foundation: scope agreed, a new policy waiting for the CEO, a few issues, parties and processes (all mock).
  const f = (x: Partial<QmsFoundationItem> & Pick<QmsFoundationItem, 'id' | 'kind' | 'title' | 'body'>, daysAgo: number): QmsFoundationItem => ({
    version: 1,
    status: 'active',
    decision: null,
    reviewEveryMonths: 12,
    lastReviewedOn: addDays(today, -daysAgo),
    ...by,
    at: at(daysAgo),
    history: [],
    ...x,
  });
  const ceo = ds.users.find((u) => u.opsTier === 'ceo');
  const cosBy = { by: cos?.name ?? 'Chief of Staff (mock)', byId: cos?.id ?? 'u-cos' };
  const req = (ref: string) => `qr-iso9001-${ref.replace(/\./g, '-')}`;
  ds.qmsFoundation.push(
    f({ id: 'qf-scope-v1', kind: 'scope', title: 'Scope (mock)', body: 'Manned guarding, patrol, CMS monitoring and security consultancy by the licensed companies of the group, with PWVSB central support departments (mock text for testing).', status: 'approved', decision: { by: ceo?.name ?? 'CEO', byId: ceo?.id ?? 'u-fauzan', at: at(30), note: 'Agreed for the pilot (mock)', agree: true } }, 30),
    f({ id: 'qf-policy-v1', kind: 'policy', title: 'Quality policy (mock)', body: 'We deliver the security service agreed with each client, with licensed and competent people, check our own work, learn from complaints and keep improving (mock text for testing).', status: 'draft', ...cosBy }, 2),
    f({ id: 'qf-issue-1', kind: 'issue', side: 'external', title: 'Licence renewals and new KDN rules (mock)', body: 'Changes to licensing rules can stop guards from being deployed (mock).' }, 40),
    f({ id: 'qf-issue-2', kind: 'issue', side: 'internal', title: 'Guard turnover (mock)', body: 'New guards need training before they are fully competent (mock).' }, 400),
    f({ id: 'qf-party-1', kind: 'party', title: 'Clients (mock)', body: '', needs: 'Posts covered, incidents reported quickly, monthly reports (mock)', monitor: 'Monthly client acknowledgement and complaints (mock)' }, 40),
    f({ id: 'qf-party-2', kind: 'party', title: 'KDN (mock)', body: '', needs: 'Licensed company, vetted guards, records kept (mock)', monitor: 'Licences screen and vetting status (mock)' }, 40),
    f({ id: 'qf-proc-1', kind: 'process', title: 'Recruit, vet and train guards (mock)', body: 'From job post to first shift (mock).', ownerTitle: 'HR Director', inputs: 'Vacancy, applicants (mock)', outputs: 'Vetted, trained guard on the roster (mock)', measures: 'Days to fill a post (mock)', risks: 'Unvetted guard deployed (mock)', requirementIds: [req('7.2'), 'qr-pikm-7-1'] }, 40),
    f({ id: 'qf-proc-2', kind: 'process', title: 'Deliver guarding at a site (mock)', body: 'Roster, attendance, patrols and incidents (mock).', ownerTitle: 'Company Manager', inputs: 'Contract and post instructions (mock)', outputs: 'Posts covered and reported (mock)', measures: 'Posts covered on time (mock)', risks: 'Post left empty (mock)', requirementIds: [req('8.5')] }, 40),
    f({ id: 'qf-proc-3', kind: 'process', title: 'Handle complaints (mock)', body: 'Client complaint to closure (mock).', ownerTitle: 'Company Manager', inputs: 'Client complaint (mock)', outputs: 'Fixed and confirmed with the client (mock)', measures: 'Days to close (mock)', risks: 'Repeat complaint (mock)', requirementIds: [] }, 40),
  );
  entry('8.3', 'co-sasa', { applies: false, appliesNote: { ...by, at: at(5), note: 'Sasa runs standard guarding only; no tailored design work (mock)' } });

  // Quality operations (all mock): two faults at the same Sasa site (the second a repeat), one closed fault, a few
  // objectives, two controlled documents (one in force, one new version waiting) and a supplier rating.
  const sasaSites = ds.sites.filter((x) => x.companyId === 'co-sasa');
  const site = sasaSites[0];
  if (site && manager) {
    const mb = { by: manager.name, byId: manager.id };
    const nc = (x: Partial<QmsNonconformity> & Pick<QmsNonconformity, 'id' | 'ref' | 'what' | 'detectedOn'>, daysAgo: number): QmsNonconformity => ({
      companyId: 'co-sasa',
      siteId: site.id,
      source: 'client_complaint',
      sourceRef: '',
      serious: false,
      correction: 'Relief guard sent within the hour (mock)',
      clientTold: true,
      clientNote: 'Called the client facility manager (mock)',
      repeatOf: [],
      rootCause: null,
      status: 'open',
      close: null,
      ...mb,
      at: at(daysAgo),
      history: [],
      ...x,
    });
    ds.qmsNonconformities.push(
      nc({ id: 'nc-seed-1', ref: 'SF-0001', what: 'Night post left empty for 40 minutes at shift change (mock)', detectedOn: addDays(today, -20), status: 'closed', close: { ...mb, at: at(18), note: 'Shift handover moved to the post itself (mock)', outcome: 'corrected', clientName: '' } }, 20),
      nc({ id: 'nc-seed-2', ref: 'SF-0002', what: 'Post left empty again at the 7pm change (mock)', detectedOn: addDays(today, -3), repeatOf: ['nc-seed-1'] }, 3),
      nc({ id: 'nc-seed-3', ref: 'SF-0003', detectedOn: addDays(today, -6), siteId: sasaSites[1]?.id ?? site.id, source: 'site_visit', what: 'Visitor log not filled in for two days (mock)', clientTold: false, clientNote: '', correction: 'Officer briefed the guards; log filled from the CCTV list (mock)' }, 6),
    );
  }
  const keeper = { by: cos?.name ?? 'Chief of Staff (mock)', byId: cos?.id ?? 'u-cos' };
  const qi = (x: Partial<QmsItem> & Pick<QmsItem, 'id' | 'kind' | 'title'>, daysAgo: number): QmsItem => ({
    body: '',
    status: 'active',
    version: 1,
    decision: null,
    reviewEveryMonths: 12,
    lastReviewedOn: addDays(today, -daysAgo),
    ...by,
    at: at(daysAgo),
    history: [],
    ...x,
  });
  ds.qmsItems.push(
    qi({ id: 'qi-objective-seed-1', kind: 'objective', title: 'Posts covered on time (mock)', measure: 'Shifts started on time / shifts rostered', target: '98% each month', ownerTitle: 'Company Manager', dueOn: addDays(today, 120), progress: [{ on: addDays(today, -5), value: '96.4%', note: 'October (mock)', ...by, at: at(5) }] }, 30),
    qi({ id: 'qi-objective-seed-2', kind: 'objective', title: 'Client complaints closed within 5 working days (mock)', measure: 'Complaints closed in 5 days / complaints', target: '90%', ownerTitle: 'Company Manager', dueOn: addDays(today, -10), progress: [] }, 60),
    qi({ id: 'qi-doc-SOP-OPS-01-v1', kind: 'document', title: 'Shift handover procedure (mock)', code: 'SOP-OPS-01', ownerTitle: 'Operations Director', link: 'https://example.invalid/sites/quality/SOP-OPS-01-v1.docx', audience: 'Officers and company managers', reviewEveryMonths: 24, status: 'approved', decision: { ...keeper, at: at(200), note: 'Matches how sites work (mock)', agree: true } }, 200),
    qi({ id: 'qi-doc-SOP-OPS-01-v2', kind: 'document', title: 'Shift handover procedure (mock)', code: 'SOP-OPS-01', version: 2, ownerTitle: 'Operations Director', link: 'https://example.invalid/sites/quality/SOP-OPS-01-v2.docx', audience: 'Officers and company managers', reviewEveryMonths: 24, status: 'draft', body: 'Handover now happens at the post, not the guard room (mock).' }, 1),
    qi({ id: 'qi-doc-FRM-HR-03-v1', kind: 'document', title: 'Guard induction checklist (mock)', code: 'FRM-HR-03', ownerTitle: 'HR Director', link: 'https://example.invalid/sites/quality/FRM-HR-03.xlsx', audience: 'HR', reviewEveryMonths: 12, status: 'approved', decision: { ...keeper, at: at(400), note: 'Agreed (mock)', agree: true } }, 400),
  );
  const sup = ds.purSuppliers.find((x) => x.companyId === 'co-sasa' && !x.blocked);
  if (sup && manager)
    (sup as typeof sup & { performance?: SupplierRating[] }).performance = [
      { on: addDays(today, -400), quality: 4, onTime: 3, paperwork: 4, issues: 'One late delivery (mock)', result: 'watch', by: manager.name, byId: manager.id, at: at(400) },
    ];
}