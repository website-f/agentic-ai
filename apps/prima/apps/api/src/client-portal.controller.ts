// J1 (P100, Fauzan 11 Nov 2026): the client portal. Two controllers in their own file:
//  - ClientPortalController (public, /api/portal/...): the client's own pages. No Prima sign-in: the signed personal
//    link names the company, client and person; the access code proves it; the session cookie follows. The database
//    session is limited to that one company (Db.asShareLink) and the service keeps to that one client.
//  - ClientPortalStaffController (signed-in staff): the OM opens, resets and closes sign-ins; the company manager and the
//    COO see them (packages/core/src/client-portal.ts decides who).
// Plus the PDF of a monthly report through a report link (/api/share/:token/doc/report/:period).
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PORTAL_SESSION_HOURS } from '@prima/core';
import { AuthGuard, UserId } from './auth';
import { Db } from './db';
import { shareBase, shareSecret, verifyShare } from './share-links';
import {
  PORTAL_COOKIE_CLEAR,
  docBytes,
  langOf,
  portalCookie,
  portalCsp,
  portalFormKey,
  portalHomePage,
  portalSessionFor,
  portalSignInPage,
  signPortalRef,
  verifyPortalRef,
  type Lang,
  type PortalRef,
} from './client-portal';

const str = (v: unknown, name: string, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} is missing or too long`);
  return v;
};
const id = (v: string): string => {
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(v)) throw new BadRequestException('id is not valid');
  return v;
};

function html(res: Response, status: number, body: string) {
  res.setHeader('Content-Security-Policy', portalCsp());
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.type('html');
  return res.status(status).send(body);
}

/** The portal is on only with the same settings as the report links (SHARE_LINK_SECRET and SHARE_LINK_BASE). */
function portalOn(): { secret: string; base: string } | null {
  const secret = shareSecret();
  const base = shareBase();
  return secret && base !== null ? { secret, base } : null;
}

/** The client's words for the problems they can fix, in their language. */
const PROBLEM: Record<Lang, Record<string, string>> = {
  ms: {
    kind: 'Pilih penilaian, aduan atau permintaan.',
    score: 'Pilih penilaian 1 hingga 5.',
    lowScore: 'Beritahu apa yang tidak kena supaya ia boleh dibaiki.',
    text: 'Tulis sedikit butiran (sekurang-kurangnya 5 aksara).',
    requestKind: 'Pilih jenis permintaan.',
    other: 'Tidak dapat dihantar. Sila cuba lagi atau hubungi pengurus akaun anda.',
  },
  en: {
    kind: 'Choose a rating, a complaint or a request.',
    score: 'Choose a rating from 1 to 5.',
    lowScore: 'Tell us what is not right, so it can be fixed.',
    text: 'Write a few words (at least 5 characters).',
    requestKind: 'Choose the kind of request.',
    other: 'It could not be sent. Please try again or call your account manager.',
  },
};

@Controller('api/portal')
export class ClientPortalController {
  constructor(private db: Db) {}

  private ref(token: string): PortalRef | null {
    const on = portalOn();
    return on ? verifyPortalRef(token, on.secret) : null;
  }

  @Get(':ref/start')
  async start(@Param('ref') token: string, @Query('lang') lang: string | undefined, @Headers('cookie') cookie: string | undefined, @Res() res: Response) {
    const l = langOf(lang);
    const ref = this.ref(token);
    if (!ref) return html(res, 404, portalSignInPage(l, 'gone'));
    if (portalSessionFor(cookie, ref, portalOn()!.secret)) return res.redirect(303, `home?lang=${l}`);
    return html(res, 200, portalSignInPage(l, 'start'));
  }

  @Post(':ref/sign-in')
  @HttpCode(200)
  async signIn(@Param('ref') token: string, @Query('lang') lang: string | undefined, @Body() b: Record<string, unknown>, @Res() res: Response) {
    const l = langOf(lang);
    const on = portalOn();
    const ref = this.ref(token);
    if (!on || !ref) return html(res, 404, portalSignInPage(l, 'gone'));
    const code = typeof b?.code === 'string' ? b.code.slice(0, 40) : '';
    try {
      const r = await this.db.asShareLink(ref.c, (svc) => svc.clientPortal().signIn(ref.c, ref.k, ref.u, code));
      if (!r.ok) return html(res, r.locked ? 429 : 401, portalSignInPage(l, r.locked ? 'locked' : 'wrong'));
      res.setHeader('Set-Cookie', portalCookie({ ...ref, v: r.version, exp: Date.now() + PORTAL_SESSION_HOURS * 3_600_000 }, on.secret));
      return res.redirect(303, `home?lang=${l}`);
    } catch {
      return html(res, 404, portalSignInPage(l, 'gone'));
    }
  }

  @Get(':ref/home')
  async home(@Param('ref') token: string, @Query('lang') lang: string | undefined, @Query('sent') sent: string | undefined, @Query('problem') problem: string | undefined, @Headers('cookie') cookie: string | undefined, @Res() res: Response) {
    const l = langOf(lang);
    const on = portalOn();
    const ref = this.ref(token);
    if (!on || !ref) return html(res, 404, portalSignInPage(l, 'gone'));
    const s = portalSessionFor(cookie, ref, on.secret);
    if (!s) return res.redirect(303, `start?lang=${l}`);
    try {
      const h = await this.db.asShareLink(ref.c, (svc) => svc.clientPortal().home(ref.c, ref.k, ref.u, s.v));
      const p = problem && PROBLEM[l][problem] ? PROBLEM[l][problem] : null;
      return html(res, 200, portalHomePage(l, h, portalFormKey(s, on.secret), sent ?? null, p));
    } catch {
      res.setHeader('Set-Cookie', PORTAL_COOKIE_CLEAR);
      return html(res, 404, portalSignInPage(l, 'gone'));
    }
  }

  @Post(':ref/send')
  @HttpCode(200)
  async send(@Param('ref') token: string, @Query('lang') lang: string | undefined, @Body() b: Record<string, unknown>, @Headers('cookie') cookie: string | undefined, @Res() res: Response) {
    const l = langOf(lang);
    const on = portalOn();
    const ref = this.ref(token);
    if (!on || !ref) return html(res, 404, portalSignInPage(l, 'gone'));
    const s = portalSessionFor(cookie, ref, on.secret);
    if (!s || b?.f !== portalFormKey(s, on.secret)) return res.redirect(303, `start?lang=${l}`);
    const kind = b.kind === 'rating' || b.kind === 'complaint' || b.kind === 'request' ? b.kind : null;
    const text = typeof b.text === 'string' ? b.text.slice(0, 500) : '';
    const score = Number(b.score);
    const back = (problem: string) => res.redirect(303, `home?lang=${l}&problem=${problem}`);
    if (!kind) return back('kind');
    if (kind === 'rating' && !(score >= 1 && score <= 5)) return back('score');
    if (kind === 'rating' && score <= 2 && text.trim().length < 3) return back('lowScore');
    if (kind !== 'rating' && text.trim().length < 5) return back('text');
    if (kind === 'request' && typeof b.requestKind !== 'string') return back('requestKind');
    try {
      await this.db.asShareLink(ref.c, (svc) =>
        svc.clientPortal().send(ref.c, ref.k, ref.u, s.v, { kind, score, text, siteId: typeof b.siteId === 'string' && b.siteId ? b.siteId.slice(0, 120) : null, requestKind: typeof b.requestKind === 'string' ? b.requestKind : undefined }),
      );
      return res.redirect(303, `home?lang=${l}&sent=${kind}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      return back(/request/i.test(m) && /Choose/.test(m) ? 'requestKind' : 'other');
    }
  }

  @Get(':ref/doc/:kind/:period')
  async doc(@Param('ref') token: string, @Param('kind') kind: string, @Param('period') period: string, @Headers('cookie') cookie: string | undefined, @Res() res: Response) {
    const on = portalOn();
    const ref = this.ref(token);
    const s = on && ref ? portalSessionFor(cookie, ref, on.secret) : null;
    if (!ref || !s || (kind !== 'report' && kind !== 'slip') || !/^\d{4}-\d{2}$/.test(period)) return html(res, 404, portalSignInPage('ms', 'gone'));
    try {
      const d = await this.db.asShareLink(ref.c, (svc) => svc.clientPortal().doc(ref.c, ref.k, ref.u, s.v, kind, period));
      const f = docBytes(d.data);
      if (!f) return html(res, 404, portalSignInPage('ms', 'gone'));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${kind}-${period}.${f.mime === 'application/pdf' ? 'pdf' : f.mime === 'image/png' ? 'png' : 'jpg'}"`);
      return res.type(f.mime).status(200).send(f.bytes);
    } catch {
      return html(res, 404, portalSignInPage('ms', 'gone'));
    }
  }

  @Post(':ref/sign-out')
  @HttpCode(200)
  signOut(@Query('lang') lang: string | undefined, @Res() res: Response) {
    res.setHeader('Set-Cookie', PORTAL_COOKIE_CLEAR);
    return res.redirect(303, `start?lang=${langOf(lang)}`);
  }
}

