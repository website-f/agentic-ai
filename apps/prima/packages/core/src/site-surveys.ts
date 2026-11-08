import { AccessDenied } from "./access";
import { isGroupLeader } from "./access";
import { sha256Hex } from "./audit";
import { RULES } from "./rules";
import type { PrimaService } from "./service";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { dateOf } from "./time";
import { toMs } from "./time";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";


export type SurveyRisk = 'theft' | 'trespass' | 'vandalism' | 'dark_areas' | 'crowd' | 'cash' | 'vehicles' | 'flood' | 'armed_threat';
export const SURVEY_RISKS: SurveyRisk[] = ['theft', 'trespass', 'vandalism', 'dark_areas', 'crowd', 'cash', 'vehicles', 'flood', 'armed_threat'];
export const SURVEY_RISK_LABEL: Record<SurveyRisk, string> = {
  theft: 'Theft',
  trespass: 'Trespassing',
  vandalism: 'Vandalism',
  dark_areas: 'Dark areas',
  crowd: 'Crowds',
  cash: 'Cash handling',
  vehicles: 'Many vehicles',
  flood: 'Flood',
  armed_threat: 'Armed threat',
};

export type SurveySiteType = 'office' | 'factory' | 'warehouse' | 'residential' | 'school' | 'hospital' | 'government' | 'construction' | 'retail' | 'other';
export const SURVEY_SITE_TYPES: SurveySiteType[] = ['office', 'factory', 'warehouse', 'residential', 'school', 'hospital', 'government', 'construction', 'retail', 'other'];
export const SURVEY_SITE_TYPE_LABEL: Record<SurveySiteType, string> = {
  office: 'Office',
  factory: 'Factory',
  warehouse: 'Warehouse',
  residential: 'Housing',
  school: 'School',
  hospital: 'Hospital or clinic',
  government: 'Government building',
  construction: 'Construction site',
  retail: 'Shop or mall',
  other: 'Other',
};

export type SurveyUnit = 'm' | 'm2' | 'unit';
export const SURVEY_UNIT_LABEL: Record<SurveyUnit, string> = { m: 'm', m2: 'm²', unit: 'units' };

/** One guard post the surveyor proposes: how many hours a day it is manned, shift length and guards per shift. */
export interface SurveyPost {
  name: string;
  coverHours: 8 | 12 | 24;
  shiftHours: 8 | 12;
  guardsPerShift: number;
  armed: boolean;
}

export interface SurveyMeasure {
  label: string;
  value: number;
  unit: SurveyUnit;
}

export interface SurveyDetails {
  siteType: SurveySiteType;
  operatingHours: string;
  perimeterM: number | null;
  areaM2: number | null;
  floors: number | null;
  entrances: number | null;
  vehicleGates: number | null;
  cctvCameras: number | null;
  lighting: 'good' | 'poor' | 'none';
  fence: 'full' | 'partial' | 'none';
  alarm: boolean;
  guardhouse: boolean;
}

/** A photo as the phone listed it when it sent the survey; `received` turns true when its file arrives and matches. */
export interface SurveyPhotoRef {
  n: number;
  sha256: string;
  bytes: number;
  caption: string;
  capturedAt: IsoDateTime;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  received: boolean;
}

export type SurveyStatus = 'receiving_photos' | 'submitted' | 'accepted' | 'returned';
export type SurveyGps = 'ok' | 'weak' | 'none';
export type SurveyTime = 'ok' | 'sent_later' | 'clock_wrong';

