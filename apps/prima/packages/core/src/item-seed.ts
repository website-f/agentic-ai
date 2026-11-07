// Synthetic sample data for the one item register (Fauzan, 6 Nov 2026). No real people, items, prices or SQL codes.
// Shows Fitri's paper scenarios: a Goodwill sale to Sasa partly received (8 good, 1 damaged, 1 missing), a radio
// rental to a site, uniform handed to a guard waiting for confirmation, office furniture, IT devices linked to the IT
// register, cleaning stock counted by quantity and an unverified opening balance.

import { sha256Hex } from './audit';
import { addDays, addMinutes, dateOf } from './time';
import { GOODWILL_PARTY_ID, sampleLabelToken, syncKey, payloadHash, runningRef, type Custody, type ItemEvent, type ItemSku, type PhysicalItem } from './items';
import type { Dataset, IsoDate, IsoDateTime } from './types';

export function seedItems(ds: Dataset, today: IsoDate, now: IsoDateTime): void {
  const at = (hoursAgo: number) => addMinutes(now, -hoursAgo * 60);
  const sku = (id: string, code: string, name: string, category: ItemSku['category'], tracking: ItemSku['tracking'], uom: ItemSku['uom'], size: string | null, extra: Partial<ItemSku> = {}): ItemSku => {
    const row: ItemSku = { id, code, name, category, tracking, uom, size, colour: null, consumable: false, components: [], supplierBarcodes: [], sqlCodes: [], createdBy: 'Storekeeper 1 (mock)', createdAt: at(400), version: 1, partyIds: ['*'], ...extra };
    ds.itemSkus.push(row);
    return row;
  };
  const shirtL = sku('sku-shirt-l', 'SHIRT-NAVY-L', 'Guard shirt, navy, size L', 'uniform', 'SERIALIZED', 'PCS', 'L', {
    colour: 'Navy',
    sqlCodes: [{ partyId: GOODWILL_PARTY_ID, itemCode: '000SHIRTL', uom: 'PCS', by: 'Finance team 1 lead (mock)', at: at(300) }],
  });
  const trouser = sku('sku-trouser-32', 'TROUSER-NAVY-32', 'Guard trousers, navy, waist 32', 'uniform', 'SERIALIZED', 'PCS', '32', { colour: 'Navy' });
  sku('sku-uniset-l', 'UNIFORM-SET-L', 'Uniform set: shirt L + trousers 32', 'uniform', 'KIT', 'SET', 'L', { components: [{ skuId: shirtL.id, qty: 1 }, { skuId: trouser.id, qty: 1 }] });
  const boots = sku('sku-boots-8', 'BOOTS-SAFETY-8', 'Safety boots, size 8 (one pair)', 'footwear', 'SERIALIZED', 'PAIR', '8');
  const vest = sku('sku-vest-l', 'VEST-REFLECT-L', 'Reflective vest, size L', 'vest', 'SERIALIZED', 'PCS', 'L');
  const torch = sku('sku-torch', 'TORCH-LED', 'LED torchlight', 'torchlight', 'SERIALIZED', 'PCS', null);
  const radio = sku('sku-radio', 'RADIO-WT-UHF', 'Walkie-talkie, UHF', 'radio', 'SERIALIZED', 'PCS', null);
  const laptop = sku('sku-laptop', 'LAPTOP-14', 'Laptop 14 inch (IT)', 'it_device', 'SERIALIZED', 'PCS', null);
  const chair = sku('sku-chair', 'CHAIR-OFFICE', 'Office chair', 'furniture', 'SERIALIZED', 'PCS', null);
  const printer = sku('sku-printer', 'PRINTER-A4', 'A4 printer (office)', 'office', 'SERIALIZED', 'PCS', null);
  const cleaner = sku('sku-floor-5l', 'CLEAN-FLOOR-5L', 'Floor cleaner, 5 litre bottle', 'cleaning', 'BULK', 'BOTTLE', null, { consumable: true });

  const party = (id: string) => (id === GOODWILL_PARTY_ID ? 'Goodwill Empire Sdn Bhd' : id === 'pwvsb' ? 'PWVSB (central)' : id === 'merdeka' ? 'Merdeka Network Sdn Bhd (IT)' : (ds.companies.find((c) => c.id === id)?.name ?? id));
  const storeOf = (p: string, since: IsoDateTime): Custody => ({ kind: 'store', partyId: p, ref: `store:${p}`, label: `${party(p)} store`, since });
  let n = 0;
  let e = 0;
  const ev = (x: Omit<ItemEvent, 'id' | 'by' | 'byId' | 'lotId' | 'qty' | 'ownerFrom' | 'ownerTo' | 'caseId'> & Partial<ItemEvent>) =>
    ds.itemEvents.push({ id: `iev-s${++e}`, by: 'Storekeeper 1 (mock)', byId: 'u-proc-store1', lotId: null, qty: 1, ownerFrom: null, ownerTo: null, caseId: null, ...x });
  const unit = (s: ItemSku, owner: string, hoursAgo: number, patch: Partial<PhysicalItem> = {}): PhysicalItem => {
    n += 1;
    const id = `itm-s${n}`;
    const since = at(hoursAgo);
    const row: PhysicalItem = {
      id,
      token: sampleLabelToken(id),
      skuId: s.id,
      serial: null,
      ownerPartyId: owner,
      custody: storeOf(owner, since),
      state: 'available',
      condition: 'new',
      version: 2,
      labelPrints: 1,
      registeredBy: 'Storekeeper 1 (mock)',
      registeredAt: since,
      legacyUnverified: false,
      replacesId: null,
      replacedById: null,
      itAssetId: null,
      kitId: null,
      componentIds: [],
      pendingAck: null,
      reservedFor: null,
      dueBack: null,
      writeOff: null,
      retiredAt: null,
      rfidTag: null,
      historyPartyIds: [],
      partyIds: [owner],
      ...patch,
    };
    ds.physicalItems.push(row);
    ev({ at: since, kind: 'register', itemId: id, from: null, to: storeOf(owner, since), ownerTo: owner, movementId: null, note: row.legacyUnverified ? 'Opening balance, not yet verified' : 'Registered and label printed', partyIds: [owner] });
    if (row.state !== 'quarantine' && !row.legacyUnverified) ev({ at: addMinutes(since, 30), kind: 'inspect', itemId: id, from: null, to: null, movementId: null, note: 'new', partyIds: [owner] });
    return row;
  };

  // Goodwill store.
  const gw = GOODWILL_PARTY_ID;
  for (let k = 0; k < 6; k++) unit(shirtL, gw, 300);
  for (let k = 0; k < 6; k++) unit(trouser, gw, 300);
  for (let k = 0; k < 6; k++) unit(boots, gw, 280);
  for (let k = 0; k < 4; k++) unit(radio, gw, 260, { serial: `UHF-MOCK-${1001 + k}` });
  for (let k = 0; k < 5; k++) unit(vest, gw, 3, { state: 'quarantine', condition: 'unknown', version: 1 });

  const sasa = 'co-sasa';
  const site = ds.sites.find((s) => s.companyId === sasa)!;
  // A guard rostered at this post with an enrolled face, so the post's shared device can show the face-checked confirm.
  const rostered = new Set(ds.shifts.filter((x) => x.siteId === site.id && x.personId).map((x) => x.personId!));
  const signIn = ds.users.find((u) => u.id === 'u-guard-sasa-1')?.personId;
  const guard =
    ds.people.find((p) => p.id === signIn && p.faceEnrolledOn && p.status === 'active') ??
    ds.people.find((p) => rostered.has(p.id) && p.role === 'guard' && p.status === 'active' && p.faceEnrolledOn) ??
    ds.people.find((p) => p.id === 'pr-sasa-0212') ??
    ds.people.find((p) => p.companyId === sasa && p.status === 'active')!;

  // MV-0001: sale of 10 shirts, Goodwill to Sasa store. 8 received, 1 damaged, 1 missing. Ownership not yet recorded by Finance.
  const m1 = 'imv-s1';
  const sold = Array.from({ length: 10 }, () => unit(shirtL, gw, 200));
  const sentAt = at(30);
  const recAt = at(6);
  const transit: Custody = { kind: 'transit', partyId: gw, ref: m1, label: 'In transit MV-0001 with Goodwill van (mock)', since: sentAt };
  const sasaStore = storeOf(sasa, recAt);
  const results = sold.map((_, k) => (k < 8 ? 'received' : k === 8 ? 'damaged' : 'missing') as 'received' | 'damaged' | 'missing');
  sold.forEach((u, k) => {
    ev({ at: at(32), kind: 'reserve', itemId: u.id, from: null, to: null, movementId: m1, note: 'Picked for MV-0001', partyIds: [gw, sasa] });
    ev({ at: sentAt, kind: 'dispatch', itemId: u.id, from: u.custody, to: transit, movementId: m1, note: 'Sent on MV-0001 (sale)', partyIds: [gw, sasa] });
    const r = results[k];
    if (r === 'received') {
      Object.assign(u, { custody: sasaStore, state: 'available', partyIds: [gw, sasa], version: 5 });
      ev({ at: recAt, by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', kind: 'receive', itemId: u.id, from: transit, to: sasaStore, movementId: m1, note: 'Received on MV-0001', partyIds: [gw, sasa] });
    } else if (r === 'damaged') {
      Object.assign(u, { custody: { ...sasaStore, label: `${party(sasa)} store (quarantine)` }, state: 'quarantine', condition: 'damaged', partyIds: [gw, sasa], version: 5 });
      ev({ at: recAt, by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', kind: 'receive_damaged', itemId: u.id, from: transit, to: u.custody, movementId: m1, note: 'Seam torn on the sleeve', partyIds: [gw, sasa] });
    } else {
      Object.assign(u, { custody: transit, state: 'in_transit', partyIds: [gw, sasa], version: 4 });
      ev({ at: recAt, by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', kind: 'receive_missing', itemId: u.id, from: null, to: null, movementId: m1, note: 'Not in the box', partyIds: [gw, sasa] });
    }
  });
  ds.itemMovements.push({
    id: m1,
    ref: runningRef('MV', 1),
    type: 'sale',
    fromPartyId: gw,
    toPartyId: sasa,
    to: { kind: 'store', ref: `store:${sasa}`, label: `${party(sasa)} store` },
    commercialRef: runningRef('CT', 1),
    originalMovementId: null,
    purpose: 'Sasa request: new guard shirts for Klang sites (mock)',
    dueBackOn: null,
    status: 'partly_received',
    lines: sold.map((u, k) => ({ itemId: u.id, result: results[k], by: 'Sasa company manager (mock)', at: recAt, note: results[k] === 'damaged' ? 'Seam torn on the sleeve' : results[k] === 'missing' ? 'Not in the box' : '' })),
    lotLines: [],
    createdBy: 'Storekeeper 1 (mock)',
    createdById: 'u-proc-store1',
    createdAt: at(33),
    dispatched: { by: 'Storekeeper 1 (mock)', byId: 'u-proc-store1', at: sentAt, carrier: 'Goodwill van (mock)' },
    receipts: [{ by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', at: recAt, lines: 10 }],
    ownership: null,
    version: 4,
    partyIds: [gw, sasa],
  });
  const caseRow = (k: number, kind: 'damaged' | 'short', itemId: string, partyId: string, note: string) =>
    ds.itemCases.push({ id: `icase-s${k}`, ref: runningRef('IC', k), kind, itemId, lotId: null, movementId: m1, partyId, note, openedBy: 'Sasa company manager (mock)', openedById: 'u-cm-sasa', at: recAt, status: 'open', resolution: null, partyIds: [gw, sasa] });
  caseRow(1, 'damaged', sold[8].id, sasa, 'MV-0001: Seam torn on the sleeve');
  caseRow(2, 'short', sold[9].id, gw, 'MV-0001: one shirt did not arrive. Not in the box');
  const job = (k: number, partyId: string, docType: 'sales_delivery' | 'purchase_receipt' | 'rental_out' | 'rental_in', sourceId: string, qty: number, skuId: string, itemCode: string | null, when: IsoDateTime, commercialRef: string) => {
    const payload = { commercialRef, lines: [{ skuId, itemCode, uom: 'PCS' as const, qty }] };
    const reasons = ['SQL Account is not connected for this company (paper section 5).', `Legal entity and SQL book for ${party(partyId)} not confirmed (D01).`];
    if (!itemCode) reasons.push('Some item types have no SQL item code for this book yet (Finance to map).');
    ds.itemSyncJobs.push({ id: `isync-s${k}`, partyId, docType, sourceId, revision: 1, key: syncKey(partyId, docType, sourceId, 1), payloadHash: payloadHash(payload), payload, status: 'not_ready', reasons, at: when, partyIds: [partyId] });
  };
  job(1, gw, 'sales_delivery', m1, 10, shirtL.id, '000SHIRTL', sentAt, 'CT-0001');
  job(2, sasa, 'purchase_receipt', m1, 8, shirtL.id, null, recAt, 'CT-0001');

  // MV-0001 sale papers so far: Goodwill's invoice is attached (synthetic PDF). The payment slip and Sasa's signed
  // letter of acknowledgement are still missing, so ownership cannot pass yet (Fauzan, 6 Nov 2026).
  {
    const data = `data:application/pdf;base64,${btoa('%PDF-1.4 synthetic invoice for MV-0001 (mock)')}`;
    const sha256 = sha256Hex(data);
    ds.itemDocs.push({ id: `idoc-${sha256.slice(0, 20)}`, movementId: m1, kind: 'invoice', name: 'INV-MOCK-0001.pdf', mime: 'application/pdf', bytes: Math.floor(((data.length - data.indexOf(',') - 1) * 3) / 4), sha256, data, uploadedBy: 'Finance (mock)', at: at(5), partyIds: [gw, sasa] });
    const mv = ds.itemMovements.find((x) => x.id === m1)!;
    mv.papers = [{ kind: 'invoice', ref: 'INV-MOCK-0001', date: dateOf(at(5)), docId: `idoc-${sha256.slice(0, 20)}`, letter: null, partyId: gw, reason: '', by: 'Finance (mock)', byId: 'u-fd', at: at(5) }];
  }

  // Two received shirts handed on: one to a guard (waiting for the guard to confirm), one placed at a site.
  const g = sold[0];
  const gAt = at(2);
  const toGuard: Custody = { kind: 'person', partyId: sasa, ref: guard.id, label: guard.name, since: gAt };
  ev({ at: gAt, by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', kind: 'issue', itemId: g.id, from: g.custody, to: toGuard, movementId: null, note: 'Waiting for the person to confirm in their own sign-in', partyIds: g.partyIds });
  Object.assign(g, { custody: toGuard, state: 'with_person', pendingAck: { personId: guard.id, since: gAt }, version: 6 });
  const s1 = sold[1];
  const toSite: Custody = { kind: 'site', partyId: sasa, ref: site.id, label: site.name, since: gAt };
  ev({ at: gAt, by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', kind: 'issue', itemId: s1.id, from: s1.custody, to: toSite, movementId: null, note: `Placed at ${site.name}`, partyIds: s1.partyIds });
  Object.assign(s1, { custody: toSite, state: 'at_site', version: 6 });

  // MV-0002: rental of 2 radios, Goodwill to a Sasa site; ownership stays with Goodwill; due back in 60 days.
  const m2 = 'imv-s2';
  const radios = ds.physicalItems.filter((i) => i.skuId === radio.id).slice(0, 2);
  const due = addDays(today, 60);
  const r2Sent = at(50);
  const r2Rec = at(44);
  const siteC: Custody = { kind: 'site', partyId: sasa, ref: site.id, label: site.name, since: r2Rec };
  for (const r of radios) {
    const tr: Custody = { kind: 'transit', partyId: gw, ref: m2, label: 'In transit MV-0002 with Goodwill van (mock)', since: r2Sent };
    ev({ at: r2Sent, kind: 'dispatch', itemId: r.id, from: r.custody, to: tr, movementId: m2, note: 'Sent on MV-0002 (rental)', partyIds: [gw, sasa] });
    ev({ at: r2Rec, by: 'Sasa site supervisor (mock)', byId: 'u-sv-sasa', kind: 'receive', itemId: r.id, from: tr, to: siteC, movementId: m2, note: 'Received at site', partyIds: [gw, sasa] });
    Object.assign(r, { custody: siteC, state: 'at_site', dueBack: { on: due, movementId: m2 }, partyIds: [gw, sasa], version: 5 });
  }
  ds.itemMovements.push({
    id: m2,
    ref: runningRef('MV', 2),
    type: 'rental',
    fromPartyId: gw,
    toPartyId: sasa,
    to: { kind: 'site', ref: site.id, label: site.name },
    commercialRef: runningRef('CT', 2),
    originalMovementId: null,
    purpose: 'Radio rental for the site contract (mock)',
    dueBackOn: due,
    status: 'received',
    lines: radios.map((r) => ({ itemId: r.id, result: 'received' as const, by: 'Sasa site supervisor (mock)', at: r2Rec, note: '' })),
    lotLines: [],
    createdBy: 'Storekeeper 1 (mock)',
    createdById: 'u-proc-store1',
    createdAt: at(52),
    dispatched: { by: 'Storekeeper 1 (mock)', byId: 'u-proc-store1', at: r2Sent, carrier: 'Goodwill van (mock)' },
    receipts: [{ by: 'Sasa site supervisor (mock)', byId: 'u-sv-sasa', at: r2Rec, lines: 2 }],
    ownership: null,
    version: 4,
    partyIds: [gw, sasa],
  });
  job(3, gw, 'rental_out', m2, 2, radio.id, null, r2Sent, 'CT-0002');
  job(4, sasa, 'rental_in', m2, 2, radio.id, null, r2Rec, 'CT-0002');

  // Head office furniture and printers (PWVSB), IT laptops linked to the IT register (Merdeka Network).
  for (let k = 0; k < 6; k++) unit(chair, 'pwvsb', 900);
  for (let k = 0; k < 2; k++) unit(printer, 'pwvsb', 900, { serial: `PRN-MOCK-${k + 1}` });
  const laptops = ds.itAssets.filter((x) => x.kind === 'LAPTOP').slice(0, 2).map((a) => unit(laptop, 'merdeka', 1200, { serial: a.serial, itAssetId: a.id, condition: 'good' }));

  // Optional RFID tags (mock EPC codes): the two rented radios carry one; the printed label stays the identity.
  radios.forEach((r, k) => Object.assign(r, { rfidTag: `E2801160600002${(0x0a1b2c3d + k).toString(16).toUpperCase().padStart(8, '0')}00` }));

  // MV-0003: an IT laptop rented by Merdeka Network to Sasa, sent and waiting for Sasa to check it in. The
  // receiving company verifies what arrived (Fauzan, 6 Nov 2026), the same as for every other item.
  if (laptops[1]) {
    const lp = laptops[1];
    const m3 = 'imv-s3';
    const sent3 = at(3);
    const tr3: Custody = { kind: 'transit', partyId: 'merdeka', ref: m3, label: 'In transit MV-0003 by IT courier (mock)', since: sent3 };
    ev({ at: at(4), by: 'IT Lead (mock)', byId: 'u-it-lead', kind: 'reserve', itemId: lp.id, from: null, to: null, movementId: m3, note: 'Picked for MV-0003', partyIds: ['merdeka', sasa] });
    ev({ at: sent3, by: 'IT Lead (mock)', byId: 'u-it-lead', kind: 'dispatch', itemId: lp.id, from: lp.custody, to: tr3, movementId: m3, note: 'Sent on MV-0003 (rental)', partyIds: ['merdeka', sasa] });
    Object.assign(lp, { custody: tr3, state: 'in_transit', partyIds: ['merdeka', sasa], version: 4 });
    ds.itemMovements.push({
      id: m3,
      ref: runningRef('MV', 3),
      type: 'rental',
      fromPartyId: 'merdeka',
      toPartyId: sasa,
      to: { kind: 'store', ref: `store:${sasa}`, label: `${party(sasa)} store` },
      commercialRef: null,
      originalMovementId: null,
      purpose: 'Laptop for the Sasa admin office (mock); rental rate not set',
      dueBackOn: addDays(today, 365),
      status: 'dispatched',
      lines: [{ itemId: lp.id, result: 'pending' as const, by: null, at: null, note: '' }],
      lotLines: [],
      createdBy: 'IT Lead (mock)',
      createdById: 'u-it-lead',
      createdAt: at(5),
      dispatched: { by: 'IT Lead (mock)', byId: 'u-it-lead', at: sent3, carrier: 'IT courier (mock)' },
      receipts: [],
      ownership: null,
      version: 3,
      partyIds: ['merdeka', sasa],
    });
  }

  // Arrow Shield: torchlights from the old list, counted but not yet verified (opening balance).
  for (let k = 0; k < 4; k++) unit(torch, 'co-arsh', 100, { legacyUnverified: true, condition: 'unknown' });

  // Sasa cleaning stock counted by quantity; 5 bottles used at the site.
  ds.itemLots.push({ id: 'lot-s1', skuId: cleaner.id, ownerPartyId: sasa, custody: storeOf(sasa, at(120)), qty: 35, version: 3, partyIds: [sasa] });
  ev({ at: at(120), by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', kind: 'lot_add', itemId: null, lotId: 'lot-s1', qty: 40, from: null, to: storeOf(sasa, at(120)), ownerTo: sasa, movementId: null, note: 'Delivery note DN-MOCK-77', partyIds: [sasa] });
  ev({ at: at(20), by: 'Sasa company manager (mock)', byId: 'u-cm-sasa', kind: 'lot_issue', itemId: null, lotId: 'lot-s1', qty: 5, from: storeOf(sasa, at(120)), to: { ...toSite, since: at(20) }, movementId: null, note: 'Used up, not expected back.', partyIds: [sasa] });
}

