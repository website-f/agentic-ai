/** P62 Settings > Web connections: ONE choice for how the AI's browsers reach websites —
 * browse through a company computer (the office's own internet line: the default since P69, so
 * ePerolehan never sees the server's address), browse from here (this server), or use the company's proxies (a pasted Webshare list) — and for which
 * sites. The chosen way is used or the site is refused with why; it never quietly falls back to
 * the server's address. Choosing a computer asks its person there (Allow / Not now on the
 * Agentic Office page that opens on it): no command line. "Check" opens a site once the way the
 * agents' browsers would and says what the site answered. */
import {
  ArrowRightIcon, CheckCircleIcon, CloudIcon, DesktopTowerIcon, PlugsIcon, ShieldWarningIcon, WarningCircleIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  askComputer, checkWeb, setWebRoute, testProxies, webRouteQuery,
  type ProxyTest, type WebCheck, type WebComputer, type WebMode,
} from "@/lib/devices";
import { cn } from "@/lib/utils";

const EPEROLEHAN = "eperolehan.gov.my";
const covers = (allows: string[], sites: string[]) =>
  sites.every((h) => allows.some((a) => h === a || h.endsWith(`.${a}`)));
const parseSites = (text: string) => [...new Set(text.split(/[\s,]+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean))];

function Choice({ on, icon: IconCmp, title, body, onPick }: { on: boolean; icon: Icon; title: string; body: string; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick}
      className={cn(
        "flex min-h-24 min-w-0 items-start gap-3 rounded-[var(--radius-md)] border p-4 text-left transition-colors",
        on ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30" : "border-border bg-surface hover:border-accent/40",
      )}>
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", on ? "border-accent" : "border-border")}>
        {on ? <span className="size-2.5 rounded-full bg-accent" /> : null}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="flex items-center gap-2 text-[14.5px] font-semibold"><IconCmp size={18} weight="duotone" className="shrink-0 text-accent" /> {title}</span>
        <span className="text-[12.5px] text-muted">{body}</span>
      </span>
    </button>
  );
}

/** A computer's state for these sites, in words. */
function ComputerState({ c, sites }: { c: WebComputer; sites: string[] }) {
  const t = useT();
  const pills: ReactNode[] = [
    <Pill key="on" tone={c.online ? "ok" : "neutral"}>{c.online ? t("Online") : t("Offline")}</Pill>,
  ];
  if (c.paused) pills.push(<Pill key="p" tone="warn">{t("Paused")}</Pill>);
  if (covers(c.allows, sites)) pills.push(<Pill key="a" tone="ok">{t("Allowed")}</Pill>);
  else if (!c.can_ask) pills.push(<Pill key="u" tone="warn">{t("Needs the new app")}</Pill>);
  else pills.push(<Pill key="w" tone="warn">{t("Waiting for OK on that computer")}</Pill>);
  return <span className="flex flex-wrap items-center gap-1.5">{pills}</span>;
}