export interface SiteSurvey {
  /** Made on the phone (svy-<uuid>) so the same survey sent twice is recognised. */
  id: Id;
  companyId: Id;
  ref: string;
  leadId: Id | null;
  siteId: Id | null;
  place: string;
  address: string;
  surveyorId: Id;
  surveyorName: string;
  surveyorTitle: string;
  /** Phone times: when the form was started and finished. Shown, never trusted. */
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime;
  /** Server time it arrived: the trusted time. */
  receivedAt: IsoDateTime;
  time: SurveyTime;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  gps: SurveyGps;
  details: SurveyDetails;
  measures: SurveyMeasure[];
  risks: SurveyRisk[];
  riskNote: string;
  posts: SurveyPost[];
  /** Guards on duty in a day across all posts, worked out by the server from the posts. */
  guardsPerDay: number;
  findings: string;
  /**
   * Why there are no photos: some sites do not allow photography (for example a protected place under the Protected
   * Areas and Protected Places Act 1959, or a client's own rule). Empty when photos were taken.
   */
  noPhotoReason: string;
  photos: SurveyPhotoRef[];
  /** SHA-256 of the survey content as received: a resend must match it exactly. */
  contentSha256: string;
  /** A survey this one redoes after the Project Director returned it. */
  redoOf: Id | null;
  status: SurveyStatus;
  review: { byId: Id; by: string; at: IsoDateTime; outcome: 'accepted' | 'returned'; reason: string } | null;
  /** What the accept did to the sales lead (filled the survey step, or only noted it). */
  leadNote: string | null;
  log: { at: IsoDateTime; by: string; what: string; note?: string }[];
}

export interface SiteSurveyPhoto {
  id: Id;
  companyId: Id;
  surveyId: Id;
  n: number;
  sha256: string;
  bytes: number;
  /** Stamped JPEG as a data URL, like the other evidence photos. */
  image: string;
  takenBy: string;
  receivedAt: IsoDateTime;
}

export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  receiving_photos: 'Photos still coming',
  submitted: 'With the Project Director',
  accepted: 'Accepted',
  returned: 'Returned',
};

const SURVEY_ID = /^svy-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const IMAGE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** The Project Director (Fauzan, 5 Nov 2026): the COO, the Operations General Manager and the Operations Director. */
export function isProjectDirector(user: User): boolean {
  return user.role === 'pwvsb_officer' && !user.integration && (user.opsTier === 'coo' || user.opsTier === 'ogm' || user.opsTier === 'ops_director');
}

/** Guards on duty in a day: each post's guards per shift times the shifts needed to cover its hours. */
export function guardsPerDay(posts: Pick<SurveyPost, 'coverHours' | 'shiftHours' | 'guardsPerShift'>[]): number {
  return posts.reduce((n, p) => n + p.guardsPerShift * Math.ceil(p.coverHours / p.shiftHours), 0);
}

// ---------- Checking what the phone sent ----------

type Obj = Record<string, unknown>;
const obj = (v: unknown, what: string): Obj => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequest(`${what} is missing.`);
  return v as Obj;
};
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const longText = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, what: string, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequest(`${what} must be between ${min} and ${max.toLocaleString('en-MY')}.`);
  return Math.round(n * 10) / 10;
};
const int = (v: unknown, what: string, min: number, max: number): number => {
  const n = num(v, what, min, max);
  if (n === null || !Number.isInteger(n)) throw new BadRequest(`${what} must be a whole number from ${min} to ${max}.`);
  return n;
};
const coord = (v: unknown, lim: number): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
const when = (v: unknown, what: string): IsoDateTime => {
  if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(toMs(v))) throw new BadRequest(`${what} is not a valid time.`);
  return v;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

export interface SurveyContent {
  companyId: Id;
  leadId: Id | null;
  siteId: Id | null;
  place: string;
  address: string;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  details: SurveyDetails;
  measures: SurveyMeasure[];
  risks: SurveyRisk[];
  riskNote: string;
  posts: SurveyPost[];
  findings: string;
  noPhotoReason: string;
  photos: Omit<SurveyPhotoRef, 'received'>[];
  redoOf: Id | null;
}

