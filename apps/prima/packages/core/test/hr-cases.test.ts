// HR Phase 3, slice 3E (Fauzan, 2 Nov 2026): each staff member's HR file, discipline with the right to be heard, and
// the sexual harassment inquiry (Employment Act Part XVA). Mock data only.
import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  addDays,
  filingsDue,
  generateDataset,
  myt,
} from "../src";

const TODAY = "2026-10-26";
const NOW = myt(TODAY, "09:00");

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const svc = new PrimaService(new MemoryStore(ds), () =>
    new Date((t += 1000)).toISOString(),
  );
  return { ds, svc };
}

describe("HR cases (slice 3E)", () => {
  it("runs a misconduct case: show-cause, reply, an independent panel, and an outcome only after a proven inquiry", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const cos = await svc.user("u-cos");
    const staff = await svc.user("u-it-ex3");
    const c = await svc.openHrCase(hr, {
      personId: staff.personId!,
      kind: "misconduct",
      title: "Absent 3 days without leave",
      complainantId: null,
      receivedOn: TODAY,
      note: "Reported by the IT Manager",
    });
    await expect(
      svc.hrCaseStep(hr, c.id, {
        kind: "inquiry_set",
        note: "Panel",
        panelIds: ["u-coo"],
        hearingOn: addDays(TODAY, 10),
      }),
    ).rejects.toThrow(/show-cause/);
    const sc = await svc.hrCaseStep(hr, c.id, {
      kind: "show_cause",
      note: "Explain the absence of 20 to 22 Oct",
    });
    expect(sc.steps.at(-1)!.replyDue).toBe(addDays(TODAY, 7));
    await svc.hrCaseStep(hr, c.id, {
      kind: "reply",
      note: "Staff replied: family emergency, no proof",
    });
    // Nobody involved sits on the panel.
    await expect(
      svc.hrCaseStep(hr, c.id, {
        kind: "inquiry_set",
        note: "Panel",
        panelIds: ["u-it-ex3"],
        hearingOn: addDays(TODAY, 10),
      }),
    ).rejects.toThrow(/do not sit/);
    await expect(
      svc.hrCaseStep(hr, c.id, {
        kind: "inquiry_set",
        note: "Panel",
        panelIds: [hr.id],
        hearingOn: addDays(TODAY, 10),
      }),
    ).rejects.toThrow(/do not sit/);
    await svc.hrCaseStep(hr, c.id, {
      kind: "inquiry_set",
      note: "Panel of two",
      panelIds: ["u-coo", "u-pwvsb-doa"],
      hearingOn: addDays(TODAY, 10),
    });
    // HR cannot record a dismissal; the HR Director can, only after a proven inquiry.
    await expect(
      svc.hrCaseStep(hr, c.id, {
        kind: "outcome",
        note: "Dismiss",
        outcome: "dismissal",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.hrCaseStep(cos, c.id, {
        kind: "outcome",
        note: "Dismiss",
        outcome: "dismissal",
      }),
    ).rejects.toThrow(/due inquiry/);
    await svc.hrCaseStep(hr, c.id, {
      kind: "inquiry_held",
      note: "Hearing held, staff present",
      proven: true,
    });
    await expect(
      svc.hrCaseStep(cos, c.id, {
        kind: "outcome",
        note: "Suspend",
        outcome: "suspension",
        suspensionDays: 20,
      }),
    ).rejects.toThrow(/14 days/);
    const done = await svc.hrCaseStep(cos, c.id, {
      kind: "outcome",
      note: "Final warning and 5 days without pay",
      outcome: "suspension",
      suspensionDays: 5,
    });
    expect(done.steps.at(-1)!.outcome).toBe("suspension");
    // The staff member's file shows every step.
    const file = await svc.hrCases(hr, staff.personId!);
    expect(file.rows[0].steps.map((s) => s.kind)).toEqual([
      "note",
      "show_cause",
      "reply",
      "inquiry_set",
      "inquiry_held",
      "outcome",
    ]);
    // A company manager monitors their own company's non-confidential cases only; others are refused.
    expect(ds.hrCases.length).toBe(1);
    await expect(
      svc.openHrCase(await svc.user("u-cm-sasa"), {
        personId: staff.personId!,
        kind: "misconduct",
        title: "Not HR",
        complainantId: null,
        receivedOn: TODAY,
        note: "",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.hrCases(await svc.user("u-it-ex1")),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it("keeps a sexual harassment complaint confidential and answers it within 30 days", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const resp = await svc.user("u-it-ex3");
    const comp = await svc.user("u-it-ex1");
    const c = await svc.openHrCase(hr, {
      personId: resp.personId!,
      kind: "sexual_harassment",
      title: "Complaint about remarks in the office",
      complainantId: comp.personId!,
      receivedOn: TODAY,
      note: "Written complaint received",
    });
    expect(c.confidential).toBe(true);
    const view = (await svc.hrCases(hr)).rows.find((r) => r.id === c.id)!;
    expect(view.shAnswerBy).toBe(addDays(TODAY, 30));
    // A company manager never sees it; the CEO does.
    expect(
      (await svc.hrCases(await svc.user("u-fauzan"))).rows.some(
        (r) => r.id === c.id,
      ),
    ).toBe(true);
    const cm = await svc.hrCases(await svc.user("u-cm-sasa"));
    expect(cm.rows.some((r) => r.id === c.id)).toBe(false);
    // Refusing needs written reasons; the complainant never sits on the panel.
    await expect(
      svc.hrCaseStep(hr, c.id, { kind: "refuse_inquiry", note: "No" }),
    ).rejects.toThrow(/reasons/);
    await expect(
      svc.hrCaseStep(hr, c.id, {
        kind: "inquiry_set",
        note: "Panel",
        panelIds: [comp.id],
        hearingOn: addDays(TODAY, 14),
      }),
    ).rejects.toThrow(/do not sit/);
    await svc.hrCaseStep(hr, c.id, {
      kind: "inquiry_set",
      note: "Panel of two from another department",
      panelIds: ["u-coo", "u-pwvsb-doa"],
      hearingOn: addDays(TODAY, 14),
    });
    expect(
      (await svc.hrCases(hr)).rows.find((r) => r.id === c.id)!.shAnswerBy,
    ).toBeNull();
  });

  it("reminds HR to display the sexual harassment notice at each workplace", () => {
    const { ds } = fresh();
    const due = filingsDue(ds.people, [], TODAY).filter(
      (f) => f.kind === "SH_NOTICE",
    );
    expect(due.length).toBeGreaterThan(0);
    expect(due[0].period).toBe("2026");
  });
});
