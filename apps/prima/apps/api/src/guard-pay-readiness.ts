// Catalogue check for the optional guard pay module (db/modules/guard-pay-v1.sql), which needs the pay formulas module
// first. Names only, never data; installs nothing. Prima takes over guard pay on 1 August 2027 (Fauzan, 8 Nov 2026); the
// module is installed later as its own step, never with a release.
import type { PoolClient } from 'pg';
import { moduleShapeProblems, optionalModuleShape, payFormulasProblems, type ModuleShape } from './pay-formulas-readiness';

type Client = Pick<PoolClient, 'query'>;

/** What is missing or drifted for the guard pay module; empty when ready. Reports the pay formulas module too. */
export async function guardPayProblems(client: Client): Promise<string[]> {
  const out: string[] = [];
  if ((await payFormulasProblems(client)).length) out.push('The pay formulas module is not ready: install pay_formulas before guard_pay.');
  let shape: ModuleShape;
  try {
    shape = optionalModuleShape('guard_pay');
  } catch {
    return [...out, 'The guard pay module file db/modules/guard-pay-v1.sql could not be read.'];
  }
  return [...out, ...(await moduleShapeProblems(client, shape, 'db/modules/guard-pay-v1.sql'))];
}
