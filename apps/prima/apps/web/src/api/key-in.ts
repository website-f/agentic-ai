import type { KeyInAnyPaper, KeyInResult } from '@prima/core';

/** Key-in helper, "Isi automatik" (rule KEY-IN). Suggests field values for a form; nothing here saves a record. */
export interface KeyInStatus { allowed: boolean; online: boolean; consentVersion: string }
export interface KeyInAsk { text: string; typed?: Record<string, unknown>; prima?: Record<string, unknown> }
export interface KeyInClient {
  keyInStatus(signal?: AbortSignal): Promise<KeyInStatus>;
  keyInRead(paper: KeyInAnyPaper, ask: KeyInAsk, signal?: AbortSignal): Promise<KeyInResult>;
}
