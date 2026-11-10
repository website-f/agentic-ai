/** P81: staff check-in by place. The calls the check-in card, the Check-in places screen and the review list use. */
import type { CheckinAddress, CheckinInput, CheckinPlaceInput, CheckinPolicy, CheckinRuleInput, PrimaService } from '@prima/core';

type R<K extends keyof PrimaService> = PrimaService[K] extends (...a: never[]) => Promise<infer T> ? T : never;

export type MyCheckin = R<'myCheckin'>;
export type CheckinPreview = R<'checkinPreview'>;
export type CheckinResult = R<'checkIn'>;
export type CheckinSetup = R<'checkinSetup'>;
export type CheckinDay = R<'checkinDay'>;
export type CheckinReviews = R<'checkinReviews'>;
export type CheckinSites = R<'checkinSites'>;
/** P90: the owner's test check-ins (never attendance or pay). */
export type MyTestCheckins = Awaited<ReturnType<PrimaService['ownerTestCheckins']['mine']>>;
export type TestCheckinFix = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  capturedAt?: string | null;
  /** P97: the test's face photo, or no camera with the reason (check-in and check-out only). */
  face?: { image: string; descriptor: number[]; live: boolean } | null;
  noCamera?: { reason: string } | null;
};
/** P97: the check-in and check-out face photos for a manager or HR to look at. */
export type ClockPhotoReviews = R<'clockSnapReviews'>;
export type TrackerNoteInput = { at: string; kind: import('@prima/core').TrackerNoteKind };
export type { CheckinAddress, CheckinInput, CheckinPlaceInput, CheckinPolicy, CheckinRuleInput };

/** One result of the address search (the API asks OpenStreetMap; the browser never does). */
export interface GeoResult {
  label: string;
  lat: number;
  lng: number;
  kind: string;
}

export interface CheckinClient {
  myCheckin(): Promise<MyCheckin>;
  /** What the server would decide for this reading; nothing is saved. */
  checkinPreview(fix: { lat: number; lng: number; accuracyM: number | null }): Promise<CheckinPreview>;
  checkIn(kind: 'in' | 'out', input: CheckinInput): Promise<CheckinResult>;
  checkinSetup(): Promise<CheckinSetup>;
  saveCheckinPlace(input: CheckinPlaceInput): Promise<unknown>;
  setCheckinPlaceActive(id: string, active: boolean): Promise<unknown>;
  setCheckinPolicy(companyId: string, outOfArea: CheckinPolicy): Promise<unknown>;
  setCheckinRules(userIds: string[], rule: CheckinRuleInput): Promise<{ updated: number }>;
  checkinSites(companyId: string): Promise<CheckinSites>;
  checkinDay(date?: string): Promise<CheckinDay>;
  checkinReviews(): Promise<CheckinReviews>;
  decideCheckin(id: string, decision: 'cleared' | 'upheld', note: string): Promise<unknown>;
  /** Address search on the Check-in places map (on Enter or the Search button only). */
  geoSearch(q: string): Promise<{ results: GeoResult[] }>;
  /** The street address at a dropped pin; status 'off' when lookups are switched off here. */
  geoReverse(lat: number, lng: number): Promise<{ address: string | null; status: 'found' | 'none' | 'off' }>;
  /** P90: the owner's TEST check-in, readings on the way, and check-out. Owner only; never attendance or pay. */
  myTestCheckins(): Promise<MyTestCheckins>;
  testCheckin(step: 'in' | 'ping' | 'out', fix: TestCheckinFix): Promise<unknown>;
  /** P97: the face photos to look at, and the decision (fine or follow up) with a comment. */
  clockPhotoReviews(): Promise<ClockPhotoReviews>;
  decideClockPhoto(id: string, decision: 'cleared' | 'upheld', note: string): Promise<unknown>;
}
