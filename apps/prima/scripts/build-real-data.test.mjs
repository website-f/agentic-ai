// P81: the real-data builder (build-real-data.mjs), on a small synthetic staff list. Never the real list.
//   node --test scripts/build-real-data.test.mjs   (from apps/prima, after building packages/core)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { buildRealData, cleanCompany, cleanName, placeOf, sameCompany, titleCompany } from './build-real-data.mjs';

const core = createRequire(import.meta.url)('../packages/core/dist/index.js');

const row = (sheet, company, name, email, note = '') => ({ sheet, company, name, email, note });
const ROWS = [
  // Bank checker and maker mailboxes: companies, never people.
  row('EMAIL CHECKER MAKER BANK', 'ALPHA GUARD SECURITY SERVICES SDN BHD', 'CHECKER ALPHA', 'checker@alpha.test', 'Share Mailbox 1'),
  row('EMAIL CHECKER MAKER BANK', 'PRISMA WIRAMAJU SDN BHD', 'MAKER PRISMA', 'maker@prisma.test', 'Share Mailbox 2'),
  // A licensed company spelt three ways; a typo'd one; a company looked after by another (PIC note).
  row('HQ-PIC', 'ALPHA GUARD SECURITY SERVICES SDN BHD', 'TEST PERSON ALPHA', 'alpha.one@example.test', 'Outlook Personal'),
  row('HQ-PIC', 'ALPHA GUARD SECURITY SERVICES SDN BHD', 'HQ ALPHA', 'hq@alpha.test', 'Outlook HQ'),
  row('TEAM PRISMA DAN UNIT HQ - PIC', 'ALPHA GUARD SECURITY SDN BHD', 'TEST BOSS ALPHA', 'boss.mg@alpha.test', 'Outlook Management'),
  row('HQ-PIC', 'BETA  WATCH SN BHD', 'Encik TEST PERSON BETA', 'beta.one@example.test', 'Outlook Personal'),
  row('HQ-PIC', 'GAMMA TECH SDN BHD (PIC- Alpha)', 'TEST PERSON GAMMA', '', 'Outlook HQ'),
  // One person on two sheets with one mailbox, and again with a second mailbox.
  row('UNIT-PIC', 'UNIT HR', 'TEST PERSON HARUN', 'hr.one@central.test', 'Outlook HQ'),
  row('TEAM PRISMA DAN UNIT HQ - PIC', 'HR', 'Test Person Harun', 'HR.One@central.test', 'Outlook HQ'),
  row('UNIT-PIC', 'UNIT HR', 'TEST PERSON HARUN', 'hr.one.personal@example.test', 'Outlook Personal'),
  // A mailbox two named people share: nobody's own.
  row('CAWANGAN DAN SHAREMAIL BOX-PIC', 'OPERASI KEDAH / PERLIS', 'TEST REGION ONE', 'ops.kedah@gov.test', 'Outlook HQ'),
  row('CAWANGAN DAN SHAREMAIL BOX-PIC', 'OPERASI KEDAH / PERLIS', 'TEST REGION TWO', 'ops.kedah@gov.test', 'Outlook HQ'),
  row('CAWANGAN DAN SHAREMAIL BOX-PIC', 'OPERASI KL/ SELANGOR', 'TEST REGION THREE', 'region.three@example.test', 'Outlook Personal'),
  // Units.
  row('UNIT-PIC', 'UNIT IT', 'TEST PERSON ITHNIN', 'it.one@it.test', 'Outlook HQ'),
  row('UNIT-PIC', 'UNIT KEWANGAN (LEADER)', 'TEST LEADER FIN', 'lead.fin@central.test', 'Leader Test (Outlook HQ)'),
  row('UNIT-PIC', 'UNIT KEWANGAN  (DE)', 'TEST ENTRY FIN', 'de.fin@central.test', 'DE 1 (Outlook HQ)'),
  row('UNIT-PIC', 'UNIT NEPAL', 'TEST PERSON FAWWAZ', 'fwm.one@example.test', 'Outlook Personal'),
  row('UNIT-PIC', 'UNIT PENGURUSAN SEKOLAH', 'TEST PERSON SCHOOL', 'school.one@gov.test', 'Outlook HQ'),
  row('UNIT-PIC', 'CONTROL ROOM', 'TEST PERSON CAMSIR', 'cms.one@example.test', 'Outlook Personal'),
  row('UNIT-PIC', 'PRISMA', 'TEST PERSON ASSET', 'asset.one@prisma.test', 'Outlook HQ'),
  row('HQ-PIC', 'SASA TEAM', 'TEST PERSON PRIVATE', 'private.one@example.test', 'Outlook Personal'),
  // Not people.
  row('UNIT-PIC', 'UNIT AUDIT / AUDIT HQ', 'UNIT AUDIT', 'audit@central.test', 'Outlook HQ'),
  row('HQ-PIC', 'BETA  WATCH SN BHD', 'none', 'none@beta.test', ''),
  row('HQ-PIC', 'BETA  WATCH SN BHD', 'PENGURUSAN / ADMIN', 'admin1@beta.test', 'Outlook HQ'),
];

