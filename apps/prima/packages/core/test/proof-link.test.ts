import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, PROOF_LINK_MIME, PROOF_LINK_REASONS, addDays, generateDataset, myt, parseSharePointProofLink } from '../src';

// SharePoint files as proof, by link (Fauzan, 4 Nov 2026, staff usability rule 6: "SharePoint files by link, no
// copies"). Synthetic hosts and paths only; nothing here contacts Microsoft.
const H = 'https://example.sharepoint.com';
const ok = (raw: string, hosts: string[] = []) => {
  const r = parseSharePointProofLink(raw, hosts);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.link;
};
const reason = (raw: unknown, hosts: string[] = []) => {
  const r = parseSharePointProofLink(raw, hosts);
  return r.ok ? null : r.reason;
};

describe('SharePoint proof links: parse and clean only', () => {
  it('keeps a direct file path, cleaned, without tracking values', () => {
    const l = ok(`${H}/sites/ITDept/Shared%20Documents/Jobs/Laptop%20labels.pdf?csf=1&web=1&e=AbC123#page=2`);
    expect(l).toEqual({ url: `${H}/sites/ITDept/Shared%20Documents/Jobs/Laptop%20labels.pdf`, host: 'example.sharepoint.com', name: 'Laptop labels.pdf' });
    expect(ok(`${H}/teams/Finance/Documents/Pack.xlsx`).name).toBe('Pack.xlsx');
  });

  it('turns a "People with existing access" link into the real path, and refuses token sharing links', () => {
    expect(ok(`${H}/:b:/r/sites/ITDept/Shared%20Documents/Slip.pdf?csf=1&web=1&e=x1`).url).toBe(`${H}/sites/ITDept/Shared%20Documents/Slip.pdf`);
    for (const t of ['s', 'g', 't', 'u']) expect(reason(`${H}/:w:/${t}/ITDept/EaBcDeFgHiJk?e=Q1w2E3`)).toBe(PROOF_LINK_REASONS.sharing);
    expect(reason(`${H}/:x:/ITDept/Ea1`)).toBe(PROOF_LINK_REASONS.sharing);
  });

  it('keeps the Office viewer form by its document id only', () => {
    const l = ok(`${H}/sites/HR/_layouts/15/Doc.aspx?sourcedoc=%7BA1B2C3D4-0000-4000-8000-0000000000AA%7D&file=Offer%20letter.docx&action=default&mobileredirect=true`);
    expect(l.url).toBe(`${H}/sites/HR/_layouts/15/Doc.aspx?sourcedoc=%7Ba1b2c3d4-0000-4000-8000-0000000000aa%7D`);
    expect(l.name).toBe('Offer letter.docx');
    expect(reason(`${H}/sites/HR/_layouts/15/Doc.aspx?sourcedoc=not-a-guid`)).toBe(PROOF_LINK_REASONS.page);
  });

  it('refuses personal OneDrive, other hosts, folders, pages, API paths and odd links', () => {
    expect(reason('https://example-my.sharepoint.com/personal/staff_example_com/Documents/a.pdf')).toBe(PROOF_LINK_REASONS.personal);
    expect(reason(`${H}/sites/IT/Shared%20Documents/a.pdf`, ['other.sharepoint.com'])).toBe(PROOF_LINK_REASONS.host);
    expect(ok(`${H}/sites/IT/Shared%20Documents/a.pdf`, ['EXAMPLE.sharepoint.com']).host).toBe('example.sharepoint.com');
    for (const raw of [
      'http://example.sharepoint.com/sites/IT/Shared%20Documents/a.pdf',
      'https://example.sharepoint.com.evil.test/sites/IT/Shared%20Documents/a.pdf',
      'https://evil.test/sites/IT/a.pdf',
      'https://user:pw@example.sharepoint.com/sites/IT/Shared%20Documents/a.pdf',
      'https://example.sharepoint.com:8443/sites/IT/Shared%20Documents/a.pdf',
      'javascript:alert(1)',
      `${H}/Shared%20Documents/a.pdf`,
      `${H}/sites/IT/Shared%20Documents/../../x/a.pdf`,
      `${H}/sites/IT/Shared%20Documents/a.pdf extra`,
      12,
      null,
    ])
      expect(reason(raw)).toBe(PROOF_LINK_REASONS.format);
    expect(reason(`${H}/sites/IT/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FIT%2FShared%20Documents%2FJobs`)).toBe(PROOF_LINK_REASONS.folder);
    expect(reason(`${H}/sites/IT/Shared%20Documents/Jobs`)).toBe(PROOF_LINK_REASONS.folder);
    expect(reason(`${H}/sites/IT/a.pdf`)).toBe(PROOF_LINK_REASONS.folder);
    expect(reason(`${H}/sites/IT/SitePages/Home.aspx`)).toBe(PROOF_LINK_REASONS.page);
    expect(reason(`${H}/sites/IT/_api/web/lists`)).toBe(PROOF_LINK_REASONS.page);
    expect(reason(`${H}/sites/IT/_layouts/15/settings.aspx`)).toBe(PROOF_LINK_REASONS.page);
  });
});

