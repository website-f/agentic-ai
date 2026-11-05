// WhatsApp rent reminders through the WhatsApp Business Platform (Cloud API), Fauzan, 2 Nov 2026: "Create a connector to
// what app so it can communicate directly. Renter all have what app but not everyone use or monitor emails".
//
// OFF until an authorized owner sets it up. Nothing here creates a Meta account, number, template or token: an owner
// registers the business number, gets the three reminder templates approved by Meta, and sets the values below in the
// API's secret settings. Until every value is set AND WHATSAPP_RENT_REMINDERS=on, Prima only plans reminders and the
// screen says "Not connected". Names only here; values never go in the repository.
//
//   WHATSAPP_RENT_REMINDERS=on              the switch
//   WHATSAPP_GRAPH_VERSION                  the Graph API version the owner tested with, for example v<NN>.0
//   WHATSAPP_PHONE_NUMBER_ID                the business number's id in Meta
//   WHATSAPP_ACCESS_TOKEN                   a system-user token for that number
//   WHATSAPP_APP_SECRET                     checks the signature on what Meta sends back
//   WHATSAPP_VERIFY_TOKEN                   answers Meta's one-time webhook check
//   WHATSAPP_TEMPLATE_BEFORE / _DUE / _LATE the approved template names, body {{1}} tenant {{2}} unit {{3}} amount
//                                           {{4}} month {{5}} due date; Malay first, English below
//   WHATSAPP_TEMPLATE_LANG                  the templates' language code (default ms)
//   WHATSAPP_USER_ID                        the system sign-in (default u-whatsapp-link)
import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Post, Query, Req, UnauthorizedException, type OnModuleDestroy, type OnModuleInit, Body, Param, UseGuards } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';

type Env = Record<string, string | undefined>;
type Stage = 'before' | 'due' | 'late';

export interface WhatsAppConfig {
  version: string;
  phoneNumberId: string;
  token: string;
  appSecret: string;
  verifyToken: string;
  templates: Record<Stage, string>;
  lang: string;
}

const NEEDED = ['WHATSAPP_GRAPH_VERSION', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_TEMPLATE_BEFORE', 'WHATSAPP_TEMPLATE_DUE', 'WHATSAPP_TEMPLATE_LATE'] as const;

/** The connector's state for the screen: which settings are missing (names only), and whether sending is on. */
export function whatsAppState(env: Env = process.env) {
  const missing = NEEDED.filter((k) => !env[k]);
  const switchedOn = env.WHATSAPP_RENT_REMINDERS === 'on';
  return { configured: missing.length === 0, switchedOn, sending: missing.length === 0 && switchedOn, missing };
}

export function whatsAppConfig(env: Env = process.env): WhatsAppConfig | null {
  if (!whatsAppState(env).configured) return null;
  if (!/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION!)) throw new Error('WHATSAPP_GRAPH_VERSION must look like v<number>.<number>.');
  if (!/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID!)) throw new Error('WHATSAPP_PHONE_NUMBER_ID must be the number id (digits).');
  return {
    version: env.WHATSAPP_GRAPH_VERSION!,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
    token: env.WHATSAPP_ACCESS_TOKEN!,
    appSecret: env.WHATSAPP_APP_SECRET!,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN!,
    templates: { before: env.WHATSAPP_TEMPLATE_BEFORE!, due: env.WHATSAPP_TEMPLATE_DUE!, late: env.WHATSAPP_TEMPLATE_LATE! },
    lang: env.WHATSAPP_TEMPLATE_LANG || 'ms',
  };
}

export interface OutboxItem {
  /** One claimed message; it may cover several units of the same tenant. */
  claimId: string;
  reminderIds: string[];
  to: string;
  stage: Stage;
  params: { tenant: string; unit: string; amount: string; period: string; dueOn: string };
}

/** The Cloud API template message for one reminder. Template parameters are plain text, cut to a safe length. */
export function templateRequest(item: OutboxItem, cfg: WhatsAppConfig) {
  const text = (v: string) => ({ type: 'text', text: String(v).replace(/[\r\n\t]+/g, ' ').slice(0, 120) });
  return {
    url: `https://graph.facebook.com/${cfg.version}/${cfg.phoneNumberId}/messages`,
    init: {
      method: 'POST' as const,
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: item.to,
        type: 'template',
        template: {
          name: cfg.templates[item.stage],
          language: { code: cfg.lang },
          components: [{ type: 'body', parameters: [item.params.tenant, item.params.unit, item.params.amount, item.params.period, item.params.dueOn].map(text) }],
        },
      }),
    },
  };
}

