import { describe, expect, it } from "vitest";

import { freeName } from "./provider-dialog";

describe("freeName (P96: a second provider of the same kind)", () => {
  it("keeps the preset's name when it is free", () => {
    expect(freeName("Azure AI Foundry", ["Groq"])).toBe("Azure AI Foundry");
  });
  it("numbers the next one, whatever the case", () => {
    expect(freeName("Azure AI Foundry", ["azure ai foundry"])).toBe("Azure AI Foundry 2");
    expect(freeName("Azure AI Foundry", ["Azure AI Foundry", "Azure AI Foundry 2"])).toBe("Azure AI Foundry 3");
  });
  it("leaves an empty name empty (Other OpenAI-compatible)", () => {
    expect(freeName("", ["Groq"])).toBe("");
  });
});
