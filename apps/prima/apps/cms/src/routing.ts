// "Who CMS tells" (CMS plan, Fauzan 2 Nov 2026: CMS is the 24/7 command centre and tells the right place what is needed).
// CMS tells; the company decides and acts. Every alert repeats until someone acts. Above the Regional OM a problem goes
// only by escalation that an operator chooses: OGM (government) or Operations Director (private), then COO, then CEO.
import type { EventKind } from './event';
import type { DirectoryIndex, Role, Sector } from './directory';

export interface Step {
  /** Tell every role listed; for a role list in `anyOf`, tell the first one that has a person. */
  roles: Role[];
  anyOf?: Role[];
  /** Minutes after the alarm opened that this step starts. */
  atMin: number;
}

export interface RoutePlan {
  steps: Step[];
  /** Tell the current step again every this many minutes until someone acts. */
  repeatMin: number;
  /** What CMS asks the person to do. */
  ask: string;
  /** A note shown to the operator, e.g. a Prima rule that applies. */
  note?: string;
}

/**
 * Times marked PROPOSED are not set by Fauzan yet. Set by him: attendance alert repeats every 5 minutes (rule
 * ATT-ALERT-REPEAT); firearm overdue alert at 15 minutes, Arms Control at 30, loss case at 120 (approved 1 Nov 2026).
 */
export const ESCALATE_AFTER_MIN = 15; // PROPOSED
export const DEFAULT_REPEAT_MIN = 5;

const ladder = (first: Omit<Step, 'atMin'>, ...next: Role[][]): Step[] => [
  { ...first, atMin: 0 },
  ...next.map((roles, i) => ({ roles, atMin: ESCALATE_AFTER_MIN * (i + 1) })),
];

const alarmPlan: RoutePlan = {
  steps: ladder({ roles: ['site_post', 'company_oncall'] }, ['operations_manager'], ['regional_om']),
  repeatMin: DEFAULT_REPEAT_MIN,
  ask: "Respond under the company's SOP; call the police or Bomba as that SOP says.",
};

export const ROUTES: Partial<Record<EventKind, RoutePlan>> = {
  GUARD_NO_SHOW: {
    steps: ladder({ roles: [], anyOf: ['site_supervisor', 'company_manager'] }, ['operations_manager'], ['regional_om']),
    repeatMin: 5,
    ask: 'Send a replacement or buffer guard to the post.',
    note: 'ATT-ALERT-REPEAT: repeats every 5 minutes until acted on.',
  },
  GUARD_LEFT_POST: {
    steps: ladder({ roles: [], anyOf: ['site_supervisor', 'company_manager'] }, ['operations_manager'], ['regional_om']),
    repeatMin: 5,
    ask: 'Check the guard and cover the post.',
  },
  PATROL_MISSED: {
    steps: ladder({ roles: ['guard'] }, ['patrolling_officer'], ['operations_manager'], ['regional_om']),
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Check the guard and the site, and record the reason.',
  },
  INTRUSION: alarmPlan,
  PANIC: alarmPlan,
  TAMPER: alarmPlan,
  DOOR_FORCED: alarmPlan,
  FIRE: {
    steps: ladder({ roles: ['site_post', 'building_management'] }, ['company_oncall']),
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Check and evacuate per the site SOP. CMS never controls fire systems.',
  },
  VAULT_DOOR_UNMATCHED: {
    steps: ladder({ roles: ['armoury_keeper', 'a_licence_holder'] }, ['arms_control'], ['coo']),
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Explain the vault opening or check the vault (ARMS-DOOR-MATCH, 15 minutes).',
  },
  VAULT_WATCH_MISSED: {
    steps: ladder({ roles: ['armoury_keeper', 'a_licence_holder'] }, ['arms_control'], ['coo']),
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Check in on the vault watch (ARMS-VAULT-WATCH, every 60 minutes).',
  },
  FIREARM_OVERDUE: {
    // Raised 15 minutes after the firearm was due back; Arms Control 15 minutes later (30 after due).
    steps: [
      { roles: ['guard', 'site_supervisor'], atMin: 0 },
      { roles: ['arms_control'], atMin: 15 },
    ],
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Return the firearm to the vault, or report where it is.',
    note: 'Prima opens a loss case 120 minutes after the firearm was due (Arms Act s.7: report within 14 days).',
  },
  GATE_PLATE_UNKNOWN: {
    steps: ladder({ roles: ['gate_guard'] }, ['site_supervisor']),
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Check the driver before the gate opens.',
  },
  GATE_PLATE_BLOCKED: {
    steps: ladder({ roles: ['gate_guard', 'site_supervisor'] }, ['company_oncall']),
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Keep the gate closed and check the driver.',
  },
  VEHICLE_PANIC: {
    steps: [{ roles: ['cit_crew_leader', 'company_oncall', 'transport_head', 'arms_control'], atMin: 0 }],
    repeatMin: 2, // PROPOSED: a CIT panic is called again sooner
    ask: 'Contact the crew now and respond under the CIT SOP.',
  },
  VEHICLE_OFF_ROUTE: {
    steps: ladder({ roles: ['cit_crew_leader'] }, ['transport_head', 'company_oncall'], ['arms_control']),
    repeatMin: DEFAULT_REPEAT_MIN,
    ask: 'Contact the crew and confirm the route.',
  },
  VEHICLE_SPEEDING: {
    steps: ladder({ roles: ['cit_crew_leader'] }, ['transport_head']),
    repeatMin: 15, // PROPOSED
    ask: 'Tell the driver to slow down.',
  },
  DRIVER_OVER_HOURS: {
    steps: ladder({ roles: ['cit_crew_leader'] }, ['transport_head', 'company_oncall']),
    repeatMin: 15, // PROPOSED
    ask: 'Change the driver or take the break (JPJ: 8 hours a day, 30 minutes after 4 hours).',
  },
  DEVICE_OFFLINE: {
    steps: ladder({ roles: ['site_supervisor'] }, ['company_manager', 'it']),
    repeatMin: 30, // PROPOSED
    ask: 'Restore the device. The site shows as not live until then.',
  },
};

/** Who is told at one moment. */
export interface Recipient {
  role: Role;
  name: string;
  phone: string;
}

/** The people for one step at a site. A role with nobody behind it is reported as missing, never silently skipped. */
export function recipients(step: Step, siteId: string, dir: DirectoryIndex): { to: Recipient[]; missing: Role[] } {
  const to: Recipient[] = [];
  const missing: Role[] = [];
  for (const role of step.roles) {
    const c = dir.contact(siteId, role);
    if (c) to.push({ role, ...c });
    else missing.push(role);
  }
  if (step.anyOf?.length) {
    const role = step.anyOf.find((r) => dir.contact(siteId, r));
    if (role) to.push({ role, ...dir.contact(siteId, role)! });
    else missing.push(...step.anyOf);
  }
  return { to, missing };
}

/** The step in force a given number of minutes after the alarm opened. */
export function stepAt(plan: RoutePlan, minutesOpen: number): number {
  let idx = 0;
  plan.steps.forEach((s, i) => {
    if (s.atMin <= minutesOpen) idx = i;
  });
  return idx;
}

/** Above the Regional OM: chosen by the operator, never automatic. */
export function manualLadder(sector: Sector): Role[] {
  return [sector === 'government' ? 'ogm' : 'operations_director', 'coo', 'ceo'];
}
