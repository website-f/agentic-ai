/** P92: correct a member's name or sign-in email (a typo in the form or an import), and let go
 * of a wrong Microsoft link (api/routers/members.py change_identity, reset-microsoft). */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Member } from "@/lib/types";

export function MemberIdentityDialog({
  member,
  open,
  onOpenChange,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const emailChanged =
    email.trim().toLowerCase() !== member.email.toLowerCase();
  const nameChanged = name.trim().replace(/\s+/g, " ") !== member.name;
  const save = useMutation({
    mutationFn: () =>
      api<Member>(`/api/members/${member.user_id}`, "PATCH", {
        ...(nameChanged ? { name: name.trim() } : {}),
        ...(emailChanged ? { email: email.trim() } : {}),
      }),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: keys.members });
      toast.success(
        emailChanged
          ? t("Saved. {name} signs in again with {email}.", {
              name: m.name,
              email: m.email,
            })
          : t("Saved."),
      );
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Change name or email")}
      description={t(
        "Correct a name or email typed wrong when they were added.",
      )}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={
              (!nameChanged && !emailChanged) ||
              !name.trim() ||
              !email.includes("@")
            }
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
          if (nameChanged || emailChanged) save.mutate();
        }}
      >
        <Field
          label={t("Name")}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={t("Email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {emailChanged ? (
          <p
            className="rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px]"
            data-testid="email-note"
          >
            {t(
              "They will need to sign in again. With Microsoft, they will be linked to the account of the new email, here and in Prima.",
            )}
          </p>
        ) : null}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

export function ResetMicrosoftDialog({
  member,
  open,
  onOpenChange,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Reset {name}'s Microsoft link?", { name: member.name })}
      body={t(
        "Use this when the wrong Microsoft account got linked. They are signed out, their Outlook connection stops, and their next Microsoft sign-in with {email} links again, here and in Prima.",
        { email: member.email },
      )}
      confirmLabel={t("Reset Microsoft link")}
      danger
      onConfirm={async () => {
        try {
          await api(`/api/members/${member.user_id}/reset-microsoft`, "POST");
          void qc.invalidateQueries({ queryKey: keys.members });
          toast.success(
            t("{name} links again at their next Microsoft sign-in.", {
              name: member.name,
            }),
          );
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }}
    />
  );
}
