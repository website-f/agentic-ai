/** Emails and Teams messages the AI drafted, and calendar changes it proposed, waiting for the
 * person (the same cards as My assistants). P102: Teams messages too, on both tabs.
 * P122: its own file, loaded after the page has drawn (the cards come from the My assistants
 * page, which the Microsoft 365 page no longer downloads up front). */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Section } from "@/components/page";
import { useT } from "@/i18n";
import { calendarDraftsQuery, draftsQuery } from "@/lib/assistants";
import { providerOf } from "@/lib/microsoft";
import { CalendarDraftCard, DraftCard } from "@/pages/assistants";

export function WaitingDrafts({ assist }: { assist: boolean }) {
  const t = useT();
  const drafts = useQuery({ ...draftsQuery("pending"), retry: false });
  const events = useQuery({ ...calendarDraftsQuery("pending"), retry: false });
  const mail = (drafts.data ?? []).filter((d) => providerOf(d) !== "google");
  const cal = (events.data ?? []).filter((d) => providerOf(d) === "microsoft");
  if (!mail.length && !cal.length) return null;
  // Grouped by mailbox: a person's own Outlook, and each shared mailbox they approve for.
  const labels = [...new Set([...mail, ...cal].map((d) => d.mailbox_label ?? ""))];
  return (
    <Section guide="mail.drafts" title={<span id="mail-drafts" className="scroll-mt-20">{t("Waiting for your approval")}</span>}
      description={t("Emails, Teams messages and calendar changes your AI prepared. Read each one, change it if you like, then press Send or Confirm. Nothing is sent or booked until you do.")}
      actions={assist ? <Link to="/assistants" search={{ tab: "drafts" }} className="text-[13px] text-accent hover:underline">{t("All drafts")} →</Link> : null}>
      <div className="grid gap-4">
        {labels.map((label) => (
          <div key={label || "-"} className="grid gap-3">
            {labels.length > 1 && label ? <p className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{label}</p> : null}
            {mail.filter((d) => (d.mailbox_label ?? "") === label).map((d) => <DraftCard key={d.id} d={d} />)}
            {cal.filter((d) => (d.mailbox_label ?? "") === label).map((d) => <CalendarDraftCard key={d.id} d={d} />)}
          </div>
        ))}
      </div>
    </Section>
  );
}
