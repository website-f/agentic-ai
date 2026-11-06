import { arishaJson, checkArishaBudget } from './arisha-transport';
import { ArishaBusy, ArishaUnavailable, arishaConfig, type ArishaConfig, type ArishaModel, type ChatMessage } from './arisha';
import { officePayload, officeSecret, officeSign } from './office';

// P80: Arisha on the Agentic Office's AI. Inside the office there is no Azure OpenAI to switch on: the office already has
// the company's AI (its providers and model groups, data levels, approved services, each person's daily allowance and
// the usage pages). So each model turn of Arisha's loop (arisha.ts) goes to the office (OFFICE_MODEL_URL, the office
// api's /internal/prima/model on the private network), signed with OFFICE_SIGNING_SECRET in the office's own scheme
// (office.ts) but under x-prima-* headers and via "prima:arisha", for the Prima staff record she works for. The office
// runs that one turn as the linked person and records it. Her rules, tools, tool authorisation and budgets stay here.

export const OFFICE_MODEL_VIA = 'prima:arisha';

export interface OfficeModelConfig {
  url: string;
  secret: string;
}

/** The office model endpoint from the environment, or null (then Arisha uses Azure if that is set, else she is off). */
export function officeModelConfig(env: NodeJS.ProcessEnv = process.env): OfficeModelConfig | null {
  const raw = env.OFFICE_MODEL_URL?.trim() ?? '';
  const secret = officeSecret(env);
  if (!raw || !secret) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hash) return null;
    return { url: url.toString(), secret };
  } catch {
    return null;
  }
}

export type ArishaProvider = { kind: 'office'; office: OfficeModelConfig } | { kind: 'azure'; azure: ArishaConfig };

/** Which AI Arisha runs on here: the office's when OFFICE_MODEL_URL is set, else Azure OpenAI when switched on. */
export function arishaProvider(env: NodeJS.ProcessEnv = process.env): ArishaProvider | null {
  const office = officeModelConfig(env);
  if (office) return { kind: 'office', office };
  const azure = arishaConfig(env);
  return azure ? { kind: 'azure', azure } : null;
}

type Fetch = typeof fetch;

/** The office's refusal, in its own plain words (one short line), or null. */
async function officeMessage(res: Response, signal: AbortSignal): Promise<string | null> {
  try {
    const body = (await arishaJson(res, 8_000, signal)) as { message?: unknown };
    const text = typeof body?.message === 'string' ? body.message.replace(/\s+/g, ' ').trim() : '';
    return text && text.length <= 300 ? text : null;
  } catch {
    return null;
  }
}

/** One signed model turn on the office's AI, for this Prima staff record. */
export function officeModel(cfg: OfficeModelConfig, userId: string, http: Fetch = fetch, now: () => number = Date.now): ArishaModel {
  return async ({ messages, tools, maxTokens }, signal) => {
    const url = new URL(cfg.url);
    const path = url.pathname + url.search;
    const body = JSON.stringify({ messages, ...(tools ? { tools } : {}), max_tokens: maxTokens });
    const ts = new Date(now()).toISOString();
    const signature = officeSign(cfg.secret, officePayload(ts, 'POST', path, { user: userId, via: OFFICE_MODEL_VIA }, body));
    const res = await http(cfg.url, {
      method: 'POST', redirect: 'error', signal,
      headers: {
        'Content-Type': 'application/json',
        'x-prima-ts': ts,
        'x-prima-user': userId,
        'x-prima-via': OFFICE_MODEL_VIA,
        'x-prima-signature': signature,
      },
      body,
    });
    checkArishaBudget(signal);
    if (!res.ok) {
      const said = await officeMessage(res, signal);
      if (res.status === 429) throw new ArishaBusy(said ?? undefined);
      throw new ArishaUnavailable(said ?? 'Arisha could not reach the office AI. Try again in a minute.');
    }
    return (await arishaJson(res, 256_000, signal)) as { choices?: { message?: ChatMessage }[] };
  };
}
