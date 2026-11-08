import { describe, expect, it } from "vitest";
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  generateDataset,
  myt,
} from "../src";

// Staff directory bulk load (Fauzan, 4 Nov 2026). Synthetic rows only: never the real staff list.
const TODAY = "2026-11-04";
const NOW = myt(TODAY, "10:00");
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const CSV = [
  "source_tab,group,org_unit,name,title,email,account_type,entra_status,verified,account_status,issues",
  "HQ,company,Example Guarding Sdn Bhd,Sample Manager A,PENGURUS,hq@example-guarding.test,Outlook HQ,Aktif,Telah Disahkan,Sedang digunakan,",
  "HQ,company,Example Guarding Sdn Bhd,Sample Exec B,,execb@outlook.com,Outlook Personal,Aktif,Telah Disahkan,Sedang digunakan,",
  "HQ,company,Example Guarding Sdn Bhd,Sample Exec C,EKSEKUTIF,hq@example-guarding.test,Outlook HQ,Aktif,,Sedang digunakan,",
  "UNIT,central_unit,UNIT IT,Sample IT Exec D,IT EKSEKUTIF,,,,,,",
  "OPERASI,operations_region,OPERASI JOHOR,Sample Ops E,PEGAWAI OPERASI,ops.e@outlookk.com,Outlook Personal,Aktif,Telah Disahkan,Sedang digunakan,",
].join("\n");
const SRC = "synthetic-staff.csv";

