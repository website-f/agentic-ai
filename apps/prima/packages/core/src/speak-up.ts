// Speak-up (whistleblowing) reports behind a database wall (H2, Fauzan 11 Nov 2026: "Yes. But HR can see it").
// db/modules/speak-up-wall-v1.sql keeps prima.whistle_reports readable only by the handler, a second handler reviewing a
// closing report, a named reporter (own reports) and HR (read only, never a report that names them). The database
// learns who is who from three walls registered here and carried in app.walls by Db.asUser, so the handler list stays
// in one place (rule GRC whistleHandlers). Anonymous reporters come back only by receipt code; leaders and ACT get counts.
import { actRole } from "./access";
import { RULES } from "./rules";
import { registerWall } from "./walls";
import type { User, WhistleReport } from "./types";

/** A whistle handler (rule GRC whistleHandlers): their own reports, and a closing report of another handler to review. */
export function holdsSpeakUpHandlerWall(user: User): boolean {
  return !user.integration && RULES.assurance.value.whistleHandlers.includes(user.id);
}

/**
 * HR reads speak-up reports, read only (Fauzan, 11 Nov 2026: "Yes. But HR can see it"): the HR department's own staff.
 * Never a report that names them (the database refuses it too), never the identity of an anonymous reporter (it is not
 * stored), and never a decision: the handler decides.
 */
export function holdsSpeakUpHrWall(user: User): boolean {
  return !user.integration && user.role === 'pwvsb_officer' && user.department === 'hr';
}

/** Group leaders and ACT: counts only (late, update due, retaliation), never the text. */
export function holdsSpeakUpCountsWall(user: User): boolean {
  return actRole(user) !== null;
}

registerWall('speak_up_handler', holdsSpeakUpHandlerWall);
registerWall('speak_up_hr', holdsSpeakUpHrWall);
registerWall('speak_up_counts', holdsSpeakUpCountsWall);

/** What a receipt code opens: the status, outcome and messages of that one report. */
export interface SpeakUpReceipt {
  code: string;
  at: string;
  status: WhistleReport['status'];
  closedAt: string | null;
  outcome: string | null;
  messages: { at: string; from: 'handler' | 'reporter'; text: string; retaliation: boolean }[];
}

/** What leaders and ACT count from: no text, no names, no company. */
export type SpeakUpSignal = Pick<WhistleReport, 'status' | 'at' | 'acknowledgedAt' | 'closedAt'> & {
  messages: { at: string; from: 'handler' | 'reporter'; retaliation: boolean }[];
};

export type SpeakUpReplyResult = { id: string; code: string; handlerName: string } | { error: 'not_found' | 'too_short' | 'closed' | 'closed_long' };

/** A report reduced to what may be counted (the memory store's stand-in for prima.speak_up_signals). */
export function speakUpSignalOf(r: WhistleReport): SpeakUpSignal {
  return {
    status: r.status,
    at: r.at,
    acknowledgedAt: r.acknowledgedAt,
    closedAt: r.closedAt,
    messages: (r.messages ?? []).map((m) => ({ at: m.at, from: m.from, retaliation: !!m.retaliation })),
  };
}

/** A report reduced to what its receipt code opens (the memory store's stand-in for prima.speak_up_status). */
export function speakUpReceiptOf(r: WhistleReport): SpeakUpReceipt {
  return {
    code: r.code,
    at: r.at,
    status: r.status,
    closedAt: r.closedAt,
    outcome: r.status === 'closed' ? r.outcome : null,
    messages: (r.messages ?? []).map((m) => ({ at: m.at, from: m.from, text: m.text, retaliation: !!m.retaliation })),
  };
}

/**
 * The receipt code's random part: 8 letters and digits from a secure random source (40 bits), so a code cannot be
 * guessed from the time it was sent. Codes made before 11 Nov 2026 keep their 3-character ending and still work.
 */
export function speakUpCodeSuffix(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
