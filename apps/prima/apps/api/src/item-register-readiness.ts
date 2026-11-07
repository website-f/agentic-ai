import type { PoolClient } from 'pg';
import type { TableName } from '@prima/core';

/** Tables of the optional item register module (db/modules/item-register-v1.sql), by store name and SQL name. */
export const ITEM_TABLES: Record<string, string> = {
  itemSkus: 'item_skus',
  physicalItems: 'item_units',
  itemLots: 'item_lots',
  itemEvents: 'item_events',
  itemMovements: 'item_movements',
  itemCases: 'item_cases',
  itemCounts: 'item_counts',
  itemSyncJobs: 'item_sync_jobs',
  itemRequests: 'item_requests',
  itemSettings: 'item_settings',
  itemDocs: 'item_docs',
  uniformRecords: 'item_uniform_records',
};
/** Tables of the second part (db/modules/item-register-v2.sql, P85): label prints, SQL books, export files, SQL exports, counters, limiter. */
export const ITEM_V2_TABLES: Record<string, string> = {
  itemLabelPrints: 'item_label_prints',
  itemSqlBooks: 'item_sql_books',
  itemSyncBatches: 'item_sync_batches',
  itemSqlSnapshots: 'item_sql_snapshots',
  itemCounters: 'item_counters',
  itemScanDenials: 'item_scan_denials',
};
export const ITEM_V2_TABLE_NAMES = Object.keys(ITEM_V2_TABLES) as TableName[];
export const ITEM_TABLE_NAMES = [...Object.keys(ITEM_TABLES), ...ITEM_V2_TABLE_NAMES] as TableName[];

/** Whether every table of the module exists. */
export async function itemRegisterInstalled(client: Pick<PoolClient, 'query'>): Promise<boolean> {
  const r = await client.query(`SELECT bool_and(to_regclass('prima.' || t) IS NOT NULL) AS ok FROM unnest($1::text[]) t`, [Object.values(ITEM_TABLES)]);
  return r.rows[0]?.ok === true;
}

/** What is missing or wrong in the database for the module; empty when ready. Catalogue check only, installs nothing. */
export async function itemRegisterProblems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const appendOnly = new Set(['item_events', 'item_requests', 'item_docs', 'item_uniform_records']);
  for (const t of Object.values(ITEM_TABLES)) {
    const q = `prima.${t}`;
    const r = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS has,
              coalesce((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass($1)), false) AS rls,
              EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass($1) AND polname = 'item_wall') AS wall,
              to_regclass($1) IS NOT NULL AND has_table_privilege('prima_app', $1, 'SELECT') AND has_table_privilege('prima_app', $1, 'INSERT') AS rights,
              to_regclass($1) IS NOT NULL AND has_table_privilege('prima_app', $1, 'UPDATE') AS can_update,
              to_regclass($1) IS NOT NULL AND (has_table_privilege('prima_app', $1, 'DELETE') OR has_table_privilege('prima_app', $1, 'TRUNCATE')) AS too_much`,
      [q],
    );
    const x = r.rows[0];
    if (!x.has) {
      out.push(`${q} is missing: apply db/modules/item-register-v1.sql in an authorized migration.`);
      continue;
    }
    if (!x.rls) out.push(`Row-level security is not forced on ${q}.`);
    if (!x.wall) out.push(`The item wall policy is missing on ${q}.`);
    if (!x.rights) out.push(`The app role cannot read or add to ${q}.`);
    if (appendOnly.has(t) && x.can_update) out.push(`The app role may change ${q}; it must be append-only.`);
    if (!appendOnly.has(t) && !x.can_update) out.push(`The app role cannot change ${q}.`);
    if (x.too_much) out.push(`The app role may delete from ${q}.`);
  }
  // Named uniqueness protections must be present, usable and attached to the intended table.
  for (const [index, table] of [
    ['item_units_token_unique', 'item_units'], ['item_units_rfid_unique', 'item_units'],
    ['item_units_it_asset_unique', 'item_units'], ['item_sync_jobs_key_unique', 'item_sync_jobs'],
    ['item_skus_code_unique', 'item_skus'],
  ]) {
    const r = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass($1)
        AND indrelid = to_regclass($2) AND indisunique AND indisvalid AND indisready) AS ok`,
      [`prima.${index}`, `prima.${table}`],
    );
    if (r.rows[0]?.ok !== true) out.push(`Required unique index prima.${index} is missing or invalid.`);
  }
  return out;
}


