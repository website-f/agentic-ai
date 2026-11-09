/** P57: two-step sign-in. The setup (secret + first code), the recovery codes shown once, the
 * card in Settings, the owner's company rule, and the members-page badge and reset. */
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CopyIcon,
  DownloadSimpleIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Label, RadioGroup } from "radix-ui";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { saveFile } from "@/lib/native";
import { keys, meQuery } from "@/lib/queries";
import {
  codesFile,
  confirmSetup,
  disableTwoFactor,
  groupSecret,
  regenerateCodes,
  resetMemberTwoFactor,
  setPolicy,
  startSetup,
  twoFactorKeys,
  twoFactorMembersQuery,
  twoFactorQuery,
  type TwoFactorPolicy,
} from "@/lib/two-factor";
import type { Member } from "@/lib/types";
import { cn } from "@/lib/utils";

/** One box for the 6-digit code: numeric keypad on phones, the SMS/app autofill hint, and a
 * paste of "123 456" or "123-456" lands as 123456. Calls onComplete at the sixth digit. */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  error,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  label: string;
  error?: string | null;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label.Root htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </Label.Root>
      <Input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={!!error}
        placeholder="000000"
        value={value}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(digits);
          if (digits.length === 6 && digits !== value) onComplete?.(digits);
        }}
        className="h-12 text-center font-mono text-[22px] tracking-[0.35em] tabular-nums"
      />
    </div>
  );
}

/** A recovery code box: letters, any case, dashes optional. */
export function RecoveryInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <Field
      label={label}
      name="recovery_code"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      autoFocus={autoFocus}
      placeholder="abcd-efgh-jkmn"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="[&_input]:h-12 [&_input]:font-mono [&_input]:text-[16px]"
    />
  );
}

async function copyText(text: string, done: string, blocked: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(blocked);
  }
}

