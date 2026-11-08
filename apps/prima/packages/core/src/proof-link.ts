
/**
 * SharePoint files as proof, by link (Fauzan, 4 Nov 2026, staff usability rule 6: "SharePoint files by link, no
 * copies"). Staff paste the link of a file that already sits in their department's or company's SharePoint; Prima keeps
 * only the cleaned link, the file name and who gave it. Prima never downloads, copies, reads or shares the file, and
 * never contacts Microsoft to record a link. Opening the link happens in the person's own browser, where Microsoft
 * checks again whether that person may see the file.
 *
 * Parse only: no DNS, no network, no SharePoint call. A link that passes is a well-formed pointer to a file in a
 * SharePoint site, not proof that the file exists or that anyone can open it.
 */

/** Marks a proof record that is a link to a file kept in SharePoint, not a stored file. */
export const PROOF_LINK_MIME = 'text/uri-list' as const;

export interface ProofLink {
  /** Cleaned link: https, the SharePoint host, the file's path; no sharing token, no tracking values. */
  url: string;
  host: string;
  /** The file name taken from the link, for the list on screen. */
  name: string;
}

export type ProofLinkResult = { ok: true; link: ProofLink } | { ok: false; reason: string };

const HOST = /^[a-z0-9][a-z0-9-]{0,62}\.sharepoint\.com$/;
const GUID = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i;
const BAD_CHARS = /[\\\u0000-\u001f\u007f]/;

export const PROOF_LINK_REASONS = {
  format: 'Paste the SharePoint link of the file (it starts with https:// and has sharepoint.com in it).',
  personal: 'This link is in a personal OneDrive. Save the file in the department or company SharePoint and paste that link.',
  host: 'This link is not in the group SharePoint. Paste the link from your department or company SharePoint.',
  sharing:
    'This is a sharing link. In SharePoint choose Copy link, then "People with existing access", and paste that link.',
  folder: 'Paste the link of the file itself, not the folder or the library.',
  page: 'Paste the link of the file itself, not a SharePoint page or setting.',
} as const;

/**
 * Checks and cleans a pasted SharePoint file link.
 *
 * Accepted: a direct file path in a site (`https://<host>/sites/<site>/<library>/.../<file.ext>`), the same path behind a
 * "People with existing access" link (`/:b:/r/sites/...`), and the Office viewer form
 * (`/sites/<site>/_layouts/15/Doc.aspx?sourcedoc={guid}`). Refused: other hosts, personal OneDrive, sharing links that
 * carry an access token (`/:b:/s/...`, `/:b:/g/...`), folders, libraries, pages, settings and API addresses.
 *
 * @param allowedHosts the group's SharePoint host names, set by IT on the server. Empty means any company SharePoint
 *   host (`<name>.sharepoint.com`) until IT sets them.
 */
export function parseSharePointProofLink(raw: unknown, allowedHosts: readonly string[] = []): ProofLinkResult {
  const no = (reason: string): ProofLinkResult => ({ ok: false, reason });
  if (typeof raw !== 'string') return no(PROOF_LINK_REASONS.format);
  const value = raw.trim();
  if (!value || value.length > 1800 || /\s/.test(value) || BAD_CHARS.test(value)) return no(PROOF_LINK_REASONS.format);
  // Dot segments are resolved away by URL parsing, so refuse them before it hides where the link really points.
  if (/\/(\.|%2e){1,2}(\/|$|\?|#)/i.test(value)) return no(PROOF_LINK_REASONS.format);
  // An encoded slash or backslash would move the file to another folder once cleaned.
  if (/%(2f|5c)/i.test(value.split('?')[0])) return no(PROOF_LINK_REASONS.format);
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return no(PROOF_LINK_REASONS.format);
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return no(PROOF_LINK_REASONS.format);
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('.sharepoint.com')) return no(PROOF_LINK_REASONS.format);
  if (host.endsWith('-my.sharepoint.com')) return no(PROOF_LINK_REASONS.personal);
  if (!HOST.test(host)) return no(PROOF_LINK_REASONS.format);
  const allowed = allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(host)) return no(PROOF_LINK_REASONS.host);

  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return no(PROOF_LINK_REASONS.format);
  }
  if (BAD_CHARS.test(path) || path.includes('..') || path.includes('//')) return no(PROOF_LINK_REASONS.format);

  // Short links: /:<type>:/r/... points at the real path and carries no access; any other letter carries a token.
  const short = /^\/:([a-z]):\/([a-z])(\/.*)$/i.exec(path);
  if (short) {
    if (short[2].toLowerCase() !== 'r') return no(PROOF_LINK_REASONS.sharing);
    path = short[3];
  } else if (/^\/:/.test(path)) return no(PROOF_LINK_REASONS.sharing);

  const site = /^\/(sites|teams)\/([^/]+)(\/.*)?$/i.exec(path);
  if (!site) return no(PROOF_LINK_REASONS.format);
  const prefix = `/${site[1].toLowerCase()}/${site[2]}`;
  const rest = site[3] ?? '';
  const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

  // Office viewer: /sites/<site>/_layouts/15/Doc.aspx?sourcedoc={guid}&file=<name>
  if (/^\/_layouts\/15\/(Doc|WopiFrame)\.aspx$/i.test(rest)) {
    const g = GUID.exec(u.searchParams.get('sourcedoc') ?? '');
    if (!g) return no(PROOF_LINK_REASONS.page);
    const file = (u.searchParams.get('file') ?? '').trim();
    const name = file && !BAD_CHARS.test(file) && !file.includes('/') ? file.slice(0, 120) : 'SharePoint file';
    const url = `https://${host}${enc(prefix)}/_layouts/15/Doc.aspx?sourcedoc=%7B${g[1].toLowerCase()}%7D`;
    return { ok: true, link: { url, host, name } };
  }
  if (/(^|\/)(_layouts|_api|_vti_bin|_vti_[a-z]+|_catalogs)(\/|$)/i.test(rest)) return no(PROOF_LINK_REASONS.page);
  if (/\/Forms(\/|$)/i.test(rest)) return no(PROOF_LINK_REASONS.folder);

  const parts = rest.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  // A file sits inside a library at least: /sites/<site>/<library>/<file.ext>.
  if (parts.length < 2 || !/\.[A-Za-z0-9]{1,8}$/.test(last)) return no(PROOF_LINK_REASONS.folder);
  if (/^SitePages$/i.test(parts[0]) || /\.aspx$/i.test(last)) return no(PROOF_LINK_REASONS.page);
  const url = `https://${host}${enc(`${prefix}/${parts.join('/')}`)}`;
  if (url.length > 1200) return no(PROOF_LINK_REASONS.format);
  return { ok: true, link: { url, host, name: last.slice(0, 120) } };
}