describe('build-real-data: names', () => {
  it('cleans company names and merges one company spelt several ways', () => {
    assert.equal(cleanCompany('JERAI SECURITY  SERVICES SN BHD'), 'JERAI SECURITY SERVICES SDN BHD');
    assert.equal(cleanCompany('SN APLPA SDN BHD'), 'SN ALFA SDN BHD');
    assert.equal(cleanCompany('SPECIAL MEGATECH SDN BHD  (PIC -Asas )'), 'SPECIAL MEGATECH SDN BHD');
    assert.equal(cleanCompany('RED EAGLEFORCE (PIC- MEGAJAYA)'), 'RED EAGLE FORCE');
    assert.equal(titleCompany('XING SECURITAS (M) SDN BHD'), 'Xing Securitas (M) Sdn Bhd');
    assert.equal(titleCompany('SN ALFA SDN BHD'), 'SN Alfa Sdn Bhd');
    assert.equal(titleCompany('JW PROTECTION SDN BHD'), 'JW Protection Sdn Bhd');
    assert.ok(sameCompany('ARROW SHIELD SECURITY SDN BHD', 'ARROW SHIELD SECURITY SERVICES SDN BHD'));
    assert.ok(sameCompany('XING SECURITAS SDN BHD', 'XING SECURITAS (M) SDN BHD'));
    assert.ok(!sameCompany('SASA SECURITY SERVICES SDN BHD', 'SASA SURVEILLANCE SERVICES SDN BHD'));
    assert.ok(!sameCompany('MEGA JAYA SECURITY SDN BHD', 'MEGAJAYA SERVICES & SUPPLY SDN BHD'));
    assert.ok(!sameCompany('ALPHA SDN BHD', 'ALPHA GUARD SDN BHD'), 'one shared word is not enough');
  });

  it('cleans person names and drops lines that name no person', () => {
    assert.equal(cleanName('Encik MOHD TEST BIN ALI'), 'Mohd Test bin Ali');
    assert.equal(cleanName('Leader  TEST A/P SAMPLE'), 'Test a/p Sample');
    for (const n of ['none', '', 'UNIT AUDIT', 'PENGURUSAN / ADMIN', 'HQ ALPHA', 'CHECKER ALPHA', 'ALPHA SECURITY SDN BHD', '-']) assert.equal(cleanName(n), '', n);
  });

  it('places units in their employer and department', () => {
    assert.deepEqual(placeOf('UNIT HR'), { key: 'pwvsb', unit: 'hr' });
    assert.deepEqual(placeOf('HR'), { key: 'pwvsb', unit: 'hr' });
    assert.deepEqual(placeOf('UNIT IT'), { key: 'merdeka', unit: 'it' });
    assert.deepEqual(placeOf('UNIT KEWANGAN (LEADER)'), { key: 'pwvsb', unit: 'finance', leader: true });
    assert.deepEqual(placeOf('UNIT AUDIT / AUDIT HQ'), { key: 'pwvsb', unit: 'audit' });
    assert.deepEqual(placeOf('CONTROL ROOM'), { key: 'pwvsb', unit: 'cms' });
    assert.deepEqual(placeOf('PENGURUSAN NEPAL'), { key: 'pwvsb', unit: 'fwm' });
    assert.deepEqual(placeOf('PENGURUSAN SEKOLAH PKK/ KBK'), { key: 'goodwill', unit: 'operations' });
    assert.deepEqual(placeOf('OPERASI KEDAH'), { key: 'goodwill', unit: 'operations', area: 'kedah-perlis' });
    assert.deepEqual(placeOf('OPERASI KL/ SELANGOR'), { key: 'goodwill', unit: 'operations', area: 'kl-selangor' });
    assert.deepEqual(placeOf('SASA TEAM'), { key: 'sasateam', unit: 'operations' });
    assert.deepEqual(placeOf('PW VENTURE SDN BHD'), { key: 'pwvsb' });
    assert.equal(placeOf('PRISMA').asset, true);
    assert.equal(placeOf('ALPHA GUARD SDN BHD').licensed, true);
  });
});

