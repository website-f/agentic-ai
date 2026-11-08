// The CMS's own in-house language model (Fauzan, 5 Nov 2026: CMS "need it own llm in house. And data from client saved
// in inhouse server not in azure cloud").
//
// What it is used for: one thing only. It rewrites the monitoring assistant's ranked findings (assistant.ts) into a
// short shift briefing in Bahasa Melayu for the operator. The rule-based findings stay the record: they are shown first,
// they decide the order, and they work when the model is off, slow or wrong. The briefing is marked as draft wording.
//
// What it is never used for: it has no tools and no routes. It cannot touch an alarm, a device, a person or Prima. Its
// answer is only text shown on the operator screen.
//
// Where it runs: on the CMS in-house server or the command centre's own network, never a public cloud. The address must
// be a private one (localhost, 10.x, 172.16-31.x, 192.168.x, or a .internal/.lan/.local name); anything else is refused
// at start-up, so client data cannot leave the building by a wrong setting. Most in-house model servers (for example
// llama.cpp, vLLM or Ollama) offer the same "chat completions" call, so the brand is the owner's choice.
//
// What it is sent (kept small, CLAUDE.md rule 4): for each of the top findings, its pattern, severity, headline, the
// reasons and suggestions already shown on screen, the number of alarms and minutes open. Never phone numbers, never
// video, never device raw details, never keys.
import type { AssistantView, Finding } from './assistant';

export interface LocalModelConfig {
  url: string;
  model: string;
  /** Optional key for the in-house server. */
  key?: string;
  timeoutMs: number;
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|[a-z0-9-]+(\.[a-z0-9-]+)*\.(internal|lan|local))$/i;

/** Off unless CMS_LOCAL_MODEL_URL and CMS_LOCAL_MODEL_NAME are set. A public address is refused, never used. */
export function localModelConfig(env: NodeJS.ProcessEnv = process.env): LocalModelConfig | null {
  const raw = env.CMS_LOCAL_MODEL_URL;
  const model = env.CMS_LOCAL_MODEL_NAME;
  if (!raw || !model) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('CMS_LOCAL_MODEL_URL is not a valid address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('CMS_LOCAL_MODEL_URL must be http or https.');
  if (u.username || u.password) throw new Error('CMS_LOCAL_MODEL_URL must not carry a user name or password; use CMS_LOCAL_MODEL_KEY.');
  if (!PRIVATE_HOST.test(u.hostname)) throw new Error('CMS_LOCAL_MODEL_URL must be an in-house (private network) address. Client data never goes to a public service.');
  const timeoutMs = Math.min(60_000, Math.max(1_000, Number(env.CMS_LOCAL_MODEL_TIMEOUT_MS ?? 20_000) || 20_000));
  return { url: u.toString().replace(/\/$/, ''), model, key: env.CMS_LOCAL_MODEL_KEY || undefined, timeoutMs };
}

/** The small, screen-only facts the model may see for one finding. */
function brief(f: Finding, nowMs: number) {
  return {
    jenis: f.pattern,
    tahap: f.severity,
    tajuk: f.title,
    penggera: f.alarmIds.length,
    minitTerbuka: Math.max(0, Math.round((nowMs - Date.parse(f.firstOpenedAt)) / 60_000)),
    adaYangBertindak: f.allActioned,
    // Reasons can name the person acting; the model does not need names to write the briefing.
    sebab: f.reasons.map((r) => r.replace(/\(([^)]*)\)/g, '').trim()),
    cadangan: f.suggestions,
  };
}

export function briefingPrompt(view: AssistantView, nowMs: number, top = 8): { system: string; user: string } {
  const quiet = view.systems.filter((s) => s.state !== 'ok').map((s) => ({ sistem: s.label, keadaan: s.state, nota: s.note }));
  return {
    system:
      'Anda menulis ringkasan syif untuk operator bilik kawalan keselamatan, dalam Bahasa Melayu yang mudah, paling banyak 8 baris. ' +
      'Gunakan HANYA fakta yang diberi. Jangan tambah fakta, nama, nombor telefon atau arahan baharu. ' +
      'Kekalkan susunan keutamaan yang diberi. Jangan katakan sesuatu penggera palsu atau selamat. ' +
      'Akhiri dengan: "Operator dan syarikat memutuskan tindakan."',
    user: JSON.stringify({ perkara: view.findings.slice(0, top).map((f) => brief(f, nowMs)), sistem: quiet }),
  };
}

export type Briefing = { state: 'off' } | { state: 'ok'; text: string; model: string; at: string } | { state: 'failed'; reason: string };

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Asks the in-house model for the shift briefing. Any failure gives 'failed' and the rule-based findings carry on. */
export async function shiftBriefing(view: AssistantView, cfg: LocalModelConfig | null, nowMs: number, send: Fetch = fetch): Promise<Briefing> {
  if (!cfg) return { state: 'off' };
  if (!view.findings.length) return { state: 'ok', text: 'Tiada penggera terbuka. Operator dan syarikat memutuskan tindakan.', model: 'tiada (tiada penggera)', at: new Date(nowMs).toISOString() };
  const p = briefingPrompt(view, nowMs);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const res = await send(`${cfg.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({ model: cfg.model, temperature: 0.2, max_tokens: 400, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }] }),
      signal: ctl.signal,
      // A redirect could send the findings somewhere else, possibly outside the building: refused, never followed.
      redirect: 'error',
    });
    if (!res.ok) return { state: 'failed', reason: `Pelayan model dalaman menjawab ${res.status}.` };
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return { state: 'failed', reason: 'Jawapan model dalaman kosong.' };
    // Plain text only, short, no markup: the screen shows it as text, never as HTML.
    const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/<[^>]*>/g, '').trim().slice(0, 1500);
    return { state: 'ok', text: clean, model: cfg.model, at: new Date(nowMs).toISOString() };
  } catch (e) {
    return { state: 'failed', reason: ctl.signal.aborted ? 'Model dalaman tidak menjawab dalam masa.' : 'Model dalaman tidak dapat dihubungi.' };
  } finally {
    clearTimeout(timer);
  }
}
