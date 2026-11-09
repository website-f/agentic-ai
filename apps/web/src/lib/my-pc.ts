/** P92: ePerolehan work runs on the person's OWN linked computer. Before it starts, the web asks
 * GET /api/devices/my-pc-status whether that computer is ready, and shows the next step in plain
 * words (link it, turn it on, press Allow, update the app). Starting waits until it is ready. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export type PcState = "ready" | "offline" | "not_allowed" | "not_linked" | "needs_update" | "paused";

export interface MyPcStatus {
  state: PcState;
  /** False when the site does not go through a computer at all (then it is always ready). */
  needed: boolean;
  site: string;
  /** The computer it is about: the ready one, else the one to act on. */
  device: { id: string; name: string; last_seen_at: string | null; version: string | null } | null;
  /** The Allow request was just sent to that computer. */
  asked?: boolean;
  /** The next step in plain words, in the person's language. */
  next: string;
}

/** The sites whose work always runs on the person's own computer. */
export const PC_SITES = ["eperolehan.gov.my"] as const;
export const EPEROLEHAN_SITE = PC_SITES[0];

/** Under "devices", so a computer coming online or allowing a site (lib/live.ts) refreshes it. */
export const myPcKeys = { status: (site: string) => ["devices", "my-pc", site] as const };

export const myPcStatus = (site: string) => api<MyPcStatus>(`/api/devices/my-pc-status?site=${encodeURIComponent(site)}`);
export const askMyPc = (site: string) =>
  api<{ asked: boolean; online: boolean; device?: { id: string; name: string } }>("/api/devices/my-pc-status/ask", "POST", { site });

/** Every 5 s while the person is waiting on their computer, every 30 s once it is ready. */
export const myPcStatusQuery = (site: string, enabled = true) =>
  queryOptions({
    queryKey: myPcKeys.status(site),
    queryFn: () => myPcStatus(site),
    enabled: enabled && !!site,
    refetchInterval: (q) => (q.state.data?.state === "ready" || !q.state.data?.needed ? 30_000 : 5_000),
    retry: false,
  });

/** The site a link goes to that needs the person's own computer ("eperolehan.gov.my"), or null. */
export function pcSiteOf(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  let host = "";
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  return PC_SITES.find((s) => host === s || host.endsWith(`.${s}`)) ?? null;
}

/** Whether work may start: nothing needed, or the computer is ready. */
export function pcReady(s: MyPcStatus | null | undefined): boolean {
  return !!s && (!s.needed || s.state === "ready");
}

/** Green when ready, red when there is no computer yet, amber for everything in between. */
export function pcTone(state: PcState): "ok" | "warn" | "bad" {
  return state === "ready" ? "ok" : state === "not_linked" ? "bad" : "warn";
}
