import { BuildingsIcon, HardDrivesIcon, LockSimpleIcon, ShieldCheckIcon, SignInIcon, UserFocusIcon, UsersThreeIcon, type Icon } from "@phosphor-icons/react";
import { useQueryClient, useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { LanguageSwitch } from "@/components/language-switch";
import { Wordmark } from "@/components/logo";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { msg, useT } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { lastLoginPath, rememberLoginPath, staffQuery, type LoginPath } from "@/lib/staff";
import { staffOnly } from "@/lib/twin";
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

function useAuthSubmit<T>(path: string, onDone: (me: Me) => void | Promise<void>) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (body: T) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const me = await api<Me>(path, "POST", body);
      qc.setQueryData(keys.me, me);
      qc.setQueryData(keys.setup, { needs_setup: false });
      await onDone(me);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(e.fields);
        setError(Object.keys(e.fields).length ? null : e.message);
      } else {
        setError(t("Something went wrong."));
      }
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, fields, submit };
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

/** Where a person goes after signing in (P19): staff who chose "I'm staff" go to their AI
 * worker (hiring it first, if they have not yet); everyone else to where they were going. */
async function landing(qc: QueryClient, me: Me, path: LoginPath, next?: string): Promise<string> {
  const wanted = next && next.startsWith("/") ? next : undefined;
  if (path === "staff" && staffOnly(me.permissions)) {
    try {
      const s = await qc.fetchQuery(staffQuery);
      return s.onboarding.done ? (wanted ?? "/my-worker") : "/welcome";
    } catch {
      return wanted ?? "/my-worker";
    }
  }
  return wanted ?? "/";
}

const PATHS: { value: LoginPath; icon: Icon; title: string; hint: string }[] = [
  { value: "staff", icon: UserFocusIcon, title: msg("I'm staff"), hint: msg("My AI worker") },
  { value: "manager", icon: BuildingsIcon, title: msg("Owner / manager"), hint: msg("Run the office") },
];

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { next?: string };
  const [path, setPath] = useState<LoginPath>(lastLoginPath);
  const staff = path === "staff";
  const { busy, error, fields, submit } = useAuthSubmit("/api/auth/login", async (me) => {
    rememberLoginPath(path);
    if (me.user.must_change_password) navigate({ to: "/change-password" });
    else navigate({ to: await landing(qc, me, path, search.next) });
  });
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
      <form
        className={cn("grid gap-4", staff && "[&_input]:h-12 [&_input]:text-[16px]")}
        onSubmit={(e) => submit(formValues(e))}
        noValidate
      >
        <Field label={t("Email")} name="email" type="email" required autoComplete="username" inputMode="email" error={fields.email} />
        <Field label={t("Password")} name="password" type="password" required autoComplete="current-password" error={fields.password} />
        <FormError message={error} />
        <Button type="submit" size="lg" loading={busy} className={cn("mt-1", staff && "h-12 text-[16px]")}>
          {!busy ? <SignInIcon size={17} weight="bold" /> : null} {staff ? t("Sign in") : t("Sign in to the office")}
        </Button>
        <p className="text-center text-[12.5px] text-muted">{t("Forgot your password? Ask an admin or your manager to reset it.")}</p>
      </form>
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
    navigate({ to: forced ? await landing(qc, fresh, lastLoginPath()) : "/" });
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
