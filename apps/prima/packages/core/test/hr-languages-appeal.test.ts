// IKEA IWAY finding (Fauzan, 6 Nov 2026): the handbook and code of conduct in each worker's mother tongue with English
// and Malay always, the language each worker signed, policies for everyone, a job or a site, and an appeal step on
// discipline. Synthetic mock data only.
import { describe, expect, it } from "vitest";
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt, type AttendanceFollowUp } from "../src";

const TODAY = "2026-11-06";
const NOW = myt(TODAY, "09:00");

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const clock = { add: 0 };
  const svc = new PrimaService(new MemoryStore(ds), () => new Date((t += 1000) + clock.add).toISOString());
  return { ds, svc, later: (days: number) => (clock.add += days * 86_400_000) };
}

const MS = { lang: "ms" as const, title: "Kod kelakuan pengawal (mock)", body: "Berada di pos tepat pada masanya dan laporkan setiap insiden (mock).", translator: "HR (mock)" };
const NE = { lang: "ne" as const, title: "गार्ड आचार संहिता (mock)", body: "समयमै पोस्टमा पुग्नुहोस् र हरेक घटना रिपोर्ट गर्नुहोस् (mock).", translator: "Translator A (mock)" };
const code = {
  id: null,
  kind: "code_of_conduct" as const,
  title: "Guard code of conduct (mock)",
  body: "Be at your post on time and report every incident (mock text).",
  audience: "guards" as const,
};

describe("policy languages (HR-POLICY-LANG)", () => {
  it("needs English and Malay; HR sees the missing mother tongue; the guard signs in Nepali once HR adds it", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const guardUser = await svc.user("u-guard-sasa-1");
    const guard = ds.people.find((p) => p.id === guardUser.personId)!;
    guard.nationality = "NP";
    delete guard.motherTongue;
    await expect(svc.publishPolicy(hr, code)).rejects.toThrow(/Bahasa Melayu copy/);
    await expect(svc.publishPolicy(hr, { ...code, copies: [{ ...MS, translator: "" }] })).rejects.toThrow(/who translated/);
    const pol = await svc.publishPolicy(hr, { ...code, copies: [MS] });
    const board = (await svc.hrPolicies(hr)).rows.find((r) => r.id === pol.id)!;
    expect(board.copies.map((c) => c.lang)).toEqual(["en", "ms"]);
    expect(board.languageGaps!.find((g) => g.lang === "ne")!.people).toBeGreaterThan(0);
    // The guard cannot sign a language with no copy; adding Nepali changes no text, so nobody is asked again.
    await expect(svc.acknowledgePolicy(guardUser, pol.id, "ne")).rejects.toThrow(/no current copy/);
    await expect(svc.addPolicyCopy(guardUser, pol.id, NE)).rejects.toBeInstanceOf(AccessDenied);
    await svc.addPolicyCopy(hr, pol.id, NE);
    const after = (await svc.hrPolicies(hr)).rows.find((r) => r.id === pol.id)!;
    expect(after.version).toBe(1);
    expect(after.languageGaps!.some((g) => g.lang === "ne")).toBe(false);
    const mine = (await svc.hrPolicies(guardUser)).rows.find((r) => r.id === pol.id)!;
    expect(mine.myLang).toBe("ne");
    expect(mine.copies.find((c) => c.lang === "ne")!.body).toContain("घटना");
    const ack = await svc.acknowledgePolicy(guardUser, pol.id);
    expect(ack.lang).toBe("ne");
    const counted = (await svc.hrPolicies(hr)).rows.find((r) => r.id === pol.id)!;
    expect(counted.ackedByLang!.ne).toBe(1);
    expect(counted.notInMotherTongue).toBe(0);
  });

  it("records the briefing language, and a signature in another language is shown to HR", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const sv = await svc.user("u-sv-sasa");
    const pol = await svc.publishPolicy(hr, { ...code, copies: [MS, NE] });
    const row = (await svc.hrPolicies(sv)).rows.find((r) => r.id === pol.id)!;
    const ids = row.briefable.slice(0, 2).map((x) => x.personId);
    for (const id of ids) ds.people.find((p) => p.id === id)!.motherTongue = "ne";
    await expect(svc.recordBriefingAcks(sv, pol.id, ids, "Sheet 4 (mock)", "bn")).rejects.toThrow(/no current copy/);
    await svc.recordBriefingAcks(sv, pol.id, ids, "Sheet 4 (mock)", "ms");
    expect(ds.policyAcks.filter((a) => a.policyId === pol.id).map((a) => a.lang)).toEqual(["ms", "ms"]);
    expect((await svc.hrPolicies(hr)).rows.find((r) => r.id === pol.id)!.notInMotherTongue).toBe(2);
  });

  it("a material change needs the translations again; a small correction keeps them", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const pol = await svc.publishPolicy(hr, { ...code, copies: [MS, NE] });
    const fix = await svc.publishPolicy(hr, { ...code, id: pol.id, body: `${code.body} Typo fixed.`, material: false });
    expect(fix.copies!.map((c) => c.lang).sort()).toEqual(["ms", "ne"]);
    await expect(svc.publishPolicy(hr, { ...code, id: pol.id, body: `${code.body} New phone rule (mock).`, material: true })).rejects.toThrow(/Bahasa Melayu copy/);
    const v3 = await svc.publishPolicy(hr, { ...code, id: pol.id, body: `${code.body} New phone rule (mock).`, material: true, copies: [MS] });
    const row = (await svc.hrPolicies(hr)).rows.find((r) => r.id === v3.id)!;
    expect(row.copies.map((c) => c.lang)).toEqual(["en", "ms"]);
    expect(row.languageGaps!.some((g) => g.lang === "ne")).toBe(true);
  });

  it("HR sets a mother tongue; nobody else can", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const cm = await svc.user("u-cm-sasa");
    const guard = ds.people.find((p) => p.companyId === "co-sasa" && p.role === "guard" && p.status === "active")!;
    await expect(svc.setMotherTongue(cm, guard.id, "ta")).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setMotherTongue(hr, guard.id, "xx" as never)).rejects.toThrow(/Choose the language/);
    await svc.setMotherTongue(hr, guard.id, "ta");
    expect(ds.people.find((p) => p.id === guard.id)!.motherTongue).toBe("ta");
  });
});

