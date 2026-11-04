// Website connectors (Fauzan, 31 Oct 2026: all six approved). The API fetches from each outside service with its own
// read-only key and hands Prima one feed; Prima matches it to the register here. Nothing outside Prima is changed,
// nothing in the register is overwritten (a different expiry date is flagged, not copied), and every connector is off
// until its key is set and IT has switched it on.

import type { Id, IsoDate, IsoDateTime } from './types';

export type ConnectorKey = 'cloudflare' | 'github' | 'uptime' | 'registrar' | 'maildns' | 'm365' | 'sharepoint';

/** One connector's answer: its data, or why it could not be read. A failure never clears what Prima already holds. */
export type ConnectorResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface CfProject {
  name: string;
  /** Custom domains and the pages.dev address. */
  domains: string[];
  latest: { at: IsoDateTime; status: string; url: string; branch: string; commit: string } | null;
}
export interface DnsRecord {
  type: string;
  name: string;
  content: string;
}
export interface CfZone {
  name: string;
  records: DnsRecord[];
}
export interface GhRepo {
  name: string;
  url: string;
  pushedAt: IsoDateTime | null;
  branch: string;
  lastCommit: { sha: string; at: IsoDateTime; message: string } | null;
}
export interface UpMonitor {
  url: string;
  status: 'up' | 'down' | 'paused' | 'unknown';
  since: IsoDateTime | null;
  sslExpiresOn: IsoDate | null;
}
export interface RegistrarDomain {
  name: string;
  expiresOn: IsoDate | null;
  registrar: string;
}
/** A row from the IT department's SharePoint list "Website requests": an instruction, a proposal or a change. */
export interface SpRequest {
  id: string;
  kind: 'instruction' | 'proposal' | 'change';
  title: string;
  detail: string;
  siteUrl: string;
  requestedBy: string;
  at: IsoDateTime;
  link: string;
}

export interface WebFeed {
  at: IsoDateTime;
  cloudflare?: ConnectorResult<{ projects: CfProject[]; zones: CfZone[] }>;
  github?: ConnectorResult<{ repos: GhRepo[] }>;
  uptime?: ConnectorResult<{ monitors: UpMonitor[] }>;
  registrar?: ConnectorResult<{ domains: RegistrarDomain[] }>;
  sharepoint?: ConnectorResult<{ requests: SpRequest[] }>;
  /** Public DNS answers for each domain's email records (SPF, DMARC, DKIM selectors, MX). */
  maildns?: ConnectorResult<{ domains: { name: string; spf: string | null; dmarc: string | null; dkim: boolean; mx: string[] }[] }>;
}

/** What Prima last saw for a website (never typed in by hand). */
export interface SiteObserved {
  cloudflare?: { project: string; latest: CfProject['latest']; at: IsoDateTime };
  github?: { repo: string; url: string; pushedAt: IsoDateTime | null; lastCommit: GhRepo['lastCommit']; at: IsoDateTime };
  uptime?: { status: UpMonitor['status']; since: IsoDateTime | null; sslExpiresOn: IsoDate | null; at: IsoDateTime };
}

/** What Prima last saw for a domain. The DNS baseline is the last record set IT accepted or an approved change made. */
export interface DomainObserved {
  dns?: { fingerprint: string; count: number; at: IsoDateTime };
  dnsBaseline?: { fingerprint: string; at: IsoDateTime; by: string };
  registrar?: { expiresOn: IsoDate | null; registrar: string; at: IsoDateTime };
}

export interface ConnectorState {
  lastSync: IsoDateTime | null;
  ok: boolean | null;
  error: string;
  matched: number;
  /** Items the service has that the register does not (for example a Cloudflare project with no website record). */
  unmatched: string[];
}

export interface SpInboxItem extends SpRequest {
  state: 'new' | 'accepted' | 'declined';
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  note: string;
  issueId: Id | null;
}

export const CONNECTOR_INFO: Record<ConnectorKey, { name: string; reads: string; manual: string }> = {
  cloudflare: { name: 'Cloudflare', reads: 'Pages projects, latest deployment, DNS records (read-only token)', manual: 'Hosting and publication are recorded by hand' },
  github: { name: 'GitHub', reads: 'Website repositories and latest commit (read-only)', manual: 'Preview links and versions are recorded by hand' },
  uptime: { name: 'Uptime monitor (UptimeRobot)', reads: 'Up or down and certificate expiry for each monitor (read-only key)', manual: 'Monthly checks are confirmed by a person' },
  registrar: { name: 'Domain expiry (public RDAP)', reads: 'Registry expiry date per domain; no account or key', manual: 'Expiry dates and renewals are recorded by hand' },
  maildns: { name: 'Email DNS check (public DNS)', reads: 'SPF, DKIM, DMARC and MX records of each domain; no account or key', manual: 'Email health is recorded by hand' },
  m365: { name: 'Microsoft 365 email and Teams', reads: 'Sends Prima notices by email (from the IT notices mailbox) and to the IT Teams channel', manual: 'Notices show inside Prima only' },
  sharepoint: { name: 'SharePoint list "Website requests"', reads: 'IT instructions, proposals and change requests, read-only', manual: 'Requests are raised in Prima by hand' },
};

export function hostOf(url: string): string {
  const s = url.trim().toLowerCase();
  if (!s) return '';
  try {
    return new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Order-free fingerprint of a DNS record set (FNV-1a), so a change made outside Prima shows up. */
export function dnsFingerprint(records: DnsRecord[]): string {
  const text = records
    .map((r) => `${r.type.toUpperCase()} ${r.name.toLowerCase().replace(/\.$/, '')} ${r.content.trim().toLowerCase()}`)
    .sort()
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
