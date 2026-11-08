import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  POLICE_HELP_GUIDE,
  PrimaService,
  addDays,
  addMinutes,
  generateDataset,
  myt,
} from "../src";

// Police call or visit help (Fauzan, 3 Nov 2026): the company asks, Arms Control assigns someone and records the help with
// proof, the company confirms. CMS monitors. Synthetic data only.
const TODAY = "2026-11-03";
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, "10:00") });
  const at = { now: myt(TODAY, "10:00") };
  return { ds, at, svc: new PrimaService(new MemoryStore(ds), () => at.now) };
};
const pdf = (name: string) => ({
  kind: "document" as const,
  name,
  data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString("base64")}`,
});
const ask = {
  companyId: "co-arsh",
  kind: "VISIT_NOW" as const,
  reason: "ARMOURY_CHECK" as const,
  policeUnit: "IPD Synthetic Test Station",
  officer: "Insp. Test Officer",
  asked: "Want to check the armoury register and licences this morning.",
  contactName: "Synthetic Admin",
  contactPhone: "03-1234 5678",
};

describe("Police call or visit help", () => {
  it("runs ask, assign, record with proof, company confirms; every step audited as an arms matter", async () => {
    const { svc, ds, at } = fresh();
    const ae = await svc.user("u-ae-arsh");
    const arms = await svc.user("u-pwvsb-arms");
    const cm = await svc.user("u-cm-arsh");
    const c = await svc.askPoliceHelp(ae, ask);
    expect(c.type).toBe("ARMS");
    expect(c.siteId).toBeNull();
    expect(c.severity).toBe("P1");
    expect(c.policeHelp?.step).toBe("asked");
    expect(ds.audit.at(-1)?.action).toBe("arms.police_help.ask");

    const board = await svc.policeHelp(arms);
    const row = board.rows.find((r) => r.id === c.id)!;
    expect(row.can).toMatchObject({
      assign: true,
      outcome: false,
      confirm: false,
      withdraw: false,
    });
    expect(board.counts.waiting).toBeGreaterThanOrEqual(1);
    expect(board.helpers.some((h) => h.id === "u-pwvsb-arms-asst")).toBe(true);

    // Late once the 15-minute assignment time for a visit happening now has passed (rule ARMS-POLICE-HELP).
    at.now = addMinutes(at.now, 16);
    expect(
      (await svc.policeHelp(arms)).rows.find((r) => r.id === c.id)!.late,
    ).toBe(true);

    // Arms Control cannot record an outcome before a helper is named.
    await expect(
      svc.recordPoliceHelpOutcome(arms, c.id, {
        note: "x",
        proof: [pdf("a.pdf")],
      }),
    ).rejects.toThrow(/Assign a helper/);
    const a1 = await svc.assignPoliceHelp(arms, c.id, {
      name: "Nur Izzati binti Kamal",
      phone: "012-345 6789",
      how: "ON_SITE",
      eta: addMinutes(at.now, 40),
    });
    expect(a1.policeHelp?.step).toBe("assigned");
    expect(a1.status).toBe("acknowledged");
    // Changing the helper needs a reason.
    await expect(
      svc.assignPoliceHelp(arms, c.id, {
        name: "Someone Else",
        phone: "012-000 0000",
        how: "PHONE",
      }),
    ).rejects.toThrow(/why the helper is changing/);

    // The outcome needs a note and proof (rule CASE-PROOF).
    await expect(
      svc.recordPoliceHelpOutcome(arms, c.id, { note: "Done", proof: [] }),
    ).rejects.toThrow(/Add proof/);
    const done = await svc.recordPoliceHelpOutcome(arms, c.id, {
      note: "Police checked register and 4 licences; all in order.",
      proof: [pdf("register-page-signed.pdf")],
    });
    expect(done.policeHelp?.step).toBe("helped");
    expect(done.status).toBe("resolved");
    expect(ds.evidenceDocs.some((d) => d.caseId === c.id)).toBe(true);

    // Arms Control cannot confirm its own help; the company manager can, with a comment.
    await expect(
      svc.answerPoliceHelp(arms, c.id, "confirm", "ok"),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      svc.answerPoliceHelp(cm, c.id, "confirm", " "),
    ).rejects.toThrow(/comment/);
    const closed = await svc.answerPoliceHelp(
      cm,
      c.id,
      "confirm",
      "Helper came and spoke to the officer.",
    );
    expect(closed.policeHelp?.step).toBe("confirmed");
    expect(closed.status).toBe("closed");
    // A second confirmation is refused.
    await expect(
      svc.answerPoliceHelp(ae, c.id, "confirm", "again"),
    ).rejects.toThrow(/not recorded the help/);

    const actions = ds.audit
      .filter((e) => e.entityId === c.id)
      .map((e) => e.action);
    expect(actions).toEqual([
      "case.raise",
      "arms.police_help.ask",
      "arms.police_help.assign",
      "arms.police_help.outcome",
      "arms.police_help.confirm",
    ]);
  });

  it("lets the company send it back with a reason, and withdraw an open request", async () => {
    const { svc } = fresh();
    const ae = await svc.user("u-ae-arsh");
    const arms = await svc.user("u-pwvsb-arms");
    const c = await svc.askPoliceHelp(ae, { ...ask, kind: "PHONE_CALL" });
    expect(c.severity).toBe("P2");
    await svc.assignPoliceHelp(arms, c.id, {
      name: "Zulkifli bin Hamzah",
      phone: "012-111 2222",
      how: "PHONE",
    });
    await svc.recordPoliceHelpOutcome(arms, c.id, {
      note: "Called the officer back.",
      proof: [pdf("call-note.pdf")],
    });
    await expect(svc.answerPoliceHelp(ae, c.id, "return", "")).rejects.toThrow(
      /still needed/,
    );
    const back = await svc.answerPoliceHelp(
      ae,
      c.id,
      "return",
      "Officer still wants the range practice records.",
    );
    expect(back.policeHelp?.step).toBe("assigned");
    expect(back.policeHelp?.outcome).toBeNull();
    expect(back.policeHelp?.returns).toHaveLength(1);

    const d = await svc.askPoliceHelp(ae, {
      ...ask,
      kind: "VISIT_BOOKED",
      expectedAt: myt(addDays(TODAY, 3), "10:00"),
    });
    expect(d.severity).toBe("P3");
    await expect(svc.withdrawPoliceHelp(ae, d.id, "")).rejects.toThrow(/why/);
    const w = await svc.withdrawPoliceHelp(
      ae,
      d.id,
      "Police cancelled the visit.",
    );
    expect(w.policeHelp?.step).toBe("withdrawn");
    expect(w.status).toBe("closed");
    await expect(
      svc.assignPoliceHelp(arms, d.id, {
        name: "X",
        phone: "012-111 2222",
        how: "PHONE",
      }),
    ).rejects.toThrow(/no longer waiting/);
  });

  it("refuses a duplicate press, bad input, other companies, and the wrong people", async () => {
    const { svc } = fresh();
    const ae = await svc.user("u-ae-arsh");
    const otherCm = await svc.user("u-cm-sasa");
    const arms = await svc.user("u-pwvsb-arms");
    const cms = await svc.user("u-cms-head");
    const c = await svc.askPoliceHelp(ae, ask);
    await expect(svc.askPoliceHelp(ae, ask)).rejects.toThrow(/already asked/);
    await expect(
      svc.askPoliceHelp(ae, {
        ...ask,
        kind: "PHONE_CALL",
        contactPhone: "call me",
      }),
    ).rejects.toThrow(/phone number/);
    await expect(
      svc.askPoliceHelp(ae, {
        ...ask,
        kind: "VISIT_BOOKED",
        expectedAt: myt(TODAY, "08:00"),
      }),
    ).rejects.toThrow(/future/);
    await expect(
      svc.askPoliceHelp(ae, { ...ask, kind: "PHONE_CALL", policeUnit: " " }),
    ).rejects.toThrow(/station/);
    // Another company's manager cannot ask for, see or answer this company's request.
    await expect(svc.askPoliceHelp(otherCm, ask)).rejects.toThrow(
      /Not allowed/,
    );
    expect(
      (await svc.policeHelp(otherCm)).rows.some((r) => r.id === c.id),
    ).toBe(false);
    await expect(
      svc.withdrawPoliceHelp(otherCm, c.id, "not mine"),
    ).rejects.toThrow(/Not allowed/);
    // Company staff cannot assign; Arms Control cannot ask or withdraw.
    await expect(
      svc.assignPoliceHelp(ae, c.id, {
        name: "Me",
        phone: "012-111 2222",
        how: "PHONE",
      }),
    ).rejects.toThrow(/Not allowed/);
    await expect(svc.askPoliceHelp(arms, ask)).rejects.toThrow(/Not allowed/);
    await expect(svc.withdrawPoliceHelp(arms, c.id, "x")).rejects.toThrow(
      /Not allowed/,
    );
    // CMS monitors read-only.
    const mon = await svc.policeHelp(cms);
    expect(mon.role).toBe("monitor");
    const row = mon.rows.find((r) => r.id === c.id);
    if (row)
      expect(row.can).toEqual({
        assign: false,
        outcome: false,
        confirm: false,
        withdraw: false,
      });
    await expect(
      svc.assignPoliceHelp(cms, c.id, {
        name: "X",
        phone: "012-111 2222",
        how: "PHONE",
      }),
    ).rejects.toThrow(/Not allowed/);
    // A supervisor or guard has no police help board.
    await expect(svc.policeHelp(await svc.user("u-it-ex1"))).rejects.toThrow(
      /Not allowed/,
    );
    // The generic case buttons cannot skip the steps.
    await expect(
      svc.updateCase(await svc.user("u-cm-arsh"), c.id, "resolve", "done", [
        pdf("x.pdf"),
      ]),
    ).rejects.toThrow(/own steps/);
  });

  it("has a Malay and English line for every guide entry", () => {
    for (const s of POLICE_HELP_GUIDE.sections) {
      expect(s.lines.length).toBeGreaterThan(0);
      for (const l of [s.title, ...s.lines]) {
        expect(l.bm.trim()).not.toBe("");
        expect(l.en.trim()).not.toBe("");
      }
    }
    expect(POLICE_HELP_GUIDE.sections.map((s) => s.id)).toEqual([
      "first",
      "say",
      "show",
      "during",
      "after",
    ]);
  });
});
