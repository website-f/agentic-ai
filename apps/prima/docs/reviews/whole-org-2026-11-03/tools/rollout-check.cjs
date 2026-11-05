const { userForEntra } = require('/home/claude/prima-secure-app/apps/api/dist/src/auth.js');
const core = require('/home/claude/prima-secure-app/packages/core/dist/index.js');
const ds = core.generateDataset({ today: '2026-11-03' });
const pick = (f) => ds.users.find(f);
const cases = [
  ['HR admin, PRIMA_ROLLOUTS=hr', pick((u) => u.id === 'u-pwvsb-hr'), { PRIMA_ROLLOUTS: 'hr' }],
  ['Chief of Staff, PRIMA_ROLLOUTS=hr', pick((u) => u.id === 'u-cos'), { PRIMA_ROLLOUTS: 'hr' }],
  ['Arms Control, PRIMA_ROLLOUTS=special_ops', pick((u) => u.department === 'arms_control'), { PRIMA_ROLLOUTS: 'special_ops' }],
  ['Company secretary, PRIMA_ROLLOUTS=central_admin', pick((u) => u.corpSecretary), { PRIMA_ROLLOUTS: 'central_admin' }],
  ['Finance team leader, FINANCE_ROLLOUT=true', pick((u) => u.department === 'finance' && u.financeTeam === 1), { FINANCE_ROLLOUT: 'true' }],
  ['OGM, GOV_OPS_ROLLOUT=true', pick((u) => u.opsTier === 'ogm'), { GOV_OPS_ROLLOUT: 'true' }],
  ['IT Manager (pilot), no rollout', pick((u) => u.id === 'u-it-mgr'), {}],
];
(async () => {
  for (const [label, u, env] of cases) {
    for (const k of ['PRIMA_ROLLOUTS', 'FINANCE_ROLLOUT', 'GOV_OPS_ROLLOUT']) delete process.env[k];
    Object.assign(process.env, env);
    const db = { pool: { query: async () => ({ rowCount: 1, rows: [{ data: { ...u, entraOid: 'x' } }] }) } };
    try { await userForEntra(db, { oid: 'x' }); console.log('SIGNS IN  ', label); }
    catch (e) { console.log('REFUSED   ', label, '->', e.message); }
  }
})();
