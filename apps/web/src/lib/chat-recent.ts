/** GET /api/chat/recent: the person's own latest conversations, across their agents (the Chat
 * page; P104 the router asks for it while the page's code loads). */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export interface RecentChat {
  id: string;
  title: string;
  updated_at: string;
  agent: { id: string; name: string; color: string; role: string; private: boolean; is_twin: boolean };
}

export const recentChatsQuery = queryOptions({
  queryKey: ["chat", "recent"],
  queryFn: () => api<RecentChat[]>("/api/chat/recent?limit=12"),
});
