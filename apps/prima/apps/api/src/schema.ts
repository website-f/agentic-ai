import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The schema, from db/migrations (kept at the same place relative to dist/ in the container image). */
export function migrationSql(): string {
  return readFileSync(join(__dirname, '../../../../db/migrations/001_init.sql'), 'utf8');
}

/** The fingerprint of that schema file: what prima.schema_info must hold for this build of the API to run. */
export function migrationSha(): string {
  return createHash('sha256').update(migrationSql()).digest('hex');
}
