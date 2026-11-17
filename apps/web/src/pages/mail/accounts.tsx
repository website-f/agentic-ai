/** P109 Connections → other email accounts: a person connects their other mailboxes (Gmail,
 * Yahoo, Outlook.com, a cPanel mailbox, any IMAP), backs up every attachment into their own
 * Files ("My workspace/Email backup/<account>/<month>"), then is told they can stop using it
 * and move to their Microsoft mailbox, with "Disconnect" (the stored password is deleted).
 * Only their own accounts; the password is never shown again. Gmail through Google sign-in
 * when the office set Google sign-in up; otherwise Gmail connects over IMAP with an app
 * password. "Ask AI" understands e.g. "back up all attachments from my Gmail". */
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  EnvelopeSimpleIcon,
  FolderOpenIcon,
  GoogleLogoIcon,
  PencilSimpleIcon,
  PlugsIcon,
  PlusIcon,
  SparkleIcon,
  StopCircleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  addMailAccount,
  askAccounts,
  backupActive,
  backupPercent,
  cancelBackup,
  changeMailAccount,
  fileSize,
  m365Keys,
  mailAccountsQuery,
  PROVIDERS,
  removeMailAccount,
  resumeBackup,
  startBackup,
  startGmailBackup,
  testMailAccount,
  type BackupJob,
  type MailAccount,
  type MailAccounts,
  type Provider,
} from "@/lib/m365";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<Provider, string> = {
  gmail: "Gmail",
  yahoo: "Yahoo Mail",
  outlook: "Outlook.com / Hotmail",
  cpanel: msg("cPanel / company hosting"),
  other: msg("Other (IMAP)"),
};

const PROVIDER_NOTE: Record<Provider, string> = {
  gmail: msg("Gmail needs 2-Step Verification on, then an app password (Google Account > Security > App passwords). Use that 16-letter app password here, not your normal password."),
  yahoo: msg("Yahoo needs an app password (Account security > Generate app password). Use it here, not your normal password."),
  outlook: msg("For a personal Outlook.com or Hotmail address. Microsoft may refuse password sign-in for these accounts; if the test fails, move the mail with Outlook itself."),
  cpanel: msg("Usually mail.yourdomain.com, port 993, with your full email address as the user name and the mailbox password. Your hosting's Email Accounts > Connect Devices page shows the exact server."),
  other: msg("Your provider's IMAP server, port 993 (SSL) or 143 (STARTTLS), and the password or app password it gives for mail apps."),
};

