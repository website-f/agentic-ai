#!/usr/bin/env node
// P81: builds Prima's real-data file (packages/core/src/real-data.ts, format "prima-real-data" version 1) from the
// parsed staff list ("SENARAI NAMA & EMAIL OUTLOOK STAFF TERKINI", one row per sheet line: {sheet, company, name, email,
// note}). The output holds personal data: write it OUTSIDE the repository, and copy it to the server by hand. Only
// counts are printed.
//
//   node apps/prima/scripts/build-real-data.mjs <rows.json> <prima-real-data.json>
//
// What it does:
//  - companies: one per licensed company, the "(PIC ...)" notes dropped, typos fixed (SN BHD, SN APLPA, EXCELENT), and
//    the spellings of one company merged ("ARROW SHIELD SECURITY SDN BHD" is "ARROW SHIELD SECURITY SERVICES SDN BHD");
//    the other spellings are kept as aliases so the office's branches still match. PW Venture, Goodwill Empire, Sasa
//    Team and Merdeka Network keep their structural keys; Prisma Wiramaju is asset management.
//  - units: HR, KEWANGAN, AUDIT, CONTROL ROOM and NEPAL are PWVSB departments; IT is Merdeka Network's (the IT team's
//    employer); SEKOLAH / KBK / PKK and every OPERASI region are Goodwill Empire's (government operations, gdempire.com
//    mailboxes); SASA TEAM is Sasa Team's.
//  - people: bank checker and maker mailboxes, shared mailboxes and unit or company mailboxes are not people. One person
//    per mailbox; a mailbox several named people share is nobody's own, so they are kept without an email (the office
//    links them by name). The same name in the same company is one person, with their other mailboxes kept.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORMAT = 'prima-real-data';
export const VERSION = 1;
const BANK_SHEET = /^EMAIL CHECKER MAKER BANK/i;
const SHEET_ORDER = [/^UNIT-PIC/i, /^CAWANGAN/i, /^TEAM PRISMA/i, /^HQ-PIC/i];
const NOT_PERSON =
  /^(PENGURUSAN|HQ|CHECKER|MAKER|AUTHORI[SZ]ER|OPERASI|UNIT |ADMIN|KEWANGAN|AKAUN|ACCOUNTS?\b|HR\b|PEJABAT|CAWANGAN|SHARE|TEAM |FINANCE|PAYROLL|INFO\b)|\b(SDN|BHD|SECURITY|SERVICES|PROTECTION|ENTERPRISE)\b/i;
const HONORIFIC = /^(leader|assistant|cik|encik|puan|en\.?|pn\.?|tuan|mr\.?|mrs\.?|ms\.?)\s+/i;
const STOP = new Set(['SDN', 'BHD', 'M', 'AND', '&']);
const LOWER_WORDS = new Set(['bin', 'binti', 'bt', 'a/l', 'a/p', '@', 'b.', 'al']);

const spaces = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const nameKey = (s) => spaces(s).toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');

/** The company name as the list means it: notes dropped, known typos fixed, upper case, single spaces. */
export function cleanCompany(raw) {
  return spaces(
    String(raw ?? '')
      .toUpperCase()
      .replace(/\(\s*PIC[^)]*\)?/g, ' ')
      .replace(/\bSN\s+BHD\b/g, 'SDN BHD')
      .replace(/\bSN\s+APLPA\b/g, 'SN ALFA')
      .replace(/\bEXCELENT\b/g, 'EXCELLENT')
      .replace(/\bEAGLEFORCE\b/g, 'EAGLE FORCE')
      .replace(/\s*\/\s*/g, ' / '),
  );
}

