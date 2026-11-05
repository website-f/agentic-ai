// The Special Ops add-on module (db/modules/special-ops-v1.sql), installed on top of the base schema as the owner would.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

export async function installSpecialOpsModule(url: string): Promise<void> {
  const file = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../../db/modules/special-ops-v1.sql' : 'db/modules/special-ops-v1.sql');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(readFileSync(file, 'utf8'));
  } finally {
    await c.end();
  }
}
