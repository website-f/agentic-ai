import { Select } from '../SearchSelect';
import { useState } from "react";
import {
  POLICE_HELP_GUIDE,
  POLICE_HELP_KIND_LABEL,
  POLICE_HELP_REASON_LABEL,
  POLICE_HELP_STEP_LABEL,
  type PoliceHelpKind,
  type PoliceHelpReason,
  type PoliceHelpStep,
  type ProofInput,
} from "@prima/core";
import { api, type PoliceHelpBoard } from "../api";
import { useApp } from "../App";
import {
  Chip,
  Drawer,
  ErrorNotice,
  Loading,
  Sev,
  dateTimeLabel,
  useAction,
  useLoad,
  type Tone,
} from "../ui";
import { ProofPicker } from "./Proof";

// Police call or visit help (Fauzan, 3 Nov 2026). The company asks, Arms Control sends someone and records what
// happened with proof, the company confirms. CMS and arms leaders watch read-only. The guide is read-only text.

type Row = PoliceHelpBoard["rows"][number];

const STEP_TONE: Record<PoliceHelpStep, Tone> = {
  asked: "warn",
  assigned: "info",
  helped: "info",
  confirmed: "ok",
  withdrawn: "neutral",
};

/** "2026-11-05T10:00" from a datetime-local input, as Malaysian time. */
const fromLocal = (v: string) => (v ? `${v}:00+08:00` : null);

/** Who the board is for decides the words at the top. */
const INTRO: Record<PoliceHelpBoard["role"], string> = {
  asker:
    "Police phoned or are coming to check the armoury? Ask Arms Control. They will call you and send someone to help you speak with the police.",
  arms: "Companies asking for help with a police call or visit. Name a helper, then record what happened with proof. The company confirms.",
  monitor:
    "Police calls and visits the companies asked Arms Control to help with. View only.",
};

