import { HardDrivesIcon, LockSimpleIcon, ShieldCheckIcon, SignInIcon, UsersThreeIcon, type Icon } from "@phosphor-icons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Wordmark } from "@/components/logo";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import type { Me } from "@/lib/types";
import { useSignOut } from "@/lib/use-sign-out";

const POINTS: { icon: Icon; title: string; body: string }[] = [
  { icon: ShieldCheckIcon, title: "Tamper-evident", body: "Every change is recorded in a hash-chained log." },
  { icon: UsersThreeIcon, title: "Roles that fit", body: "Roles decide who can create work and who approves it." },
  { icon: HardDrivesIcon, title: "Yours to run", body: "Runs on your own machine. Nothing to buy." },
];

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
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
            Run your AI agents like an office.
          </h2>
          <p className="mt-4 max-w-md text-[15px] text-muted">
            Branches for every company, departments with their own SOPs, and agents that ask before they act.
          </p>
          <ul className="mt-10 grid gap-3">
            {POINTS.map((pt) => (
              <li key={pt.title} className="flex items-start gap-3.5 rounded-[var(--radius-md)] border border-border bg-bg/60 p-3.5 backdrop-blur-sm">
                <IconTile icon={pt.icon} size="sm" />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">{pt.title}</span>
                  <span className="block text-[13px] text-muted">{pt.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-[12px] text-muted">
          <LockSimpleIcon size={14} /> Self-hosted. Your data stays in your Postgres.
        </p>
      </aside>
      <main
        className="relative flex flex-col items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))", paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_70%)] lg:hidden" />
        <div className="relative w-full max-w-[25rem]">
          <Wordmark className="mb-8 justify-center lg:hidden" />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 mb-6 text-[13.5px] text-muted">{subtitle}</p>
            {children}
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[12px] text-muted lg:hidden">
            <LockSimpleIcon size={13} /> Self-hosted. Your data stays in your Postgres.
          </p>
        </div>
      </main>
    </div>
  );
}

function useAuthSubmit<T>(path: string, onDone: (me: Me) => void) {
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
      onDone(me);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(e.fields);
        setError(Object.keys(e.fields).length ? null : e.message);
      } else {
        setError("Something went wrong.");
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
  const navigate = useNavigate();
  const { busy, error, fields, submit } = useAuthSubmit("/api/auth/setup", () => {
    toast.success("Workspace created. Welcome in.");
    navigate({ to: "/" });
  });
  return (
    <AuthLayout title="Set up your workspace" subtitle="You become the owner. You can add teammates after this.">
      <form className="grid gap-4" onSubmit={(e) => submit(formValues(e))} noValidate>
        <Field label="Workspace name" name="workspace_name" required autoComplete="organization" placeholder="e.g. Maju Holdings" error={fields.workspace_name} />
        <Field label="Your name" name="name" required autoComplete="name" error={fields.name} />
        <Field label="Email" name="email" type="email" required autoComplete="email" error={fields.email} />
        <Field label="Password" name="password" type="password" required autoComplete="new-password" hint="At least 10 characters." error={fields.password} />
        <FormError message={error} />
        <Button type="submit" size="lg" loading={busy} className="mt-1">
          Create workspace
        </Button>
      </form>
    </AuthLayout>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { next?: string };
  const { busy, error, fields, submit } = useAuthSubmit("/api/auth/login", (me) => {
    if (me.user.must_change_password) navigate({ to: "/change-password" });
    else navigate({ to: search.next && search.next.startsWith("/") ? search.next : "/" });
  });
  return (
    <AuthLayout title="Sign in" subtitle="Use the email and password your workspace owner gave you.">
      <form className="grid gap-4" onSubmit={(e) => submit(formValues(e))} noValidate>
        <Field label="Email" name="email" type="email" required autoComplete="username" error={fields.email} />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" error={fields.password} />
        <FormError message={error} />
        <Button type="submit" size="lg" loading={busy} className="mt-1">
          {!busy ? <SignInIcon size={17} weight="bold" /> : null} Sign in
        </Button>
        <p className="text-center text-[12.5px] text-muted">Forgot your password? Ask an admin or your manager to reset it.</p>
      </form>
    </AuthLayout>
  );
}

export function ChangePasswordPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const forced = me.user.must_change_password;
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [mismatch, setMismatch] = useState<string | undefined>();
  const { busy, error, fields, submit } = useAuthSubmit("/api/auth/change-password", () => {
    toast.success("Password updated. Other devices were signed out.");
    navigate({ to: "/" });
  });
  return (
    <AuthLayout
      title={forced ? "Choose your own password" : "Change password"}
      subtitle={forced ? "You signed in with a temporary password. Replace it to continue." : "Every other device will be signed out."}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          const v = formValues(e);
          if (v.new_password !== v.confirm) {
            setMismatch("The two new passwords do not match.");
            return;
          }
          setMismatch(undefined);
          submit({ current_password: v.current_password, new_password: v.new_password });
        }}
      >
        <Field label={forced ? "Temporary password" : "Current password"} name="current_password" type="password" required autoComplete="current-password" error={fields.current_password} />
        <Field label="New password" name="new_password" type="password" required autoComplete="new-password" hint="At least 10 characters." error={fields.new_password} />
        <Field label="Repeat new password" name="confirm" type="password" required autoComplete="new-password" error={mismatch} />
        <FormError message={error} />
        <Button type="submit" size="lg" loading={busy} className="mt-1">
          Save password
        </Button>
        {forced ? (
          <Button type="button" variant="ghost" onClick={signOut}>
            Sign out instead
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={() => navigate({ to: "/" })}>
            Cancel
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
