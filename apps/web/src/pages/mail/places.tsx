/** P122 (Fitri, 21 Nov 2026: "on the Microsoft 365 page I don't see tabs for work email that I
 * can connect, for the shared mailbox ... users connect their private email, which is also
 * Outlook, and their work email uses the company domain; they must be separated"):
 * Work and Personal above the mail, each mailbox one click away.
 *
 * - Work: the person's main Microsoft account, extra Microsoft accounts on a company domain or
 *   in the company's tenant, every company shared mailbox they may use (the P34 rules, from the
 *   server), and other email accounts on a company domain.
 * - Personal: Outlook.com / Hotmail and other domains, Gmail and other email accounts.
 * The rule is in lib/mail-kind.ts and apps/api/agentic/microsoft/domains.py.
 *
 * P124: an extra work account someone below HOD adds waits for approval: it shows on the Work
 * tab as "Waiting for approval by <name>" with Cancel, and is never opened meanwhile. */
import {
  EnvelopeSimpleIcon,
  GoogleLogoIcon,
  HourglassMediumIcon,
  MicrosoftOutlookLogoIcon,
  PlusIcon,
  TrayIcon,
  UserIcon,
  UsersFourIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { m365Keys, type MailAccount, type MailAccounts } from "@/lib/m365";
import { kindOfEmail, type MailKind } from "@/lib/mail-kind";
import type { MicrosoftAccount, MyMailboxes, WorkMailApproval } from "@/lib/microsoft";
import { cancelRequest, requestKeys } from "@/lib/requests";
import { cn } from "@/lib/utils";

import { refreshMsAccounts, useMicrosoftAdd } from "./mailbox-pick";

const ConnectAccountDialog = lazy(() => import("./connect").then((m) => ({ default: m.ConnectAccountDialog })));

export interface Place {
  /** "main" | "ms:<id>" | "box:<id>" | "x:<id>" | "google" */
  key: string;
  kind: MailKind;
  type: "main" | "ms" | "shared" | "other";
  id: string | null;
  title: string;
  email: string;
  badge?: string | null;
  warn?: boolean;
  icon: Icon;
  /** P124: waits for approval (not opened until approved); who was asked. */
  pending?: WorkMailApproval | null;
}

/** P124: "Waiting for approval by Mia" (or by the office's managers when nobody is above). */
export function waitingText(t: T, approval: WorkMailApproval | null | undefined): string {
  return approval?.approver_name
    ? t("Waiting for approval by {name}", { name: approval.approver_name })
    : t("Waiting for approval by your managers");
}

type T = (text: string, vars?: Record<string, string | number>) => string;

export function buildPlaces(t: T, mm: MyMailboxes | undefined, main: MicrosoftAccount | undefined, others: MailAccounts | undefined): Place[] {
  const out: Place[] = [];
  const domains = mm?.company_domains ?? [];
  const mainRow = mm?.accounts.find((a) => a.primary);
  out.push({
    key: "main", kind: "work", type: "main", id: null, icon: MicrosoftOutlookLogoIcon,
    title: t("My Outlook"),
    email: main?.email ?? mainRow?.email ?? "",
    badge: mainRow?.pending ? waitingText(t, mainRow.approval) : !main?.connected ? t("Not connected") : main.status === "reconnect_needed" ? t("Needs attention") : null,
    warn: !!main?.connected && main.status === "reconnect_needed",
  });
  for (const a of mm?.accounts ?? []) {
    if (a.pending) {
      out.push({
        key: `ms:${a.id}`, kind: "work", type: "ms", id: a.id, icon: HourglassMediumIcon,
        title: a.primary ? t("My Outlook") : a.label || t("Work"), email: a.email, badge: waitingText(t, a.approval), pending: a.approval ?? { request_id: "", approver_name: null },
      });
      continue;
    }
    if (a.primary || !a.connected) continue;
    const kind = a.kind ?? "personal";
    out.push({
      key: `ms:${a.id}`, kind, type: "ms", id: a.id, icon: a.shared_with > 0 ? UsersFourIcon : kind === "work" ? MicrosoftOutlookLogoIcon : UserIcon,
      title: a.label || (kind === "work" ? t("Work") : t("Personal")),
      email: a.email,
      badge: a.status === "reconnect_needed" ? t("Needs attention") : a.shared_with > 0 ? t("Shared with {n}", { n: a.shared_with }) : null,
      warn: a.status === "reconnect_needed",
    });
  }
  for (const b of mm?.shared ?? []) {
    out.push({
      key: `box:${b.id}`, kind: "work", type: "shared", id: b.id, icon: UsersFourIcon,
      title: b.display_name || b.address, email: b.address,
      badge: b.status === "error" ? t("Needs attention") : b.status === "paused" ? t("Paused") : t("Shared mailbox"),
      warn: b.status === "error",
    });
  }
  if (others?.google.account) {
    out.push({
      key: "google", kind: kindOfEmail(others.google.account.email, domains), type: "other", id: "google", icon: GoogleLogoIcon,
      title: "Gmail", email: others.google.account.email,
    });
  }
  for (const a of others?.accounts ?? []) {
    if (a.status === "pending") {
      out.push({
        key: `x:${a.id}`, kind: "work", type: "other", id: a.id, icon: HourglassMediumIcon,
        title: a.email.split("@")[1] ?? a.email, email: a.email, badge: waitingText(t, a.approval), pending: a.approval ?? { request_id: "", approver_name: null },
      });
      continue;
    }
    out.push({
      key: `x:${a.id}`, kind: kindOfEmail(a.email, domains), type: "other", id: a.id, icon: EnvelopeSimpleIcon,
      title: a.email.split("@")[1] ?? a.email, email: a.email,
      badge: a.status === "error" ? t("Needs attention") : null, warn: a.status === "error",
    });
  }
  return out;
}

export function MailPlaces({ places, selected, tab, onTab, onPick, mm, google, onAdded }: {
  places: Place[];
  selected: string;
  tab: MailKind;
  onTab: (tab: MailKind) => void;
  onPick: (p: Place) => void;
  mm: MyMailboxes | undefined;
  google: MailAccounts["google"] | undefined;
  onAdded: (a: MailAccount) => void;
}) {
  const t = useT();
  const hasMain = !!mm?.accounts.some((a) => a.primary && a.connected);
  const microsoft = useMicrosoftAdd(hasMain);
  const [connecting, setConnecting] = useState(false);
  const work = places.filter((p) => p.kind === "work");
  const personal = places.filter((p) => p.kind === "personal");
  const shown = tab === "work" ? work : personal;
  const noShared = tab === "work" && !places.some((p) => p.type === "shared");
  return (
    <div className="grid gap-2.5" data-guide="mail.places">
      <Segmented<MailKind> label={t("Work or personal email")} value={tab} onChange={onTab} className="w-full sm:w-fit [&>button]:flex-1"
        options={[{ value: "work", label: t("Work"), count: work.length }, { value: "personal", label: t("Personal"), count: personal.length }]} />
      <div role="group" aria-label={tab === "work" ? t("Work mailboxes") : t("Personal mailboxes")}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {shown.map((p) => {
          if (p.pending) return <PendingPlace key={p.key} p={p} />;
          const on = p.key === selected;
          return (
            <button key={p.key} type="button" aria-pressed={on} onClick={() => onPick(p)} title={p.email}
              className={cn("flex max-w-[17rem] min-w-[10rem] shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none",
                on ? "border-accent/60 bg-accent-soft/50" : "border-border bg-surface hover:border-accent/40")}>
              <p.icon size={18} weight={on ? "fill" : "regular"} className={cn("shrink-0", p.warn ? "text-warn" : "text-accent")} />
              <span className="grid min-w-0">
                <span className="truncate text-[13px] font-medium">{p.title}</span>
                <span className="truncate text-[11.5px] text-muted">{p.email || p.badge}</span>
                {p.badge && p.email ? <span className={cn("truncate text-[11px]", p.warn ? "text-warn" : "text-muted")}>{p.badge}</span> : null}
              </span>
            </button>
          );
        })}
        {tab === "work" ? (
          <button type="button" onClick={() => microsoft.mutate()} disabled={microsoft.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-border px-3 py-2 text-[12.5px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-60">
            <PlusIcon size={15} weight="bold" /> {t("Add a work Microsoft account")}
          </button>
        ) : shown.length ? (
          <button type="button" onClick={() => setConnecting(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-border px-3 py-2 text-[12.5px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-accent">
            <PlusIcon size={15} weight="bold" /> {t("Connect another account")}
          </button>
        ) : null}
      </div>
      {tab === "work" && shown.some((p) => p.pending) ? (
        <p className="flex items-start gap-2 text-[12.5px] text-muted">
          <HourglassMediumIcon size={15} className="mt-0.5 shrink-0" />
          {t("Work email accounts you add wait for approval by the person above you, so nobody reads a company's mail without it. You can open one once it is approved.")}
        </p>
      ) : null}
      {noShared ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <UsersFourIcon size={15} className="shrink-0" />
          {mm?.can_manage
            ? t("No shared work mailbox yet. You add them (accounts@, tender@) on Channels > Microsoft 365.")
            : t("No shared work mailbox for you yet. An admin adds them (accounts@, tender@) on Channels > Microsoft 365 and chooses who sees each one.")}
          {mm?.can_manage ? <Link to="/channels" className="font-medium text-accent hover:underline">{t("Open Channels")}</Link> : null}
        </p>
      ) : null}
      {tab === "personal" && !personal.length ? (
        <EmptyState icon={TrayIcon} title={t("No personal email connected")}
          body={t("Connect your own Outlook.com, Gmail, Yahoo or any other email. It stays apart from your work mail, and only you see it.")}
          action={<Button onClick={() => setConnecting(true)}><PlusIcon size={15} weight="bold" /> {t("Connect another account")}</Button>} />
      ) : null}
      {connecting ? (
        <Suspense fallback={null}>
          <ConnectAccountDialog google={google} personalMsOk={!!mm?.personal_ms_ok} hasMain={hasMain} onClose={() => setConnecting(false)} onAdded={onAdded} />
        </Suspense>
      ) : null}
    </div>
  );
}

/** P124: a waiting work account: not opened, with who decides and a way to take it back. */
function PendingPlace({ p }: { p: Place }) {
  const t = useT();
  const qc = useQueryClient();
  const requestId = p.pending?.request_id ?? "";
  const cancel = useMutation({
    mutationFn: () => cancelRequest(requestId),
    onSuccess: () => {
      toast.success(t("Cancelled. {email} was removed.", { email: p.email }));
      refreshMsAccounts(qc);
      void qc.invalidateQueries({ queryKey: m365Keys.accounts });
      void qc.invalidateQueries({ queryKey: requestKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div role="status" title={p.email}
      className="flex max-w-[19rem] min-w-[12rem] shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-dashed border-warn/50 bg-warn/6 px-3 py-2">
      <p.icon size={18} className="shrink-0 text-warn" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[13px] font-medium">{p.email}</span>
        <span className="truncate text-[11.5px] text-warn">{p.badge}</span>
      </span>
      {requestId ? (
        <Button size="sm" variant="ghost" className="shrink-0" loading={cancel.isPending} onClick={() => cancel.mutate()}
          aria-label={t("Cancel the request for {email}", { email: p.email })}>
          {t("Cancel")}
        </Button>
      ) : null}
    </div>
  );
}