describe("policy scope: everyone, a job or a site", () => {
  it("a job policy reaches only that job title; a site policy only people rostered there", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const staffUser = await svc.user("u-it-ex3");
    const staff = ds.people.find((p) => p.id === staffUser.personId)!;
    staff.jobTitle = "IT Executive";
    const jobPol = await svc.publishPolicy(hr, {
      id: null,
      kind: "handbook",
      title: "IT desk rules (mock)",
      body: "Log every ticket before you start work (mock text).",
      scope: { jobTitles: ["it executive"] },
      copies: [{ ...MS, title: "Peraturan meja IT (mock)" }],
    });
    expect((await svc.hrPolicies(staffUser)).rows.find((r) => r.id === jobPol.id)!.canAck).toBe(true);
    staff.jobTitle = "Admin Executive";
    expect((await svc.hrPolicies(staffUser)).rows.some((r) => r.id === jobPol.id)).toBe(false);
    await expect(svc.acknowledgePolicy(staffUser, jobPol.id)).rejects.toThrow(/not one you need/);
    await expect(svc.publishPolicy(hr, { id: jobPol.id, kind: "handbook", title: "IT desk rules (mock)", body: "Log every ticket before you start work (mock text).", scope: null, material: false, copies: [MS] })).rejects.toThrow(/material/);

    // Site policy: the guard rostered at the site is asked; a guard of the same company rostered elsewhere is not.
    const shifts = ds.shifts.filter((s) => s.personId && s.companyId === "co-sasa" && s.date >= addDays(TODAY, -30) && s.date <= addDays(TODAY, 30));
    const site = shifts[0].siteId;
    const atSite = new Set(shifts.filter((s) => s.siteId === site).map((s) => s.personId));
    const elsewhere = shifts.find((s) => !atSite.has(s.personId))!.personId!;
    await expect(svc.publishPolicy(hr, { ...code, scope: { siteIds: ["no-such-site"] }, copies: [MS] })).rejects.toThrow(/Site/);
    const sitePol = await svc.publishPolicy(hr, { ...code, title: "Site rules (mock)", scope: { siteIds: [site] }, copies: [MS] });
    const row = (await svc.hrPolicies(hr)).rows.find((r) => r.id === sitePol.id)!;
    const missing = new Set(row.missing!.map((m) => m.personId));
    expect(missing.has(shifts[0].personId!)).toBe(true);
    expect(missing.has(elsewhere)).toBe(false);
    const sv = await svc.user("u-sv-sasa");
    await expect(svc.recordBriefingAcks(sv, sitePol.id, [elsewhere], "Sheet 9 (mock)")).rejects.toThrow(/(not someone this policy is for|Not allowed)/);
  });
});

