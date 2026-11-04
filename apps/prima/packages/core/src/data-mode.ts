/**
 * What the records on a server's screens are (Fauzan, 31 Oct 2026, task T1). The IT pilot does real work on staging, so
 * a fixed "Test data." label there is wrong; but unverified sample records must never be called operational either.
 * The server says which it is with PRIMA_DATA_MODE. Anything other than an exact known value reads as test data, so a
 * missing or mistyped setting fails safe.
 */
export type DataMode = 'test' | 'staging-pilot';

export function dataModeOf(raw: string | undefined): DataMode {
  return raw?.trim() === 'staging-pilot' ? 'staging-pilot' : 'test';
}
