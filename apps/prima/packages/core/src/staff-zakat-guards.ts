import type { Person, StaffPayRun } from './types';
import { RULES } from './rules';
/** Draft-only. No effective-period reconstruction from a truncated history. */
export function staffZakatPreview(p: Person, period: string) {
  const changes = [p.zakat?.set?.at, ...(p.zakatHistory ?? []).map(h => h.at)].filter((v): v is string => !!v);
  if (changes.some(at => !Number.isFinite(Date.parse(at)) || at.slice(0, 7) > period))
    throw new Error('Zakat election history needs HR review for this payroll period. No retrospective election is inferred.');
  const z = p.zakat;
  if (!z) return { percent: 0, body: null };
  const rule = RULES.staffZakat.value;
  if (!z.set?.byId || !z.set?.at || !Number.isFinite(Date.parse(z.set.at)) || !rule.bodies.includes(z.body)
      || !Number.isFinite(z.percent) || z.percent < rule.minPercent || z.percent > rule.maxPercent
      || Math.abs(z.percent * 100 - Math.round(z.percent * 100)) > 1e-8)
    throw new Error('Zakat choice needs a valid recorded staff election, supported body and percentage.');
  return { percent: z.percent, body: z.body };
}
export function staffZakatInputKey(p: Person) {
  return [p.zakat?.body ?? null, p.zakat?.percent ?? null, p.zakat?.set?.byId ?? null, p.zakat?.set?.at ?? null,
    (p.zakatHistory ?? []).map(h => [h.body, h.percent, h.byId, h.at])];
}
export function staffZakatReleaseProblem(run: Pick<StaffPayRun, 'lines'>): string | null {
  return run.lines.some(l => (l.zakatPercent ?? 0) !== 0 || (l.zakat ?? 0) !== 0)
    ? 'Zakat payroll is draft-only pending verification of the PCB offset and deduction policy. Do not submit, approve, export or pay this run.' : null;
}
export function staffSqlOtherSharesProblem(run: Pick<StaffPayRun, 'lines'>): string | null {
  return run.lines.some(l => l.others?.some(o => o.ee !== 0 || o.er !== 0))
    ? 'SQL export blocked: additional statutory contributions need reviewed debit/credit account mappings.' : null;
}
