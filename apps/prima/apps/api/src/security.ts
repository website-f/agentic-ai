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
 * A simple per-address limit: at most `max` calls in each `windowMs`, then 429 until the window ends. Kept in memory,
 * so each API copy counts on its own (staging runs one or two). Signed system feeds and the health check are not
 * counted. It slows a stuck script or someone guessing; Azure's own protections sit in front of it.
 */
export function rateLimit(max = Number(process.env.RATE_LIMIT_PER_MIN ?? 600), windowMs = 60_000, now: () => number = Date.now) {
  const hits = new Map<string, { n: number; until: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/api/health' || req.path.startsWith('/api/integrations/')) return next();
    const t = now();
    const key = req.ip ?? 'unknown';
    let h = hits.get(key);
    if (!h || h.until <= t) {
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.until <= t) hits.delete(k);
      h = { n: 0, until: t + windowMs };
      hits.set(key, h);
    }
    h.n += 1;
    if (h.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((h.until - t) / 1000)));
      res.status(429).json({ message: 'Too many requests. Wait a minute and try again.' });
      return;
    }
    next();
  };
}

/**
 * JSON never carries a person's PIN or its hash back to a browser, whatever a screen asks for (it is checked on the
 * server only). 'pin' still covers any record from before PINs were hashed.
 */
export function hideSecrets(key: string, value: unknown): unknown {
  return key === 'pin' || key === 'pinHash' ? undefined : value;
}
