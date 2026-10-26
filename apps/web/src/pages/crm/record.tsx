/** P50 one CRM record in a side sheet (a bottom sheet on a phone): every field to read or
 * change, who changed what, and for the office's own data a link to where it lives. Also
 * the "New" form (no id). */
import { ArrowSquareOutIcon, ClockCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { FormError } from "@/components/ui/field";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import { addRecord, crmKeys, deleteRecord, getRecord, updateRecord, type CrmField, type CrmObject } from "@/lib/crm-hub";
import { timeAgo } from "@/lib/utils";

import { FieldInput, FieldValue } from "./field-input";

export function RecordSheet({ obj, fields, recordId, onClose }: {
  obj: CrmObject;
  fields: CrmField[];
  /** null: a new record */
  recordId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isNew = recordId === null;
  const rec = useQuery({ queryKey: crmKeys.record(obj.key, recordId ?? "new"), queryFn: () => getRecord(obj.key, recordId!), enabled: !isNew });
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [removing, setRemoving] = useState(false);
  const data = { ...(rec.data?.row.data ?? {}), ...draft };
  const refs = rec.data?.refs ?? {};
  const editable = (f: CrmField) => obj.can_edit !== false && !f.builtin && f.type !== "auto" && (obj.kind !== "builtin" || !f.builtin);
  // A built-in object: its own fields are read only; the extra fields people added can change.
  const canChange = fields.some((f) => !f.builtin && f.type !== "auto") && (obj.can_edit || obj.kind === "builtin");
  const changed = Object.keys(draft).length > 0;

  const done = () => {
    void qc.invalidateQueries({ queryKey: crmKeys.rows(obj.key) });
    void qc.invalidateQueries({ queryKey: crmKeys.overview });
    void qc.invalidateQueries({ queryKey: crmKeys.dashboard });
  };
  const save = useMutation({
    mutationFn: () => (isNew ? addRecord(obj.key, draft) : updateRecord(obj.key, recordId!, draft)),
    onSuccess: () => {
      toast.success(isNew ? t("Added.") : t("Saved."));
      done();
      if (isNew) onClose();
      else {
        setDraft({});
        void qc.invalidateQueries({ queryKey: crmKeys.record(obj.key, recordId!) });
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteRecord(obj.key, recordId!),
    onSuccess: () => { toast.success(t("Removed.")); done(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const problems = save.error instanceof ApiError ? save.error.fields : {};
  const title = isNew ? t("New {thing}", { thing: obj.singular || obj.name }) : rec.data?.row.title ?? t("Loading…");

  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md" title={title}
      description={obj.name}
      actions={
        <>
          {canChange || isNew ? (
            <Button loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>{isNew ? t("Add") : t("Save")}</Button>
          ) : null}
          {rec.data?.row.link ? (
            <Button variant="outline" onClick={() => void navigate({ href: rec.data!.row.link! })}><ArrowSquareOutIcon size={15} /> {t("Open where it lives")}</Button>
          ) : null}
          {!isNew && obj.kind !== "builtin" && obj.can_edit ? (
            <Button variant="ghost" onClick={() => setRemoving(true)} aria-label={t("Remove")}><TrashIcon size={15} /></Button>
          ) : null}
        </>
      }>
      {!isNew && rec.isLoading ? <div className="grid gap-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        : !isNew && rec.error ? <p role="alert" className="text-danger">{errorMessage(rec.error)}</p> : (
          <div className="grid gap-5">
            <FormError message={save.error && !Object.keys(problems).length ? errorMessage(save.error) : null} />
            {obj.kind === "builtin" && !isNew ? (
              <p className="rounded-sm bg-surface-2/70 px-3 py-2 text-[12.5px] text-muted">
                {t("This comes from the office's own data: change it where it lives. Fields you added in the CRM can be changed here.")}
              </p>
            ) : null}
            <dl className="grid gap-4">
              {fields.filter((f) => !f.hidden || !isNew).map((f) => {
                const can = isNew ? !f.builtin && f.type !== "auto" : editable(f) && (obj.can_edit || obj.kind === "builtin");
                return (
                  <div key={f.key} className="grid gap-1.5">
                    <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
                      <label htmlFor={`crm-${f.key}`}>{f.label}</label>
                      {f.required && can ? <span className="text-danger">*</span> : null}
                    </dt>
                    <dd className="min-w-0 text-[14px]">
                      {can ? (
                        <FieldInput field={f} value={data[f.key]} refs={refs} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                      ) : (
                        <FieldValue field={f} value={data[f.key]} refs={refs} />
                      )}
                      {problems[f.key] ? <p className="mt-1 text-[12.5px] text-danger">{problems[f.key]}</p> : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {rec.data?.history.length ? (
              <section className="grid gap-2 border-t border-border pt-4">
                <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><ClockCounterClockwiseIcon size={15} /> {t("History")}</h3>
                <ul className="grid gap-1.5 text-[12.5px] text-muted">
                  {rec.data.history.map((h, i) => (
                    <li key={i}>
                      <span className="font-medium text-fg">{h.who}</span>{" "}
                      {h.action === "crm.record_added" ? t("added it") : h.action === "crm.record_removed" ? t("removed it")
                        : t("changed {fields}", { fields: h.changed.map((k) => fields.find((f) => f.key === k)?.label ?? k).join(", ") || "-" })}
                      {" · "}{timeAgo(h.at)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} danger title={t("Remove this record?")} confirmLabel={t("Remove")}
        body={t("It is removed from the CRM for everyone. This cannot be undone.")} onConfirm={() => remove.mutate()} />
    </SideSheet>
  );
}
