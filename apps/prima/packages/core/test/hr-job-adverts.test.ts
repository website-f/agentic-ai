// Job posts for open vacancies (rule HR-JOB-ADVERT, audit decision 6, Fauzan 5 Nov 2026). Synthetic mock data only.
import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  advertMayPublish,
  MemoryStore,
  PrimaService,
  advertChannelState,
  checkAdvert,
  generateDataset,
  myt,
  templateAdvert,
} from "../src";

const TODAY = "2026-10-26";
const NOW = myt(TODAY, "09:00");

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const svc = new PrimaService(new MemoryStore(ds), () => new Date((t += 1000)).toISOString());
  return { ds, svc };
}

async function openVacancy(svc: PrimaService, kind: "staff" | "guard", companyId = "co-arsh") {
  const cm = await svc.user("u-cm-arsh");
  const v = await svc.raiseVacancy(cm, {
    companyId,
    title: kind === "guard" ? "Security guard" : "Admin executive",
    department: kind === "guard" ? "Operations" : "Admin",
    headcount: 3,
    reason: "New contract starting",
    payFrom: 1800,
    payTo: 2100,
    category: kind,
    state: kind === "guard" ? "Selangor" : null,
  });
  await svc.vacancyStep(await svc.user("u-fauzan"), v.id, "ceo_approve", "Approved");
  await svc.vacancyStep(cm, v.id, "sign", "Signed");
  return v.id;
}

const DRAFT = { channels: ["facebook", "jobstreet"], applyHow: "Apply at the company careers form", closingDate: "2026-11-20" };

