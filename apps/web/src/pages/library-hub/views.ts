/** The Library's folders on the Browse tab: the company's own folders, then ready-made ones.
 * Labels and hints are English keys (msg); render them with t(). */
import {
  BooksIcon, ClockIcon, CloudArrowUpIcon, FileTextIcon, FilesIcon, GlobeIcon, ListChecksIcon, RobotIcon, SealCheckIcon, StackIcon,
  TreeStructureIcon, type Icon,
} from "@phosphor-icons/react";

import { msg, t } from "@/i18n";
import type { DocTemplate } from "@/lib/documents";
import type { StoreView } from "@/lib/file-store";
import type { Branch } from "@/lib/types";
import type { SOP } from "@/lib/work";

export const VIEW_INFO: Record<StoreView, { label: string; hint: string; icon: Icon }> = {
  folders: { label: msg("Company folders"), hint: msg("Every file in its folder, with uploads of whole folders and zips."), icon: TreeStructureIcon },
  documents: { label: msg("Documents"), hint: msg("Quotations, letters, proposals and reports drafted by people or agents."), icon: FilesIcon },
  sops: { label: msg("SOPs"), hint: msg("Written procedures agents follow."), icon: FileTextIcon },
  library: { label: msg("Guidelines"), hint: msg("Guidelines and manuals agents search and cite."), icon: BooksIcon },
  templates: { label: msg("Templates"), hint: msg("Starting points for the documents you write again and again."), icon: StackIcon },
  review: { label: msg("Waiting for review"), hint: msg("Documents AI made that wait for a person to approve or send back."), icon: SealCheckIcon },
  tasks: { label: msg("Task files"), hint: msg("Each piece of work with everything it made, downloaded or was given, its helpers' too."), icon: ListChecksIcon },
  recent: { label: msg("Recent"), hint: msg("The newest files of every kind, whoever added them."), icon: ClockIcon },
  agents: { label: msg("Made by AI"), hint: msg("Documents, reports and files your agents produced."), icon: RobotIcon },
  downloads: { label: msg("From websites"), hint: msg("Files agents downloaded from websites and portals, such as tender documents."), icon: GlobeIcon },
  uploaded: { label: msg("Uploaded"), hint: msg("Files people uploaded or attached to work."), icon: CloudArrowUpIcon },
};

/** The ready-made folders, in groups, after the company's own folders. */
export const VIEW_GROUPS: { title: string; views: StoreView[] }[] = [
  { title: msg("Documents and know-how"), views: ["documents", "sops", "library", "templates"] },
  { title: msg("Quick views"), views: ["review", "tasks", "recent", "agents", "downloads", "uploaded"] },
];

/** Who follows a SOP, in words. The server calls the attach-to-agents scope "Library", which
 * now names the whole Library: say what it does instead. */
export function sopScopeLabel(s: SOP): string {
  return s.scope === "library" ? t("Attached to agents") : s.scope_label;
}

/** The SOPs that apply to a company: every company's, that company's and its departments',
 * and the ones attached to agents. No company: all of them. */
export function sopsForCompany(sops: SOP[], branch: Branch | null): SOP[] {
  if (!branch) return sops;
  const depts = new Set(branch.departments.map((d) => d.id));
  return sops.filter((s) =>
    s.scope === "workspace" || s.scope === "library"
    || (s.scope === "branch" && s.scope_id === branch.id)
    || (s.scope === "department" && !!s.scope_id && depts.has(s.scope_id)));
}

/** The templates a company can use: shared ones and its own. */
export function templatesForCompany(templates: DocTemplate[], branch: Branch | null): DocTemplate[] {
  return branch ? templates.filter((x) => !x.branch_id || x.branch_id === branch.id) : templates;
}
