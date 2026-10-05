import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { locale, t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { filesQuery } from "@/lib/documents";
import { learnFromSource, learningKeys, type LearnSourceIn } from "@/lib/learning";
import { keys } from "@/lib/queries";
import { skillKeys } from "@/lib/skills";
import { agentsQuery } from "@/lib/work";

type SourceTab = "link" | "file" | "text";
const NO_AGENT = "__any__";

/** Draft a skill from a web page, an uploaded file or pasted notes. Tests run in the
 *  background afterwards, and the autopilot may switch it on. Mount it fresh (with a key)
 *  each time it opens so the form starts empty. */
export function LearnSourceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState<SourceTab>("link");
  const [url, setUrl] = useState("");
  const [fileId, setFileId] = useState("");
  const [text, setText] = useState("");
  const [focus, setFocus] = useState("");
  const [agentId, setAgentId] = useState(NO_AGENT);
  const { data: files = [], isLoading: filesLoading } = useQuery({ ...filesQuery(), enabled: open && tab === "file" });
  const { data: agents = [] } = useQuery({ ...agentsQuery, enabled: open });
  const ready = files.filter((f) => f.status === "ready");
  const pickable = agents.filter((a) => a.status !== "retired" && !a.view_only);

  const learn = useMutation({
    mutationFn: () => {
      const body: LearnSourceIn = { focus: focus.trim() };
      if (tab === "link") body.url = url.trim();
      else if (tab === "file") body.file_id = fileId;
      else body.text = text;
      if (agentId !== NO_AGENT) body.agent_id = agentId;
      return learnFromSource(body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: learningKeys.all });
      qc.invalidateQueries({ queryKey: skillKeys.all });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(tr("Drafted {name}. It is being tested now.", { name: r.name }));
      onOpenChange(false);
    },
  });

  const source = tab === "link" ? url.trim().length > 3 : tab === "file" ? !!fileId : text.trim().length >= 40;
  const canSubmit = source && focus.trim().length >= 3;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !learn.isPending && onOpenChange(o)}
      title={t("Teach from a source")}
      description={t("Point at a page, a file or your own notes. An agent writes it up as a skill, tests it, and it goes live or waits for review depending on the autopilot.")}
      className="sm:max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={learn.isPending}>{t("Cancel")}</Button>
          <Button loading={learn.isPending} disabled={!canSubmit} onClick={() => learn.mutate()}>{t("Draft the skill")}</Button>
        </>
      }
    >
      <form
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !learn.isPending) learn.mutate();
        }}
      >
        <Segmented<SourceTab>
          label={t("Source")}
          value={tab}
          onChange={(v) => { setTab(v); learn.reset(); }}
          options={[
            { value: "link", label: t("Link") },
            { value: "file", label: t("File") },
            { value: "text", label: t("Paste text") },
          ]}
          className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center"
        />

        <div role="tabpanel" aria-label={t("Source")} className="grid gap-1.5">
          {tab === "link" ? (
            <Field label={t("Web page")} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/how-to"
              hint={t("A public page: a guide, a policy, a supplier's instructions.")} autoFocus />
          ) : tab === "file" ? (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("File")}</span>
              {filesLoading ? (
                <p className="text-[13px] text-muted">{t("Loading files…")}</p>
              ) : ready.length ? (
                <Select label={t("File")} value={fileId} onValueChange={setFileId} placeholder={t("Choose a file")} className="w-full min-w-0 [&>span:first-child]:truncate"
                  options={ready.map((f) => ({ value: f.id, label: f.title || f.name, hint: f.branch_name ?? undefined }))} />
              ) : (
                <p className="rounded-sm bg-surface-2/70 px-3 py-2 text-[13px] text-muted">
                  {t("No files ready yet. Upload one in")} <Link to="/files" className="text-accent hover:underline">{t("Files")}</Link> {t("first; it is read once and can then be taught from.")}
                </p>
              )}
              {ready.length ? <p className="text-[12.5px] text-muted">{t("From Files: a procedure, a manual or a checklist works best.")}</p> : null}
            </div>
          ) : (
            <TextareaField label={t("Notes")} value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus
              placeholder={t("Paste the steps, an email thread or your own write-up.")}
              hint={text.trim().length < 40 ? t("At least a few sentences.") : t("{n} characters", { n: text.trim().length.toLocaleString(locale()) })} />
          )}
        </div>

        <Field label={t("What should it learn?")} value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={300}
          placeholder={t("e.g. how we register a new supplier")} hint={t("The skill covers this, not everything in the source.")} />

        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Agent")} <span className="font-normal text-muted">{t("(optional)")}</span></span>
          <Select label={t("Agent")} value={agentId} onValueChange={setAgentId} className="w-full min-w-0"
            options={[{ value: NO_AGENT, label: t("Every agent") }, ...pickable.map((a) => ({ value: a.id, label: a.name, hint: a.role }))]} />
          <p className="text-[12.5px] text-muted">{t("Name an agent when the skill is only for its kind of work.")}</p>
        </div>

        <FormError message={learn.error ? errorMessage(learn.error) : null} />
        {/* Enter in a field submits; the visible button lives in the dialog footer. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </ResponsiveDialog>
  );
}

