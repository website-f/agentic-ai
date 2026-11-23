// P128: which Prima screens open for an office account, worked out by Prima's OWN menu rule.
//
// Fitri (24 Nov 2026): "whatever is set like roles, permissions, permissions on module, it doesn't reflect correctly".
// Prima decides its menu in its web app (apps/prima/apps/web/src/App.tsx: the NAV table, the LINE of work of each
// department and the long filter after it, with helpers from @prima/core). Prima's server then checks the same role,
// department and job, so a screen its menu does not give a person is a screen their calls are refused on too.
//
// This program takes those three blocks of App.tsx as they are, runs them on the accounts the office can make
// (office-accounts.ts: central staff or a company's admin executive, one of the office departments, with or without
// their own staff record) and on Prima's own jobs (core accounts-access.ts ACCOUNT_TEMPLATES, made only in Prima),
// and writes which screens each one gets. The office reads the result (prima/screen_access.py) to give each person
// the Prima department their picked screens need, and to show on Members > Access what they will really get.
// `source` is a fingerprint of the three blocks: tests/test_p128_access_reflected.py fails when App.tsx changed
// since, so this is run again.
//
//   cd apps/prima && npx tsc -p packages/core/tsconfig.json
//   node ../api/agentic/prima/screen_access_build.cjs . > ../api/agentic/prima/screen_access.json
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(process.argv[2] || '.');
const need = (name) => require(require.resolve(name, { paths: [root, path.join(root, 'apps/web')] }));
const ts = need('typescript');
const core = need('@prima/core');

const app = fs.readFileSync(path.join(root, 'apps/web/src/App.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** The three blocks, cut the same way as screen_access.py `blocks()` (the fingerprint must agree). */
function cut(start, end) {
  const i = app.indexOf(start);
  if (i < 0) throw new Error(`App.tsx has no "${start}"`);
  const j = app.indexOf(end, i);
  if (j < 0) throw new Error(`App.tsx: "${start}" has no end "${JSON.stringify(end)}"`);
  return app.slice(i, j + end.length);
}
const blocks = [cut('const NAV: ', '\n];'), cut('const LINE: ', '\n  };'), cut('const roleNav = NAV.filter(', '\n  )\n')];
const source = crypto.createHash('sha256').update(blocks.join('\n\u0000\n')).digest('hex');

const js = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const names = Object.keys(core).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
// The menu as App.tsx's Shell makes it for `me`, before the office narrows it (office-access.ts).
const body = `${js(blocks[0])}
const role = me.user.role;
const isGroup = role === 'director' || role === 'pwvsb_officer';
const dept = me.user.department;
const leader = isGroupLeader(me.user);
${js(blocks[1])}
${js(blocks[2].replace(/\n\s*\)\n$/, '\n  );'))}
return roleNav.map((n) => n.view);`;
// eslint-disable-next-line no-new-func
const menu = new Function('me', ...names, body);
const NOW = '2026-11-24T09:00:00+08:00';
const views = (user) => menu({ user, now: NOW, office: null }, ...names.map((k) => core[k]));

// Prima's own Malay for its job names (its translation rows ['English', 'BM', mix]).
const i18n = fs.readFileSync(path.join(root, 'apps/web/src/i18n.ts'), 'utf8');
const malay = new Map();
for (const m of i18n.matchAll(/^\s*\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/gm))
  if (!malay.has(m[1].replace(/\\'/g, "'"))) malay.set(m[1].replace(/\\'/g, "'"), m[2].replace(/\\'/g, "'"));

const OFFICE_ROLES = ['pwvsb_officer', 'admin_exec'];
const OFFICE_DEPARTMENTS = ['transport', 'procurement', 'hr', 'finance', 'chief_of_staff', 'it', 'legal', 'audit', 'operations', 'asset', 'pdpa', 'fwm', 'cms'];

const profiles = {};
for (const role of OFFICE_ROLES)
  for (const dept of ['', ...OFFICE_DEPARTMENTS])
    for (const record of [true, false]) {
      const user = {
        id: 'u-off-preview',
        name: 'Preview',
        title: '',
        role,
        companyIds: [role === 'admin_exec' ? 'co-preview' : 'pwvsb'],
        siteIds: [],
        ...(dept ? { department: dept } : {}),
        ...(record ? { personId: 'p-preview' } : {}),
      };
      profiles[`${role}|${dept}|${record ? 'record' : 'none'}`] = { views: views(user).sort(), walls: [...core.dataWalls(user)].sort() };
    }

// Prima's own jobs, given only in Prima (Accounts and access), with a team or sector where the job needs one.
const jobs = {};
for (const t of core.ACCOUNT_TEMPLATES) {
  const user = {
    ...t.shape,
    id: 'u-acc-preview',
    name: 'Preview',
    title: '',
    companyIds: t.where === 'office' ? ['co-preview'] : [],
    siteIds: [],
    personId: 'p-preview',
    ...(t.needs?.includes('financeTeam') ? { financeTeam: 1 } : {}),
    ...(t.needs?.includes('actTeam') ? { actTeam: 1 } : {}),
    ...(t.needs?.includes('opsSector') ? { opsSector: 'government' } : {}),
    ...(t.needs?.includes('areaStates') ? { areaStates: ['Selangor'] } : {}),
    ...(t.needs?.includes('regionIds') ? { regionIds: [] } : {}),
  };
  jobs[t.key] = { label: { en: t.label, ms: malay.get(t.label) ?? t.label }, views: views(user).sort() };
}
// Prima's top record, the CEO (role director, opsTier ceo): owners and admins open Prima as it (client.py opens_as_top).
const leaders = views({ id: 'u-top-preview', name: 'Preview', title: '', role: 'director', opsTier: 'ceo', companyIds: [], siteIds: [] }).sort();

process.stdout.write(`${JSON.stringify({ source, profiles, jobs, leaders }, null, 1)}\n`);
