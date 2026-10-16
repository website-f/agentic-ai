import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countPlaceholders,
  dataLevelOf,
  getPrivacy,
  isOpenRouter,
  patchBranchDataLevel,
  patchProviderPrivacy,
  placeholderCategory,
  placeholderRegex,
  policyTone,
  previewPrivacy,
  PRIVACY_PATH,
  SAMPLE_TEXT,
  savePrivacy,
  splitMasked,
  untrustedUses,
  cloudUsesForLocalOnly,
  type CompanyPrivacy,
} from "./privacy";

const MASKED =
  "Hi team, quote for [PERSON_K7Q2A] (MyKad [IC_9X2LM], [PHONE_AB12C], [EMAIL_ZZ9Q1]). Client: [COMPANY_H4RM0], tender [REF_QT2Q6]. Price RM 12,500. Pay [BANKACC_00XYZ1]. Ask [PERSON_K7Q2A].";

describe("placeholders", () => {
  it("matches only the server's placeholder shape", () => {
    const re = placeholderRegex();
    expect("[PERSON_K7Q2A]".match(re)).toEqual(["[PERSON_K7Q2A]"]);
    expect("[CARD_ABCDEFGH]".match(placeholderRegex())).toEqual(["[CARD_ABCDEFGH]"]);
    // too short, lower case, unknown kind, no brackets
    expect("[PERSON_K7Q2]".match(placeholderRegex())).toBeNull();
    expect("[person_k7q2a]".match(placeholderRegex())).toBeNull();
    expect("[MONEY_K7Q2A]".match(placeholderRegex())).toBeNull();
    // amounts only get a placeholder when that category is on
    expect("[AMOUNT_K7Q2A]".match(placeholderRegex())).toEqual(["[AMOUNT_K7Q2A]"]);
    expect("PERSON_K7Q2A".match(placeholderRegex())).toBeNull();
  });

  it("maps every kind to its category", () => {
    expect(placeholderCategory("IC")).toBe("ids");
    expect(placeholderCategory("PASSPORT")).toBe("ids");
    expect(placeholderCategory("BANKACC")).toBe("ids");
    expect(placeholderCategory("CARD")).toBe("ids");
    expect(placeholderCategory("PERSON")).toBe("people");
    expect(placeholderCategory("EMAIL")).toBe("people");
    expect(placeholderCategory("PHONE")).toBe("people");
    expect(placeholderCategory("ADDRESS")).toBe("people");
    expect(placeholderCategory("COMPANY")).toBe("companies");
    expect(placeholderCategory("REF")).toBe("companies");
    expect(placeholderCategory("AMOUNT")).toBe("amounts");
  });

  it("splits masked text into text and placeholder segments, losslessly", () => {
    const parts = splitMasked(MASKED);
    expect(parts.map((p) => p.text).join("")).toBe(MASKED);
    const chips = parts.filter((p) => p.type === "placeholder");
    expect(chips.map((p) => p.text)).toEqual([
      "[PERSON_K7Q2A]",
      "[IC_9X2LM]",
      "[PHONE_AB12C]",
      "[EMAIL_ZZ9Q1]",
      "[COMPANY_H4RM0]",
      "[REF_QT2Q6]",
      "[BANKACC_00XYZ1]",
      "[PERSON_K7Q2A]",
    ]);
    expect(chips[1]).toMatchObject({ kind: "IC", category: "ids" });
    expect(parts[0]).toEqual({ type: "text", text: "Hi team, quote for " });
    expect(parts.at(-1)).toEqual({ type: "text", text: "." });
  });

  it("handles text with no placeholders, only placeholders, and adjacent ones", () => {
    expect(splitMasked("")).toEqual([]);
    expect(splitMasked("plain")).toEqual([{ type: "text", text: "plain" }]);
    const adj = splitMasked("[PERSON_AAAAA][COMPANY_BBBBB]");
    expect(adj.map((p) => p.type)).toEqual(["placeholder", "placeholder"]);
  });

  it("is safe to call repeatedly (no shared lastIndex)", () => {
    expect(splitMasked(MASKED)).toEqual(splitMasked(MASKED));
  });

  it("counts distinct placeholders per category", () => {
    // the same person twice is one placeholder
    expect(countPlaceholders(MASKED)).toEqual({ ids: 2, people: 3, companies: 2, amounts: 0 });
    expect(countPlaceholders("nothing here")).toEqual({ ids: 0, people: 0, companies: 0, amounts: 0 });
    expect(countPlaceholders("Price [AMOUNT_RM001]").amounts).toBe(1);
  });
});

