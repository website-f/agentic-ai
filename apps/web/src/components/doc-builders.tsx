/**
 * P24: the AI turns a company's own how-to documents into draft SOPs and workflows.
 *
 * - <BuildFromDocs fileIds branchId />: "Make an SOP" / "Build a workflow" from picked files,
 *   with progress and a link to the draft.
 * - <IntakeSuggestions batchId suggestions onChange? />: what the AI suggests from an upload,
 *   each with Build / Dismiss.
 *
 * Everything built is a draft: an SOP reaches agents only after a person approves it on the
 * SOPs page; a workflow stays a draft until it is switched on in the editor.
 */
import { CheckCircleIcon, FileTextIcon, FlowArrowIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  buildSop, buildSuggestion, buildWorkflow, canBuild, dismissSuggestion, readJob, waitForJob,
  type BuildWhat, type Suggestion,
} from "@/lib/builders";
import { meQuery } from "@/lib/queries";
import { workKeys } from "@/lib/work";
import { workflowKeys } from "@/lib/workflows";

/** A link to a built draft: the SOP page or the workflow editor. */
function DraftLink({ what, id, children }: { what: BuildWhat; id: string; children: ReactNode }) {
  return what === "sop"
    ? <Link to="/sops" search={{ sop: id }} className="font-medium text-accent hover:underline">{children}</Link>
    : <Link to="/workflows" search={{ w: id }} className="font-medium text-accent hover:underline">{children}</Link>;
}

function useRefreshDrafts() {
  const qc = useQueryClient();
  return (what: BuildWhat) => qc.invalidateQueries({ queryKey: what === "sop" ? workKeys.sops : workflowKeys.all });
}

// ---------------------------------------------------------------- build from picked files

type BuildState =
  | { what: BuildWhat; phase: "working"; detail: string | null; long: boolean }
  | { what: BuildWhat; phase: "done"; id: string }
  | { what: BuildWhat; phase: "failed"; error: string };