/** "ARROW SHIELD SECURITY SERVICES SDN BHD" -> "Arrow Shield Security Services Sdn Bhd"; short codes stay (SN, JW, 999). */
export function titleCompany(name) {
  return name
    .split(' ')
    .map((w) => (w === 'SDN' ? 'Sdn' : w === 'BHD' ? 'Bhd' : /^\(?[A-Z]{1,2}\)?$/.test(w) || !/[AEIOU]/.test(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');
}

/** "MOHD FAIZAL BIN ALI" -> "Mohd Faizal bin Ali". */
export function titlePerson(name) {
  return spaces(name)
    .split(' ')
    .map((w) => {
      const l = w.toLowerCase();
      if (LOWER_WORDS.has(l)) return l;
      return l.replace(/(^|[-'’(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(' ');
}

/** A person's name from the list, or '' when the line names no person. */
export function cleanName(raw) {
  let s = spaces(raw);
  for (let i = 0; i < 3 && HONORIFIC.test(s); i++) s = s.replace(HONORIFIC, '');
  if (!s || /^none$/i.test(s) || /^[-.]+$/.test(s)) return '';
  // A slash means a unit ("PENGURUSAN / ADMIN"), except in a/l and a/p ("son of", "daughter of").
  if (NOT_PERSON.test(s) || s.replace(/\ba\s*\/\s*[lp]\b/gi, '').includes('/') || !/[a-z]{2}/i.test(s)) return '';
  return titlePerson(s);
}

const AREAS = [
  [/\bKL\b|SELANGOR/, 'kl-selangor'],
  [/JOHOR/, 'johor'],
  [/MELAKA/, 'melaka'],
  [/PAHANG/, 'pahang'],
  [/KELANTAN/, 'kelantan'],
  [/TERENGGANU/, 'terengganu'],
  [/PERAK/, 'perak'],
  [/KEDAH|PERLIS/, 'kedah-perlis'],
  [/SABAH/, 'sabah'],
  [/SARAWAK/, 'sarawak'],
];

/**
 * Where a line of the list belongs: a central employer (with the unit's department and, for a regional office, the area)
 * or, with `licensed`, a licensed company named by `name`. null for a line that names neither.
 */
export function placeOf(company) {
  const c = cleanCompany(company);
  if (!c) return null;
  if (/^OPERASI\b/.test(c)) {
    const area = AREAS.find(([re]) => re.test(c))?.[1] ?? null;
    return { key: 'goodwill', unit: 'operations', area };
  }
  if (/\bUNIT IT\b/.test(c)) return { key: 'merdeka', unit: 'it' };
  if (/^(UNIT )?HR$/.test(c) || /\bUNIT HR\b/.test(c)) return { key: 'pwvsb', unit: 'hr' };
  if (/KEWANGAN/.test(c)) return { key: 'pwvsb', unit: 'finance', leader: /LEADER/.test(c) };
  if (/\bAUDIT\b/.test(c)) return { key: 'pwvsb', unit: 'audit' };
  if (/CONTROL ROOM/.test(c)) return { key: 'pwvsb', unit: 'cms' };
  if (/NEPAL/.test(c)) return { key: 'pwvsb', unit: 'fwm' };
  if (/SEKOLAH|\bKBK\b|\bPKK\b/.test(c)) return { key: 'goodwill', unit: 'operations' };
  if (/^SASA TEAM\b/.test(c)) return { key: 'sasateam', unit: 'operations' };
  if (/^PW VENTURE\b|^PWVSB\b/.test(c)) return { key: 'pwvsb' };
  if (/^GOODWILL EMPIRE\b/.test(c)) return { key: 'goodwill' };
  if (/^MERDEKA NETWORK\b/.test(c)) return { key: 'merdeka' };
  // E5 (Fauzan, 11 Nov 2026): Perfect Global Logistics is a central employer (the Transport department), not a licensed
  // security company.
  if (/^PERFECT GLOBAL LOGISTICS\b|^PGL\b/.test(c)) return { key: 'pgl', unit: 'transport' };
  if (/^PRI?SMA\b/.test(c)) return { asset: true, name: c, unit: 'asset' };
  return { licensed: true, name: c };
}

const tokens = (name) => name.split(/[^A-Z0-9&]+/).filter((t) => t && !STOP.has(t));
/** One company spelt two ways: the same words, or all the words of one (two or more) inside the other. */
export function sameCompany(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (![...small].every((t) => big.has(t))) return false;
  return small.size === big.size || small.size >= 2;
}

const slug = (name) =>
  tokens(name)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 55)
    .replace(/-+$/, '');

const STRUCTURAL = [
  { key: 'pwvsb', name: 'PW Venture Sdn Bhd', role: 'central' },
  { key: 'goodwill', name: 'Goodwill Empire Sdn Bhd', role: 'gov_ops' },
  { key: 'sasateam', name: 'Sasa Team Sdn Bhd', role: 'private_ops' },
  { key: 'merdeka', name: 'Merdeka Network Sdn Bhd', role: 'it' },
  { key: 'pgl', name: 'Perfect Global Logistics Sdn Bhd', role: 'logistics' },
];

/** The real-data file and the counts (never names or emails) from the parsed rows. */
export function buildRealData(rows, { builtAt = new Date().toISOString(), source = 'staff list' } = {}) {
  if (!Array.isArray(rows)) throw new Error('rows.json must be a list of rows.');
  const counts = { rows: rows.length, bankMailboxes: 0, sharedMailboxes: 0, notPeople: 0, noPlace: 0, sharedEmails: 0, merged: 0 };

  // ---- companies: every spelling of every licensed company, the most used spelling first
  const spellings = new Map();
  const assetSpellings = new Map();
  for (const r of rows) {
    const p = placeOf(r.company);
    if (!p) continue;
    const bucket = p.licensed ? spellings : p.asset ? assetSpellings : null;
    if (!bucket) continue;
    const e = bucket.get(p.name) ?? { n: 0, raw: new Set() };
    e.n += 1;
    e.raw.add(spaces(r.company).toUpperCase());
    bucket.set(p.name, e);
  }
  const groups = [];
  const order = (m) => [...m.entries()].sort((a, b) => b[1].n - a[1].n || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  for (const [name, e] of order(spellings)) {
    const g = groups.find((x) => x.names.some((n) => sameCompany(n, name)));
    if (g) {
      g.names.push(name);
      e.raw.forEach((x) => g.raw.add(x));
    } else groups.push({ names: [name], raw: new Set(e.raw) });
  }
  const companyOf = new Map(); // cleaned spelling -> key
  const companies = [...STRUCTURAL.map((c) => ({ ...c, aliases: [] }))];
  const keys = new Set(companies.map((c) => c.key));
  const add = (role, names, raw) => {
    const canonical = names[0];
    let key = `co-${slug(canonical) || 'company'}`;
    for (let n = 2; keys.has(key); n++) key = `co-${slug(canonical)}-${n}`;
    keys.add(key);
    const aliases = [...new Set([...names.slice(1), ...raw])].filter((a) => a !== canonical).slice(0, 20);
    companies.push({ key, name: titleCompany(canonical), role, aliases });
    for (const n of names) companyOf.set(n, key);
  };
  for (const g of groups) add('licensed', g.names, g.raw);
  const assets = order(assetSpellings);
  if (assets.length) {
    // "PRISMA" (the unit) and "PRISMA WIRAMAJU SDN BHD" (the company) are one: the full name leads.
    const names = assets.map(([n]) => n).sort((a, b) => b.length - a.length);
    add('asset', names, new Set(assets.flatMap(([, e]) => [...e.raw])));
  }
  const keyOf = (p) => (p.licensed || p.asset ? companyOf.get(p.name) : p.key);

  // ---- people
  const priority = (sheet) => {
    const i = SHEET_ORDER.findIndex((re) => re.test(sheet ?? ''));
    return i < 0 ? SHEET_ORDER.length : i;
  };
  const lines = [];
  rows.forEach((r, i) => {
    if (BANK_SHEET.test(r.sheet ?? '')) return void counts.bankMailboxes++;
    const note = spaces(r.note).toLowerCase();
    if (/share\s*mail\s*box/.test(note)) return void counts.sharedMailboxes++;
    const name = cleanName(r.name);
    if (!name) return void counts.notPeople++;
    const place = placeOf(r.company);
    const company = place && keyOf(place);
    if (!company) return void counts.noPlace++;
    const leader = /^leader\b/.test(note) || /^leader\b/i.test(spaces(r.name)) || !!place.leader;
    const roleHint = /management/.test(note) ? 'manager' : leader ? 'leader' : 'staff';
    const title = roleHint === 'manager' ? 'Management' : leader ? 'Team leader' : /^assistant\b/.test(note) ? 'Assistant' : /^de\s*\d/.test(note) ? 'Data entry' : null;
    const email = spaces(r.email).toLowerCase() || null;
    lines.push({ i, pri: priority(r.sheet), name, key: nameKey(name), email, company, unit: place.unit ?? null, area: place.area ?? null, roleHint, title, pic: /\(\s*PIC/i.test(r.company ?? '') });
  });
  lines.sort((a, b) => a.pri - b.pri || Number(a.pic) - Number(b.pic) || a.i - b.i);

  // One mailbox, one person: the names on a mailbox, "Siti" and "Siti Aminah" counted as one.
  const byEmail = new Map();
  for (const l of lines) if (l.email) byEmail.set(l.email, [...(byEmail.get(l.email) ?? []), l]);
  const distinct = (ls) => {
    const out = [];
    for (const k of [...new Set(ls.map((l) => l.key))].sort((a, b) => b.length - a.length)) if (!out.some((o) => o.includes(k))) out.push(k);
    return out;
  };
  const people = [];
  const rank = { manager: 2, leader: 1, staff: 0 };
  const absorb = (p, l) => {
    if (rank[l.roleHint] > rank[p.roleHint]) p.roleHint = l.roleHint;
    p.title ??= l.title;
    if (l.name.length > p.name.length && (l.key.includes(p.key) || p.key.includes(l.key))) {
      p.name = l.name;
      p.key = l.key;
    }
  };
  const person = (l, email) => ({ name: l.name, key: l.key, email, otherEmails: [], company: l.company, unit: l.unit, area: l.area, title: l.title, roleHint: l.roleHint });
  for (const [email, ls] of byEmail) {
    if (distinct(ls).length > 1) {
      counts.sharedEmails += 1;
      for (const l of ls) l.email = null; // a shared mailbox is nobody's own
      continue;
    }
    const p = person(ls[0], email);
    for (const l of ls.slice(1)) absorb(p, l);
    counts.merged += ls.length - 1;
    people.push(p);
  }
  // The same name in the same company is one person: their other mailboxes are kept with them.
  const merged = [];
  for (const p of people) {
    const q = merged.find((x) => x.company === p.company && x.key === p.key);
    if (!q) merged.push(p);
    else {
      counts.merged += 1;
      if (q.otherEmails.length < 5) q.otherEmails.push(p.email);
      absorb(q, p);
    }
  }
  for (const l of lines.filter((x) => !x.email)) {
    const q = merged.find((x) => x.company === l.company && x.key === l.key);
    if (q) {
      counts.merged += 1;
      absorb(q, l);
    } else merged.push(person(l, null));
  }

  const staff = merged.map(({ key: _k, otherEmails, ...p }) => ({ ...p, ...(otherEmails.length ? { otherEmails } : {}) }));
  const file = { format: FORMAT, version: VERSION, builtAt, source, companies, staff };
  const byRole = {};
  for (const c of companies) byRole[c.role] = (byRole[c.role] ?? 0) + 1;
  const byCompany = {};
  for (const s of staff) byCompany[s.company] = (byCompany[s.company] ?? 0) + 1;
  return {
    file,
    counts: {
      ...counts,
      companies: byRole,
      staff: staff.length,
      withEmail: staff.filter((s) => s.email).length,
      withoutEmail: staff.filter((s) => !s.email).length,
      centralStaff: ['pwvsb', 'goodwill', 'sasateam', 'merdeka'].reduce((n, k) => n + (byCompany[k] ?? 0), 0),
      companiesWithoutStaff: companies.filter((c) => !byCompany[c.key]).length,
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node build-real-data.mjs <rows.json> <prima-real-data.json>  (write the output outside the repository)');
    process.exit(64);
  }
  const rows = JSON.parse(readFileSync(input, 'utf8').replace(/^﻿/, ''));
  const { file, counts } = buildRealData(rows, { source: 'SENARAI NAMA & EMAIL OUTLOOK STAFF TERKINI' });
  writeFileSync(output, JSON.stringify(file, null, 1));
  console.log(JSON.stringify(counts, null, 1));
}
