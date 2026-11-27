/**
 * Bahasa Melayu, English → Malay, one file per area so several people can work at once.
 * Style (see ./README.md): natural Malaysian office Malay, not word-for-word; short; the same
 * term for the same thing everywhere (see ./glossary.ts).
 */
import { ADMIN } from "./admin";
import { AI_USE } from "./ai-use";
import { BUILDERS } from "./builders";
import { CHAT } from "./chat";
import { COMMON } from "./common";
import { COMPUTERS } from "./computers";
import { DESK } from "./desk";
import { GENERAL } from "./general";
import { FILES } from "./files";
import { FORMS } from "./forms";
import { GUIDE } from "./guide";
import { INSTALL } from "./install";
import { KNOWLEDGE } from "./knowledge";
import { LIBRARY } from "./library";
import { MICROSOFT } from "./microsoft";
import { MINUTES } from "./minutes";
import { MY_AI } from "./my-ai";
import { PEOPLE } from "./people";
import { PRIVACY } from "./privacy";
import { PROVENANCE } from "./provenance";
import { RUNS } from "./runs";
import { SCHEDULE_PICKER } from "./schedule-picker";
import { JOBS } from "./jobs";
import { NEEDS_MEMORY } from "./needs-memory";
import { APPROVED_SERVICES } from "./approved-services";
import { PC_TUNNEL } from "./pc-tunnel";
import { MY_PC } from "./my-pc";
import { PRIMA } from "./prima";
import { SIGN_IN } from "./signin";
import { WEB_CONNECTIONS } from "./web-connections";
import { SEARCH } from "./search";
import { SHELL } from "./shell";
import { SPEECH } from "./speech";
import { STORAGE } from "./storage";
import { TASKS_FLOW } from "./tasks-flow";
import { TIPS } from "./tips";
import { WORK } from "./work";
import { WORK_MORE } from "./work-more";
import { STAFF_COMPUTERS } from "./staff-computers";
import { WORKSPACE_HUB } from "./workspace-hub";
import { FOLDER_BROWSER } from "./folder-browser";
import { ERASE } from "./erase";
import { TWO_FACTOR } from "./two-factor";
import { EXPLORER } from "./explorer";
import { FEEDBACK } from "./feedback";
import { SHAREPOINT } from "./sharepoint";
import { GOLIVE } from "./golive";
import { SIGNIN_EMAIL } from "./signin-email";
import { ROLES_ACCESS } from "./roles-access";
import { LESSONS } from "./lessons";
import { STAFF_PHONE } from "./staff-phone";
import { PRIMA_SOP_GUIDE } from "./prima-sop-guide";
import { APPROVALS_P122 } from "./approvals-p122";
import { SHELL_P123 } from "./shell-p123";
import { PRIMA_DEPTS_P125 } from "./prima-depts-p125";
import { PRIMA_ORG_P126 } from "./prima-org-p126";
import { ORG_SYNC_P127 } from "./org-sync-p127";
import { PRIMA_MASTER_P132 } from "./prima-master-p132";
import { ROLE_PREVIEW_P131 } from "./role-preview-p131";
import { APPROVALS_P127 } from "./approvals-p127";
import { MAIL_P122 } from "./mail-p122";
import { WORK_MAIL_P124 } from "./work-mail-p124";
import { IT_SUPPORT_P125 } from "./it-support-p125";
import { ACCESS_P128 } from "./access-p128";
import { ACCOUNT_NAME_P141 } from "./account-name-p141";
import { TABLES } from "./tables";
import { TEAM } from "./team";
import { ROLES_P98 } from "./roles-p98";
import { ACCESS_P99 } from "./access-p99";
import { TABLES_P107 } from "./tables-p107";
import { P107_KNOWLEDGE } from "./p107-knowledge";
import { P107_WORK } from "./p107-work";
import { P107_ADMIN } from "./p107-admin";
import { P107_PAGED } from "./p107-paged";
import { P107_FINISH } from "./p107-finish";
import { M365 } from "./m365";
import { TASKS_P109 } from "./tasks-p109";
import { ORG_P109 } from "./org-p109";
import { TOURS } from "./tours";
import { PICKERS_P111 } from "./pickers-p111";
import { ORG_PRIMA_P111 } from "./org-prima-p111";
import { HIERARCHY_P111 } from "./hierarchy-p111";
import { HIERARCHY_P113 } from "./hierarchy-p113";
import { AI_USAGE_PEOPLE } from "./ai-usage-people";
import { NOTIFY_P114 } from "./notify-p114";

