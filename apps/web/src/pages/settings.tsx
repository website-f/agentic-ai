import { ArrowRightIcon, BuildingOfficeIcon, CheckCircleIcon, KeyIcon, MonitorIcon, MoonIcon, SunIcon, UsersIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";

import { IconTile, Page, PageHeader, Section, type Tone } from "@/components/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { meQuery } from "@/lib/queries";
import { ROLE_INFO } from "@/lib/types";
import { useTheme, type ThemePref } from "@/lib/stores";
import { cn, initials } from "@/lib/utils";

const THEMES: { value: ThemePref; label: string; hint: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", hint: "Bright surfaces", icon: SunIcon },
  { value: "dark", label: "Dark", hint: "Easy at night", icon: MoonIcon },
  { value: "system", label: "Match system", hint: "Follows this device", icon: MonitorIcon },
];

function LinkRow({ to, icon, tone, title, body }: { to: string; icon: typeof SunIcon; tone: Tone; title: string; body: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60 sm:px-5">
      <IconTile icon={icon} tone={tone} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted">{body}</span>
      </span>
      <ArrowRightIcon size={15} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
    </Link>
  );
}

export function SettingsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { pref, setPref } = useTheme();
  const role = ROLE_INFO[me.role];
  return (
    <Page className="max-w-3xl">
      <PageHeader title="Settings" description="Your account, this workspace, and how the app looks on this device." />

      <Card>
        <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft text-[15px] font-semibold text-accent ring-1 ring-accent/15">
            {initials(me.user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold break-words">{me.user.name}</p>
            <p className="text-[13px] break-all text-muted">{me.user.email}</p>
          </div>
          <div className="grid justify-items-start gap-1 sm:justify-items-end">
            <Pill tone="accent">{role?.label ?? me.role}</Pill>
            {me.scope && me.scope.kind !== "all" && me.scope.label ? <span className="text-[12px] text-muted">{me.scope.label}</span> : null}
          </div>
        </div>
        {role ? <p className="border-t border-border bg-surface-2/30 px-4 py-2.5 text-[12.5px] text-muted sm:px-5">{role.blurb}</p> : null}
      </Card>

      <Card>
        <CardHeader title="Workspace" icon={<IconTile icon={BuildingOfficeIcon} size="sm" />} />
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-3 sm:px-5">
          <div className="min-w-0">
            <dt className="text-[12.5px] text-muted">Name</dt>
            <dd className="text-[13.5px] font-medium break-words">{me.workspace.name}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12.5px] text-muted">Time zone</dt>
            <dd className="text-[13.5px] font-medium break-words">{me.workspace.timezone.replace(/_/g, " ")}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12.5px] text-muted">Handle</dt>
            <dd className="font-mono text-[13px] break-all">{me.workspace.slug}</dd>
          </div>
        </dl>
      </Card>

      <Section title="People and account">
        <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
          <LinkRow to="/settings/members" icon={UsersIcon} tone="info" title="Members and roles" body="Add teammates and decide what each one can do." />
          <LinkRow to="/change-password" icon={KeyIcon} tone="warn" title="Change password" body="Signs out your other devices." />
        </div>
      </Section>

      <Section title="Appearance" description="Saved on this device.">
        <RadioGroup.Root value={pref} onValueChange={(v) => setPref(v as ThemePref)} className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Theme">
          {THEMES.map(({ value, label, hint, icon: IconCmp }) => {
            const on = pref === value;
            return (
              <RadioGroup.Item
                key={value}
                value={value}
                className={cn(
                  "relative flex min-w-0 flex-col items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-4 text-center text-[13px] transition-colors",
                  on ? "border-accent bg-accent-soft text-accent ring-2 ring-accent/15" : "border-border bg-surface hover:bg-surface-2",
                )}
              >
                {on ? <CheckCircleIcon size={16} weight="fill" className="absolute top-2 right-2" aria-hidden /> : null}
                <IconCmp size={22} weight={on ? "fill" : "regular"} />
                <span className="font-medium">{label}</span>
                <span className={cn("text-[11.5px] max-sm:hidden", on ? "text-accent/80" : "text-muted")}>{hint}</span>
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      </Section>
    </Page>
  );
}
