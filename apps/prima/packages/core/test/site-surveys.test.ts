import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, guardsPerDay, myt, sha256Hex, surveyContentSha, readSurveyContent } from '../src';

// Offline site survey form (Fauzan, 4 Nov 2026): made on the phone with no signal, sent later, photos one by one,
// decided by the Project Director. Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '15:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const img = (tag: string) => `data:image/jpeg;base64,${Buffer.from(`synthetic jpeg ${tag}`).toString('base64')}`;
let seq = 0;
const newId = () => `svy-${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

function survey(over: Record<string, unknown> = {}, images = [img('a'), img('b')]) {
  return {
    id: newId(),
    companyId: 'co-sasa',
    leadId: null,
    siteId: null,
    place: 'Gudang Sintetik Pasir Gudang (mock)',
    address: 'Jalan Ujian 1, Pasir Gudang',
    startedAt: myt(TODAY, '09:00'),
    finishedAt: myt(TODAY, '10:10'),
    lat: 1.47,
    lng: 103.9,
    accuracyM: 12,
    details: { siteType: 'warehouse', operatingHours: '24 hours', perimeterM: 820, areaM2: 15000, floors: 1, entrances: 3, vehicleGates: 2, cctvCameras: 6, lighting: 'poor', fence: 'partial', alarm: false, guardhouse: true },
    measures: [{ label: 'Loading bay width', value: 24, unit: 'm' }],
    risks: ['theft', 'dark_areas', 'not-a-risk'],
    riskNote: 'Back fence broken near the river',
    posts: [
      { name: 'Main gate', coverHours: 24, shiftHours: 12, guardsPerShift: 2, armed: false },
      { name: 'Loading bay', coverHours: 12, shiftHours: 12, guardsPerShift: 1, armed: false },
    ],
    findings: 'Poor lighting at the back; two gates need guards round the clock.',
    photos: images.map((i, k) => ({ sha256: sha256Hex(i), bytes: 40, caption: `Photo ${k + 1}`, capturedAt: myt(TODAY, '09:30'), lat: 1.47, lng: 103.9, accuracyM: 10 })),
    ...over,
  };
}

describe('offline site survey', () => {
  it('works out guards a day from the posts', () => {
    expect(guardsPerDay([{ coverHours: 24, shiftHours: 12, guardsPerShift: 2 }, { coverHours: 12, shiftHours: 12, guardsPerShift: 1 }, { coverHours: 24, shiftHours: 8, guardsPerShift: 1 }])).toBe(8);
  });

  it('receives a survey sent later, takes photos one by one, then sends it to the Project Director', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const images = [img('a1'), img('a2')];
    const body = survey({}, images);
    const r = await svc.siteSurveys.receive(cm, body);
    expect(r.status).toBe('receiving_photos');
    expect(r.missing).toEqual([1, 2]);
    const s = ds.siteSurveys.find((x) => x.id === body.id)!;
    expect(s.surveyorName).toBe(cm.name);
    expect(s.time).toBe('sent_later');
    expect(s.guardsPerDay).toBe(5);
    expect(s.risks).toEqual(['theft', 'dark_areas']);
    expect(s.ref).toMatch(/^SV-/);

    // The phone lost the answer and sends the same survey again: nothing changes.
    expect((await svc.siteSurveys.receive(cm, body)).id).toBe(body.id);
    expect(ds.siteSurveys.filter((x) => x.id === body.id)).toHaveLength(1);
    // Different content under the same number is refused.
    await expect(svc.siteSurveys.receive(cm, { ...body, findings: 'Changed afterwards' })).rejects.toThrow(/different content/);

    // A picture other than the one listed is refused; the listed one is taken; a resend changes nothing.
    await expect(svc.siteSurveys.addPhoto(cm, body.id, { n: 1, image: img('swapped') })).rejects.toThrow(/not the picture/);
    expect((await svc.siteSurveys.addPhoto(cm, body.id, { n: 1, image: images[0] })).missing).toEqual([2]);
    expect((await svc.siteSurveys.addPhoto(cm, body.id, { n: 1, image: images[0] })).missing).toEqual([2]);
    expect(ds.siteSurveyPhotos.filter((p) => p.surveyId === body.id)).toHaveLength(1);
    // Nobody else sends the surveyor's photos.
    await expect(svc.siteSurveys.addPhoto(await svc.user('u-gm-sasa'), body.id, { n: 2, image: images[1] })).rejects.toThrow(/Only the person/);
    const done = await svc.siteSurveys.addPhoto(cm, body.id, { n: 2, image: images[1] });
    expect(done.status).toBe('submitted');
    expect(ds.audit.some((a) => a.action === 'survey.submit' && a.entityId === body.id)).toBe(true);

    const coo = await svc.user('u-coo');
    const board = await svc.siteSurveys.board(coo);
    expect(board.rows.find((x) => x.survey.id === body.id)?.canReview).toBe(true);
    expect((await svc.siteSurveys.detail(coo, body.id)).photos).toHaveLength(2);
  });

  it('takes the surveyor from the sign-in, never from the phone', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const body = survey({ surveyorId: 'u-coo', surveyorName: 'Someone else', receivedAt: myt(TODAY, '09:00'), status: 'accepted' });
    await svc.siteSurveys.receive(cm, body);
    const s = ds.siteSurveys.find((x) => x.id === body.id)!;
    expect(s.surveyorId).toBe('u-cm-sasa');
    expect(s.receivedAt).toBe(NOW);
    expect(s.status).toBe('receiving_photos');
  });

  it('refuses a company the surveyor cannot work for, site devices, guards and a lead from another company', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.siteSurveys.receive(cm, survey({ companyId: 'co-arsh' }))).rejects.toThrow(/Not allowed/);
    await expect(svc.siteSurveys.receive(await svc.user('u-dev-sasa-001'), survey())).rejects.toThrow(/Not allowed/);
    const arshLead = ds.salesLeads.find((l) => l.companyId === 'co-arsh')!;
    await expect(svc.siteSurveys.receive(cm, survey({ leadId: arshLead.id }))).rejects.toThrow(/not in this company/);
    // A CMS desk officer has no survey work.
    await expect(svc.siteSurveys.receive(await svc.user('u-cms-head'), survey())).rejects.toThrow(/Not allowed/);
    // The Arrow Shield manager does not see Sasa's surveys.
    const s = survey();
    await svc.siteSurveys.receive(cm, s);
    await expect(svc.siteSurveys.detail(await svc.user('u-cm-arsh'), s.id)).rejects.toThrow(/not found/i);
    expect((await svc.siteSurveys.board(await svc.user('u-cm-arsh'))).rows.some((r) => r.survey.id === s.id)).toBe(false);
  });

  it('checks the form: posts, photos, findings, ranges and repeated photos', () => {
    expect(() => readSurveyContent(survey({ posts: [] }))).toThrow(/at least one guard post/);
    expect(() => readSurveyContent(survey({}, []))).toThrow(/at least 1 photo/);
    expect(() => readSurveyContent(survey({ noPhotoReason: 'no' }, []))).toThrow(/at least 1 photo/);
    expect(() => readSurveyContent(survey({ findings: '' }))).toThrow(/what you found/);
    expect(() => readSurveyContent(survey({ id: 'svy-1' }))).toThrow(/valid number/);
    expect(() => readSurveyContent(survey({}, [img('x'), img('x')]))).toThrow(/same picture/);
    expect(() => readSurveyContent(survey({ details: { perimeterM: -5 } }))).toThrow(/Perimeter/);
    // A phone clock that jumped back is not refused (the surveyor cannot fix it); the server marks it instead.
    expect(() => readSurveyContent(survey({ finishedAt: myt(TODAY, '08:00') }))).not.toThrow();
    // Fingerprint is stable for the same content.
    const b = survey();
    const a1 = readSurveyContent(b);
    const a2 = readSurveyContent(JSON.parse(JSON.stringify(b)));
    expect(surveyContentSha(a1.id, a1.content)).toBe(surveyContentSha(a2.id, a2.content));
  });

  it('refuses a photo already used in another survey of the company', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const i = img('reused');
    const first = survey({}, [i]);
    await svc.siteSurveys.receive(cm, first);
    await svc.siteSurveys.addPhoto(cm, first.id, { n: 1, image: i });
    await expect(svc.siteSurveys.receive(cm, survey({}, [i]))).rejects.toThrow(/already sent with another survey/);
  });

  it('lets only another Project Director decide, with a reason, and fills the researched sales lead', async () => {
    const { svc, ds } = fresh();
    const lead = ds.salesLeads.find((l) => l.companyId === 'co-sasa' && l.stage === 'researched')!;
    const cm = await svc.user('u-cm-sasa');
    const images = [img('lead1')];
    const body = survey({ leadId: lead.id, place: '' }, images);
    await svc.siteSurveys.receive(cm, body);
    const coo = await svc.user('u-coo');
    // Photos not in yet: nothing to decide.
    await expect(svc.siteSurveys.review(coo, body.id, 'accepted', 'Looks right')).rejects.toThrow(/Photos are still coming/);
    await svc.siteSurveys.addPhoto(cm, body.id, { n: 1, image: images[0] });
    expect(ds.siteSurveys.find((x) => x.id === body.id)!.place).toBe(lead.prospect);

    // Not a Project Director: the company manager, the GM, the CEO view only.
    await expect(svc.siteSurveys.review(await svc.user('u-gm-sasa'), body.id, 'accepted', 'ok fine')).rejects.toThrow(/Project Director only/);
    await expect(svc.siteSurveys.review(coo, body.id, 'accepted', '')).rejects.toThrow(/short comment/);
    const done = await svc.siteSurveys.review(coo, body.id, 'accepted', 'Matches the client brief');
    expect(done.status).toBe('accepted');
    expect(done.review?.by).toBe(coo.name);
    const l = ds.salesLeads.find((x) => x.id === lead.id)!;
    expect(l.stage).toBe('surveyed');
    expect(l.survey?.guardsNeeded).toBe(5);
    expect(l.survey?.by).toBe(cm.name);
    expect(done.leadNote).toMatch(/Filled the survey step/);
    await expect(svc.siteSurveys.review(coo, body.id, 'returned', 'again')).rejects.toThrow(/already been decided/);
  });

  it('never lets a Project Director decide their own survey, and lets the surveyor redo a returned one', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const images = [img('own')];
    const body = survey({}, images);
    await svc.siteSurveys.receive(coo, body);
    await svc.siteSurveys.addPhoto(coo, body.id, { n: 1, image: images[0] });
    await expect(svc.siteSurveys.review(coo, body.id, 'accepted', 'Fine by me')).rejects.toThrow(/another Project Director/);
    expect((await svc.siteSurveys.board(coo)).rows.find((r) => r.survey.id === body.id)?.canReview).toBe(false);
    const opsdir = await svc.user('u-opsdir');
    const back = await svc.siteSurveys.review(opsdir, body.id, 'returned', 'Measure the back fence');
    expect(back.status).toBe('returned');
    expect((await svc.siteSurveys.detail(coo, body.id)).canRedo).toBe(true);
    const redo = survey({ redoOf: body.id }, [img('own2')]);
    expect((await svc.siteSurveys.receive(coo, redo)).status).toBe('receiving_photos');
    await expect(svc.siteSurveys.receive(coo, survey({ redoOf: redo.id }, [img('own3')]))).rejects.toThrow(/Only a returned survey/);
  });

  it('gives the phone only names for working offline', async () => {
    const { svc, ds } = fresh();
    const setup = await svc.siteSurveys.setup(await svc.user('u-cm-sasa'));
    expect(setup.companies.map((c) => c.id)).toEqual(['co-sasa']);
    expect(Object.keys(setup.companies[0].leads[0] ?? { id: 1, ref: 1, prospect: 1 }).sort()).toEqual(['id', 'prospect', 'ref']);
    expect((await svc.siteSurveys.setup(await svc.user('u-dev-sasa-001'))).companies).toEqual([]);
    // A site officer gets only their own sites, and cannot link a survey to another site of the company.
    const sv = await svc.user('u-sv-sasa');
    const mine = (await svc.siteSurveys.setup(sv)).companies[0].sites.map((x) => x.id).sort();
    expect(mine).toEqual([...sv.siteIds].sort());
    const other = ds.sites.find((x) => x.companyId === 'co-sasa' && !sv.siteIds.includes(x.id))!;
    await expect(svc.siteSurveys.receive(sv, survey({ siteId: other.id }))).rejects.toThrow(/not one you may survey/);
    expect((await svc.siteSurveys.receive(sv, survey({ siteId: sv.siteIds[0] }))).status).toBe('receiving_photos');
  });

  it('takes a survey without photos only with a reason, and sends it straight to the Project Director', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const body = survey({ noPhotoReason: 'Kawasan larangan: photography not allowed by the client' }, []);
    const r = await svc.siteSurveys.receive(cm, body);
    expect(r.status).toBe('submitted');
    expect(r.missing).toEqual([]);
    expect(ds.siteSurveys.find((x) => x.id === body.id)!.noPhotoReason).toMatch(/Kawasan larangan/);
    // A reason is ignored when photos were taken.
    const withPhoto = survey({ noPhotoReason: 'ignored reason' }, [img('np')]);
    await svc.siteSurveys.receive(cm, withPhoto);
    expect(ds.siteSurveys.find((x) => x.id === withPhoto.id)!.noPhotoReason).toBe('');
  });

  it('marks a phone clock that ran backwards instead of trapping the survey', async () => {
    const { svc, ds } = fresh();
    const body = survey({ startedAt: myt(TODAY, '10:00'), finishedAt: myt(TODAY, '09:00') });
    await svc.siteSurveys.receive(await svc.user('u-cm-sasa'), body);
    expect(ds.siteSurveys.find((x) => x.id === body.id)!.time).toBe('clock_wrong');
  });

  it('lets only the surveyor redo a returned survey, and only once', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const body = survey({ noPhotoReason: 'Client does not allow photos' }, []);
    await svc.siteSurveys.receive(cm, body);
    await svc.siteSurveys.review(await svc.user('u-coo'), body.id, 'returned', 'Count the gates again');
    await expect(svc.siteSurveys.receive(await svc.user('u-gm-sasa'), survey({ redoOf: body.id }, [img('r0')]))).rejects.toThrow(/Only the person who made/);
    await svc.siteSurveys.receive(cm, survey({ redoOf: body.id }, [img('r1')]));
    await expect(svc.siteSurveys.receive(cm, survey({ redoOf: body.id }, [img('r2')]))).rejects.toThrow(/already been redone/);
  });
});
