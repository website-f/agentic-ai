import { XIcon } from "@phosphor-icons/react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { Drawer } from "vaul";

import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { fitWidth, SHEET_BODY } from "./fit-width";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Centered dialog on tablet/desktop, a bottom sheet on phones. Same content, same API. */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: ResponsiveDialogProps) {
  const phone = useIsPhone();

  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content
            ref={fitWidth}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] max-w-[100vw] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border" />
            <div className="min-w-0 px-5 pt-3 pb-2 break-words">
              <Drawer.Title className="text-base font-semibold">{title}</Drawer.Title>
              {description ? (
                <Drawer.Description className="mt-1 text-[13px] text-muted">
                  {description}
                </Drawer.Description>
              ) : null}
            </div>
            <div data-sheet-body className={cn(SHEET_BODY, "px-5 pb-4")}>{children}</div>
            {footer ? (
              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-3">{footer}</div>
            ) : null}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <Dialog.Content
          ref={fitWidth}
          className={cn(
            // Capped height with a fixed header and footer: a long form scrolls its body,
            // so Save/Cancel are always reachable. The width is a starting point: the dialog
            // widens to fit content that cannot wrap and never scrolls sideways (see fit-width).
            "fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-pop)] outline-none",
            "data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.16,1,0.3,1)]",
            className,
          )}
        >
          <div className="flex min-w-0 shrink-0 items-start justify-between gap-4 pt-5 pr-4 pl-6">
            <div className="min-w-0 flex-1 break-words">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[13px] text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              className="shrink-0 rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Close"
            >
              <XIcon size={18} />
            </Dialog.Close>
          </div>
          <div data-sheet-body className={cn(SHEET_BODY, "px-6 py-4")}>{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-6 py-3.5">{footer}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
