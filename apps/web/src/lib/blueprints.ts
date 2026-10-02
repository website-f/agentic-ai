/** Blueprints (P9): reusable role packages applied to agents. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import type { ToolMode } from "./work";

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  role: string;
  soul: string;
  model_group: string;
  tools: Record<string, ToolMode>;
  autonomy: "ask" | "auto";
  sop_ids: string[];
  skill_ids: string[];
  color: string;
  source: string;
  branch_id: string | null;
  created_by: string;
  created_at: string;
  used_by: number;
}

export interface BlueprintInput {
  name: string;
  description: string;
  role: string;
  soul: string;
  model_group: string;
  tools: Record<string, ToolMode>;
  autonomy: "ask" | "auto";
  sop_ids: string[];
  skill_ids: string[];
  color: string;
}

export const blueprintKeys = { all: ["blueprints"] as const };

export const blueprintsQuery = queryOptions({
  queryKey: blueprintKeys.all,
  queryFn: () => api<Blueprint[]>("/api/blueprints"),
});

export const BLUEPRINT_COLORS = ["#13895f", "#0f8ba0", "#2a78d6", "#7a5af5", "#c2412d", "#b7791f"];
