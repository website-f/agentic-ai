import { M365_LINKS, type M365LinkId, type M365LinkState } from '@prima/core';
import { alertsConfiguration } from '../alerts/alerts';
import { m365Config } from '../connections-m365/service';
import { jobEmailApp } from '../connections-mail/job-email';
import { powerBiConfiguration } from '../connections-powerbi/power-bi';
import { entraConfig } from '../entra';
import { webConnectorConfig } from '../web-connectors';
import { usageGraphConfiguration } from './graph';

/**
 * Whether each Prima to Microsoft 365 link has its settings complete on this server. Reads settings only: it never
 * calls Microsoft, and it returns no setting values, only On, Partly or Off. A setting that is present but not valid
 * counts as Off. On means the settings are in place, not that a tenant grant or a database module was checked.
 */
export function m365LinkStates(env: NodeJS.ProcessEnv): Record<M365LinkId, M365LinkState> {
  const safe = (f: () => boolean): boolean => {
    try {
      return f();
    } catch {
      return false;
    }
  };
  const onOff = (b: boolean): M365LinkState => (b ? 'on' : 'off');
  let m365: ReturnType<typeof m365Config> | null = null;
  try {
    m365 = m365Config(env);
  } catch {
    m365 = null;
  }
  const parts = m365 ? [m365.enabled && !!m365.outlook, m365.enabled && !!m365.teams, m365.enabled && !!m365.sharepoint] : [];
  const hasProofHosts = !!env.SHAREPOINT_PROOF_HOSTS?.trim();
  return {
    entra_signin: onOff(safe(() => !!entraConfig(env))),
    alerts: onOff(safe(() => !!alertsConfiguration(env))),
    connections: parts.every(Boolean) && parts.length ? 'on' : parts.some(Boolean) ? 'partly' : 'off',
    // Proof links work in code today; until IT sets the group's host, any SharePoint address is accepted.
    sharepoint_proof: hasProofHosts ? 'on' : 'partly',
    job_email: onOff(safe(() => !!jobEmailApp(env))),
    teams_approvals: onOff(env.TEAMS_APPROVALS_READ === 'true'),
    // Only Planner-to-Prima is built; sending to Planner is still a stand-in, so this link is never fully On.
    planner: env.PLANNER_API_KEY?.trim() && env.PLANNER_SIGNING_SECRET?.trim() ? 'partly' : 'off',
    powerbi: onOff(safe(() => !!powerBiConfiguration(env))),
    website_requests: onOff(safe(() => webConnectorConfig(env).sharepoint)),
    usage_board: onOff(env.M365_USAGE_ENABLED === 'true' && (env.M365_USAGE_RUN_KEY ?? '').length >= 32 && safe(() => !!usageGraphConfiguration(env))),
  };
}

/** The list as shown on the board: what each link gives, its state and what is still needed. */
export function m365Links(env: NodeJS.ProcessEnv) {
  const states = m365LinkStates(env);
  return M365_LINKS.map((l) => ({ ...l, state: states[l.id] }));
}
