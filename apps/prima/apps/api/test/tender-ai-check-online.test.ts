// The AI check of a tender checklist against the papers: off by default, only a verified Azure endpoint, the answer
// still checked against the paper text by the core. A fake HTTP client stands in for Azure; synthetic text only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenderAiFlags, type TenderAiCheckInput } from "@prima/core";
import { checkOnline, tenderAiChecker } from "../src/tender-ai-check-online";

const CFG = { endpoint: "https://synthetic.openai.azure.com/", deployment: "synthetic", apiVersion: "2024-10-21" };
const ON = { ARISHA_ENABLED: "true", AZURE_OPENAI_ENDPOINT: CFG.endpoint, AZURE_OPENAI_DEPLOYMENT: "d", AZURE_OPENAI_API_VERSION: "v" };
const PAPERS = [{ name: "Arahan Petender.pdf", text: "Petender mesti mengemukakan penyata bank enam bulan terkini." }];
const INPUT: TenderAiCheckInput = { channel: "GOVERNMENT", papers: PAPERS, checklist: ["Bank statements, 3 months"] };

describe("tender AI check", () => {
  it("stays off unless TENDER_AI_CHECK_ENABLED=true and Azure OpenAI is set up", () => {
    assert.equal(tenderAiChecker({}), null);
    assert.equal(tenderAiChecker({ TENDER_AI_CHECK_ENABLED: "true" }), null);
    assert.equal(tenderAiChecker(ON), null);
    assert.equal(typeof tenderAiChecker({ ...ON, TENDER_AI_CHECK_ENABLED: "true" }), "function");
  });

  it("sends only the papers' text and the checklist, and a made-up quote is dropped", async () => {
    let body: { messages: { role: string; content: string }[] } | null = null;
    const http = (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      const content = JSON.stringify({
        flags: [
          { kind: "DIFFERENT", what: "The papers ask for 6 months of bank statements.", quote: "penyata bank enam bulan", paper: "Arahan Petender.pdf" },
          { kind: "MISSING", what: "A performance bond is needed.", quote: "bon pelaksanaan 5 peratus", paper: "Arahan Petender.pdf" },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await checkOnline(CFG, async () => "synthetic-token", http, INPUT);
    const b = body as unknown as { messages: { role: string; content: string }[] };
    assert.deepEqual(JSON.parse(b.messages[1].content), { tenderType: "GOVERNMENT", checklist: INPUT.checklist, papers: PAPERS });
    const { flags, dropped } = tenderAiFlags(raw, PAPERS);
    assert.equal(flags.length, 1);
    assert.equal(dropped, 1);
  });

  it("refuses an endpoint that is not Azure OpenAI and a cut-off answer", async () => {
    const http = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }))) as unknown as typeof fetch;
    await assert.rejects(checkOnline({ ...CFG, endpoint: "https://example.com/" }, async () => "t", http, INPUT));
    await assert.rejects(checkOnline(CFG, async () => "t", http, INPUT));
  });
});