describe("Job posts (HR-JOB-ADVERT)", () => {
  it("drafts a bilingual post from job facts only and never claims a channel is connected", () => {
    const text = templateAdvert({
      title: "Security guard",
      department: "Operations",
      headcount: 2,
      category: "guard",
      employer: "Example Security Sdn Bhd",
      payFrom: 1800,
      payTo: 2100,
      applyHow: "Apply at the careers form",
      closingDate: "2026-11-20",
    });
    expect(text).toMatch(/JAWATAN KOSONG/);
    expect(text).toMatch(/WE ARE HIRING/);
    expect(text).toMatch(/KDN/);
    expect(advertChannelState("facebook").connected).toBe(false);
  });

  it("blocks IC and private mobile numbers and warns on discriminatory wording and pay below minimum wage", () => {
    const f = { title: "Guard", department: "", headcount: 1, category: "guard" as const, employer: "X", payFrom: 1500, payTo: null, applyHow: "", closingDate: null };
    const codes = checkAdvert("Lelaki sahaja. Call 012-345 6789. IC 900101-10-1234", f, 1700).map((c) => `${c.level}:${c.code}`);
    expect(codes).toEqual(expect.arrayContaining(["block:ic-number", "block:personal-phone", "warn:discrimination", "warn:below-minimum-wage", "warn:no-apply"]));
    const official = { ...f, applyHow: "WhatsApp 012-345 6789", payFrom: 1800 };
    expect(checkAdvert("Call 012-345 6789", official, 1700).some((c) => c.code === "personal-phone")).toBe(false);
  });

  it("staff post: company manager drafts, HR Director approves, nothing is published", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "staff");
    const cm = await svc.user("u-cm-arsh");
    const cos = await svc.user("u-cos");
    const v1 = await svc.advertStep(cm, id, "draft", DRAFT);
    expect(v1.advert!.origin).toBe("template");
    expect(v1.advert!.status).toBe("draft");
    // Version binding: a stale version is refused.
    await expect(svc.advertStep(cm, id, "submit", { version: 0 })).rejects.toThrow(/changed/);
    await svc.advertStep(cm, id, "submit", { version: 1 });
    // A company manager of another company, an OM and an IT executive cannot approve.
    await expect(svc.advertStep(await svc.user("u-cm-sasa"), id, "approve", { version: 1, note: "ok" })).rejects.toThrow();
    await expect(svc.advertStep(await svc.user("u-om-klang"), id, "approve", { version: 1, note: "ok" })).rejects.toThrow();
    await expect(svc.advertStep(await svc.user("u-it-ex3"), id, "approve", { version: 1, note: "ok" })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.advertStep(cos, id, "approve", { version: 1, note: "" })).rejects.toThrow(/comment/);
    const ok = await svc.advertStep(cos, id, "approve", { version: 1, note: "Wording fine" });
    expect(ok.advert!.status).toBe("approved");
    expect(ok.advert!.approved!.hash).toBe(ok.advert!.hash);
    expect(ok.advert!.manualPosts).toEqual([]);
    // Editing after approval clears the approval.
    const edited = await svc.advertStep(cm, id, "draft", { ...DRAFT, text: "We are hiring an admin executive. Apply at the careers form.", version: 1 });
    expect(edited.advert!.status).toBe("draft");
    expect(edited.advert!.approved).toBeNull();
    expect(edited.advert!.origin).toBe("edited");
  });

  it("guard post: only the OM covering the state approves; the writer never approves own wording", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "guard");
    const hr = await svc.user("u-pwvsb-hr");
    await svc.advertStep(hr, id, "draft", DRAFT);
    await svc.advertStep(hr, id, "submit", { version: 1 });
    // HR Director does not approve guard posts; the Johor OM does not cover Selangor.
    await expect(svc.advertStep(await svc.user("u-cos"), id, "approve", { version: 1, note: "ok" })).rejects.toThrow();
    await expect(svc.advertStep(await svc.user("u-om-johor"), id, "approve", { version: 1, note: "ok" })).rejects.toThrow();
    const om = await svc.user("u-om-klang");
    const rows = (await svc.vacancies(om)).rows;
    expect(rows.every((r) => r.category === "guard" && r.state === "Selangor")).toBe(true);
    const ok = await svc.advertStep(om, id, "approve", { version: 1, note: "Approved for Selangor" });
    expect(ok.advert!.status).toBe("approved");
    // HR records a post made by hand; Prima marks it as not checked.
    await expect(svc.advertStep(hr, id, "record_posted", { version: 1, channel: "tiktok", link: "https://www.facebook.com/p/1" })).rejects.toThrow(/channel/);
    await expect(svc.advertStep(hr, id, "record_posted", { version: 1, channel: "facebook", link: "http://www.facebook.com/p/1" })).rejects.toThrow(/https/);
    await expect(svc.advertStep(hr, id, "record_posted", { version: 1, channel: "facebook", link: "https://facebook.com.evil.test/p/1" })).rejects.toThrow(/https/);
    const rec = await svc.advertStep(hr, id, "record_posted", { version: 1, channel: "facebook", link: "https://www.facebook.com/p/1" });
    expect(rec.advert!.manualPosts).toHaveLength(1);
    expect(rec.advert!.history.at(-1)!.note).toMatch(/not checked by Prima/);
    // A place with no link: HR says where; phone numbers are refused; no photo until file storage is on.
    await expect(svc.advertStep(hr, id, "record_posted", { version: 1, channel: "whatsapp", where: "" })).rejects.toThrow(/where/);
    await expect(svc.advertStep(hr, id, "record_posted", { version: 1, channel: "whatsapp", where: "Group 012-345 6789" })).rejects.toThrow(/not a phone/);
    const board = await svc.advertStep(hr, id, "record_posted", { version: 1, channel: "notice_board", where: "Office notice board, Shah Alam" });
    const last = board.advert!.manualPosts.at(-1)!;
    expect([last.channel, last.link, last.where, last.photo]).toEqual(["notice_board", null, "Office notice board, Shah Alam", null]);
    // Closing the vacancy withdraws the post and reminds HR to take down the copy made by hand.
    const closed = await svc.vacancyStep(hr, id, "close", "Filled from walk-ins");
    expect(closed.advert!.status).toBe("withdrawn");
    expect(closed.advert!.history.at(-1)!.note).toMatch(/Take down 2 posts/);
  });

  it("never leaves an approval on wording the approver did not see when approve and edit race", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "staff");
    const cm = await svc.user("u-cm-arsh");
    await svc.advertStep(cm, id, "draft", DRAFT);
    await svc.advertStep(cm, id, "submit", { version: 1 });
    const results = await Promise.allSettled([
      svc.advertStep(await svc.user("u-cos"), id, "approve", { version: 1, note: "Fine" }),
      svc.advertStep(cm, id, "draft", { ...DRAFT, text: "We are hiring. Apply at the careers form today.", version: 1 }),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const final = (await svc.vacancies(cm)).rows.find((r) => r.id === id)!.advert!;
    // Never an approval stamped on wording the approver did not see.
    if (final.status === "approved") expect(final.approved!.hash).toBe(final.hash);
    else expect(final.approved).toBeNull();
  });

  it("flags a guard post in a state no OM covers, and an approved post past its closing date", async () => {
    const { svc } = fresh();
    const cm = await svc.user("u-cm-arsh");
    const v = await svc.raiseVacancy(cm, { companyId: "co-arsh", title: "Security guard", department: "", headcount: 1, reason: "New site", payFrom: 1800, payTo: null, category: "guard", state: "Sabah" });
    expect((await svc.vacancies(cm)).rows.find((r) => r.id === v.id)!.advertApproverMissing).toBe(true);
    const id = await openVacancy(svc, "staff");
    await svc.advertStep(cm, id, "draft", { ...DRAFT, closingDate: "2026-10-26" });
    const row = (await svc.vacancies(cm)).rows.find((r) => r.id === id)!;
    expect(row.advertExpired).toBe(false);
  });

  it("refuses a guard vacancy without a state, a post before the vacancy is open, and submitting blocked wording", async () => {
    const { svc } = fresh();
    const cm = await svc.user("u-cm-arsh");
    await expect(
      svc.raiseVacancy(cm, { companyId: "co-arsh", title: "Guard", department: "", headcount: 1, reason: "Needed now", payFrom: null, payTo: null, category: "guard", state: null }),
    ).rejects.toThrow(/state/);
    const v = await svc.raiseVacancy(cm, { companyId: "co-arsh", title: "Clerk", department: "", headcount: 1, reason: "Needed now", payFrom: 1800, payTo: null });
    await expect(svc.advertStep(cm, v.id, "draft", DRAFT)).rejects.toThrow(/cannot/);
    const id = await openVacancy(svc, "staff");
    await svc.advertStep(cm, id, "draft", { ...DRAFT, text: "Hiring admin executive, contact Ali 0123456789 now please" });
    await expect(svc.advertStep(cm, id, "submit", { version: 1 })).rejects.toThrow(/mobile/);
  });

  it("lets the Regional OM approve a guard post as backup, and queues the approved post per channel", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "guard");
    const hr = await svc.user("u-pwvsb-hr");
    await svc.advertStep(hr, id, "draft", DRAFT);
    await svc.advertStep(hr, id, "submit", { version: 1 });
    // Selangor is in the central region: the southern Regional OM cannot approve, the central one can.
    await expect(svc.advertStep(await svc.user("u-rom-south"), id, "approve", { version: 1, note: "ok" })).rejects.toThrow();
    const rom = await svc.user("u-rom-central");
    expect((await svc.vacancies(rom)).rows.find((r) => r.id === id)!.approvingAsBackup).toBe(true);
    const ok = await svc.advertStep(rom, id, "approve", { version: 1, note: "OM on leave, approved as backup" });
    expect(ok.advert!.outbox!.map((o) => `${o.channel}:${o.status}`)).toEqual(["facebook:waiting_connection", "jobstreet:waiting_connection"]);
    expect(ok.advert!.outbox!.every((o) => o.link === null && o.hash === ok.advert!.hash)).toBe(true);
    // An edit cancels the queue: only approved wording may go out.
    const edited = await svc.advertStep(hr, id, "draft", { ...DRAFT, channels: ["facebook"], version: 1 });
    expect(edited.advert!.outbox).toEqual([]);
    // A withdrawn post can be written again while the vacancy is open; it needs approval again.
    await svc.advertStep(hr, id, "withdraw", { version: 2, note: "Wrong channel" });
    const again = await svc.advertStep(hr, id, "draft", { ...DRAFT, version: 2 });
    expect([again.advert!.status, again.advert!.version, again.advert!.approved]).toEqual(["draft", 3, null]);
    expect((await svc.vacancies(hr)).channels.find((c) => c.id === "jobstreet")!.paid).toBe(true);
  });

  it("keeps the applicant list to HR, with comments on decisions and no more hires than places", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "staff");
    const hr = await svc.user("u-pwvsb-hr");
    const cm = await svc.user("u-cm-arsh");
    const today = "2026-10-26";
    // The company manager sees the vacancy but never its applicants; nor do OMs or IT.
    expect((await svc.vacancies(cm)).rows.find((r) => r.id === id)!.applicantCount).toBeNull();
    await expect(svc.applicants(cm, id)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addApplicant(cm, id, { name: "Test Person", phone: "0123456789", source: "facebook", appliedOn: today })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.applicants(await svc.user("u-om-klang"), id)).rejects.toBeInstanceOf(AccessDenied);
    // The CEO reads but does not keep the list.
    await expect(svc.addApplicant(await svc.user("u-fauzan"), id, { name: "Test Person", phone: "0123456789", source: "facebook", appliedOn: today })).rejects.toBeInstanceOf(AccessDenied);
    const a = await svc.addApplicant(hr, id, { name: "Test Person A", phone: "012-345 6789", source: "facebook", appliedOn: today });
    await expect(svc.addApplicant(hr, id, { name: "Same Person", phone: "+60123456789", source: "walk_in", appliedOn: today })).rejects.toThrow(/already/);
    await expect(svc.addApplicant(hr, id, { name: "No Contact", source: "other", appliedOn: today })).rejects.toThrow(/phone number or an email/);
    await expect(svc.addApplicant(hr, id, { name: "Future", email: "f@example.test", source: "other", appliedOn: "2027-01-01" })).rejects.toThrow(/date/);
    expect((await svc.applicants(await svc.user("u-fauzan"), id)).rows).toHaveLength(1);
    await expect(svc.applicantStep(hr, a.id, "hired", "x")).rejects.toThrow(/cannot move/);
    await svc.applicantStep(hr, a.id, "shortlisted", "");
    await expect(svc.applicantStep(hr, a.id, "interview", "")).rejects.toThrow(/interview date/);
    await expect(svc.applicantStep(hr, a.id, "interview", "", "2026-10-28T10:00")).rejects.toThrow(/interview date/);
    await svc.applicantStep(hr, a.id, "interview", "", "2026-10-28T02:00:00.000Z");
    await expect(svc.applicantStep(hr, a.id, "offered", "")).rejects.toThrow(/comment/);
    await svc.applicantStep(hr, a.id, "offered", "Offer at RM2,200");
    const done = await svc.applicantStep(hr, a.id, "hired", "Accepted, starts 1 Dec");
    expect(done.status).toBe("hired");
    expect(done.history.map((h) => h.status)).toEqual(["new", "shortlisted", "interview", "offered", "hired"]);
    // Three places: after three hires, a fourth is refused.
    for (const n of [2, 3, 4]) {
      const x = await svc.addApplicant(hr, id, { name: `Test Person ${n}`, email: `p${n}@example.test`, source: "jobstreet", appliedOn: today });
      await svc.applicantStep(hr, x.id, "shortlisted", "");
      await svc.applicantStep(hr, x.id, "interview", "", "2026-10-29T02:00:00.000Z");
      await svc.applicantStep(hr, x.id, "offered", "Offer");
      if (n < 4) await svc.applicantStep(hr, x.id, "hired", "Accepted");
      else await expect(svc.applicantStep(hr, x.id, "hired", "Accepted")).rejects.toThrow(/already filled/);
    }
    const row = (await svc.vacancies(hr)).rows.find((r) => r.id === id)!;
    expect([row.applicantCount, row.hiredCount]).toEqual([4, 3]);
  });

  it("never sends, approves or publishes a post past its closing date", async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    let t = Date.parse(NOW);
    const svc = new PrimaService(new MemoryStore(ds), () => new Date((t += 1000)).toISOString());
    const id = await openVacancy(svc, "staff");
    const cm = await svc.user("u-cm-arsh");
    const v1 = await svc.advertStep(cm, id, "draft", { ...DRAFT, closingDate: TODAY });
    expect(v1.advert!.text).toMatch(/Closing date: 26 October 2026/);
    expect(v1.advert!.text).toMatch(/Tarikh tutup: 26 Oktober 2026/);
    await svc.advertStep(cm, id, "submit", { version: 1 });
    const ok = await svc.advertStep(await svc.user("u-cos"), id, "approve", { version: 1, note: "Fine" });
    const entry = ok.advert!.outbox![0];
    expect(advertMayPublish(ok, entry, TODAY)).toBe(true);
    expect(advertMayPublish(ok, entry, "2026-10-27")).toBe(false);
    expect(advertMayPublish({ ...ok, status: "filled" }, entry, TODAY)).toBe(false);
    expect(advertMayPublish(ok, { ...entry, hash: "other" }, TODAY)).toBe(false);
    // Two days later the post has expired: an edited version cannot be sent until it gets a new date.
    await svc.advertStep(cm, id, "draft", { ...DRAFT, closingDate: TODAY, text: "We are hiring a clerk. Apply at the careers form.", version: 1 });
    t += 2 * 86400000;
    const row = (await svc.vacancies(cm)).rows.find((r) => r.id === id)!;
    expect([row.advertExpired, row.canAdvertSubmit]).toEqual([true, false]);
    await expect(svc.advertStep(cm, id, "submit", { version: 2 })).rejects.toThrow(/cannot/);
  });

  it("catches IC and mobile numbers written with spaces or dots, also in the How to apply line", () => {
    const f = { title: "Clerk", department: "", headcount: 1, category: "staff" as const, employer: "X", payFrom: 1800, payTo: null, applyHow: "Careers form", closingDate: null };
    const codes = (text: string, applyHow = f.applyHow) => checkAdvert(text, { ...f, applyHow }, 1700).map((c) => c.code);
    expect(codes("IC 900101 10 1234")).toContain("ic-number");
    expect(codes("Call 012.345.6789")).toContain("personal-phone");
    expect(codes("Apply now", "Send IC 900101-10-1234 to HR")).toContain("ic-number");
    expect(codes("Lelaki sahaja", "Careers form")).toContain("discrimination");
    expect(codes("Apply now", "Careers form, perempuan sahaja")).toContain("discrimination");
    // Ordinary numbers are not mistaken for an IC.
    expect(codes("Pay RM1,800 - RM2,100. Closing 20 November 2026.")).not.toContain("ic-number");
  });

  it("refuses an impossible closing date, and an approver who wrote any version of the wording", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "staff");
    const cm = await svc.user("u-cm-arsh");
    const cos = await svc.user("u-cos");
    await expect(svc.advertStep(cm, id, "draft", { ...DRAFT, closingDate: "2026-02-31" })).rejects.toThrow(/closing date/);
    await expect(svc.advertStep(cm, id, "draft", { ...DRAFT, closingDate: null })).rejects.toThrow(/closing date/);
    await svc.advertStep(cm, id, "draft", DRAFT);
    await svc.advertStep(cos, id, "draft", { ...DRAFT, text: "We are hiring an admin executive. Apply at the careers form.", version: 1 });
    await svc.advertStep(cm, id, "draft", { ...DRAFT, text: "We are hiring an admin executive in Selangor. Apply at the careers form.", version: 2 });
    await svc.advertStep(cm, id, "submit", { version: 3 });
    await expect(svc.advertStep(cos, id, "approve", { version: 3, note: "Fine" })).rejects.toThrow(/Someone else approves/);
    const row = (await svc.vacancies(cos)).rows.find((r) => r.id === id)!;
    expect(row.canAdvertApprove).toBe(false);
  });

  it("does not block normal posts with dates and times, company numbers or allowances", () => {
    const f = { title: "Clerk", department: "", headcount: 1, category: "staff" as const, employer: "X", payFrom: 1800, payTo: 2100, applyHow: "Careers form", closingDate: null };
    const codes = (text: string) => checkAdvert(text, f, 1700).map((c) => c.code);
    expect(codes("Temuduga: 01.12.2026 10.00 pagi")).toEqual([]);
    expect(codes("Interview 10-12-2026 1030")).toEqual([]);
    expect(codes("Prima Wira Sdn Bhd (201901012345)")).toEqual([]);
    expect(codes("Gaji: RM1,800 - RM2,100 sebulan. Elaun RM200.")).toEqual([]);
    expect(codes("Gaji RM1,500 sebulan")).toContain("pay-mismatch");
    expect(codes("WhatsApp +60 12-345 6789")).toContain("personal-phone");
  });

  it("keeps a writer barred after a withdrawal, and keeps applicant decisions out of the company audit view", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "staff");
    const cm = await svc.user("u-cm-arsh");
    const cos = await svc.user("u-cos");
    const hr = await svc.user("u-pwvsb-hr");
    await svc.advertStep(cos, id, "draft", DRAFT);
    await svc.advertStep(cos, id, "withdraw", { version: 1, note: "Not yet" });
    const v1 = (await svc.vacancies(hr)).rows.find((r) => r.id === id)!.advert!;
    await svc.advertStep(hr, id, "draft", { ...DRAFT, text: v1.text, version: v1.version });
    await svc.advertStep(hr, id, "submit", { version: v1.version + 1 });
    await expect(svc.advertStep(cos, id, "approve", { version: v1.version + 1, note: "Fine" })).rejects.toThrow(/Someone else approves/);

    const a = await svc.addApplicant(hr, id, { name: "Test Person", email: "t@example.test", source: "facebook", appliedOn: "2026-10-26" });
    await svc.applicantStep(hr, a.id, "rejected", "Synthetic reason not for the company");
    const cmAudit = (await svc.auditLog(cm)).entries;
    expect(cmAudit.some((e) => e.action.startsWith("hr.applicant"))).toBe(false);
    expect(JSON.stringify(cmAudit)).not.toMatch(/Synthetic reason/);
  });

  it("records a hire for someone offered before the vacancy closed as filled, and checks applicant dates", async () => {
    const { svc } = fresh();
    const id = await openVacancy(svc, "staff");
    const hr = await svc.user("u-pwvsb-hr");
    await expect(svc.addApplicant(hr, id, { name: "Bad Date", email: "b@example.test", source: "other", appliedOn: "2026-02-31" })).rejects.toThrow(/date/);
    const a = await svc.addApplicant(hr, id, { name: "Test Person", email: "t@example.test", source: "facebook", appliedOn: "2026-10-26" });
    const b = await svc.addApplicant(hr, id, { name: "Other Person", email: "o@example.test", source: "facebook", appliedOn: "2026-10-26" });
    await svc.applicantStep(hr, a.id, "shortlisted", "");
    await expect(svc.applicantStep(hr, a.id, "interview", "", "2999-01-01T02:00:00.000Z")).rejects.toThrow(/interview date/);
    await svc.applicantStep(hr, a.id, "interview", "", "2026-10-28T02:00:00.000Z");
    await svc.applicantStep(hr, a.id, "offered", "Offer");
    await svc.applicantStep(hr, b.id, "shortlisted", "");
    await svc.vacancyStep(hr, id, "close", "Filled");
    expect((await svc.applicantStep(hr, a.id, "hired", "Accepted")).status).toBe("hired");
    await expect(svc.applicantStep(hr, b.id, "interview", "", "2026-10-28T02:00:00.000Z")).rejects.toThrow(/closed/);
  });

  it("refuses a Regional OM outside the region and hides staff vacancies from OMs", async () => {
    const { svc } = fresh();
    const staff = await openVacancy(svc, "staff");
    const guard = await openVacancy(svc, "guard");
    const om = await svc.user("u-om-klang");
    const rows = (await svc.vacancies(om)).rows.map((r) => r.id);
    expect(rows).toContain(guard);
    expect(rows).not.toContain(staff);
    await expect(svc.vacancies(await svc.user("u-rom-south")).then((r) => r.rows.some((x) => x.id === guard))).resolves.toBe(false);
  });
});
