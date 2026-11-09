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
import { CRM } from "./crm";
import { CRM_BUILDER } from "./crm-builder";
import { CRM_CONNECTIONS } from "./crm-connections";
import { CRM_HUB } from "./crm-hub";
import { DESK } from "./desk";
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
import { TABLES } from "./tables";

export const MS: Record<string, string> = {
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
  ...CRM,
  ...AI_USE,
  ...SPEECH,
  ...STORAGE,
  ...TIPS,
  ...WORK_MORE,
  ...CRM_HUB,
  ...CRM_BUILDER,
  ...CRM_CONNECTIONS,
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
};
