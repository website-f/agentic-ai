# CEO Playbook — ChatGPT, Claude Code and IT staff
**Audience:** CEO acting as business owner/technical sponsor without programming background
**Status:** Recommended governance process (not an automatic ChatGPT ↔ Claude connection).

## Who does what
- **CEO:** state desired outcome in everyday language; approve scope, business rules, budgets, permissions, go-live and any irreversible changes. You do not have to code or debug.
- **ChatGPT — planner / independent reviewer:** gather business requirements, map the controlled 214-SOP baseline, produce clear acceptance criteria, architecture trade-offs and test plans, inspect GitHub changes when available, and summarize risks in business language. Do not claim that a feature was deployed merely because a PR exists.
- **Claude Code — builder:** read GitHub task briefs and controlled documents, implement small changes, add tests, run CI, show screenshots or working demos, propose draft PRs. No live secrets, production data or unapproved deployment.
- **IT Manager & IT Lead — real-world operators:** manage Microsoft admin actions and cloud configuration under accountable roles, validate accounts and vendor bills, perform tests and rollback. Use least-privilege admin accounts, not the CEO's personal login.
- **ACT / departmental heads / Finance / legal:** perform independent controls, business UAT, data protection and regulated-process checks.

**Important:** ChatGPT and Claude do not continuously talk to each other by default. **GitHub is the shared handoff**, using versioned docs, issues, PRs, tests and review comments. A completed task must have a link to evidence.

## The six-step routine — repeat for each feature
1. **CEO says the requirement** in plain language (e.g. “An IT staff member requests a laptop; only I approve spending; Finance pays after approval”).
2. **ChatGPT converts** it into a one-page task: problem, who uses it, workflow, approvals, fields, permitted roles, failure cases, definition of done.
3. **Claude implements** it in a feature branch and creates a draft PR with tests and a demo; do not alter live data.
4. **ChatGPT reviews** code and test evidence independently, including the relevant SOP IDs, company access and negative cases.
5. **Department staff test** a realistic scenario with synthetic data; IT Manager/ACT and other controls sign off where needed.
6. **CEO authorizes merge/deployment separately**. “Looks good” on a UI screenshot is not go-live approval.

## A sample CEO prompt to ChatGPT
“I want Phase 1 IT staff to request laptops through Prima using their Microsoft 365 accounts. Define the SOP, exact steps, who approves, screens, reminders, reports and tests. Preserve the existing Prima code and legal-company separation. Produce a GitHub-ready instruction for Claude. Tell me only what I must decide.”

## A sample CEO prompt to Claude Code
“Read docs/START_HERE_CEO_MICROSOFT_ROADMAP.md and docs/architecture/MICROSOFT_FIRST_PLATFORM.md. Work only on the next approved Phase 1 IT task. Inspect current code; do not rewrite. Provide a gap report and a small draft PR with tests. Do not provision Azure, purchase services, use real employee data, request passwords, approve spending or deploy.”

## Reporting format the CEO should always receive
- **What works now** (code + test evidence)
- **What is only demonstrated** (mock/stub, not integrated)
- **What is blocked and why**
- **What Claude changed** (PR link and test status)
- **What it costs** (projected vs actual, including licence costs)
- **What the CEO must decide** (maximum 3 concrete choices)

## Rules that prevent trouble
- Do not paste passwords, Microsoft tenant secrets, bank details or employee IDs into AI chats.
- Use separate admin identities for infrastructure and normal work. Keep at least two authorized human break-glass/recovery arrangements per approved security policy.
- Never commit or merge directly to main during a development session without review.
- Never allow AI to sign contracts, approve spending, grant user permissions, execute payroll/payments or control regulated safety equipment on its own.
- Store SOPs as controlled drafts until business owners, counsel/regulators where required, and departments approve the operating policy.
- Do not spend time learning code first; learn how to identify a completed test, a company-access violation, and an approval exception.

## What “we are ready for Phase 2” means
IT staff can actually sign in with M365, complete an end-to-end ticket and purchase, maintain asset register, send approved notifications and recover a failed deployment/backup, with a published support owner and audited sign-off. Only then promote Finance.