/** The PDF of a monthly report through a report link (the link page lists it when the report is kept as a file). */
@Controller('api/share')
export class ShareReportPdfController {
  constructor(private db: Db) {}

  @Get(':token/doc/report/:period')
  async pdf(@Param('token') token: string, @Param('period') period: string, @Res() res: Response) {
    const ref = shareBase() === null ? null : verifyShare(token, shareSecret());
    if (!ref || !/^\d{4}-\d{2}$/.test(period)) return res.status(404).type('text').send('Not available.');
    try {
      const d = await this.db.asShareLink(ref.c, (svc) => svc.clientShareReportPdf(ref.c, ref.k, ref.l, period));
      const f = docBytes(d.data);
      if (!f) return res.status(404).type('text').send('Not available.');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Content-Disposition', `inline; filename="report-${period}.${f.mime === 'application/pdf' ? 'pdf' : 'jpg'}"`);
      return res.type(f.mime).status(200).send(f.bytes);
    } catch {
      return res.status(404).type('text').send('Not available.');
    }
  }
}

@Controller('api')
@UseGuards(AuthGuard)
export class ClientPortalStaffController {
  constructor(private db: Db) {}

  @Get('client-portal')
  desk(@UserId() uid: string) {
    return this.db.asUser(uid, async (svc, u) => ({ ...(await svc.clientPortalDesk(u)), on: portalOn() !== null }));
  }

