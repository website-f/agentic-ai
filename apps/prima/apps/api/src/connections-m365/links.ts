/** Parse-only link checks. Nothing here fetches, resolves DNS or follows the pasted address. */
import { BadRequestException } from '@nestjs/common';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHANNEL = /^19:[A-Za-z0-9_-]{1,200}@thread\.(?:tacv2|skype)$/;
const TEAMS_HOSTS = ['teams.microsoft.com', 'teams.cloud.microsoft'];

export interface TeamsChannelLink { tenantId: string; teamId: string; channelId: string }

/**
 * A Teams "Get link to channel" address:
 *   https://teams.microsoft.com/l/channel/<url-encoded 19:...@thread.tacv2>/<name>?groupId=<team guid>&tenantId=<tenant guid>
 * Meeting, chat, file and deep links of other kinds are refused.
 */
export function teamsChannelLink(value: unknown): TeamsChannelLink {
  const bad = (): never => { throw new BadRequestException('Paste a Teams channel link from "Get link to channel".'); };
  if (typeof value !== 'string' || value.length > 2000 || /[\\\u0000- \u007f]/.test(value)) return bad();
  let u: URL;
  try { u = new URL(value); } catch { return bad(); }
  if (u.protocol !== 'https:' || !TEAMS_HOSTS.includes(u.hostname) || u.username || u.password || u.port || u.hash) return bad();
  const parts = u.pathname.split('/');
  if (parts.length < 4 || parts.length > 5 || parts[0] !== '' || parts[1] !== 'l' || parts[2] !== 'channel') return bad();
  let channelId: string;
  try { channelId = decodeURIComponent(parts[3]); } catch { return bad(); }
  const keys = [...u.searchParams.keys()];
  if (keys.some(k => !['groupId', 'tenantId', 'ngc', 'allowXTenantAccess'].includes(k)) || new Set(keys).size !== keys.length) return bad();
  const teamId = (u.searchParams.get('groupId') ?? '').toLowerCase();
  const tenantId = (u.searchParams.get('tenantId') ?? '').toLowerCase();
  if (!CHANNEL.test(channelId) || !GUID.test(teamId) || !GUID.test(tenantId)) return bad();
  return { tenantId, teamId, channelId };
}

/** The address Prima shows to open the channel in Teams, rebuilt from validated IDs only. */
export function teamsOpenUrl(link: TeamsChannelLink): string {
  return `https://teams.microsoft.com/l/channel/${encodeURIComponent(link.channelId)}/channel?groupId=${link.teamId}&tenantId=${link.tenantId}`;
}
