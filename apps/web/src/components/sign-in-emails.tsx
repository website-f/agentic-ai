/** P92: emailed sign-in passwords.
 * - EmailSignInForm: the sign-in page's "Email me a sign-in password" (a generic answer).
 * - SignInEmailsSection: Settings > Sign-in emails (owner): the sender, the switches, a test.
 * - SignInEmailsBar: the Members page: a warning when emails cannot go out, and "Email sign-in
 *   passwords to everyone who has not signed in yet" with its progress.
 * - useEmailMember: one person's "Email a sign-in password". */
import { CheckCircleIcon, CopyIcon, EnvelopeSimpleIcon, PaperPlaneTiltIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { IconTile, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, FormError } from "@/components/ui/field";
import { SwitchField } from "@/components/ui/switch";
import { t as tr, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import {
  bulkDone, bulkMinutesLeft, formFrom, plausibleAddress, rbacScript, signinEmailsKey, systemMailKey,
  type SigninEmails, type SystemMail, type SystemMailIn,
} from "@/lib/signin-emails";

// ---------------------------------------------------------------- the sign-in page

/** "Email me a sign-in password": the same answer whether or not the email has an account. */
export function EmailSignInForm({ initialEmail = "", onBack }: { initialEmail?: string; onBack: () => void }) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = email.trim();
    if (!plausibleAddress(value)) {
      setFieldError(t("Type your full work email address."));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/email-signin", "POST", { email: value });
      setSentTo(value);
    } catch (err) {
      if (err instanceof ApiError && err.fields.email) setFieldError(err.fields.email);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (sentTo) {
    return (
      <div className="grid gap-4" role="status">
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-ok/30 bg-ok/8 p-3.5">
          <CheckCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-ok" />
          <p className="min-w-0 text-[13.5px] break-words">
            {t("If {email} belongs to someone in the office, a temporary password is on its way. Check your inbox (and Junk). It works once, for 24 hours.", { email: sentTo })}
          </p>
        </div>
        <p className="text-[12.5px] text-muted">{t("Nothing after 10 minutes? Check the address, or ask your manager or an admin.")}</p>
        <Button type="button" size="lg" onClick={onBack}>{t("Back to sign in")}</Button>
      </div>
    );
  }
  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <Field label={t("Email")} name="email" type="email" required autoComplete="username" inputMode="email" autoFocus
        value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError} className="[&_input]:h-12 [&_input]:text-[16px]" />
      <FormError message={error} />
      <Button type="submit" size="lg" loading={busy} className="h-12 text-[16px]">
        {!busy ? <PaperPlaneTiltIcon size={17} weight="bold" /> : null} {t("Email me a sign-in password")}
      </Button>
      <Button type="button" variant="ghost" onClick={onBack}>{t("Back to sign in")}</Button>
    </form>
  );
}

// ---------------------------------------------------------------- Settings > Sign-in emails

function CopyBlock({ text }: { text: string }) {
  const t = useT();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Copied."));
    } catch {
      toast.error(t("Copy blocked by the browser. Select the text and copy it by hand."));
    }
  };
  return (
    <div className="grid gap-1.5">
      <pre className="max-w-full overflow-x-auto rounded-sm border border-border bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre">{text}</pre>
      <div><Button size="sm" variant="outline" onClick={copy}><CopyIcon size={14} /> {t("Copy")}</Button></div>
    </div>
  );
}

/** The setup steps (docs/SYSTEM_EMAIL_SETUP.md has the same, longer). */
export function SetupSteps({ address }: { address: string }) {
  const t = useT();
  const steps = [
    t("In the Microsoft Entra admin center, open App registrations and the office's app (the one used for Sign in with Microsoft). Note its Application (client) ID."),
    t("Quick way: API permissions > Add a permission > Microsoft Graph > Application permissions > Mail.Send > Add, then Grant admin consent. This lets the app send as any mailbox in the company."),
    t("Safer way (recommended): let the app send only as the sender mailbox. Run the PowerShell below as an Exchange admin (the Object ID is on the app's page under Enterprise applications). Then remove the Mail.Send permission from step 2 if you added it: Microsoft adds both together, so the limit only works without it."),
    t("For the name No Reply: Microsoft shows the mailbox's own display name. Best: create a free shared mailbox such as noreply@yourcompany.com named No Reply and use it here. Or rename the display name of the mailbox you use."),
    t("Here: type the sender address and name, turn sign-in emails on, Save, then Send a test email to me."),
    t("Then on Members: Email sign-in passwords to everyone who has not signed in yet. Or just let people try to sign in: a new person gets theirs automatically."),
  ];
  return (
    <details className="group rounded-[var(--radius-md)] border border-border bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-[13.5px] font-medium select-none sm:px-5">
        {t("How to set this up")} <span className="text-muted group-open:hidden">({t("6 steps")})</span>
      </summary>
      <div className="grid gap-3 border-t border-border px-4 py-4 sm:px-5">
        <ol className="grid list-decimal gap-2 pl-5 text-[13px]">
          {steps.map((s) => <li key={s} className="break-words">{s}</li>)}
        </ol>
        <p className="text-[12.5px] font-medium">{t("PowerShell for the safer way (step 3):")}</p>
        <CopyBlock text={rbacScript(address)} />
        <p className="text-[12.5px] text-muted">{t("Test-ServicePrincipalAuthorization should say InScope True for the sender mailbox. Changes can take up to an hour to apply. Full steps: docs/SYSTEM_EMAIL_SETUP.md (as of Nov 2026).")}</p>
      </div>
    </details>
  );
}