/** The ten one-time codes, shown once, with Copy and Download. */
export function RecoveryCodes({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const t = useT();
  // P96: the browser's download, or the share sheet in the phone app.
  const download = () => void saveFile(codesFile(codes, email, t("Agentic Office recovery codes")), "agentic-recovery-codes.txt");
  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-2.5 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2.5 text-[13px]">
        <ShieldWarningIcon size={18} className="mt-0.5 shrink-0 text-warn" />
        <p>{t("Save these recovery codes now. They are shown only once. Each one signs you in one time if you lose your phone.")}</p>
      </div>
      <ol className="grid grid-cols-2 gap-2 rounded-sm border border-border bg-surface-2 p-3 font-mono text-[14px] tabular-nums sm:gap-x-6">
        {codes.map((c) => (
          <li key={c} className="text-center break-all select-all">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => copyText(codes.join("\n"), t("Copied."), t("Copy blocked by the browser. Select the codes and copy them by hand."))}>
          <CopyIcon size={16} /> {t("Copy")}
        </Button>
        <Button variant="outline" onClick={download}>
          <DownloadSimpleIcon size={16} /> {t("Download")}
        </Button>
        <Button className="ml-auto max-sm:w-full" onClick={onDone}>
          <CheckCircleIcon size={16} weight="bold" /> {t("I saved them")}
        </Button>
      </div>
    </div>
  );
}

/** Set up: a new secret for the authenticator app, then the first code turns it on, then the
 * recovery codes. Used in Settings and on the "your company requires it" screen. */
export function TwoFactorSetup({ email, onDone, onCancel }: { email: string; onDone: () => void; onCancel?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const start = useMutation({ mutationFn: startSetup, onError: (e) => setError(errorMessage(e)) });
  const confirm = useMutation({
    mutationFn: (c: string) => confirmSetup(c),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setCodes(r.recovery_codes);
      qc.invalidateQueries({ queryKey: twoFactorKeys.status });
      qc.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => {
      setError(errorMessage(e));
      setCode("");
    },
  });

  if (codes) return <RecoveryCodes codes={codes} email={email} onDone={onDone} />;

  const setup = start.data;
  if (!setup) {
    return (
      <div className="grid gap-3">
        <p className="text-[13.5px] text-muted">
          {t("You need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password. Each sign-in then asks for the 6-digit code it shows.")}
        </p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => start.mutate()} loading={start.isPending}>
            <ShieldCheckIcon size={16} weight="bold" /> {t("Set up two-step sign-in")}
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              {t("Cancel")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (code.length === 6 && !confirm.isPending) confirm.mutate(code);
  };
  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <ol className="grid gap-3 text-[13.5px]">
        <li className="grid gap-2">
          <span>
            <span className="font-medium">1.</span> {t("On this phone, open the link in your authenticator app. On a computer, add an account in the app and type this key:")}
          </span>
          <Button asChild variant="outline" className="justify-self-start">
            <a href={setup.uri}>
              <ArrowSquareOutIcon size={16} /> {t("Open in authenticator app")}
            </a>
          </Button>
          <div className="flex min-w-0 items-center gap-2 rounded-sm border border-border bg-surface-2 p-1.5 pl-3">
            <code className="min-w-0 flex-1 font-mono text-[14px] tracking-wide break-all select-all">{groupSecret(setup.secret)}</code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => copyText(setup.secret, t("Copied."), t("Copy blocked by the browser. Select the key and copy it by hand."))}
            >
              <CopyIcon size={15} /> {t("Copy")}
            </Button>
          </div>
          <span className="text-[12.5px] text-muted">{t("Account: {email}. Type: time-based.", { email })}</span>
        </li>
        <li>
          <span className="font-medium">2.</span> {t("Type the 6-digit code the app shows.")}
        </li>
      </ol>
      <CodeInput label={t("6-digit code")} value={code} onChange={setCode} onComplete={(c) => confirm.mutate(c)} disabled={confirm.isPending} error={error} />
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={confirm.isPending} disabled={code.length !== 6}>
          {t("Turn on")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function NewCodesDialog({ open, onOpenChange, email }: { open: boolean; onOpenChange: (o: boolean) => void; email: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const run = useMutation({
    mutationFn: (c: string) => regenerateCodes(c),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setCodes(r.recovery_codes);
      qc.invalidateQueries({ queryKey: twoFactorKeys.status });
    },
    onError: (e) => {
      setError(errorMessage(e));
      setCode("");
    },
  });
  const close = () => {
    onOpenChange(false);
    setCodes(null);
    setCode("");
    setError(null);
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={t("New recovery codes")}
      description={codes ? undefined : t("Your old recovery codes stop working. Type a code from your app to continue.")}
    >
      {codes ? (
        <RecoveryCodes codes={codes} email={email} onDone={close} />
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) run.mutate(code);
          }}
        >
          <CodeInput label={t("6-digit code")} value={code} onChange={setCode} onComplete={(c) => run.mutate(c)} autoFocus error={error} disabled={run.isPending} />
          <FormError message={error} />
          <Button type="submit" loading={run.isPending} disabled={code.length !== 6}>
            {t("Make new codes")}
          </Button>
        </form>
      )}
    </ResponsiveDialog>
  );
}

function TurnOffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => disableTwoFactor(useRecovery ? { password, recovery_code: recovery } : { password, code }),
    onMutate: () => setError(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: twoFactorKeys.status });
      qc.invalidateQueries({ queryKey: keys.me });
      toast.success(t("Two-step sign-in is off."));
      onOpenChange(false);
      setPassword("");
      setCode("");
      setRecovery("");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const ready = password.length > 0 && (useRecovery ? recovery.trim().length > 0 : code.length === 6);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Turn off two-step sign-in?")}
      description={t("Signing in will need only your password. If your company requires two-step sign-in, you will be asked to set it up again.")}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) run.mutate();
        }}
      >
        <Field label={t("Password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {useRecovery ? (
          <RecoveryInput label={t("Recovery code")} value={recovery} onChange={setRecovery} />
        ) : (
          <CodeInput label={t("6-digit code")} value={code} onChange={setCode} />
        )}
        <button type="button" className="justify-self-start text-[13px] text-accent hover:underline" onClick={() => setUseRecovery((v) => !v)}>
          {useRecovery ? t("Use a code from your app instead") : t("Use a recovery code instead")}
        </button>
        <FormError message={error} />
        <Button type="submit" variant="danger" loading={run.isPending} disabled={!ready}>
          {t("Turn off")}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}

const POLICIES: { value: TwoFactorPolicy; label: string; hint: string }[] = [
  { value: "off", label: msg("Off"), hint: msg("Each person decides for themselves.") },
  { value: "admins", label: msg("Owners and admins"), hint: msg("Recommended. Everyone who can change the whole workspace: owners, admins, management and HR.") },
  { value: "everyone", label: msg("Everyone"), hint: msg("Every member, before they can use the app.") },
];

