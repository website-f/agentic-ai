/** P122 "Connect another account" (Fitri, 21 Nov 2026: "for others I don't want 'set up a
 * server' or anything, because end users will use it by simply clicking a button. Google is
 * easy; now do the others one-click or close to it").
 *
 * - Microsoft (work or personal, as many as needed): one button, Microsoft's own sign-in page.
 * - Google: one button, Google's own sign-in page (when the office set Google sign-in up).
 * - Anything else: the person types only their address; the server finds its mail server
 *   (POST /api/mail-accounts/discover) and asks only for the password the provider wants, with
 *   a direct "Create an app password" link where one is needed. A Google Workspace or Microsoft
 *   365 address goes to those buttons instead. Server fields only under a folded "Advanced",
 *   open by itself when nothing was found. */
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  GoogleLogoIcon,
  InfoIcon,
  MicrosoftOutlookLogoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { addMailAccount, discoverMail, m365Keys, type Discovered, type MailAccount, type MailAccounts } from "@/lib/m365";
import { isConsumerDomain } from "@/lib/mail-kind";
import { cn } from "@/lib/utils";

import { useMicrosoftAdd } from "./mailbox-pick";

const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

export function useGoogleConnect() {
  return useMutation({
    mutationFn: () => api<{ url: string }>("/api/integrations/google/connect", "POST"),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function ConnectAccountDialog({ google, personalMsOk, hasMain = true, onClose, onAdded }: {
  google: MailAccounts["google"] | undefined;
  /** Outlook.com / Hotmail can sign in with the office's Microsoft app. */
  personalMsOk: boolean;
  /** The main Microsoft account is connected (else the Microsoft button connects it). */
  hasMain?: boolean;
  onClose: () => void;
  onAdded?: (a: MailAccount) => void;
}) {
  const t = useT();
  const microsoft = useMicrosoftAdd(hasMain);
  const googleGo = useGoogleConnect();
  const googleReady = !!google?.configured && !!google.can_connect && !google.account;
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Connect another account")}
      description={t("Microsoft and Google open their own sign-in page, so no password is kept here. For any other email, type the address: the office finds its server.")}
      footer={<Button variant="ghost" onClick={onClose}>{t("Close")}</Button>}>
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <BigChoice icon={MicrosoftOutlookLogoIcon} title={t("Microsoft account")} body={t("Work or personal Outlook. Add as many as you use.")}
            loading={microsoft.isPending} onClick={() => microsoft.mutate()} />
          <BigChoice icon={GoogleLogoIcon} title={t("Google account")}
            body={google?.account ? t("Connected as {email}", { email: google.account.email })
              : googleReady ? t("Gmail or Google Workspace, with Google's sign-in.")
              : t("Google sign-in is not set up here: type the Gmail address below instead.")}
            disabled={!googleReady} loading={googleGo.isPending} onClick={() => googleGo.mutate()} />
        </div>
        {!personalMsOk ? (
          <p className="flex items-start gap-2 text-[12.5px] text-muted">
            <InfoIcon size={15} className="mt-0.5 shrink-0" />
            {t("Personal Outlook.com and Hotmail accounts can sign in here only after an admin lets the office's Microsoft app accept personal accounts (Channels > Microsoft 365).")}
          </p>
        ) : null}
        <div className="flex items-center gap-3 text-[12px] font-medium text-muted uppercase"><span className="h-px flex-1 bg-border" />{t("Other email")}<span className="h-px flex-1 bg-border" /></div>
        <p className="text-[12.5px] text-muted">{t("Yahoo, iCloud and AOL have no sign-in button for other apps, so they need an app password: a code you make once on their website.")}</p>
        <OtherEmail google={google} googleReady={googleReady} personalMsOk={personalMsOk} hasMain={hasMain} onAdded={(a) => { onAdded?.(a); onClose(); }} />
      </div>
    </ResponsiveDialog>
  );
}

function BigChoice({ icon: IconCmp, title, body, onClick, loading, disabled }: {
  icon: typeof GoogleLogoIcon;
  title: string;
  body: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cn("flex min-h-16 items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left transition-colors",
        "hover:border-accent/50 hover:bg-accent-soft/30 focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60")}>
      <IconCmp size={22} className={cn("mt-0.5 shrink-0 text-accent", loading && "animate-pulse")} />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[13.5px] font-medium">{title}</span>
        <span className="text-[12px] text-muted">{body}</span>
      </span>
    </button>
  );
}

/** Type the address; the server finds the rest. */
function OtherEmail({ google, googleReady, personalMsOk, hasMain, onAdded }: {
  google: MailAccounts["google"] | undefined;
  googleReady: boolean;
  personalMsOk: boolean;
  hasMain: boolean;
  onAdded: (a: MailAccount) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const microsoft = useMicrosoftAdd(hasMain);
  const googleGo = useGoogleConnect();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<Discovered | null>(null);
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [security, setSecurity] = useState<"ssl" | "starttls">("ssl");
  const [username, setUsername] = useState("");
  // Gmail with Google sign-in not set up: an app password over IMAP after all.
  const [imapAnyway, setImapAnyway] = useState(false);
  const emailOk = EMAIL.test(email.trim());

  const look = useMutation({
    mutationFn: () => discoverMail(email.trim()),
    onSuccess: (d) => {
      setFound(d);
      setPassword("");
      setImapAnyway(false);
      setHost(d.imap?.host ?? "");
      setPort(String(d.imap?.port ?? 993));
      setSecurity(d.imap?.security ?? "ssl");
      setUsername(d.username);
      setAdvanced(!d.found && d.note !== "proton");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => addMailAccount({
      email: email.trim(),
      provider: found?.provider ?? "other",
      password,
      host: host.trim(),
      port: Number(port) || 993,
      security,
      username: username.trim(),
    }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: m365Keys.accounts });
      if (a.status === "ok") toast.success(t("Connected and signed in fine."));
      else toast.error(a.last_error ?? t("Saved, but the office could not sign in yet."));
      onAdded(a);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sameEmail = found && found.email === email.trim().toLowerCase();
  const d = sameEmail ? found : null;
  const viaGoogle = d?.oauth === "google" && !imapAnyway;
  const viaMicrosoft = d?.oauth === "microsoft";
  const needsServer = !!d && !viaGoogle && !viaMicrosoft && d.note !== "proton";
  const canSave = needsServer && password.length > 0 && host.trim().length > 3;
  const label = d?.name || d?.imap?.host || d?.domain || "";

  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      if (!d) { if (emailOk) look.mutate(); }
      else if (canSave) save.mutate();
    }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label={t("Email address")} type="email" autoComplete="email" inputMode="email" value={email} className="min-w-0 flex-1"
          onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
          error={email && !emailOk ? t("Check the email address.") : undefined} />
        {!d ? <Button type="submit" variant="secondary" disabled={!emailOk} loading={look.isPending}>{t("Continue")}</Button> : null}
      </div>

      {d && viaGoogle ? (
        <Found icon={GoogleLogoIcon} text={t("{email} is a Google account.", { email: d.email })}>
          {googleReady ? (
            <Button type="button" onClick={() => googleGo.mutate()} loading={googleGo.isPending}><GoogleLogoIcon size={16} /> {t("Continue with Google")}</Button>
          ) : (
            <>
              <p className="text-[12.5px] text-muted">
                {google?.account ? t("A Google account is already connected with Google's sign-in.") : t("Google sign-in is not set up for this office, so it connects with an app password instead.")}
              </p>
              <Button type="button" variant="outline" onClick={() => setImapAnyway(true)}>{t("Use an app password")}</Button>
            </>
          )}
        </Found>
      ) : null}

      {d && viaMicrosoft ? (
        <Found icon={MicrosoftOutlookLogoIcon} text={t("{email} is a Microsoft account.", { email: d.email })}>
          {isConsumerDomain(d.domain) && !personalMsOk ? (
            <p className="text-[12.5px] text-muted">{t("Microsoft turned off password sign-in for Outlook.com and Hotmail, so this needs Microsoft's sign-in. Ask an admin to let the office's Microsoft app accept personal accounts (Channels > Microsoft 365).")}</p>
          ) : (
            <Button type="button" onClick={() => microsoft.mutate()} loading={microsoft.isPending}><MicrosoftOutlookLogoIcon size={16} /> {t("Continue with Microsoft")}</Button>
          )}
        </Found>
      ) : null}

      {d?.note === "proton" ? (
        <Found icon={WarningCircleIcon} warn text={t("Proton Mail lets other apps in only through Proton's Bridge app on a computer, so it cannot be connected here.")} />
      ) : null}

      {needsServer ? (
        <>
          {d.found ? (
            <Found icon={CheckCircleIcon} text={d.source === "guess" ? t("The server looks like {host}. The test after Connect confirms it.", { host: d.imap?.host ?? "" }) : t("Found: {name}", { name: label })} />
          ) : (
            <Found icon={WarningCircleIcon} warn text={t("The mail server for {domain} was not found. Type it under Advanced (your hosting's email settings page shows it).", { domain: d.domain })} />
          )}
          {d.password === "app" || (imapAnyway && d.oauth === "google") ? (
            <p className="text-[12.5px] text-muted">{t("{name} does not let other apps use your normal password: create an app password and paste it here.", { name: d.name || d.domain })}</p>
          ) : d.password === "app_if_2fa" ? (
            <p className="text-[12.5px] text-muted">{t("Use your normal password, or an app password if you turned on two-step sign-in.")}</p>
          ) : null}
          {d.note === "imap_off" ? <p className="text-[12.5px] text-muted">{t("Turn on IMAP access in the mailbox's settings first.")}</p> : null}
          {d.app_password_url && d.password !== "normal" ? (
            <a href={d.app_password_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 justify-self-start text-[13px] font-medium text-accent hover:underline">
              {t("Create an app password")} <ArrowSquareOutIcon size={14} />
            </a>
          ) : null}
          <Field label={d.password === "app" || imapAnyway ? t("App password") : t("Password")} type="password" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}
            className="hit inline-flex items-center gap-1 justify-self-start text-[12.5px] font-medium text-muted hover:text-fg">
            <CaretDownIcon size={12} className={cn("transition-transform", advanced && "rotate-180")} /> {t("Advanced")}
          </button>
          {advanced ? (
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
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!canSave} loading={save.isPending}><EnvelopeSimpleIcon size={16} /> {t("Connect and test")}</Button>
            <span className="text-[12px] text-muted">{t("The password is kept encrypted, used only to copy your attachments, and deleted when you disconnect.")}</span>
          </div>
        </>
      ) : null}
    </form>
  );
}

function Found({ icon: IconCmp, text, warn, children }: { icon: typeof GoogleLogoIcon; text: string; warn?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("grid gap-2 rounded-[var(--radius-md)] border p-3", warn ? "border-warn/30 bg-warn/6" : "border-border bg-surface-2/50")} aria-live="polite">
      <p className="flex items-start gap-2 text-[13px]"><IconCmp size={17} weight="fill" className={cn("mt-0.5 shrink-0", warn ? "text-warn" : "text-ok")} /><span className="min-w-0 break-words">{text}</span></p>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
