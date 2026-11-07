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

/** The optional company office module (db/modules/company-office-v1.sql); applied only in an authorized migration. */
export function companyOfficeModuleSql(): string {
  return readFileSync(join(__dirname, '../../../../db/modules/company-office-v1.sql'), 'utf8');
}

/** The optional module for companies run by another company's office (db/modules/company-run-links-v1.sql). */
export function companyRunLinksModuleSql(): string {
  return readFileSync(join(__dirname, '../../../../db/modules/company-run-links-v1.sql'), 'utf8');
}

/**
 * The optional pay formulas module (db/modules/pay-formulas-v1.sql), PROPOSED and not in the release manifest. Only the
 * development reset and the tests apply it; a staging or live database gets it in a separately authorized window.
 */
export function payFormulasModuleSql(): string {
  return readFileSync(join(__dirname, '../../../../db/modules/pay-formulas-v1.sql'), 'utf8');
}

/**
 * The optional guard pay module (db/modules/guard-pay-v1.sql), PROPOSED and not in the release manifest. Only the
 * development reset and the tests apply it; a staging or live database gets it in a separately authorized window.
 */
export function guardPayModuleSql(): string {
  return readFileSync(join(__dirname, '../../../../db/modules/guard-pay-v1.sql'), 'utf8');
}