describe("staff directory", () => {
  it("previews without changing anything and works out the issues itself", async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = await svc.staffDirectory.preview(hr, { text: CSV, source: SRC });
    expect(p.missingColumns).toEqual([]);
    expect(p.rows).toHaveLength(5);
    expect(p.ready).toBe(5);
    const by = (n: string) => p.rows.find((r) => r.name === n)!;
    expect(by("Sample Manager A").issues).toEqual([
      "email_used_more_than_once",
      "company_not_matched",
    ]);
    expect(by("Sample Exec B").issues).toEqual([
      "personal_outlook",
      "no_title",
      "company_not_matched",
    ]);
    expect(by("Sample Exec C").issues).toContain("status_missing");
    expect(by("Sample IT Exec D").issues).toEqual([
      "no_email",
      "status_missing",
    ]);
    expect(by("Sample Ops E").issues).toEqual([
      "typo_domain",
      "personal_outlook",
    ]);
    expect(ds.staffDirectory).toHaveLength(0);
    expect(ds.staffDirectoryBatches).toHaveLength(0);
  });

  it("matches a company only by its exact name", async () => {
    const { ds, svc } = fresh();
    const name = ds.companies[0].name;
    const p = await svc.staffDirectory.preview(await svc.user("u-pwvsb-hr"), {
      text: `group,org_unit,name\ncompany,${name.toUpperCase()},Sample F\ncompany,${name} Two,Sample G`,
      source: SRC,
    });
    expect(p.rows[0].companyId).toBe(ds.companies[0].id);
    expect(p.rows[1].companyId).toBeNull();
  });

  it("HR sends, the HR Director approves with a comment, and every row goes in at once", async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = await svc.staffDirectory.preview(hr, { text: CSV, source: SRC });
    const sent = await svc.staffDirectory.submit(hr, {
      text: CSV,
      source: SRC,
      fingerprint: p.fingerprint,
    });
    expect(sent.rows).toBe(5);
    expect(ds.staffDirectory).toHaveLength(0);
    // The preparer, or anyone without the authority, cannot approve.
    await expect(
      svc.staffDirectory.decide(hr, {
        batchId: sent.id,
        approve: true,
        comment: "ok fine",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.staffDirectory.decide(await svc.user("u-it-lead"), {
        batchId: sent.id,
        approve: true,
        comment: "ok fine",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const cos = await svc.user("u-cos");
    await expect(
      svc.staffDirectory.decide(cos, {
        batchId: sent.id,
        approve: true,
        comment: "",
      }),
    ).rejects.toThrow(/comment/);
    const done = await svc.staffDirectory.decide(cos, {
      batchId: sent.id,
      approve: true,
      comment: "Checked against the HR list.",
    });
    expect(done).toEqual({ id: sent.id, status: "approved", added: 5 });
    expect(ds.staffDirectory).toHaveLength(5);
    expect(
      ds.audit.some((a) => a.action === "staff_directory.batch.approved"),
    ).toBe(true);
    // Nothing about access changed: no new users, no Microsoft links.
    expect(ds.users.some((u) => u.name.startsWith("Sample "))).toBe(false);
    await expect(
      svc.staffDirectory.decide(cos, {
        batchId: sent.id,
        approve: true,
        comment: "again please",
      }),
    ).rejects.toThrow(/already approved/);
  });

  it("never loads the same rows twice, and leaves out rows already in the directory", async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = await svc.staffDirectory.preview(hr, { text: CSV, source: SRC });
    const sent = await svc.staffDirectory.submit(hr, {
      text: CSV,
      source: SRC,
      fingerprint: p.fingerprint,
    });
    await expect(
      svc.staffDirectory.submit(hr, {
        text: CSV,
        source: SRC,
        fingerprint: p.fingerprint,
      }),
    ).rejects.toThrow(/already waiting/);
    await svc.staffDirectory.decide(await svc.user("u-fauzan"), {
      batchId: sent.id,
      approve: true,
      comment: "CEO checked",
    });
    await expect(
      svc.staffDirectory.submit(hr, {
        text: CSV,
        source: SRC,
        fingerprint: p.fingerprint,
      }),
    ).rejects.toThrow(/already/);
    const more = `${CSV}\nHQ,company,Example Guarding Sdn Bhd,Sample New H,EKSEKUTIF,h@example-guarding.test,Outlook HQ,Aktif,Telah Disahkan,Sedang digunakan,`;
    const p2 = await svc.staffDirectory.preview(hr, {
      text: more,
      source: "synthetic-v2.csv",
    });
    expect(p2.ready).toBe(1);
    expect(p2.rows.filter((r) => r.alreadyIn)).toHaveLength(5);
    const s2 = await svc.staffDirectory.submit(hr, {
      text: more,
      source: "synthetic-v2.csv",
      fingerprint: p2.fingerprint,
    });
    expect(s2).toMatchObject({ rows: 1, alreadyIn: 5 });
    await svc.staffDirectory.decide(await svc.user("u-dcos"), {
      batchId: s2.id,
      approve: true,
      comment: "One more joiner",
    });
    expect(ds.staffDirectory).toHaveLength(6);
  });

  it("refuses a batch with any bad row, or rows changed since the preview", async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const bad =
      "group,org_unit,name\ncompany,Example,Sample I\nnowhere,Example,Sample J\ncompany,,Sample K\ncompany,Example,Sample I";
    const p = await svc.staffDirectory.preview(hr, { text: bad, source: SRC });
    expect(p.rows.map((r) => r.errors.length > 0)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    await expect(
      svc.staffDirectory.submit(hr, {
        text: bad,
        source: SRC,
        fingerprint: p.fingerprint,
      }),
    ).rejects.toThrow(/Fix row 3, 4, 5/);
    const ok = await svc.staffDirectory.preview(hr, { text: CSV, source: SRC });
    await expect(
      svc.staffDirectory.submit(hr, {
        text: CSV.replace("Sample Exec B", "Sample Exec Z"),
        source: SRC,
        fingerprint: ok.fingerprint,
      }),
    ).rejects.toThrow(/changed since your preview/);
    const missing = await svc.staffDirectory.preview(hr, {
      text: "name,email\nSample L,l@example.test",
      source: SRC,
    });
    expect(missing.missingColumns).toEqual(["group", "orgUnit"]);
    expect(ds.staffDirectoryBatches).toHaveLength(0);
  });

  it("a returned batch adds nothing and can be sent again", async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = await svc.staffDirectory.preview(hr, { text: CSV, source: SRC });
    const sent = await svc.staffDirectory.submit(hr, {
      text: CSV,
      source: SRC,
      fingerprint: p.fingerprint,
    });
    expect(
      await svc.staffDirectory.decide(await svc.user("u-cos"), {
        batchId: sent.id,
        approve: false,
        comment: "Titles missing, fix first",
      }),
    ).toMatchObject({ status: "returned", added: 0 });
    expect(ds.staffDirectory).toHaveLength(0);
    await expect(
      svc.staffDirectory.submit(hr, {
        text: CSV,
        source: SRC,
        fingerprint: p.fingerprint,
      }),
    ).resolves.toMatchObject({ rows: 5 });
  });

  it("the HR Director cannot approve a batch they prepared", async () => {
    const { svc } = fresh();
    const cos = await svc.user("u-cos");
    const p = await svc.staffDirectory.preview(cos, { text: CSV, source: SRC });
    const sent = await svc.staffDirectory.submit(cos, {
      text: CSV,
      source: SRC,
      fingerprint: p.fingerprint,
    });
    await expect(
      svc.staffDirectory.decide(cos, {
        batchId: sent.id,
        approve: true,
        comment: "my own batch",
      }),
    ).rejects.toThrow(/other than the person who prepared/);
    await expect(
      svc.staffDirectory.decide(await svc.user("u-dcos"), {
        batchId: sent.id,
        approve: true,
        comment: "Deputy checked",
      }),
    ).resolves.toMatchObject({ added: 5 });
  });

  it("HR keys in one missing person by hand, with where it came from", async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const one = {
      group: "central_unit",
      orgUnit: "UNIT HR",
      name: "Sample Joiner M",
      title: "EKSEKUTIF HR",
      email: "m@example-group.test",
    };
    await expect(svc.staffDirectory.addOne(hr, one)).rejects.toThrow(
      /where the details come from/,
    );
    await svc.staffDirectory.addOne(hr, {
      ...one,
      sourceNote: "Offer letter on file",
    });
    expect(ds.staffDirectory).toHaveLength(1);
    expect(ds.staffDirectory[0]).toMatchObject({
      batchId: null,
      addedById: "u-pwvsb-hr",
      sourceNote: "Offer letter on file",
    });
    await expect(
      svc.staffDirectory.addOne(hr, { ...one, sourceNote: "Again" }),
    ).rejects.toThrow(/already in the directory/);
    await expect(
      svc.staffDirectory.addOne(await svc.user("u-it-lead"), {
        ...one,
        name: "Sample N",
        sourceNote: "IT says",
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it("only HR, the HR Director, the CEO and IT can see it", async () => {
    const { svc } = fresh();
    for (const id of [
      "u-pwvsb-hr",
      "u-cos",
      "u-dcos",
      "u-fauzan",
      "u-it-lead",
      "u-it-mgr",
    ])
      await expect(
        svc.staffDirectory.board(await svc.user(id)),
      ).resolves.toBeTruthy();
    for (const id of ["u-coo", "u-fd", "u-audit"])
      await expect(
        svc.staffDirectory.board(await svc.user(id)),
      ).rejects.toBeInstanceOf(AccessDenied);
    const it = await svc.staffDirectory.board(await svc.user("u-it-lead"));
    expect(it.can).toEqual({ prepare: false, approve: false, addOne: false });
    await expect(
      svc.staffDirectory.preview(await svc.user("u-it-lead"), {
        text: CSV,
        source: SRC,
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it("board counts issues across the whole directory, shared mailboxes included", async () => {
    const { svc } = fresh();
    const hr = await svc.user("u-pwvsb-hr");
    const p = await svc.staffDirectory.preview(hr, { text: CSV, source: SRC });
    const sent = await svc.staffDirectory.submit(hr, {
      text: CSV,
      source: SRC,
      fingerprint: p.fingerprint,
    });
    await svc.staffDirectory.decide(await svc.user("u-cos"), {
      batchId: sent.id,
      approve: true,
      comment: "Checked",
    });
    const b = await svc.staffDirectory.board(hr);
    expect(b.entries).toHaveLength(5);
    expect(b.issueCounts.email_used_more_than_once).toBe(2);
    expect(b.issueCounts.personal_outlook).toBe(2);
    expect(b.batches[0]).toMatchObject({
      status: "approved",
      rows: 5,
      canDecide: false,
    });
  });
});
