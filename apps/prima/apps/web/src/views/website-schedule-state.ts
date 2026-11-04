/** Per-mounted-visit state, never shared across visits or signed-in users. */
export interface WebsiteVisit { active: boolean; attempted: boolean; generation: number; attemptGeneration?: number }
type Board = { allowed: boolean; schedule?: { runs: boolean; auto: boolean } };
export async function loadWebsiteVisit<B extends Board>(client: {
  websiteBoard(): Promise<B>;
  websiteAction(action: string, input: Record<string, unknown>): Promise<unknown>;
}, visit: WebsiteVisit): Promise<B> {
  const generation = ++visit.generation;
  const board = await client.websiteBoard();
  if (!visit.active || generation !== visit.generation || !board.allowed || !board.schedule?.runs || !board.schedule.auto || visit.attempted) return board;
  visit.attempted = true;
  visit.attemptGeneration = generation;
  try {
    const result = await client.websiteAction('runSchedule', {}) as { ran: boolean; reviews: number; checks: number; sent: number };
    return visit.active && generation === visit.generation && result.ran && (result.reviews || result.checks || result.sent) ? client.websiteBoard() : board;
  } catch (error) {
    // A stale failure must not clear a newer attempt; a read-only reload must still permit retry.
    if (visit.attemptGeneration === generation) visit.attempted = false;
    throw error;
  }
}
/** Monthly assignment/summary notices point to a month, not an individual check record. */
export const websiteNoticeIsMonth = (link: { kind: string; id: string }) => link.kind === 'check' && /^\d{4}-\d{2}$/.test(link.id);