export function PoliceHelpPanel({ title = true }: { title?: boolean }) {
  const { data, error } = useLoad(() => api.policeHelp(), []);
  const [asking, setAsking] = useState(false);
  const [guide, setGuide] = useState(false);
  const [open, setOpen] = useState<{
    row: Row;
    what: "assign" | "outcome" | "answer" | "withdraw";
  } | null>(null);
  const [all, setAll] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="police help" />;
  const active = data.rows.filter(
    (r) =>
      r.help.step === "asked" ||
      r.help.step === "assigned" ||
      r.help.step === "helped",
  );
  const rows = all ? data.rows : active;
  return (
    <section className="panel" aria-label="Police call or visit help">
      {title && (
        <div className="panel-head">
          <h2>Police call or visit help</h2>
          <span className="muted small">
            Bantuan panggilan atau lawatan polis
          </span>
        </div>
      )}
      <div className="panel-body">
        <p className="muted" style={{ marginTop: 0 }}>
          {INTRO[data.role]}
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {data.role === "asker" && (
            <button className="btn btn-primary" onClick={() => setAsking(true)}>
              Ask Arms Control for help · Minta bantuan
            </button>
          )}
          <button
            className="btn"
            aria-expanded={guide}
            onClick={() => setGuide(!guide)}
          >
            {guide ? "Hide guide" : "What to say and show · Panduan"}
          </button>
          <div className="seg">
            <button aria-pressed={!all} onClick={() => setAll(false)}>
              Open{active.length ? ` (${active.length})` : ""}
            </button>
            <button aria-pressed={all} onClick={() => setAll(true)}>
              All
            </button>
          </div>
          {data.counts.late > 0 && (
            <Chip tone="crit">
              {data.counts.late} waiting past the time for a helper
            </Chip>
          )}
        </div>
        {guide && <GuideCard />}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sev</th>
              <th>Request</th>
              <th className="hide-sm">Helper</th>
              <th>Step</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Sev s={r.severity} />
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {POLICE_HELP_KIND_LABEL[r.help.kind].en} ·{" "}
                    {POLICE_HELP_REASON_LABEL[r.help.reason].en}
                  </div>
                  <div className="muted small">
                    <span className="mono">{r.ref}</span> · {r.companyName} ·{" "}
                    {r.help.policeUnit}
                    {r.help.expectedAt
                      ? ` · visit ${dateTimeLabel(r.help.expectedAt)}`
                      : ""}
                  </div>
                  <div className="small">{r.help.asked}</div>
                  <div className="muted small">
                    Asked by {r.askedBy}, {dateTimeLabel(r.openedAt)}. Call{" "}
                    {r.help.contactName} on {r.help.contactPhone}.
                  </div>
                  {r.help.outcome && (
                    <div className="small">
                      Outcome: {r.help.outcome.note}
                      {r.help.outcome.followUp
                        ? ` Follow-up: ${r.help.outcome.followUp}`
                        : ""}
                    </div>
                  )}
                  {r.help.returns.length > 0 && (
                    <div className="muted small">
                      Sent back {r.help.returns.length}×:{" "}
                      {r.help.returns.at(-1)!.note}
                    </div>
                  )}
                </td>
                <td className="hide-sm">
                  {r.help.helper ? (
                    <>
                      <div>{r.help.helper.name}</div>
                      <div className="muted small">
                        {r.help.helper.phone} ·{" "}
                        {r.help.helper.how === "ON_SITE"
                          ? "going there"
                          : "by phone"}
                        {r.help.helper.eta
                          ? `, by ${dateTimeLabel(r.help.helper.eta)}`
                          : ""}
                      </div>
                    </>
                  ) : (
                    <span className="muted small">
                      Helper by {dateTimeLabel(r.assignBy)}
                    </span>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    <Chip tone={STEP_TONE[r.help.step]}>
                      {POLICE_HELP_STEP_LABEL[r.help.step]}
                    </Chip>
                    {r.late && <Chip tone="crit">Late</Chip>}
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    {r.can.assign && (
                      <button
                        className="btn"
                        onClick={() => setOpen({ row: r, what: "assign" })}
                      >
                        {r.help.helper ? "Change helper" : "Assign helper"}
                      </button>
                    )}
                    {r.can.outcome && (
                      <button
                        className="btn"
                        onClick={() => setOpen({ row: r, what: "outcome" })}
                      >
                        Record help given
                      </button>
                    )}
                    {r.can.confirm && (
                      <button
                        className="btn btn-primary"
                        onClick={() => setOpen({ row: r, what: "answer" })}
                      >
                        Confirm or send back
                      </button>
                    )}
                    {r.can.withdraw && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => setOpen({ row: r, what: "withdraw" })}
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty">
            No police help requests{all ? "" : " open"}.
          </div>
        )}
      </div>
      <p className="muted small panel-body" style={{ margin: 0 }}>
        Rule {data.rule.id} ({data.rule.label}): a helper within{" "}
        {data.rule.value.visitNowMin} minutes for a visit now,{" "}
        {data.rule.value.phoneCallMin} minutes for a call,{" "}
        {data.rule.value.bookedHoursBefore} hours before a booked visit.
      </p>
      {asking && (
        <AskDrawer
          companies={data.companies}
          onClose={() => setAsking(false)}
        />
      )}
      {open?.what === "assign" && (
        <AssignDrawer
          row={open.row}
          helpers={data.helpers}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.what === "outcome" && (
        <OutcomeDrawer row={open.row} onClose={() => setOpen(null)} />
      )}
      {open?.what === "answer" && (
        <AnswerDrawer row={open.row} onClose={() => setOpen(null)} />
      )}
      {open?.what === "withdraw" && (
        <WithdrawDrawer row={open.row} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

/** Read-only guide: Malay first, English below. */
export function GuideCard() {
  const g = POLICE_HELP_GUIDE;
  return (
    <div
      className="panel panel-body"
      style={{ marginTop: 12 }}
      aria-label={g.title.en}
    >
      <h3 style={{ marginTop: 0 }}>
        {g.title.bm}
        <div className="muted small">{g.title.en}</div>
      </h3>
      {g.sections.map((s) => (
        <div key={s.id} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>
            {s.title.bm} <span className="muted small">· {s.title.en}</span>
          </div>
          <ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            {s.lines.map((l, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <div>{l.bm}</div>
                <div className="muted small">{l.en}</div>
              </li>
            ))}
          </ol>
        </div>
      ))}
      <p className="muted small">
        {g.note.bm}
        <br />
        {g.note.en}
      </p>
    </div>
  );
}

function AskDrawer({
  companies,
  onClose,
}: {
  companies: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { companyId, me } = useApp();
  const [form, setForm] = useState({
    companyId: companies.some((c) => c.id === companyId)
      ? companyId
      : (companies[0]?.id ?? ""),
    kind: "VISIT_NOW" as PoliceHelpKind,
    reason: "ARMOURY_CHECK" as PoliceHelpReason,
    expectedAt: "",
    policeUnit: "",
    officer: "",
    asked: "",
    contactName: me.user.name,
    contactPhone: "",
  });
  const act = useAction();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  const ready =
    form.companyId &&
    form.policeUnit.trim() &&
    form.asked.trim() &&
    form.contactName.trim() &&
    form.contactPhone.trim() &&
    (form.kind !== "VISIT_BOOKED" || form.expectedAt);
  return (
    <Drawer
      title="Ask Arms Control for help"
      sub="Minta bantuan Kawalan Senjata"
      onClose={onClose}
    >
      {companies.length > 1 && (
        <div className="field">
          <label className="label" htmlFor="ph-co">
            Company
          </label>
          <Select
            id="ph-co"
            className="select"
            value={form.companyId}
            onChange={set("companyId")}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="field">
        <span className="label">What is happening · Apa yang berlaku</span>
        <div className="seg" role="group">
          {(Object.keys(POLICE_HELP_KIND_LABEL) as PoliceHelpKind[]).map(
            (k) => (
              <button
                key={k}
                aria-pressed={form.kind === k}
                onClick={() => setForm({ ...form, kind: k })}
              >
                {POLICE_HELP_KIND_LABEL[k].en}
              </button>
            ),
          )}
        </div>
        <div className="muted small">
          {POLICE_HELP_KIND_LABEL[form.kind].bm}
        </div>
      </div>
      {form.kind === "VISIT_BOOKED" && (
        <div className="field">
          <label className="label" htmlFor="ph-when">
            When will they come · Bila polis datang
          </label>
          <input
            id="ph-when"
            type="datetime-local"
            className="input"
            value={form.expectedAt}
            onChange={set("expectedAt")}
          />
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="ph-reason">
          What the police want · Apa yang polis mahu
        </label>
        <Select
          id="ph-reason"
          className="select"
          value={form.reason}
          onChange={set("reason")}
        >
          {(Object.keys(POLICE_HELP_REASON_LABEL) as PoliceHelpReason[]).map(
            (k) => (
              <option key={k} value={k}>
                {POLICE_HELP_REASON_LABEL[k].en} ·{" "}
                {POLICE_HELP_REASON_LABEL[k].bm}
              </option>
            ),
          )}
        </Select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="ph-unit">
            Police station or unit · Balai / unit
          </label>
          <input
            id="ph-unit"
            className="input"
            maxLength={160}
            value={form.policeUnit}
            onChange={set("policeUnit")}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="ph-officer">
            Officer name and rank (if given)
          </label>
          <input
            id="ph-officer"
            className="input"
            maxLength={160}
            value={form.officer}
            onChange={set("officer")}
          />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="ph-asked">
          What did they say or ask for · Apa yang ditanya
        </label>
        <textarea
          id="ph-asked"
          className="textarea"
          maxLength={1000}
          value={form.asked}
          onChange={set("asked")}
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="ph-cname">
            Who Arms Control should call
          </label>
          <input
            id="ph-cname"
            className="input"
            maxLength={120}
            value={form.contactName}
            onChange={set("contactName")}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="ph-cphone">
            Work phone
          </label>
          <input
            id="ph-cphone"
            className="input"
            inputMode="tel"
            maxLength={24}
            value={form.contactPhone}
            onChange={set("contactPhone")}
          />
        </div>
      </div>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || !ready}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.askPoliceHelp({
                  companyId: form.companyId,
                  kind: form.kind,
                  reason: form.reason,
                  expectedAt:
                    form.kind === "VISIT_BOOKED"
                      ? fromLocal(form.expectedAt)
                      : null,
                  policeUnit: form.policeUnit,
                  officer: form.officer,
                  asked: form.asked,
                  contactName: form.contactName,
                  contactPhone: form.contactPhone,
                }),
              (c) =>
                `${c.ref}: Arms Control has been asked. Keep your phone near you.`,
            );
            if (r) onClose();
          }}
        >
          Send to Arms Control
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <GuideCard />
    </Drawer>
  );
}

function AssignDrawer({
  row,
  helpers,
  onClose,
}: {
  row: Row;
  helpers: PoliceHelpBoard["helpers"];
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: helpers[0]?.name ?? "",
    phone: "",
    how: (row.help.kind === "PHONE_CALL" ? "PHONE" : "ON_SITE") as
      | "PHONE"
      | "ON_SITE",
    eta: "",
    note: "",
  });
  const act = useAction();
  const changing = !!row.help.helper;
  return (
    <Drawer
      title={changing ? "Change helper" : "Assign helper"}
      sub={`${row.ref} · ${row.companyName}`}
      onClose={onClose}
    >
      <div className="field">
        <label className="label" htmlFor="pa-name">
          Helper
        </label>
        <input
          id="pa-name"
          className="input"
          list="pa-helpers"
          maxLength={120}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <datalist id="pa-helpers">
          {helpers.map((h) => (
            <option key={h.id} value={h.name}>
              {h.title}
            </option>
          ))}
        </datalist>
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="pa-phone">
            Helper's work phone
          </label>
          <input
            id="pa-phone"
            className="input"
            inputMode="tel"
            maxLength={24}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="field">
          <span className="label">How</span>
          <div className="seg" role="group">
            <button
              aria-pressed={form.how === "PHONE"}
              onClick={() => setForm({ ...form, how: "PHONE" })}
            >
              By phone
            </button>
            <button
              aria-pressed={form.how === "ON_SITE"}
              onClick={() => setForm({ ...form, how: "ON_SITE" })}
            >
              Going there
            </button>
          </div>
        </div>
      </div>
      {form.how === "ON_SITE" && (
        <div className="field">
          <label className="label" htmlFor="pa-eta">
            Arrives by
          </label>
          <input
            id="pa-eta"
            type="datetime-local"
            className="input"
            value={form.eta}
            onChange={(e) => setForm({ ...form, eta: e.target.value })}
          />
        </div>
      )}
      {changing && (
        <div className="field">
          <label className="label" htmlFor="pa-note">
            Why the helper is changing
          </label>
          <input
            id="pa-note"
            className="input"
            maxLength={500}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
      )}
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={
            act.busy ||
            !form.name.trim() ||
            !form.phone.trim() ||
            (changing && !form.note.trim())
          }
          onClick={async () => {
            const r = await act.run(
              () =>
                api.assignPoliceHelp(row.id, {
                  name: form.name,
                  phone: form.phone,
                  how: form.how,
                  eta: form.how === "ON_SITE" ? fromLocal(form.eta) : null,
                  note: form.note,
                }),
              `${row.ref}: helper named. Call ${row.help.contactName} on ${row.help.contactPhone}.`,
            );
            if (r) onClose();
          }}
        >
          Save helper
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}

function OutcomeDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <Drawer
      title="Record help given"
      sub={`${row.ref} · ${row.companyName}`}
      onClose={onClose}
    >
      <div className="field">
        <label className="label" htmlFor="po-note">
          What happened and what the police checked
        </label>
        <textarea
          id="po-note"
          className="textarea"
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="po-follow">
          Follow-up asked by the police (if any)
        </label>
        <input
          id="po-follow"
          className="input"
          maxLength={1000}
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
        />
      </div>
      <ProofPicker
        site={null}
        refText={row.ref}
        items={proof}
        onChange={setProof}
        documentsOnly
        required
      />
      <p className="muted small">
        Proof: the register book page the police signed, a police note or
        receipt, or a short written report.
      </p>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || !note.trim() || !proof.length}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.recordPoliceHelpOutcome(row.id, { note, followUp, proof }),
              `${row.ref}: recorded. The company will confirm.`,
            );
            if (r) onClose();
          }}
        >
          Save
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}

function AnswerDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const [note, setNote] = useState("");
  const act = useAction();
  const send = async (decision: "confirm" | "return") => {
    const r = await act.run(
      () => api.answerPoliceHelp(row.id, decision, note),
      decision === "confirm"
        ? `${row.ref}: confirmed. Thank you.`
        : `${row.ref}: sent back to Arms Control.`,
    );
    if (r) onClose();
  };
  return (
    <Drawer
      title="Did you get the help?"
      sub={`${row.ref} · Adakah anda menerima bantuan?`}
      onClose={onClose}
    >
      {row.help.outcome && (
        <p>
          {row.help.outcome.by}: {row.help.outcome.note}
          {row.help.outcome.followUp
            ? ` Follow-up: ${row.help.outcome.followUp}`
            : ""}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor="pn-note">
          Comment (for sending back: what is still needed)
        </label>
        <textarea
          id="pn-note"
          className="textarea"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || !note.trim()}
          onClick={() => send("confirm")}
        >
          Confirm help received
        </button>
        <button
          className="btn"
          disabled={act.busy || !note.trim()}
          onClick={() => send("return")}
        >
          Send back to Arms Control
        </button>
      </div>
    </Drawer>
  );
}

function WithdrawDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const [note, setNote] = useState("");
  const act = useAction();
  return (
    <Drawer title="Withdraw the request" sub={row.ref} onClose={onClose}>
      <div className="field">
        <label className="label" htmlFor="pw-note">
          Why help is no longer needed
        </label>
        <input
          id="pw-note"
          className="input"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || !note.trim()}
          onClick={async () => {
            const r = await act.run(
              () => api.withdrawPoliceHelp(row.id, note),
              `${row.ref}: withdrawn.`,
            );
            if (r) onClose();
          }}
        >
          Withdraw
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}
