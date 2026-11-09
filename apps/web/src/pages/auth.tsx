import { BuildingsIcon, HardDrivesIcon, LockSimpleIcon, ShieldCheckIcon, SignInIcon, UserFocusIcon, UsersThreeIcon, type Icon } from "@phosphor-icons/react";
import { useQuery, useQueryClient, useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";

import { LanguageSwitch } from "@/components/language-switch";
import { EmailSignInForm } from "@/components/sign-in-emails";
import { Wordmark } from "@/components/logo";
import { IconTile } from "@/components/page";
import { CodeInput, RecoveryInput, TwoFactorSetup } from "@/components/two-factor";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { msg, useT } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { safeNext } from "@/lib/search";
import { ssoKey, type SsoOptions } from "@/lib/signin-emails";
import { lastLoginPath, rememberLoginPath, staffQuery, type LoginPath } from "@/lib/staff";
import { staffOnly } from "@/lib/twin";
import { isChallenge, type TwoFactorChallenge } from "@/lib/two-factor";
import type { Me } from "@/lib/types";
import { useSignOut } from "@/lib/use-sign-out";
import { cn } from "@/lib/utils";

const POINTS: { icon: Icon; title: string; body: string }[] = [
  { icon: ShieldCheckIcon, title: msg("Tamper-evident"), body: msg("Every change is recorded in a hash-chained log.") },
  { icon: UsersThreeIcon, title: msg("Roles that fit"), body: msg("Roles decide who can create work and who approves it.") },
  { icon: HardDrivesIcon, title: msg("Yours to run"), body: msg("Runs on your own machine. Nothing to buy.") },
];

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]"
        />
        <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 size-[34rem] rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_65%)]" />
        <Wordmark className="relative" />
        <div className="relative max-w-lg">
          <h2 className="text-[34px] leading-[1.1] font-semibold tracking-tight text-balance">
            {t("Run your AI agents like an office.")}
          </h2>
          <p className="mt-4 max-w-md text-[15px] text-muted">
            {t("Branches for every company, departments with their own SOPs, and agents that ask before they act.")}
          </p>
          <ul className="mt-10 grid gap-3">
            {POINTS.map((pt) => (
              <li key={pt.title} className="flex items-start gap-3.5 rounded-[var(--radius-md)] border border-border bg-bg/60 p-3.5 backdrop-blur-sm">
                <IconTile icon={pt.icon} size="sm" />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">{t(pt.title)}</span>
                  <span className="block text-[13px] text-muted">{t(pt.body)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-[12px] text-muted">
          <LockSimpleIcon size={14} /> {t("Self-hosted. Your data stays in your Postgres.")}
        </p>
      </aside>
      <main
        className="relative flex flex-col items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))", paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="absolute top-3 right-3 z-10" style={{ marginTop: "env(safe-area-inset-top)" }}>
          <LanguageSwitch signedIn={false} />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_70%)] lg:hidden" />
        <div className="relative w-full max-w-[25rem]">
          <Wordmark className="mb-8 justify-center lg:hidden" />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 mb-6 text-[13.5px] text-muted">{subtitle}</p>
            {children}
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[12px] text-muted lg:hidden">
            <LockSimpleIcon size={13} /> {t("Self-hosted. Your data stays in your Postgres.")}
          </p>
        </div>
      </main>
    </div>
  );
}

function useAuthSubmit<T>(
  path: string,
  onDone: (me: Me) => void | Promise<void>,
  // P57: the password was right and the account uses two-step sign-in: a code comes next.
  onChallenge?: (c: TwoFactorChallenge) => void,
) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (body: T) => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setFields({});
    try {
      const res = await api<Me | TwoFactorChallenge>(path, "POST", body);
      if (isChallenge(res)) {
        onChallenge?.(res);
        return;
      }
      qc.setQueryData(keys.me, res);
      qc.setQueryData(keys.setup, { needs_setup: false });
      await onDone(res);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(e.fields);
        setErrorCode(e.code);
        setError(Object.keys(e.fields).length ? null : e.message);
      } else {
        setError(t("Something went wrong."));
      }
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, errorCode, fields, submit };
}

