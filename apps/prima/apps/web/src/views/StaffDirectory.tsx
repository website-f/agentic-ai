import { Select } from '../SearchSelect';
import { useMemo, useRef, useState } from "react";
import {
  STAFF_DIRECTORY_ISSUE_LABELS,
  type StaffDirectoryIssue,
  type StaffDirectoryPreview,
} from "@prima/core";
import { api } from "../api";
import { Chip, ErrorNotice, Kpi, Loading, useAction, useLoad } from "../ui";
import { Empty, PageHead } from "../kit";
import { PlusIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { jumpTo } from "./AddImportMenu";

/**
 * Staff directory (Fauzan, 4 Nov 2026): HR loads the office staff list once (preview, send, and the HR Director or the
 * CEO approves), then keys in anyone missing by hand. IT sees the list to fix accounts. An entry is never a sign-in.
 */
const GROUPS: [string, string][] = [
  ["company", "Company office"],
  ["central_unit", "Central unit"],
  ["operations_region", "Operations region"],
];
const groupLabel = (g: string) => GROUPS.find(([k]) => k === g)?.[1] ?? g;

export function StaffDirectory() {
  const status = useLoad(() => api.staffDirectoryStatus(), []);
  // P90: the screen sits in the page frame with the kit's page head, like every other screen.
  let body;
  if (status.loading && !status.data) body = <Loading what="staff directory" />;
  else if (status.error) body = <ErrorNotice error={status.error} />;
  else if (!status.data?.enabled || !status.data.ready)
    body = (
      <section className="panel">
        <Empty
          title={
            status.data?.enabled
              ? "The staff directory is switched on but not yet set up in the database."
              : "The staff directory is not switched on yet."
          }
        >
          IT sets it up after the CEO approves the release.
        </Empty>
      </section>
    );
  else body = <Directory />;
  return (
    <div className="page">
      <PageHead
        title="Staff directory"
        sub="Office staff and their Microsoft 365 mailboxes. This list does not give anyone a sign-in: accounts are still linked one by one by IT through HR/IT coordination. Personal data: do not copy it out of Prima."
      />
      {body}
    </div>
  );
}

function Directory() {
  const board = useLoad(() => api.staffDirectory(), []);
  const [issue, setIssue] = useState<StaffDirectoryIssue | "">("");
  const [find, setFind] = useState("");
  const b = board.data;
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (b?.entries ?? []).filter(
      (e) =>
        (!issue || e.issues.includes(issue)) &&
        (!q ||
          `${e.name} ${e.orgUnit} ${e.email} ${e.title}`
            .toLowerCase()
            .includes(q)),
    );
  }, [b, issue, find]);
  if (board.loading && !b) return <Loading what="staff directory" />;
  if (board.error || !b) return <ErrorNotice error={board.error} />;
  const waiting = b.batches.filter((x) => x.status === "waiting");
  return (
    <>
      {/* P91: the two ways to add, at the top: the whole list from a file (approved as a batch) or one person. */}
      {(b.can.prepare || b.can.addOne) && (
        <div className="p91-actions" style={{ marginBottom: 12 }}>
          {b.can.addOne && (
            <button className="btn btn-primary" onClick={() => jumpTo("sd-add-one")}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" /> Add one person
            </button>
          )}
          {b.can.prepare && (
            <button className="btn" onClick={() => jumpTo("sd-import")}>
              <UploadSimpleIcon size={16} weight="bold" aria-hidden="true" /> Load the staff list (CSV)
            </button>
          )}
        </div>
      )}
      <div className="kpis">
        <Kpi label="People listed" value={b.entries.length} />
        <Kpi
          label="Personal Outlook"
          value={b.issueCounts.personal_outlook ?? 0}
          tone={b.issueCounts.personal_outlook ? "warn" : "ok"}
        />
        <Kpi
          label="Shared mailbox"
          value={b.issueCounts.email_used_more_than_once ?? 0}
          tone={b.issueCounts.email_used_more_than_once ? "warn" : "ok"}
        />
        <Kpi
          label="No job title"
          value={b.issueCounts.no_title ?? 0}
          tone={b.issueCounts.no_title ? "warn" : "ok"}
        />
        <Kpi
          label="Batches waiting"
          value={waiting.length}
          tone={waiting.length ? "info" : "neutral"}
        />
      </div>
      {b.batches.length > 0 && <Batches batches={b.batches} />}
      {b.can.prepare && (
        <div id="sd-import">
          <Import />
        </div>
      )}
      {b.can.addOne && (
        <div id="sd-add-one">
          <AddOne />
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Everyone listed</h3>
        </div>
        <div className="panel-body">
          <div
            className="row"
            style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}
          >
            <input
              className="input"
              style={{ flex: "1 1 260px" }}
              aria-label="Find"
              placeholder="Find a name, company, unit or mailbox"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
            <Select
              className="select"
              aria-label="Show only"
              value={issue}
              onChange={(e) =>
                setIssue(e.target.value as StaffDirectoryIssue | "")
              }
            >
              <option value="">All entries</option>
              {(
                Object.keys(
                  STAFF_DIRECTORY_ISSUE_LABELS,
                ) as StaffDirectoryIssue[]
              ).map((k) => (
                <option key={k} value={k}>
                  Needs fix: {STAFF_DIRECTORY_ISSUE_LABELS[k].split(":")[0]} (
                  {b.issueCounts[k] ?? 0})
                </option>
              ))}
            </Select>
          </div>
          {shown.length === 0 ? (
            <Empty title={`Nobody listed${issue || find ? " for this filter" : " yet"}.`} />
          ) : (
            <div className="list">
              {shown.map((e) => (
                <div
                  key={e.id}
                  className="list-item"
                  style={{
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 4,
                  }}
                >
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <strong>{e.name}</strong>
                    <span className="muted small">{e.title || "no title"}</span>
                    <span className="small">
                      {groupLabel(e.group)} · {e.companyName ?? e.orgUnit}
                    </span>
                  </div>
                  <span className="small">
                    {e.email || "no mailbox"}
                    {e.accountType ? ` · ${e.accountType}` : ""}
                    {e.accountStatus ? ` · ${e.accountStatus}` : ""}
                  </span>
                  {e.issues.length > 0 && (
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {e.issues.map((i) => (
                        <Chip
                          key={i}
                          tone="warn"
                          title={STAFF_DIRECTORY_ISSUE_LABELS[i]}
                        >
                          {STAFF_DIRECTORY_ISSUE_LABELS[i].split(":")[0]}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

type BatchRow = Awaited<
  ReturnType<typeof api.staffDirectory>
>["batches"][number];

function Batches({ batches }: { batches: BatchRow[] }) {
  const act = useAction();
  const [comment, setComment] = useState<Record<string, string>>({});
  const decide = (id: string, approve: boolean) =>
    void act.run(
      () =>
        api.staffDirectoryAct("decide", {
          batchId: id,
          approve,
          comment: comment[id] ?? "",
        }),
      approve ? "Batch approved and added." : "Batch returned to HR.",
    );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Batches</h3>
      </div>
      <div className="panel-body">
        <div className="list">
          {batches.map((x) => (
            <div
              key={x.id}
              className="list-item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
            >
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Chip
                  tone={
                    x.status === "approved"
                      ? "ok"
                      : x.status === "returned"
                        ? "unknown"
                        : "info"
                  }
                >
                  {x.status === "waiting" ? "Waiting for approval" : x.status}
                </Chip>
                <strong>{x.source}</strong>
                <span className="small">
                  {x.rows} new · {x.alreadyIn} already listed · sent by{" "}
                  {x.preparedBy} on {x.preparedAt.slice(0, 10)}
                </span>
              </div>
              {x.decidedBy && (
                <span className="small">
                  {x.status} by {x.decidedBy} on {x.decidedAt?.slice(0, 10)}:{" "}
                  {x.comment}
                </span>
              )}
              {x.status === "waiting" && x.ownBatch && (
                <span className="muted small">
                  You sent this batch, so someone else approves it.
                </span>
              )}
              {x.canDecide && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    aria-label="Comment"
                    placeholder="Your comment (needed)"
                    value={comment[x.id] ?? ""}
                    disabled={act.busy}
                    onChange={(e) =>
                      setComment((c) => ({ ...c, [x.id]: e.target.value }))
                    }
                  />
                  <button
                    className="btn btn-sm"
                    disabled={
                      act.busy || (comment[x.id] ?? "").trim().length < 3
                    }
                    onClick={() => decide(x.id, true)}
                  >
                    Approve and add
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={
                      act.busy || (comment[x.id] ?? "").trim().length < 3
                    }
                    onClick={() => decide(x.id, false)}
                  >
                    Return to HR
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}

function Import() {
  const look = useAction();
  const send = useAction();
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<StaffDirectoryPreview | null>(null);
  // A preview that finishes after a later edit is dropped, so what is sent is what was previewed.
  const round = useRef(0);
  const edit = (change: () => void) => {
    round.current++;
    change();
    setPreview(null);
  };
  const readFile = (f: File | undefined) => {
    if (!f) return;
    const mine = ++round.current;
    const r = new FileReader();
    r.onload = () => {
      if (mine !== round.current) return;
      setText(String(r.result ?? ""));
      setSource((s) => (s.trim() ? s : f.name));
      setPreview(null);
    };
    r.readAsText(f);
  };
  const doPreview = () => {
    const mine = round.current;
    void look
      .run(
        () =>
          api.staffDirectoryAct("preview", {
            text,
            source,
          }) as Promise<StaffDirectoryPreview>,
      )
      .then((p) => p && mine === round.current && setPreview(p));
  };
  const bad = preview ? preview.rows.filter((r) => r.errors.length) : [];
  const blocked =
    !preview ||
    bad.length > 0 ||
    preview.problems.length > 0 ||
    preview.missingColumns.length > 0 ||
    preview.ready === 0;
  const doSend = () =>
    void send
      .run(
        () =>
          api.staffDirectoryAct("submit", {
            text,
            source,
            fingerprint: preview!.fingerprint,
          }) as Promise<{ rows: number }>,
        (r) => `Sent ${r.rows} people for approval.`,
      )
      .then((r) => r && edit(() => setText("")));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Load the staff list</h3>
      </div>
      <div className="panel-body">
        <p className="muted small">
          Choose the CSV in the staff directory format
          (data/staff-directory/TEMPLATE.csv), or paste rows copied from Excel
          with the heading row. Needed columns: group, org_unit, name. Check the
          preview, then send it; the HR Director or the CEO approves, and every
          row goes in at once. People already listed are left out. In the test
          link, use dummy rows only.
        </p>
        <div
          className="row"
          style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}
        >
          <input
            className="input"
            aria-label="Where the rows come from"
            placeholder="Where from: file name and date"
            value={source}
            onChange={(e) => edit(() => setSource(e.target.value))}
          />
          <input
            className="input"
            type="file"
            accept=".csv,text/csv,text/plain"
            aria-label="CSV file"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </div>
        <textarea
          className="textarea"
          aria-label="Rows"
          rows={6}
          placeholder="Or paste the rows here, heading row first"
          value={text}
          onChange={(e) => edit(() => setText(e.target.value))}
        />
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button
            className="btn btn-sm"
            disabled={
              look.busy || send.busy || !text.trim() || source.trim().length < 3
            }
            onClick={doPreview}
          >
            Preview
          </button>
          <button
            className="btn btn-sm"
            disabled={blocked || send.busy || look.busy}
            onClick={doSend}
          >
            Send {preview?.ready ?? 0} for approval
          </button>
        </div>
        <ErrorNotice error={look.error ?? send.error} />
        {preview && (
          <>
            {preview.problems.map((p) => (
              <p key={p} className="notice" data-tone="crit">
                {p}
              </p>
            ))}
            {preview.missingColumns.length > 0 && (
              <p className="notice" data-tone="crit">
                Missing columns: {preview.missingColumns.join(", ")}.
              </p>
            )}
            {bad.length > 0 && (
              <p className="notice" data-tone="crit">
                Fix row {bad.map((r) => r.row).join(", ")} and preview again; a
                batch goes in whole or not at all.
              </p>
            )}
            <p className="small">
              {preview.rows.length} rows read · {preview.ready} new ·{" "}
              {preview.rows.filter((r) => r.alreadyIn).length} already listed
            </p>
            <div className="list">
              {preview.rows.map((r) => (
                <div
                  key={r.row}
                  className="list-item"
                  style={{
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 4,
                  }}
                >
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <span className="muted small">Row {r.row}</span>
                    {r.errors.length ? (
                      <Chip tone="crit">Error</Chip>
                    ) : r.alreadyIn ? (
                      <Chip tone="unknown">Already listed</Chip>
                    ) : (
                      <Chip tone="ok">New</Chip>
                    )}
                    <strong>{r.name || "(no name)"}</strong>
                    <span className="small">
                      {groupLabel(r.group)} · {r.orgUnit} ·{" "}
                      {r.email || "no mailbox"}
                    </span>
                  </div>
                  {r.errors.length > 0 && (
                    <span className="small" data-tone="crit">
                      {r.errors.join(" ")}
                    </span>
                  )}
                  {r.issues.length > 0 && (
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {r.issues.map((i) => (
                        <Chip
                          key={i}
                          tone="warn"
                          title={STAFF_DIRECTORY_ISSUE_LABELS[i]}
                        >
                          {STAFF_DIRECTORY_ISSUE_LABELS[i].split(":")[0]}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function AddOne() {
  const act = useAction();
  const empty = {
    group: "company",
    orgUnit: "",
    name: "",
    title: "",
    email: "",
    accountType: "",
    entraStatus: "",
    verified: "",
    accountStatus: "",
    sourceNote: "",
  };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () =>
    void act
      .run(
        () => api.staffDirectoryAct("addOne", f),
        "Added to the staff directory.",
      )
      .then((r) => r && setF(empty));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Key in someone missing</h3>
      </div>
      <div className="panel-body">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Select
            className="select"
            aria-label="Group"
            value={f.group}
            onChange={set("group")}
          >
            {GROUPS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <input
            className="input"
            aria-label="Company, unit or region"
            placeholder="Company, unit or region"
            value={f.orgUnit}
            onChange={set("orgUnit")}
          />
          <input
            className="input"
            aria-label="Name"
            placeholder="Name"
            value={f.name}
            onChange={set("name")}
          />
          <input
            className="input"
            aria-label="Job title"
            placeholder="Job title"
            value={f.title}
            onChange={set("title")}
          />
          <input
            className="input"
            aria-label="Mailbox"
            placeholder="Mailbox"
            value={f.email}
            onChange={set("email")}
          />
          <input
            className="input"
            aria-label="Account type"
            placeholder="Account type (Outlook HQ, Admin, Personal)"
            value={f.accountType}
            onChange={set("accountType")}
          />
          <input
            className="input"
            aria-label="Entra status"
            placeholder="Entra status"
            value={f.entraStatus}
            onChange={set("entraStatus")}
          />
          <input
            className="input"
            aria-label="Verified"
            placeholder="Verified"
            value={f.verified}
            onChange={set("verified")}
          />
          <input
            className="input"
            aria-label="Account status"
            placeholder="Account status"
            value={f.accountStatus}
            onChange={set("accountStatus")}
          />
          <input
            className="input"
            aria-label="Where the details come from"
            placeholder="Where the details come from (needed)"
            value={f.sourceNote}
            onChange={set("sourceNote")}
          />
          <button
            className="btn btn-sm"
            disabled={
              act.busy ||
              !f.name.trim() ||
              !f.orgUnit.trim() ||
              f.sourceNote.trim().length < 3
            }
            onClick={save}
          >
            Add
          </button>
        </div>
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}
