import { XIcon } from "@phosphor-icons/react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { Drawer } from "vaul";

import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { fitWidth, SHEET_BODY } from "./fit-width";

/**
 * Starting width on tablet/desktop. It is a starting point, not a limit: the sheet widens to fit
 * content that cannot wrap (up to 72rem, never past the viewport) and never scrolls sideways.
 */
export type SheetSize = "sm" | "md" | "lg" | "xl";
const SIZE: Record<SheetSize, string> = {
  sm: "w-[min(100vw,28rem)]",
  md: "w-[min(100vw,40rem)]",
  lg: "w-[min(100vw,52rem)]",
  xl: "w-[min(100vw,64rem)]",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Starting width on tablet/desktop (default `md`). */
  size?: SheetSize;
  /** Shorthand for `size="lg"` (e.g. to show an agent's live browser). */
  wide?: boolean;
}

/** Detail panel: docked right on tablet/desktop, a tall bottom sheet on phones. */
export function SideSheet({ open, onOpenChange, title, description, actions, children, size, wide }: Props) {
  const phone = useIsPhone();
  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content
            ref={fitWidth}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] max-w-[100vw] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" />
            <div className="min-w-0 shrink-0 border-b border-border px-5 pt-3 pb-3 break-words">
              <Drawer.Title className="text-base font-semibold">{title}</Drawer.Title>
              {description ? <Drawer.Description asChild><div className="mt-1 text-[13px] text-muted">{description}</div></Drawer.Description> : null}
              {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
            </div>
            <div data-sheet-body className={cn(SHEET_BODY, "px-5 py-4")}>{children}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <Dialog.Content
          ref={fitWidth}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex max-w-[100vw] flex-col border-l border-border bg-surface shadow-[var(--shadow-pop)] outline-none",
            "data-[state=open]:animate-[sheet-in_220ms_cubic-bezier(0.16,1,0.3,1)]",
            SIZE[size ?? (wide ? "lg" : "md")],
          )}
        >
          <div className="min-w-0 shrink-0 border-b border-border pt-5 pr-4 pb-4 pl-6 break-words">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-[17px] font-semibold">{title}</Dialog.Title>
                {description ? <Dialog.Description asChild><div className="mt-1 text-[13px] text-muted">{description}</div></Dialog.Description> : null}
              </div>
              <Dialog.Close className="shrink-0 rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
                <XIcon size={18} />
              </Dialog.Close>
            </div>
            {actions ? <div className="mt-3 flex flex-wrap gap-2 pr-2">{actions}</div> : null}
          </div>
          <div data-sheet-body className={cn(SHEET_BODY, "px-6 py-5")}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