/** Turns what the phone sent into a fixed shape, refusing anything out of range. Pure: no store, no clock. */
export function readSurveyContent(raw: unknown): { id: Id; content: SurveyContent } {
  const r = RULES.siteSurvey.value;
  const b = obj(raw, 'The survey');
  const id = typeof b.id === 'string' && SURVEY_ID.test(b.id) ? b.id : null;
  if (!id) throw new BadRequest('This survey has no valid number. Open it on the phone again and send it.');
  const companyId = text(b.companyId, 40);
  if (!companyId) throw new BadRequest('Choose the company the survey is for.');
  const d = obj(b.details, 'The site details');
  const lat = coord(b.lat, 90);
  const lng = lat === null ? null : coord(b.lng, 180);
  const acc = lat === null || lng === null ? null : num(b.accuracyM, 'GPS accuracy', 0, 100_000);
  const startedAt = when(b.startedAt, 'The start time');
  const finishedAt = when(b.finishedAt, 'The finish time');
  // A phone clock that jumped back while the form was open is marked for the Project Director, never refused: the
  // surveyor cannot change these times, so a refusal would trap the survey on the phone.

  const measuresIn = Array.isArray(b.measures) ? b.measures : [];
  if (measuresIn.length > r.maxMeasures) throw new BadRequest(`Give at most ${r.maxMeasures} extra measurements.`);
  const measures: SurveyMeasure[] = measuresIn.map((m, i) => {
    const o = obj(m, `Measurement ${i + 1}`);
    const label = text(o.label, 80);
    if (!label) throw new BadRequest(`Name measurement ${i + 1}.`);
    return { label, value: num(o.value, label, 0, 1_000_000) ?? 0, unit: pick(o.unit, ['m', 'm2', 'unit'] as const, 'm') };
  });

  const postsIn = Array.isArray(b.posts) ? b.posts : [];
  if (!postsIn.length) throw new BadRequest('Add at least one guard post.');
  if (postsIn.length > r.maxPosts) throw new BadRequest(`Give at most ${r.maxPosts} guard posts.`);
  const posts: SurveyPost[] = postsIn.map((p, i) => {
    const o = obj(p, `Post ${i + 1}`);
    const name = text(o.name, 80) || `Post ${i + 1}`;
    return {
      name,
      coverHours: o.coverHours === 8 ? 8 : o.coverHours === 12 ? 12 : 24,
      shiftHours: o.shiftHours === 8 ? 8 : 12,
      guardsPerShift: int(o.guardsPerShift, `Guards per shift at ${name}`, 1, 50),
      armed: o.armed === true,
    };
  });

  const photosIn = Array.isArray(b.photos) ? b.photos : [];
  const noPhotoReason = photosIn.length ? '' : longText(b.noPhotoReason, 300);
  if (photosIn.length < r.minPhotos && noPhotoReason.length < 5)
    throw new BadRequest(`Take at least ${r.minPhotos} photo of the site, or say why photos are not allowed there.`);
  if (photosIn.length > r.maxPhotos) throw new BadRequest(`Send at most ${r.maxPhotos} photos.`);
  const seen = new Set<string>();
  const photos = photosIn.map((p, i) => {
    const o = obj(p, `Photo ${i + 1}`);
    const sha256 = typeof o.sha256 === 'string' && SHA.test(o.sha256) ? o.sha256 : null;
    if (!sha256) throw new BadRequest(`Photo ${i + 1} has no valid fingerprint. Take it again.`);
    if (seen.has(sha256)) throw new BadRequest(`Photo ${i + 1} is the same picture as another one. Remove it.`);
    seen.add(sha256);
    const bytes = int(o.bytes, `Photo ${i + 1} size`, 1, RULES.evidenceGeo.value.maxImageBytes);
    const plat = coord(o.lat, 90);
    const plng = plat === null ? null : coord(o.lng, 180);
    return {
      n: i + 1,
      sha256,
      bytes,
      caption: text(o.caption, 200),
      capturedAt: when(o.capturedAt, `Photo ${i + 1} time`),
      lat: plng === null ? null : plat,
      lng: plng,
      accuracyM: plng === null ? null : num(o.accuracyM, 'Photo GPS accuracy', 0, 100_000),
    };
  });

  const risks = [...new Set((Array.isArray(b.risks) ? b.risks : []).filter((x): x is SurveyRisk => SURVEY_RISKS.includes(x as SurveyRisk)))];
  const findings = longText(b.findings, 2000);
  if (findings.length < 3) throw new BadRequest('Write what you found at the site.');
  const redoOf = typeof b.redoOf === 'string' && SURVEY_ID.test(b.redoOf) ? b.redoOf : null;

  return {
    id,
    content: {
      companyId,
      leadId: typeof b.leadId === 'string' && b.leadId ? b.leadId.slice(0, 160) : null,
      siteId: typeof b.siteId === 'string' && b.siteId ? b.siteId.slice(0, 160) : null,
      place: text(b.place, 160),
      address: text(b.address, 300),
      startedAt,
      finishedAt,
      lat: lng === null ? null : lat,
      lng,
      accuracyM: acc,
      details: {
        siteType: pick(d.siteType, SURVEY_SITE_TYPES, 'other'),
        operatingHours: text(d.operatingHours, 80),
        perimeterM: num(d.perimeterM, 'Perimeter', 0, 100_000),
        areaM2: num(d.areaM2, 'Area', 0, 10_000_000),
        floors: num(d.floors, 'Floors', 0, 200),
        entrances: num(d.entrances, 'Entrances', 0, 500),
        vehicleGates: num(d.vehicleGates, 'Vehicle gates', 0, 200),
        cctvCameras: num(d.cctvCameras, 'CCTV cameras', 0, 5000),
        lighting: pick(d.lighting, ['good', 'poor', 'none'] as const, 'good'),
        fence: pick(d.fence, ['full', 'partial', 'none'] as const, 'full'),
        alarm: d.alarm === true,
        guardhouse: d.guardhouse === true,
      },
      measures,
      risks,
      riskNote: longText(b.riskNote, 500),
      posts,
      findings,
      noPhotoReason,
      photos,
      redoOf,
    },
  };
}

