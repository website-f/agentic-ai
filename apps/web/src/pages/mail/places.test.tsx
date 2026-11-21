import { describe, expect, it } from "vitest";

import type { MailAccounts } from "@/lib/m365";
import type { MicrosoftAccount, MsAccount, MyMailboxes, SharedMailbox } from "@/lib/microsoft";

import { buildPlaces } from "./places";

const t = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(v?.[k] ?? ""));

const ms = (id: string, email: string, kind: "work" | "personal", primary = false): MsAccount => ({
  id, email, kind, primary, display_name: "", label: "", status: "connected", connected: true, last_sync_at: null, shared_with: 0, is_sign_in: primary,
});

describe("Work and Personal mailboxes (P122)", () => {
  it("puts each mailbox on its tab, one click each", () => {
    const mm = {
      configured: true, company_domains: ["maju.com.my"], personal_ms_ok: false, can_manage: false,
      accounts: [ms("ma_1", "ali@maju.com.my", "work", true), ms("ma_2", "ali@outlook.com", "personal"), ms("ma_3", "sales@maju.com.my", "work")],
      shared: [{ id: "mb_1", address: "tender@maju.com.my", display_name: "Tender", status: "active" } as SharedMailbox],
    } satisfies MyMailboxes;
    const others = {
      accounts: [
        { id: "xm_1", email: "ali@yahoo.com", status: "ok" },
        { id: "xm_2", email: "old@maju.com.my", status: "error" },
      ],
      google: { configured: true, can_connect: true, account: { email: "ali@gmail.com", status: "connected" }, backup: null },
      presets: {},
    } as unknown as MailAccounts;
    const main = { connected: true, status: "connected", email: "ali@maju.com.my" } as MicrosoftAccount;
    const places = buildPlaces(t, mm, main, others);
    const by = (kind: string) => places.filter((p) => p.kind === kind).map((p) => p.key);
    expect(by("work")).toEqual(["main", "ms:ma_3", "box:mb_1", "x:xm_2"]);
    expect(by("personal")).toEqual(["ms:ma_2", "google", "x:xm_1"]);
    expect(places.find((p) => p.key === "x:xm_2")?.warn).toBe(true);
  });

  it("shows the main account even before it is connected", () => {
    const places = buildPlaces(t, undefined, { connected: false } as MicrosoftAccount, undefined);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ key: "main", kind: "work", badge: "Not connected" });
  });
});
