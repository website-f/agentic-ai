import { afterEach, describe, expect, it, vi } from "vitest";

import { translate } from "@/i18n";

import {
  actionLink,
  addMailbox,
  clientIdProblem,
  DEFAULT_RULES,
  disconnectMicrosoft,
  getMicrosoftAccount,
  getMicrosoftConfig,
  isAnyTenant,
  isClock,
  isEmail,
  isMissingApi,
  listMailActivity,
  listMailboxes,
  mailKeys,
  microsoftAccountQuery,
  needsReconnect,
  normalizeRules,
  providerOf,
  readMsReturn,
  removeMailbox,
  rulesSummary,
  saveMicrosoftConfig,
  startAdminConsent,
  startMicrosoftConnect,
  tenantProblem,
  testMailbox,
  updateMailbox,
  type MicrosoftAccount,
} from "./microsoft";

const en = (s: string, v?: Record<string, string | number>) => translate("en", s, v);

function stub(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const call = (f: ReturnType<typeof stub>, i = 0) => ({
  url: f.mock.calls[i]![0] as string,
  method: ((f.mock.calls[i]![1] as RequestInit).method ?? "GET") as string,
  body: (f.mock.calls[i]![1] as RequestInit).body ? JSON.parse((f.mock.calls[i]![1] as RequestInit).body as string) : undefined,
});

describe("the Microsoft 365 API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads and saves the company app; the secret is write-only", async () => {
    let f = stub({ configured: false, client_id_hint: null, tenant: "organizations", redirect_uri: "https://x/cb", notify_url: "https://x/n", adminconsent_url: null, webhooks_available: true, can_configure: true, shared_enabled: false });
    expect((await getMicrosoftConfig()).tenant).toBe("organizations");
    expect(call(f).url).toBe("/api/integrations/microsoft");

    f = stub({ configured: true });
    await saveMicrosoftConfig({ client_id: " 11111111-2222-3333-4444-555555555555 ", client_secret: "  s3cr3t~value ", tenant: "contoso.com" });
    expect(call(f)).toEqual({ url: "/api/integrations/microsoft", method: "PUT", body: { client_id: "11111111-2222-3333-4444-555555555555", client_secret: "s3cr3t~value", tenant: "contoso.com" } });

    // A blank secret keeps the saved one: it is not sent at all. A blank tenant is the default.
    f = stub({ configured: true });
    await saveMicrosoftConfig({ client_id: "11111111-2222-3333-4444-555555555555", client_secret: "  ", tenant: "" });
    expect(call(f).body).toEqual({ client_id: "11111111-2222-3333-4444-555555555555", tenant: "organizations" });
  });

  it("connects, reads and disconnects the person's own Outlook", async () => {
    let f = stub({ url: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?x" });
    expect((await startMicrosoftConnect()).url).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    expect(call(f)).toMatchObject({ url: "/api/integrations/microsoft/connect", method: "POST" });

    const acct: MicrosoftAccount = { connected: true, email: "aina@contoso.com", display_name: "Aina", status: "connected", mail_ok: true, calendar_ok: true, last_sync_at: null, webhooks: "live" };
    f = stub(acct);
    expect(await getMicrosoftAccount()).toEqual(acct);
    expect(call(f).url).toBe("/api/integrations/microsoft/account");

    f = stub(null, 204);
    await disconnectMicrosoft();
    expect(call(f)).toMatchObject({ url: "/api/integrations/microsoft/account", method: "DELETE" });

    f = stub({ url: "https://login.microsoftonline.com/contoso.com/adminconsent?client_id=x" });
    await startAdminConsent();
    expect(call(f)).toMatchObject({ url: "/api/integrations/microsoft/adminconsent/start", method: "GET" });
  });

  it("lists shared mailboxes (bare or wrapped) and fills missing rules", async () => {
    const box = { id: "mb_1", address: "accounts@contoso.com", display_name: "Accounts", branch_id: "b1", branch_name: "HQ", agent_id: null, agent_name: null, status: "active", last_sync_at: null, webhooks: "polling" };
    stub([{ ...box, rules: null }]);
    const [one] = await listMailboxes();
    expect(one!.rules).toEqual(DEFAULT_RULES);
    stub({ items: [{ ...box, rules: { create_tasks_for: ["tender", "bogus"], save_attachments: false } }] });
    const [two] = await listMailboxes();
    expect(two!.rules.create_tasks_for).toEqual(["tender"]);
    expect(two!.rules.save_attachments).toBe(false);
    expect(two!.rules.digest).toEqual(DEFAULT_RULES.digest);
  });

  it("adds, changes, tests and removes a shared mailbox", async () => {
    let f = stub({ id: "mb_1" });
    await addMailbox({ address: "  Accounts@Contoso.com ", branch_id: "b1", agent_id: "", rules: { ...DEFAULT_RULES, follow_up_hours: 12.4 } });
    expect(call(f)).toMatchObject({ url: "/api/integrations/microsoft/mailboxes", method: "POST" });
    expect(call(f).body).toEqual({ address: "accounts@contoso.com", branch_id: "b1", agent_id: null, rules: { ...DEFAULT_RULES, follow_up_hours: 12 } });

    f = stub({ id: "mb_1" });
    await updateMailbox("mb_1", { agent_id: "ag_2" });
    expect(call(f)).toEqual({ url: "/api/integrations/microsoft/mailboxes/mb_1", method: "PATCH", body: { agent_id: "ag_2" } });
    f = stub({ id: "mb_1", status: "paused" });
    await updateMailbox("mb_1", { paused: true });
    expect(call(f).body).toEqual({ paused: true });

    f = stub({ ok: false, message: "Access denied: add the mailbox to the app's management scope (RBAC for Applications)." });
    const r = await testMailbox("mb_1");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/RBAC/);
    expect(call(f)).toMatchObject({ url: "/api/integrations/microsoft/mailboxes/mb_1/test", method: "POST" });

    f = stub(null, 204);
    await removeMailbox("mb_1");
    expect(call(f)).toMatchObject({ url: "/api/integrations/microsoft/mailboxes/mb_1", method: "DELETE" });
  });

  it("reads mail activity for a mailbox", async () => {
    const f = stub([{ id: "m1", mailbox_label: "My Outlook", received_at: "2026-10-16T01:00:00Z", from_name: "Ali", from_address: "ali@x.my", subject: "Invoice 42", category: "invoice", status: "processed", task_id: "t1", has_attachments: true }]);
    const list = await listMailActivity("personal");
    expect(call(f).url).toBe("/api/mail/activity?mailbox=personal&limit=50");
    expect(list[0]!.actions).toEqual([]); // filled when the server left it out
    stub({ items: [] });
    expect(await listMailActivity("mb 1", 10)).toEqual([]);
    expect(mailKeys.activity("personal").slice(0, 1)).toEqual([...mailKeys.all]); // mail.new refreshes every mailbox
  });

  it("tells a server without P34 (404) from a real failure", async () => {
    stub({ code: "not_found", message: "Not Found" }, 404);
    const err = await getMicrosoftConfig().catch((e: unknown) => e);
    expect(isMissingApi(err)).toBe(true);
    stub({ code: "boom", message: "Graph said no" }, 502);
    expect(isMissingApi(await getMicrosoftConfig().catch((e: unknown) => e))).toBe(false);
    const retry = microsoftAccountQuery.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, err)).toBe(false);
  });
});

