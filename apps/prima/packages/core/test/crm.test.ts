import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  MemoryStore,
  NotFound,
  PrimaService,
  addDays,
  generateDataset,
  myt,
} from "../src";

// Client CRM (Fauzan, 4 Nov 2026: "We want complete"). Synthetic data only.
const TODAY = "2026-11-04";
const NOW = myt(TODAY, "10:00");
const doc = (n: string) => ({
  kind: "document" as const,
  name: `${n}.pdf`,
  data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${n}`).toString("base64")}`,
});

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const om = await svc.user("u-om-klang");
  const acct = (await svc.clientBoard(om)).accounts.find(
    (a) => a.canAct && a.stage === "active" && a.companyId === "co-sasa",
  )!;
  // A clean CRM history for this client.
  await store.update("clientAccounts", acct.id, {
    people: [],
    requests: [],
    renewal: null,
    renewals: [],
    owner: null,
  });
  // No admin executive is seeded for Sasa: a synthetic one, like Arrow Shield's.
  const aeArsh = (await store.get("users", "u-ae-arsh"))!;
  await store.insert("users", {
    ...aeArsh,
    id: "u-ae-sasa-test",
    name: "Synthetic Admin Exec",
    companyIds: ["co-sasa"],
  });
  const u = (id: string) => svc.user(id);
  return {
    ds,
    store,
    svc,
    om,
    acct,
    u,
    cm: await u("u-cm-sasa"),
    cmOther: await u("u-cm-arsh"),
    ae: await u("u-ae-sasa-test"),
    aeOther: await u("u-ae-arsh"),
    coo: await u("u-coo"),
  };
}

