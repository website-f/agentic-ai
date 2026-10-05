/** P26: keep anything on My workspace (pin) or take it off, from wherever it is shown. */
import { PushPinIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { deskKeys, pinItem, pinsQuery, unpinItem, type PinKind } from "@/lib/desk";
import { cn } from "@/lib/utils";

import { Button } from "./ui/button";

export function PinButton({
  kind,
  refId,
  title = "",
  withLabel = false,
  className,
}: {
  kind: PinKind;
  refId: string;
  title?: string;
  /** Show "Pin to my workspace" / "On my workspace" next to the pin. */
  withLabel?: boolean;
  className?: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: pins = [] } = useQuery(pinsQuery);
  const pin = pins.find((p) => p.kind === kind && p.ref === refId);
  const toggle = useMutation({
    mutationFn: async (): Promise<void> => {
      if (pin) await unpinItem(pin.id);
      else await pinItem(kind, refId, title);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      toast.success(pin ? t("Taken off your workspace.") : t("Pinned to your workspace."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const label = pin ? t("On my workspace (unpin)") : t("Pin to my workspace");
  return (
    <Button
      type="button"
      variant="ghost"
      size={withLabel ? "sm" : "icon-sm"}
      title={label}
      aria-label={label}
      aria-pressed={!!pin}
      loading={toggle.isPending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggle.mutate();
      }}
      className={cn(pin && "text-accent hover:text-accent", className)}
    >
      <PushPinIcon size={15} weight={pin ? "fill" : "regular"} />
      {withLabel ? <span>{pin ? t("On my workspace") : t("Pin to my workspace")}</span> : null}
    </Button>
  );
}
