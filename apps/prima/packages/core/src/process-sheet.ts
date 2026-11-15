// V13 (Part V, Fauzan 14 Nov 2026 V-X8 "Yes", after 18 Nov): one read-only "Proses" page listing each workflow rule
// Prima holds, with its owner, who approves, the linked papers, the records kept and the time targets. Everything is
// read from what Prima already holds (rules.ts and the policy paper lists); nothing is retyped and nothing is saved.
import { ARMS_POLICY_DOCS } from './arms-policy-service';
import { IT_POLICY_DOCS } from './it-policy-service';
import { RENTAL_POLICY_DOCS } from './am-rental';
import { RULES, type RuleLabel } from './rules';

/** The department that owns each family of rules (by the rule id's first part). Unlisted = "Group management". */
const OWNER: Record<string, string> = {
  HR: 'HR', EA: 'HR', LEAVE: 'HR', PAY: 'HR and Finance (payroll)', MEMO: 'Chief of Staff', OSH: 'HR (OSH)',
  QMS: 'Operations (quality)', OPS: 'Operations', ROSTER: 'Operations', ATT: 'Operations', CASE: 'Operations', SITE: 'Operations', CLEAN: 'Operations', SURVEY: 'Operations',
  CMS: 'Arms Control (CMS)', ARMS: 'Arms Control', FWM: 'FWM', FW: 'FWM', AM: 'Asset Management', AST: 'Asset Management',
  IT: 'IT (Merdeka Network)', PILOT: 'IT (Merdeka Network)', FIN: 'Finance', CRD: 'Finance (credit)', INS: 'Finance (insurance)', CTL: 'Finance',
  PUR: 'Procurement', INV: 'Procurement (inventory)', GOV: 'Government Operations', ACT: 'ACT', AUD: 'ACT', PDPA: 'PDPA officer',
  TENDER: 'Director Office', MTG: 'Director Office', RPT: 'Director Office', COR: 'Central Admin (company secretary)', REG: 'Central Admin', KDN: 'Central Admin (licensing)',
  CNT: 'Commercial', CRM: 'Commercial', CLIENT: 'Commercial', COM: 'Commercial', BRANCH: 'Branches', BRN: 'Branches', FLEET: 'Transport',
  WORK: 'Company and department heads', COO: 'COO', SEC: 'Group management', BCM: 'Group management', RBA: 'ACT', EVID: 'Operations', JA: 'IT and HR', SYS: 'IT', TOOLBOX: 'Company and department heads', ALERT: 'Operations',
};

/** Words in a rule's source that say who approves (shown as written; the server enforces the actual approver). */
const APPROVERS = ['CEO', 'COO', 'Vice Chairman', 'Chairman', 'Chief of Staff', 'CoS', 'Finance Director', 'Asset Director', 'Operations Director', 'OGM', 'IT Manager', 'HR Director', 'company manager', 'Arms Control Manager', 'FWM'];

export interface ProcessRow {
  key: string;
  ruleId: string;
  label: RuleLabel;
  owner: string;
  approvers: string[];
  /** Time targets found in the rule's values (keys with Days, Hours, Minutes, Months or Weeks). */
  targets: { name: string; value: string }[];
  /** Records kept, years (keys with keep, retention or Years). */
  keepYears: string[];
  source: string;
}

const isTarget = (k: string) => /(days|hours|minutes|months|weeks)/i.test(k) && !/keep|retention/i.test(k);
const isKeep = (k: string) => /keep|retention|years/i.test(k);

function flatten(prefix: string, v: unknown, out: [string, unknown][], depth = 0) {
  if (depth > 2) return;
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(prefix ? `${prefix}.${k}` : k, x, out, depth + 1);
  else out.push([prefix, v]);
}

/** Pure: the process sheet from the rules and the paper lists Prima holds. */
export function processSheet(): { rows: ProcessRow[]; papers: { owner: string; code: string; title: string }[] } {
  const rows: ProcessRow[] = [];
  for (const [key, r] of Object.entries(RULES) as [string, { id: string; value: unknown; label: RuleLabel; source: string }][]) {
    const vals: [string, unknown][] = [];
    flatten('', r.value, vals);
    const show = (x: unknown) => (Array.isArray(x) ? x.join(', ') : x == null ? 'belum ditetapkan' : String(x));
    rows.push({
      key,
      ruleId: r.id,
      label: r.label,
      owner: OWNER[r.id.split('-')[0]] ?? 'Group management',
      approvers: APPROVERS.filter((a) => new RegExp(`\\b${a.replace(/ /g, '\\s+')}\\b`).test(r.source)),
      targets: vals.filter(([k, x]) => k && isTarget(k) && (typeof x === 'number' || x == null || Array.isArray(x))).slice(0, 12).map(([k, x]) => ({ name: k, value: show(x) })),
      keepYears: vals.filter(([k, x]) => k && isKeep(k) && typeof x === 'number').map(([k, x]) => `${k}: ${x}`),
      source: r.source,
    });
  }
  const papers = [...IT_POLICY_DOCS.map((d) => ({ owner: 'IT (Merdeka Network)', code: d.code, title: d.title })), ...ARMS_POLICY_DOCS.map((d) => ({ owner: 'Arms Control', code: d.code, title: d.title })), ...RENTAL_POLICY_DOCS.map((d) => ({ owner: 'Asset Management', code: d.code, title: d.title }))];
  return { rows: rows.sort((a, b) => a.owner.localeCompare(b.owner) || a.ruleId.localeCompare(b.ruleId)), papers };
}