/** Whether every table of the second part exists. */
export async function itemRegisterV2Installed(client: Pick<PoolClient, 'query'>): Promise<boolean> {
  const r = await client.query(`SELECT bool_and(to_regclass('prima.' || t) IS NOT NULL) AS ok FROM unnest($1::text[]) t`, [Object.values(ITEM_V2_TABLES)]);
  return r.rows[0]?.ok === true;
}

/** What is missing or wrong for the second part (item-register-v2.sql); empty when ready. Catalogue check only, installs nothing. */
export async function itemRegisterV2Problems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const appendOnly = new Set(['item_sql_snapshots']);
  for (const t of Object.values(ITEM_V2_TABLES)) {
    const q = `prima.${t}`;
    const r = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS has,
              coalesce((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass($1)), false) AS rls,
              EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass($1) AND polname = 'item_wall') AS wall,
              (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass($1)) AS policies,
              to_regclass($1) IS NOT NULL AND has_table_privilege('prima_app', $1, 'SELECT') AND has_table_privilege('prima_app', $1, 'INSERT') AS rights,
              to_regclass($1) IS NOT NULL AND has_table_privilege('prima_app', $1, 'UPDATE') AS can_update,
              to_regclass($1) IS NOT NULL AND (has_table_privilege('prima_app', $1, 'DELETE') OR has_table_privilege('prima_app', $1, 'TRUNCATE')) AS too_much`,
      [q],
    );
    const x = r.rows[0];
    if (!x.has) {
      out.push(`${q} is missing: apply db/modules/item-register-v2.sql in an authorized migration, after item-register-v1.sql.`);
      continue;
    }
    if (!x.rls) out.push(`Row-level security is not forced on ${q}.`);
    if (!x.wall) out.push(`The item wall policy is missing on ${q}.`);
    if (Number(x.policies) !== 1) out.push(`${q} has a policy other than the item wall.`);
    if (!x.rights) out.push(`The app role cannot read or add to ${q}.`);
    if (appendOnly.has(t) && x.can_update) out.push(`The app role may change ${q}; it must be append-only.`);
    if (!appendOnly.has(t) && !x.can_update) out.push(`The app role cannot change ${q}.`);
    if (x.too_much) out.push(`The app role may delete from ${q}.`);
  }
  for (const [index, table] of [
    ['item_label_prints_gen_unique', 'item_label_prints'], ['item_sync_batches_ref_unique', 'item_sync_batches'],
    ['item_movements_ref_unique', 'item_movements'], ['item_movements_commercial_ref_unique', 'item_movements'],
    ['item_cases_ref_unique', 'item_cases'], ['item_sync_jobs_docno_unique', 'item_sync_jobs'],
  ]) {
    const r = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass($1)
        AND indrelid = to_regclass($2) AND indisunique AND indisvalid AND indisready) AS ok`,
      [`prima.${index}`, `prima.${table}`],
    );
    if (r.rows[0]?.ok !== true) out.push(`Required unique index prima.${index} is missing or invalid.`);
  }
  // The export-only rule, the laundry state and whole-sen money are table checks; a missing one fails closed.
  for (const [name, table] of [
    ['item_sql_books_shape', 'item_sql_books'], ['item_sync_jobs_shape', 'item_sync_jobs'], ['item_units_state', 'item_units'],
    ['item_label_prints_shape', 'item_label_prints'], ['item_uniform_records_sen', 'item_uniform_records'],
  ]) {
    const r = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname = $2 AND contype = 'c' AND convalidated) AS ok,
              coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname = $2), '') AS def`,
      [`prima.${table}`, name],
    );
    if (r.rows[0]?.ok !== true) out.push(`Required check ${name} on prima.${table} is missing.`);
    else if (name === 'item_units_state' && !String(r.rows[0].def).includes('laundry')) out.push('The item state check has no laundry state: apply item-register-v2.sql after item-register-v1.sql.');
    else if (name === 'item_sql_books_shape' && !String(r.rows[0].def).includes('export_only')) out.push('The SQL book check no longer keeps the channel export only.');
  }
  return out;
}