const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const link = (n: string) => ({ kind: 'link' as const, url: `${H}/sites/ITDept/Shared%20Documents/UAT/${encodeURIComponent(n)}.pdf?web=1` });

describe('SharePoint proof links on IT jobs', () => {
  it('records the link, never a copy; the board hides it; opening it is logged', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const ex = await svc.user('u-it-ex1');
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT label 10 laptops', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: addDays(TODAY, 2) });
    await svc.itJobStep(ex, j.id, 'submit', 'Labels photo kept in the IT SharePoint', [link('Labels 1')]);
    const stored = ds.itJobs.find((x) => x.id === j.id)!.proof[0];
    expect(stored).toMatchObject({ name: 'Labels 1.pdf', mime: PROOF_LINK_MIME, bytes: 0, data: '', link: `${H}/sites/ITDept/Shared%20Documents/UAT/Labels%201.pdf` });

    const row = ((await svc.itBoard(mgr)).jobs as { job: { id: string; proof: { link?: string; mime: string }[] } }[]).find((r) => r.job.id === j.id)!;
    expect(row.job.proof[0].mime).toBe(PROOF_LINK_MIME);
    expect(row.job.proof[0].link).toBeUndefined();

    const opened = await svc.itJobProof(mgr, j.id, stored.sha256);
    expect(opened.link).toBe(stored.link);
    expect(ds.audit.some((a) => a.action === 'file.open' && a.entityId === j.id && /SharePoint link "Labels 1.pdf"/.test(a.summary))).toBe(true);
    // Someone outside the job's people still gets nothing.
    await expect(svc.itJobProof(await svc.user('u-it-ex2'), j.id, stored.sha256)).rejects.toThrow(/Proof/);
  });

  it('refuses a bad link on the direct action call, and the same link twice', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const ex = await svc.user('u-it-ex1');
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT a', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: addDays(TODAY, 2) });
    await expect(svc.itAct(ex, 'jobStep', { id: j.id, step: 'submit', note: 'Done in SharePoint', proof: [{ kind: 'link', url: 'https://example-my.sharepoint.com/personal/x/Documents/a.pdf' }] })).rejects.toThrow(/personal OneDrive/);
    await expect(svc.itAct(ex, 'jobStep', { id: j.id, step: 'submit', note: 'Done in SharePoint', proof: [{ kind: 'link', url: `${H}/:b:/s/ITDept/EaToken?e=1` }] })).rejects.toThrow(/sharing link/);
    await svc.itJobStep(ex, j.id, 'submit', 'Done in SharePoint', [link('Same')]);
    await svc.itJobStep(mgr, j.id, 'return', 'Labels are not readable');
    // The same link again (even pasted with other tracking values) is not new proof.
    await expect(svc.itJobStep(ex, j.id, 'submit', 'Done again, new labels', [{ kind: 'link', url: `${H}/:b:/r/sites/ITDept/Shared%20Documents/UAT/Same.pdf?csf=1&e=zz` }])).rejects.toThrow(/already given as proof/);
    await svc.itJobStep(ex, j.id, 'submit', 'Done again, new labels', [link('Same v2')]);
  });

  it('narrows to the group SharePoint host once IT sets it', async () => {
    const { svc } = fresh();
    svc.proofLinkHosts = ['group.sharepoint.com'];
    const mgr = await svc.user('u-it-mgr');
    const ex = await svc.user('u-it-ex1');
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT c', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: addDays(TODAY, 2) });
    await expect(svc.itJobStep(ex, j.id, 'submit', 'Done in SharePoint', [link('Elsewhere')])).rejects.toThrow(/not in the group SharePoint/);
    await svc.itJobStep(ex, j.id, 'submit', 'Done in SharePoint', [{ kind: 'link', url: 'https://group.sharepoint.com/sites/IT/Shared%20Documents/ok.pdf' }]);
  });
});