describe("appeal on an office HR case (HR-APPEAL)", () => {
  async function decided() {
    const f = fresh();
    const { svc } = f;
    const hr = await svc.user("u-pwvsb-hr");
    const cos = await svc.user("u-cos");
    const staff = await svc.user("u-it-ex3");
    const c = await svc.openHrCase(hr, { personId: staff.personId!, kind: "misconduct", title: "Late to work repeatedly (mock)", complainantId: null, receivedOn: TODAY, note: "Mock case" });
    await svc.hrCaseStep(hr, c.id, { kind: "show_cause", note: "Explain the late arrivals (mock)" });
    await svc.hrCaseStep(hr, c.id, { kind: "reply", note: "Staff replied: transport problems (mock)" });
    await svc.hrCaseStep(hr, c.id, { kind: "inquiry_set", note: "Panel of two", panelIds: ["u-coo", "u-pwvsb-doa"], hearingOn: addDays(TODAY, 3) });
    await svc.hrCaseStep(hr, c.id, { kind: "inquiry_held", note: "Charge proven (mock)", proven: true });
    await svc.hrCaseStep(cos, c.id, { kind: "outcome", note: "Suspension for repeated lateness (mock)", outcome: "suspension", suspensionDays: 3 });
    return { ...f, hr, cos, staff, c };
  }

  it("HR records the appeal; the HR Director who decided cannot hear it; another decides with reasons, only lighter when varied", async () => {
    const { svc, hr, cos, c } = await decided();
    const before = (await svc.hrCases(hr)).rows.find((x) => x.id === c.id)!;
    expect(before.appeal.canLodge).toBe(true);
    expect(before.appeal.dueBy).toBe(addDays(TODAY, 14));
    await expect(svc.hrCaseStep(hr, c.id, { kind: "appeal", note: "short" })).rejects.toThrow(/grounds/);
    await svc.hrCaseStep(hr, c.id, { kind: "appeal", note: "Staff appeals: the bus route changed, letter attached (mock)", lang: "ms" });
    await expect(svc.hrCaseStep(hr, c.id, { kind: "appeal", note: "A second appeal on the same decision (mock)" })).rejects.toThrow(/already recorded/);
    await expect(svc.hrCaseStep(hr, c.id, { kind: "closed", note: "Close the case now" })).rejects.toThrow(/appeal is waiting/);
    // The CoS recorded the outcome, so the CoS does not decide the appeal; HR (not a director) cannot either.
    await expect(svc.hrCaseStep(cos, c.id, { kind: "appeal_decided", note: "Upheld because the lateness is proven (mock)", appealResult: "upheld" })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.hrCaseStep(hr, c.id, { kind: "appeal_decided", note: "Upheld because the lateness is proven (mock)", appealResult: "upheld" })).rejects.toBeInstanceOf(AccessDenied);
    const dcos = await svc.user("u-dcos");
    expect((await svc.hrCases(dcos)).rows.find((x) => x.id === c.id)!.appeal.canDecide).toBe(true);
    await expect(svc.hrCaseStep(dcos, c.id, { kind: "appeal_decided", note: "Varied after hearing the staff member (mock)", appealResult: "varied", variedTo: "dismissal" as never })).rejects.toThrow(/lighter/);
    await expect(svc.hrCaseStep(dcos, c.id, { kind: "appeal_decided", note: "too short", appealResult: "upheld" })).rejects.toThrow(/reasons/);
    const done = await svc.hrCaseStep(dcos, c.id, { kind: "appeal_decided", note: "Varied to a final warning: first offence after the route change (mock)", appealResult: "varied", variedTo: "final_warning" });
    expect(done.steps.at(-1)).toMatchObject({ kind: "appeal_decided", appealResult: "varied", variedTo: "final_warning" });
    await svc.hrCaseStep(hr, c.id, { kind: "closed", note: "Closed after the appeal (mock)" });
  });

  it("an appeal after the window is refused; an appeal on a closed case within the window reopens it", async () => {
    const a = await decided();
    await a.svc.hrCaseStep(a.hr, a.c.id, { kind: "closed", note: "Closed after the outcome (mock)" });
    const reopened = await a.svc.hrCaseStep(a.hr, a.c.id, { kind: "appeal", note: "Staff appeals within the 14 days (mock letter)" });
    expect(reopened.status).toBe("open");
    const b = await decided();
    b.later(15);
    await expect(b.svc.hrCaseStep(b.hr, b.c.id, { kind: "appeal", note: "Staff appeals after the window (mock letter)" })).rejects.toThrow(/within 14 days/);
  });
});