export const MS: Record<string, string> = {
  ...PICKERS_P111, // P111: Teams people picker, company picker
  ...ORG_PRIMA_P111, // P111: organizations in capitals and in Prima
  ...HIERARCHY_P111, // P111: the organization chart and My hierarchy
  ...HIERARCHY_P113, // P113: the organization chart for every member
  ...AI_USAGE_PEOPLE, // P113: AI usage per user (the developer's report)
  ...NOTIFY_P114, // P114: who started a task, paused tasks, giving more, my notifications
  // P109: Getting started and the guided tours; first, so an existing translation wins.
  ...TOURS,
  // P109: the Microsoft 365 page and other email accounts; first, so an existing translation
  // of the same English wins.
  ...M365,
  // P109: tasks for people (Trello-like), calendar and timeline; first, so an existing
  // translation of the same English wins.
  ...TASKS_P109,
  // P109: HOD and teams, Library by department, files for other companies, feedback comments.
  ...ORG_P109,
  // P107: lists that became data tables (one file per area so parallel work does not collide);
  // first, so an existing translation of the same English wins.
  ...TABLES_P107,
  ...P107_KNOWLEDGE,
  ...P107_WORK,
  ...P107_ADMIN,
  ...P107_PAGED,
  ...P107_FINISH,
  // P97: first, so an existing translation of the same English wins over these.
  ...TEAM,
  // P98: several branches, searchable selects, Roles and access.
  ...ROLES_P98,
  // P99: Agentic + Prima or Prima only, and Prima modules.
  ...ACCESS_P99,
  // P73: first, so an existing translation of the same English always wins.
  // P96: before the rest too, so an existing translation of the same English wins.
  ...TABLES,
  ...FEEDBACK,
  ...COMMON,
  ...SHELL,
  ...WORK,
  ...KNOWLEDGE,
  ...ADMIN,
  ...GUIDE,
  ...MINUTES,
  ...RUNS,
  ...BUILDERS,
  ...FILES,
  ...PROVENANCE,
  ...DESK,
  ...FORMS,
  ...SEARCH,
  ...PEOPLE,
  ...CHAT,
  ...LIBRARY,
  ...TASKS_FLOW,
  ...MY_AI,
  ...COMPUTERS,
  ...PRIVACY,
  ...MICROSOFT,
  // P102: shared rows that lived in crm.ts, where the CRM spread sat.
  ...GENERAL,
  ...AI_USE,
  ...SPEECH,
  ...STORAGE,
  ...TIPS,
  ...WORK_MORE,
  ...WORKSPACE_HUB,
  ...STAFF_COMPUTERS,
  ...INSTALL,
  ...SCHEDULE_PICKER,
  ...JOBS,
  ...NEEDS_MEMORY,
  ...APPROVED_SERVICES,
  ...PC_TUNNEL,
  ...MY_PC,
  ...WEB_CONNECTIONS,
  ...SIGN_IN,
  ...PRIMA,
  ...FOLDER_BROWSER,
  ...TWO_FACTOR,
  ...ERASE,
  ...EXPLORER,
  ...SHAREPOINT,
  ...GOLIVE,
  ...SIGNIN_EMAIL,
  ...ROLES_ACCESS,
  ...LESSONS,
  ...STAFF_PHONE,
  ...PRIMA_SOP_GUIDE,
  ...APPROVALS_P122,
  ...SHELL_P123,
  ...PRIMA_DEPTS_P125,
  ...PRIMA_ORG_P126,
  ...ORG_SYNC_P127, // P127: the organization chart in step with Prima, Excel and PDF downloads
  ...ROLE_PREVIEW_P131, // P131: sign in as a role on a practice account
  ...PRIMA_MASTER_P132, // P132: Prima keeps the organization and the people
  ...APPROVALS_P127, // P127: every Microsoft approval of the office, answers the AI prepares
  ...MAIL_P122, // P122: Work and Personal email, connecting another account by address
  ...WORK_MAIL_P124, // P124: extra work email accounts wait for approval
  ...IT_SUPPORT_P125, // P125: the IT support role and its changes that wait for approval
  ...ACCESS_P128, // P128: Members > Access shows what someone really gets in Prima
  ...ACCOUNT_NAME_P141, // P141: Settings > Your name
};
