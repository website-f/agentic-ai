import { describe, expect, it } from "vitest";

import { translate } from "@/i18n";

import { readPick, savePick, voiceName, voiceSummary } from "./voice";

describe("how agents speak to a person (P97)", () => {
  it("names the reply language from the setting, or the chat's own pick", () => {
    const en = (s: string, v?: Record<string, string | number>) => translate("en", s, v);
    const ms = (s: string, v?: Record<string, string | number>) => translate("ms", s, v);
    expect(voiceName(en, "ms", "kelantan")).toBe("Kelantan Malay");
    expect(voiceName(en, "ms", "standard")).toBe("Bahasa Melayu");
    expect(voiceName(en, "en", null)).toBe("English");
    expect(voiceName(en, "en", "kelantan")).toBe("English or Kelantan Malay");
    expect(voiceName(en, "ms", "kelantan", "en")).toBe("English");
    expect(voiceName(en, "en", null, "ms")).toBe("standard Malay");
    expect(voiceName(en, "ms", null, "sabah")).toBe("Sabah Malay");
    expect(voiceName(ms, "ms", "kelantan")).toBe("Loghat Kelantan");
    expect(voiceName(ms, "ms", "kelantan", "en")).toBe("bahasa Inggeris");
  });

  it("says plainly what happens, in both languages", () => {
    const s = voiceSummary("ms", "kelantan");
    expect(translate("en", s, { name: "Kelantan Malay" })).toBe(
      "Agents will reply to you in Kelantan Malay, also when you type standard Malay or mix in English. Write fully in English and they answer in English.",
    );
    expect(translate("ms", s, { name: "Loghat Kelantan" })).toContain("Ejen akan membalas anda dalam Loghat Kelantan");
    expect(voiceSummary("en", null)).toContain("in English, or in Malay when you write in Malay");
  });

  it("keeps a chat's pick per conversation", () => {
    expect(readPick("cs_1")).toBe("");
    savePick("cs_1", "terengganu");
    expect(readPick("cs_1")).toBe("terengganu");
    expect(readPick("cs_2")).toBe("");
    savePick("cs_1", "");
    expect(readPick("cs_1")).toBe("");
    expect(readPick(null)).toBe("");
  });
});
