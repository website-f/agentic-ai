import type { HrPolicy, Person, PolicyCopy, StaffLang } from './types';

/**
 * Staff languages for the handbook, the code of conduct and discipline appeals (IKEA IWAY finding: no Nepali copy of
 * the discipline rules and no appeal step; Fauzan 6 Nov 2026: "Language can be set follow what staff mother tongue.
 * English and malay is a must."). HR keeps every copy; Prima never machine-translates a policy.
 */
export const STAFF_LANG_LABEL: Record<StaffLang, string> = {
  en: 'English',
  ms: 'Bahasa Melayu',
  ne: 'Nepali (नेपाली)',
  bn: 'Bengali (বাংলা)',
  my: 'Burmese (မြန်မာ)',
  hi: 'Hindi (हिन्दी)',
  ur: 'Urdu (اردو)',
  id: 'Bahasa Indonesia',
  ta: 'Tamil (தமிழ்)',
  zh: 'Chinese (中文)',
};

export const STAFF_LANGS = Object.keys(STAFF_LANG_LABEL) as StaffLang[];

/** Every policy has an English and a Malay copy. */
export const REQUIRED_POLICY_LANGS: StaffLang[] = ['en', 'ms'];

export const isStaffLang = (x: unknown): x is StaffLang => typeof x === 'string' && (STAFF_LANGS as string[]).includes(x);

/** The person's mother tongue: what HR set, else Nepali for a Nepali national and Malay for everyone else. */
export function motherTongueOf(p: Pick<Person, 'nationality' | 'motherTongue'>): StaffLang {
  if (p.motherTongue && isStaffLang(p.motherTongue)) return p.motherTongue;
  return p.nationality === 'NP' ? 'ne' : 'ms';
}

/**
 * The copies staff may read and sign now: English from the policy itself, then each translation that is still of the
 * acknowledged version. A translation from before a material change no longer counts.
 */
export function liveCopies(p: HrPolicy): Pick<PolicyCopy, 'lang' | 'title' | 'body' | 'version' | 'translator'>[] {
  const from = p.ackFromVersion ?? p.version;
  const en = { lang: 'en' as const, title: p.title, body: p.body, version: p.version, translator: p.by };
  const others = (p.copies ?? []).filter((c) => c.lang !== 'en' && c.version >= from);
  return [en, ...others];
}

/** Languages a policy is missing for the people it is meant for (the mother tongues with no live copy). */
export function languageGaps(p: HrPolicy, due: Pick<Person, 'nationality' | 'motherTongue'>[]) {
  const have = new Set(liveCopies(p).map((c) => c.lang));
  const counts = new Map<StaffLang, number>();
  for (const l of REQUIRED_POLICY_LANGS) if (!have.has(l)) counts.set(l, 0);
  for (const o of due) {
    const l = motherTongueOf(o);
    if (!have.has(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()].map(([lang, people]) => ({ lang, label: STAFF_LANG_LABEL[lang], people, required: REQUIRED_POLICY_LANGS.includes(lang) }));
}
