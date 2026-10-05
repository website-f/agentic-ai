import { ArrowElbowDownLeftIcon, ArrowsDownUpIcon, MagnifyingGlassIcon, MonitorIcon, MoonIcon, PlusIcon, SignOutIcon, SunIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { useT } from "@/i18n";
import { usePalette, useTheme } from "@/lib/stores";
import { NAV } from "@/nav";

import { useSignOut } from "@/lib/use-sign-out";

const GROUP =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase";

function Item({ onSelect, icon, children, hint, value }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: string; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group flex min-h-10 cursor-default items-center gap-3 rounded-sm px-2.5 py-2 text-[13.5px] data-[selected=true]:bg-surface-2"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-muted ring-1 ring-border/60 group-data-[selected=true]:bg-accent-soft group-data-[selected=true]:text-accent group-data-[selected=true]:ring-accent/15 [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[11px] text-muted">{hint}</span> : null}
      <ArrowElbowDownLeftIcon size={14} className="hidden shrink-0 text-muted group-data-[selected=true]:block max-sm:!hidden" aria-hidden />
    </Command.Item>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-border bg-surface px-1 font-sans text-[11px] text-muted">{children}</kbd>;
}

export function CommandPalette() {
  const t = useT();
  const { open, setOpen } = usePalette();
  const navigate = useNavigate();
  const setTheme = useTheme((s) => s.setPref);
  const signOut = useSignOut();

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-[10dvh] left-1/2 z-50 w-[min(calc(100vw-1.5rem),38rem)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[dialog-in_160ms_cubic-bezier(0.16,1,0.3,1)]">
          <Dialog.Title className="sr-only">{t("Command palette")}</Dialog.Title>
          <Dialog.Description className="sr-only">{t("Jump to a page or run an action.")}</Dialog.Description>
          <Command label={t("Command palette")} loop>
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <MagnifyingGlassIcon size={18} className="shrink-0 text-muted" aria-hidden />
              <Command.Input
                autoFocus
                placeholder={t("Jump to a page or run an action…")}
                className="h-13 w-full min-w-0 bg-transparent text-[14.5px] outline-none placeholder:text-muted"
              />
              <span className="max-sm:hidden"><Key>Esc</Key></span>
            </div>
            <Command.List className="max-h-[min(60dvh,28rem)] overflow-y-auto overscroll-contain p-2">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">
                {t("Nothing matches that.")}
              </Command.Empty>
              {NAV.map((section) => (
                <Command.Group key={section.title} heading={t(section.title)} className={GROUP}>
                  {section.items.map((n) => {
                    const IconCmp = n.icon;
                    return (
                      <Item key={n.to} value={`${t(section.title)} ${t(n.label)} ${section.title} ${n.label} ${n.to}`} icon={<IconCmp weight="duotone" />} hint={n.phase} onSelect={() => run(() => navigate({ to: n.to }))}>
                        {t(n.label)}
                      </Item>
                    );
                  })}
                </Command.Group>
              ))}
              <Command.Group heading={t("Actions")} className={GROUP}>
                <Item icon={<PlusIcon />} onSelect={() => run(() => navigate({ to: "/organization", search: { new: 1 } }))}>
                  {t("New branch")}
                </Item>
                <Item icon={<UserPlusIcon />} onSelect={() => run(() => navigate({ to: "/settings/members", search: { add: 1 } }))}>
                  {t("Add member")}
                </Item>
                <Item icon={<SunIcon />} onSelect={() => run(() => setTheme("light"))}>{t("Light theme")}</Item>
                <Item icon={<MoonIcon />} onSelect={() => run(() => setTheme("dark"))}>{t("Dark theme")}</Item>
                <Item icon={<MonitorIcon />} onSelect={() => run(() => setTheme("system"))}>{t("Match system theme")}</Item>
                <Item icon={<SignOutIcon />} onSelect={() => run(signOut)}>{t("Sign out")}</Item>
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border bg-surface-2/40 px-4 py-2 text-[11.5px] text-muted max-sm:hidden">
              <span className="flex items-center gap-1.5"><Key><ArrowsDownUpIcon size={11} /></Key> {t("Move")}</span>
              <span className="flex items-center gap-1.5"><Key><ArrowElbowDownLeftIcon size={11} /></Key> {t("Open|verb")}</span>
              <span className="ml-auto flex items-center gap-1.5"><Key>Ctrl</Key><Key>K</Key> {t("Toggle")}</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
