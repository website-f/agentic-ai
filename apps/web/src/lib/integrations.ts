import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

/** Channels (Telegram, WhatsApp) and the Google/Gmail sign-in: types and queries. */

export type WaStatus =
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "FAILED"
  | "STOPPED"
  | "MISSING"
  | "UNREACHABLE"
  | "UNKNOWN";

export interface ChannelLinkOut {
  id: string;
  user_id: string;
  user_name: string;
  display: string;
  created_at: string;
}

export interface ChannelOut {
  id: string;
  kind: "telegram" | "whatsapp";
  name: string;
  enabled: boolean;
  bot_username: string | null;
  /** WhatsApp only. */
  provider?: "waha" | "meta" | null;
  /** WhatsApp only: the office number, digits only, once known. */
  number?: string | null;
  /** WhatsApp only: last known session status. */
  status?: WaStatus | null;
  last_error: string | null;
  links: ChannelLinkOut[];
  linked: boolean;
  bindings: { id: string; match: string; agent_id: string; agent_name: string }[];
  created_at?: string;
}

export interface WhatsAppStatus {
  id: string;
  name: string;
  enabled: boolean;
  provider: "waha" | "meta";
  status: WaStatus;
  number: string | null;
  display?: string | null;
  /** data:image/png;base64 URL while waiting for a scan (managers only). */
  qr: string | null;
  error?: string;
  // managers only
  webhook_url?: string;
  verify_token?: string;
  template?: string;
  base_url?: string;
  session?: string;
}

export interface LinkCode {
  code: string;
  url: string | null;
  expires_in: number;
}

export interface GoogleAccount {
  email: string;
  status: "connected" | "error";
  last_error: string | null;
  connected_at: string;
  can_send: boolean;
  /** Granted calendar access (connections made before it was asked for were not). */
  calendar?: boolean;
}

export interface GoogleStatus {
  configured: boolean;
  redirect_uri: string;
  can_configure: boolean;
  account: GoogleAccount | null;
}

export const integrationKeys = {
  channels: ["channels"] as const,
  whatsapp: (id: string) => ["whatsapp", id] as const,
  google: ["integrations", "google"] as const,
};

/** Session states where WAHA is still coming up or waiting for the phone: worth polling. */
export const WA_WAITING: WaStatus[] = ["STARTING", "SCAN_QR_CODE"];

export const channelsQuery = queryOptions({
  queryKey: integrationKeys.channels,
  queryFn: () => api<ChannelOut[]>("/api/channels"),
});

export const whatsappStatusQuery = (id: string) =>
  queryOptions({
    queryKey: integrationKeys.whatsapp(id),
    queryFn: () => api<WhatsAppStatus>(`/api/channels/${id}/whatsapp`),
    // WAHA rotates the QR every ~20s; poll while it is starting or waiting for a scan only.
    // (React Query pauses interval refetches while the tab is hidden.)
    refetchInterval: (q) => (q.state.data && WA_WAITING.includes(q.state.data.status) ? 4_000 : false),
    refetchIntervalInBackground: false,
  });

export const googleQuery = queryOptions({
  queryKey: integrationKeys.google,
  queryFn: () => api<GoogleStatus>("/api/integrations/google"),
});

/** "60123456789" -> "+60123456789" (null when unknown). */
export function waNumber(digits: string | null | undefined): string | null {
  return digits ? `+${digits}` : null;
}
