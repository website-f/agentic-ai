import { BellRingingIcon, ChatCircleTextIcon, DeviceMobileIcon, EnvelopeSimpleIcon, PaperPlaneTiltIcon, TelegramLogoIcon, WhatsappLogoIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { ThisDevice } from "@/pages/channels";

/** P114 (Fitri, 18 Nov 2026): how the office tells this person, and about what. Every role has
 * it, from staff to the owner (api/routers/my_notifications.py). */
type Channel = "app" | "email" | "telegram" | "whatsapp";
type Event = "approvals" | "my_ai" | "done" | "limit" | "other";

interface NotifySettings {
  channels: Record<Channel, boolean>;
  events: Record<Event, boolean>;
  email_other: boolean;
  email: string;
  email_ready: boolean;
  devices: number;
  telegram: number;
  whatsapp: number;
}

const KEY = ["me", "notifications"] as const;

const EVENTS: { id: Event; label: string; hint: string }[] = [
  { id: "my_ai", label: msg("My AI needs me"), hint: msg("Your AI asks for a decision or has a question, or a task of yours failed.") },
  { id: "limit", label: msg("My AI allowance"), hint: msg("Today's allowance is used up and your work is paused, or a manager gave you more.") },
  { id: "done", label: msg("My tasks are done"), hint: msg("A task your AI did for you is finished or waits for your check.") },
  { id: "approvals", label: msg("Decisions waiting for me"), hint: msg("Approvals you may give, for your own AI or the people you look after, and people who ran out of allowance.") },
  { id: "other", label: msg("Everything else"), hint: msg("Tasks given to you, mentions, files for your company, schedules and reminders.") },
];

export function NotificationsPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: () => api<NotifySettings>("/api/me/notifications") });
  const save = useMutation({
    mutationFn: (patch: Partial<Pick<NotifySettings, "channels" | "events" | "email_other">>) => api<NotifySettings>("/api/me/notifications", "PUT", patch),
    onSuccess: (d) => { qc.setQueryData(KEY, d); toast.success(t("Saved.")); },
  });
  const test = useMutation({
    mutationFn: () => api<{ queued: number }>("/api/me/notifications/test", "POST", {}),
    onSuccess: (r) => r.queued
      ? toast.success(t("Sent a test to {n} places. It arrives in a minute.", { n: r.queued }))
      : toast.warning(t("Nothing to send to: turn on a way to reach you first.")),
  });
  const setChannel = (c: Channel, on: boolean) => data && save.mutate({ channels: { ...data.channels, [c]: on } });
  const setEvent = (e: Event, on: boolean) => data && save.mutate({ events: { ...data.events, [e]: on } });

  return (
    <Page className="max-w-3xl">
      <PageHeader title={t("My notifications")}
        description={t("How the office tells you when your AI needs you, runs out of allowance or finishes, and when something waits for your decision. The bell at the top always lists what waits.")}
        actions={<Button variant="outline" loading={test.isPending} disabled={!data} onClick={() => test.mutate()}><PaperPlaneTiltIcon size={16} /> {t("Send me a test")}</Button>} />
      {isLoading ? <Skeleton className="h-72" /> : error || !data ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : (
        <>
          <Card>
            <CardHeader title={t("Where you hear it")} icon={<IconTile icon={BellRingingIcon} size="sm" />}
              description={t("Turn a way off and nothing is sent there. Approvals by phone or Telegram can be decided right from the message.")} />
            <CardBody className="grid gap-5">
              <Row icon={EnvelopeSimpleIcon} title={t("Email")}
                status={data.email_ready ? <Pill tone="ok">{data.email}</Pill> : <Pill tone="neutral">{data.email ? t("The office's email is not set up yet") : t("No email address")}</Pill>}>
                <SwitchField checked={data.channels.email} disabled={save.isPending} onCheckedChange={(v) => setChannel("email", v)}
                  label={t("Email me")} hint={t("Your AI's questions, decisions, allowance and finished tasks.")} />
                {data.channels.email ? (
                  <SwitchField checked={data.email_other} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ email_other: v })}
                    label={t("Also email everything else")} hint={t("Off: small notices come only to your phone, Telegram or WhatsApp.")} />
                ) : null}
              </Row>
              <Row icon={DeviceMobileIcon} title={t("This app on your phone or computer")}
                status={<Pill tone={data.devices ? "ok" : "neutral"}>{t("{n} devices", { n: data.devices })}</Pill>}>
                <SwitchField checked={data.channels.app} disabled={save.isPending} onCheckedChange={(v) => setChannel("app", v)}
                  label={t("Notify my devices")} hint={t("Pop-up notifications on each phone or browser where you turned them on.")} />
                <ThisDevice />
              </Row>
              <Row icon={TelegramLogoIcon} title="Telegram"
                status={<Pill tone={data.telegram ? "ok" : "neutral"}>{data.telegram ? t("Linked") : t("Not linked")}</Pill>}>
                <SwitchField checked={data.channels.telegram} disabled={save.isPending} onCheckedChange={(v) => setChannel("telegram", v)}
                  label={t("Notify me on Telegram")} hint={t("Approve or deny with the buttons in the message.")} />
                {!data.telegram ? <LinkHint /> : null}
              </Row>
              <Row icon={WhatsappLogoIcon} title="WhatsApp"
                status={<Pill tone={data.whatsapp ? "ok" : "neutral"}>{data.whatsapp ? t("Linked") : t("Not linked")}</Pill>}>
                <SwitchField checked={data.channels.whatsapp} disabled={save.isPending} onCheckedChange={(v) => setChannel("whatsapp", v)}
                  label={t("Notify me on WhatsApp")} hint={t("A message with a link to approve or answer.")} />
                {!data.whatsapp ? <LinkHint /> : null}
              </Row>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("What you hear about")} icon={<IconTile icon={ChatCircleTextIcon} size="sm" tone="info" />}
              description={t("Applies to every way above. Turn off what you would rather check in the app.")} />
            <CardBody className="grid gap-4">
              {EVENTS.map((e) => (
                <SwitchField key={e.id} checked={data.events[e.id]} disabled={save.isPending} onCheckedChange={(v) => setEvent(e.id, v)}
                  label={t(e.label)} hint={t(e.hint)} />
              ))}
            </CardBody>
          </Card>
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </>
      )}
    </Page>
  );
}

function Row({ icon: Icon, title, status, children }: { icon: typeof BellRingingIcon; title: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-border/70 pb-5 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Icon size={18} className="shrink-0 text-muted" />
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <span className="ml-auto max-w-full min-w-0 truncate">{status}</span>
      </div>
      {children}
    </section>
  );
}

function LinkHint() {
  const t = useT();
  return (
    <p className="text-[12.5px] text-muted">
      {t("Link your number on the Channels page: it gives you a code to send to the office's bot or WhatsApp number.")}{" "}
      <Link to="/channels" className="font-medium text-accent hover:underline">{t("Open Channels")}</Link>
    </p>
  );
}
