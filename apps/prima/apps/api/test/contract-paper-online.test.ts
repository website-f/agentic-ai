// The optional online contract reader: off by default, only a verified Azure endpoint, the answer parsed strictly.
// A fake HTTP client stands in for Azure; no live credentials or provider calls. Synthetic text only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkOnlineValues } from "@prima/core";
import { contractReaderOnline, readOnline } from "../src/contract-paper-online";

const CFG = { endpoint: "https://synthetic.openai.azure.com/", deployment: "synthetic", apiVersion: "2024-10-21" };
const TEXT = "Synthetic agreement. Contract No: SYN/CT/1. Payment within 45 days of invoice.";

describe("online contract reader", () => {
  it("stays off unless it is switched on and Azure OpenAI is set up", () => {
    assert.equal(contractReaderOnline({}), null);
    assert.equal(contractReaderOnline({ CONTRACT_READER_ONLINE_ENABLED: "true" }), null);
    assert.equal(
      contractReaderOnline({ ARISHA_ENABLED: "true", AZURE_OPENAI_ENDPOINT: CFG.endpoint, AZURE_OPENAI_DEPLOYMENT: "d", AZURE_OPENAI_API_VERSION: "v" }),
      null,
    );
    assert.equal(
      typeof contractReaderOnline({ CONTRACT_READER_ONLINE_ENABLED: "true", ARISHA_ENABLED: "true", AZURE_OPENAI_ENDPOINT: CFG.endpoint, AZURE_OPENAI_DEPLOYMENT: "d", AZURE_OPENAI_API_VERSION: "v" }),
      "function",
    );
  });

  it("sends only the paper text, and its answer is still checked against the paper", async () => {
    let sent: { url: string; body: { messages: { role: string; content: string }[] } } | null = null;
    const at = TEXT.indexOf("45");
    const http = (async (url: string, init: { body: string }) => {
      sent = { url, body: JSON.parse(init.body) };
      const content = JSON.stringify({
        values: [
          { field: "paymentDays", value: "45", quote: "45", start: at, end: at + 2 },
          { field: "noticeDays", value: "7", quote: "7 days", start: 0, end: 6 },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await readOnline(CFG, async () => "synthetic-token", http, TEXT);
    assert.ok(sent);
    const s = sent as unknown as { url: string; body: { messages: { role: string; content: string }[] } };
    assert.match(s.url, /^https:\/\/synthetic\.openai\.azure\.com\/openai\/deployments\/synthetic\/chat\/completions/);
    assert.equal(s.body.messages.length, 2);
    assert.deepEqual(JSON.parse(s.body.messages[1].content), { paperText: TEXT });
    assert.deepEqual(checkOnlineValues(TEXT, raw).map((v) => v.field), ["paymentDays"]);
  });

  it("refuses an endpoint that is not Azure OpenAI and a cut-off answer", async () => {
    const http = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }))) as unknown as typeof fetch;
    await assert.rejects(readOnline({ ...CFG, endpoint: "https://example.com/" }, async () => "t", http, TEXT));
    await assert.rejects(readOnline(CFG, async () => "t", http, TEXT));
  });
});
