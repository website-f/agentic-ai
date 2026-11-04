import { describe, expect, it } from 'vitest';
import { dataModeOf } from '../src/data-mode';

describe('data mode label (task T1)', () => {
  it('reads only the exact pilot setting as pilot records', () => {
    expect(dataModeOf('staging-pilot')).toBe('staging-pilot');
    expect(dataModeOf(' staging-pilot ')).toBe('staging-pilot');
  });

  it('treats a missing, empty or mistyped setting as test data', () => {
    for (const raw of [undefined, '', 'test', 'Staging-Pilot', 'production', 'live', 'pilot']) expect(dataModeOf(raw)).toBe('test');
  });
});
