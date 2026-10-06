import { DropdownMenu } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  className,
  align = "end",
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          // A long menu scrolls inside the room left on screen instead of running off the edge.
          "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[var(--radix-dropdown-menu-content-available-width)] min-w-48",
          "overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-[var(--shadow-pop)]",
          "data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  className,
  danger,
  icon,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & { danger?: boolean; icon?: ReactNode }) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] outline-none select-none",
        "data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50",
        danger ? "text-danger" : "text-fg",
        className,
      )}
      {...props}
    >
      {icon ? <span className="text-muted [&_svg]:size-4">{icon}</span> : null}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2.5 pt-2 pb-1 text-[12px] font-medium text-muted">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border" />;
}

export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        "flex cursor-default items-center justify-between gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] outline-none select-none",
        "data-[highlighted]:bg-surface-2 data-[state=checked]:text-accent data-[state=checked]:font-medium",
        className,
      )}
      {...props}
    >
      {children}
      <DropdownMenu.ItemIndicator>
        <span aria-hidden className="block size-1.5 rounded-full bg-accent" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}
