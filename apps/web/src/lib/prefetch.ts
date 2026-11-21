/**
 * P104: a page's first data, asked for by the router while the page's code downloads (route
 * loaders) and when the pointer rests on a link to it (the router's intent preload), instead
 * of after the page has drawn. Every query here is one the page asks for on its first render,
 * with the same key, so nothing extra is fetched: the page finds it in the cache or in flight.
 * A query that is still fresh is not asked again; on a hover (`preload`) only what is not in the
 * cache at all is asked for, so moving the pointer over the sidebar does not refresh anything.
 * Failures are left to the page, which shows them as before.
 *
 * Loaded on demand by the router (its own small file), so none of this is in the first download.
 */
import type { QueryClient } from "@tanstack/react-query";

import { recentChatsQuery } from "./chat-recent";
import { myAllowanceQuery } from "./allowance";
import { deskQuery, layoutOf, meetingsQuery, pinsQuery } from "./desk";
import { formsQuery } from "./forms";
import { m365SummaryQuery, mailAccountsQuery, mailListQuery } from "./m365";
import { microsoftAccountQuery, microsoftConfigQuery, myMailboxesQuery } from "./microsoft";
import { assignedTasksQuery, teamPeopleQuery } from "./people";
import { reviewCountQuery } from "./provenance";
import { branchesQuery, systemStatusQuery } from "./queries";
import { budgetsQuery, pingsQuery } from "./teams";
import { prefsQuery } from "./tutorial";
import { agentsQuery, approvalsQuery } from "./work";

// Each query keeps its own types where it is defined; here only its key and fetch matter.
type Warmable = { queryKey: readonly unknown[] };
type Fetchable = Parameters<QueryClient["prefetchQuery"]>[0];

function warm(qc: QueryClient, preload: boolean, ...queries: Warmable[]): void {
  for (const q of queries) {
    if (preload && qc.getQueryData(q.queryKey) !== undefined) continue;
    void qc.prefetchQuery(q as Fetchable);
  }
}

/** Every signed-in page: the shell's status badge, company switcher and saved language, once
 * (the shell stays on screen and keeps them fresh itself). */
export function warmShell(qc: QueryClient): void {
  warm(qc, true, systemStatusQuery, branchesQuery, prefsQuery);
}

/** Command center ("/"): its cards. */
export function warmHome(qc: QueryClient, preload: boolean): void {
  warm(qc, preload, systemStatusQuery, reviewCountQuery, pingsQuery, budgetsQuery);
}

/** My workspace: the desk, and on its first tab the forms due and work given to the person
 * (Today), which otherwise waited for the desk to arrive before being asked for; then, as soon
 * as the desk says they show, today's meetings and the AI allowance. */
export function warmDesk(qc: QueryClient, preload: boolean, tab: string | undefined): void {
  warm(qc, preload, deskQuery, pinsQuery);
  if (tab) return;
  warm(qc, preload, formsQuery(), assignedTasksQuery);
  void qc
    .ensureQueryData(deskQuery)
    .then((desk) => {
      const shown = new Set(layoutOf(desk).sections.filter((s) => !s.hidden).map((s) => s.id));
      if (shown.has("today") && desk.may_assist) warm(qc, preload, meetingsQuery(true));
      if (shown.has("ai") && desk.can_ask) warm(qc, preload, myAllowanceQuery);
    })
    .catch(() => {});
}

/** Tasks: the people filter and the agents (asked for late, after the columns had drawn). */
export function warmTasks(qc: QueryClient, preload: boolean): void {
  warm(qc, preload, teamPeopleQuery, agentsQuery);
}

export function warmApprovals(qc: QueryClient, preload: boolean): void {
  warm(qc, preload, approvalsQuery("pending"));
}

export function warmChat(qc: QueryClient, preload: boolean): void {
  warm(qc, preload, agentsQuery, recentChatsQuery);
}

/** Microsoft 365 (P122): the connection, the person's account, their Work and Personal
 * mailboxes, their other email accounts and the tab counts, all at once (each answers even
 * when nothing is set up; they used to wait for each other), then with the main account
 * connected, its inbox. `box`: a shared mailbox in the address (its mail waits for the page). */
export function warmMail(qc: QueryClient, preload: boolean, box: string | undefined): void {
  warm(qc, preload, microsoftConfigQuery, microsoftAccountQuery, myMailboxesQuery, mailAccountsQuery, m365SummaryQuery());
  if (box) return;
  void qc
    .ensureQueryData(microsoftAccountQuery)
    .then((a) => {
      if (a?.connected && a.status !== "reconnect_needed") warm(qc, preload, mailListQuery("inbox", "", false));
    })
    .catch(() => {});
}