describe("Client CRM", () => {
  it("keeps each company to its own clients; group leadership sees all and the group view", async () => {
    const { svc, acct, cm, cmOther, coo } = await setup();
    const own = await svc.crmBoard(cm);
    expect(own.clients.length).toBeGreaterThan(0);
    expect(own.clients.every((c) => c.companyId === "co-sasa")).toBe(true);
    expect(own.group).toBeNull();
    expect(own.leads.every((l) => l.companyId === "co-sasa")).toBe(true);
    const other = await svc.crmBoard(cmOther);
    expect(other.clients.some((c) => c.id === acct.id)).toBe(false);
    await expect(svc.crmClient(cmOther, acct.id)).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(
      svc.addClientPerson(cmOther, acct.id, {
        name: "X Y",
        position: "Manager",
        role: "site",
        phone: "0300000000",
        email: "",
        main: false,
      }),
    ).rejects.toBeInstanceOf(NotFound);
    const all = await svc.crmBoard(coo);
    expect(new Set(all.clients.map((c) => c.companyId)).size).toBeGreaterThan(
      1,
    );
    expect(all.group).not.toBeNull();
    expect(all.pipeline.map((p) => p.key)).toEqual([
      "lead",
      "proposal",
      "won",
      "onboarding",
      "active",
      "renewal",
      "offboarding",
      "ended",
    ]);
    // A guard sees no client screen at all.
    const guard = (await svc["store"].list("users", {})).find(
      (x) => x.role === "guard",
    );
    if (guard)
      await expect(svc.crmBoard(guard)).rejects.toBeInstanceOf(AccessDenied);
  });

  it("lets the company admin executives (sales, Fauzan 5 Nov 2026) open their own won lead, but not a client without one", async () => {
    const { svc, store, ae, aeOther } = await setup();
    const board = await svc.crmBoard(ae);
    expect(board.leads.length).toBeGreaterThan(0);
    const won = board.leads.find(
      (l) => l.stage === "won" && !l.clientAccountId,
    )!;
    expect(won.canConvert).toBe(true);
    await expect(
      svc.addClientAccount(ae, {
        companyId: "co-sasa",
        name: "No Lead Client (mock)",
        siteIds: [],
        contractEndsOn: null,
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.addClientAccount(aeOther, {
        companyId: "co-sasa",
        name: won.prospect,
        siteIds: [],
        contractEndsOn: null,
        leadId: won.id,
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const a = await svc.addClientAccount(ae, {
      companyId: "co-sasa",
      name: `${won.prospect} by sales`,
      siteIds: [],
      contractEndsOn: null,
      leadId: won.id,
    });
    expect((await store.get("salesLeads", won.id))!.clientAccountId).toBe(a.id);
  });

  it("turns a won lead into a client once, remembering where it came from", async () => {
    const { svc, store, cm, cmOther } = await setup();
    const board = await svc.crmBoard(cm);
    const won = board.leads.find(
      (l) => l.stage === "won" && !l.clientAccountId,
    )!;
    expect(won.canConvert).toBe(true);
    expect(board.pipeline.find((p) => p.key === "won")!.count).toBeGreaterThan(
      0,
    );
    const open = board.leads.find((l) => l.open)!;
    await expect(
      svc.addClientAccount(cm, {
        companyId: "co-sasa",
        name: "Open Lead Client (mock)",
        siteIds: [],
        contractEndsOn: null,
        leadId: open.id,
      }),
    ).rejects.toThrow(/Only a won lead/);
    await expect(
      svc.addClientAccount(cmOther, {
        companyId: "co-sasa",
        name: won.prospect,
        siteIds: [],
        contractEndsOn: null,
        leadId: won.id,
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const a = await svc.addClientAccount(cm, {
      companyId: "co-sasa",
      name: `${won.prospect} new`,
      siteIds: [],
      contractEndsOn: addDays(TODAY, 700),
      leadId: won.id,
    });
    expect(a.origin).toMatchObject({ kind: "lead", id: won.id });
    expect((await store.get("salesLeads", won.id))!.clientAccountId).toBe(a.id);
    await expect(
      svc.addClientAccount(cm, {
        companyId: "co-sasa",
        name: `${won.prospect} again`,
        siteIds: [],
        contractEndsOn: null,
        leadId: won.id,
      }),
    ).rejects.toThrow(/already a client/);
    const file = await svc.crmClient(cm, a.id);
    expect(file.lead?.ref).toBe(won.ref);
    expect(
      (await svc.crmBoard(cm)).leads.find((l) => l.id === won.id)!.canConvert,
    ).toBe(false);
  });

  it("keeps the client contacts: work details only, one main contact, history kept", async () => {
    const { svc, store, acct, ae, aeOther, coo } = await setup();
    expect(
      (await svc.crmClient(coo, acct.id)).issues.map((i) => i.what),
    ).toContain("No client contact person on record");
    await expect(
      svc.addClientPerson(aeOther, acct.id, {
        name: "Synthetic A",
        position: "Manager",
        role: "site",
        phone: "0300000000",
        email: "",
        main: true,
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      svc.addClientPerson(coo, acct.id, {
        name: "Synthetic A",
        position: "Manager",
        role: "site",
        phone: "0300000000",
        email: "",
        main: true,
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.addClientPerson(ae, acct.id, {
        name: "Synthetic A",
        position: "Manager",
        role: "site",
        phone: "",
        email: "",
        main: true,
      }),
    ).rejects.toThrow(/phone number or a work email/);
    await expect(
      svc.addClientPerson(ae, acct.id, {
        name: "Synthetic A",
        position: "Manager",
        role: "site",
        phone: "",
        email: "not-an-email",
        main: true,
      }),
    ).rejects.toThrow(/email is not valid/);
    await svc.addClientPerson(ae, acct.id, {
      name: "Synthetic A",
      position: "Facility Manager",
      role: "site",
      phone: "03-0000 0001",
      email: "",
      main: false,
    });
    await svc.addClientPerson(ae, acct.id, {
      name: "Synthetic B",
      position: "Accounts",
      role: "finance",
      phone: "",
      email: "ap@client.example",
      main: true,
    });
    let people = (await store.get("clientAccounts", acct.id))!.people!;
    expect(people.filter((p) => p.main).map((p) => p.name)).toEqual([
      "Synthetic B",
    ]);
    await expect(
      svc.addClientPerson(ae, acct.id, {
        name: "synthetic a",
        position: "X",
        role: "site",
        phone: "0300000000",
        email: "",
        main: false,
      }),
    ).rejects.toThrow(/already a contact/);
    await svc.updateClientPerson(ae, acct.id, people[0].id, "main");
    await svc.updateClientPerson(ae, acct.id, people[1].id, "remove");
    people = (await store.get("clientAccounts", acct.id))!.people!;
    expect(people.find((p) => p.name === "Synthetic A")!.main).toBe(true);
    expect(
      people.find((p) => p.name === "Synthetic B")!.removedAt,
    ).toBeTruthy();
    const file = await svc.crmClient(coo, acct.id);
    expect(file.people.map((p) => p.name)).toEqual(["Synthetic A"]);
    expect(file.pastPeople.map((p) => p.name)).toEqual(["Synthetic B"]);
  });

  it("logs client requests; Operations closes them, and more guards needs the signed variation", async () => {
    const { svc, store, acct, ae, om, cm } = await setup();
    await svc.addClientRequest(ae, acct.id, {
      kind: "more_guards",
      what: "One more night guard at the back gate",
      from: "Synthetic PIC",
      neededBy: null,
    });
    const q = (await store.get("clientAccounts", acct.id))!.requests![0];
    await expect(
      svc.closeClientRequest(ae, acct.id, q.id, {
        status: "done",
        outcome: "Added",
        variationRef: "V-1",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.closeClientRequest(cm, acct.id, q.id, {
        status: "done",
        outcome: "Added",
        variationRef: "V-1",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.closeClientRequest(om, acct.id, q.id, {
        status: "done",
        outcome: "Guard added from Monday",
      }),
    ).rejects.toThrow(/signed variation/);
    // Overdue after 14 days with no date given.
    const later = new PrimaService(store, () =>
      myt(addDays(TODAY, 20), "10:00"),
    );
    expect(
      (await later.crmBoard(cm)).open.find((x) => x.id === q.id)!.late,
    ).toBe(true);
    await svc.closeClientRequest(om, acct.id, q.id, {
      status: "done",
      outcome: "Guard added from Monday",
      variationRef: "VAR-SYN-01",
    });
    await expect(
      svc.closeClientRequest(om, acct.id, q.id, {
        status: "declined",
        outcome: "Not needed",
      }),
    ).rejects.toThrow(/already closed/);
    expect(
      (await store.get("clientAccounts", acct.id))!.requests![0],
    ).toMatchObject({ status: "done", variationRef: "VAR-SYN-01" });
    expect((await store.list("audit", {})).at(-1)!.action).toBe(
      "client.request.close",
    );
  });

  it("works a renewal: the company manager decides, the offer goes with proof, the signed renewal moves the end date", async () => {
    const { svc, store, acct, cm, cmOther, ae, coo, om } = await setup();
    const ends = addDays(TODAY, 50);
    await store.update("clientAccounts", acct.id, { contractEndsOn: ends });
    const st = (await svc.crmBoard(coo)).renewals.find(
      (r) => r.id === acct.id,
    )!;
    expect(st.renewal).toMatchObject({ daysLeft: 50, tone: "warn" });
    expect(st.renewal!.late).toMatch(/No decision/);
    for (const who of [ae, coo, om])
      await expect(
        svc.decideClientRenewal(who, acct.id, {
          choice: "renew",
          pricePct: 0,
          reason: "Good client",
        }),
      ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.decideClientRenewal(cmOther, acct.id, {
        choice: "renew",
        pricePct: 0,
        reason: "Good client",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      svc.decideClientRenewal(cm, acct.id, {
        choice: "renew_new_price",
        pricePct: 0,
        reason: "Wage rise",
      }),
    ).rejects.toThrow(/price change/);
    await expect(
      svc.decideClientRenewal(cm, acct.id, {
        choice: "renew",
        pricePct: 0,
        reason: "",
      }),
    ).rejects.toThrow(/reason/);
    await svc.decideClientRenewal(cm, acct.id, {
      choice: "renew_new_price",
      pricePct: 5,
      reason: "Minimum wage rise",
    });
    await expect(
      svc.answerClientRenewal(ae, acct.id, {
        choice: "accepted",
        note: "",
        newEndsOn: addDays(TODAY, 800),
        proof: [doc("signed")],
      }),
    ).rejects.toThrow(/Send the renewal offer first/);
    await expect(svc.sendClientRenewalOffer(ae, acct.id, [])).rejects.toThrow(
      /Attach the renewal offer/,
    );
    await svc.sendClientRenewalOffer(ae, acct.id, [doc("offer")]);
    await expect(
      svc.answerClientRenewal(ae, acct.id, {
        choice: "accepted",
        note: "",
        newEndsOn: addDays(TODAY, 800),
      }),
    ).rejects.toThrow(/signed renewal/);
    await expect(
      svc.answerClientRenewal(ae, acct.id, {
        choice: "accepted",
        note: "",
        newEndsOn: addDays(TODAY, 10),
        proof: [doc("signed")],
      }),
    ).rejects.toThrow(/after the current one/);
    await svc.answerClientRenewal(ae, acct.id, {
      choice: "accepted",
      note: "Two years",
      newEndsOn: addDays(TODAY, 780),
      proof: [doc("signed")],
    });
    const a = (await store.get("clientAccounts", acct.id))!;
    expect(a.contractEndsOn).toBe(addDays(TODAY, 780));
    expect(a.renewal).toBeNull();
    expect(a.renewals!.at(-1)!.answer!.choice).toBe("accepted");
    expect(
      (await svc.crmBoard(coo)).renewals.some((r) => r.id === acct.id),
    ).toBe(false);
    expect(
      (await svc.crmClient(coo, acct.id)).timeline.some(
        (e) => e.kind === "Renewal answer",
      ),
    ).toBe(true);
  });

  it("a client that will not renew leaves only offboarding, with the reason grouped for leadership", async () => {
    const { svc, store, acct, cm, ae, om, coo } = await setup();
    await store.update("clientAccounts", acct.id, {
      contractEndsOn: addDays(TODAY, 40),
    });
    await svc.decideClientRenewal(cm, acct.id, {
      choice: "renew",
      pricePct: 0,
      reason: "Keep",
    });
    await svc.sendClientRenewalOffer(ae, acct.id, [doc("offer")]);
    await expect(
      svc.answerClientRenewal(ae, acct.id, { choice: "declined", note: "" }),
    ).rejects.toThrow(/why the client will not renew/);
    await svc.answerClientRenewal(ae, acct.id, {
      choice: "declined",
      note: "Moving guards in-house",
    });
    const issues = (await svc.crmClient(coo, acct.id)).issues
      .map((i) => i.what)
      .join(" ");
    expect(issues).toMatch(/start offboarding/);
    await expect(
      svc.decideClientRenewal(cm, acct.id, {
        choice: "renew",
        pricePct: 0,
        reason: "Try again",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.startOffboarding(om, acct.id, "In-house", {
        reason: "nope" as "price",
      }),
    ).rejects.toThrow(/Choose why/);
    await expect(
      svc.startOffboarding(om, acct.id, "In-house", {
        reason: "in_house",
        winBackOn: TODAY,
      }),
    ).rejects.toThrow(/future/);
    await svc.startOffboarding(om, acct.id, "Client moved guards in-house", {
      reason: "in_house",
      winBackOn: addDays(TODAY, 365),
    });
    const b = await svc.crmBoard(coo);
    expect(b.lost.find((x) => x.id === acct.id)).toMatchObject({
      lostReason: "in_house",
      winBackOn: addDays(TODAY, 365),
    });
    expect(
      b.lostBy.find((x) => x.reason === "in_house")!.count,
    ).toBeGreaterThan(0);
  });

  it("names the person in charge from Operations who works for the company; monitors cannot", async () => {
    const { svc, store, acct, cm, coo } = await setup();
    const file = await svc.crmClient(cm, acct.id);
    expect(file.can.owner).toBe(true);
    expect(file.owners.some((o) => o.id === "u-om-klang")).toBe(true);
    await expect(
      svc.setClientOwner(coo, acct.id, "u-om-klang"),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setClientOwner(cm, acct.id, "u-cm-sasa")).rejects.toThrow(
      /Operations Manager/,
    );
    await svc.setClientOwner(cm, acct.id, "u-om-klang");
    expect((await store.get("clientAccounts", acct.id))!.owner).toMatchObject({
      userId: "u-om-klang",
      by: cm.name,
    });
  });

  it("shows the client file with only what the viewer may see: no lead or quotation for a site supervisor", async () => {
    const { svc, store, acct } = await setup();
    const sup = (await store.list("users", {})).find(
      (x) =>
        x.role === "supervisor" &&
        x.siteIds.some((id) => acct.siteIds.includes(id)),
    );
    if (!sup) return;
    await store.update("clientAccounts", acct.id, {
      origin: {
        kind: "lead",
        id: (await store.list("salesLeads", {}))[0].id,
        ref: "LD-X",
      },
    });
    const f = await svc.crmClient(sup, acct.id);
    expect(f.lead).toBeNull();
    expect(f.quotation).toBeNull();
    expect((await svc.crmBoard(sup)).leads).toEqual([]);
  });
});
