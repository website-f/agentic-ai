// Speak-up reports and HR (Fitri package H2, Fauzan 11 Nov 2026: "Yes. But HR can see it."). HR staff read speak-up
// reports, never one where they are named; they only read, the handler still decides. An anonymous reporter's identity
// is never stored, so it stays hidden from HR too. The database wall (db/modules/speak-up-wall-v1.sql) enforces the
// same rule through the speak_up_hr wall.
import type { User, WhistleReport } from './types';
import { isHrDirector } from './access';
import { registerWall } from './walls';

/** HR staff (central HR department, the HR Directors). */
export function holdsSpeakUpHr(user: User): boolean {
  return !user.integration && ((user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user));
}
registerWall('speak_up_hr', holdsSpeakUpHr);

/** Whether this HR person may read this report: never one that names them. */
export function hrMayReadSpeakUp(user: User, r: Pick<WhistleReport, 'implicatedUserIds'>): boolean {
  return holdsSpeakUpHr(user) && !r.implicatedUserIds.includes(user.id);
}