describe("setup checks", () => {
  it("wants the Application (client) ID, a GUID", () => {
    expect(clientIdProblem("")).toBe("empty");
    expect(clientIdProblem("11111111-2222-3333-4444-555555555555")).toBeNull();
    expect(clientIdProblem("abc~secretValue.123")).toBe("not_guid");
  });

  it("accepts organizations, a tenant ID or a domain", () => {
    expect(tenantProblem("organizations")).toBeNull();
    expect(tenantProblem("common")).toBeNull();
    expect(tenantProblem("contoso.onmicrosoft.com")).toBeNull();
    expect(tenantProblem("contoso.com.my")).toBeNull();
    expect(tenantProblem("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBeNull();
    expect(tenantProblem("consumers")).toBe("personal");
    expect(tenantProblem("not a tenant")).toBe("bad");
    expect(tenantProblem(" ")).toBe("empty");
    expect(isAnyTenant("organizations")).toBe(true);
    expect(isAnyTenant("contoso.com")).toBe(false);
  });

  it("checks addresses and digest times", () => {
    expect(isEmail("accounts@contoso.com")).toBe(true);
    expect(isEmail("accounts@contoso")).toBe(false);
    expect(isClock("08:30")).toBe(true);
    expect(isClock("24:00")).toBe(false);
    expect(isClock("8:30")).toBe(false);
    expect(normalizeRules({ digest: { enabled: true, time: "25:00" }, follow_up_hours: -3 })).toMatchObject({ digest: { time: "08:00" }, follow_up_hours: 48 });
  });
});

describe("status and links", () => {
  it("summarises rules in a few words", () => {
    expect(rulesSummary(DEFAULT_RULES, en)).toEqual([
      "Tasks: invoices, customer requests, tenders, complaints",
      "Saves attachments",
      "Digest 08:00",
      "Follow up after 48h",
    ]);
    expect(rulesSummary({ create_tasks_for: [], save_attachments: false, digest: { enabled: false, time: "09:00" }, follow_up_hours: 0 }, en)).toEqual(["No tasks"]);
  });

  it("reads the sign-in return and the reconnect state", () => {
    expect(readMsReturn({ ms: "connected" })).toEqual({ ok: true, message: null });
    expect(readMsReturn({ ms: "error", msg: "AADSTS65001: consent needed" })).toEqual({ ok: false, message: "AADSTS65001: consent needed" });
    expect(readMsReturn({ ms_admin: "ok" }, "ms_admin")).toEqual({ ok: true, message: null });
    expect(readMsReturn({})).toBeNull();
    const base: MicrosoftAccount = { connected: true, email: "a@b.co", display_name: null, status: "reconnect_needed", mail_ok: false, calendar_ok: false, last_sync_at: null, webhooks: "off" };
    expect(needsReconnect(base)).toBe(true);
    expect(needsReconnect({ ...base, status: "connected" })).toBe(false);
    expect(needsReconnect({ ...base, connected: false })).toBe(false);
  });

  it("links what the AI did to the task, the file or the draft", () => {
    expect(actionLink({ kind: "task", label: "Task", task_id: "t1" }, false)).toEqual({ to: "/tasks", search: { task: "t1" } });
    expect(actionLink({ kind: "attachment_saved", label: "inv.pdf", file_id: "f1" }, false)).toEqual({ to: "/files", search: { f: "f1" } });
    expect(actionLink({ kind: "draft", label: "Reply" }, true)).toEqual({ to: "/assistants", search: { tab: "drafts" } });
    expect(actionLink({ kind: "draft", label: "Reply" }, false)).toEqual({ hash: "mail-drafts" });
    expect(actionLink({ kind: "digest", label: "In the digest" }, false)).toBeNull();
  });

  it("treats drafts without a provider as Google's", () => {
    expect(providerOf({})).toBe("google");
    expect(providerOf({ provider: "microsoft" })).toBe("microsoft");
  });
});
