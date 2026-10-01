import { MonitorIcon, MoonIcon, PlusIcon, SignOutIcon, SunIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { usePalette, useTheme } from "@/lib/stores";
import { ALL_NAV } from "@/nav";

import { useSignOut } from "@/lib/use-sign-out";

function Item({ onSelect, icon, children, hint }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-default items-center gap-3 rounded-sm px-3 py-2.5 text-[13.5px] data-[selected=true]:bg-surface-2"
    >
      <span className="text-muted [&_svg]:size-[18px]">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint ? <span className="text-[11.5px] text-muted">{hint}</span> : null}
    </Command.Item>
  );
}

export function CommandPalette() {
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-[12dvh] left-1/2 z-50 w-[min(94vw,36rem)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[dialog-in_160ms_cubic-bezier(0.16,1,0.3,1)]">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command label="Command palette" loop>
            <Command.Input
              autoFocus
              placeholder="Jump to a page or run an action…"
              className="h-12 w-full border-b border-border bg-transparent px-4 text-[14px] outline-none placeholder:text-muted"
            />
            <Command.List className="max-h-[60dvh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">
                Nothing matches that.
              </Command.Empty>
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-muted">
                {ALL_NAV.map((n) => {
                  const IconCmp = n.icon;
                  return (
                    <Item key={n.to} icon={<IconCmp />} hint={n.phase} onSelect={() => run(() => navigate({ to: n.to }))}>
                      {n.label}
                    </Item>
                  );
                })}
              </Command.Group>
              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-muted">
                <Item icon={<PlusIcon />} onSelect={() => run(() => navigate({ to: "/organization", search: { new: 1 } }))}>
                  New branch
                </Item>
                <Item icon={<UserPlusIcon />} onSelect={() => run(() => navigate({ to: "/settings/members", search: { add: 1 } }))}>
                  Add member
                </Item>
                <Item icon={<SunIcon />} onSelect={() => run(() => setTheme("light"))}>Light theme</Item>
                <Item icon={<MoonIcon />} onSelect={() => run(() => setTheme("dark"))}>Dark theme</Item>
                <Item icon={<MonitorIcon />} onSelect={() => run(() => setTheme("system"))}>Match system theme</Item>
                <Item icon={<SignOutIcon />} onSelect={() => run(signOut)}>Sign out</Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
