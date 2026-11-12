// HTTP server for the CMS app. Two kinds of caller:
// - Feeds (site gateways, cloud adaptors, Prima): every call signed (X-Api-Key, X-Timestamp, X-Signature), refused if not.
// - Operators: E7 (Fauzan, 11 Nov 2026) Microsoft sign-in through Prima (signin.ts): a one-time ticket from Prima, then
//   CMS's own short session cookie. The personal operator key is only a sealed break-glass fallback, off unless
//   CMS_BREAK_GLASS=true. There is no command route: CMS cannot open gates or arm panels.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { problems, verify, type CmsEvent } from './event';
import { directoryProblems, type Directory } from './directory';
import { Hub, HubError } from './hub';
import { assess } from './assistant';
import { localModelConfig, shiftBriefing, type Briefing, type LocalModelConfig } from './local-model';
import { GateLists, PROFILES, plateEvent, readFromJson, type Vehicle, type Visitor } from './adaptors/anpr';
import { fixEvents, type Fix, type Route } from './adaptors/tracker';
import { handleFrame } from './adaptors/sia-dc09';
import { CSS, PAGE, SCRIPT } from './dashboard';
import { CLEAR_COOKIE, Sessions, sessionCookie, setCookie, signInFromEnv, verifyTicket, type SignInConfig } from './signin';

export const MAX_BODY = 256 * 1024;
/** How long one shift briefing from the in-house model is reused before a new one is asked for. */
export const BRIEFING_REUSE_MS = 60_000;

export interface ServerConfig {
  /** Operator key -> operator name. Break-glass only (CMS_BREAK_GLASS=true); empty when switched off. */
  operators: Map<string, string>;
  /** E7: Microsoft sign-in through Prima (signin.ts). Absent or null: off. */
  signin?: SignInConfig | null;
  gateway: { key: string; secret: string };
  prima: { key: string; secret: string };
  /** The CMS's own in-house model for the shift briefing (local-model.ts). Absent or null: off. */
  localModel?: LocalModelConfig | null;
  /** Sending to the in-house model (tests replace it). */
  modelFetch?: Parameters<typeof shiftBriefing>[3];
}

/**
 * Reads the configuration from the environment. Operators sign in with Microsoft through Prima (CMS_SIGNIN_SECRET). The
 * operator keys (CMS_OPERATOR_KEYS) are read only with CMS_BREAK_GLASS=true; set without it, CMS refuses to start so a
 * forgotten key list is never quietly live. Refuses to start without any way for operators to sign in, or without the
 * feed secrets.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const signin = signInFromEnv(env);
  const raw = env.CMS_OPERATOR_KEYS;
  const breakGlass = env.CMS_BREAK_GLASS === 'true';
  if (raw && !breakGlass) throw new Error('CMS_OPERATOR_KEYS is set but CMS_BREAK_GLASS is not true. Operators sign in with Microsoft through Prima; remove the keys, or set CMS_BREAK_GLASS=true only while Microsoft sign-in is down.');
  let operators = new Map<string, string>();
  if (breakGlass) {
    if (!raw) throw new Error('CMS_BREAK_GLASS=true needs CMS_OPERATOR_KEYS (JSON: {"<key>":"<operator name>"}).');
    const obj = JSON.parse(raw) as Record<string, string>;
    operators = new Map(Object.entries(obj).filter(([k, v]) => k.length >= 24 && typeof v === 'string' && v.trim()));
    if (!operators.size) throw new Error('CMS_OPERATOR_KEYS has no usable key (each key at least 24 characters).');
  }
  if (!signin && !operators.size) throw new Error('CMS_SIGNIN_SECRET is not set: operators sign in with Microsoft through Prima (the same secret Prima holds).');
  const need = (n: string) => {
    const v = env[n];
    if (!v) throw new Error(`${n} is not set.`);
    return v;
  };
  return {
    operators,
    signin,
    gateway: { key: need('CMS_GATEWAY_KEY'), secret: need('CMS_GATEWAY_SECRET') },
    prima: { key: need('PRIMA_TO_CMS_KEY'), secret: need('PRIMA_TO_CMS_SECRET') },
    localModel: localModelConfig(env),
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Body is not JSON.');
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json', extra: Record<string, string> = {}): void {
  const text = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    ...extra,
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  res.end(text);
}

function sameText(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export interface AppState {
  hub: Hub;
  lists: GateLists;
  routes: Map<string, Route>;
  /** Saves the hub (persist.ts). Called before any change is answered 2xx; a failed save answers 503 instead. */
  persist?: () => void;
  /** The last shift briefing and the one being made (kept with the app state so every request shares it). */
  briefing?: { pending: Promise<Briefing> | null; last: Briefing | null; at: number };
  /** E7: operator sessions after Microsoft sign-in through Prima (made on first use). */
  sessions?: Sessions;
}