function CheckResult({ r, computer }: { r: WebCheck; computer?: WebComputer }) {
  const t = useT();
  const name = r.computer || computer?.name || t("the company computer");
  const way = r.way === "pc" ? (r.screen ? t("in the browser on {name}, over its own internet line", { name }) : t("through {name}", { name }))
    : r.way === "proxy" ? t("through the proxy {via}", { via: r.via ?? "" })
      : t("from this server");
  if (r.way === "refuse") {
    return (
      <p className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[13px]">
        <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-warn" />
        <span>{t("Not opened: {why}.", { why: r.why })}</span>
      </p>
    );
  }
  const tone = r.error || r.blocked ? "border-danger/30 bg-danger/8" : r.maintenance ? "border-warn/30 bg-warn/8" : "border-ok/30 bg-ok/8";
  return (
    <div className={cn("grid gap-1.5 rounded-sm border px-3 py-2.5 text-[13px]", tone)}>
      <span className="text-muted">{t("{site} went {way}.", { site: r.site, way })}{r.proxy_ip ? ` ${t("Sites see {ip} through it.", { ip: r.proxy_ip })}` : ""}</span>
      {r.error ? (
        <span className="flex items-start gap-2 font-medium text-danger"><WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0" /> {t("Could not reach the site: {error}", { error: r.error })}</span>
      ) : r.blocked ? (
        <span className="flex items-start gap-2 font-medium text-danger">
          <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0" />
          {r.seen_ip ? t("The site refused it ({status}). It saw the address {ip}.", { status: r.status ?? 0, ip: r.seen_ip }) : t("The site refused it ({status}).", { status: r.status ?? 0 })}
        </span>
      ) : r.maintenance ? (
        <span className="flex items-start gap-2 font-medium text-warn">
          <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0" />
          {t("Reached {site}, but it is down for its own maintenance right now ({status}). Not a block: the connection works. Try again later.", { site: r.site, status: r.status ?? 0 })}
        </span>
      ) : r.ok ? (
        <span className="flex items-start gap-2 font-medium text-ok"><CheckCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0" /> {t("The site opened ({status}).", { status: r.status ?? 0 })}</span>
      ) : (
        <span className="font-medium">{t("The site answered {status}.", { status: r.status ?? 0 })}</span>
      )}
      {r.says ? <span className="text-[12px] text-muted">“{r.says}”</span> : null}
      {r.blocked && r.way !== "pc" ? (
        <span className="text-[12.5px]">{r.way === "proxy"
          ? t("The site refuses this proxy's address too. Browse through a computer uses your office's own internet line, the way your staff reach the site.")
          : t("The site refuses this server's address. Browse through a computer uses your office's own internet line, the way your staff reach the site.")}</span>
      ) : null}
    </div>
  );
}