function SenderForm({ data }: { data: SystemMail }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<SystemMailIn>(() => formFrom(data));
  const set = (c: Partial<SystemMailIn>) => setForm((f) => ({ ...f, ...c }));
  const save = useMutation({
    mutationFn: () => api<SystemMail>("/api/settings/system-mail", "PUT", form),
    onSuccess: (r) => {
      qc.setQueryData(systemMailKey, r);
      qc.invalidateQueries({ queryKey: signinEmailsKey });
      qc.invalidateQueries({ queryKey: ["auth", "sso"] });
      toast.success(t("Sign-in emails saved."));
    },
  });
  const test = useMutation({ mutationFn: () => api<{ ok: boolean; to: string }>("/api/settings/system-mail/test", "POST") });
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(data));
  const addressError = form.address && !plausibleAddress(form.address) ? t("Type the full email address of the mailbox, like noreply@yourcompany.com.") : undefined;
  return (
    <div className="grid gap-4">
      {data.problem ? (
        <div role="status" className="flex items-start gap-2.5 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2.5 text-[13px]">
          <WarningIcon size={17} className="mt-0.5 shrink-0 text-warn" />
          <span className="min-w-0 break-words">{data.problem}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <Field label={t("Sender address")} type="email" inputMode="email" autoComplete="off" value={form.address} placeholder="noreply@yourcompany.com"
          onChange={(e) => set({ address: e.target.value })} error={addressError ?? (save.error instanceof ApiError && save.error.code === "bad_address" ? save.error.message : undefined)}
          hint={t("A mailbox in your company's Microsoft 365, best a shared one.")} />
        <Field label={t("Sender name")} value={form.from_name} maxLength={80} onChange={(e) => set({ from_name: e.target.value })}
          error={save.error instanceof ApiError && save.error.code === "bad_name" ? save.error.message : undefined}
          hint={t("Microsoft shows the mailbox's own display name.")} />
      </div>
      <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3.5">
        <SwitchField checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} label={t("Send sign-in emails")}
          hint={t("Off: nobody gets a sign-in email from the office.")} />
        <SwitchField checked={form.first_login} disabled={!form.enabled} onCheckedChange={(v) => set({ first_login: v })} label={t("First sign-in")}
          hint={t("Someone who has never signed in and tries gets a temporary password by email.")} />
        <SwitchField checked={form.forgot_password} disabled={!form.enabled} onCheckedChange={(v) => set({ forgot_password: v })} label={t("Forgotten passwords")}
          hint={t("Anyone in the office can ask for a temporary password on the sign-in page. Their own password keeps working.")} />
      </div>
      <FormError message={save.error && !(save.error instanceof ApiError && ["bad_address", "bad_name"].includes(save.error.code)) ? errorMessage(save.error) : null} />
      <div className="flex flex-wrap gap-2">
        <Button loading={save.isPending} disabled={!dirty || !!addressError} onClick={() => save.mutate()}>{t("Save")}</Button>
        <Button variant="outline" loading={test.isPending} disabled={dirty || !data.address} onClick={() => test.mutate()}>
          <EnvelopeSimpleIcon size={16} /> {t("Send a test email to me")}
        </Button>
      </div>
      {dirty && data.address ? <p className="text-[12.5px] text-muted">{t("Save first, then send the test.")}</p> : null}
      {test.isSuccess ? (
        <p role="status" className="flex items-start gap-2 text-[13px] text-ok">
          <CheckCircleIcon size={17} weight="fill" className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{t("Test email sent to {email}. Check that inbox (and Junk). It has no password in it.", { email: test.data.to })}</span>
        </p>
      ) : null}
      <FormError message={test.error ? errorMessage(test.error) : null} />
    </div>
  );
}

