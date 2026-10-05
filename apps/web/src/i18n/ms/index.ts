/**
 * Bahasa Melayu, English → Malay, one file per area so several people can work at once.
 * Style (see ./README.md): natural Malaysian office Malay, not word-for-word; short; the same
 * term for the same thing everywhere (see ./glossary.ts).
 */
import { ADMIN } from "./admin";
import { COMMON } from "./common";
import { GUIDE } from "./guide";
import { KNOWLEDGE } from "./knowledge";
import { SHELL } from "./shell";
import { WORK } from "./work";

export const MS: Record<string, string> = {
  ...COMMON,
  ...SHELL,
  ...WORK,
  ...KNOWLEDGE,
  ...ADMIN,
  ...GUIDE,
};
