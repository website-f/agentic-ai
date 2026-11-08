import { toMs } from "./time";
import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * CMS site readiness on the Work KPIs screen (audit decision 4; Fauzan, 5 Nov 2026: "Kpi will be done for all").
 * Read-only, no migration.
 *
 * Arms Control's check is timed from when the site's last item was recorded (the readiness reaching the checker) to the
 * pass. Recording the devices and preparations is the company's and the site's, but Prima keeps no time the work was
 * asked for, so it is not timed. Prima keeps only the latest return, so earlier returns are Unknown. A pass means ready
 * to connect, never connected.
 */
registerWorkKpiAdapter({
  id: 'cms-readiness',
  depts: ['arms_control'],
  tables: ['sites'],
  targets: { 'arms_control.cms_readiness.check': 960 },
  limits: {
    arms_control: {
      unknown: [
        'Recording a site’s devices and preparations: Prima does not record when the site was asked, so it is not timed',
        'Earlier returns of a site’s readiness: only the latest is kept, so first pass is Unknown',
      ],
      notTimed: [],
    },
  },
  collect(data, put) {
    for (const s of data.sites ?? []) {
      const r = s.cmsReadiness;
      if (!r?.check) continue;
      const items = [...r.devices.map((d) => d.at), ...Object.values(r.answers).map((a) => a?.at)].filter((x): x is string => !!x);
      const last = items.sort((a, b) => toMs(a) - toMs(b)).pop();
      if (!last || toMs(last) > toMs(r.check.at)) continue;
      put.step({ dept: 'arms_control', workflow: 'cms_readiness', stage: 'check', kind: 'check', recordId: s.id, companyId: s.companyId, byId: r.check.byId, by: r.check.by, arrivedAt: last, doneAt: r.check.at });
      put.finished({ dept: 'arms_control', workflow: 'cms_readiness', recordId: s.id, companyId: s.companyId, preparer: null, finishedAt: r.check.at, returns: null, reopens: null, evidenceComplete: null, requesterConfirmed: null });
    }
  },
});