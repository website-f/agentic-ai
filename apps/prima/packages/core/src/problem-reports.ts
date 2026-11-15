import { AccessDenied } from "./access";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import type { Id, IsoDateTime, User } from "./types";
import { registerWall } from "./walls";

/**
 * Part N8 (Fitri package, 13 Nov 2026): "Lapor masalah / Report a problem" on every screen during the learning months.
 * The person writes what went wrong; the screen name is filled in; a photo is optional. It goes to IT support (the IT
 * Lead and the IT team), who reply back to the person. Nothing else is sent: never other people's records.
 */
export interface ProblemReport {
  id: Id;
  reporterId: Id;
  reporter: string;
  screen: string;
  what: string;
  /** Optional screenshot or photo the person chose (data URL), kept small. */
  photo: string | null;
  at: IsoDateTime;
  status: 'open' | 'answered';
  replies: { by: string; byId: Id; at: IsoDateTime; text: string }[];
}

/** IT support reads every report and replies (the IT department; the IT Manager supervises). */
export function holdsItSupport(user: User): boolean {
  return !user.integration && user.role === 'pwvsb_officer' && user.department === 'it';
}
registerWall('it_support', holdsItSupport);

const PHOTO_MAX = 700_000;

export class ProblemReportService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private async ready() {
    if (this.store.hasTable && !(await this.store.hasTable('problemReports')))
      throw new BadRequest('Report a problem is not installed in this database yet (module problem-reports-v1, run by the CEO).');
  }

  async report(user: User, input: Record<string, unknown>) {
    if (user.integration) throw new AccessDenied('view', 'reporting a problem');
    await this.ready();
    const what = String(input.what ?? '').trim().slice(0, 2000);
    if (what.length < 5) throw new BadRequest('Say what went wrong (a sentence is enough).');
    const screen = String(input.screen ?? '').trim().replace(/[^\w ./#:-]/g, '').slice(0, 80) || 'unknown';
    const photo = input.photo == null || input.photo === '' ? null : String(input.photo);
    if (photo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > PHOTO_MAX))
      throw new BadRequest('The photo must be a PNG, JPEG or WebP picture under 500 KB.');
    const at = this.now();
    const id = `prb-${Date.parse(at).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const row: ProblemReport = { id, reporterId: user.id, reporter: user.name, screen, what, photo, at, status: 'open', replies: [] };
    await this.store.transaction(async (tx) => {
      await tx.insert('problemReports', row);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'support.problem_reported', entity: 'problem_report', entityId: id, summary: `Problem reported on ${screen}.` });
    });
    return row;
  }

  /** IT support sees every report; anyone else sees their own, with the replies. */
  async list(user: User) {
    await this.ready();
    const all = await this.store.list('problemReports', {});
    const support = holdsItSupport(user);
    return {
      support,
      reports: all
        .filter((r) => support || r.reporterId === user.id)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100)
        .map((r) => ({ ...r, mayReply: support && r.reporterId !== user.id })),
    };
  }

  async reply(user: User, id: Id, text: string) {
    if (!holdsItSupport(user)) throw new AccessDenied('view', 'replying to problem reports (IT support only)');
    await this.ready();
    const t = String(text ?? '').trim().slice(0, 2000);
    if (t.length < 3) throw new BadRequest('Write the reply.');
    return this.store.transaction(async (tx) => {
      await tx.lock?.('problemReports', id);
      const r = await tx.get('problemReports', id);
      if (!r) throw new NotFound('Problem report');
      if (r.reporterId === user.id) throw new BadRequest('Someone else in IT answers your own report.');
      const at = this.now();
      const next = { replies: [...r.replies, { by: user.name, byId: user.id, at, text: t }].slice(-20), status: 'answered' as const };
      await tx.update('problemReports', id, next);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'support.problem_replied', entity: 'problem_report', entityId: id, summary: `Reply sent to ${r.reporter} about ${r.screen}.` });
      return { ...r, ...next };
    });
  }

  /** IT support's Home: open reports. */
  async homeItems(user: User) {
    if (!holdsItSupport(user)) return [];
    if (this.store.hasTable && !(await this.store.hasTable('problemReports'))) return [];
    const open = (await this.store.list('problemReports', {})).filter((r) => r.status === 'open' && r.reporterId !== user.id);
    if (!open.length) return [];
    return [{ tone: 'warn' as const, tag: 'Support', title: `${open.length} problem report(s) to answer`, detail: open.slice(0, 3).map((r) => `${r.reporter} on ${r.screen}`).join(' · '), go: { view: 'it' as const } }];
  }
}
