# Prima helper (the agent that helps staff do their work)

Owner decisions: Fauzan, 23 Nov 2026: "Make sure ai agent can help with everything. Like start new inventory request when
ogm instructed. What prima app give permission for the person or department can do, agent can help it do. Make sure we
have skill library so agent remember. Make sure library also store personalized style of each staff", then "Yes. Make
sure agent know what to do on everything and can help the staff to do it."

Status: source only, on draft PR #145. Not merged, migrated or deployed. Module `assistant-v1` is off the release list.

## What it does

Screen "Helper" (`apps/web/src/views/Assistant.tsx`). The person types what they need in their own words, for example
"OGM minta 5 seluar saiz 32 untuk Pusat Perubatan Bukit Bintang 11, tapak baharu".

1. **Understands** with fixed rules (`packages/core/src/assistant.ts`, no AI): which job it is, dates ("esok", "25 Nov",
   "1/12"), times ("3pm", "9 pagi"), hours, choices, and the site, store items (with size; Malay names such as seluar,
   kasut, baju, lencana) and receiving OM from Prima's own lists, read as the person under their walls.
2. **Fills the job's form** and marks where each value came from: the person's words, a skill, or their usual choice.
   A size the store does not have is never swapped for another; anything not found is listed as "Still to fill".
3. **Sends only when the person presses Send**, through the same server action as the job's own screen, as the person.
   Every check of that action applies (for example the receiving OM for an office request, the uniform allowance, one
   open request per item). The helper adds no right.
4. For anything it does not fill, it shows the person's own guide card for that job (steps and an "Open screen" button).

It never approves, confirms, decides, signs, pays or disciplines; those stay on their screens with the person's reason.

## Jobs it fills now

| Job | Who is offered it | Sent through |
| --- | --- | --- |
| Site supplies request (Permohonan Pesanan Barang) | OM, Regional OM, OGM, Operations Director, COO, Inventory Manager, Procurement executive, group leaders | the site supplies request, then Submit for an OM's draft |
| Apply for leave | staff | Leave (own record) |
| Ask IT for help | staff | IT help request |
| Report a problem with Prima | staff | Report a problem |
| Time slip, Overtime claim | office staff | the same requests |
| Set up a meeting | office staff | Meetings |
| Ask my manager for help, Add a task for myself | office staff | Work |
| Staff claim (medical, dental, optical, check-up) | office staff with a staff record | Claims (receipt needed) |
| Office expense (consumables, utilities, rent) | Company Manager | Office expenses; without the bill it is kept as a draft |
| Client request | company office, OM tiers | Client board |
| Vacancy | HR, Company Manager | HR vacancies |
| Payment request | Company Manager | Payment requests |
| Police help (call or visit) | company office | Police help |
| Leave for a guard or staff member | company office, OM tiers, HR | Leave (MC needed for sick leave) |
| Report an incident or case | company office, supervisor, OM tiers | Cases (photo or document needed) |
| Uniform for one guard | Government Operations OM tiers the uniform screen allows | Uniform requests |
| Purchase request | company office, Procurement (not storekeepers) | Purchasing |
| Foreign worker task | FWM | FWM tasks |
| Ask for a vehicle | office staff (not supervisors or patrol officers) | Fleet |
| Fuel fill-up | Transport | Fleet (receipt; card chosen when paid by card) |
| Rent payment received | Asset Management team | Rental units (only up to what is still due) |
| Audit finding | ACT | ACT findings |
| IT purchase | IT Manager, Lead, executives | IT procurement |
| PDPA request | PDPA officer | PDPA |
| Legal matter | Legal, Company Manager | Governance |

Lists on the form (companies, a company's sites and staff, clients, vehicles and their cards, rental units, uniforms,
foreign workers, finding owners) are read as the person, so they show only what that person's own screen shows. When
there is only one to choose it is suggested and marked to check. Every job is still refused by its own server action if
the person may not do it.

Left out on purpose: approvals, signing, paying, payroll, discipline, Arms and CMS actions, Speak-up, Finance's own
payment entry, HR allowance changes, stock issue and counts, and IT ticket work. These open their own screen through
the guide.

More jobs are added by listing them in `ASSISTANT_ACTIONS` with the action they send through.

## Skill library and personal style

- **Skill**: a named way of doing one job and the words that call it up, for example "New site start-up" (words: tapak
  baharu, new site) = site supplies request, for a new site, this site, this receiving OM. It keeps choices only, never
  dates, times, quantities or items. A person saves their own; the head or manager of a department or company office
  saves one for the team, and every member's helper uses it. A skill is never edited or deleted: it is retired with a
  reason, and kept.
- **Style**: each person's own language, sign-off, usual choices per job and their own words for things ("pants" = the
  store's trousers 32), learned only from forms they sent. Only that person sees it, and they can clear it.

Database: one table `prima.assistant_memory` (`db/modules/assistant-v1.sql`): style rows and own skills are read and
written only by their owner; team skills are read by that team (or a company the session may see) and group leaders;
a saved skill can only be retired; no DELETE. Before the module is run, the helper still fills and sends forms, and
says the library is not installed.

## Not done

- The online reader for what the rules miss (kind `assistant` in `AI_AGENT_KINDS`, USD 25 cap) is not built; the
  helper is system-only now.
- Approval steps and record forms beyond the jobs above open their own screen through the guide.

## Tests

Core `packages/core/test/assistant.test.ts` (14) and `packages/core/test/assistant-jobs.test.ts` (20: each department job from words to Send, and who is offered it). PostgreSQL `apps/api/test/assistant-pg.test.ts` (5). Browser
`scripts/assistant-browser-uat.cjs` (56 steps, computer and phone size, synthetic data).
