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
}