/** The fingerprint of the content: same order of fields every time, so a resend of the same survey matches. */
export function surveyContentSha(id: Id, c: SurveyContent): string {
  return sha256Hex(JSON.stringify([id, c]));
}

// ---------- Service ----------

/** The database has no site survey tables yet: the phone keeps the survey and tries again later (HTTP 503). */
export class SurveyStorageMissing extends Error {
  constructor() {
    super('Site survey storage is not switched on yet. Your survey stays on the phone and is sent later.');
    this.name = 'SurveyStorageMissing';
  }
}

export class SiteSurveyService {
  private ready: Promise<void> | null = null;
  constructor(
    private store: Store,
    private svc: PrimaService,
  ) {}

  /** Fails closed when the database step for surveys has not been installed. */
  private async storage(): Promise<void> {
    this.ready ??= (async () => {
      if ((await this.store.siteSurveyProblems?.())?.length) throw new SurveyStorageMissing();
    })();
    return this.ready;
  }

  /** Whether this person may survey a site for the company: sales preparers and site visitors. */
  private seen = new Map<string, Promise<boolean>>();
  /** Permission answers are kept for this one request, so a long list reads the grants once, not once per row. */
  private can(user: User, action: 'view' | 'commercial.view' | 'commercial.prepare' | 'site.visit', companyId: Id): Promise<boolean> {
    const k = `${user.id}|${action}|${companyId}`;
    let v = this.seen.get(k);
    if (!v) this.seen.set(k, (v = this.svc.canDo(user, action, companyId)));
    return v;
  }

  private async maySurvey(user: User, companyId: Id): Promise<boolean> {
    if (user.integration || user.role === 'site_device' || user.role === 'guard') return false;
    return (await this.can(user, 'commercial.prepare', companyId)) || (await this.can(user, 'site.visit', companyId));
  }

