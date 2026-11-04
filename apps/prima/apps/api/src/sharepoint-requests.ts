import { BadRequestException } from '@nestjs/common';

/** Parse only. Never fetch, resolve DNS, grant or configure a pasted destination. */
export function sharePointRequestUrl(value: unknown) {
  const bad = (): never => { throw new BadRequestException('Paste a direct HTTPS SharePoint site or library link, without sharing tokens.'); };
  if (typeof value !== 'string' || value.length > 1800 || /[\\\u0000-\u0020\u007f]/.test(value)) return bad();
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]{0,62}\.sharepoint\.com$/.test(u.hostname) || u.username || u.password || u.port || u.hash) return bad();
    let path = decodeURIComponent(u.pathname);
    if (/[\\\u0000-\u001f\u007f]/.test(path) || path.includes('..') || path.includes('//') || /(?:^|\/)(?:_layouts|_api|_vti_bin|:.)\//i.test(path)) return bad();
    const site = path.match(/^\/(sites|teams)\/([^/]+)(?:\/|$)/);
    if (!site) return bad(); // Tenant root/OneDrive/sharing links require manual IT review.
    if (u.search) {
      if (!/\/Forms\/AllItems\.aspx$/i.test(path)) return bad();
      const keys = [...u.searchParams.keys()];
      if (keys.some(k => !['id','RootFolder','viewid'].includes(k)) || new Set(keys).size !== keys.length || (u.searchParams.has('id') && u.searchParams.has('RootFolder'))) return bad();
      const root = u.searchParams.get('id') ?? u.searchParams.get('RootFolder');
      if (root) { if (!root.startsWith('/') || root.includes('://') || /[\\\u0000-\u001f\u007f]/.test(root) || root.includes('..') || root.includes('//')) return bad(); path = root; }
    }
    path = path.replace(/\/Forms\/AllItems\.aspx$/i, '').replace(/\/$/, '');
    const prefix = `/${site[1]}/${site[2]}`;
    if (!(path === prefix || path.startsWith(prefix + '/')) || /(?:^|\/)(?:_layouts|_api|_vti_bin)(?:\/|$)/i.test(path)) return bad();
    const parts = path.split('/');
    // Limit requested scope to site or library, never a selected child document/folder.
    const scopePath = parts.slice(0, Math.min(parts.length, 4)).join('/');
    const url = `https://${u.hostname}${scopePath.split('/').map(encodeURIComponent).join('/')}`;
    if (url.length > 600) return bad();
    return { canonicalUrl: url, host: u.hostname, kind: parts.length > 3 ? 'library' as const : 'site' as const };
  } catch (e) { if (e instanceof BadRequestException) throw e; return bad(); }
}
export function connectionRequestInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['url','requestId'].includes(k))) throw new BadRequestException('Invalid connection request.');
  const b = body as Record<string, unknown>;
  if (typeof b.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(b.requestId)) throw new BadRequestException('Invalid request identity.');
  return { ...sharePointRequestUrl(b.url), requestId: b.requestId };
}
export const requestMarker = (id: string) => `[sharepoint-request:${id}]`;
