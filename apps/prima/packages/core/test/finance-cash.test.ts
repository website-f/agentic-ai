import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  GROUP_EMPLOYER_ID,
  MemoryStore,
  PrimaService,
  finCloseCheck,
  generateDataset,
  myt,
  parseCardLines,
} from "../src";
type FinStatusT = import("../src").FinStatus;

// Bank mandates, staff advances, petty cash, company cards and the duplicate invoice check (Fauzan, 2 Nov 2026: yes to
// suggestions 6, 7, 8, 9 and 14). Played on mock data through the same calls the screens use. Dummy data only.
const TODAY = "2026-10-31";
const NOW = myt(TODAY, "10:00");
const C = GROUP_EMPLOYER_ID;
const STAFF_PAYEE = "payee-pwvsb-staff";
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const F = () => ds.finStatus.find((x) => x.companyId === C)!;
  // A staff member as a verified payee, entered by the leader (so the clerks may prepare payments to them).
  F().payees = [
    ...(F().payees ?? []),
    {
      id: STAFF_PAYEE,
      name: "PWVSB HR",
      kind: "payroll",
      regNo: "Staff no HR-001 (mock)",
      bank: "Maybank",
      accountLast4: "4321",
      accountName: "PWVSB HR",
      status: "verified",
      entered: {
        by: "Finance Team Leader 1",
        byId: "u-fin-t1-lead",
        at: NOW,
        comment: "Staff bank form (mock)",
      },
      verified: {
        by: "Deputy",
        byId: "u-fin-t1-dep",
        at: NOW,
        comment: "Confirmed.",
        method: "callback",
        contact: "Staff (mock)",
        numberSource: "HR file (mock)",
      },
      history: [],
    },
  ];
  return { ds, svc, F };
};
const who = (svc: PrimaService, ...ids: string[]) =>
  Promise.all(ids.map((id) => svc.user(id)));
const bank = (f: FinStatusT) => f.banks[0].id;
let n = 0;
const ref = () => `PI-CASH-${++n}`;

async function payOut(
  svc: PrimaService,
  paymentId: string,
  release: Record<string, unknown> = {},
) {
  const [dep, fd, de2] = await who(svc, "u-fin-t1-dep", "u-fd", "u-fin-t1-de2");
  await svc.finance.paymentStep(dep, C, paymentId, "review", {
    comment: "Agrees.",
  });
  await svc.finance.paymentStep(fd, C, paymentId, "approve", {
    comment: "Pay it.",
  });
  const p = (await svc.financeControls.view(fd, C)).payees.find(
    (x) => x.id === STAFF_PAYEE,
  )!;
  return svc.finance.paymentStep(de2, C, paymentId, "release", {
    bankRef: `M2U-${paymentId.slice(-3)}`,
    accountLast4: p.accountLast4,
    accountName: p.accountName,
    ...release,
  });
}