  private async mayReview(user: User, companyId: Id): Promise<boolean> {
    return isProjectDirector(user) && (await this.can(user, 'view', companyId));
  }

  /** Sites this person may survey: a site officer only their own sites; company-wide visitors every site. */
  private async maySurveySite(user: User, companyId: Id, siteId: Id): Promise<boolean> {
    if (user.role === 'supervisor') return user.siteIds.includes(siteId) && (await this.can(user, 'site.visit', companyId));
    return this.can(user, 'site.visit', companyId);
  }

  /** Who sees a survey: the surveyor, the Project Director, group leadership and the company's own sales side. */
  private async maySee(user: User, s: SiteSurvey): Promise<boolean> {
    if (s.surveyorId === user.id) return true;
    if (await this.mayReview(user, s.companyId)) return true;
    if (isGroupLeader(user) && (await this.can(user, 'view', s.companyId))) return true;
    return (user.role === 'company_manager' || user.role === 'admin_exec') && (await this.can(user, 'commercial.view', s.companyId));
  }

  /**
   * What the phone keeps for working with no signal: the companies this person may survey for, with their open leads
   * and sites. Names only; no client contacts, prices or staff records.
   */
  async setup(user: User) {
    await this.storage();
    const companies = await this.svc.visibleCompanies(user);
    const out: { id: Id; name: string; code: string; leads: { id: Id; ref: string; prospect: string }[]; sites: { id: Id; code: string; name: string }[] }[] = [];
    for (const c of companies) {
      if (!(await this.maySurvey(user, c.id))) continue;
      const leads = (await this.can(user, 'commercial.view', c.id))
        ? (await this.store.list('salesLeads', { companyId: c.id }))
            .filter((l) => !l.closed && l.stage !== 'won')
            .map((l) => ({ id: l.id, ref: l.ref, prospect: l.prospect }))
        : [];
      const sites = [];
      for (const s of await this.store.list('sites', { companyId: c.id })) {
        if (await this.maySurveySite(user, c.id, s.id)) sites.push({ id: s.id, code: s.code, name: s.name });
      }
      out.push({ id: c.id, name: c.name, code: c.code, leads: leads.slice(0, 200), sites: sites.slice(0, 300) });
    }
    return { user: { id: user.id, name: user.name }, companies: out, rule: RULES.siteSurvey, at: this.svc.now() };
  }

