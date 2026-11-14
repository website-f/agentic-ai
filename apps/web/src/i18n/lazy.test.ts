import { afterEach, describe, expect, it, vi } from "vitest";

// P104: the Malay text is fetched on demand. A fresh copy of the module, without the
// dictionary test-setup hands to the shared one.
async function freshI18n() {
  vi.resetModules();
  localStorage.setItem("agentic.lang", "en");
  return import("@/i18n");
}

afterEach(() => localStorage.removeItem("agentic.lang"));

describe("Malay text loaded on demand (P104)", () => {
  it("switches only once the text is there, so nothing shows half in English", async () => {
    const i18n = await freshI18n();
    let release!: (d: Record<string, string>) => void;
    i18n.setDictionaryLoader(() => new Promise((r) => (release = r)));
    i18n.useLang.getState().setLang("ms");
    expect(i18n.useLang.getState().lang).toBe("en");
    expect(localStorage.getItem("agentic.lang")).toBe("ms");
    release({ Save: "Simpan" });
    await i18n.loadLanguage("ms");
    await Promise.resolve();
    expect(i18n.useLang.getState().lang).toBe("ms");
    expect(i18n.t("Save")).toBe("Simpan");
    expect(document.documentElement.lang).toBe("ms");
  });

  it("keeps the last choice when the person switches back before the text arrives", async () => {
    const i18n = await freshI18n();
    let release!: (d: Record<string, string>) => void;
    i18n.setDictionaryLoader(() => new Promise((r) => (release = r)));
    i18n.useLang.getState().setLang("ms");
    i18n.useLang.getState().setLang("en");
    release({ Save: "Simpan" });
    await i18n.loadLanguage("ms");
    await Promise.resolve();
    expect(i18n.useLang.getState().lang).toBe("en");
    expect(i18n.t("Save")).toBe("Save");
  });

  it("falls back to English when the text cannot be fetched, and tries again next time", async () => {
    const i18n = await freshI18n();
    const loader = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ Save: "Simpan" });
    i18n.setDictionaryLoader(loader);
    await i18n.loadLanguage("ms");
    expect(i18n.translate("ms", "Save")).toBe("Save");
    await i18n.loadLanguage("ms");
    expect(i18n.translate("ms", "Save")).toBe("Simpan");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("asks for the text once however often it is wanted", async () => {
    const i18n = await freshI18n();
    const loader = vi.fn().mockResolvedValue({ Save: "Simpan" });
    i18n.setDictionaryLoader(loader);
    await Promise.all([i18n.loadLanguage("ms"), i18n.loadLanguage("ms")]);
    await i18n.loadLanguage("ms");
    await i18n.loadLanguage("en");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
