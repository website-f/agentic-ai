// Sample data for the pilot shape (Jayapadu Bersatu Kawalan vault and one gated site, plan section 8). Made-up people and
// phone numbers only; real data comes from Prima's directory push.
import type { Directory } from './directory';

export function demoDirectory(now = new Date()): Directory {
  const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
  const p = (name: string, n: number) => ({ name, phone: `+60 3-0000 ${String(n).padStart(4, '0')}` });
  return {
    asOf: now.toISOString(),
    companies: [
      {
        id: 'co-jbk',
        name: 'Jayapadu Bersatu Kawalan Sdn Bhd',
        contacts: { company_manager: p('Sample Company Manager', 1), company_oncall: p('Sample On-call Officer', 2), operations_manager: p('Sample OM', 3), regional_om: p('Sample Regional OM', 4) },
      },
    ],
    sites: [
      {
        id: 'site-jbk-vault',
        companyId: 'co-jbk',
        name: 'JBK armoury',
        sector: 'private',
        contacts: { armoury_keeper: p('Sample Armoury Keeper', 10), a_licence_holder: p('Sample A-licence Holder', 11), site_post: p('Armoury guard post', 12) },
      },
      {
        id: 'site-jbk-plaza',
        companyId: 'co-jbk',
        name: 'Sample Plaza (gated site)',
        sector: 'private',
        clockInGraceMin: 15,
        contacts: {
          site_supervisor: p('Sample Site Supervisor', 20),
          gate_guard: p('Main gate guard post', 21),
          site_post: p('Guardhouse', 22),
          patrolling_officer: p('Sample Patrolling Officer', 23),
          building_management: p('Sample Building Management', 24),
          guard: p('Guard on duty (post phone)', 25),
        },
      },
    ],
    devices: [
      { id: 'cam-vault-1', siteId: 'site-jbk-vault', kind: 'camera', silentAfterMin: 10 },
      { id: 'nvr-vault', siteId: 'site-jbk-vault', kind: 'recorder', silentAfterMin: 10 },
      { id: 'panel-vault', siteId: 'site-jbk-vault', kind: 'alarm_panel', account: '1234', silentAfterMin: 30 },
      { id: 'cam-gate-1', siteId: 'site-jbk-plaza', kind: 'camera', silentAfterMin: 10 },
      { id: 'anpr-gate-in', siteId: 'site-jbk-plaza', kind: 'anpr', silentAfterMin: 30 },
      { id: 'gate-main', siteId: 'site-jbk-plaza', kind: 'gate', silentAfterMin: 30 },
      { id: 'panel-plaza', siteId: 'site-jbk-plaza', kind: 'alarm_panel', account: '5678', silentAfterMin: 30 },
      { id: 'trk-cit-1', siteId: 'site-jbk-vault', kind: 'tracker', silentAfterMin: 10 },
    ],
    shifts: [
      { id: 'sh-1', siteId: 'site-jbk-plaza', postName: 'Main gate', guardId: 'g-1', guardName: 'Sample Guard A', start: at(-30), end: at(690) },
      { id: 'sh-2', siteId: 'site-jbk-plaza', postName: 'Lobby', guardId: 'g-2', guardName: 'Sample Guard B', start: at(-5), end: at(715) },
    ],
    patrolRounds: [{ id: 'pr-1', siteId: 'site-jbk-plaza', checkpointId: 'cp-carpark', checkpointName: 'Car park B2', guardId: 'g-2', dueAt: at(-20), lateAfterMin: 10 }],
    group: {
      arms_control: p('Sample Arms Control Manager', 90),
      operations_director: p('Sample Operations Director', 91),
      ogm: p('Sample OGM', 92),
      coo: p('Sample COO', 93),
      ceo: p('Sample CEO', 94),
      transport_head: p('Sample Transport Head', 95),
      it: p('Sample IT helpdesk', 96),
    },
  };
}