type Send = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Sends one reminder. Returns what Prima records: WhatsApp's message id, or why it was not sent (never the token). */
/**
 * Only a clear refusal (a 4xx answer from WhatsApp) is safe to try again. No answer, a timeout, a server error (5xx) or
 * a success with no message id may mean the message went, so it is reported as uncertain and never re-sent on its own.
 */
export async function sendOne(item: OutboxItem, cfg: WhatsAppConfig, send: Send): Promise<{ claimId: string; ok: boolean; uncertain?: boolean; providerId?: string; error?: string }> {
  const req = templateRequest(item, cfg);
  try {
    const res = await send(req.url, req.init);
    const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { code?: number; message?: string } };
    if (!res.ok) {
      const refused = res.status >= 400 && res.status < 500;
      return { claimId: item.claimId, ok: false, uncertain: !refused, error: `WhatsApp answered ${res.status}${body.error?.code ? ` (code ${body.error.code})` : ''}` };
    }
    const providerId = body.messages?.[0]?.id;
    return providerId ? { claimId: item.claimId, ok: true, providerId } : { claimId: item.claimId, ok: false, uncertain: true, error: 'No message id in the answer' };
  } catch (e) {
    return { claimId: item.claimId, ok: false, uncertain: true, error: e instanceof Error ? e.message.slice(0, 120) : 'send failed' };
  }
}

const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Meta signs every webhook call: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256 of the raw body with the app secret. */
export function verifyWhatsAppSignature(header: unknown, rawBody: Buffer | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !rawBody) return false;
  const got = String(header ?? '').toLowerCase();
  if (!got.startsWith('sha256=')) return false;
  return same(got, `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`);
}

/** Delivery receipts and text replies out of a webhook body. Anything else (media, reactions) is ignored. */
export function parseWhatsAppWebhook(body: unknown): { statuses: { providerId: string; status: string; error?: string | null }[]; replies: { from: string; text: string }[] } {
  const statuses: { providerId: string; status: string; error?: string | null }[] = [];
  const replies: { from: string; text: string }[] = [];
  const b = (body ?? {}) as { entry?: { changes?: { field?: string; value?: { statuses?: unknown[]; messages?: unknown[] } }[] }[] };
  for (const e of Array.isArray(b.entry) ? b.entry : [])
    for (const c of Array.isArray(e?.changes) ? e.changes : []) {
      if (c?.field !== 'messages') continue;
      for (const s of (Array.isArray(c.value?.statuses) ? c.value!.statuses : []) as { id?: unknown; status?: unknown; errors?: { code?: unknown; title?: unknown }[] }[]) {
        if (typeof s?.id !== 'string' || typeof s.status !== 'string') continue;
        const err = s.errors?.[0];
        statuses.push({ providerId: s.id, status: s.status, error: err ? `${String(err.code ?? '')} ${String(err.title ?? '')}`.trim().slice(0, 200) : null });
      }
      for (const m of (Array.isArray(c.value?.messages) ? c.value!.messages : []) as { from?: unknown; type?: unknown; text?: { body?: unknown }; button?: { text?: unknown } }[]) {
        if (typeof m?.from !== 'string') continue;
        const text = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : null;
        if (typeof text === 'string') replies.push({ from: m.from, text: text.slice(0, 300) });
      }
    }
  return { statuses, replies };
}

const userId = () => process.env.WHATSAPP_USER_ID ?? 'u-whatsapp-link';

/** One pass: queue today's reminders, then send what is waiting (in sending hours), then record each result. */
export async function runRentReminders(db: Db, cfg: WhatsAppConfig | null, send: Send = fetch as unknown as Send, clock?: () => string) {
  const queued = await db.asUser(userId(), (svc, u) => svc.amQueueRentReminders(u), clock);
  if (!cfg || !whatsAppState().sending) return { ...queued, sent: 0, failed: 0, sending: false };
  const outbox = (await db.asUser(userId(), (svc, u) => svc.amWhatsAppOutbox(u, 50), clock)) as OutboxItem[];
  const results: Awaited<ReturnType<typeof sendOne>>[] = [];
  for (const item of outbox) results.push(await sendOne(item, cfg, send));
  const done = results.length ? await db.asUser(userId(), (svc, u) => svc.amWhatsAppResult(u, results), clock) : { sent: 0, failed: 0 };
  return { ...queued, ...done, sending: true };
}

