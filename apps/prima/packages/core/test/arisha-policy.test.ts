import { describe, expect, it } from 'vitest';
import {
  ARISHA_DRAFT_RECORD_FIELDS, ARISHA_DRAFT_RECORD_KINDS, arishaLeader, arishaMayDraftRecord,
  arishaMayPrepareFinance, arishaPilotAllowed, arishaRecordFieldsFor, arishaRecordKindsFor,
  arishaMayDraftCompany, ARISHA_COMPANY_DRAFT_FIELDS,
  type ArishaPilotUser,
} from '../src/arisha-policy';
import { RECORD_KINDS } from '../src/records';

const leaders: ArishaPilotUser[] = [
  { id: 'u-fauzan', opsTier: 'ceo' },
  { id: 'u-fd', leadership: 'finance_director' },
  { id: 'u-coo', opsTier: 'coo' },
  { id: 'u-audit', actRole: 'lead' },
];

describe('Arisha leadership drafting policy (not commit authority)', () => {
  it('requires the exact approved identity and its current role', () => {
    expect(leaders.map(arishaLeader)).toEqual(['ceo', 'finance', 'coo', 'act']);
    for (const user of leaders) {
      expect(arishaPilotAllowed(user)).toBe(true);
      expect(arishaPilotAllowed({ id: user.id })).toBe(false);
      expect(arishaPilotAllowed({ ...user, id: 'another-user' })).toBe(false);
      expect(arishaPilotAllowed({ ...user, integration: 'feed' })).toBe(false);
    }
    expect(arishaPilotAllowed({ id: 'u-audit', opsTier: 'ceo' })).toBe(false);
    expect(arishaPilotAllowed({ id: 'u-fd', opsTier: 'coo' })).toBe(false);
  });

  it('separates operations/IT drafts from the Finance paper preparation adapter', () => {
    for (const user of [leaders[0], leaders[2], leaders[3]]) {
      expect(arishaRecordKindsFor(user)).toEqual(['site', 'post', 'checkpoint', 'itDomain']);
      for (const kind of ARISHA_DRAFT_RECORD_KINDS) expect(arishaMayDraftRecord(user, kind)).toBe(true);
    }
    expect(arishaRecordKindsFor(leaders[1])).toEqual([]);
    expect(leaders.map(arishaMayPrepareFinance)).toEqual([true, true, false, true]);
    for (const user of leaders) {
      expect(arishaRecordKindsFor({ ...user, integration: 'feed' })).toEqual([]);
      expect(arishaMayPrepareFinance({ ...user, id: 'fifth-person' })).toBe(false);
    }
  });

  it('keeps CEO company preparation separate from queue and source verification authority', () => {
    expect(leaders.map(arishaMayDraftCompany)).toEqual([true, false, false, false]);
    expect(arishaMayDraftCompany({ ...leaders[0], id: 'another-ceo' })).toBe(false);
    expect(arishaMayDraftCompany({ ...leaders[0], integration: 'feed' })).toBe(false);
    expect(arishaMayDraftRecord(leaders[0], 'company')).toBe(false);
    expect(Object.isFrozen(ARISHA_COMPANY_DRAFT_FIELDS)).toBe(true);
    expect(ARISHA_COMPANY_DRAFT_FIELDS).toContain('sourceRef');
    for (const protectedKey of ['id', 'code', 'companyId', 'verificationStatus']) expect(ARISHA_COMPANY_DRAFT_FIELDS).not.toContain(protectedKey);
    for (const key of ARISHA_COMPANY_DRAFT_FIELDS) expect(RECORD_KINDS.company.fields.some(f => f.key === key && !f.restricted)).toBe(true);
  });

  it('fails closed for all other registry kinds and hostile property names', () => {
    const outsideSlice = Object.keys(RECORD_KINDS).filter((kind) => !ARISHA_DRAFT_RECORD_KINDS.some((allowed) => allowed === kind));
    for (const user of leaders) {
      for (const kind of [...outsideSlice, '__proto__', 'constructor', 'toString', '', 'payment', 'access']) {
        expect(arishaMayDraftRecord(user, kind)).toBe(false);
        expect(arishaRecordFieldsFor(kind)).toEqual([]);
      }
    }
  });

  it('uses explicit, immutable fields and excludes armed status and sensitive records', () => {
    expect(Object.isFrozen(ARISHA_DRAFT_RECORD_KINDS)).toBe(true);
    expect(Object.isFrozen(ARISHA_DRAFT_RECORD_FIELDS)).toBe(true);
    for (const kind of ARISHA_DRAFT_RECORD_KINDS) {
      const fields = arishaRecordFieldsFor(kind);
      expect(Object.isFrozen(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
      for (const key of fields) {
        const spec = RECORD_KINDS[kind].fields.find((field) => field.key === key);
        expect(spec).toBeDefined();
        expect(spec?.restricted).not.toBe(true);
      }
      // The restricted slice can still represent each schema's required create fields.
      for (const field of RECORD_KINDS[kind].fields.filter((f) => f.required)) expect(fields).toContain(field.key);
    }
    expect(arishaRecordFieldsFor('site')).not.toContain('armed');
    for (const kind of ['officeStaff', 'firearm', 'company', 'vehicle', 'stockItem']) expect(arishaRecordFieldsFor(kind)).toEqual([]);
  });
});
