/** P92 Settings > Account: the owner changes their own sign-in email (api/routers/account.py).
 * Their current password proves it is them (or a Microsoft sign-in in the last ten minutes).
 * Their other devices are signed out and their Microsoft link starts again from the new email. */
import { ArrowRightIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Me } from "@/lib/types";

export function AccountEmailRow({ email }: { email: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60 sm:px-5"
      >
        <IconTile icon={EnvelopeSimpleIcon} tone="info" size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">
            {t("Change your sign-in email")}
          </span>
          <span className="block text-[12.5px] break-all text-muted">
            {email}
          </span>
        </span>
        <ArrowRightIcon
          size={15}
          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
        />
      </button>
      {open ? (
        <AccountEmailDialog email={email} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export function AccountEmailDialog({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [next, setNext] = useState(email);
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api<Me>("/api/account/email", "PUT", {
        email: next.trim(),
        current_password: password || null,
      }),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      toast.success(
        t("Your sign-in email is now {email}.", { email: me.user.email }),
      );
      onClose();
    },
  });
  const same = next.trim().toLowerCase() === email.toLowerCase();
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("Change your sign-in email")}
      description={t(
        "You will sign in with the new email from now on. Your other devices are signed out, and your next Microsoft sign-in links the Microsoft account of the new email.",
      )}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={same || !next.includes("@")}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t("Save")}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!same) save.mutate();
        }}
      >
        <Field
          label={t("New email")}
          type="email"
          autoComplete="email"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Field
          label={t("Current password")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={t(
            "Signed in with Microsoft in the last ten minutes? You can leave this empty.",
          )}
        />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}
