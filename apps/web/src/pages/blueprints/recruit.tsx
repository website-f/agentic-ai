/** P41: ask the Recruiter to research a job and draft the blueprint for an agent that does it. */
import { UserCirclePlusIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";

export function RecruitButton() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const go = useMutation({
    mutationFn: () => api<{ task_id: string }>("/api/blueprints/recruit", "POST", { role, notes }),
    onSuccess: (r) => {
      setOpen(false);
      toast.success(t("The Recruiter is researching the job. The blueprint appears here when it is done."));
      navigate({ to: "/tasks", search: { task: r.task_id } });
    },
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><UserCirclePlusIcon size={16} /> {t("Recruit with AI")}</Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title={t("Recruit with AI")}
        description={t("The Recruiter researches the job on the web and in your Library (duties, steps, laws, common mistakes) and drafts a blueprint: instructions, tools, starter skills and SOP drafts. You review it before any agent uses it.")}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
          <Button disabled={role.trim().length < 3} loading={go.isPending} onClick={() => go.mutate()}>{t("Start research")}</Button>
        </>}>
        <div className="grid gap-3">
          <Field label={t("The job")} autoFocus value={role} onChange={(e) => setRole(e.target.value)}
            placeholder={t("e.g. Purchasing officer for a construction company")} />
          <div className="grid gap-1.5">
            <label htmlFor="recruit-notes" className="text-[13px] font-medium">{t("What should it know? (optional)")}</label>
            <textarea id="recruit-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={t("e.g. We buy cement and steel weekly from three suppliers; orders above RM 5,000 need the director.")}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
          </div>
          <FormError message={go.error ? errorMessage(go.error) : null} />
        </div>
      </ResponsiveDialog>
    </>
  );
}
