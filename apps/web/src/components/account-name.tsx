/** P141 Settings > Account: anyone changes their own name, as everyone in the office sees it
 * (PUT /api/account/name). People added from the email they asked for a sign-in password with
 * start with a name made from that email, and correct it here. */
import { ArrowRightIcon, UserIcon } from "@phosphor-icons/react";
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

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

export function AccountNameRow({ name }: { name: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60 sm:px-5"
      >
        <IconTile icon={UserIcon} tone="accent" size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">{t("Your name")}</span>
          <span className="block text-[12.5px] break-words text-muted">{name}</span>
        </span>
        <ArrowRightIcon
          size={15}
          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
        />
      </button>
      {open ? <AccountNameDialog name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AccountNameDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [next, setNext] = useState(name);
  const save = useMutation({
    mutationFn: () => api<Me>("/api/account/name", "PUT", { name: tidy(next) }),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      toast.success(t("Saved. Everyone in the office now sees {name}.", { name: me.user.name }));
      onClose();
    },
  });
  const clean = tidy(next);
  const ok = clean.length >= 2 && clean.length <= 120 && clean !== name;
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("Your name")}
      description={t("The name everyone in the office sees for you. Your sign-in email stays the same.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) save.mutate();
        }}
      >
        <Field
          label={t("Your name")}
          autoComplete="name"
          maxLength={120}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint={t("2 to 120 characters, as you want colleagues to see it.")}
        />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}