export function handler(cfg: ServerConfig, state: AppState, clock: () => number = Date.now) {
  const { hub, lists, routes } = state;
  const save = () => {
    if (!state.persist) return;
    try {
      state.persist();
    } catch {
      throw new HttpError(503, 'CMS could not save this change; send it again.');
    }
  };
  /** A change is acknowledged only once it is saved. */
  const saved = (res: ServerResponse, body: unknown) => {
    save();
    return send(res, 200, body);
  };

  const sessions = cfg.signin ? (state.sessions ??= new Sessions(cfg.signin)) : null;
  /**
   * Who is acting: the session after Microsoft sign-in through Prima (a change must also carry the X-CMS-Request header,
   * which another site cannot send), or, only while break-glass is on, an operator key.
   */
  const operator = (req: IncomingMessage): string => {
    const sid = sessionCookie(req.headers.cookie);
    if (sid && sessions) {
      const s = sessions.get(sid, clock());
      if (!s) throw new HttpError(401, 'Your CMS sign-in has ended. Open CMS from Prima again.');
      if (req.method !== 'GET' && req.headers['x-cms-request'] !== '1') throw new HttpError(403, 'Request refused.');
      return s.operator;
    }
    const h = String(req.headers.authorization ?? '');
    const key = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (key) for (const [k, name] of cfg.operators) if (sameText(k, key)) return name;
    throw new HttpError(401, cfg.operators.size ? 'Operator key not accepted.' : 'Sign in with Microsoft through Prima.');
  };

  const signedBy = (req: IncomingMessage, body: string, who: { key: string; secret: string }) => {
    if (!verify(req.headers as Record<string, unknown>, body, who.key, who.secret, clock())) throw new HttpError(401, 'Feed key or signature not valid.');
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://cms.local');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/') return send(res, 200, PAGE, 'text/html');
      if (req.method === 'GET' && path === '/app.js') return send(res, 200, SCRIPT, 'text/javascript');
      if (req.method === 'GET' && path === '/app.css') return send(res, 200, CSS, 'text/css');
      if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });

      // E7: how operators sign in (no secrets): Microsoft through Prima, and whether the break-glass key is on.
      if (req.method === 'GET' && path === '/auth/options') return send(res, 200, { microsoft: !!cfg.signin, primaUrl: cfg.signin?.primaUrl ?? null, keys: cfg.operators.size > 0 });
      if (req.method === 'POST' && path === '/auth/prima') {
        if (!cfg.signin || !sessions) throw new HttpError(404, 'Microsoft sign-in through Prima is not set up on this CMS.');
        const body = json((await readBody(req)) || '{}') as Record<string, unknown>;
        const t = clock();
        const check = verifyTicket(body.ticket, cfg.signin, t);
        if (!check.ok) {
          hub.refuse('operator-sign-in', `ticket refused: ${check.reason}`);
          throw new HttpError(401, 'This sign-in link is not valid or has expired. Open CMS from Prima again.');
        }
        const s = sessions.start(check.claims, t);
        if (!s) {
          hub.refuse('operator-sign-in', 'ticket used twice');
          throw new HttpError(401, 'This sign-in link was already used. Open CMS from Prima again.');
        }
        hub.operatorSignIn(s.operator, `signed in through Prima (${s.via}), Prima record ${s.sub}`);
        save();
        return send(res, 200, { operator: s.operator, via: s.via }, 'application/json', { 'set-cookie': setCookie(s.id, cfg.signin.maxHours * 3600) });
      }
      if (req.method === 'GET' && path === '/auth/me') {
        const sid = sessionCookie(req.headers.cookie);
        const s = sid && sessions ? sessions.get(sid, clock()) : null;
        if (!s) throw new HttpError(401, 'Not signed in.');
        return send(res, 200, { operator: s.operator, via: s.via });
      }
      if (req.method === 'POST' && path === '/auth/signout') {
        const s = sessions?.end(sessionCookie(req.headers.cookie)) ?? null;
        if (s) {
          hub.operatorSignIn(s.operator, 'signed out');
          save();
        }
        return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': CLEAR_COOKIE });
      }

      if (req.method === 'GET' && path === '/api/state') {
        operator(req);
        return send(res, 200, {
          queue: hub.queue(),
          notifications: hub.notifications.slice(-50).reverse(),
          health: hub.deviceHealth(),
          gaps: hub.gaps.slice(-50).reverse(),
          refused: hub.refused.slice(-50).reverse(),
          primaRejected: hub.primaLink.parked.slice(-50).reverse(),
        });
      }

      if (req.method === 'GET' && path === '/api/kpis') {
        operator(req);
        try {
          return send(res, 200, hub.kpis({ from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined }));
        } catch (e) {
          if (e instanceof HubError) throw new HttpError(400, e.message);
          throw e;
        }
      }

      // Shift handover at the desk: who is handing over to whom (roster from Prima), and the two steps.
      if (req.method === 'GET' && path === '/api/handover') {
        const who = operator(req);
        return send(res, 200, { operator: who, ...hub.deskHandover() });
      }
      if (req.method === 'POST' && (path === '/api/handover/give' || path === '/api/handover/take')) {
        const who = operator(req);
        const body = json((await readBody(req)) || '{}') as Record<string, unknown>;
        try {
          if (path === '/api/handover/give') return saved(res, hub.giveHandover(who, String(body.note ?? '')));
          if (typeof body.agree !== 'boolean') throw new HttpError(400, 'Say whether you agree (true or false).');
          return saved(res, hub.takeHandover(who, body.agree, String(body.note ?? '')));
        } catch (e) {
          if (e instanceof HubError) throw new HttpError(400, e.message);
          throw e;
        }
      }

      if (req.method === 'GET' && path === '/api/assistant') {
        operator(req);
        return send(res, 200, assess(hub, clock()));
      }

      if (req.method === 'GET' && path === '/api/assistant/briefing') {
        operator(req);
        // One request to the in-house model at a time, and a briefing is reused for a minute, so several operators
        // pressing the button do not queue up work on the model server.
        const t = clock();
        const briefing = (state.briefing ??= { pending: null, last: null, at: 0 });
        if (!briefing.pending && (!briefing.last || t - briefing.at > BRIEFING_REUSE_MS))
          briefing.pending = shiftBriefing(assess(hub, t), cfg.localModel ?? null, t, cfg.modelFetch)
            .then((b) => {
              briefing.last = b;
              briefing.at = t;
              return b;
            })
            .finally(() => {
              briefing.pending = null;
            });
        return send(res, 200, briefing.pending ? await briefing.pending : briefing.last);
      }

      if (req.method === 'POST' && path === '/api/assistant/feedback') {
        const who = operator(req);
        const body = json((await readBody(req)) || '{}') as Record<string, unknown>;
        if (typeof body.useful !== 'boolean') throw new HttpError(400, 'Say whether the finding was useful (true or false).');
        try {
          return saved(res, hub.assistantFeedback(who, String(body.key ?? ''), body.useful, typeof body.note === 'string' ? body.note : ''));
        } catch (e) {
          if (e instanceof HubError) throw new HttpError(400, e.message);
          throw e;
        }
      }

      const alarmAction = /^\/api\/alarms\/([^/]+)\/(acknowledge|actioned|close|escalate)$/.exec(path);
      if (req.method === 'POST' && alarmAction) {
        const who = operator(req);
        const body = json((await readBody(req)) || '{}') as Record<string, string>;
        const id = decodeURIComponent(alarmAction[1]);
        try {
          switch (alarmAction[2]) {
            case 'acknowledge':
              return saved(res, hub.acknowledge(id, who));
            case 'actioned':
              return saved(res, hub.actioned(id, who, String(body.by ?? '')));
            case 'close':
              return saved(res, hub.close(id, who, body.outcome as 'real' | 'false', String(body.note ?? '')));
            default:
              return saved(res, { escalatedTo: hub.escalate(id, who, String(body.reason ?? '')) });
          }
        } catch (e) {
          if (e instanceof HubError) throw new HttpError(400, e.message);
          throw e;
        }
      }

      if (req.method === 'POST' && path.startsWith('/ingest/')) {
        const body = await readBody(req);
        if (path === '/ingest/directory') {
          signedBy(req, body, cfg.prima);
          const d = json(body);
          const bad = directoryProblems(d);
          if (bad.length) throw new HttpError(400, bad.slice(0, 10).join('; '));
          hub.replaceDirectory(d as Directory);
          return saved(res, { ok: true });
        }
        signedBy(req, body, cfg.gateway);
        const data = json(body) as Record<string, unknown>;
        switch (path) {
          case '/ingest/events': {
            const list = Array.isArray(data.events) ? (data.events as CmsEvent[]) : [];
            let stored = 0;
            const refused: string[] = [];
            for (const e of list) {
              const bad = problems(e);
              if (bad.length) {
                hub.refuse(String((e as Partial<CmsEvent>)?.source ?? 'gateway'), bad.join('; '));
                refused.push(bad.join('; '));
                continue;
              }
              const r = hub.ingest(e);
              if (r.stored) stored++;
              else if (r.refused) refused.push(r.refused.join('; '));
            }
            return saved(res, { stored, refused });
          }
          case '/ingest/heartbeat':
            for (const id of Array.isArray(data.deviceIds) ? data.deviceIds : []) if (typeof id === 'string') hub.heartbeat(id, new Date(clock()));
            return saved(res, { ok: true });
          case '/ingest/lists/vehicles':
            lists.setVehicles(Array.isArray(data.vehicles) ? (data.vehicles as Vehicle[]).filter((v) => typeof v?.plate === 'string') : []);
            return saved(res, { ok: true });
          case '/ingest/lists/visitors':
            lists.setVisitors(Array.isArray(data.visitors) ? (data.visitors as Visitor[]).filter((v) => typeof v?.siteId === 'string') : []);
            return saved(res, { ok: true });
          case '/ingest/routes':
            for (const r of Array.isArray(data.routes) ? (data.routes as Route[]) : []) if (typeof r?.trackerId === 'string' && Array.isArray(r.points)) routes.set(r.trackerId, r);
            return saved(res, { ok: true });
          case '/ingest/tracker': {
            const out = fixEvents(data as unknown as Fix, hub.directory, routes.get(String(data.trackerId)), new Date(clock()).toISOString());
            if ('refused' in out) {
              hub.refuse('tracker', out.refused);
              throw new HttpError(400, out.refused);
            }
            hub.heartbeat(String(data.trackerId), new Date(clock()));
            for (const e of out) hub.ingest(e);
            return saved(res, { events: out.length });
          }
          case '/ingest/ja/clock-in':
            if (!hub.clockIn(String(data.shiftId), String(data.at))) throw new HttpError(400, 'Shift not in the directory, or time not valid.');
            return saved(res, { ok: true });
          case '/ingest/ja/checkpoint':
            if (!hub.checkpoint(String(data.roundId), String(data.at))) throw new HttpError(400, 'Patrol round not in the directory, or time not valid.');
            return saved(res, { ok: true });
          default: {
            const anpr = /^\/ingest\/anpr\/([a-z0-9-]+)$/.exec(path);
            if (anpr) {
              const profile = PROFILES[anpr[1]];
              if (!profile) throw new HttpError(404, `No ANPR profile ${anpr[1]}.`);
              const read = readFromJson(data, profile);
              if ('refused' in read) {
                hub.refuse(`anpr-${anpr[1]}`, read.refused);
                throw new HttpError(400, read.refused);
              }
              const e = plateEvent(read, hub.directory, lists, new Date(clock()).toISOString());
              if ('refused' in e) {
                hub.refuse(`anpr-${anpr[1]}`, e.refused);
                throw new HttpError(400, e.refused);
              }
              hub.heartbeat(read.cameraId, new Date(clock()));
              hub.ingest(e);
              return saved(res, { verdict: e.detail.verdict, kind: e.kind });
            }
          }
        }
      }
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) {
        // Refused feed calls are security evidence: keep them too, but a failed save never changes the answer.
        if (e.status === 400 && req.method === 'POST') {
          try {
            state.persist?.();
          } catch {
            /* the next save keeps it */
          }
        }
        return send(res, e.status, { error: e.message });
      }
      return send(res, 500, { error: 'Something went wrong.' });
    }
  };
}