  private url(ref: PortalRef): string | null {
    const on = portalOn();
    return on ? `${on.base}/api/portal/${signPortalRef(ref, on.secret)}/start` : null;
  }

  @Post('clients/:id/client-portal')
  async open(@UserId() uid: string, @Param('id') clientId: string, @Body() b: Record<string, unknown>) {
    if (!portalOn()) throw new ServiceUnavailableException('The client portal is off: it needs SHARE_LINK_SECRET and SHARE_LINK_BASE, like the report links.');
    const r = await this.db.asUser(uid, (svc, u) => svc.openClientPortal(u, id(clientId), { name: str(b.name ?? '', 'name', 120), post: str(b.post ?? '', 'post', 120) }));
    return { user: r.user, code: r.code, url: this.url(r.ref) };
  }

  @Post('clients/:id/client-portal/:userId/reset')
  async reset(@UserId() uid: string, @Param('id') clientId: string, @Param('userId') portalUserId: string, @Body() b: Record<string, unknown>) {
    if (!portalOn()) throw new ServiceUnavailableException('The client portal is off: it needs SHARE_LINK_SECRET and SHARE_LINK_BASE, like the report links.');
    const r = await this.db.asUser(uid, (svc, u) => svc.resetClientPortal(u, id(clientId), id(portalUserId), str(b.reason ?? '', 'reason', 300)));
    return { user: r.user, code: r.code, url: this.url(r.ref) };
  }

  @Post('clients/:id/client-portal/:userId/close')
  close(@UserId() uid: string, @Param('id') clientId: string, @Param('userId') portalUserId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.closeClientPortal(u, id(clientId), id(portalUserId), str(b.reason ?? '', 'reason', 300)));
  }
}
