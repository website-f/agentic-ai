import { describe, expect, it } from 'vitest';
import { allGuideCards, guideCardProblems, REGISTERED_DEPARTMENT_GUIDES } from '../src';

describe('combined guide (R20)', () => {
  it('every department that wrote cards is in the shared guide, and every card passes the shared check', () => {
    expect([...REGISTERED_DEPARTMENT_GUIDES].sort()).toEqual(['act', 'central_admin', 'company_office', 'finance', 'hr']);
    const ids = allGuideCards().map((c) => c.id);
    for (const prefix of ['act.', 'central-admin.', 'fin.', 'hr.', 'office.']) expect(ids.some((i) => i.startsWith(prefix)), prefix).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allGuideCards().flatMap(guideCardProblems)).toEqual([]);
  });
});
