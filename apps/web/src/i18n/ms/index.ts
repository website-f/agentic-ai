/**
 * Bahasa Melayu, English → Malay, one file per area so several people can work at once.
 * Style (see ./README.md): natural Malaysian office Malay, not word-for-word; short; the same
 * term for the same thing everywhere (see ./glossary.ts).
 */
import { ADMIN } from "./admin";
import { BUILDERS } from "./builders";
import { COMMON } from "./common";
import { DESK } from "./desk";
import { FILES } from "./files";
import { FORMS } from "./forms";
import { GUIDE } from "./guide";
import { KNOWLEDGE } from "./knowledge";
import { MINUTES } from "./minutes";
import { PEOPLE } from "./people";
import { PROVENANCE } from "./provenance";
import { RUNS } from "./runs";
import { SEARCH } from "./search";
import { SHELL } from "./shell";
import { WORK } from "./work";

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
};