describe('build-real-data: the file', () => {
  const { file, counts } = buildRealData(ROWS, { builtAt: '2026-11-06T00:00:00Z', source: 'synthetic' });
  const who = (name) => file.staff.find((s) => s.name === name);

  it('is a valid Prima real-data file', () => {
    const f = core.parseRealData(JSON.parse(JSON.stringify(file)));
    assert.equal(core.realDataSummary(f), '4 companies, 16 staff (13 with an email)');
  });

  it('has the structural companies, one record per licensed company with its other spellings, and Prisma as asset', () => {
    const by = Object.fromEntries(file.companies.map((c) => [c.key, c]));
    assert.deepEqual(['pwvsb', 'goodwill', 'sasateam', 'merdeka'].map((k) => by[k].role), ['central', 'gov_ops', 'private_ops', 'it']);
    const alpha = by['co-alpha-guard-security-services'];
    assert.equal(alpha.name, 'Alpha Guard Security Services Sdn Bhd');
    assert.ok(alpha.aliases.includes('ALPHA GUARD SECURITY SDN BHD'));
    assert.equal(by['co-beta-watch'].name, 'Beta Watch Sdn Bhd');
    assert.ok(by['co-gamma-tech'].aliases.includes('GAMMA TECH SDN BHD (PIC- ALPHA)'));
    assert.deepEqual(by['co-prisma-wiramaju'], { key: 'co-prisma-wiramaju', name: 'Prisma Wiramaju Sdn Bhd', role: 'asset', aliases: ['PRISMA'] });
    assert.equal(file.companies.filter((c) => c.role === 'licensed').length, 3);
  });

  it('one person per mailbox, a shared mailbox is nobody own, and the same person keeps both mailboxes', () => {
    const hr = who('Test Person Harun');
    assert.deepEqual({ email: hr.email, otherEmails: hr.otherEmails, company: hr.company, unit: hr.unit }, {
      email: 'hr.one@central.test',
      otherEmails: ['hr.one.personal@example.test'],
      company: 'pwvsb',
      unit: 'hr',
    });
    assert.equal(file.staff.filter((s) => s.name === 'Test Person Harun').length, 1);
    for (const n of ['Test Region One', 'Test Region Two']) assert.deepEqual([who(n).email, who(n).company, who(n).area], [null, 'goodwill', 'kedah-perlis'], n);
    assert.equal(who('Test Region Three').area, 'kl-selangor');
    assert.equal(counts.sharedEmails, 1);
  });

  it('maps every unit and keeps what the list says about the role, nothing more', () => {
    assert.deepEqual([who('Test Person Ithnin').company, who('Test Person Ithnin').unit], ['merdeka', 'it']);
    assert.deepEqual([who('Test Leader Fin').roleHint, who('Test Leader Fin').title, who('Test Leader Fin').unit], ['leader', 'Team leader', 'finance']);
    assert.deepEqual([who('Test Entry Fin').roleHint, who('Test Entry Fin').title], ['staff', 'Data entry']);
    assert.deepEqual([who('Test Person Fawwaz').company, who('Test Person Fawwaz').unit], ['pwvsb', 'fwm']);
    assert.deepEqual([who('Test Person School').company, who('Test Person School').unit], ['goodwill', 'operations']);
    assert.deepEqual([who('Test Person Camsir').company, who('Test Person Camsir').unit], ['pwvsb', 'cms']);
    assert.deepEqual([who('Test Person Asset').company, who('Test Person Asset').unit], ['co-prisma-wiramaju', 'asset']);
    assert.deepEqual([who('Test Person Private').company, who('Test Person Private').unit], ['sasateam', 'operations']);
    assert.deepEqual([who('Test Boss Alpha').roleHint, who('Test Boss Alpha').title, who('Test Boss Alpha').company], ['manager', 'Management', 'co-alpha-guard-security-services']);
    assert.deepEqual([who('Test Person Beta').company, who('Test Person Beta').email], ['co-beta-watch', 'beta.one@example.test']);
    assert.deepEqual([who('Test Person Gamma').company, who('Test Person Gamma').email], ['co-gamma-tech', null]);
    for (const s of file.staff) {
      assert.equal(Object.hasOwn(s, 'dob') || Object.hasOwn(s, 'ic') || Object.hasOwn(s, 'salary'), false, 'never invents a fact');
      assert.ok(!/HQ|Checker|Maker|Unit|None|Pengurusan/i.test(s.name), s.name);
    }
  });

  it('reports counts only, never a name or an email', () => {
    const text = JSON.stringify(counts);
    for (const s of file.staff) {
      assert.ok(!text.includes(s.name));
      if (s.email) assert.ok(!text.includes(s.email));
    }
    assert.equal(counts.bankMailboxes, 2);
    assert.equal(counts.notPeople, 4);
    assert.equal(counts.staff, file.staff.length);
  });
});
