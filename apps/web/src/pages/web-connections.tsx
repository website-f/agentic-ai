/** P60 Settings > Web connections: the three ways the agents' browsers reach websites: this
 * server (always), a company computer (the office's own line, for chosen sites), and the
 * company's own proxies (a pasted list). Changes apply to the next connection at once. */
import {
  CheckCircleIcon, CloudIcon, DesktopTowerIcon, PlugsIcon, ShieldWarningIcon, WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  proxySettingsQuery, setProxies, testProxies, tunnelSettingsQuery, type ProxyTest,
} from "@/lib/devices";
import { TunnelDialog } from "@/pages/computers/tunnel-dialog";

const card = "grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4";

export function WebConnectionsPage() {
  const t = useT();
  const qc = useQueryClient();
  const tunnel = useQuery(tunnelSettingsQuery);
  const proxies = useQuery(proxySettingsQuery);
  const [tunnelOpen, setTunnelOpen] = useState(false);
  const [list, setList] = useState("");
  const [every, setEvery] = useState<"all" | "some">("all");
  const [sites, setSites] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [results, setResults] = useState<Record<string, ProxyTest>>({});
  if (proxies.data && !seeded) {
    setSeeded(true);
    const all = proxies.data.sites.includes("*");
    setEvery(all ? "all" : "some");
    setSites(all ? "" : proxies.data.sites.join(", "));
  }
  const siteList = every === "all" ? ["*"] : sites.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const save = useMutation({
    mutationFn: (body: { on: boolean; list?: string }) => setProxies({ ...body, sites: siteList }),
    onSuccess: (r) => {
      qc.setQueryData(proxySettingsQuery.queryKey, r);
      setList("");
      toast.success(r.on ? t("Saved. New connections use it now.") : t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: testProxies,
    onSuccess: (r) => setResults(Object.fromEntries(r.results.map((x) => [x.key, x]))),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const tun = tunnel.data;
  const px = proxies.data;
  const computer = tun?.computers.find((c) => c.id === tun.device_id);
  const working = Object.values(results).filter((r) => r.ok).length;

  return (
    <Page>
      <PageHeader title={t("Web connections")}
        description={t("How the AI's browsers reach websites: from this server, through a company computer (your office's own internet line), or through your own proxies. A change applies to the next connection straight away.")} />

      <Section title={t("The three ways out")}>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={card}>
            <span className="flex items-center gap-2 text-[14px] font-semibold"><CloudIcon size={18} weight="duotone" className="text-accent" /> {t("This server")}</span>
            <p className="text-[12.5px] text-muted">{t("Every site that is not sent another way. Always available.")}</p>
            <Pill tone="ok" className="w-fit">{t("Always on")}</Pill>
          </div>
          <div className={card}>
            <span className="flex items-center gap-2 text-[14px] font-semibold"><DesktopTowerIcon size={18} weight="duotone" className="text-accent" /> {t("Company computer")}</span>
            {tunnel.isLoading ? <Skeleton className="h-10" /> : tun?.on ? (
              <p className="text-[12.5px] text-muted">{t("{sites} through {name}", { sites: tun.hosts.join(", "), name: computer?.name ?? t("a removed computer") })}{computer && !computer.online ? ` · ${t("offline now")}` : ""}</p>
            ) : (
              <p className="text-[12.5px] text-muted">{t("Off. Sites such as ePerolehan can go through your office's own line.")}</p>
            )}
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setTunnelOpen(true)}>{t("Set up")}</Button>
          </div>
          <div className={card}>
            <span className="flex items-center gap-2 text-[14px] font-semibold"><PlugsIcon size={18} weight="duotone" className="text-accent" /> {t("Your proxies")}</span>
            {proxies.isLoading ? <Skeleton className="h-10" /> : (
              <p className="text-[12.5px] text-muted">
                {px?.on ? t("On: {n} proxies for {which}", { n: px.proxies.length, which: px.sites.includes("*") ? t("every other site") : px.sites.join(", ") }) : px?.proxies.length ? t("Off: {n} proxies saved", { n: px.proxies.length }) : t("None saved yet.")}
              </p>
            )}
          </div>
        </div>
        <p className="text-[12.5px] text-muted">
          {t("How a site is chosen: the company computer's sites go through it; then, with proxies on, their sites go through your proxies; everything else goes from this server. A way out that is down (the computer offline, a proxy not answering) hands over to the next; a site that refuses or blocks a request is never moved elsewhere.")}
        </p>
      </Section>

      <Section title={t("Your proxies")} description={t("Paste the list from your proxy provider (for example Webshare): one per line, host:port:user:password, or a proxy address. It is stored encrypted; the passwords are never shown again.")}>
        {proxies.isLoading ? <Skeleton className="h-40" /> : (
          <div className="grid gap-4">
            <SwitchField checked={!!px?.on} disabled={save.isPending} onCheckedChange={(on) => save.mutate({ on })}
              label={px?.on ? t("Proxies on") : t("Proxies off")}
              hint={t("Each site keeps one proxy, so it sees one steady address; a proxy that stops answering is set aside for 10 minutes and the next one is used.")} />
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Which sites")}</span>
              <Segmented label={t("Which sites")} value={every} onChange={(v) => setEvery(v as "all" | "some")}
                options={[{ value: "all", label: t("Every other site") }, { value: "some", label: t("Only these sites") }]}
                className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center" />
              {every === "some" ? (
                <TextareaField label={t("Sites")} value={sites} onChange={(e) => setSites(e.target.value)} rows={2} placeholder="example.com, another.com" />
              ) : null}
            </div>
            <TextareaField label={px?.proxies.length ? t("Replace the list") : t("Proxy list")} value={list} onChange={(e) => setList(e.target.value)} rows={6}
              placeholder={"45.38.0.1:6014:username:password\nhttp://username:password@p.example.com:80"}
              hint={px?.proxies.length ? t("Leave it empty to keep the {n} saved proxies.", { n: px.proxies.length }) : undefined} />
            <div className="flex flex-wrap gap-2">
              <Button loading={save.isPending} onClick={() => save.mutate({ on: !!px?.on || !!list.trim(), ...(list.trim() ? { list } : {}) })}>{t("Save")}</Button>
              {px?.proxies.length ? <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}>{t("Test them")}</Button> : null}
            </div>
            {px?.proxies.length ? (
              <ul className="grid gap-1.5">
                {px.proxies.map((p) => {
                  const r = results[p.key];
                  return (
                    <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border bg-surface px-3 py-2 text-[13px]">
                      <span className="font-mono">{p.host}:{p.port}</span>
                      <span className="text-muted">{p.user}</span>
                      {r ? (r.ok ? (
                        <span className="ml-auto inline-flex items-center gap-1 text-ok"><CheckCircleIcon size={14} weight="fill" /> {t("Sites see {ip}", { ip: r.ip })} · {r.ms} ms</span>
                      ) : (
                        <span className="ml-auto inline-flex items-center gap-1 text-danger"><WarningCircleIcon size={14} weight="fill" /> {t("Not answering")} ({r.error || "?"})</span>
                      )) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {Object.keys(results).length ? <p className="text-[12.5px] text-muted">{t("{ok} of {n} answered.", { ok: working, n: Object.keys(results).length })}</p> : null}
            <p className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px]">
              <ShieldWarningIcon size={15} className="mt-0.5 shrink-0 text-warn" />
              <span>{t("A proxy provider can see which sites are visited and when (the pages themselves stay encrypted). If a client's agreement lists approved services, approve it on Approved services first.")}</span>
            </p>
          </div>
        )}
      </Section>
      {tunnelOpen ? <TunnelDialog onClose={() => { setTunnelOpen(false); void qc.invalidateQueries({ queryKey: tunnelSettingsQuery.queryKey }); }} /> : null}
    </Page>
  );
}
