/** P58: send chosen sites (ePerolehan by default) through one of the company's computers, so
 * the site sees the office's own internet line, like staff logging in themselves, instead of
 * this server's address. The agents' browsers still run on the server; the computer only
 * relays the site's encrypted traffic, and only if its own person allowed it there. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { setTunnel, tunnelSettingsQuery } from "@/lib/devices";

const covers = (allows: string[], hosts: string[]) =>
  hosts.every((h) => allows.some((a) => h === a || h.endsWith(`.${a}`)));

export function TunnelDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery(tunnelSettingsQuery);
  const [on, setOn] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [sites, setSites] = useState("eperolehan.gov.my");
  const [fallback, setFallback] = useState<"wait" | "direct" | "proxy">("wait");
  const [show, setShow] = useState(true);
  const [seeded, setSeeded] = useState(false);
  if (q.data && !seeded) {
    setSeeded(true);
    setOn(q.data.on);
    setDeviceId(q.data.device_id || q.data.computers[0]?.id || "");
    setSites(q.data.hosts.join(", "));
    setFallback(q.data.fallback);
    setShow(q.data.show);
  }
  const hosts = sites.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => setTunnel({ on, device_id: deviceId, hosts, fallback, show }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["org", "computers"] }); toast.success(t("Saved.")); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const computers = q.data?.computers ?? [];
  const chosen = computers.find((c) => c.id === deviceId);
  const allowed = chosen ? covers(chosen.allows, hosts) : false;
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Send ePerolehan through a company computer")}
      description={t("The site then sees your office's own internet line, like your staff logging in themselves, not this server's address. The AI's browser still runs on the server; the computer only passes the site's encrypted traffic along and cannot read it.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} disabled={on && !deviceId} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-4">
        <SwitchField checked={on} onCheckedChange={setOn} label={t("Send these sites through a company computer")}
          hint={t("Off: they go out from the server, as before.")} />
        {computers.length ? (
          <Select value={deviceId} onValueChange={setDeviceId} label={t("Through this computer")} disabled={!on}
            options={computers.map((c) => ({
              value: c.id,
              label: c.name,
              hint: [c.online ? t("Online") : t("Offline"), c.paused ? t("Paused") : null, c.allows.length ? t("allows {sites}", { sites: c.allows.join(", ") }) : t("not allowed on it yet")].filter(Boolean).join(" · "),
            }))} />
        ) : (
          <p className="rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px]">{t("No company computer is linked yet. Link one from My computers first.")}</p>
        )}
        <SwitchField checked={show} onCheckedChange={setShow} disabled={!on} label={t("Show the work on that computer's screen")}
          hint={show
            ? t("Work on these sites opens a browser window on that computer, so the person there watches every step. One task at a time, like a person.")
            : t("The AI works in its own browser on the server; only the traffic goes through the computer.")} />
        <Field label={t("Sites")} value={sites} onChange={(e) => setSites(e.target.value)} disabled={!on}
          hint={t("The site and its subdomains, separated by commas. Everything else goes out from the server as usual.")} />
        {on && chosen ? (
          allowed ? (
            <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted"><Pill tone="ok">{t("Allowed on {name}", { name: chosen.name })}</Pill>{chosen.online ? null : t("It is offline right now.")}</p>
          ) : (
            <div className="grid gap-1 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px]">
              <span className="font-medium">{t("The person at {name} must allow it on that computer once:", { name: chosen.name })}</span>
              <code className="w-fit rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[12px]">agentic-pc tunnel on {hosts.join(" ")}</code>
              <span className="text-muted">{t("Nothing passes through a computer until its own person turns this on. They can turn it off any time.")}</span>
            </div>
          )
        ) : null}
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("When that computer is off or offline")}</span>
          <Segmented label={t("When that computer is off or offline")} value={fallback} onChange={(v) => setFallback(v as "wait" | "direct" | "proxy")}
            options={[{ value: "wait", label: t("Wait for it") }, { value: "proxy", label: t("Use the proxies") }, { value: "direct", label: t("Go from the server") }]}
            className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center" />
          <span className="text-[12px] text-muted">{fallback === "wait" ? t("The AI tells you the computer is unavailable instead of using the server's address.") : fallback === "proxy" ? t("The AI carries on through the company's proxies (Web connections) until the computer is back.") : t("The AI carries on from the server's address until the computer is back.")}</span>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