/** Runs every 30 minutes while the switch is on and every setting is present. Off otherwise. */
@Injectable()
export class WhatsAppRunner implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(private db: Db) {}
  onModuleInit() {
    if (!whatsAppState().sending) return;
    const cfg = whatsAppConfig();
    const tick = () =>
      void runRentReminders(this.db, cfg).catch((e: unknown) => console.error(`WhatsApp rent reminders: ${e instanceof Error ? e.message : 'failed'}`));
    this.timer = setInterval(tick, 30 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Meta's webhook: the one-time check, then signed delivery receipts and replies. */
@Controller('api/integrations/whatsapp/v1')
export class WhatsAppWebhookController {
  constructor(private db: Db) {}

  @Get('webhook')
  check(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    const want = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode !== 'subscribe' || !want || !token || !same(token, want)) throw new ForbiddenException('Not a valid webhook check.');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(challenge ?? ''))) throw new BadRequestException('Bad challenge.');
    return challenge;
  }

  @Post('webhook')
  async events(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    if (!verifyWhatsAppSignature(req.headers['x-hub-signature-256'], req.rawBody, process.env.WHATSAPP_APP_SECRET)) throw new UnauthorizedException('Signature not valid.');
    const parsed = parseWhatsAppWebhook(body);
    if (!parsed.statuses.length && !parsed.replies.length) return { ok: true };
    return this.db.asUser(userId(), (svc, u) => svc.amWhatsAppEvents(u, parsed));
  }
}

/** Staff routes: the reminder panel, tenant consent, and "check now" for the rental team. */
@Controller('api/am/whatsapp')
@UseGuards(AuthGuard)
export class WhatsAppStaffController {
  constructor(private db: Db) {}

  @Get()
  async board(@UserId() uid: string) {
    const board = await this.db.asUser(uid, (svc, u) => svc.amWhatsAppBoard(u));
    const s = whatsAppState();
    // Setting names only, never values.
    return { ...board, connector: { configured: s.configured, switchedOn: s.switchedOn, sending: s.sending, missing: s.missing } };
  }

  @Post('units/:id/consent')
  consent(@UserId() uid: string, @Param('id') unitId: string, @Body() b: { on?: unknown; how?: unknown }) {
    if (typeof b.on !== 'boolean') throw new BadRequestException('on must be true or false');
    const on = b.on;
    const how = typeof b.how === 'string' ? b.how.slice(0, 300) : '';
    return this.db.asUser(uid, (svc, u) => svc.amWhatsAppConsent(u, unitId.slice(0, 80), on, how));
  }

  /** The team settles a reminder that may or may not have gone (went, send again, or leave it), with a reason. */
  @Post('units/:id/reminders/:rid/settle')
  settle(@UserId() uid: string, @Param('id') unitId: string, @Param('rid') rid: string, @Body() b: { outcome?: unknown; reason?: unknown }) {
    const outcome = b.outcome === 'went' || b.outcome === 'resend' || b.outcome === 'drop' ? b.outcome : null;
    if (!outcome) throw new BadRequestException('outcome must be went, resend or drop');
    const reason = typeof b.reason === 'string' ? b.reason.slice(0, 300) : '';
    return this.db.asUser(uid, (svc, u) => svc.amWhatsAppSettle(u, unitId.slice(0, 80), rid.slice(0, 120), outcome, reason));
  }

  /** The team checks who is due a reminder now. It sends only when the connector is on; otherwise it only queues. */
  @Post('run')
  async run(@UserId() uid: string) {
    const queued = await this.db.asUser(uid, (svc, u) => svc.amQueueRentReminders(u));
    if (!whatsAppState().sending) return { ...queued, sent: 0, failed: 0, sending: false };
    const r = await runRentReminders(this.db, whatsAppConfig());
    return { ...queued, sent: r.sent, failed: r.failed, uncertain: (r as { uncertain?: number }).uncertain ?? 0, sending: true };
  }
}

export const WHATSAPP_CONTROLLERS = [WhatsAppWebhookController, WhatsAppStaffController];
