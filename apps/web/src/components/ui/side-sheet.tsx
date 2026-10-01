import { XIcon } from "@phosphor-icons/react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { Drawer } from "vaul";

import { useIsPhone } from "@/lib/use-media";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** Detail panel: docked right on tablet/desktop, a tall bottom sheet on phones. */
export function SideSheet({ open, onOpenChange, title, description, actions, children }: Props) {
  const phone = useIsPhone();
  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" />
            <div className="shrink-0 border-b border-border px-5 pt-3 pb-3">
              <Drawer.Title className="text-base font-semibold">{title}</Drawer.Title>
              {description ? <Drawer.Description asChild><div className="mt-1 text-[13px] text-muted">{description}</div></Drawer.Description> : null}
              {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,40rem)] flex-col border-l border-border bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[sheet-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
          <div className="shrink-0 border-b border-border px-6 pt-5 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Dialog.Title className="text-[17px] font-semibold">{title}</Dialog.Title>
                {description ? <Dialog.Description asChild><div className="mt-1 text-[13px] text-muted">{description}</div></Dialog.Description> : null}
              </div>
              <Dialog.Close className="-mr-2 rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
                <XIcon size={18} />
              </Dialog.Close>
            </div>
            {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