describe("company data levels", () => {
  const company = (data_level: CompanyPrivacy["data_level"]): CompanyPrivacy => ({
    branch_id: "b1",
    name: "Harmoni Engineering Sdn Bhd",
    data_level,
    providers_30d: [
      { provider_id: "p1", name: "OpenAI", trusted: true, calls: 40, masked: 38 },
      { provider_id: "p2", name: "DeepSeek", trusted: false, calls: 3, masked: 3 },
      { provider_id: "p3", name: "Groq", trusted: false, calls: 0, masked: 0 },
      { provider_id: "local", name: "Ollama", trusted: true, calls: 9, masked: 0 },
    ],
  });

  it("defaults to standard when the API sends no level", () => {
    expect(dataLevelOf({})).toBe("standard");
    expect(dataLevelOf({ data_level: null })).toBe("standard");
    expect(dataLevelOf({ data_level: "confidential" })).toBe("confidential");
    expect(dataLevelOf({ data_level: "bogus" as never })).toBe("standard");
  });

  it("flags untrusted providers only for confidential companies that used them", () => {
    expect(untrustedUses(company("confidential")).map((p) => p.name)).toEqual(["DeepSeek"]);
    expect(untrustedUses(company("standard"))).toEqual([]);
    expect(untrustedUses(company("local_only"))).toEqual([]);
  });

  it("flags any cloud call for local-only companies", () => {
    const local = new Set(["local"]);
    expect(cloudUsesForLocalOnly(company("local_only"), local).map((p) => p.name)).toEqual(["OpenAI", "DeepSeek"]);
    expect(cloudUsesForLocalOnly(company("confidential"), local)).toEqual([]);
  });
});

describe("provider policy", () => {
  it("warns on notes that read like data may be kept or trained on", () => {
    expect(policyTone("Servers in China; prompts may be used to train models.")).toBe("warn");
    expect(policyTone("Free tier: prompts may be retained and used for training.")).toBe("warn");
    expect(policyTone(undefined, "deepseek")).toBe("warn");
  });

  it("stays muted on reassuring or empty notes", () => {
    expect(policyTone("API data is not used for training. Zero data retention available.")).toBe("muted");
    expect(policyTone("No training, no retention under the enterprise agreement.")).toBe("muted");
    expect(policyTone("")).toBe("muted");
    expect(policyTone(null)).toBe("muted");
  });

  it("recognises OpenRouter by preset or address", () => {
    expect(isOpenRouter({ preset: "openrouter" })).toBe(true);
    expect(isOpenRouter({ preset: null, base_url: "https://openrouter.ai/api/v1" })).toBe(true);
    expect(isOpenRouter({ preset: "groq", base_url: "https://api.groq.com/openai/v1" })).toBe(false);
  });

  it("ships a sample with every kind of private detail the demo should show", () => {
    expect(SAMPLE_TEXT).toContain("900101-14-5678");
    expect(SAMPLE_TEXT).toContain("Harmoni Engineering Sdn Bhd");
    expect(SAMPLE_TEXT).toContain("QT260000000027691");
    expect(SAMPLE_TEXT).toContain("RM 12,500");
    expect(SAMPLE_TEXT).toMatch(/@/);
  });
});

describe("privacy API calls", () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  function mockFetch(reply: unknown, status = 200) {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
      }),
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  it("reads and saves the settings", async () => {
    const settings = { masking: true, categories: { ids: true, people: true, companies: true, amounts: false }, companies: [] };
    mockFetch(settings);
    await expect(getPrivacy()).resolves.toEqual(settings);
    expect(calls[0]).toMatchObject({ url: PRIVACY_PATH, method: "GET" });

    mockFetch(settings);
    await savePrivacy({ categories: { amounts: true } });
    expect(calls[0]).toEqual({ url: PRIVACY_PATH, method: "PUT", body: { categories: { amounts: true } } });
  });

  it("previews with and without a company", async () => {
    const reply = { masked: "[PERSON_K7Q2A]", counts: { ids: 0, people: 1, companies: 0 } };
    mockFetch(reply);
    await expect(previewPrivacy("Ahmad")).resolves.toEqual(reply);
    expect(calls[0]).toEqual({ url: `${PRIVACY_PATH}/preview`, method: "POST", body: { text: "Ahmad" } });

    mockFetch(reply);
    await previewPrivacy("Ahmad", "b1");
    expect(calls[0]?.body).toEqual({ text: "Ahmad", branch_id: "b1" });
  });

  it("patches a provider's trust and a branch's data level", async () => {
    mockFetch({});
    await patchProviderPrivacy("p1", { trusted: true });
    expect(calls[0]).toEqual({ url: "/api/ai/providers/p1", method: "PATCH", body: { trusted: true } });

    mockFetch({});
    await patchProviderPrivacy("p2", { require_zdr: true });
    expect(calls[0]?.body).toEqual({ require_zdr: true });

    mockFetch({});
    await patchBranchDataLevel("b1", "local_only");
    expect(calls[0]).toEqual({ url: "/api/branches/b1", method: "PATCH", body: { data_level: "local_only" } });
  });

  it("surfaces a 404 while the API has not landed", async () => {
    mockFetch({ code: "not_found", message: "Not found" }, 404);
    await expect(getPrivacy()).rejects.toMatchObject({ status: 404 });
  });
});
