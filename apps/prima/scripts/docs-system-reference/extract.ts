// Reads the rule register, record forms, hand-over map and guide cards straight from @prima/core, so the generated
// pages in docs/system/reference never drift from what the app enforces. Needs the combined candidate (or main after
// PRs #49, #51, #52, #53, #54, #55, #56, #57 and #58 merge), because the guide registry and hand-over map arrive there.
import { RULES } from '../../packages/core/src/rules';
import { RECORD_KINDS } from '../../packages/core/src/records';
import '../../packages/core/src/guide-registry';
import { allGuideCards } from '../../packages/core/src/guide-cards';
import { ORG_FLOWS, ORG_DESK_LABEL, NEVER_ROUTED } from '../../packages/core/src/org-links';
import * as ops from '../../packages/core/src/ops-guide-cards';
import * as so from '../../packages/core/src/special-ops-guide';
import * as wr from '../../packages/core/src/work-rebalance-guide';
import { registeredRollouts } from '../../packages/core/src/rollouts';
import '../../packages/core/src/hr';
import '../../packages/core/src/finance';
import '../../packages/core/src/central-admin';
import '../../packages/core/src/company-office';
import '../../packages/core/src/ops-access';
import '../../packages/core/src/special-ops';

const rules: unknown[] = [];
for (const [key, r] of Object.entries(RULES) as [string, { id: string; label: string; value: unknown; source: string }][]) {
  if (r && typeof r === 'object' && 'id' in r && 'source' in r) rules.push({ key, id: r.id, label: r.label, value: r.value, source: r.source });
}
const records = Object.entries(RECORD_KINDS).map(([kind, spec]) => ({ kind, ...spec }));
const extra: Record<string, unknown[]> = {};
for (const m of [ops, so, wr] as Record<string, unknown>[])
  for (const [k, v] of Object.entries(m)) if (Array.isArray(v) && v.length && (v[0] as { title?: unknown }).title) extra[k] = v;
console.log(
  JSON.stringify({
    rules,
    records,
    cards: allGuideCards(),
    flows: ORG_FLOWS,
    desks: ORG_DESK_LABEL,
    never: NEVER_ROUTED,
    extra,
    rollouts: registeredRollouts(),
  }),
);