describe("Bank mandate register", () => {
  it("is checked by a second person, then releases must come from someone on it, with a second approver when needed", async () => {
    const { svc, F } = fresh();
    const [de1, de2, lead, dep, fd] = await who(
      svc,
      "u-fin-t1-de1",
      "u-fin-t1-de2",
      "u-fin-t1-lead",
      "u-fin-t1-dep",
      "u-fd",
    );
    const m = (await svc.financeControls.mandateAction(de1, C, "add", {
      bankId: bank(F()),
      rule: "any_one",
      twoAbove: 10000,
      people: [
        { userId: "u-fin-t1-de2", role: "portal_approver" },
        { userId: "u-fin-t1-lead", role: "portal_approver" },
        { name: "Outside director (mock)", role: "signatory" },
        { userId: "u-fin-t1-de1", role: "portal_maker" },
      ],
      docs: [
        "Board resolution 2026-07 (mock).pdf",
        "Maybank mandate form (mock).pdf",
      ],
    })) as { id: string };
    await expect(
      svc.financeControls.mandateAction(de1, C, "check", {
        mandateId: m.id,
        comment: "Agrees to bank letter",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    // The leader is on it; the deputy (not on it) checks.
    await expect(
      svc.financeControls.mandateAction(lead, C, "check", {
        mandateId: m.id,
        comment: "Agrees to bank letter",
      }),
    ).rejects.toThrow(/on this mandate/);
    await svc.financeControls.mandateAction(dep, C, "check", {
      mandateId: m.id,
      comment: "Agrees to the Maybank confirmation letter (mock)",
    });
    expect(F().mandates![0].status).toBe("active");

    // A payment under RM10,000: one approver on the mandate. The deputy (not on it) cannot record the release.
    const p = await svc.finance.createPayment(de1, C, {
      payeeId: "payee-pwvsb-001",
      purpose: "Office supplies",
      amount: 2500,
      dueOn: "2026-11-05",
      bankId: bank(F()),
      sqlRef: ref(),
      evidence: ["bill.pdf"],
    });
    await svc.finance.paymentStep(dep, C, p.id, "review", {
      comment: "Agrees.",
    });
    await svc.finance.paymentStep(fd, C, p.id, "approve", {
      comment: "Pay it.",
    });
    const rel = {
      bankRef: "M2U-77",
      accountLast4: "1000",
      accountName: "SYARIKAT BEKALAN PEJABAT",
    };
    await expect(
      svc.finance.paymentStep(dep, C, p.id, "release", rel),
    ).rejects.toThrow(/not an approver on the bank mandate/);
    expect(
      (await svc.finance.paymentStep(de2, C, p.id, "release", rel)).status,
    ).toBe("released");

    // Above RM10,000 two are needed: the second approver is named, never the preparer.
    const q = await svc.finance.createPayment(de1, C, {
      payeeId: "payee-pwvsb-001",
      purpose: "Furniture",
      amount: 15000,
      dueOn: "2026-11-05",
      bankId: bank(F()),
      sqlRef: ref(),
      evidence: ["bill.pdf"],
    });
    await svc.finance.paymentStep(dep, C, q.id, "review", {
      comment: "Agrees.",
    });
    await svc.finance.paymentStep(fd, C, q.id, "approve", {
      comment: "Pay it.",
    });
    await expect(
      svc.finance.paymentStep(de2, C, q.id, "release", rel),
    ).rejects.toThrow(/two approvers/);
    const done = await svc.finance.paymentStep(de2, C, q.id, "release", {
      ...rel,
      bankRef: "M2U-78",
      coApproverId: "u-fin-t1-lead",
    });
    expect(done.steps.at(-1)!.comment).toMatch(
      /second approver in the bank: Finance Team Leader 1/,
    );
  });

  it("asks for a review when someone on it leaves, and the review is refused until the bank list changes", async () => {
    const { svc, F, ds } = fresh();
    const [de1, dep, fd] = await who(
      svc,
      "u-fin-t1-de1",
      "u-fin-t1-dep",
      "u-fd",
    );
    const m = (await svc.financeControls.mandateAction(de1, C, "add", {
      bankId: bank(F()),
      rule: "any_one",
      people: [{ userId: "u-fin-t1-de2", role: "portal_approver" }],
      docs: ["mandate.pdf"],
    })) as { id: string };
    await svc.financeControls.mandateAction(dep, C, "check", {
      mandateId: m.id,
      comment: "Agrees to the bank letter (mock)",
    });
    ds.users.find((u) => u.id === "u-fin-t1-de2")!.accessClosedFrom =
      "2026-10-30";
    const home = await svc.financeControls.home(fd);
    expect(
      home.find((h) => /bank mandate\(s\) to update/.test(h.title))?.detail,
    ).toMatch(/has left/);
    await expect(
      svc.financeControls.mandateAction(dep, C, "review", {
        mandateId: m.id,
        comment: "Bank confirmed",
      }),
    ).rejects.toThrow(/left/);
  });
});

describe("Staff cash advances", () => {
  it("pays through the normal approvals, is settled with receipts by the staff member and checked by someone else", async () => {
    const { svc, F } = fresh();
    const [de1, hr, dep, lead] = await who(
      svc,
      "u-fin-t1-de1",
      "u-pwvsb-hr",
      "u-fin-t1-dep",
      "u-fin-t1-lead",
    );
    const x = (await svc.financeControls.advanceAction(de1, C, "add", {
      payeeId: STAFF_PAYEE,
      userId: "u-pwvsb-hr",
      amount: 800,
      purpose: "Site start-up at Kuantan (mock)",
      bankId: bank(F()),
      sqlRef: ref(),
      evidence: ["Advance form signed by the CoS (mock).pdf"],
    })) as { id: string; paymentId: string; settleBy: string };
    expect(x.settleBy).toBe("2026-11-30");
    // Not paid yet: nothing to settle.
    await expect(
      svc.financeControls.advanceAction(hr, C, "settle", {
        advanceId: x.id,
        spent: 600,
        returned: 200,
        returnRef: "CDM 123",
        receipts: ["r.pdf"],
      }),
    ).rejects.toThrow(/not been paid/);
    await payOut(svc, x.paymentId);
    // The staff member (outside Finance) sees it and settles it; the sums must agree.
    const mine = await svc.financeControls.cashMine(hr);
    expect(mine[0].advances[0]).toMatchObject({
      id: x.id,
      paid: true,
      overdue: false,
    });
    await expect(
      svc.financeControls.advanceAction(hr, C, "settle", {
        advanceId: x.id,
        spent: 600,
        returned: 100,
        returnRef: "CDM 123",
        receipts: ["r.pdf"],
      }),
    ).rejects.toThrow(/must equal/);
    await svc.financeControls.advanceAction(hr, C, "settle", {
      advanceId: x.id,
      spent: 600,
      returned: 200,
      returnRef: "CDM 123 (mock)",
      receipts: ["hotel.pdf", "fuel.pdf"],
    });
    // The staff member cannot check their own; someone in Finance does.
    await expect(
      svc.financeControls.advanceAction(hr, C, "check", {
        advanceId: x.id,
        comment: "All fine",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.advanceAction(dep, C, "check", {
      advanceId: x.id,
      comment: "Receipts agree; RM200 seen in the bank (mock)",
    });
    expect(F().advances![0].status).toBe("settled");
    // Recovery only for an overdue one.
    await expect(
      svc.financeControls.advanceAction(lead, C, "recover", {
        advanceId: x.id,
        how: "payroll",
        ref: "2026-11",
        comment: "Not settled in time",
      }),
    ).rejects.toThrow(/overdue/);
  });

  it("an overdue advance is shown to Finance and HR, blocks a new one and keeps the close open", async () => {
    const { svc, F } = fresh();
    const [de1, de2, hr, fd, lead] = await who(
      svc,
      "u-fin-t1-de1",
      "u-fin-t1-de2",
      "u-pwvsb-hr",
      "u-fd",
      "u-fin-t1-lead",
    );
    const x = (await svc.financeControls.advanceAction(de1, C, "add", {
      payeeId: STAFF_PAYEE,
      userId: "u-pwvsb-hr",
      amount: 500,
      purpose: "Travel to Kedah (mock)",
      settleBy: TODAY,
      bankId: bank(F()),
      sqlRef: ref(),
      evidence: ["form.pdf"],
    })) as { id: string; paymentId: string };
    await payOut(svc, x.paymentId);
    F().advances![0].settleBy = "2026-10-20";
    expect(
      (await svc.financeControls.home(lead)).some((h) =>
        /staff advance\(s\) past the settle-by date/.test(h.title),
      ),
    ).toBe(true);
    expect(await svc.financeControls.advancesForHr(hr)).toEqual([
      expect.objectContaining({ id: x.id, name: "PWVSB HR", days: 11 }),
    ]);
    await expect(
      svc.financeControls.advancesForHr(await svc.user("u-guard-sasa-1")),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.financeControls.advanceAction(de2, C, "add", {
        payeeId: STAFF_PAYEE,
        userId: "u-pwvsb-hr",
        amount: 100,
        purpose: "Another trip (mock)",
        bankId: bank(F()),
        sqlRef: ref(),
        evidence: ["form.pdf"],
      }),
    ).rejects.toThrow(/has not settled/);
    expect(
      finCloseCheck(F(), null, "2026-10", NOW).exceptions.map((e) => e.key),
    ).toContain(`advance:${x.id}`);
    // Written off only by the Finance Director or the CEO; recovered through payroll by the leader.
    await expect(
      svc.financeControls.advanceAction(lead, C, "recover", {
        advanceId: x.id,
        how: "written_off",
        ref: "FD memo",
        comment: "Staff left the group",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.advanceAction(fd, C, "recover", {
      advanceId: x.id,
      how: "payroll",
      ref: "Payroll 2026-11 line HR-001",
      comment: "Receipts never came; deduct from November pay",
    });
    expect(F().advances![0].status).toBe("recovered");
  });

  it("nobody prepares their own advance, and its payment keeps the advance amount", async () => {
    const { svc, F } = fresh();
    const [de1, de2] = await who(svc, "u-fin-t1-de1", "u-fin-t1-de2");
    await expect(
      svc.financeControls.advanceAction(de1, C, "add", {
        payeeId: STAFF_PAYEE,
        userId: "u-fin-t1-de1",
        amount: 100,
        purpose: "My own trip",
        bankId: bank(F()),
        sqlRef: ref(),
        evidence: ["f.pdf"],
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const x = (
      await svc.financeControls.advanceAction(de1, C, "add", {
        payeeId: STAFF_PAYEE,
        userId: "u-pwvsb-hr",
        amount: 300,
        purpose: "Trip to Johor (mock)",
        bankId: bank(F()),
        sqlRef: ref(),
        evidence: ["f.pdf"],
      })
    ).paymentId as string;
    const [dep] = await who(svc, "u-fin-t1-dep");
    await svc.finance.paymentStep(dep, C, x, "return", {
      comment: "Wrong form attached here",
    });
    await expect(
      svc.finance.paymentStep(de1, C, x, "resubmit", { amount: 3000 }),
    ).rejects.toThrow(/This pays advance/);
    await svc.finance.paymentStep(de1, C, x, "cancel", {
      comment: "Trip called off by manager",
    });
    expect(F().advances![0].status).toBe("cancelled");
  });
});

describe("Petty cash", () => {
  it("custodian spends with receipts, Finance tops up exactly the vouchers, someone else counts", async () => {
    const { svc, F } = fresh();
    const [de1, dep, hr, de2] = await who(
      svc,
      "u-fin-t1-de1",
      "u-fin-t1-dep",
      "u-pwvsb-hr",
      "u-fin-t1-de2",
    );
    // C4 (Fauzan, 11 Nov 2026): the rule now proposes a RM500 float and RM50 vouchers, and "FD can set the correct
    // amounts later". At the proposed amounts a RM1,000 float and a RM60 voucher are refused; this office's flow runs
    // after the FD sets RM5,000 and RM500 for it, with a reason.
    await expect(
      svc.financeControls.pettyAction(de1, C, "add", { office: "PWVSB HQ (mock)", custodianId: "u-pwvsb-hr", payeeId: STAFF_PAYEE, bankId: bank(F()), float: 1000 }),
    ).rejects.toThrow(/RM500.00/);
    const fd = await svc.user("u-fd");
    await svc.finance.setSettings(fd, { values: { pettyFloatMax: 5000, pettyVoucherMax: 500 }, comment: "Synthetic: HQ office amounts" });
    const pc = (await svc.financeControls.pettyAction(de1, C, "add", {
      office: "PWVSB HQ (mock)",
      custodianId: "u-pwvsb-hr",
      payeeId: STAFF_PAYEE,
      bankId: bank(F()),
      float: 1000,
    })) as { id: string };
    await expect(
      svc.financeControls.pettyAction(hr, C, "voucher", {
        pettyId: pc.id,
        amount: 50,
        purpose: "Stamps",
        receipt: "r.jpg",
      }),
    ).rejects.toThrow(/checks the float first/);
    await svc.financeControls.pettyAction(dep, C, "check", {
      pettyId: pc.id,
      comment: "Float form signed by CoS (mock)",
    });
    // Only the custodian pays from it; above RM500 is a normal payment.
    await expect(
      svc.financeControls.pettyAction(de1, C, "voucher", {
        pettyId: pc.id,
        amount: 50,
        purpose: "Stamps",
        receipt: "r.jpg",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.financeControls.pettyAction(hr, C, "voucher", {
        pettyId: pc.id,
        amount: 600,
        purpose: "Printer",
        receipt: "r.jpg",
      }),
    ).rejects.toThrow(/RM500.00 or less/);
    await svc.financeControls.pettyAction(hr, C, "voucher", {
      pettyId: pc.id,
      amount: 120.5,
      purpose: "Courier to KDN (mock)",
      receipt: "courier.jpg",
    });
    await svc.financeControls.pettyAction(hr, C, "voucher", {
      pettyId: pc.id,
      amount: 380,
      purpose: "Pantry (mock)",
      receipt: "pantry.jpg",
    });
    expect((await svc.financeControls.cashMine(hr))[0].petty[0]).toMatchObject({
      expected: 499.5,
      waiting: 500.5,
    });
    // The custodian does not count, and a difference needs a reason.
    await expect(
      svc.financeControls.pettyAction(hr, C, "count", {
        pettyId: pc.id,
        cash: 499.5,
      }),
    ).rejects.toThrow();
    await expect(
      svc.financeControls.pettyAction(de1, C, "count", {
        pettyId: pc.id,
        cash: 489.5,
      }),
    ).rejects.toThrow(/difference/);
    await svc.financeControls.pettyAction(de1, C, "count", {
      pettyId: pc.id,
      cash: 499.5,
    });
    // Top-up: exactly the two vouchers, prepared as a payment to the custodian.
    const t = (await svc.financeControls.pettyAction(de1, C, "topup", {
      pettyId: pc.id,
    })) as { paymentId: string; amount: number };
    expect(t.amount).toBe(500.5);
    const pay = F().payments!.find((p) => p.id === t.paymentId)!;
    expect(pay).toMatchObject({
      amount: 500.5,
      payeeId: STAFF_PAYEE,
      status: "prepared",
    });
    await expect(
      svc.financeControls.pettyAction(de2, C, "topup", { pettyId: pc.id }),
    ).rejects.toThrow(/No vouchers/);
    await payOut(svc, t.paymentId);
    expect((await svc.financeControls.cashMine(hr))[0].petty[0]).toMatchObject({
      expected: 1000,
      waiting: 0,
    });
  });

  it("a float not counted for the month keeps the close open", async () => {
    const { svc, F } = fresh();
    const [de1, dep] = await who(svc, "u-fin-t1-de1", "u-fin-t1-dep");
    const pc = (await svc.financeControls.pettyAction(de1, C, "add", {
      office: "Branch office (mock)",
      custodianId: "u-pwvsb-hr",
      payeeId: STAFF_PAYEE,
      bankId: bank(F()),
      float: 500,
    })) as { id: string };
    await svc.financeControls.pettyAction(dep, C, "check", {
      pettyId: pc.id,
      comment: "Float form signed (mock)",
    });
    F().pettyCash![0].checked!.at = myt("2026-09-01", "10:00");
    expect(
      finCloseCheck(F(), null, "2026-10", NOW).exceptions.map((e) => e.key),
    ).toContain(`petty:${pc.id}:2026-10`);
  });
});

describe("Company cards", () => {
  it("the holder explains each line, personal use is paid back, and someone else reviews", async () => {
    const { svc, F } = fresh();
    const [de1, dep, hr, lead] = await who(
      svc,
      "u-fin-t1-de1",
      "u-fin-t1-dep",
      "u-pwvsb-hr",
      "u-fin-t1-lead",
    );
    const c = (await svc.financeControls.cardAction(de1, C, "add", {
      kind: "fuel",
      issuer: "Petronas Smartpay (mock)",
      last4: "5521",
      holderId: "u-pwvsb-hr",
      limit: 2000,
    })) as { id: string };
    await expect(
      svc.financeControls.cardAction(de1, C, "add", {
        kind: "fuel",
        issuer: "Petronas",
        last4: "5521 1234",
        holderId: "u-pwvsb-hr",
        limit: 2000,
      }),
    ).rejects.toThrow(/last 4/);
    await svc.financeControls.cardAction(dep, C, "check", {
      cardId: c.id,
      comment: "Card letter from Petronas (mock)",
    });
    await expect(
      svc.financeControls.cardAction(de1, C, "statement", {
        cardId: c.id,
        period: "2026-08",
        total: 300,
        doc: "stmt.pdf",
        lines:
          "2026-10-03\tPetronas Kuantan\t150.00\n2026-10-09\tPetronas Gambang\t120.00",
      }),
    ).rejects.toThrow(/add up/);
    const st = (await svc.financeControls.cardAction(de1, C, "statement", {
      cardId: c.id,
      period: "2026-09",
      total: 270,
      doc: "Petronas statement Sep (mock).pdf",
      lines:
        '2026-09-03\tPetronas Kuantan\t150.00\n2026-09-09,"Petronas, Gambang",120.00',
    })) as { id: string; lines: { id: string }[] };
    // Finance cannot give a line a business purpose; only mark it personal.
    await expect(
      svc.financeControls.cardAction(de1, C, "explain", {
        cardId: c.id,
        statementId: st.id,
        lineId: st.lines[0].id,
        receipt: "r.jpg",
        purpose: "Site visit",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.cardAction(hr, C, "explain", {
      cardId: c.id,
      statementId: st.id,
      lineId: st.lines[0].id,
      receipt: "fuel-0903.jpg",
      purpose: "Site visit Kuantan (mock)",
    });
    await expect(
      svc.financeControls.cardAction(dep, C, "review", {
        cardId: c.id,
        statementId: st.id,
        comment: "All receipts agree",
      }),
    ).rejects.toThrow(/1 line/);
    await svc.financeControls.cardAction(hr, C, "explain", {
      cardId: c.id,
      statementId: st.id,
      lineId: st.lines[1].id,
      personal: true,
      purpose: "Family trip, will pay back",
    });
    expect(
      finCloseCheck(F(), null, "2026-09", NOW).exceptions.map((e) => e.key),
    ).toEqual(
      expect.arrayContaining([
        `card:${c.id}:2026-09`,
        `cardpersonal:${c.id}:2026-09`,
      ]),
    );
    // The holder neither reviews nor records the repayment.
    await expect(
      svc.financeControls.cardAction(hr, C, "review", {
        cardId: c.id,
        statementId: st.id,
        comment: "Fine",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.cardAction(lead, C, "recover", {
      cardId: c.id,
      statementId: st.id,
      lineId: st.lines[1].id,
      how: "payroll",
      ref: "Payroll 2026-10",
    });
    await svc.financeControls.cardAction(dep, C, "review", {
      cardId: c.id,
      statementId: st.id,
      comment: "Receipts agree; personal fuel deducted in October pay",
    });
    expect(
      finCloseCheck(F(), null, "2026-09", NOW).exceptions.filter((e) =>
        e.key.includes(c.id),
      ),
    ).toEqual([]);
  });

  it("reads pasted lines with commas inside quotes and refunds as minus", () => {
    expect(
      parseCardLines(
        '2026-09-01,"Shell, Bentong",-20.50\n2026-09-02\tCaltex\t1,234.00',
      ),
    ).toEqual([
      { date: "2026-09-01", merchant: "Shell, Bentong", amount: -20.5 },
      { date: "2026-09-02", merchant: "Caltex", amount: 1234 },
    ]);
  });
});

describe("Duplicate supplier invoices", () => {
  it("refuses the same supplier invoice number in another company and asks why for the same amount", async () => {
    const { svc, ds, F } = fresh();
    const [fd, de1] = await who(svc, "u-fd", "u-fin-t1-de1");
    const other = ds.finStatus.find(
      (x) => x.companyId !== C && (x.payees ?? []).length,
    )!;
    const otherPayee = other.payees!.find(
      (x) => x.name === "Syarikat Bekalan Pejabat (mock)",
    )!;
    // The FD prepares in another company for invoice INV-9001 from the same supplier.
    await svc.finance.createPayment(fd, other.companyId, {
      payeeId: otherPayee.id,
      purpose: "Office supplies",
      amount: 1234.5,
      dueOn: "2026-11-05",
      bankId: other.banks[0].id,
      sqlRef: ref(),
      evidence: ["bill.pdf"],
      invoiceNo: "INV-9001",
    });
    const base = {
      payeeId: "payee-pwvsb-001",
      purpose: "Office supplies",
      dueOn: "2026-11-06",
      bankId: bank(F()),
      evidence: ["bill.pdf"],
    };
    // The FD sees every company: the same invoice number (written differently) is refused.
    await expect(
      svc.finance.createPayment(fd, C, {
        ...base,
        amount: 99,
        sqlRef: ref(),
        invoiceNo: "inv 9001",
      }),
    ).rejects.toThrow(/Duplicate invoice: Invoice inv 9001/);
    // Same amount within 45 days: refused without a reason, accepted with one, and the reason stays on the payment.
    await expect(
      svc.finance.createPayment(fd, C, {
        ...base,
        amount: 1234.5,
        sqlRef: ref(),
        invoiceNo: "INV-9002",
      }),
    ).rejects.toThrow(/looks like a duplicate/);
    const p = await svc.finance.createPayment(fd, C, {
      ...base,
      amount: 1234.5,
      sqlRef: ref(),
      invoiceNo: "INV-9002",
      notDuplicate: "Second delivery, separate invoice INV-9002",
    });
    expect(p.notDuplicate).toMatch(/^Second delivery.*\[similar: .*in /);
    // A clerk in team 1 who cannot see the other company is still stopped at approval by the FD, who sees all.
    const q = await svc.finance
      .createPayment(de1, C, {
        ...base,
        amount: 77,
        sqlRef: ref(),
        invoiceNo: "INV-9001 ",
      })
      .catch((e: Error) => e);
    expect(String(q)).toMatch(/Duplicate invoice|looks like/);
  });

  it("monthly regular payments of the same amount are not duplicates of each other", async () => {
    const { svc, F } = fresh();
    const [de1, dep] = await who(svc, "u-fin-t1-de1", "u-fin-t1-dep");
    const mk = (sqlRef: string, dueOn: string) =>
      svc.finance.createPayment(de1, C, {
        payeeId: "payee-pwvsb-004",
        purpose: "TNB bill",
        amount: 640,
        dueOn,
        bankId: bank(F()),
        sqlRef,
        evidence: ["tnb.pdf"],
      });
    await mk(ref(), "2026-11-05");
    await expect(mk(ref(), "2026-11-20")).rejects.toThrow(
      /looks like a duplicate/,
    );
    // Outside the 45-day window it is fine.
    expect((await mk(ref(), "2027-01-10")).status).toBe("prepared");
    void dep;
  });
});
