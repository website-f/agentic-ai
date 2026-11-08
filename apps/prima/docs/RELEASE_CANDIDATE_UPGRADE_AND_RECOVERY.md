# Release candidate 8 Nov 2026: database upgrade and recovery

How to move a Prima database to this candidate, check that nothing was lost, and go back if something is wrong. It
builds on the reviewed packages already in the repository and changes none of them:
- `ops/base-transition` (stage 1);
- `ops/combined-upgrade` (stage 2, from #134);
- the pinned module installer (`apps/api/src/module-install.ts`).

Nothing here runs by itself. Each step that writes needs the CEO's go-ahead for the exact target, as the packages
already require.

## 0. Where the database stands

Read-only, as the runtime login:

```
SELECT id, migration_sha256 FROM prima.schema_info;
```

| Stamp | Meaning | Start at |
|---|---|---|
| `678910…071b` | the reviewed live base | step 2 |
| `4b4cf4d3…78fe` | after stage 1 | step 3 |
| `970b976b…71da` | already on main's combined base | step 4 |
| anything else | unknown | stop; nothing below applies |

Also list which release modules are installed (the API's release catalogue does this, read-only), and confirm the
schema owner login and its rights (`ops/combined-upgrade/README.md`, "Still open before anyone runs it").

## 1. Before anything writes

1. **Maintenance window.** Agree it, close ingress and stop the old API. The old API does not work with the new base.
2. **Backup.**
   - On Azure Database for PostgreSQL, note the point-in-time restore time. Also take an on-demand logical backup:
     `pg_dump --format=custom` of the `prima` schema as the owner, kept outside the server.
   - Elsewhere, take `pg_dumpall` as an administrator.
   - Check that the file is readable: `pg_restore --list`, or `gzip -t` for a dump that was gzipped.
3. **Counts.** Record the row count of every table in `prima`. The packages fingerprint every table themselves; the
   counts are for people to compare.

## 2. Stage 1 (only if stamped `678910…`)

`ops/base-transition`: plan, then execute with the pinned hashes, following its README. It refuses any other stamp.

## 3. Stage 2

`ops/combined-upgrade`: `cli.cjs plan`, then `cli.cjs execute` with the exact hashes the plan prints, following its
README. It runs in one transaction. Before committing, it checks that:
- the old tables keep every row byte for byte;
- the walls, owners and grants are as reviewed.

If any check fails, it rolls back. A second run is refused.

## 4. The release modules

Install, in this order, with the pinned installer and the hashes it prints (`node dist/src/module-install.js` with no
arguments shows the plan):

1. `procurement`, `rental_corrections`, `cleanup`, `metrics`, `job_email`, if they are not installed yet.
2. `item_register`.
3. `item_register_v2`. It needs `item_register` and is refused without it.

An installed module is a no-op, and a drifted one is refused. The release stays "not ready" until both item modules
are present (`state.ready` is false while any module is missing).

## 5. The new API

Deploy the API image built from this branch. Check its release catalogue (`/api/health` and the catalogue state):
the base and all seven modules must be ready.

## 6. Proposed modules (each only with the CEO's approval)

These are not part of the release. Each is a separate explicit migration, run as the schema owner. Install any that
were approved, in this order:
1. `client-codes` before `rba-readiness`;
2. then `am-extras`, `cleaning-ops`, `fw-epf-socso-recharge`, `fw-recruitment-cost`, `governance-registers`,
   `pdpa-register`, `quality-compliance`, `site-surveys`, `staff-directory`, `tender-opportunities` and `time-slip`,
   as needed.

Each file is `BEGIN … COMMIT`. Until a module is installed, its screens say "not switched on". The staff directory
also needs `STAFF_DIRECTORY_ENABLED=true`.

The proposals in `db/proposed` (pay formulas, guard pay, FW recruitment, Central Admin and others) follow their own
`after` lists.

## 7. Checks after the upgrade

- **Row counts:** no existing table changed its row count. Only new tables were added.
- **Stamp:** `schema_info` holds the stamp of `db/migrations/001_init.sql`.
- **Catalogue:** the API's release catalogue is ready.
- **Security:** every new company table has forced row security, and nothing is granted to PUBLIC.
  - Exception, by design: `tender_opportunities` and `tender_sources` are group lists like `tender_groups`. They
    hold no prices or files, and each company's bid stays behind its own wall.
- **Roles and screens:** sign in as one person from each department and open their home and main screens. A screen
  must show data or say plainly why not; it must never show "Something went wrong on the server".

## 8. Going back

- **If a step failed:** the step rolled back on its own (stage 1, stage 2 and each module are one transaction). Do
  not retry blindly. Read the catalogue read-only, fix the cause, then start again from section 0.
- **If the new release must be withdrawn after it committed:**
  1. Stop the API.
  2. Restore the backup from section 1: point-in-time restore on Azure, or `pg_restore` / `psql` of the dump into a
     fresh database, then point the API at it.
  3. Redeploy the previous API image.

  Anything entered after the backup is lost, which is why ingress stays closed during the window.
- **To go forward again:** the same steps from section 0. They are repeat-safe: a second stage 2 is refused, and
  installed modules are no-ops.

## 9. Rehearsed

| What | Where | Result |
|---|---|---|
| Stage 2: commit, preservation, injected failure rollback, replay refused, wrong stamp refused | Fresh PostgreSQL 16 (`combined-upgrade.pg.test.cjs`) | 6/6 |
| Stage 1 | Fresh PostgreSQL 16 (`base-transition.pg`, `cli.pg`) | 11/11, 7/7 |
| Main to candidate with the seven modules, rollback and replay | `run-combined-upgrade-pg.sh` on Linux PostgreSQL 16 | 2/2 (restricted owner and existing admin): data and boundaries preserved. On Windows, run it in a Linux container with the workspace links recreated. |
| The whole candidate, its module refresh and the 13 proposed modules | A restored copy of the Agentic Office's live database (240 tables, real but small), 8 Nov 2026 | No existing row count changed. The second run changed nothing. The new API started healthy. Then it was done on live the same way. |

The last row starts from a different point than Azure staging. The office database had its own combined base
(stamp `76161ab4…`) and moved to this candidate's through the office's repeat-safe `db-setup`, not through stage 1 and
stage 2. It proves the module steps and the "no row lost" checks on real data. It does not prove the Azure stage 1 and
stage 2 path, which the PostgreSQL 16 rehearsals above cover.
