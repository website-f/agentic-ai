'use strict';
// Repository-only helper used by the tests and by whoever regenerates upgrade.sql. It is not packaged and never
// connects to a database. It builds the exact SQL that scripts/combined-base-upgrade.pg.test.cjs rehearses:
// the combined base body without its BEGIN/COMMIT, then the two reviewed module scope-function changes.
const fs = require('node:fs');
const path = require('node:path');

const OLD_ALLOW = "company IN ('pwvsb','merdeka')";
const NEW_ALLOW = "company IN ('pwvsb','merdeka','goodwill','sasateam','pgl')";

function deriveUpgradeSql(root) {
  const base = fs.readFileSync(path.join(root, 'db/migrations/001_init.sql'), 'utf8');
  if ((base.match(/^BEGIN;\s*$/gm) || []).length !== 1 || (base.match(/^COMMIT;\s*$/gm) || []).length !== 1) throw Error('base transaction shape');
  const body = base.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'db/release-manifest.json'), 'utf8'));
  const deltas = [];
  for (const m of manifest.modules) {
    if (!['cleanup', 'rental_corrections'].includes(m.id)) continue;
    const source = fs.readFileSync(path.join(root, m.path), 'utf8');
    if (!source.includes(NEW_ALLOW) || source.includes(OLD_ALLOW)) throw Error('module allowlist ' + m.id);
    const name = m.id === 'cleanup' ? 'ic_scope' : 'rc_scope';
    const start = source.indexOf('FUNCTION prima.' + name + '(');
    const end = source.indexOf('$$;', source.indexOf('AS $$', start)) + 3;
    if (start <= 0 || end <= start) throw Error('module function ' + name);
    deltas.push('CREATE OR REPLACE ' + source.slice(start, end));
  }
  if (deltas.length !== 2) throw Error('module deltas');
  return body + '\n' + deltas.join('\n');
}

module.exports = { deriveUpgradeSql };
if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  fs.writeFileSync(path.join(__dirname, 'upgrade.sql'), deriveUpgradeSql(root));
  process.stdout.write('upgrade.sql written\n');
}