function formValues(e: FormEvent<HTMLFormElement>): Record<string, string> {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
}

export function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const { busy, error, fields, submit } = useAuthSubmit("/api/auth/setup", () => {
    toast.success(t("Workspace created. Welcome in."));
    navigate({ to: "/" });
  });
  return (
    <AuthLayout title={t("Set up your workspace")} subtitle={t("You become the owner. You can add teammates after this.")}>
      <form className="grid gap-4" onSubmit={(e) => submit(formValues(e))} noValidate>
        <Field label={t("Workspace name")} name="workspace_name" required autoComplete="organization" placeholder={t("e.g. Maju Holdings")} error={fields.workspace_name} />
        <Field label={t("Your name")} name="name" required autoComplete="name" error={fields.name} />
        <Field label={t("Email")} name="email" type="email" required autoComplete="email" error={fields.email} />
        <Field label={t("Password")} name="password" type="password" required autoComplete="new-password" hint={t("At least 10 characters.")} error={fields.password} />
        <FormError message={error} />
        <Button type="submit" size="lg" loading={busy} className="mt-1">
          {t("Create workspace")}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Where a person goes after signing in (P19): staff who chose "I'm staff" hire their AI
 * worker first, if they have not yet; then everyone lands on their own workspace (P26),
 * unless they were on their way somewhere. */
async function landing(qc: QueryClient, me: Me, path: LoginPath, next?: string): Promise<string> {
  // Only an in-app path: "//host", "/\host" or a full URL never sends a person off-site.
  const wanted = safeNext(next, "") || undefined;
  if (path === "staff" && staffOnly(me.permissions)) {
    try {
      const s = await qc.fetchQuery(staffQuery);
      return s.onboarding.done ? (wanted ?? "/workspace") : "/welcome";
    } catch {
      return wanted ?? "/workspace";
    }
  }
  return wanted ?? "/workspace";
}

const PATHS: { value: LoginPath; icon: Icon; title: string; hint: string }[] = [
  { value: "staff", icon: UserFocusIcon, title: msg("I'm staff"), hint: msg("My AI worker") },
  { value: "manager", icon: BuildingsIcon, title: msg("Owner / manager"), hint: msg("Run the office") },
];

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { next?: string; sso?: "done" | "code"; sso_error?: string };
  const [path, setPath] = useState<LoginPath>(lastLoginPath);
  const [challenge, setChallenge] = useState<{ token: string; email: string } | null>(() => ssoChallenge(search.sso));
  const [email, setEmail] = useState("");
  const staff = path === "staff";
  const signedIn = async (me: Me) => {
    rememberLoginPath(path);
    if (me.user.must_change_password) navigate({ to: "/change-password" });
    else if (me.user.two_factor_setup_required) navigate({ to: "/two-step-setup" });
    else navigate({ to: await landing(qc, me, path, search.next) });
  };
  const { busy, error, errorCode, fields, submit } = useAuthSubmit("/api/auth/login", signedIn, (c) => setChallenge({ token: c.challenge, email }));
  const finishing = useSsoDone(search.sso === "done", signedIn);
  const loginForm = useRef<HTMLFormElement>(null);
  // P92: "Email me a sign-in password" (first sign-in or a forgotten password), when offered.
  const sso = useQuery({ queryKey: ssoKey, queryFn: () => api<SsoOptions>("/api/auth/sso"), staleTime: 60_000 });
  const emailOn = !!sso.data?.email_signin;
  const [emailing, setEmailing] = useState(false);
  const startEmailing = () => {
    const typed = loginForm.current?.elements.namedItem("email") as HTMLInputElement | null | undefined;
    setEmail(typed?.value.trim() ?? email);
    setEmailing(true);
  };
  if (challenge) {
    return <CodeStep challenge={challenge.token} email={challenge.email} onDone={signedIn} onBack={() => setChallenge(null)} />;
  }
  if (finishing) {
    return (
      <AuthLayout title={t("Signing you in")} subtitle={t("Microsoft confirmed it is you. Opening the office…")}>
        <div className="grid place-items-center py-6"><span className="size-6 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
      </AuthLayout>
    );
  }
  if (emailing) {
    return (
      <AuthLayout title={t("Email me a sign-in password")} subtitle={t("For your first sign-in, or if you forgot your password. We email you a temporary password.")}>
        <EmailSignInForm initialEmail={email} onBack={() => setEmailing(false)} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title={staff ? t("Sign in to your AI worker") : t("Sign in")}
      subtitle={staff ? t("Staff sign in here. Your AI worker is waiting for you.") : t("Run the office: agents, work, approvals and settings.")}
    >
      <div role="radiogroup" aria-label={t("I am signing in as")} className="mb-5 grid grid-cols-2 gap-2">
        {PATHS.map((p) => {
          const on = path === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPath(p.value)}
              className={cn(
                "grid min-h-[4.5rem] min-w-0 content-center justify-items-start gap-1 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow]",
                on ? "border-accent/60 bg-accent-soft/60 shadow-[var(--shadow-soft)]" : "border-border bg-surface hover:border-accent/30",
              )}
            >
              <p.icon size={20} weight={on ? "fill" : "duotone"} className={on ? "text-accent" : "text-muted"} />
              <span className="w-full truncate text-[13.5px] font-semibold">{t(p.title)}</span>
              <span className="w-full truncate text-[12px] text-muted">{t(p.hint)}</span>
            </button>
          );
        })}
      </div>
      <MicrosoftSignIn staff={staff} next={search.next} error={search.sso_error} form={loginForm} />
      <form
        ref={loginForm}
        className={cn("grid gap-4", staff && "[&_input]:h-12 [&_input]:text-[16px]")}
        onSubmit={(e) => {
          const v = formValues(e);
          setEmail(v.email ?? "");
          submit(v);
        }}
        noValidate
      >
        <Field label={t("Email")} name="email" type="email" required autoComplete="username" inputMode="email" error={fields.email} />
        <Field label={t("Password")} name="password" type="password" required autoComplete="current-password" error={fields.password} />
        <FormError message={error} />
        {emailOn && errorCode === "bad_credentials" ? (
          <p role="status" className="rounded-sm border border-accent/25 bg-accent-soft/50 px-3 py-2 text-[13px]">
            {t("First time here? If your account is new, we have emailed a temporary password to you. Check your inbox (and Junk).")}
          </p>
        ) : null}
        <Button type="submit" size="lg" loading={busy} className={cn("mt-1", staff && "h-12 text-[16px]")}>
          {!busy ? <SignInIcon size={17} weight="bold" /> : null} {staff ? t("Sign in") : t("Sign in to the office")}
        </Button>
        {emailOn ? (
          <div className="grid justify-items-center gap-0.5 text-center">
            <span className="text-[12.5px] text-muted">{t("First time here, or forgot your password?")}</span>
            <button type="button" onClick={startEmailing} className="min-h-10 px-2 text-[13.5px] font-medium text-accent hover:underline">
              {t("Email me a sign-in password")}
            </button>
          </div>
        ) : (
          <p className="text-center text-[12.5px] text-muted">{t("Forgot your password? Ask an admin or your manager to reset it.")}</p>
        )}
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- P63 Sign in with Microsoft

/** Back from Microsoft with the two-step code still to enter: the challenge is in the address's
 * fragment (never sent to a server), read once and cleared from the address bar. */
function ssoChallenge(sso: string | undefined): { token: string; email: string } | null {
  if (sso !== "code" || typeof window === "undefined") return null;
  const h = new URLSearchParams(window.location.hash.slice(1));
  const token = h.get("mfa");
  if (!token) return null;
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return { token, email: h.get("email") ?? "" };
}

/** Back from Microsoft signed in: read who it is, then land them as a password sign-in does. */
function useSsoDone(on: boolean, signedIn: (me: Me) => Promise<void>): boolean {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(on);
  const started = useRef(false);
  useEffect(() => {
    if (!on || started.current) return;
    started.current = true;
    qc.fetchQuery({ ...meQuery, staleTime: 0 })
      .then(async (me) => {
        qc.setQueryData(keys.me, me);
        await signedIn(me);
      })
      .catch(() => setBusy(false));
  }, [on, qc, signedIn]);
  return busy;
}

/** The Microsoft logo, as Microsoft's sign-in button guidelines show it. */
function MicrosoftLogo() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/** One button: Microsoft's own sign-in (with its multi-factor), then back here signed in. The
 * email typed above it, if any, picks the office and fills Microsoft's account box. */
function MicrosoftSignIn({ staff, next, error, form }: {
  staff: boolean; next?: string; error?: string; form: RefObject<HTMLFormElement | null>;
}) {
  const emailInput = () => form.current?.elements.namedItem("email") as HTMLInputElement | null | undefined;
  const t = useT();
  const sso = useQuery({ queryKey: ["auth", "sso"], queryFn: () => api<{ microsoft: boolean }>("/api/auth/sso"), staleTime: 60_000 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(error ?? null);
  if (!sso.data?.microsoft) return problem ? <div className="mb-4"><FormError message={problem} /></div> : null;
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api<{ url: string }>("/api/auth/microsoft/start", "POST", {
        email: emailInput()?.value.trim() ?? "",
        next: safeNext(next, ""),
      });
      window.location.href = r.url;
    } catch (e) {
      setBusy(false);
      setProblem(e instanceof ApiError ? e.message : t("Something went wrong."));
      if (e instanceof ApiError && e.code === "email_needed") emailInput()?.focus();
    }
  };
  return (
    <div className="mb-5 grid gap-4">
      <Button type="button" variant="outline" size="lg" loading={busy} onClick={() => void go()} className={cn("gap-2.5", staff && "h-12 text-[16px]")}>
        {!busy ? <MicrosoftLogo /> : null} {t("Sign in with Microsoft")}
      </Button>
      <FormError message={problem} />
      <div className="flex items-center gap-3 text-[12px] text-muted">
        <span className="h-px flex-1 bg-border" /> {t("or with your password")} <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

/** P57: the second step of signing in: a code from the authenticator app, or a recovery code. */
function CodeStep({ challenge, email, onDone, onBack }: { challenge: string; email: string; onDone: (me: Me) => Promise<void>; onBack: () => void }) {
  const t = useT();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const { busy, error, errorCode, submit } = useAuthSubmit("/api/auth/login/2fa", onDone);
  // The challenge is gone (timed out, or too many wrong codes): only the password step helps.
  const expired = errorCode === "challenge_expired" || errorCode === "too_many_codes";
  const send = (c?: string) => {
    if (busy || expired) return;
    if (recovery) {
      if (recoveryCode.trim()) submit({ challenge, recovery_code: recoveryCode.trim() });
      return;
    }
    const value = c ?? code;
    if (value.length === 6) submit({ challenge, code: value }).then(() => setCode(""));
  };
  return (
    <AuthLayout
      title={recovery ? t("Use a recovery code") : t("Enter your code")}
      subtitle={
        recovery
          ? t("Type one of the recovery codes you saved when you set up two-step sign-in. Each works once.")
          : t("Open your authenticator app and type the 6-digit code for {email}.", { email: email || t("your account") })
      }
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {recovery ? (
          <RecoveryInput label={t("Recovery code")} value={recoveryCode} onChange={setRecoveryCode} autoFocus />
        ) : (
          <CodeInput label={t("6-digit code")} value={code} onChange={setCode} onComplete={(c) => send(c)} autoFocus disabled={busy || expired} error={error} />
        )}
        <FormError message={error} />
        {expired ? (
          <Button type="button" size="lg" onClick={onBack}>
            {t("Enter your password again")}
          </Button>
        ) : (
          <Button type="submit" size="lg" loading={busy} disabled={recovery ? !recoveryCode.trim() : code.length !== 6}>
            {t("Sign in")}
          </Button>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <button type="button" className="text-accent hover:underline" onClick={() => setRecovery((v) => !v)}>
            {recovery ? t("Use a code from your app instead") : t("Use a recovery code instead")}
          </button>
          <button type="button" className="text-muted hover:text-fg hover:underline" onClick={onBack}>
            {t("Back")}
          </button>
        </div>
        <p className="text-center text-[12.5px] text-muted">{t("Lost your phone and your recovery codes? Ask an owner to reset your two-step sign-in.")}</p>
      </form>
    </AuthLayout>
  );
}

/** P57: the company requires two-step sign-in and this person has not set it up. Nothing else
 * works until they do (the API answers 2fa_required everywhere else). */
export function TwoStepSetupPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const navigate = useNavigate();
  const signOut = useSignOut();
  const qc = useQueryClient();
  return (
    <AuthLayout title={t("Set up two-step sign-in")} subtitle={t("Your company requires two-step sign-in: set it up to continue.")}>
      <div className="grid gap-4">
        <TwoFactorSetup
          email={me.user.email}
          onDone={async () => {
            const fresh = await qc.fetchQuery({ ...meQuery, staleTime: 0 });
            toast.success(t("Two-step sign-in is on."));
            navigate({ to: await landing(qc, fresh, lastLoginPath()) });
          }}
        />
        <Button type="button" variant="ghost" onClick={signOut}>
          {t("Sign out instead")}
        </Button>
      </div>
    </AuthLayout>
  );
}

export function ChangePasswordPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const forced = me.user.must_change_password;
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [mismatch, setMismatch] = useState<string | undefined>();
  const qc = useQueryClient();
  const { busy, error, fields, submit } = useAuthSubmit("/api/auth/change-password", async (fresh) => {
    toast.success(t("Password updated. Other devices were signed out."));
    // A first sign-in (temporary password) continues where the login choice pointed.
    if (fresh.user.two_factor_setup_required) navigate({ to: "/two-step-setup" });
    else navigate({ to: forced ? await landing(qc, fresh, lastLoginPath()) : "/" });
  });
  return (
    <AuthLayout
      title={forced ? t("Choose your own password") : t("Change password")}
      subtitle={forced ? t("You signed in with a temporary password. Replace it to continue.") : t("Every other device will be signed out.")}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          const v = formValues(e);
          if (v.new_password !== v.confirm) {
            setMismatch(t("The two new passwords do not match."));
            return;
          }
          setMismatch(undefined);
          submit({ current_password: v.current_password, new_password: v.new_password });
        }}
      >
        <Field label={forced ? t("Temporary password") : t("Current password")} name="current_password" type="password" required autoComplete="current-password" error={fields.current_password} />
        <Field label={t("New password")} name="new_password" type="password" required autoComplete="new-password" hint={t("At least 10 characters.")} error={fields.new_password} />
        <Field label={t("Repeat new password")} name="confirm" type="password" required autoComplete="new-password" error={mismatch} />
        <FormError message={error} />
        <Button type="submit" size="lg" loading={busy} className="mt-1">
          {t("Save password")}
        </Button>
        {forced ? (
          <Button type="button" variant="ghost" onClick={signOut}>
            {t("Sign out instead")}
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={() => navigate({ to: "/" })}>
            {t("Cancel")}
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
