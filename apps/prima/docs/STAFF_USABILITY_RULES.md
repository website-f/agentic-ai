# Staff usability rules (owner decision, 4 November 2026)

Fauzan (CEO) set these standing rules for every Prima Secure module. Use them when designing or reviewing any staff
screen. Where an older document disagrees, these rules are newer.

Goal: each staff member uses five systems or fewer a day, and only Prima Secure needs data entry. The CRM, site survey
forms and tender leads are modules inside Prima Secure.

| Role | Systems a day | Systems |
|---|---|---|
| Guards and field officers | 1 | Prima Secure on phone (attendance, incidents) |
| Site survey staff | 2 | Prima Secure survey form, WhatsApp or Teams |
| Admin executives | 4 | Prima Secure (with CRM), Outlook, Teams, SharePoint |
| Finance and HR | 4 to 5 | The above, plus accounting or payroll software |
| Project Director and management | 3 | Prima Secure dashboard, Outlook, Teams |

Guard attendance and incidents stay in the JA Group app for about one year; the JA app sends the data to Prima, and
guards then move into Prima (Fauzan, 4 Nov 2026). Build guard screens so the move is a switch, not a rebuild.

## Rules

1. One app for all staff.
2. Microsoft (Entra ID) sign-in; no separate Prima passwords.
3. Each role sees only its own menu.
4. Staff screens in Bahasa Melayu, plain words, large buttons that work on a phone. Never name Claude or any AI tool in
   staff screens or guides; refer staff to the Project Director. (The four-leader Arisha pilot is a leadership tool,
   not a staff screen.) Changed by Fauzan, 11 Nov 2026 (K9): staff screens may offer Arisha as a read-only trainer
   ("Learn with Arisha"); still never Claude or an AI vendor's name. See CLAUDE.md, "Workflow boundaries".
5. Survey forms take photos and measurements directly and work offline; they sync when signal returns; nothing is
   retyped.
6. SharePoint files are opened by link, not uploaded as copies.
7. Alerts go to Teams or email, so staff do not open the app just to check.
8. Each module has a rollout timeline with training or explanation.
9. An activity log records who changed what and when.
10. A read-only database login for a monthly copy of all tables to the office Mac Studio, with the firewall open to the
    office only. This is an infrastructure change and needs the owner's approval and the office network details first.

## Check before each release

- Can a new staff member finish the main task in under 5 minutes with no training?
- Does it work on a phone with weak signal?
- Does anyone have to enter the same data twice?
- Does each role see only the menu it needs?

## Applied in code so far

- Phone screens: buttons, fields and tabs are at least 44 px tall and fields use 16 px text (`apps/web/src/styles.css`).
- Guards no longer see the IT screens "Workflow time & quality" and "HR / IT coordination" (`apps/web/src/App.tsx`).
- Staff screens no longer name an AI tool: the IT work guide, tender checklists, meeting summaries and the Director
  Office tender panel. The IT planning suggestion shows only to the four leadership Arisha users (`ItPlan.tsx`).
- Alerts to Teams and email are built and switched off until the Microsoft admin steps are done (`docs/ALERTS_TEAMS_EMAIL.md`).
- Activity log already exists: every change is written to the hash-chained audit trail (`packages/core/src/audit.ts`).

## Owner answers (5 November 2026)

- Default screen language is full Bahasa Melayu; each person can switch to BM + English or English.
- The Project Director is the COO, the OGM and the Operations Director. New roles are added only when needed.
- Sales work is done by admin executives (they prepare and fill new tenders), monitored by the company manager.
  A Sales Director and team come later when needed.
- If guards move into Prima (date undecided), they sign in with face recognition and/or PIN; a PIN alone is not
  enough, because one person can enter several people's PINs.
- Alerts may go to Teams and email. The tender bot and the Mac Studio copy come later.
- Guards keep Memos and Speak up.
