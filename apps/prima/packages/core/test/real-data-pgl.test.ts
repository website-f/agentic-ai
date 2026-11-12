// E5 (Fauzan, 11 Nov 2026): Perfect Global Logistics (PGL) is also an employer of staff, a central employer like PWVSB,
// Merdeka Network, Goodwill Empire and Sasa Team. Synthetic companies and people only.
import { describe, expect, it } from 'vitest';
import {
  CENTRAL_ALIASES,
  CENTRAL_EMPLOYER_IDS,
  CENTRAL_FULL_NAMES,
  LOGISTICS_COMPANY_ID,
  RealDataError,
  centralStaffName,
  generateDataset,
  isCentralEmployer,
  myt,
  parseRealData,
  realDataset,
} from '../src';

const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');
const file = (pglKey = 'pgl') => ({
  format: 'prima-real-data',
  version: 1,
  builtAt: '2026-11-12T09:00:00Z',
  source: 'synthetic test list',
  companies: [
    { key: 'pwvsb', name: 'Central Example Sdn Bhd', role: 'central' },
    { key: pglKey, name: 'Logistics Example Sdn Bhd', role: 'logistics' },
    { key: 'co-alpha-guard', name: 'Alpha Guard Sdn Bhd', role: 'licensed' },
  ],
  staff: [
    { name: 'Test Driver One', email: 'driver.one@example.test', company: pglKey, unit: 'transport', roleHint: 'staff' },
    { name: 'Test Person Two', email: 'two@example.test', company: 'co-alpha-guard', roleHint: 'manager' },
  ],
});

describe('E5: PGL employs staff', () => {
  it('is a central employer with its full name and the names the staff list uses', () => {
    expect(LOGISTICS_COMPANY_ID).toBe('pgl');
    expect(isCentralEmployer('pgl')).toBe(true);
    expect(CENTRAL_EMPLOYER_IDS).toContain('pgl');
    expect(CENTRAL_FULL_NAMES.pgl).toBe('Perfect Global Logistics Sdn Bhd');
    expect(CENTRAL_ALIASES.pgl).toEqual(['Perfect Global Logistics Sdn Bhd', 'Perfect Global Logistics', 'PGL']);
    expect(centralStaffName('pgl')).toBe('Perfect Global Logistics Sdn Bhd (Transport)');
  });

  it('loads PGL staff from the real-data file under PGL, in Transport, with no company record for PGL', () => {
    const ds = realDataset(generateDataset({ today: TODAY, now: NOW }), parseRealData(file()), { today: TODAY });
    const driver = ds.people.find((p) => p.name === 'Test Driver One')!;
    expect(driver.companyId).toBe('pgl');
    expect(ds.companies.some((c) => c.id === 'pgl')).toBe(false);
    expect(ds.companies.map((c) => c.name)).toEqual(['Alpha Guard Sdn Bhd']);
  });

  it('refuses a logistics company under any other key, so PGL never becomes a licensed company record', () => {
    expect(() => parseRealData(file('co-logistics'))).toThrow(RealDataError);
    expect(() => parseRealData(file('co-logistics'))).toThrow(/must be "pgl" for the logistics company/);
  });
});