describe("appeal on a guard disciplinary step (HR-APPEAL)", () => {
  function withStep(f: ReturnType<typeof fresh>, step: AttendanceFollowUp["discipline"] = "WRITTEN_WARNING") {
    const guardUser = f.ds.users.find((u) => u.id === "u-guard-sasa-1")!;
    const shift = f.ds.shifts.find((s) => s.personId === guardUser.personId)!;
    const rec: AttendanceFollowUp = {
      id: "fu-mock-appeal-1",
      companyId: shift.companyId,
      siteId: shift.siteId,
      postId: shift.postId,
      shiftId: shift.id,
      attendanceId: null,
      personId: guardUser.personId!,
      date: TODAY,
      issue: "NO_SHOW",
      kind: "DISCIPLINE",
      at: NOW,
      by: "Officer (mock)",
      byId: "u-sv-sasa",
      byDesk: "company",
      note: "Absent without leave (mock)",
      replacementShiftId: null,
      replacementPersonId: null,
      discipline: step,
    };
    f.ds.attendanceFollowUps.push(rec);
    return { rec, guardUser };
  }

  it("the guard appeals on their own sign-in in Nepali; the recorder and the company cannot decide; the CEO overturns and the step leaves the ladder", async () => {
    const f = fresh();
    const { rec, guardUser } = withStep(f);
    const g = await f.svc.user(guardUser.id);
    const profile = await f.svc.guardProfile(g, guardUser.personId!);
    const own = (profile as unknown as { warnings: { discipline: { id: string; canAppealOwn: boolean }[] } }).warnings.discipline.find((d) => d.id === rec.id)!;
    expect(own.canAppealOwn).toBe(true);
    const appeal = await f.svc.lodgeDisciplineAppeal(g, rec.id, { grounds: "मेरो बुबा बिरामी हुनुहुन्थ्यो (mock)", lang: "ne" });
    expect(appeal).toMatchObject({ via: "own", lang: "ne", decision: null });
    await expect(f.svc.lodgeDisciplineAppeal(g, rec.id, { grounds: "Second appeal on the same step (mock)" })).rejects.toThrow(/already recorded/);
    const sv = await f.svc.user("u-sv-sasa");
    const cm = await f.svc.user("u-cm-sasa");
    await expect(f.svc.decideDisciplineAppeal(sv, rec.id, { result: "overturned", reason: "The guard's father was in hospital (mock)" })).rejects.toBeInstanceOf(AccessDenied);
    await expect(f.svc.decideDisciplineAppeal(cm, rec.id, { result: "overturned", reason: "The guard's father was in hospital (mock)" })).rejects.toBeInstanceOf(AccessDenied);
    const ceo = await f.svc.user("u-fauzan");
    const list = await f.svc.disciplineAppeals(ceo);
    expect(list.rows.find((r) => r.id === rec.id)!.canDecideAppeal).toBe(true);
    const before = await f.svc.disciplineHistory(cm, rec.companyId, rec.personId!);
    expect(before.activeWarnings).toBe(1);
    await expect(f.svc.decideDisciplineAppeal(ceo, rec.id, { result: "varied", variedTo: "FINAL_WARNING", reason: "Heavier is not a variation on appeal (mock)" })).rejects.toThrow(/lighter/);
    await f.svc.decideDisciplineAppeal(ceo, rec.id, { result: "overturned", reason: "Hospital letter confirms the emergency (mock)" });
    await expect(f.svc.decideDisciplineAppeal(ceo, rec.id, { result: "upheld", reason: "Second decision on the same appeal (mock)" })).rejects.toThrow(/no appeal waiting/);
    const after = await f.svc.disciplineHistory(cm, rec.companyId, rec.personId!);
    expect(after.activeWarnings).toBe(0);
    expect(f.ds.audit.some((a) => a.action === "attendance.discipline_appeal_decided")).toBe(true);
  });

  it("the company records an appeal from the guard's letter; a show-cause letter is not appealed; late appeals are refused", async () => {
    const f = fresh();
    const { rec } = withStep(f);
    const cm = await f.svc.user("u-cm-sasa");
    const other = await f.svc.user("u-cm-arsh").catch(() => null);
    if (other) await expect(f.svc.lodgeDisciplineAppeal(other, rec.id, { grounds: "Not my company's guard (mock)" })).rejects.toBeInstanceOf(AccessDenied);
    const a = await f.svc.lodgeDisciplineAppeal(cm, rec.id, { grounds: "Guard's letter dated today, attached (mock)" });
    expect(a.via).toBe("company");
    const f2 = fresh();
    const { rec: sc } = withStep(f2, "SHOW_CAUSE");
    const cm2 = await f2.svc.user("u-cm-sasa");
    await expect(f2.svc.lodgeDisciplineAppeal(cm2, sc.id, { grounds: "Appeal against a show-cause letter (mock)" })).rejects.toThrow(/show-cause/);
    const f3 = fresh();
    const { rec: late } = withStep(f3);
    f3.later(15);
    const cm3 = await f3.svc.user("u-cm-sasa");
    await expect(f3.svc.lodgeDisciplineAppeal(cm3, late.id, { grounds: "Appeal after the window (mock)" })).rejects.toThrow(/within 14 days/);
  });
});
