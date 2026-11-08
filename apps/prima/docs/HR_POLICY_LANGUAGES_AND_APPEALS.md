# Handbook languages and discipline appeals

Closes the IKEA IWAY audit finding: there was no Nepali copy of the discipline rules and no appeal step.
Owner decisions: Fauzan, 6 Nov 2026 (IWAY answers 2 and 3), and 8 Nov 2026 (the four values below confirmed). Draft only, mock data, based on integrated main 2261e5d (draft PR #131).
Not merged, migrated or deployed.

## Handbook and code of conduct (rule HR-POLICY-LANG)

- HR builds and governs every handbook, code of conduct and policy. Only HR publishes, translates or sets a staff language.
- A policy is for an audience (office, guards and officers, everyone) and can be narrowed to roles, job titles or sites.
  A site policy reaches people rostered at that site within 30 days either side of today (Fauzan, 8 Nov 2026: yes).
- Each version has an English text and a Malay copy. Publishing without the Malay copy is refused.
- HR adds more copies for staff mother tongues (Nepali, Bengali, Burmese, Hindi, Urdu, Indonesian, Tamil, Chinese).
  Each copy records who translated it. Prima never machine-translates a policy.
- Each person's mother tongue is what HR sets, otherwise Nepali for a Nepali national and Malay for everyone else.
- HR sees, per policy, the mother tongues still missing a copy and how many staff need each one.
- Staff read and sign in a language of their choice (their mother tongue by default when a copy exists). Officers record
  briefings with the language they briefed in. Every acknowledgement stores that language.
- HR sees how many signed in each language, and how many signed in a language other than their mother tongue.
- A material change (or a change of audience, job or site) asks everyone again and needs the translations again. A small
  correction keeps the translations and the earlier acknowledgements.

## Appeal step (rule HR-APPEAL)

- Office HR cases: a verbal, written or final warning, or an outcome other than no action, can be appealed within 14 days
  (Fauzan, 8 Nov 2026: yes). HR records the appeal from the staff member's letter, with its language. An appeal within the window
  reopens a closed case, and a case cannot close while an appeal waits.
- Guard discipline: a verbal, written or final warning, suspension, downgrade or dismissal can be appealed within 14 days.
  The guard appeals on their own sign-in (Warnings tab), or the company or HR records it from the guard's letter.
  A show-cause letter and the inquiry are how the guard is heard, so they are not appealed.
- The HR Director (CoS or DCoS) or the CEO decides, with written reasons, as upheld, varied to a lighter step, or overturned.
  The person who made or recorded the decision, the person who recorded the appeal, the staff member and the complainant
  never decide it. An overturned guard step leaves the discipline ladder; a varied one counts as the lighter step.
- Appeals waiting appear on the HR Director's and CEO's home, and in HR monitor under "Guard discipline appeals".

## Database

No new tables. New fields sit in existing JSON rows (`hr_policies`, `policy_acks`, `people`, `hr_cases`,
`attendance_followups`) behind their existing walls. The demo seed adds one mock verbal warning for the Nepali test guard.

## Decided (Fauzan, 8 Nov 2026)

- 14-day appeal window: yes.
- The HR Director (CoS or DCoS) or the CEO decides, never someone who made the original decision: yes.
- 30-day roster window for site policies: yes.
- More languages: not yet; added later when needed. The ten listed stay.
