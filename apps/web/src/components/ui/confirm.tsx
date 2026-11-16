import { useState, type ReactNode } from "react";

import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";

import { Button } from "./button";
import { ResponsiveDialog } from "./dialog";
import { FormError } from "./field";

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Throwing keeps the dialog open and shows the error's message inside it (P107). */
  onConfirm: () => Promise<void> | void;
}

/** In-page confirmation (never window.confirm). Stays open and busy until the action settles;
 * a failed action says why inside the dialog, so it can be tried again or cancelled. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
}: ConfirmProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A fresh opening starts without the last attempt's error.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setError(null);
  }
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="text-[13.5px] text-muted">{body}</div>
        <FormError message={error} />
      </div>
    </ResponsiveDialog>
  );
}
