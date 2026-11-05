import type { NextFunction, Request, Response } from 'express';

// HTTP protections for the API (pre-publication review, 28 Oct 2026). The API only ever answers JSON to the Prima
// website, so every response says: never cache it, never sniff it, never frame it.

/** Headers on every API response. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // Azure ends HTTPS at its ingress; browsers keep to HTTPS for this host for a year.
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
}

/**
 * Request limits, kept in memory, so each API copy counts on its own (staging runs one or two). Signed system feeds and
 * the health check are not counted. They slow a stuck script or someone guessing; Azure's own protections sit in front.
 *
 * Two counts (whole-organisation review, 3 Nov 2026). Each person whose sign-in is VERIFIED (`identify`, a real
 * signature check) may make `max` calls a minute wherever they are. Everything not verified (no header, a made-up or
 * expired header) shares the address's own `max`, so rotating invalid headers gains nothing (Arisha review, 3 Nov
 * 2026). Each address as a whole may make `perIpMax`: one office, or a site's guards on one mobile network, share one
 * public address, so an address-only limit of 600 a minute would have refused most of an office opening Prima at 8.30.
 */
export function rateLimit(
  max = Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
  windowMs = 60_000,
  now: () => number = Date.now,
  perIpMax = Number(process.env.RATE_LIMIT_PER_IP_PER_MIN ?? Math.max(max, 20_000)),
  identify: (authorization: string, req: object) => Promise<string | null> | string | null = () => null,
  identifyConcurrency = Number(process.env.RATE_IDENTIFY_CONCURRENCY ?? 8),
  identifyQueue = Number(process.env.RATE_IDENTIFY_QUEUE ?? 64),
) {
  const hits = new Map<string, { n: number; until: number }>();
  const count = (key: string, t: number) => {
    let h = hits.get(key);
    if (!h || h.until <= t) {
      if (hits.size > 50_000) for (const [k, v] of hits) if (v.until <= t) hits.delete(k);
      h = { n: 0, until: t + windowMs };
      hits.set(key, h);
    }
    h.n += 1;
    return h;
  };
  const who = async (auth: unknown, req: object): Promise<string | null> => {
    if (typeof auth !== 'string' || !auth) return null;
    try {
      return (await identify(auth, req)) || null;
    } catch {
      return null;
    }
  };
  // Sign-in checks per address (Arisha review, 3 Nov 2026): at most `identifyConcurrency` run at once, up to
  // `identifyQueue` more wait their turn, and anything beyond is refused with 429. Nothing passes unchecked, so a burst
  // cannot skip the per-person count, and AuthGuard reuses this same check (auth.ts signInCheck), never a second one.
  const gates = new Map<string, { running: number; waiting: (() => void)[] }>();
  const enter = (ip: string): Promise<void> | null => {
    let g = gates.get(ip);
    if (!g) gates.set(ip, (g = { running: 0, waiting: [] }));
    if (g.running < identifyConcurrency) {
      g.running++;
      return Promise.resolve();
    }
    if (g.waiting.length >= identifyQueue) return null;
    return new Promise<void>((resolve) => g!.waiting.push(resolve));
  };
  const leave = (ip: string) => {
    const g = gates.get(ip);
    if (!g) return;
    const nextUp = g.waiting.shift();
    if (nextUp) nextUp(); // the slot passes straight to the next waiting request
    else if (--g.running <= 0) gates.delete(ip);
  };
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/api/health' || req.path.startsWith('/api/integrations/')) return next();
    const ip = req.ip ?? 'unknown';
    const refuse = (h: { until: number }, t: number) => {
      res.setHeader('Retry-After', String(Math.ceil((h.until - t) / 1000)));
      res.status(429).json({ message: 'Too many requests. Wait a minute and try again.' });
    };
    // The address count comes first and costs nothing: an address over its limit is refused before any sign-in check.
    const t0 = now();
    const a = count(`ip:${ip}`, t0);
    if (a.n > perIpMax) return refuse(a, t0);
    const auth = req.headers?.authorization;
    const needsCheck = typeof auth === 'string' && auth.length > 0;
    const turn = needsCheck ? enter(ip) : Promise.resolve();
    if (!turn) return refuse({ until: t0 + 1000 }, t0);
    void turn
      .then(() => (needsCheck ? who(auth, req).finally(() => leave(ip)) : null))
      .then(
        (id) => {
          const t = now();
          const s = count(id ? `u:${id}` : `anon:${ip}`, t);
          if (s.n > max) return refuse(s, t);
          next();
        },
        (e) => next(e),
      );
  };
}

/**
 * JSON never carries a person's PIN or its hash back to a browser, whatever a screen asks for (it is checked on the
 * server only). 'pin' still covers any record from before PINs were hashed.
 */
export function hideSecrets(key: string, value: unknown): unknown {
  return key === 'pin' || key === 'pinHash' ? undefined : value;
}