/** Owners only: who in the company must use two-step sign-in. */
function RequireTwoFactor() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: twoFactorKeys.policy, queryFn: () => api<{ require_2fa: TwoFactorPolicy }>("/api/auth/2fa/policy") });
  const save = useMutation({
    mutationFn: setPolicy,
    onSuccess: (r) => {
      qc.setQueryData(twoFactorKeys.policy, r);
      qc.invalidateQueries({ queryKey: twoFactorKeys.status });
      qc.invalidateQueries({ queryKey: twoFactorKeys.members });
      toast.success(t("Saved. People it covers are asked to set it up the next time they use the app."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const value = save.isPending && save.variables ? save.variables : data?.require_2fa;
  return (
    <Card>
      <CardHeader title={t("Require two-step sign-in")} description={t("For the company: who must use a code from their phone to sign in.")} />
      <CardBody>
        {!data ? (
          <Skeleton className="h-20 rounded-[var(--radius-md)]" />
        ) : (
          <RadioGroup.Root
            value={value}
            onValueChange={(v) => save.mutate(v as TwoFactorPolicy)}
            disabled={save.isPending}
            aria-label={t("Require two-step sign-in")}
            className="grid gap-2 sm:grid-cols-3"
          >
            {POLICIES.map((p) => {
              const on = value === p.value;
              return (
                <RadioGroup.Item
                  key={p.value}
                  value={p.value}
                  className={cn(
                    "relative grid min-w-0 content-start gap-0.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors",
                    on ? "border-accent bg-accent-soft ring-2 ring-accent/15" : "border-border bg-surface hover:bg-surface-2",
                  )}
                >
                  {on ? <CheckCircleIcon size={16} weight="fill" className="absolute top-2.5 right-2.5 text-accent" aria-hidden /> : null}
                  <span className={cn("pr-5 text-[13.5px] font-medium", on && "text-accent")}>{t(p.label)}</span>
                  <span className="text-[12px] text-muted">{t(p.hint)}</span>
                </RadioGroup.Item>
              );
            })}
          </RadioGroup.Root>
        )}
      </CardBody>
    </Card>
  );
}

/** Settings: the person's own two-step sign-in, and for owners the company rule. */
export function TwoFactorSettings() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: st, error } = useQuery(twoFactorQuery);
  const [settingUp, setSettingUp] = useState(false);
  const [newCodes, setNewCodes] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader
          title={t("Two-step sign-in")}
          description={t("A 6-digit code from your phone at every sign-in, so a stolen password is not enough.")}
          icon={<IconTile icon={ShieldCheckIcon} size="sm" tone={st?.enabled ? "ok" : "neutral"} />}
          actions={st ? st.enabled ? <Pill tone="ok">{t("On")}</Pill> : <Pill tone={st.required ? "warn" : "neutral"}>{t("Off")}</Pill> : null}
        />
        <CardBody>
          {error ? (
            <FormError message={errorMessage(error)} />
          ) : !st ? (
            <Skeleton className="h-16 rounded-[var(--radius-md)]" />
          ) : st.enabled ? (
            <div className="grid gap-3">
              <p className="text-[13.5px] text-muted">
                {st.enabled_at ? t("On since {date}.", { date: fmt(st.enabled_at) }) : null}{" "}
                {st.recovery_codes_left === 1 ? t("1 recovery code left.") : t("{n} recovery codes left.", { n: st.recovery_codes_left })}
              </p>
              {st.recovery_codes_left <= 3 ? <p className="text-[13px] text-warn">{t("Few recovery codes left. Make new ones.")}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setNewCodes(true)}>
                  {t("New recovery codes")}
                </Button>
                <Button variant="ghost" onClick={() => setTurningOff(true)}>
                  {t("Turn off")}
                </Button>
              </div>
            </div>
          ) : settingUp ? (
            <TwoFactorSetup email={me.user.email} onDone={() => setSettingUp(false)} onCancel={() => setSettingUp(false)} />
          ) : (
            <div className="grid gap-3">
              {st.required ? <p className="text-[13px] text-warn">{t("Your company requires two-step sign-in for your role.")}</p> : null}
              <p className="text-[13.5px] text-muted">{t("Use an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.")}</p>
              <Button className="justify-self-start" onClick={() => setSettingUp(true)}>
                <ShieldCheckIcon size={16} weight="bold" /> {t("Set up")}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
      {me.role === "owner" ? <RequireTwoFactor /> : null}
      <NewCodesDialog open={newCodes} onOpenChange={setNewCodes} email={me.user.email} />
      <TurnOffDialog open={turningOff} onOpenChange={setTurningOff} />
    </div>
  );
}

/** Members page: whether this person has two-step sign-in on (owners and admins see it). */
export function TwoFactorPill({ userId, enabled }: { userId: string; enabled: boolean }) {
  const t = useT();
  const { data } = useQuery({ ...twoFactorMembersQuery, enabled });
  const row = data?.find((m) => m.user_id === userId);
  if (!row) return null;
  if (row.enabled) return <Pill tone="ok">{t("Two-step on")}</Pill>;
  return row.required ? <Pill tone="warn">{t("Two-step not set up")}</Pill> : null;
}

/** Members page, owners only: turn off a member's two-step sign-in (a lost phone). */
export function ResetTwoFactorDialog({ member, open, onOpenChange }: { member: Pick<Member, "user_id" | "name">; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Reset two-step sign-in for {name}?", { name: member.name })}
      body={t("For a lost or new phone. Their two-step sign-in and recovery codes are removed and they are signed out everywhere. They sign in with their password, then set it up again if the company requires it.")}
      confirmLabel={t("Reset")}
      danger
      onConfirm={async () => {
        try {
          await resetMemberTwoFactor(member.user_id);
          qc.invalidateQueries({ queryKey: twoFactorKeys.members });
          toast.success(t("Two-step sign-in reset for {name}.", { name: member.name }));
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }}
    />
  );
}

/** For the members menu: does this member have two-step sign-in on? */
export function useMemberTwoFactor(userId: string, enabled: boolean): boolean {
  const { data } = useQuery({ ...twoFactorMembersQuery, enabled });
  return !!data?.find((m) => m.user_id === userId)?.enabled;
}