describe('SharePoint proof links on cases', () => {
  it('a case step takes a link as its proof and lists it with the case documents', async () => {
    const { svc } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const c = await svc.raiseCase(dev, { companyId: 'co-sasa', siteId: dev.siteIds[0], type: 'SOS', severity: 'P1', title: 'SOS pressed', description: 'Test' });
    const officer = await svc.user('u-sv-sasa');
    await svc.signOffCase(officer, c.id, 'resolved', 'Police report kept in the company SharePoint.', [
      { kind: 'link', url: `${H}/sites/SasaOps/Shared%20Documents/Cases/Police%20report.pdf` },
    ]);
    const docs = (await svc.caseDetail(officer, c.id)).docs as { name: string; link?: string; data: string; mime: string }[];
    const d = docs.find((x) => x.name === 'Police report.pdf')!;
    expect(d).toMatchObject({ mime: PROOF_LINK_MIME, data: '', link: `${H}/sites/SasaOps/Shared%20Documents/Cases/Police%20report.pdf` });
  });
});

describe('SharePoint proof links: more places', () => {
  it('refuses an encoded slash that would point at another folder once cleaned', () => {
    expect(reason(`${H}/sites/IT/Shared%20Documents/a%2Fb.pdf`)).toBe(PROOF_LINK_REASONS.format);
    expect(reason(`${H}/sites/IT/Shared%20Documents/a%5Cb.pdf`)).toBe(PROOF_LINK_REASONS.format);
    expect(ok(`${H}/sites/IT/Shared%20Documents/Laporan%20%231%20(Nov).pdf`).name).toBe('Laporan #1 (Nov).pdf');
  });

  it('a case with no site is raised with a link, the way a document is', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const c = await svc.raiseCase(cm, {
      companyId: 'co-sasa',
      siteId: null,
      type: 'COMPLAINT',
      severity: 'P3',
      title: 'Office complaint',
      description: '',
      proof: [{ kind: 'link', url: `${H}/sites/SasaAdmin/Shared%20Documents/Complaint%20letter.pdf` }],
    } as Parameters<PrimaService['raiseCase']>[1]);
    const docs = (await svc.caseDetail(cm, c.id)).docs as { name: string; link?: string }[];
    expect(docs.map((d) => d.name)).toContain('Complaint letter.pdf');
  });

  it('a company report and a department report can each be sent as a link', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const open = (await svc.reports(cm)).mine.flatMap((m) => m.periods.map((p) => ({ m, p }))).find((x) => !x.p.sent)!;
    const sent = await svc.submitReport(cm, { defId: open.m.def.id, period: open.p.period, companyId: 'co-sasa', note: 'Week done', proof: [{ kind: 'link', url: `${H}/sites/SasaAdmin/Shared%20Documents/Weekly.pdf` }] });
    expect(sent.docIds).toHaveLength(1);
    expect(ds.evidenceDocs.find((d) => d.id === sent.docIds[0])).toMatchObject({ link: `${H}/sites/SasaAdmin/Shared%20Documents/Weekly.pdf`, data: '' });

    const hr = await svc.user('u-pwvsb-hr');
    const dep = (await svc.reports(hr)).mine.flatMap((m) => m.periods.map((p) => ({ m, p }))).find((x) => !x.p.sent)!;
    // A personal OneDrive link is refused here too, before the real link is sent.
    await expect(
      svc.submitReport(hr, { defId: dep.m.def.id, period: dep.p.period, companyId: null, note: '', proof: [{ kind: 'link', url: 'https://example-my.sharepoint.com/personal/x/Documents/a.pdf' }] }),
    ).rejects.toThrow(/personal OneDrive/);
    await svc.submitReport(hr, { defId: dep.m.def.id, period: dep.p.period, companyId: null, note: '', proof: [{ kind: 'link', url: `${H}/sites/HR/Shared%20Documents/Monthly.xlsx` }] });
    const row = ds.reportSubmissions.find((r) => r.defId === dep.m.def.id && r.period === dep.p.period)!;
    expect(row.file).toEqual({ name: 'Monthly.xlsx', data: '', link: `${H}/sites/HR/Shared%20Documents/Monthly.xlsx` });
  });
});
