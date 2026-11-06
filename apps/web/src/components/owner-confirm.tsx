/** P57: an owner confirms a big step with their password (and the authenticator code, when
 * they turned that on), plus the workspace's name typed out for the destructive ones. Used by
 * Data and privacy: export, erase, and (P81) start fresh for go-live. */
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";

export interface ConfirmValues {
  password: string;
  code: string;
  confirm_name: string;
}

export function ConfirmForm({
  open,
  onOpenChange,
  title,
  description,
  submit,
  danger,
  workspaceName,
  needsCode,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submit: string;
  danger?: boolean;
  workspaceName?: string;
  needsCode: boolean;
  onConfirm: (v: ConfirmValues) => Promise<unknown>;
  children?: ReactNode;
}) {
  const t = useT();
  const [v, setV] = useState<ConfirmValues>({ password: "", code: "", confirm_name: "" });
  const run = useMutation({ mutationFn: () => onConfirm(v), onSuccess: () => { setV({ password: "", code: "", confirm_name: "" }); onOpenChange(false); } });
  const nameOk = !workspaceName || v.confirm_name.trim() === workspaceName.trim();
  const ready = v.password.length > 0 && nameOk && (!needsCode || v.code.trim().length >= 6);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => { if (!o) run.reset(); onOpenChange(o); }}
      title={title}
      description={description}
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
        <Button variant={danger ? "danger" : "primary"} loading={run.isPending} disabled={!ready} onClick={() => run.mutate()}>{submit}</Button>
      </>}
    >
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) run.mutate(); }}>
        {children}
        {workspaceName ? (
          <Field label={t("Type {name} to confirm", { name: workspaceName })} value={v.confirm_name} autoComplete="off" spellCheck={false}
            onChange={(e) => setV({ ...v, confirm_name: e.target.value })} />
        ) : null}
        <Field label={t("Your password")} type="password" autoComplete="current-password" value={v.password}
          onChange={(e) => setV({ ...v, password: e.target.value })} />
        {needsCode ? (
          <Field label={t("Code from your authenticator app")} inputMode="numeric" autoComplete="one-time-code" value={v.code}
            onChange={(e) => setV({ ...v, code: e.target.value })} />
        ) : null}
        <FormError message={run.error ? errorMessage(run.error) : null} />
        <button type="submit" hidden />
      </form>
    </ResponsiveDialog>
  );
}
