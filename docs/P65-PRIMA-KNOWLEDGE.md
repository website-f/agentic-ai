# P65: Prima Secure knowledge pack

PWVSB Security Group's written procedures from the Prima Secure App are now in every workspace's
Library. Before related work, AI workers look them up and follow them: rosters, attendance,
cases, HR, payroll, claims, finance, purchases, IT jobs, contracts and tenders.

## What is imported (knowledge/prima_pack.py)
Every section becomes a **Library SOP** (scope `library`) titled `Prima · ...`. A department
heading in a source becomes the "People", "Operations" etc. note in the SOP's header.

| Source (in apps/prima) | Library SOPs |
|---|---|
| `docs/system/04-workflows.md` | one per workflow: `Prima · W1 ...` to `Prima · W34 ...` (e.g. `Prima · W12 Monthly staff payroll`), plus "How to read them" |
| `docs/system/02-roles-and-access.md`, `03-business-rules.md` | one per section (`Prima · Business rules · 3.2 Approval chains (who approves what)`) |
| `docs/system/README.md`, `01-overview.md`, `05-status-and-gaps.md` | one each |
| `docs/system/screens/*.md` | one per screen file |
| `docs/system/reference/rule-register.md` | one per rule area (`Prima · Rule register · Payroll (PAY)`); each carries the Law / Secondary / Policy / Unverified legend |
| `docs/system/reference/record-forms.md` | one per record kind (`Prima · Record form · Office staff member (officeStaff)`) |
| `docs/system/reference/guide-cards.md` | one per department's cards |
| `docs/system/reference/handover-map.md` | one |
| `apps/web/src/it-guide/catalog.ts` | one per IT guide (19): steps, what you need, who checks, who approves, oversight, setup |
| `docs/IT_*.md`, `docs/HR_IT_INTAKE_*.md`, `docs/STAFF_DATA_SECURITY.md`, `docs/WEBSITE_*.md` | one each |
| `CLAUDE.md` | its "Workflow boundaries" section only |

That comes to about 197 SOPs, around 440k characters.

### How agents reach them
- **Lookup tools.** `find_sop` and `search_library` find every SOP. The descriptions of both
  tools now mention the company's imported workflows, rules and forms.
- **Recall.** Strong passages are recalled into a task or chat on their own (auto-RAG).
- **Not in every prompt.** Library-scope SOPs are never pushed whole into prompts, so the
  prompts stay small.
- **A short note in the prompt.** Where the pack is imported, every agent's system prompt gets
  a **Company procedures** part (`prima_pack.PROMPT_NOTE`). It says:
  - look the procedure up before related work, follow it and cite it;
  - prepare drafts only, and never decide or approve pay, deductions, discipline, contracts or
    payments;
  - never mark work as checked or accepted;
  - never invent rates, amounts, dates or evidence;
  - Unverified or Proposed rules are not fact;
  - staff send and reply to email in Outlook themselves.

## Re-runs
- **Keys.** `sops.pack_key` names the section, for example
  `prima:docs/system/04-workflows.md#w12`. It is unique per workspace (migration 0046), so the
  import never duplicates a section.
- **Hash.** `sops.pack_hash` is the sha256 of the title and body that the import last wrote.
- **Unchanged section:** skipped.
- **Changed section:** updated, the version goes up, and the indexer rebuilds its passages.
- **Section a person edited in the app:** kept as they left it. An owner's forced run
  overwrites it.
- **Unpublished section (set to draft):** stays a draft. Re-runs still update its text.
- **Deleted section:** a deleted SOP comes back on the next run. To hide one, unpublish it.
- **Section removed from its source file:** removed from the Library. A source file that is
  missing removes nothing.
- **Unindexed sections:** active pack SOPs with no passages, for example after an embedding
  failure, are indexed on the next run.

## When it runs
- **API start.** A background task (`prima_pack.run_at_startup`) runs for every workspace.
  Start-up never fails because of it.
- **Worker.** The liveness round runs every 10 minutes (`sync_all`). It covers workspaces
  created since the API started. When nothing changed, it costs one read of the pack and one
  query per workspace.
- **Owner run.** `POST /api/library/packs/prima` with `{"force": false}` is owner only
  (`members.assign_owner`) and is always audited as `knowledge_pack.synced`. It answers with the
  counts (created, updated, unchanged, kept, removed, indexing) and builds passages after it
  answers. It returns 404 `pack_not_found` when the folder is not on the server.
- **Automatic runs** are audited only when something changed (actor `system`).
- **Turning it off.** `AGENTIC_PRIMA_PACK=false` stops the automatic runs. The owner endpoint
  still works.

## Where the files are
The module looks in these places, in order:
1. `AGENTIC_PRIMA_PACK_DIR`;
2. `/app/prima-pack` in the image;
3. the repo's `apps/prima` (local runs and tests).

The folder mirrors `apps/prima`. The API/worker image needs these lines in the **runtime**
stage of `deploy/api.Dockerfile`, after the `pc-agent/install` COPY:

```dockerfile
# P65: the Prima Secure knowledge pack (agentic/knowledge/prima_pack.py reads it here).
COPY --chown=app:app apps/prima/docs/system /app/prima-pack/docs/system
COPY --chown=app:app apps/prima/docs/IT_*.md apps/prima/docs/HR_IT_INTAKE_*.md apps/prima/docs/STAFF_DATA_SECURITY.md apps/prima/docs/WEBSITE_*.md /app/prima-pack/docs/
COPY --chown=app:app apps/prima/apps/web/src/it-guide/catalog.ts /app/prima-pack/apps/web/src/it-guide/catalog.ts
COPY --chown=app:app apps/prima/CLAUDE.md /app/prima-pack/CLAUDE.md
```

`.dockerignore` excludes only the top-level `docs` and `CLAUDE.md`, so `apps/prima/...` reaches
the build context. Without these lines the import finds no folder in the image, does nothing and
removes nothing.
