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
import { KNOWLEDGE } from "./knowledge";
import { LIBRARY } from "./library";
import { MICROSOFT } from "./microsoft";
import { MINUTES } from "./minutes";
import { MY_AI } from "./my-ai";
import { PEOPLE } from "./people";
import { PRIVACY } from "./privacy";
import { PROVENANCE } from "./provenance";
import { RUNS } from "./runs";
import { SEARCH } from "./search";
import { SHELL } from "./shell";
import { SPEECH } from "./speech";
import { STORAGE } from "./storage";
import { TASKS_FLOW } from "./tasks-flow";
import { TIPS } from "./tips";
import { WORK } from "./work";
import { WORK_MORE } from "./work-more";

export const MS: Record<string, string> = {
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
};