export function startHttp(cfg: ServerConfig, state: AppState, port: number): Server {
  const s = createServer((req, res) => void handler(cfg, state)(req, res));
  s.listen(port);
  return s;
}

/** SIA DC-09 receiver for alarm panels on TCP. Each frame ends with CR; every readable frame gets an ACK, others a NAK. */
export function startDc09(hub: Hub, port: number, persist?: () => void): TcpServer {
  const s = createTcpServer((sock) => {
    let buf = '';
    sock.setEncoding('latin1');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > 64 * 1024) return sock.destroy();
      let end: number;
      while ((end = buf.indexOf('\r')) >= 0) {
        const raw = buf.slice(0, end + 1);
        buf = buf.slice(end + 1);
        const start = raw.indexOf('\n');
        const out = handleFrame(start >= 0 ? raw.slice(start) : raw, hub.directory);
        if (out.deviceId) hub.heartbeat(out.deviceId);
        if (out.refused) hub.refuse('sia-dc09', out.refused);
        if (out.event) hub.ingest(out.event);
        // The panel is told ACK only once the event is saved; without the save it gets no answer and sends again.
        try {
          persist?.();
        } catch {
          return sock.destroy();
        }
        sock.write(out.reply, 'latin1');
      }
    });
    sock.on('error', () => sock.destroy());
  });
  s.listen(port);
  return s;
}