export function OtherEmailAccounts() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({
    ...mailAccountsQuery,
    // While a backup runs, its progress refreshes every few seconds (the live event also does).
    refetchInterval: (query) => {
      const d = query.state.data as MailAccounts | undefined;
      return d && ([...d.accounts.map((a) => a.backup), d.google.backup].some(backupActive)) ? 4000 : false;
    },
  });
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => askAccounts(question.trim()),
    onSuccess: (r) => {
      setAnswer(r.answer);
      if (r.job) { toast.success(t("Backup started: {account}", { account: r.job.label })); setQuestion(""); }
      void qc.invalidateQueries({ queryKey: m365Keys.accounts });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Skeleton className="h-48 rounded-[var(--radius-md)]" />;
  if (q.error || !q.data) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(q.error)}</p>;
  const { accounts, google } = q.data;
  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-muted">
        {t("Still using another email (Gmail, Yahoo, your hosting's mailbox)? Connect it here, copy every attachment into your Files, then move to your Microsoft mailbox. Only you can see these accounts.")}
      </p>

      <form className="grid gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/30 p-3" onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3) ask.mutate(); }}>
        <label className="grid gap-1.5">
          <span className="flex items-center gap-1.5 text-[13px] font-medium"><SparkleIcon size={15} className="text-accent" /> {t("Ask AI")}</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} placeholder={t("e.g. Back up all attachments from my Gmail")} className="min-w-0 flex-1" />
            <Button type="submit" variant="secondary" disabled={question.trim().length < 3} loading={ask.isPending}>{t("Ask")}</Button>
          </div>
        </label>
        {answer ? <p className="text-[13px]">{answer}</p> : null}
      </form>

      <GoogleRow google={google} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{t("Other email accounts")}</h3>
        <Button size="sm" onClick={() => setAdding(true)}><PlusIcon size={15} weight="bold" /> {t("Add another email account")}</Button>
      </div>
      {!accounts.length ? (
        <EmptyState icon={EnvelopeSimpleIcon} title={t("No other email accounts")}
          body={t("Add Gmail, Yahoo, Outlook.com or your company hosting's mailbox. You need its app password (or mailbox password).")}
          action={<Button onClick={() => setAdding(true)}><PlusIcon size={15} weight="bold" /> {t("Add another email account")}</Button>} />
      ) : (
        <ul className="grid gap-3">{accounts.map((a) => <AccountCard key={a.id} a={a} />)}</ul>
      )}
      {adding ? <AccountDialog presets={q.data.presets} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function GoogleRow({ google }: { google: MailAccounts["google"] }) {
  const t = useT();
  const qc = useQueryClient();
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/api/integrations/google/connect", "POST"),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const backup = useMutation({
    mutationFn: startGmailBackup,
    onSuccess: () => { toast.success(t("Backup started.")); void qc.invalidateQueries({ queryKey: m365Keys.accounts }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!google.configured) {
    return <p className="rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">{t("Google sign-in is not set up for this office, so Gmail is connected with an app password below (IMAP).")}</p>;
  }
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        <IconTile icon={GoogleLogoIcon} size="sm" tone="info" />
        <div className="grid min-w-0 flex-1">
          <span className="text-[13.5px] font-medium">{t("Gmail with Google sign-in")}</span>
          <span className="truncate text-[12px] text-muted">{google.account ? t("Connected as {email}", { email: google.account.email }) : t("No app password needed.")}</span>
        </div>
        {google.account ? (
          <Button size="sm" variant="outline" disabled={backupActive(google.backup)} loading={backup.isPending} onClick={() => backup.mutate()}>
            <CloudArrowUpIcon size={15} /> {t("Back up attachments")}
          </Button>
        ) : google.can_connect ? (
          <Button size="sm" variant="outline" loading={connect.isPending} onClick={() => connect.mutate()}><GoogleLogoIcon size={15} /> {t("Connect Gmail")}</Button>
        ) : null}
      </div>
      {google.backup ? <BackupStatus job={google.backup} /> : null}
    </div>
  );
}

const STATUS: Record<MailAccount["status"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  ok: { label: msg("Working"), tone: "ok" },
  error: { label: msg("Needs attention"), tone: "warn" },
  untested: { label: msg("Not tested"), tone: "neutral" },
};

function AccountCard({ a }: { a: MailAccount }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: m365Keys.accounts });
  const test = useMutation({
    mutationFn: () => testMailAccount(a.id),
    onSuccess: (r) => { refresh(); if (r.status === "ok") toast.success(t("Signed in fine.")); else toast.error(r.last_error ?? t("Could not sign in.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const backup = useMutation({
    mutationFn: () => startBackup(a.id),
    onSuccess: () => { toast.success(t("Backup started.")); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => removeMailAccount(a.id),
    onSuccess: () => { toast.success(t("{email} disconnected. Its password is deleted.", { email: a.email })); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const st = STATUS[a.status];
  const running = backupActive(a.backup);
  return (
    <li className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <IconTile icon={EnvelopeSimpleIcon} size="sm" tone={a.status === "error" ? "warn" : "info"} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[14px] font-medium break-all">{a.email}</span>
          <span className="text-[12px] text-muted">{t(PROVIDER_LABEL[a.provider])} · {a.host}:{a.port}</span>
        </div>
        <Pill tone={st.tone}>{t(st.label)}</Pill>
      </div>
      {a.status === "error" && a.last_error ? <p className="text-[12.5px] break-words text-danger">{a.last_error}</p> : null}
      {a.backup_done_at ? (
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-ok/30 bg-ok/8 p-3">
          <p className="flex items-start gap-2 text-[13px]"><CheckCircleIcon size={17} weight="fill" className="mt-0.5 shrink-0 text-ok" />
            <span>{t("All attachments from {account} are saved in your Files. You can now stop using {account} and use your Microsoft mailbox.", { account: a.email })}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => setRemoving(true)}><PlugsIcon size={15} /> {t("Disconnect this account")}</Button>
            <Button size="sm" variant="outline" asChild><Link to="/files"><FolderOpenIcon size={15} /> {t("Open my Files")}</Link></Button>
          </div>
        </div>
      ) : null}
      {a.backup && !(a.backup.status === "done" && a.backup_done_at) ? <BackupStatus job={a.backup} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={a.status !== "ok" || running} loading={backup.isPending} onClick={() => backup.mutate()}>
          <CloudArrowUpIcon size={15} /> {a.backup_done_at ? t("Back up again") : t("Back up attachments to my Files")}
        </Button>
        <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}><ArrowClockwiseIcon size={15} /> {t("Test")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><PencilSimpleIcon size={15} /> {t("Change")}</Button>
        {!a.backup_done_at ? <Button size="sm" variant="ghost" className="hover:text-danger" onClick={() => setRemoving(true)}><TrashIcon size={15} /> {t("Disconnect")}</Button> : null}
      </div>
      {editing ? <AccountDialog account={a} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} danger title={t("Disconnect {email}?", { email: a.email })} confirmLabel={t("Disconnect")}
        body={t("The office deletes its stored password and stops reading it. Attachments already saved stay in your Files. Your mailbox itself is not changed.")}
        onConfirm={async () => { await remove.mutateAsync(); }} />
    </li>
  );
}

function BackupStatus({ job }: { job: BackupJob }) {
  const t = useT();
  const qc = useQueryClient();
  const pct = backupPercent(job);
  const active = backupActive(job);
  const refresh = () => void qc.invalidateQueries({ queryKey: m365Keys.accounts });
  const resume = useMutation({ mutationFn: () => resumeBackup(job.id), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => cancelBackup(job.id), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const counts = [
    job.messages_total ? t("{seen} of {total} emails checked", { seen: job.messages_seen, total: job.messages_total }) : t("{seen} emails checked", { seen: job.messages_seen }),
    t("{n} files saved ({size})", { n: job.saved, size: fileSize(job.bytes_saved) }),
    job.duplicates ? t("{n} already saved", { n: job.duplicates }) : null,
    job.too_large ? t("{n} too large", { n: job.too_large }) : null,
    job.inline_skipped ? t("{n} pictures in the text skipped", { n: job.inline_skipped }) : null,
  ].filter(Boolean);
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {job.status === "failed" ? <WarningCircleIcon size={15} className="text-danger" /> : job.status === "done" ? <CheckCircleIcon size={15} className="text-ok" /> : <CloudArrowUpIcon size={15} className="text-accent" />}
        <b className="font-medium">
          {job.status === "done" ? t("Backup finished") : job.status === "failed" ? t("Backup stopped") : job.status === "cancelled" ? t("Backup cancelled") : job.stale ? t("Backup paused") : job.status === "queued" ? t("Backup starting…") : t("Backing up…")}
        </b>
        {job.finished_at ? <span className="text-muted">{new Date(job.finished_at).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
      </div>
      {active || job.stale ? (
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label={t("Backup progress")}>
          <div className={cn("h-full rounded-full bg-accent transition-[width] duration-500", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${Math.max(3, pct)}%` } : undefined} />
        </div>
      ) : null}
      <p className="text-[12px] text-muted">{counts.join(" · ")}</p>
      {job.error ? <p className="text-[12.5px] break-words text-danger">{job.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {job.status === "failed" || job.stale ? <Button size="sm" variant="outline" loading={resume.isPending} onClick={() => resume.mutate()}><ArrowClockwiseIcon size={14} /> {t("Resume")}</Button> : null}
        {active ? <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}><StopCircleIcon size={14} /> {t("Stop")}</Button> : null}
      </div>
    </div>
  );
}

function AccountDialog({ account, presets, onClose }: { account?: MailAccount; presets?: MailAccounts["presets"]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [provider, setProvider] = useState<Provider>(account?.provider ?? "gmail");
  const [email, setEmail] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState(account?.host ?? presets?.gmail.host ?? "");
  const [port, setPort] = useState(String(account?.port ?? 993));
  const [security, setSecurity] = useState<"ssl" | "starttls">(account?.security ?? "ssl");
  const [username, setUsername] = useState(account?.username ?? "");
  const [advanced, setAdvanced] = useState(!!account || provider === "cpanel" || provider === "other");
  const pick = (p: Provider) => {
    setProvider(p);
    const pre = presets?.[p];
    setHost(pre?.host ?? "");
    setPort(String(pre?.port ?? 993));
    setSecurity(pre?.security ?? "ssl");
    if (p === "cpanel" || p === "other") setAdvanced(true);
  };
  const emailOk = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(email.trim());
  const ok = account ? true : emailOk && password.length > 0 && host.trim().length > 3;
  const save = useMutation({
    mutationFn: () => {
      const server = { host: host.trim(), port: Number(port) || 993, security, username: username.trim() };
      if (account) return changeMailAccount(account.id, { ...server, ...(password ? { password } : {}) });
      return addMailAccount({ email: email.trim(), provider, password, ...server });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: m365Keys.accounts });
      if (r.status === "ok") toast.success(t("Connected and signed in fine."));
      else toast.error(r.last_error ?? t("Saved, but the office could not sign in yet."));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={account ? t("Change {email}", { email: account.email }) : t("Add another email account")}
      description={t("The password is kept encrypted, used only to copy your attachments, and deleted when you disconnect.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>{account ? t("Save and test") : t("Connect and test")}</Button>
      </>}>
      <div className="grid gap-3">
        {!account ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Provider")}</span>
            <Select value={provider} onValueChange={(v) => pick(v as Provider)} label={t("Provider")} options={PROVIDERS.map((p) => ({ value: p, label: t(PROVIDER_LABEL[p]) }))} />
          </div>
        ) : null}
        <p className="rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">{t(PROVIDER_NOTE[provider])}</p>
        {!account ? <Field label={t("Email address")} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={email && !emailOk ? t("Check the email address.") : undefined} /> : null}
        <Field label={account ? t("New password (leave empty to keep it)") : provider === "gmail" || provider === "yahoo" ? t("App password") : t("Password")} type="password" autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {!advanced ? (
          <button type="button" className="hit justify-self-start text-[12.5px] font-medium text-accent hover:underline" onClick={() => setAdvanced(true)}>{t("Server settings")}</button>
        ) : (
          <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
            <Field label={t("IMAP server")} value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.yourdomain.com" />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Port")} inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))} />
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium">{t("Security")}</span>
                <Select value={security} onValueChange={(v) => { setSecurity(v as "ssl" | "starttls"); setPort(v === "ssl" ? "993" : "143"); }} label={t("Security")}
                  options={[{ value: "ssl", label: "SSL/TLS (993)" }, { value: "starttls", label: "STARTTLS (143)" }]} />
              </div>
            </div>
            <Field label={t("User name (usually the email address)")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}