export function SignInEmailsSection() {
  const t = useT();
  const q = useQuery({ queryKey: systemMailKey, queryFn: () => api<SystemMail>("/api/settings/system-mail") });
  return (
    <Section title={t("Sign-in emails")} description={t("New people get their temporary password by email, and anyone can ask for one if they forget their password. Sent from a company mailbox through the office's Microsoft app.")}>
      <div id="sign-in-emails" className="grid gap-3">
        <Card>
          <CardHeader icon={<IconTile icon={EnvelopeSimpleIcon} size="sm" tone="info" />} title={t("Sender")} />
          <CardBody>
            {q.data ? <SenderForm key={JSON.stringify(formFrom(q.data))} data={q.data} /> : q.error ? <FormError message={errorMessage(q.error)} /> : <p className="text-[13px] text-muted">{t("Loading…")}</p>}
          </CardBody>
        </Card>
        <SetupSteps address={q.data?.address ?? ""} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- the Members page

/** One person's "Email a sign-in password" (members.manage; the server checks). */
export function useEmailMember(userId: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean; to: string }>(`/api/members/${userId}/email-signin`, "POST"),
    onSuccess: (r) => {
      toast.success(tr("Sign-in password emailed to {name} ({email}).", { name, email: r.to }));
      qc.invalidateQueries({ queryKey: signinEmailsKey });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function JobLine({ data }: { data: SigninEmails }) {
  const t = useT();
  const job = data.job;
  if (!job) return null;
  if (job.state === "running") {
    return (
      <p role="status" className="text-[13px]">
        {t("Sending sign-in emails: {done} of {total}. About {minutes} min left. You can leave this page.", { done: bulkDone(job), total: job.total, minutes: bulkMinutesLeft(job) })}
      </p>
    );
  }
  return (
    <div role="status" className="grid gap-1 text-[13px]">
      <p>{t("Last sending: {sent} sent, {failed} failed, {skipped} skipped.", { sent: job.sent, failed: job.failed, skipped: job.skipped })}</p>
      {job.skipped ? (
        <p className="text-[12.5px] text-muted">
          {t("Skipped: {disabled} switched off, {noemail} with no usable email, {recent} emailed in the last 5 minutes, {signed} signed in meanwhile.", {
            disabled: job.skipped_disabled, noemail: job.skipped_no_email, recent: job.skipped_recent, signed: job.skipped_signed_in,
          })}
        </p>
      ) : null}
      {job.error ? <FormError message={job.error} /> : null}
    </div>
  );
}

export function SignInEmailsBar({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: signinEmailsKey,
    queryFn: () => api<SigninEmails>("/api/members/signin-emails"),
    refetchInterval: (query) => (query.state.data?.job?.state === "running" ? 2000 : false),
  });
  const data = q.data;
  if (!data) return null;
  if (!data.sender_ready) {
    return (
      <div role="status" className="flex flex-wrap items-start gap-2.5 rounded-[var(--radius-md)] border border-warn/30 bg-warn/8 px-3.5 py-3 text-[13px]">
        <WarningIcon size={18} className="mt-0.5 shrink-0 text-warn" />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="font-medium">{t("Sign-in emails are off")}</p>
          <p className="break-words text-muted">
            {data.problem} {t("New people will not get their temporary password by email until it is set up.")}
          </p>
        </div>
        {isOwner ? (
          <Button size="sm" variant="outline" asChild className="max-sm:w-full"><a href="/settings#sign-in-emails">{t("Set up sign-in emails")}</a></Button>
        ) : null}
      </div>
    );
  }
  const running = data.job?.state === "running";
  const n = data.never_signed_in;
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[13px] text-muted">
          {n === 0 ? t("Everyone here has signed in at least once.") : n === 1 ? t("1 person has not signed in yet.") : t("{n} people have not signed in yet.", { n })}
        </p>
        {n > 0 ? (
          <Button size="sm" variant="secondary" disabled={running} onClick={() => setConfirm(true)} className="h-auto min-h-8 py-1.5 text-left whitespace-normal max-sm:w-full">
            <EnvelopeSimpleIcon size={15} /> {t("Email sign-in passwords to everyone who has not signed in yet")}
          </Button>
        ) : null}
      </div>
      <JobLine data={data} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={n === 1 ? t("Email 1 person a sign-in password?") : t("Email {n} people a sign-in password?", { n })}
        body={t("Each gets a new temporary password by email, valid for 24 hours. Their current password keeps working. The emails go out one about every 2 seconds, so this takes about {minutes} min.", { minutes: Math.max(1, Math.ceil((n * 2.5) / 60)) })}
        confirmLabel={t("Send the emails")}
        onConfirm={async () => {
          try {
            await api("/api/members/signin-emails/bulk", "POST");
            await qc.invalidateQueries({ queryKey: signinEmailsKey });
            toast.success(t("Sending started."));
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
