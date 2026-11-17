/** P109 the email composer: a new email, Reply, Reply all or Forward, written by the person or
 * drafted with AI ("Draft with AI" fills the text; it is never sent by itself). Send sends it
 * now from the person's own Outlook; "Save draft" keeps it in Outlook's Drafts. */
import { FloppyDiskIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, TextareaField } from "@/components/ui/field";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { allEmails, m365Keys, sendMail, splitAddresses, type ComposeMode, type MailFull, type Tone } from "@/lib/m365";

import { DraftWithAi, useAskAi } from "./ai";

export interface ComposeStart {
  mode: ComposeMode;
  original?: MailFull | null;
  to?: string;
  subject?: string;
  body?: string;
}

export function Composer({ start, onDone, onCancel }: { start: ComposeStart; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { mode, original } = start;
  const replying = mode === "reply" || mode === "reply_all";
  const [to, setTo] = useState(start.to ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(start.subject ?? "");
  const [body, setBody] = useState(start.body ?? "");
  const toList = splitAddresses(to);
  const ccList = splitAddresses(cc);
  const ready = replying ? body.trim().length > 0 : allEmails(toList) && (!ccList.length || allEmails(ccList)) && (mode === "forward" || subject.trim().length > 0);

  const draft = useAskAi((r) => {
    if (r.subject && !subject.trim()) setSubject(r.subject);
    if (r.body) setBody(r.body);
  });
  const askDraft = ({ tone, instructions }: { tone: "" | Tone; instructions: string }) => {
    if (mode === "new" || mode === "forward") {
      if (!instructions.trim()) { toast.error(t("Say what the email should say, then press Draft with AI.")); return; }
      draft.mutate({ action: "mail_new", instructions: mode === "forward" ? t("A short note forwarding this email: {what}", { what: instructions }) : instructions, tone, to });
      return;
    }
    draft.mutate({ action: "mail_reply", message_id: original?.id, tone, instructions });
  };

  const send = useMutation({
    mutationFn: (now: boolean) => sendMail({ mode, messageId: original?.id, to: toList, cc: ccList, subject: subject.trim(), body, send: now }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: m365Keys.all });
      toast.success(r.sent ? t("Sent.") : t("Saved in your Outlook Drafts."));
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ready) send.mutate(true); }}>
      {replying ? (
        <p className="text-[12.5px] text-muted">
          {mode === "reply_all" ? t("Reply to everyone on: {subject}", { subject: original?.subject || t("(no subject)") }) : t("Reply to {name}: {subject}", { name: original?.from.name || original?.from.address || "", subject: original?.subject || t("(no subject)") })}
        </p>
      ) : (
        <>
          <Field label={t("To")} type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)}
            placeholder="ali@company.com, siti@company.com" error={to.trim() && !allEmails(toList) ? t("Check the email addresses.") : undefined} />
          {mode === "new" ? (
            <>
              <Field label={t("Cc (optional)")} type="text" inputMode="email" autoComplete="off" value={cc} onChange={(e) => setCc(e.target.value)} />
              <Field label={t("Subject")} value={subject} maxLength={400} onChange={(e) => setSubject(e.target.value)} />
            </>
          ) : null}
        </>
      )}
      <DraftWithAi busy={draft.isPending} onDraft={askDraft}
        placeholder={replying ? t("What should the reply say? (optional)") : t("What should the email say?")} />
      <TextareaField label={t("Message")} rows={10} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50_000}
        hint={mode === "forward" ? t("The forwarded email and its attachments go below your note.") : replying ? t("The earlier email is quoted below your reply.") : undefined} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>{t("Discard")}</Button>
        <Button type="button" variant="outline" disabled={!ready || send.isPending} loading={send.isPending && send.variables === false} onClick={() => send.mutate(false)}>
          <FloppyDiskIcon size={15} /> {t("Save draft")}
        </Button>
        <Button type="submit" disabled={!ready || send.isPending} loading={send.isPending && send.variables === true}>
          <PaperPlaneTiltIcon size={15} /> {t("Send")}
        </Button>
      </div>
    </form>
  );
}
