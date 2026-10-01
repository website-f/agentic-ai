import { ArrowRightIcon, KeyIcon, MonitorIcon, MoonIcon, SunIcon, UsersIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";

import { Page, PageHeader, Section } from "@/components/page";
import { Pill } from "@/components/ui/pill";
import { meQuery } from "@/lib/queries";
import { useTheme, type ThemePref } from "@/lib/stores";
import { cn } from "@/lib/utils";

const THEMES: { value: ThemePref; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "Match system", icon: MonitorIcon },
];

function LinkRow({ to, icon: IconCmp, title, body }: { to: string; icon: typeof SunIcon; title: string; body: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2/60 sm:px-5">
      <IconCmp size={20} className="text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted">{body}</span>
      </span>
      <ArrowRightIcon size={15} className="text-muted" />
    </Link>
  );
}

export function SettingsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { pref, setPref } = useTheme();
  return (
    <Page className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="grid gap-8">
        <Section title="Workspace">
          <dl className="grid gap-x-6 gap-y-3 rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4 sm:grid-cols-3">
            <div><dt className="text-[12.5px] text-muted">Name</dt><dd className="text-[13.5px] font-medium">{me.workspace.name}</dd></div>
            <div><dt className="text-[12.5px] text-muted">Time zone</dt><dd className="text-[13.5px] font-medium">{me.workspace.timezone}</dd></div>
            <div><dt className="text-[12.5px] text-muted">Your role</dt><dd><Pill tone="accent" className="capitalize">{me.role}</Pill></dd></div>
          </dl>
        </Section>

        <Section title="People and account">
          <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            <LinkRow to="/settings/members" icon={UsersIcon} title="Members and roles" body="Add teammates and decide what each one can do." />
            <LinkRow to="/change-password" icon={KeyIcon} title="Change password" body="Signs out your other devices." />
          </div>
        </Section>

        <Section title="Appearance" description="Saved on this device.">
          <RadioGroup.Root value={pref} onValueChange={(v) => setPref(v as ThemePref)} className="grid grid-cols-3 gap-3" aria-label="Theme">
            {THEMES.map(({ value, label, icon: IconCmp }) => (
              <RadioGroup.Item
                key={value}
                value={value}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-[var(--radius-md)] border px-3 py-4 text-[13px] transition-colors",
                  pref === value ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface hover:bg-surface-2",
                )}
              >
                <IconCmp size={22} weight={pref === value ? "fill" : "regular"} />
                {label}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        </Section>
      </div>
    </Page>
  );
}
