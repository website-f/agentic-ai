/** P55: bring in a skill published in the open Agent Skills format (a SKILL.md, e.g. from a
 *  public skills collection on GitHub). It always arrives as a proposal: someone reviews it
 *  (and the safety scan has read it) before any agent uses it. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { skillKeys } from "@/lib/skills";

type From = "link" | "text";

export function ImportSkillDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [from, setFrom] = useState<From>("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const go = useMutation({
    mutationFn: () => api<{ proposal: { name: string } }>("/api/skills/import", "POST", from === "link" ? { url: url.trim() } : { text }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success(tr("Imported {name}. It waits for review under Proposals.", { name: r.proposal.name }));
      onDone();
    },
  });
  const ready = from === "link" ? url.trim().startsWith("https://") : text.trim().length > 40;
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !go.isPending && onClose()}
      title={t("Import a skill")}
      description={t("A skill someone published in the open Agent Skills format (a SKILL.md). It is checked for safety and waits for your review before any agent uses it.")}
      className="sm:max-w-xl"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={go.isPending}>{t("Cancel")}</Button>
        <Button loading={go.isPending} disabled={!ready} onClick={() => go.mutate()}>{t("Import")}</Button>
      </>}>
      <form className="grid grid-cols-[minmax(0,1fr)] gap-4" onSubmit={(e) => { e.preventDefault(); if (ready && !go.isPending) go.mutate(); }}>
        <Segmented<From> label={t("From")} value={from} onChange={(v) => { setFrom(v); go.reset(); }}
          options={[{ value: "link", label: t("Link") }, { value: "text", label: t("Paste text") }]}
          className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center" />
        {from === "link" ? (
          <Field label={t("Link to the SKILL.md")} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus
            placeholder="https://github.com/…/SKILL.md"
            hint={t("A GitHub page of the skill or its folder works; only the SKILL.md is brought in, not scripts.")} />
        ) : (
          <TextareaField label="SKILL.md" value={text} onChange={(e) => setText(e.target.value)} rows={10} autoFocus
            placeholder={"---\nname: …\ndescription: …\n---\n…"} hint={t("Starts with a name and a description between --- lines.")} />
        )}
        <FormError message={go.error ? errorMessage(go.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}
