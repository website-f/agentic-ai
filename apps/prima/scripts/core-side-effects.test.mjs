// P122 (speed): packages/core/package.json "sideEffects" lists the core files that do work when they load (they call
// registerRollout, registerWall, registerWorkKpiAdapter or registerGuideCards at the top level). The web build keeps
// those files and drops any other core file whose exports it does not use, which keeps the server's services out of
// the browser. A file that starts registering must be added to the list, or the browser would silently miss it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(here, '../packages/core');
const src = path.join(core, 'src');
const pkg = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));

test('every core file with load-time work is listed in sideEffects, and every listed file exists', () => {
  assert.ok(Array.isArray(pkg.sideEffects), 'sideEffects must be a list of files');
  const listed = new Set(pkg.sideEffects);
  const missing = [];
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    // A top-level statement that is a call (registrations and similar), not a declaration or a comment.
    const topCall = /^(?!\s|\/\/|\/\*|\*|export |import |const |let |var |function |async |class |interface |type |enum |declare |\}|\)|\]|$)[A-Za-z_$][\w$.]*\s*\(/m;
    if (topCall.test(text) && !listed.has(`./src/${f}`)) missing.push(f);
  }
  assert.deepEqual(missing, [], `add to packages/core/package.json sideEffects: ${missing.join(', ')}`);
  for (const f of listed) assert.ok(fs.existsSync(path.join(core, f)), `${f} is listed but does not exist`);
});