  /**
   * Receives a finished survey from the phone. The same survey sent again returns what is already held (the phone
   * lost the answer); different content under the same number is refused. Photos follow one by one (addPhoto).
   */
  async receive(user: User, raw: unknown) {
    await this.storage();
    const { id, content: c } = readSurveyContent(raw);
    const sha = surveyContentSha(id, c);
    // Two sends of a new survey at once (the phone retried while the first was still going) go one after the other.
    if (this.store.lock) await this.store.lock('siteSurveys', id);
    const company = await this.store.get('companies', c.companyId);
    if (!company || !(await this.maySurvey(user, c.companyId))) throw new AccessDenied('commercial.prepare', c.companyId);

    const existing = await this.store.get('siteSurveys', id);
    if (existing) {
      if (existing.surveyorId !== user.id || existing.contentSha256 !== sha)
        throw new BadRequest('This survey was already sent with different content. Start a new survey instead.');
      return this.receipt(existing);
    }

    let place = c.place;
    if (c.leadId) {
      const lead = await this.store.get('salesLeads', c.leadId);
      if (!lead || lead.companyId !== c.companyId) throw new BadRequest('That sales lead is not in this company.');
      place ||= lead.prospect;
    }
    if (c.siteId) {
      const site = await this.store.get('sites', c.siteId);
      if (!site || site.companyId !== c.companyId || !(await this.maySurveySite(user, c.companyId, c.siteId)))
        throw new BadRequest('That site is not one you may survey in this company.');
      place = site.name;
    }
    if (!place) throw new BadRequest('Name the place you surveyed.');
    if (c.redoOf) {
      const before = await this.store.get('siteSurveys', c.redoOf);
      if (!before || before.companyId !== c.companyId || before.status !== 'returned') throw new BadRequest('Only a returned survey can be redone.');
      if (before.surveyorId !== user.id) throw new BadRequest('Only the person who made the returned survey redoes it.');
      if ((await this.store.list('siteSurveys', { companyId: c.companyId, redoOf: c.redoOf })).length) throw new BadRequest('This returned survey has already been redone.');
    }
    // The same picture cannot be proof in two surveys of the company.
    for (const p of c.photos) {
      const used = (await this.store.list('siteSurveyPhotos', { companyId: c.companyId, sha256: p.sha256 }))[0];
      if (used) throw new BadRequest(`Photo ${p.n} was already sent with another survey. Take a new photo.`);
    }

    const r = RULES.evidenceGeo.value;
    const now = this.svc.now();
    const lagMin = (toMs(now) - toMs(c.finishedAt)) / 60_000;
    const time: SurveyTime =
      lagMin < -r.clockAheadMin || toMs(c.finishedAt) < toMs(c.startedAt) ? 'clock_wrong' : lagMin > r.sentLaterMin ? 'sent_later' : 'ok';
    const gps: SurveyGps = c.lat === null ? 'none' : c.accuracyM === null || c.accuracyM > r.maxAccuracyM ? 'weak' : 'ok';
    const s: SiteSurvey = {
      id,
      companyId: c.companyId,
      ref: `SV-${company.code}-${id.slice(4, 10).toUpperCase()}`,
      leadId: c.leadId,
      siteId: c.siteId,
      place,
      address: c.address,
      surveyorId: user.id,
      surveyorName: user.name,
      surveyorTitle: user.title,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      receivedAt: now,
      time,
      lat: c.lat,
      lng: c.lng,
      accuracyM: c.accuracyM,
      gps,
      details: c.details,
      measures: c.measures,
      risks: c.risks,
      riskNote: c.riskNote,
      posts: c.posts,
      guardsPerDay: guardsPerDay(c.posts),
      findings: c.findings,
      noPhotoReason: c.noPhotoReason,
      photos: c.photos.map((p) => ({ ...p, received: false })),
      contentSha256: sha,
      redoOf: c.redoOf,
      // With no photos to wait for (photography not allowed), the survey goes straight to the Project Director.
      status: c.photos.length ? 'receiving_photos' : 'submitted',
      review: null,
      leadNote: null,
      log: [
        { at: now, by: user.name, what: 'received', note: time === 'sent_later' ? 'Sent later from the phone (no signal at the site)' : undefined },
        ...(c.photos.length ? [] : [{ at: now, by: user.name, what: 'submitted', note: `No photos: ${c.noPhotoReason}` }]),
      ],
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('siteSurveys', s);
      await tx.audit({
        at: now,
        actor: user.name,
        companyId: s.companyId,
        action: 'survey.receive',
        entity: 'site_survey',
        entityId: s.id,
        summary: `${s.ref} received for ${place}: ${s.posts.length} post(s), ${s.guardsPerDay} guard(s) a day, ${s.photos.length ? `${s.photos.length} photo(s) to follow` : `no photos (${c.noPhotoReason}), with the Project Director`}. Content SHA-256 ${sha.slice(0, 12)}.`,
      });
      return this.receipt(s);
    });
  }

  /** Receives one photo of a survey. It must be the exact picture the survey listed; a resend changes nothing. */
  async addPhoto(user: User, surveyId: Id, raw: unknown) {
    await this.storage();
    const b = obj(raw, 'The photo');
    if (this.store.lock) await this.store.lock('siteSurveys', surveyId);
    const s = await this.store.get('siteSurveys', surveyId);
    if (!s) throw new NotFound('Survey');
    if (s.surveyorId !== user.id) throw new BadRequest('Only the person who made the survey sends its photos.');
    const n = typeof b.n === 'number' && Number.isInteger(b.n) ? b.n : -1;
    const ref = s.photos.find((p) => p.n === n);
    if (!ref) throw new BadRequest('That photo is not in this survey.');
    if (ref.received) return this.receipt(s);
    const image = typeof b.image === 'string' ? b.image : '';
    if (!IMAGE.test(image)) throw new BadRequest('Take the photo with the in-app camera.');
    const bytes = Math.floor(((image.length - image.indexOf(',') - 1) * 3) / 4);
    if (bytes > RULES.evidenceGeo.value.maxImageBytes) throw new BadRequest('The photo is too large. Take it again.');
    const sha256 = sha256Hex(image);
    if (sha256 !== ref.sha256) throw new BadRequest(`Photo ${n} is not the picture this survey listed. It may have changed on the phone.`);
    const now = this.svc.now();
    const photos = s.photos.map((p) => (p.n === n ? { ...p, received: true } : p));
    const complete = photos.every((p) => p.received);
    return this.store.transaction(async (tx) => {
      await tx.insert('siteSurveyPhotos', { id: `svp-${s.id.slice(4)}-${n}`, companyId: s.companyId, surveyId: s.id, n, sha256, bytes, image, takenBy: user.name, receivedAt: now });
      const patch: Partial<SiteSurvey> = { photos };
      if (complete) {
        patch.status = 'submitted';
        patch.log = [...s.log, { at: now, by: user.name, what: 'submitted', note: 'All photos in; sent to the Project Director' }];
      }
      const updated = await tx.update('siteSurveys', s.id, patch);
      if (complete)
        await tx.audit({
          at: now,
          actor: user.name,
          companyId: s.companyId,
          action: 'survey.submit',
          entity: 'site_survey',
          entityId: s.id,
          summary: `${s.ref} complete with ${photos.length} photo(s); with the Project Director.`,
        });
      return this.receipt(updated);
    });
  }

  private receipt(s: SiteSurvey) {
    return { id: s.id, ref: s.ref, status: s.status, missing: s.photos.filter((p) => !p.received).map((p) => p.n), receivedAt: s.receivedAt };
  }

  /** The surveys this person may see, newest first, and which of them wait for their decision. */
  async board(user: User) {
    await this.storage();
    const out: { survey: SiteSurvey; company: string; canReview: boolean }[] = [];
    const companies = await this.svc.visibleCompanies(user);
    const ids = [...new Set([...companies.map((c) => c.id), ...user.companyIds])];
    const rows = ids.length ? await this.store.list('siteSurveys', { companyId: ids }) : [];
    for (const s of rows) {
      if (!(await this.maySee(user, s))) continue;
      out.push({
        survey: s,
        company: companies.find((c) => c.id === s.companyId)?.name ?? s.companyId,
        canReview: s.status === 'submitted' && s.surveyorId !== user.id && (await this.mayReview(user, s.companyId)),
      });
    }
    out.sort((a, b) => Number(b.canReview) - Number(a.canReview) || b.survey.receivedAt.localeCompare(a.survey.receivedAt));
    return {
      rows: out.slice(0, 200),
      isProjectDirector: isProjectDirector(user),
      canSurvey: (await Promise.all(companies.map((c) => this.maySurvey(user, c.id)))).some(Boolean),
      waiting: out.filter((r) => r.canReview).length,
    };
  }

  /** One survey with its photos. */
  async detail(user: User, id: Id) {
    await this.storage();
    const s = await this.store.get('siteSurveys', id);
    if (!s || !(await this.maySee(user, s))) throw new NotFound('Survey');
    const photos = (await this.store.list('siteSurveyPhotos', { companyId: s.companyId, surveyId: s.id })).sort((a, b) => a.n - b.n);
    const lead = s.leadId ? await this.store.get('salesLeads', s.leadId) : undefined;
    return {
      survey: s,
      photos,
      lead: lead ? { id: lead.id, ref: lead.ref, prospect: lead.prospect, stage: lead.stage } : null,
      canReview: s.status === 'submitted' && s.surveyorId !== user.id && (await this.mayReview(user, s.companyId)),
      canRedo: s.status === 'returned' && s.surveyorId === user.id,
    };
  }

  /**
   * The Project Director accepts the survey or returns it, always with a reason (approval reasons, Fauzan
   * 31 Oct 2026), never on their own survey. Accepting fills the linked sales lead's survey step when the lead has been
   * researched, so nobody types the survey again.
   */
  async review(user: User, id: Id, outcome: 'accepted' | 'returned', reasonIn: string) {
    await this.storage();
    if (this.store.lock) await this.store.lock('siteSurveys', id);
    const s = await this.store.get('siteSurveys', id);
    if (!s || !(await this.maySee(user, s))) throw new NotFound('Survey');
    if (!(await this.mayReview(user, s.companyId))) throw new AccessDenied('view', `${s.companyId} (Project Director only)`);
    if (s.surveyorId === user.id) throw new BadRequest('You made this survey, so another Project Director decides it.');
    if (s.status !== 'submitted') throw new BadRequest(s.status === 'receiving_photos' ? 'Photos are still coming from the phone.' : 'This survey has already been decided.');
    if (outcome !== 'accepted' && outcome !== 'returned') throw new BadRequest('Accept or return the survey.');
    const reason = (reasonIn ?? '').trim().slice(0, 500);
    if (reason.length < 3) throw new BadRequest(outcome === 'accepted' ? 'Give a short comment with your acceptance.' : 'Say what the surveyor must check or redo.');
    const now = this.svc.now();
    return this.store.transaction(async (tx) => {
      let leadNote: string | null = null;
      if (outcome === 'accepted' && s.leadId) {
        if (tx.lock) await tx.lock('salesLeads', s.leadId);
        const lead = await tx.get('salesLeads', s.leadId);
        if (lead && lead.companyId === s.companyId && !lead.closed) {
          const hours = s.posts.filter((p) => p.shiftHours === 8).length > s.posts.length / 2 ? 8 : 12;
          const note = { at: now, by: user.name, text: `Site survey ${s.ref} accepted by ${user.name}: ${s.guardsPerDay} guard(s) a day over ${s.posts.length} post(s).` };
          if (lead.research && (lead.stage === 'researched' || lead.stage === 'surveyed')) {
            await tx.update('salesLeads', lead.id, {
              survey: { on: dateOf(s.finishedAt), by: s.surveyorName, guardsNeeded: Math.min(1000, Math.max(1, s.guardsPerDay)), hoursPerDay: hours, note: `From ${s.ref}. ${s.findings}`.slice(0, 500) },
              stage: 'surveyed',
              notes: [...lead.notes, note],
            });
            leadNote = `Filled the survey step of ${lead.ref}.`;
          } else {
            await tx.update('salesLeads', lead.id, { notes: [...lead.notes, note] });
            leadNote = lead.research ? `Noted on ${lead.ref}; its stage was not changed.` : `Noted on ${lead.ref}; research the prospect before the survey step can be filled.`;
          }
          await tx.audit({ at: now, actor: user.name, companyId: s.companyId, action: 'lead.survey', entity: 'sales_lead', entityId: lead.id, summary: `${s.ref}: ${leadNote}` });
        }
      }
      const updated = await tx.update('siteSurveys', s.id, {
        status: outcome,
        review: { byId: user.id, by: user.name, at: now, outcome, reason },
        leadNote,
        log: [...s.log, { at: now, by: user.name, what: outcome, note: reason }],
      });
      await tx.audit({
        at: now,
        actor: user.name,
        companyId: s.companyId,
        action: outcome === 'accepted' ? 'survey.accept' : 'survey.return',
        entity: 'site_survey',
        entityId: s.id,
        summary: `${s.ref} ${outcome} by the Project Director: ${reason}`,
      });
      return updated;
    });
  }
}