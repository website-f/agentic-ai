import type { AmBqSection } from "./types";


export interface BuildingLine {
  section: string;
  item: string;
  unit: string;
  qty: number;
  calc: string;
  optional?: boolean;
}

export interface BuildingDraft {
  title: string;
  sections: AmBqSection[];
  lines: BuildingLine[];
  notes: string[];
  contingencyPct: number;
}

type M = Record<string, number>;
const v = (x: M, k: string) => (Number.isFinite(x[k]) && x[k] > 0 ? x[k] : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const f = (n: number) => String(r1(n));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Default contingency, as in Fauzan's sample BQ (5%). The team can change it on each BQ (0 to 20%). */
export const AM_BQ_CONTINGENCY_DEFAULT = 5;
/** Sizes assumed when openings are deducted from wall areas; written into the notes so contractors see them. */
const DOOR_M2 = 0.9 * 2.1;
const WINDOW_M2 = 1.2 * 1.2;

/** Builds sections in order; a section with no lines is dropped and the letters close up (A, B, C ...). */
class Sheet {
  private parts: { title: string; lines: Omit<BuildingLine, 'section'>[] }[] = [];
  section(title: string) {
    const part = { title, lines: [] as Omit<BuildingLine, 'section'>[] };
    this.parts.push(part);
    const add = (item: string, unit: string, qty: number, calc = '', optional = false) => {
      const q = unit === 'LS' || unit === 'no' || unit === 'set' ? Math.ceil(qty) : r1(qty);
      if (q > 0) part.lines.push({ item, unit, qty: q, calc, optional: optional || undefined });
    };
    /** A lump-sum line, included only when the condition holds. */
    const ls = (cond: boolean, item: string, calc = '') => add(item, 'LS', cond ? 1 : 0, calc);
    return { add, ls };
  }
  build(): { sections: AmBqSection[]; lines: BuildingLine[] } {
    const used = this.parts.filter((p) => p.lines.length);
    const sections = used.map((p, i) => ({ code: String.fromCharCode(65 + i), title: p.title }));
    const lines = used.flatMap((p, i) => p.lines.map((l) => ({ ...l, section: sections[i].code })));
    return { sections, lines };
  }
}

interface RoofInput {
  length: number;
  width: number;
  pitch: number;
  eave: number;
}

/** A new gable roof: C-channel rafters and battens with insulated metal deck, measured on plan as in the sample. */
function roofLines(s: ReturnType<Sheet['section']>, r: RoofInput) {
  const { length: L, width: W, pitch: p, eave: e } = r;
  if (!(L > 0 && W > 0 && p > 0 && p < 60)) return;
  const pl = L + 2 * e;
  const pw = W + 2 * e;
  const plan = pl * pw;
  const cos = Math.cos(rad(p));
  const rise = (W / 2) * Math.tan(rad(p));
  const barge = (pw / 2) / cos;
  s.add(
    `Rasuk bumbung dan reng keluli C-channel bergalvani lengkap dipasang, kecerunan lebih kurang ${p}° (diukur ikut keluasan pelan)`,
    'm2',
    plan,
    `(${f(L)} + 2 x ${f(e)}) x (${f(W)} + 2 x ${f(e)})`,
  );
  s.add('Kepingan bumbung metal deck berpenebat (insulated metal deck) 0.48mm TCT berwarna', 'm2', plan / cos, `${f(plan)} / kos ${p}°`);
  s.add('Rabung (ridge capping)', 'm', pl, `${f(L)} + 2 x ${f(e)}`);
  s.add('Papan cucur (fascia) dan papan layang (barge board)', 'm', 2 * pl + 4 * barge, `2 x ${f(pl)} + 4 x ${f(barge)} (cerun)`);
  if (e > 0) s.add('Siling bawah cucur (soffit)', 'm2', 2 * (pl + W) * e, `2 x (${f(pl)} + ${f(W)}) x ${f(e)}`);
  if (rise > 0) s.add('Dinding / panel gable kedua-dua hujung bumbung', 'm2', W * rise, `2 x (0.5 x ${f(W)} x ${f(rise)})`);
  s.add('Talang air (gutter)', 'm', 2 * pl, `2 x ${f(pl)}`);
  s.add('Paip turun (downpipe) termasuk sambungan ke saliran', 'no', Math.max(2, Math.ceil((2 * pl) / 8)), 'Satu bagi setiap ~8m talang, sekurang-kurangnya 2');
}

/** Plumbing, electrical and air-conditioning points, common to both kinds. */
function servicesLines(sheet: Sheet, x: M) {
  const toilets = v(x, 'toilets');
  const water = v(x, 'plumbingPoints');
  const septic = v(x, 'septicTanks');
  const p = sheet.section('KERJA PAIP & PEMBETUNGAN');
  p.add('Mata paip air sejuk (PPR 20mm) termasuk injap henti', 'no', water, 'Sinki, pili, tandas');
  p.add('Mata paip buangan uPVC 50mm ke saliran', 'no', water);
  p.add('Set tandas lengkap (mangkuk tandas, sinki basuh tangan, pili, cermin)', 'set', toilets);
  p.add('Perangkap lantai (floor trap)', 'no', toilets);
  p.add('Paip pembetungan uPVC 100mm dari tandas ke tangki septik', 'm', toilets > 0 ? 6 * toilets : 0, 'Anggaran 6m setiap tandas; sahkan di tapak');
  p.add('Kebuk pemeriksaan (inspection chamber) 450 x 450mm', 'no', toilets > 0 ? 2 : 0);
  p.add(
    'Bekal dan pasang tangki septik siap pasang (prefab) 5 PE termasuk korekan, tapak konkrit, tambak semula, paip udara dan sambungan',
    'no',
    septic,
  );
  p.ls(toilets + water > 0, 'Ujian tekanan paip air (10 bar, 1 jam) dan ujian air paip najis sebelum ditutup/ditimbus');

  const light = v(x, 'lightPoints');
  const power = v(x, 'powerPoints');
  const ac = v(x, 'acPoints');
  const fan = v(x, 'fanPoints');
  const any = light + power + ac + fan > 0;
  const e = sheet.section('KERJA ELEKTRIK & PENGHAWA DINGIN');
  e.ls(any, 'Kabel utama (sub-main) dari sumber bekalan ke DB baru termasuk konduit', 'Sahkan sumber dan jarak di tapak');
  e.add('Papan agihan (DB) lengkap suis utama, RCCB dan MCB', 'no', any ? 1 : 0);
  e.add('Elektrod bumi dan kabel bumi ke DB', 'set', any ? 1 : 0);
  e.add('Mata lampu termasuk suis dan pendawaian 1.5mm² dalam konduit', 'no', light);
  e.add('Bekal dan pasang lampu LED panel siling', 'no', light);
  e.add('Mata soket 13A bersuis termasuk pendawaian 2.5mm² dalam konduit', 'no', power);
  e.add('Mata penghawa dingin termasuk suis pemencil (isolator) dan pendawaian 2.5mm²', 'no', ac);
  e.add('Paip tembaga penghawa dingin termasuk penebat dan pendakap', 'm', 5 * ac, '5m setiap unit (anggaran)');
  e.add('(Pilihan) Bekal dan pasang unit penghawa dingin 1.5HP', 'no', ac, 'Nyatakan jenama', true);
  e.add('Mata kipas siling termasuk regulator dan cangkuk kipas', 'no', fan);
  e.add('(Pilihan) Bekal dan pasang kipas siling 56 inci', 'no', fan, '', true);
  e.ls(any, 'Ujian, pentauliahan dan sijil pendawai (Borang G)');
}

const COMMON_NOTES = [
  'Semua kuantiti adalah anggaran. Kontraktor wajib membuat lawatan tapak dan mengesahkan ukuran sebelum menghantar sebut harga.',
  'Kadar hendaklah termasuk bahan, upah, pengangkutan, peralatan dan keuntungan.',
  'Isi Kadar bagi setiap baris. Jumlah dikira secara automatik. Baris yang tidak berharga menyebabkan sebut harga tidak boleh dibandingkan.',
  'Item bertanda (Pilihan) disebut harga berasingan dan boleh dikeluarkan.',
  `Bukaan dianggap: pintu 900 x 2100mm, tingkap 1200 x 1200mm. Kuantiti dinding sudah ditolak bukaan ini.`,
  'Kerja elektrik oleh pendawai berdaftar; Borang G diserahkan.',
  'Kontingensi adalah simpanan pemilik dan bukan sebahagian harga kontraktor. Sebarang perubahan kerja atau harga selepas award hanya melalui Arahan Perubahan Kerja (VO) yang diluluskan.',
];

/** The site measurements each building kind asks for. Keys are stored on the BQ. */
export const NEW_BUILDING_MEASURES = [
  { key: 'length', label: 'Building length', unit: 'm', required: true },
  { key: 'width', label: 'Building width', unit: 'm', required: true },
  { key: 'wallHeight', label: 'Floor to ceiling height', unit: 'm', required: true },
  { key: 'roofPitch', label: 'Roof slope', unit: 'degrees', required: true },
  { key: 'eave', label: 'Roof overhang (eave) each side', unit: 'm' },
  { key: 'internalWalls', label: 'Inside walls, total length', unit: 'm' },
  { key: 'columns', label: 'Concrete columns', unit: 'no.' },
  { key: 'doors', label: 'Doors', unit: 'no.' },
  { key: 'windows', label: 'Windows', unit: 'no.' },
  { key: 'toilets', label: 'Toilets', unit: 'no.' },
  { key: 'toiletArea', label: 'Toilet floor area, all toilets', unit: 'm2' },
  { key: 'plumbingPoints', label: 'Water points (sink, tap)', unit: 'no.' },
  { key: 'septicTanks', label: 'Septic tanks', unit: 'no.' },
  { key: 'lightPoints', label: 'Light points', unit: 'no.' },
  { key: 'powerPoints', label: '13A socket points', unit: 'no.' },
  { key: 'acPoints', label: 'Air-conditioning points', unit: 'no.' },
  { key: 'fanPoints', label: 'Ceiling fan points', unit: 'no.' },
  { key: 'drainLength', label: 'Outside drain', unit: 'm' },
];

export const BUILDING_WORKS_MEASURES = [
  { key: 'existLength', label: 'Existing building length', unit: 'm', required: true },
  { key: 'existWidth', label: 'Existing building width', unit: 'm', required: true },
  // Needed as soon as walls are raised or an extension is measured: wall quantities depend on it.
  { key: 'wallHeight', label: 'New floor to ceiling height', unit: 'm', requiredIf: ['raiseHeight', 'extLength', 'extWidth'] },
  { key: 'raiseHeight', label: 'Raise existing walls by', unit: 'm' },
  { key: 'extLength', label: 'Extension length (along the building)', unit: 'm', requiredIf: ['extWidth'] },
  { key: 'extWidth', label: 'Extension width', unit: 'm', requiredIf: ['extLength'] },
  { key: 'extColumns', label: 'Extension concrete columns', unit: 'no.' },
  { key: 'roofRemove', label: 'Existing roof sheets to remove', unit: 'm2' },
  { key: 'ceilingRemove', label: 'Existing ceiling to remove', unit: 'm2' },
  { key: 'floorFinishRemove', label: 'Existing floor finish to remove', unit: 'm2' },
  { key: 'floorRaise', label: 'Raise existing floor by', unit: 'mm' },
  { key: 'roofPitch', label: 'New roof slope (0 = no new roof)', unit: 'degrees' },
  { key: 'eave', label: 'New roof overhang (eave) each side', unit: 'm' },
  { key: 'newOpenings', label: 'New openings to break in existing walls', unit: 'no.' },
  { key: 'closeOpenings', label: 'Old windows to remove and close', unit: 'no.' },
  { key: 'doors', label: 'New doors', unit: 'no.' },
  { key: 'windows', label: 'New windows', unit: 'no.' },
  { key: 'toilets', label: 'New toilets', unit: 'no.' },
  { key: 'plumbingPoints', label: 'New water points (sink, tap)', unit: 'no.' },
  { key: 'septicTanks', label: 'New septic tanks', unit: 'no.' },
  { key: 'lightPoints', label: 'Light points', unit: 'no.' },
  { key: 'powerPoints', label: '13A socket points', unit: 'no.' },
  { key: 'acPoints', label: 'Air-conditioning points', unit: 'no.' },
  { key: 'fanPoints', label: 'Ceiling fan points', unit: 'no.' },
  { key: 'repaintOutside', label: 'Outside walls to wash and repaint', unit: 'm2' },
];

/** A new single-storey building on a cleared site. */
export function newBuildingDraft(x: M): BuildingDraft {
  const L = v(x, 'length');
  const W = v(x, 'width');
  const H = v(x, 'wallHeight');
  const pitch = v(x, 'roofPitch');
  const e = v(x, 'eave');
  const I = v(x, 'internalWalls');
  const D = v(x, 'doors');
  const Wn = v(x, 'windows');
  const T = Math.min(v(x, 'toiletArea'), L * W);
  const A = L * W;
  const P = 2 * (L + W);
  const run = P + I;
  const open = D * DOOR_M2 + Wn * WINDOW_M2;
  const sheet = new Sheet();

  const a = sheet.section('KERJA AWALAN & AM');
  a.ls(true, 'Mobilisasi, pengangkutan bahan dan peralatan ke tapak serta demobilisasi');
  a.ls(true, 'Pemasangan aras dan kedudukan bangunan (setting out)');
  a.ls(true, 'Bekalan air dan elektrik sementara untuk kerja');
  a.ls(true, 'Insurans kerja (CAR) dan perlindungan PERKESO pekerja');
  a.ls(true, 'Pembuangan sisa binaan dan pembersihan tapak semasa kerja dan selepas siap');

  const b = sheet.section('KERJA TANAH & ASAS');
  b.add('Membersih dan meratakan tapak bangunan', 'm2', (L + 2) * (W + 2), `(${f(L)} + 2) x (${f(W)} + 2)`);
  b.add('Korek tanah untuk asas dan rasuk tanah', 'm3', run * 0.6 * 0.9, `(${f(P)} + ${f(I)}) x 0.6 x 0.9 (anggaran)`);
  b.add('Konkrit kurus 1:3:6 tebal 50mm di bawah asas', 'm2', run * 0.6, `(${f(P)} + ${f(I)}) x 0.6`);
  b.add(
    'Konkrit bertetulang Gred 25 untuk asas dan rasuk tanah termasuk besi tetulang dan acuan',
    'm3',
    run * 0.6 * 0.3,
    `(${f(P)} + ${f(I)}) x 0.6 x 0.3 (anggaran, ikut lukisan jurutera)`,
  );
  b.add('Tambak dan mampat tanah untuk aras lantai', 'm3', A * 0.3, `${f(A)} m² x 0.3m (anggaran; bergantung aras tapak)`);
  b.add('Rawatan anti-anai-anai di bawah lantai', 'm2', A, `${f(L)} x ${f(W)}`);
  b.add('Lapisan polietilena 1000g di bawah lantai', 'm2', A);
  b.add('Lantai konkrit Gred 25 tebal 100mm dengan jejaring BRC A7', 'm2', A);

  const c = sheet.section('STRUKTUR');
  c.add(`Tiang konkrit bertetulang 150 x 300mm, tinggi lebih kurang ${f(H + 0.1)}m, termasuk besi dan acuan`, 'no', v(x, 'columns'), 'Ikut lukisan jurutera');
  c.add('Rasuk keliling (ring beam) konkrit bertetulang 150 x 200mm di atas semua dinding', 'm', run, `Perimeter ${f(P)} + dinding dalam ${f(I)}`);

  const d = sheet.section('DINDING');
  const wall = Math.max(0, run * H - open);
  d.add('Dinding bata separuh (115mm)', 'm2', wall, `(${f(P)} + ${f(I)}) x ${f(H)} tolak bukaan ${f(open)}`);
  d.add('Lintel konkrit atas bukaan pintu dan tingkap', 'no', D + Wn);
  d.add('Lepa (plaster) dinding kedua-dua belah', 'm2', wall * 2, `${f(wall)} x 2`);

  roofLines(sheet.section('KERJA BUMBUNG'), { length: L, width: W, pitch, eave: e });

  const s = sheet.section('SILING');
  s.add(
    `Siling rata papan plaster (gypsum) 9mm dengan rangka keluli ringan, sambungan ditampal licin, paras ${f(H)}m dari lantai (papan kalis lembapan di tandas)`,
    'm2',
    A,
    `${f(L)} x ${f(W)}`,
  );
  s.add('Panel akses siling 600 x 600mm', 'no', A > 0 ? 1 : 0);

  const fl = sheet.section('KERJA LANTAI');
  fl.add('Jubin lantai homogeneous 600 x 600mm termasuk screed', 'm2', A - T, T > 0 ? `${f(A)} tolak tandas ${f(T)}` : `${f(L)} x ${f(W)}`);
  fl.add('Jubin lantai anti-gelincir 300 x 300mm di tandas termasuk lapisan kalis air', 'm2', T);
  fl.add('Jubin dinding tandas tinggi 1.5m', 'm2', T > 0 ? 4 * Math.sqrt(T) * 1.5 : 0, 'Anggaran: perimeter tandas x 1.5');
  fl.add('Jubin skirting 100mm', 'm', Math.max(0, P + 2 * I - D * 0.9), `${f(P)} + 2 x ${f(I)} tolak pintu (anggaran)`);

  const g = sheet.section('PINTU & TINGKAP');
  g.add('Pintu 900 x 2100mm lengkap kerangka, engsel, tombol dan kunci', 'no', D);
  g.add('Tingkap aluminium 2 daun 1200 x 1200mm lengkap kaca dan jeriji keselamatan', 'no', Wn);

  servicesLines(sheet, x);

  const k = sheet.section('KEMASAN & CAT');
  const rise = pitch > 0 ? (W / 2) * Math.tan(rad(pitch)) : 0;
  const outside = Math.max(0, P * H + W * rise - open);
  k.add('Cat dinding luar (1 lapis primer + 2 lapis cat emulsi luar)', 'm2', outside, `${f(P)} x ${f(H)} + gable ${f(W * rise)} tolak bukaan`);
  k.add('Cat dinding dalam (1 lapis primer + 2 lapis cat emulsi)', 'm2', Math.max(0, P * H + 2 * I * H - open), `${f(P)} x ${f(H)} + 2 x ${f(I)} x ${f(H)} tolak bukaan`);
  k.add('Cat siling', 'm2', A);

  const o = sheet.section('KERJA LUAR');
  o.add('Longkang konkrit pracetak termasuk korekan dan sambungan ke saliran sedia ada', 'm', v(x, 'drainLength'));
  o.add('Apron konkrit lebar 600mm keliling bangunan', 'm2', P * 0.6, `${f(P)} x 0.6`);

  const { sections, lines } = sheet.build();
  return {
    title: `Bina bangunan baru ${f(L)}m x ${f(W)}m, siling ${f(H)}m`,
    sections,
    lines,
    notes: [
      `Ukuran dari tapak: bangunan ${f(L)}m x ${f(W)}m (${f(A)} m²); siling ${f(H)}m dari lantai; bumbung kecerunan lebih kurang ${pitch}°, cucur ${f(e)}m.`,
      'Kerja struktur (asas, tiang, rasuk) mengikut lukisan jurutera bertauliah. Kuantiti struktur di sini adalah anggaran.',
      'Kelulusan pelan bangunan Pihak Berkuasa Tempatan (PBT) hendaklah diperoleh sebelum kerja bermula.',
      ...COMMON_NOTES,
    ],
    contingencyPct: AM_BQ_CONTINGENCY_DEFAULT,
  };
}

/**
 * Renovation or extension of an existing building, as in Fauzan's sample: strip out, an extra room at one end, walls
 * raised for a higher ceiling, a new roof over both, the floor raised and retiled, new points and repainting. Any part
 * not measured (0) is left out.
 */
export function buildingWorksDraft(x: M): BuildingDraft {
  const L = v(x, 'existLength');
  const W = v(x, 'existWidth');
  const H = v(x, 'wallHeight');
  const raise = v(x, 'raiseHeight');
  const eL = v(x, 'extLength');
  const eW = v(x, 'extWidth');
  const ext = eL * eW;
  const extRun = ext > 0 ? 2 * eL + eW : 0;
  const pitch = v(x, 'roofPitch');
  const e = v(x, 'eave');
  const roofOff = v(x, 'roofRemove');
  const ceilOff = v(x, 'ceilingRemove');
  const floorOff = v(x, 'floorFinishRemove');
  const floorRaise = v(x, 'floorRaise');
  const D = v(x, 'doors');
  const Wn = v(x, 'windows');
  const A = L * W;
  const P = 2 * (L + W);
  const CL = L + eL;
  const CP = 2 * (CL + Math.max(W, eW));
  const sheet = new Sheet();

  const a = sheet.section('KERJA AWALAN & AM');
  a.ls(true, 'Mobilisasi, pengangkutan bahan dan peralatan ke tapak serta demobilisasi');
  a.ls(roofOff > 0, 'Kerja sokongan sementara (props) dan penutup sementara (kanvas) semasa bumbung dibuka');
  a.ls(true, 'Pembuangan sisa binaan dan bahan roboh keluar dari tapak');
  a.ls(true, 'Pembersihan tapak semasa kerja dan selepas siap');

  const b = sheet.section('KERJA ROBOH & PEMBUANGAN');
  b.add('Buka dan buang kepingan bumbung sedia ada termasuk rabung dan cucur', 'm2', roofOff, 'Diukur di tapak');
  b.ls(roofOff > 0, 'Buka dan buang kekuda bumbung sedia ada');
  b.add('Buka dan buang siling sedia ada termasuk cornice', 'm2', ceilOff, 'Diukur di tapak');
  b.add('Buka dan buang kemasan lantai sedia ada', 'm2', floorOff, 'Diukur di tapak');
  b.ls(roofOff + ceilOff > 0, 'Tanggal lampu, kipas, sinki dan kelengkapan sedia ada untuk dipasang semula');
  b.add('Pecah bukaan baru di dinding sedia ada termasuk lintel', 'no', v(x, 'newOpenings'));

  const c = sheet.section(`BILIK TAMBAHAN (${f(eL)}m x ${f(eW)}m)`);
  if (ext > 0) {
    // The brief makes the ceiling height compulsory once an extension is measured, so no height is assumed here.
    const wh = H;
    c.add('Korek tanah untuk asas dan rasuk tanah', 'm3', extRun * 0.6 * 0.9, `(2 x ${f(eL)} + ${f(eW)}) x 0.6 x 0.9 (anggaran)`);
    c.add('Konkrit kurus 1:3:6 tebal 50mm di bawah asas', 'm2', extRun * 0.6, `${f(extRun)} x 0.6`);
    c.add(
      'Konkrit bertetulang Gred 25 untuk asas dan rasuk tanah termasuk besi tetulang dan acuan',
      'm3',
      extRun * 0.6 * 0.3,
      `${f(extRun)} x 0.6 x 0.3 (anggaran, ikut lukisan jurutera)`,
    );
    c.add(`Tiang konkrit bertetulang 150 x 300mm, tinggi lebih kurang ${f(wh + 0.1)}m, termasuk besi dan acuan`, 'no', v(x, 'extColumns'), 'Ikut lukisan jurutera');
    c.add('Tambak dan mampat tanah untuk aras lantai (sama dengan aras lantai bangunan sedia ada)', 'm3', ext * 0.3, `${f(ext)} m² x 0.3m (anggaran; bergantung aras tapak)`);
    c.add('Rawatan anti-anai-anai di bawah lantai', 'm2', ext, `${f(eL)} x ${f(eW)}`);
    c.add('Lapisan polietilena 1000g di bawah lantai', 'm2', ext);
    c.add('Lantai konkrit Gred 25 tebal 100mm dengan jejaring BRC A7', 'm2', ext);
    const wall = extRun * wh;
    c.add(`Dinding bata separuh (115mm) tinggi ${f(wh)}m`, 'm2', wall, `(2 x ${f(eL)} + ${f(eW)}) x ${f(wh)}`);
    c.add('Lepa (plaster) dinding kedua-dua belah', 'm2', wall * 2, `${f(wall)} x 2`);
  }

  const raisedTo = H > 0 ? ` KE ${f(H)}m` : '';
  const d = sheet.section(`MENAIKKAN DINDING & SILING${raisedTo}`);
  const raised = P * raise;
  d.add(`Dinding bata separuh (115mm) ditambah di atas dinding sedia ada, tinggi lebih kurang ${f(raise)}m`, 'm2', raised, `(${f(L)} + ${f(W)}) x 2 x ${f(raise)}`);
  // Over every wall: the outside walls of the whole building, plus the old end wall that the extension makes inside.
  const ring = CP + (ext > 0 ? W : 0);
  d.add(
    'Rasuk keliling (ring beam) konkrit bertetulang 150 x 200mm di atas semua dinding',
    'm',
    raise > 0 || ext > 0 ? ring : 0,
    ext > 0 ? `Perimeter luar ${f(CP)} + dinding kongsi ${f(W)}` : `Perimeter ${f(CP)}`,
  );
  d.add('Lepa (plaster) dinding yang dinaikkan, kedua-dua belah', 'm2', raised * 2, `${f(raised)} x 2`);
  if (H > 0)
    d.add(
      `Siling rata papan plaster (gypsum) 9mm dengan rangka keluli ringan, sambungan ditampal licin, paras ${f(H)}m dari lantai`,
      'm2',
      A + ext,
      ext > 0 ? `${f(A)} + ${f(ext)}` : `${f(L)} x ${f(W)}`,
    );
  d.add('Panel akses siling 600 x 600mm', 'no', H > 0 ? 1 : 0);

  if (pitch > 0) roofLines(sheet.section('KERJA BUMBUNG BARU'), { length: CL, width: Math.max(W, eW), pitch, eave: e });

  const fl = sheet.section('KERJA LANTAI');
  fl.add(`Naikkan aras lantai sedia ada ${floorRaise}mm dengan konkrit/screed`, 'm2', floorRaise > 0 ? A : 0, `${f(L)} x ${f(W)}`);
  const tiles = floorOff + (ext > 0 ? ext : 0);
  fl.add('Jubin lantai homogeneous 600 x 600mm termasuk screed', 'm2', tiles, ext > 0 ? `${f(floorOff)} + ${f(ext)}` : `${f(floorOff)}`);
  fl.add('Jubin skirting 100mm', 'm', tiles > 0 ? CP : 0, 'Anggaran');

  const g = sheet.section('PINTU & TINGKAP');
  g.add('Pintu 900 x 2100mm lengkap kerangka, engsel, tombol dan kunci', 'no', D);
  g.ls(floorRaise > 0, `Ubahsuai pintu sedia ada akibat lantai dinaikkan ${floorRaise}mm`);
  g.add('Tanggal tingkap lama dan tutup bukaan dengan bata, termasuk lintel dan lepa', 'no', v(x, 'closeOpenings'), 'Sahkan bilangan di tapak');
  g.add('Tingkap aluminium 2 daun 1200 x 1200mm lengkap kaca dan jeriji keselamatan', 'no', Wn);

  servicesLines(sheet, x);

  const k = sheet.section('KEMASAN & CAT');
  const out = v(x, 'repaintOutside');
  k.add('Cuci dinding luar dengan water jet dan rawatan anti-kulat', 'm2', out, 'Diukur di tapak');
  k.add('Cat dinding luar (1 lapis primer + 2 lapis cat emulsi luar)', 'm2', out);
  const inside = H > 0 ? CP * H : 0;
  k.add('Cat dinding dalam (1 lapis primer + 2 lapis cat emulsi)', 'm2', inside, `${f(CP)} x ${f(H)} (anggaran tolak bukaan)`);
  k.add('Cat siling', 'm2', H > 0 ? A + ext : 0);
  k.ls(raise > 0 || ext > 0, 'Baiki retak dinding dan sambungan dinding lama dengan dinding baru');

  const { sections, lines } = sheet.build();
  const parts = [ext > 0 ? `bilik tambahan ${f(eL)}m x ${f(eW)}m` : '', raise > 0 && H > 0 ? `menaikkan siling ke ${f(H)}m` : ''].filter(Boolean);
  return {
    title: `Kerja ubahsuai${parts.length ? `, ${parts.join(' dan ')}` : ''}`,
    sections,
    lines,
    notes: [
      `Ukuran dari tapak: bangunan sedia ada ${f(L)}m x ${f(W)}m${H > 0 ? `; siling baru ${f(H)}m` : ''}${ext > 0 ? `; bilik tambahan ${f(eL)}m x ${f(eW)}m disambung di hujung bangunan` : ''}.`,
      ...(pitch > 0 ? [`Bumbung baru kecerunan lebih kurang ${pitch}°, cucur ${f(e)}m, meliputi bangunan sedia ada${ext > 0 ? ' dan bilik tambahan' : ''}.`] : []),
      'Sebarang kekangan tapak (pokok, struktur bersebelahan, had ketinggian bumbung) hendaklah ditulis dalam nota ini sebelum dihantar.',
      ...COMMON_NOTES,
    ],
    contingencyPct: AM_BQ_CONTINGENCY_DEFAULT,
  };
}