import type { IsoDateTime, StockRequest } from './types';
import { registerWorkKpiAdapter } from './work-kpi';

/**
 * Part U7 (Fitri package, 14 Nov 2026): the site supplies request stages on the Work KPIs screen, read from the steps
 * the request already keeps. Order (submitted to OGM approval), Receiving (approval to stock checked), Preparation
 * (stock checked to ready for delivery, the store's U6 stage) and Delivery (ready to Siap). Targets stay empty until
 * the OGM sets them after a month of data (U-X5); the 7 working days for in-stock lines (U-X11) shows on the board.
 * Read-only, no migration.
 */
type Step = { step: string; by: string; byId: string; at: IsoDateTime };
type Stage = { stage: string; by: string; byId: string; at: IsoDateTime };

registerWorkKpiAdapter({
  id: 'inventory-supplies',
  depts: ['procurement'],
  tables: ['stockRequests'],
  targets: {
    'procurement.site_supplies.order': null,
    'procurement.site_supplies.receiving': null,
    'procurement.site_supplies.preparation': null,
    'procurement.site_supplies.delivery': null,
  },
  limits: {
    procurement: {
      unknown: ['A line sent to purchase waits for the goods; its receiving time runs to the goods received note, which the purchase keeps'],
      notTimed: ['Draft requests, refused and cancelled requests'],
    },
  },
  collect(data, put) {
    for (const r of (data.stockRequests ?? []) as StockRequest[]) {
      if (r.kind !== 'site_supplies' || !r.ss) continue;
      const d = r.ss as { steps?: Step[]; storeStages?: Stage[]; status?: string };
      const steps = d.steps ?? [];
      const at = (k: string) => steps.find((x) => x.step === k) ?? null;
      const sub = at('submit');
      const appr = at('confirm');
      const chk = at('stock_check');
      const ready = (d.storeStages ?? []).find((x) => x.stage === 'ready') ?? null;
      const done = at('close');
      const base = { dept: 'procurement' as const, workflow: 'site_supplies', recordId: r.id, companyId: r.companyId };
      if (sub && appr) put.step({ ...base, stage: 'order', kind: 'check', byId: appr.byId, by: appr.by, arrivedAt: sub.at, doneAt: appr.at });
      if (appr && chk) put.step({ ...base, stage: 'receiving', kind: 'work', byId: chk.byId, by: chk.by, arrivedAt: appr.at, doneAt: chk.at });
      if (chk && ready) put.step({ ...base, stage: 'preparation', kind: 'work', byId: ready.byId, by: ready.by, arrivedAt: chk.at, doneAt: ready.at });
      if (ready && done) put.step({ ...base, stage: 'delivery', kind: 'work', byId: done.byId, by: done.by, arrivedAt: ready.at, doneAt: done.at });
      if (done && d.status === 'siap')
        put.finished({ ...base, preparer: chk?.by ?? null, finishedAt: done.at, returns: steps.filter((x) => x.step === 'first_check_return').length, reopens: null, evidenceComplete: null, requesterConfirmed: null });
    }
  },
});