export function WebConnectionsPage() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery(webRouteQuery);
  const [mode, setMode] = useState<WebMode>("server");
  const [every, setEvery] = useState<"some" | "all">("some");
  const [sites, setSites] = useState(EPEROLEHAN);
  const [deviceId, setDeviceId] = useState("");
  const [show, setShow] = useState(true);
  const [list, setList] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [tests, setTests] = useState<Record<string, ProxyTest>>({});
  const [checkSite, setCheckSite] = useState("");
  const [result, setResult] = useState<WebCheck | null>(null);
  const data = q.data;
  if (data && !seeded) {
    setSeeded(true);
    setMode(data.mode);
    const all = data.sites.includes("*");
    setEvery(all && data.mode === "proxy" ? "all" : "some");
    setSites(all ? EPEROLEHAN : data.sites.join(", "));
    setDeviceId(data.device_id || data.computers.find((c) => c.online)?.id || data.computers[0]?.id || "");
    setShow(data.show);
  }

  const siteList = mode === "proxy" && every === "all" ? ["*"] : parseSites(sites);
  const computers = data?.computers ?? [];
  const chosen = computers.find((c) => c.id === deviceId);
  const saved = data && data.mode === mode && (mode === "server"
    || (JSON.stringify(data.sites) === JSON.stringify(siteList) && (mode !== "pc" || (data.device_id === deviceId && data.show === show)) && !list.trim()));
  const missing = mode === "pc" ? (!deviceId ? t("Choose a computer.") : !siteList.length ? t("List at least one site.") : "")
    : mode === "proxy" ? (!data?.proxies.length && !list.trim() ? t("Paste your proxy list first.") : !siteList.length ? t("List at least one site.") : "")
      : "";

  const save = useMutation({
    mutationFn: () => setWebRoute({ mode, sites: siteList, device_id: mode === "pc" ? deviceId : data?.device_id ?? "", show, ...(list.trim() ? { proxy_list: list } : {}) }),
    onSuccess: (r) => {
      qc.setQueryData(webRouteQuery.queryKey, r);
      setList("");
      setResult(null);
      const c = r.computers.find((x) => x.id === r.device_id);
      if (r.mode === "pc" && c && !covers(c.allows, r.sites)) {
        toast.success(r.asked
          ? t("Saved. We asked {name}: someone at that computer presses Allow on the Agentic Office page that just opened there.", { name: c.name })
          : t("Saved. {name} is offline: it asks the person there as soon as it is back on.", { name: c.name }));
      } else {
        toast.success(t("Saved. New connections use it now."));
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ask = useMutation({
    mutationFn: askComputer,
    onSuccess: (r) => (r.asked ? toast.success(t("Asked again. The Agentic Office page opens on that computer.")) : toast.error(t("That computer is offline. It asks as soon as it is back on."))),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: testProxies,
    onSuccess: (r) => setTests(Object.fromEntries(r.results.map((x) => [x.key, x]))),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const check = useMutation({
    // P84: the way chosen above, saved or not (new proxies are tried once saved).
    mutationFn: () => checkWeb(parseSites(checkSite)[0] ?? "", { mode, sites: siteList, device_id: deviceId, show }),
    onSuccess: setResult,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const working = Object.values(tests).filter((x) => x.ok).length;
  const sitesHint = t("The site and its subdomains, separated by commas. Every other site goes from this server.");

  return (
    <Page>
      <PageHeader title={t("Web connections")}
        description={t("How the AI's browser reaches websites. Pick one way; a change applies to the next page it opens.")} />

      <Section title={t("How the AI browses")}>
        {q.isLoading ? <Skeleton className="h-28" /> : q.error ? <p role="alert" className="text-danger">{errorMessage(q.error)}</p> : (
          <div className="grid gap-5">
            <div role="radiogroup" aria-label={t("How the AI browses")} className="grid gap-2.5 lg:grid-cols-3">
              <Choice on={mode === "pc"} icon={DesktopTowerIcon} title={t("Browse through a computer")} onPick={() => setMode("pc")}
                body={t("The default. Through your own linked PC, so ePerolehan sees your office's home or office internet line, not a server. Link your PC on Staff computers, then press Allow on it.")} />
              <Choice on={mode === "server"} icon={CloudIcon} title={t("Browse from here")} onPick={() => setMode("server")}
                body={t("From the office server. Government portals such as ePerolehan may refuse its address.")} />
              <Choice on={mode === "proxy"} icon={PlugsIcon} title={t("Use your proxies")} onPick={() => setMode("proxy")}
                body={t("Through your proxy provider, such as Webshare.")} />
            </div>

            {mode === "pc" ? (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <span className="text-[13px] font-medium">{t("Which computer")}</span>
                  {computers.length ? (
                    <div role="radiogroup" aria-label={t("Which computer")} className="grid gap-2">
                      {computers.map((c) => {
                        const on = c.id === deviceId;
                        return (
                          <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => setDeviceId(c.id)}
                            className={cn("flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-left",
                              on ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30" : "border-border bg-surface hover:border-accent/40")}>
                            <DesktopTowerIcon size={18} weight={on ? "fill" : "duotone"} className="shrink-0 text-accent" />
                            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{c.name}</span>
                            <ComputerState c={c} sites={siteList} />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2.5 text-[13px]">
                      <span>{t("No company computer is linked yet. On the computer you want to use, open this app, go to My computers and press Link a computer, then run the downloaded file.")}</span>
                      <Button asChild size="sm" variant="outline" className="w-fit"><Link to="/computers">{t("Open My computers")} <ArrowRightIcon size={13} /></Link></Button>
                    </div>
                  )}
                  {chosen && !covers(chosen.allows, siteList) ? (
                    <div className="grid gap-2 rounded-sm border border-accent/25 bg-accent-soft/40 px-3 py-2.5 text-[13px]">
                      {chosen.can_ask ? (
                        <>
                          <span>{t("When you save, {name} shows a page asking to allow these sites. Someone at that computer presses Allow once. Nothing goes through a computer until its person says yes.", { name: chosen.name })}</span>
                          {data?.mode === "pc" && data.device_id === chosen.id ? (
                            <Button size="sm" variant="outline" className="w-fit" loading={ask.isPending} onClick={() => ask.mutate()}>{t("Ask that computer again")}</Button>
                          ) : null}
                        </>
                      ) : (
                        <span>{t("{name} has an older Agentic Office app. On that computer, open My computers, download the app again and run it: the new one asks with an Allow button.", { name: chosen.name })}</span>
                      )}
                    </div>
                  ) : null}
                </div>
                <SwitchField checked={show} onCheckedChange={setShow} label={t("Show the AI's work on that computer's screen")}
                  hint={show
                    ? t("Work on these sites opens a browser window on that computer, so the person there watches every step. One task at a time, like a person.")
                    : t("The AI works in its own browser on the server; only the traffic goes through the computer.")} />
                <Field label={t("Sites")} value={sites} onChange={(e) => setSites(e.target.value)} placeholder={EPEROLEHAN} hint={sitesHint} />
              </div>
            ) : null}

            {mode === "proxy" ? (
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <span className="text-[13px] font-medium">{t("Use them for")}</span>
                  <Segmented label={t("Use them for")} value={every} onChange={(v) => setEvery(v as "some" | "all")}
                    options={[{ value: "some", label: t("Only these sites") }, { value: "all", label: t("Every website") }]}
                    className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center" />
                  {every === "some" ? <Field label={t("Sites")} value={sites} onChange={(e) => setSites(e.target.value)} placeholder={EPEROLEHAN} hint={sitesHint} /> : null}
                </div>
                <TextareaField label={data?.proxies.length ? t("Replace the list") : t("Proxy list")} value={list} onChange={(e) => setList(e.target.value)} rows={5}
                  placeholder={"45.38.0.1:6014:username:password\nhttp://username:password@p.example.com:80"}
                  hint={data?.proxies.length
                    ? t("Leave it empty to keep the {n} saved proxies.", { n: data.proxies.length })
                    : t("Paste the list from your proxy provider: one per line, host:port:user:password. It is stored encrypted; the passwords are never shown again.")} />
                {data?.proxies.length ? (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{t("{n} proxies saved", { n: data.proxies.length })}</span>
                      <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>{t("Test them")}</Button>
                      {Object.keys(tests).length ? <span className="text-[12.5px] text-muted">{t("{ok} of {n} answered.", { ok: working, n: Object.keys(tests).length })}</span> : null}
                    </div>
                    <ul className="grid gap-1.5">
                      {data.proxies.map((p) => {
                        const r = tests[p.key];
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
                  </div>
                ) : null}
                {data && !data.proxies_approved ? (
                  <p className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px]">
                    <ShieldWarningIcon size={15} className="mt-0.5 shrink-0 text-warn" />
                    <span>{t("The approved-services lock is on and the proxies are not approved yet, so sites using them are refused until you approve Web proxies.")} <Link to="/approved-services" className="font-medium text-accent hover:underline">{t("Open Approved services")}</Link></span>
                  </p>
                ) : null}
                <p className="flex items-start gap-2 text-[12.5px] text-muted">
                  <ShieldWarningIcon size={15} className="mt-0.5 shrink-0" />
                  <span>{t("A proxy provider can see which sites are visited and when (the pages themselves stay encrypted).")}</span>
                </p>
              </div>
            ) : null}

            <p className="text-[12.5px] text-muted">
              {mode === "server"
                ? t("Every site goes from this server.")
                : t("If the chosen way is unavailable (the computer offline, the proxies not answering), the AI stops and tells you why. It never quietly uses this server's address instead.")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={save.isPending} disabled={!!missing || !!saved} onClick={() => save.mutate()}>{t("Save")}</Button>
              {missing ? <span className="text-[12.5px] text-muted">{missing}</span> : saved ? <span className="text-[12.5px] text-muted">{t("This is what the AI uses now.")}</span> : null}
            </div>
          </div>
        )}
      </Section>

      <Section title={t("Check the connection")} description={t("Opens a site once, the way the AI's browser would, and shows which way it went and what the site answered.")}>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); check.mutate(); }}>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("Site")} value={checkSite} onChange={(e) => setCheckSite(e.target.value)} placeholder={siteList.find((s) => s !== "*") ?? EPEROLEHAN} className="min-w-0 flex-1 sm:max-w-sm" />
            <Button type="submit" variant="outline" loading={check.isPending}>{t("Check")}</Button>
          </div>
          {!saved && data ? <span className="text-[12px] text-muted">{list.trim() ? t("Checks the way chosen above. New proxies are tried once saved.") : t("Checks the way chosen above, saved or not.")}</span> : null}
          {result ? <CheckResult r={result} computer={computers.find((c) => c.id === (mode === "pc" ? deviceId : data?.device_id))} /> : null}
        </form>
      </Section>
    </Page>
  );
}
