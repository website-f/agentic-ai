import type { BillSuggestion, BqSuggestion, DraftHelpKind, DraftHelpResult, PostSuggestion } from '@prima/core';

/** Suggested drafts (rule DRAFT-HELP). Off unless the server has it switched on. Nothing here saves a record. */
export interface DraftHelpStatus { on: boolean; kinds: DraftHelpKind[]; consentVersion: string }
export type DraftHelpSuggestion = DraftHelpResult<BqSuggestion | PostSuggestion | BillSuggestion>;
export interface DraftHelpClient {
  draftHelpStatus(signal?: AbortSignal): Promise<DraftHelpStatus>;
  draftHelpSuggest(kind: DraftHelpKind, form: unknown, signal?: AbortSignal): Promise<DraftHelpSuggestion>;
}
