// Pure fail-closed decision helper. It never contacts Azure, runs a migration or patches an image.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const HASH = /^[0-9a-f]{64}$/;

export function requireSchemaMatch(mode, imageExpected, report) {
  if (!['deploy', 'rollback'].includes(mode)) throw new Error('Unknown schema gate mode.');
  if (typeof imageExpected !== 'string' || !HASH.test(imageExpected)) throw new Error(`${mode}: image schema hash is unknown or invalid; manual recovery required.`);
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      typeof report.current !== 'boolean' || typeof report.expected !== 'string' || !HASH.test(report.expected) ||
      typeof report.applied !== 'string' || !HASH.test(report.applied)) {
    throw new Error(`${mode}: database schema evidence is missing or malformed; no image change is allowed.`);
  }
  if (report.current !== (report.expected === report.applied)) throw new Error(`${mode}: inconsistent schema evidence; no image change is allowed.`);
  // The old API may legitimately report current=false after an authorized migration.
  // Its expected hash is NOT the candidate's expected hash; compare applied to the image.
  if (report.applied !== imageExpected) throw new Error(`${mode}: applied database schema does not match the image; no image change is allowed.`);
  return { mode, applied: report.applied, imageExpected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, expected, file] = process.argv.slice(2);
    if (!file) throw new Error('Usage: staging-schema-gate.mjs <deploy|rollback> <image schema SHA256> <health-schema JSON file>');
    console.log(JSON.stringify(requireSchemaMatch(mode, expected, JSON.parse(readFileSync(file, 'utf8')))));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
