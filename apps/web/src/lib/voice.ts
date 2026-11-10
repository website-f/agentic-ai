/** P97: how agents speak to a person: one setting (Settings > Language: app language + dialect,
 * users.prefs locale) for every agent, and a per-conversation choice in the chat. The server
 * decides each reply (api i18n/notes.voice_for); this only names it for people. */
import { msg } from "@/i18n";

import type { SpeechStyle } from "./tutorial";

/** The language name an agent reply is in, per dialect code (api i18n/dialects STYLES). */
export const STYLE_NAMES: Record<Exclude<SpeechStyle, "standard">, string> = {
  pasar: msg("Casual Malay"),
  kelantan: msg("Kelantan Malay"),
  terengganu: msg("Terengganu Malay"),
  kedah: msg("Kedah / northern Malay"),
  perak: msg("Perak Malay"),
  pahang: msg("Pahang Malay"),
  negeri_sembilan: msg("Negeri Sembilan Malay"),
  melaka: msg("Melaka Malay"),
  johor: msg("Johor Malay"),
  sabah: msg("Sabah Malay"),
  sarawak: msg("Sarawak Malay"),
};

/** A chat's own reply language: English, standard Malay or a dialect. Empty = my setting. */
export type Pick = "" | "en" | "ms" | Exclude<SpeechStyle, "standard">;

type T = (text: string, vars?: Record<string, string | number>) => string;

/** The name of what agents answer in, translated with `t`. ("English|reply" is the language
 * name inside a Malay sentence: "bahasa Inggeris", not the switch's own "English".) */
export function voiceName(t: T, lang: "en" | "ms", speech: SpeechStyle | null | undefined, pick: Pick = ""): string {
  if (pick === "en") return t(msg("English|reply"));
  if (pick === "ms") return t(msg("standard Malay"));
  if (pick) return t(STYLE_NAMES[pick]);
  const dialect = speech && speech !== "standard" ? t(STYLE_NAMES[speech]) : "";
  if (dialect) return lang === "ms" ? dialect : t(msg("English or {name}"), { name: dialect });
  return lang === "ms" ? t(msg("Bahasa Melayu")) : t(msg("English|reply"));
}

/** One plain sentence for Settings: who speaks how, and when. */
export function voiceSummary(lang: "en" | "ms", speech: SpeechStyle | null | undefined): string {
  const dialect = speech && speech !== "standard";
  if (lang === "ms" && dialect) return msg("Agents will reply to you in {name}, also when you type standard Malay or mix in English. Write fully in English and they answer in English.");
  if (dialect) return msg("Agents will reply to you in English, and in {name} when you write in Malay.");
  if (lang === "ms") return msg("Agents will reply to you in Bahasa Melayu, or in English when you write in English.");
  return msg("Agents will reply to you in English, or in Malay when you write in Malay.");
}

const KEY = "agentic.chat.reply.";

/** The reply language picked for one conversation, on this device. */
export function readPick(sessionId: string | null | undefined): Pick {
  if (!sessionId) return "";
  try {
    return (localStorage.getItem(KEY + sessionId) ?? "") as Pick;
  } catch {
    return "";
  }
}

export function savePick(sessionId: string | null | undefined, pick: Pick): void {
  if (!sessionId) return;
  try {
    if (pick) localStorage.setItem(KEY + sessionId, pick);
    else localStorage.removeItem(KEY + sessionId);
  } catch {
    /* private window: the choice lasts while the chat is open */
  }
}