export function BuildFromDocs({ fileIds, branchId }: { fileIds: string[]; branchId: string }) {
  const t = useT();
  const refresh = useRefreshDrafts();
  const { data: me } = useQuery(meQuery);
  const perms = me?.permissions ?? [];
  const [state, setState] = useState<BuildState | null>(null);
  const [focus, setFocus] = useState("");
  const working = state?.phase === "working";

  const run = async (what: BuildWhat) => {
    setState({ what, phase: "working", detail: null, long: false });
    try {
      const r = what === "sop" ? await buildSop(fileIds, { branchId, focus }) : await buildWorkflow(fileIds, { branchId, focus });
      let id = r.id;
      if (r.job) {
        setState({ what, phase: "working", detail: r.job.detail, long: true });
        const job = await waitForJob(r.job.id, (j) => setState({ what, phase: "working", detail: j.detail, long: true }));
        if (job.status !== "done" || !job.built_id) throw new Error(job.error ?? tr("The build failed. Try again."));
        id = job.built_id;
      }
      refresh(what);
      setState({ what, phase: "done", id: id! });
      toast.success(what === "sop" ? tr("SOP draft ready. Check it, then approve it.") : tr("Workflow draft ready. Check the steps, then switch it on."));
    } catch (e) {
      setState({ what, phase: "failed", error: errorMessage(e) });
    }
  };

  const mayS = canBuild(perms, "sop");
  const mayW = canBuild(perms, "workflow");
  if (!mayS && !mayW) return null;
  const none = !fileIds.length;
  return (
    <div className="grid min-w-0 gap-2">
      <Input value={focus} onChange={(e) => setFocus(e.target.value)} disabled={working} maxLength={300}
        placeholder={t("Only this part (optional), e.g. Salary advance")} aria-label={t("Only this part (optional)")}
        className="h-8 max-w-96 text-[13px]" />
      <div className="flex flex-wrap items-center gap-2">
        {mayS ? (
          <Button size="sm" variant="outline" disabled={none || working} loading={working && state.what === "sop"} onClick={() => run("sop")}>
            <FileTextIcon size={15} /> {t("Make an SOP")}
          </Button>
        ) : null}
        {mayW ? (
          <Button size="sm" variant="outline" disabled={none || working} loading={working && state.what === "workflow"} onClick={() => run("workflow")}>
            <FlowArrowIcon size={15} /> {t("Build a workflow")}
          </Button>
        ) : null}
      </div>
      {state?.phase === "working" ? (
        <p role="status" className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <SparkleIcon size={14} className="shrink-0 text-accent" />
          <span className="min-w-0">
            {state.detail || (state.what === "sop" ? t("Reading the documents and writing the SOP…") : t("Reading the documents and drafting the workflow…"))}
            {state.long ? <> {t("Long documents take a few minutes; you can leave this page.")}</> : null}
          </span>
        </p>
      ) : state?.phase === "done" ? (
        <p role="status" className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <CheckCircleIcon size={14} weight="fill" className="shrink-0 text-ok" />
          <span>{state.what === "sop" ? t("SOP draft ready.") : t("Workflow draft ready.")}</span>
          <DraftLink what={state.what} id={state.id}>{state.what === "sop" ? t("Review and approve it") : t("Open it in the editor")}</DraftLink>
        </p>
      ) : state?.phase === "failed" ? (
        <p role="alert" className="text-[12.5px] text-danger">{state.error}</p>
      ) : (
        <p className="text-[12px] text-muted">
          {none ? t("Pick the documents that describe one procedure.") : t("The AI drafts it from these documents. Agents use it only after a person approves it.")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- suggestions from an upload

function SuggestionRow({ batchId, s, onSaved }: { batchId: string; s: Suggestion; onSaved: (s: Suggestion) => void }) {
  const t = useT();
  const refresh = useRefreshDrafts();
  const { data: me } = useQuery(meQuery);
  const may = canBuild(me?.permissions ?? [], s.what);
  const [jobId, setJobId] = useState<string | null>(null);
  const activeJob = s.status === "new" ? (jobId ?? s.job_id ?? null) : null;
  const job = useQuery({
    queryKey: ["builders", "job", activeJob],
    queryFn: async () => {
      const j = await readJob(activeJob!);
      if (j.status === "done" && j.built_id) {
        refresh(s.what);
        onSaved({ ...s, status: "built", built_id: j.built_id, job_id: null });
      }
      return j;
    },
    enabled: !!activeJob,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2500 : false),
  });
  const build = useMutation({
    mutationFn: () => buildSuggestion(batchId, s.id),
    onSuccess: (r) => {
      if (r.job && r.job.status === "running") setJobId(r.job.id);
      else refresh(s.what);
      onSaved(r.suggestion);
      if (r.job?.status === "failed") toast.error(r.job.error ?? tr("The build failed. Try again."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dismiss = useMutation({
    mutationFn: () => dismissSuggestion(batchId, s.id),
    onSuccess: (r) => onSaved(r.suggestion),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const building = build.isPending || (!!activeJob && job.data?.status !== "failed" && job.data?.status !== "done");
  const failed = job.data?.status === "failed" ? job.data.error ?? t("The build failed. Try again.") : null;
  const pill = s.status === "built"
    ? <Pill tone="ok">{t("Draft ready")}</Pill>
    : building ? <Pill tone="info">{t("Building")}</Pill>
    : s.status === "dismissed" ? <Pill>{t("Dismissed")}</Pill>
    : <Pill tone="accent">{t("Suggested")}</Pill>;
  const docs = s.file_ids.length === 1 ? t("1 document") : t("{n} documents", { n: s.file_ids.length });

  return (
    <ListRow
      leading={<IconTile icon={s.what === "sop" ? FileTextIcon : FlowArrowIcon} tone={s.what === "sop" ? "violet" : "accent"} size="sm" />}
      title={<span className={s.status === "dismissed" ? "text-muted" : undefined}>{s.title}</span>}
      meta={<Meta items={[s.what === "sop" ? t("SOP") : t("Workflow"), docs, ...(s.section ? [<span key="sec" className="break-words">{t("Section: {name}", { name: s.section })}</span>] : []), pill]} />}
      trailing={
        s.status === "built" && s.built_id ? (
          <Button size="sm" variant="ghost" asChild>
            {s.what === "sop"
              ? <Link to="/sops" search={{ sop: s.built_id }}>{t("Open draft")}</Link>
              : <Link to="/workflows" search={{ w: s.built_id }}>{t("Open draft")}</Link>}
          </Button>
        ) : building ? (
          <span role="status" className="text-[12.5px] text-muted">{job.data?.detail || t("Reading the documents…")}</span>
        ) : may ? (
          <>
            <Button size="sm" variant={s.status === "dismissed" ? "outline" : "primary"} onClick={() => build.mutate()}>
              <SparkleIcon size={14} /> {s.status === "dismissed" ? t("Build anyway") : failed ? t("Try again") : t("Build")}
            </Button>
            {s.status === "new" ? (
              <Button size="sm" variant="ghost" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>{t("Dismiss")}</Button>
            ) : null}
          </>
        ) : null
      }
    >
      {s.reason ? <span className="text-[12.5px] break-words text-muted">{s.reason}</span> : null}
      {failed ? <span role="alert" className="text-[12.5px] text-danger">{failed}</span> : null}
    </ListRow>
  );
}

export function IntakeSuggestions({ batchId, suggestions, onChange }: {
  batchId: string;
  suggestions: Suggestion[];
  onChange?: (next: Suggestion[]) => void;
}) {
  const t = useT();
  const [saved, setSaved] = useState<Record<string, Suggestion>>({});
  const items = suggestions.map((s) => saved[s.id] ?? s);
  const save = (s: Suggestion) => {
    setSaved((o) => ({ ...o, [s.id]: s }));
    onChange?.(items.map((x) => (x.id === s.id ? s : x)));
  };
  if (!items.length) {
    return <p className="text-[13px] text-muted">{t("No SOP or workflow suggestions from these documents.")}</p>;
  }
  return (
    <div className="grid min-w-0 gap-2">
      <ListCard>
        {items.map((s) => <SuggestionRow key={s.id} batchId={batchId} s={s} onSaved={save} />)}
      </ListCard>
      <p className="text-[12px] text-muted">{t("Built SOPs and workflows are drafts: agents use them only after a person approves them.")}</p>
    </div>
  );
}
