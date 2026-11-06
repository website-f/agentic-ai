// P81: auto-aligning import. The old system's spreadsheets are not Prima's template: the column names are in Malay or
// English, there is a title block above the header, dates are typed three ways or are Excel serials, money has "RM" in
// front. This reads any such sheet: finds the header row, matches each column to a record field (by name, by the words
// offices use in either language, by a close spelling, or by what the values look like), and turns the cell text into
// the form's value. The person sees every match in the preview and can change it before anything is saved.
//
// The idea follows the office's member import (apps/api/agentic/api/routers/member_import.py: HEADERS synonyms, the
// header-row scan, difflib matching). `similarity` is difflib's SequenceMatcher.ratio (Ratcliff/Obershelp).

export interface AlignField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'bool' | 'ref';
  options?: [string, string][];
  required?: boolean;
  restricted?: boolean;
  /** More header words for this field only (a client's "name" is "Nama Pelanggan", not a person's "Nama"). */
  words?: string[];
}

export type MatchHow = 'name' | 'synonym' | 'fuzzy' | 'shape' | 'manual';

export interface ColumnMatch {
  index: number;
  header: string;
  field: string | null;
  how: MatchHow | null;
  /** 0..1, how sure the match is. */
  score: number;
}

/** The pseudo-field for a "Company" column: each row then goes to the company it names. */
export const COMPANY_FIELD = '__company';

/** Lower case, letters and digits only, single spaces; "expiresOn" reads as "expires on". */
export function normHeader(s: string): string {
  return String(s ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, ' ')
    .trim();
}

/** difflib.SequenceMatcher(None, a, b).ratio(): 2 x matched characters / total characters. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const matched = (a0: number, a1: number, b0: number, b1: number): number => {
    // The longest common block, then the same on each side of it.
    let best = 0;
    let bi = 0;
    let bj = 0;
    let prev = new Array<number>(b1 - b0 + 1).fill(0);
    for (let i = a0; i < a1; i++) {
      const cur = new Array<number>(b1 - b0 + 1).fill(0);
      for (let j = b0; j < b1; j++) {
        if (a[i] === b[j]) {
          const k = prev[j - b0] + 1;
          cur[j - b0 + 1] = k;
          if (k > best) {
            best = k;
            bi = i - k + 1;
            bj = j - k + 1;
          }
        }
      }
      prev = cur;
    }
    if (!best) return 0;
    return best + matched(a0, bi, b0, bj) + matched(bi + best, a1, bj + best, b1);
  };
  return (2 * matched(0, a.length, 0, b.length)) / (a.length + b.length);
}

/**
 * What offices call each field, in English and Malay, by the field's key (the same key means the same thing across
 * records). Normalised with normHeader. The field's own key and label always match too.
 */
export const HEADER_WORDS: Record<string, string[]> = {
  [COMPANY_FIELD]: ['company', 'syarikat', 'nama syarikat', 'company name', 'entity', 'entiti', 'employer', 'majikan'],
  staffNo: ['staff no', 'staff number', 'staff id', 'employee no', 'employee id', 'emp no', 'no pekerja', 'no staf', 'id pekerja', 'no kakitangan', 'staff code'],
  name: ['name', 'nama', 'nama penuh', 'full name', 'staff name', 'employee name', 'nama pekerja', 'nama kakitangan'],
  jobTitle: ['jawatan', 'position', 'designation', 'job title', 'title', 'job', 'post'],
  department: ['jabatan', 'bahagian', 'unit', 'dept', 'department', 'division'],
  reportsTo: ['reports to', 'supervisor', 'penyelia', 'ketua', 'melapor kepada'],
  branchId: ['branch', 'cawangan', 'office', 'pejabat', 'outlet'],
  employmentType: ['employment', 'employment type', 'jenis pekerjaan', 'status pekerjaan', 'taraf jawatan', 'jenis lantikan'],
  hiredOn: ['date joined', 'join date', 'joined', 'joined on', 'date of joining', 'tarikh lantikan', 'tarikh mula kerja', 'tarikh masuk', 'tarikh lapor diri', 'tarikh mula berkhidmat', 'start date', 'commencement date'],
  probationEndsOn: ['probation end', 'tamat percubaan', 'tarikh tamat percubaan', 'confirmation date', 'tarikh pengesahan'],
  contractEndsOn: ['contract end', 'contract ends', 'tamat kontrak', 'tarikh tamat kontrak', 'contract expiry'],
  idFull: ['ic', 'ic no', 'no ic', 'nric', 'nric no', 'mykad', 'no kp', 'no k p', 'kad pengenalan', 'no kad pengenalan', 'passport', 'passport no', 'no passport', 'no pasport', 'ic passport', 'ic passport no'],
  gender: ['jantina', 'sex', 'gender'],
  dob: ['date of birth', 'tarikh lahir', 'birth date', 'dob', 'birthday'],
  maritalStatus: ['marital status', 'marital', 'taraf perkahwinan', 'status perkahwinan', 'perkahwinan'],
  children: ['children', 'no of children', 'anak', 'bilangan anak', 'bil anak'],
  nationality: ['nationality', 'citizenship', 'warganegara', 'kewarganegaraan', 'negara'],
  phone: ['phone', 'phone no', 'tel', 'tel no', 'telephone', 'telefon', 'no telefon', 'no tel', 'hp', 'no hp', 'h p', 'mobile', 'mobile no', 'handphone', 'contact no'],
  email: ['email', 'e mail', 'emel', 'e mel', 'email address', 'alamat emel'],
  address: ['address', 'alamat', 'home address', 'alamat rumah', 'alamat surat menyurat', 'premise address', 'alamat premis'],
  emergencyName: ['emergency contact', 'next of kin', 'waris', 'nama waris', 'emergency name'],
  emergencyPhone: ['emergency phone', 'emergency contact no', 'no waris', 'telefon waris', 'no tel waris'],
  epfNo: ['epf', 'epf no', 'kwsp', 'no kwsp', 'no ahli kwsp'],
  socsoNo: ['socso', 'socso no', 'perkeso', 'no perkeso', 'no socso'],
  taxNo: ['income tax', 'income tax no', 'tax no', 'lhdn', 'no cukai', 'no cukai pendapatan', 'pcb no', 'tin'],
  bankName: ['bank', 'bank name', 'nama bank', 'salary bank'],
  bankAccountFull: ['account no', 'bank account', 'bank account no', 'no akaun', 'no akaun bank', 'akaun bank', 'acc no'],
  basicPay: ['basic', 'basic pay', 'basic salary', 'gaji', 'gaji pokok', 'gaji asas', 'salary', 'monthly salary'],
  payReason: ['pay reason', 'sebab gaji'],
  status: ['status', 'status semasa', 'current status'],
  lastDayOn: ['last day', 'last working day', 'hari terakhir', 'tarikh berhenti', 'resigned on', 'date left'],
  leavingReason: ['reason for leaving', 'sebab berhenti'],
  code: ['code', 'kod', 'site code', 'kod tapak', 'kod lokasi', 'unit code', 'kod unit'],
  client: ['client', 'pelanggan', 'klien', 'customer', 'client name', 'nama pelanggan'],
  clientName: ['client', 'client name', 'pelanggan', 'nama pelanggan', 'klien', 'customer', 'agensi', 'agency'],
  state: ['state', 'negeri'],
  lat: ['latitude', 'lat'],
  lng: ['longitude', 'lng', 'long', 'lon'],
  geofenceM: ['geofence', 'radius', 'clock in radius', 'jejari'],
  risk: ['risk', 'risiko', 'tahap risiko'],
  sector: ['sector', 'sektor', 'government or private', 'kerajaan swasta'],
  armed: ['armed', 'bersenjata', 'armed site'],
  siteId: ['site', 'tapak', 'lokasi', 'site name', 'nama tapak', 'premis'],
  sites: ['sites', 'site', 'site codes', 'tapak', 'lokasi', 'premis', 'kod tapak'],
  shiftStructure: ['shift', 'shift pattern', 'syif', 'corak syif'],
  guardsPerShift: ['guards per shift', 'guards', 'pengawal', 'bilangan pengawal', 'bil pengawal', 'manpower'],
  tagCode: ['tag', 'tag code', 'nfc', 'nfc tag', 'kod tag'],
  type: ['type', 'jenis', 'kind', 'category', 'kategori'],
  kind: ['type', 'jenis', 'kind', 'category', 'kategori', 'cover', 'perlindungan'],
  title: ['which one', 'perkara', 'butiran', 'licence name', 'nama lesen'],
  issuer: ['issuer', 'issued by', 'dikeluarkan oleh', 'agency', 'agensi', 'pihak berkuasa', 'authority', 'bank'],
  reference: ['reference', 'reference no', 'ref', 'ref no', 'no rujukan', 'rujukan', 'licence no', 'licence number', 'no lesen', 'permit no', 'no permit', 'certificate no', 'no sijil', 'registration no', 'no pendaftaran'],
  expiresOn: ['expiry', 'expiry date', 'expires', 'expires on', 'exp date', 'tarikh tamat', 'tamat tempoh', 'tarikh luput', 'luput', 'valid until', 'sah sehingga', 'sah hingga', 'end date'],
  insurer: ['insurer', 'insurance company', 'syarikat insurans', 'penanggung insurans', 'penginsurans', 'takaful'],
  broker: ['broker', 'agent', 'ejen', 'broker agent'],
  policyNo: ['policy no', 'policy number', 'no polisi', 'polisi', 'cover note'],
  policyId: ['policy', 'policy no', 'no polisi', 'polisi'],
  sumInsured: ['sum insured', 'jumlah diinsuranskan', 'nilai diinsuranskan', 'coverage', 'limit'],
  premium: ['premium', 'premium amount', 'premium rm', 'jumlah premium'],
  startsOn: ['start', 'start date', 'starts', 'effective date', 'tarikh mula', 'mula', 'from', 'dari', 'period from'],
  premiumDueOn: ['premium due', 'tarikh bayar premium', 'due date'],
  premiumPaidOn: ['premium paid', 'tarikh premium dibayar', 'paid on'],
  renewal: ['renewal', 'pembaharuan', 'renewal status'],
  ref: ['claim no', 'claim ref', 'claim reference', 'no tuntutan', 'rujukan tuntutan'],
  what: ['what happened', 'description', 'details', 'butiran kejadian', 'keterangan', 'perihal'],
  incidentOn: ['incident date', 'date of incident', 'date of loss', 'tarikh kejadian', 'tarikh insiden'],
  amountClaimed: ['amount claimed', 'claim amount', 'jumlah tuntutan', 'amaun tuntutan'],
  beneficiary: ['beneficiary', 'in favour of', 'penerima', 'benefisiari'],
  contractRef: ['contract', 'contract ref', 'tender', 'no kontrak', 'no tender'],
  amount: ['amount', 'jumlah', 'amaun', 'nilai', 'value', 'bond amount'],
  fee: ['fee', 'yuran', 'commission', 'caj'],
  issuedOn: ['issued on', 'issue date', 'tarikh dikeluarkan', 'tarikh keluar'],
  releasedOn: ['released on', 'tarikh dilepaskan', 'release date'],
  plate: ['plate', 'plate no', 'plate number', 'no plat', 'registration no', 'no pendaftaran kenderaan', 'vehicle no', 'no kenderaan', 'car plate'],
  model: ['model', 'make', 'make and model', 'jenama', 'jenama model', 'vehicle model'],
  odometerKm: ['odometer', 'mileage', 'km', 'bacaan meter', 'mileage km'],
  roadTax: ['road tax', 'cukai jalan', 'road tax expiry', 'tamat cukai jalan', 'lkm'],
  insurance: ['insurance', 'insurans', 'insurance expiry', 'tamat insurans'],
  puspakom: ['puspakom', 'inspection'],
  permit: ['permit', 'permit expiry', 'apad', 'lpkp'],
  serviceDueOn: ['next service', 'service date', 'next service date', 'servis seterusnya', 'tarikh servis'],
  serviceDueKm: ['next service km', 'service km', 'servis km'],
  trackerId: ['gps', 'tracker', 'gps tracker', 'gps id'],
  dashcamId: ['dashcam', 'dash cam'],
  sku: ['sku', 'item code', 'kod item', 'kod barang', 'part no'],
  size: ['size', 'saiz', 'ukuran'],
  consumable: ['consumable', 'used up', 'guna habis'],
  reorderAt: ['reorder', 'reorder level', 'reorder at', 'min stock', 'paras minimum', 'stok minimum'],
  onHand: ['on hand', 'stock', 'baki', 'baki stok', 'quantity', 'kuantiti', 'qty', 'balance'],
  beds: ['beds', 'katil', 'bilangan katil', 'capacity', 'kapasiti'],
  tenure: ['owned or rented', 'tenure', 'milik sewa', 'pemilikan'],
  town: ['town', 'city', 'bandar', 'daerah'],
  ownerEntity: ['owner', 'owned by', 'pemilik', 'entity', 'entiti'],
  sizeSqft: ['size', 'sq ft', 'sqft', 'keluasan', 'saiz', 'built up'],
  askingRent: ['rent', 'asking rent', 'sewa', 'sewa bulanan', 'rental'],
  insuranceExpiry: ['insurance', 'insurance expiry', 'tamat insurans'],
  assessmentDue: ['assessment', 'cukai taksiran', 'cukai pintu', 'taksiran'],
  quitRentDue: ['quit rent', 'cukai tanah', 'tanah'],
  tag: ['tag', 'asset tag', 'asset no', 'no aset', 'tag aset', 'no siri aset', 'asset code'],
  description: ['description', 'keterangan', 'butiran', 'perihal', 'item', 'asset', 'aset'],
  location: ['location', 'lokasi', 'tempat', 'room', 'bilik'],
  cost: ['cost', 'kos', 'harga', 'price', 'purchase price', 'harga beli'],
  boughtOn: ['bought on', 'purchase date', 'date bought', 'tarikh beli', 'tarikh pembelian', 'acquired'],
  condition: ['condition', 'keadaan'],
  keeper: ['kept by', 'keeper', 'custodian', 'pemegang', 'penjaga', 'pengguna', 'user'],
  lastCheckedOn: ['last checked', 'tarikh semakan', 'last inspection'],
  registrar: ['registrar', 'host', 'hosting', 'pendaftar'],
  sslExpiresOn: ['ssl', 'ssl expiry', 'certificate expiry'],
  unitId: ['unit', 'unit code', 'kod unit', 'property'],
  dueOn: ['due', 'due on', 'due date', 'tarikh akhir', 'tarikh siap'],
  doneOn: ['done on', 'completed', 'completed on', 'tarikh siap', 'tarikh selesai'],
  contractor: ['contractor', 'kontraktor', 'vendor'],
  source: ['raised from', 'source', 'sumber'],
  ext: ['ext', 'extension', 'sambungan', 'no sambungan', 'desk extension'],
  label: ['who or where', 'location', 'nama', 'user', 'pengguna'],
  forwardToCms: ['forward', 'forward to cms'],
  linked: ['linked', 'linked to cms', 'dihubungkan'],
  cameras: ['cameras', 'kamera', 'bilangan kamera', 'no of cameras'],
  supplies: ['supplies', 'bekalan', 'products'],
  licenceRef: ['licence ref', 'licence no', 'no lesen', 'dealer licence'],
  licenceExpiresOn: ['licence expiry', 'tamat lesen', 'licence expires'],
  contact: ['contact', 'contact person', 'pegawai dihubungi', 'hubungi'],
  supplierId: ['supplier', 'pembekal', 'vendor'],
  category: ['category', 'kategori', 'jenis', 'type'],
  spec: ['specification', 'spec', 'spesifikasi'],
  unit: ['unit', 'uom', 'unit of measure'],
  unitPrice: ['unit price', 'price', 'harga', 'harga seunit', 'price per unit'],
  priceValidUntil: ['price valid until', 'sah sehingga', 'valid until'],
  leadTimeDays: ['lead time', 'tempoh penghantaran'],
  minOrder: ['minimum order', 'moq', 'min order'],
  post: ['can work as', 'post', 'jawatan'],
  active: ['active', 'aktif'],
  signedRef: ['contract no', 'contract number', 'contract ref', 'no kontrak', 'rujukan kontrak', 'loa', 'letter of award', 'surat setuju terima', 'sst', 'po no', 'agreement no', 'no perjanjian'],
  startOn: ['start', 'start date', 'contract start', 'tarikh mula', 'tarikh mula kontrak', 'mula', 'from', 'dari'],
  endOn: ['end', 'end date', 'contract end', 'tarikh tamat', 'tarikh tamat kontrak', 'tamat', 'to', 'hingga', 'sehingga'],
  billingMethod: ['billing', 'billing method', 'kaedah bil', 'kaedah caj', 'method'],
  rate: ['rate', 'kadar', 'rate per hour', 'hourly rate', 'kadar sejam', 'rate per guard hour'],
  fixedFee: ['monthly fee', 'fixed fee', 'yuran bulanan', 'caj bulanan', 'contract value', 'nilai kontrak bulanan', 'monthly'],
  contractedHours: ['contracted hours', 'jam kontrak', 'hours'],
  days: ['days', 'hari', 'bilangan hari', 'entitlement', 'kelayakan', 'leave days', 'cuti', 'jumlah hari'],
  leaveKind: ['leave type', 'jenis cuti', 'type', 'jenis', 'kind'],
  note: ['note', 'notes', 'catatan', 'remarks', 'ulasan', 'reason', 'sebab', 'justification'],
};

/** Value words in Malay, read as the English the option labels use. */
const VALUE_WORDS: Record<string, string> = {
  lelaki: 'male',
  laki: 'male',
  l: 'male',
  perempuan: 'female',
  wanita: 'female',
  p: 'female',
  tetap: 'permanent',
  kontrak: 'fixed term contract',
  percubaan: 'on probation',
  probation: 'on probation',
  bujang: 'single',
  berkahwin: 'married',
  kahwin: 'married',
  bercerai: 'divorced',
  duda: 'divorced',
  janda: 'divorced',
  balu: 'widowed',
  aktif: 'active',
  berhenti: 'left',
  'letak jawatan': 'left',
  digantung: 'suspended',
  warganegara: 'malaysian',
  malaysia: 'malaysian',
  nepal: 'nepali',
  kerajaan: 'government',
  swasta: 'private',
  rendah: 'low',
  sederhana: 'medium',
  tinggi: 'high',
  sewa: 'rented',
  disewa: 'rented',
  milik: 'owned',
  sendiri: 'owned',
  kereta: 'car',
  motosikal: 'motorcycle',
  motor: 'motorcycle',
  lori: 'lorry',
  baik: 'good',
  rosak: 'poor',
  kosong: 'vacant',
  disewakan: 'let',
  tahunan: 'annual',
  sakit: 'sick',
  bersalin: 'maternity',
  paterniti: 'paternity',
  selesai: 'done',
  siap: 'done',
  dibuka: 'open',
  baharu: 'open',
  lesen: 'licence',
  insurans: 'insurance',
  pendaftaran: 'registration',
  sijil: 'certificate',
  bomba: 'fire',
  majlis: 'council',
  premis: 'premise',
  papan: 'signboard',
  tanda: 'signboard',
};

/** Words that do not tell companies apart ("Maju Sdn Bhd" is "Maju"); "SN BHD" is a common typo of "SDN BHD". */
const COMPANY_NOISE = new Set(['sdn', 'sn', 'bhd', 'berhad', 'sendirian', 'plc', 'ltd', 'limited', 'inc', 'co', 'm', 'the']);

function words(s: string): string[] {
  return normHeader(s).split(' ').filter(Boolean);
}

function fieldNames(f: AlignField): string[] {
  return [normHeader(f.key), normHeader(f.label), normHeader(f.label.replace(/\(.*?\)/g, ''))].filter(Boolean);
}

/** How well one header names one field: [score, how] or null. */
export function headerScore(header: string, f: AlignField): [number, MatchHow] | null {
  const h = normHeader(header);
  if (!h) return null;
  if (fieldNames(f).includes(h)) return [1, 'name'];
  const syn = [...(f.words ?? []), ...(HEADER_WORDS[f.key] ?? [])].map(normHeader);
  if (syn.includes(h)) return [0.95, 'synonym'];
  // A known word inside a longer header: "No. KP (Baru)" holds "no kp". The longer the word, the surer.
  const padded = ` ${h} `;
  let inside = 0;
  for (const w of [...syn, ...fieldNames(f)]) if (w.length >= 3 && padded.includes(` ${w} `)) inside = Math.max(inside, w.length / h.length);
  if (inside >= 0.35) return [0.75 + 0.15 * Math.min(1, inside), 'synonym'];
  let fuzzy = 0;
  for (const w of [...fieldNames(f), ...syn]) fuzzy = Math.max(fuzzy, similarity(h, w));
  if (fuzzy >= 0.8) return [0.85 * fuzzy, 'fuzzy'];
  return null;
}

// ---------- Value shapes ----------

export type Shape = 'email' | 'ic' | 'plate' | 'phone' | 'date' | 'money' | 'bool';

const SHAPES: Record<Shape, (v: string) => boolean> = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v),
  ic: (v) => /^\d{6}-?\d{2}-?\d{4}$/.test(v),
  plate: (v) => /^[A-Z]{1,3}\s?\d{1,4}\s?[A-Z]{0,3}$/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && !/^\d/.test(v),
  phone: (v) => /^(\+?60|0)\d{8,10}$/.test(v.replace(/[\s-]/g, '')),
  date: (v) => normDate(v).iso !== null && !/^\d+(\.\d+)?$/.test(v),
  money: (v) => /^(rm|myr)\s?-?[\d,]+(\.\d{1,2})?$/i.test(v.trim()),
  bool: (v) => BOOL_TRUE.has(v.trim().toLowerCase()) || BOOL_FALSE.has(v.trim().toLowerCase()),
};

/** Which shape most of a column's values have (at least 80% of up to 40 non-empty cells), or null. */
export function columnShape(values: string[]): Shape | null {
  const sample = values.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 40);
  if (sample.length < 2) return null;
  for (const s of ['email', 'ic', 'date', 'money', 'phone', 'plate', 'bool'] as Shape[]) {
    const hits = sample.filter(SHAPES[s]).length;
    if (hits / sample.length >= 0.8) return s;
  }
  return null;
}

/** The fields a shape points at, among those not yet matched. Only a single candidate counts. */
function shapeField(shape: Shape, free: AlignField[]): AlignField | null {
  const one = (xs: AlignField[]) => (xs.length === 1 ? xs[0] : null);
  switch (shape) {
    case 'email':
      return one(free.filter((f) => /email/i.test(f.key)));
    case 'ic':
      return one(free.filter((f) => f.key === 'idFull'));
    case 'plate':
      return one(free.filter((f) => f.key === 'plate'));
    case 'phone':
      return one(free.filter((f) => /phone/i.test(f.key) && !/emergency/i.test(f.key))) ?? one(free.filter((f) => /phone/i.test(f.key)));
    case 'date':
      return one(free.filter((f) => f.type === 'date'));
    case 'money':
      return one(free.filter((f) => f.type === 'number' && /\bRM\b/.test(f.label)));
    case 'bool':
      return one(free.filter((f) => f.type === 'bool'));
  }
}

/**
 * Match every column of the header row to a field. Each field takes at most one column (the surest), each column at
 * most one field. Columns no header names are then matched by what their values look like.
 */
export function alignColumns(header: string[], rows: string[][], fields: AlignField[]): ColumnMatch[] {
  const out: ColumnMatch[] = header.map((h, index) => ({ index, header: String(h ?? '').trim(), field: null, how: null, score: 0 }));
  const cands: { col: number; field: AlignField; score: number; how: MatchHow }[] = [];
  header.forEach((h, col) => {
    for (const f of fields) {
      const s = headerScore(h, f);
      if (s) cands.push({ col, field: f, score: s[0], how: s[1] });
    }
  });
  // Surest first; on a tie the field earlier in the form and the column further left.
  cands.sort((a, b) => b.score - a.score || fields.indexOf(a.field) - fields.indexOf(b.field) || a.col - b.col);
  const taken = new Set<string>();
  for (const c of cands) {
    if (out[c.col].field || taken.has(c.field.key)) continue;
    out[c.col] = { ...out[c.col], field: c.field.key, how: c.how, score: Math.round(c.score * 100) / 100 };
    taken.add(c.field.key);
  }
  for (const m of out) {
    if (m.field) continue;
    const shape = columnShape(rows.map((r) => r[m.index] ?? ''));
    if (!shape) continue;
    const f = shapeField(
      shape,
      fields.filter((x) => !taken.has(x.key) && x.key !== COMPANY_FIELD),
    );
    if (!f) continue;
    m.field = f.key;
    m.how = 'shape';
    m.score = 0.6;
    taken.add(f.key);
  }
  return out;
}

/**
 * The header row: among the first 25 rows, the one whose cells name the most fields (a title block, a blank line or
 * a "Senarai Pekerja 2026" banner above it is skipped). Ties go to the earlier row. With no row naming any field, the
 * first row.
 */
export function findHeaderRow(table: string[][], fields: AlignField[]): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(25, table.length); i++) {
    const row = table[i];
    const filled = row.filter((c) => String(c ?? '').trim()).length;
    if (!filled) continue;
    const named = new Set<string>();
    let total = 0;
    for (const cell of row) {
      let top: [number, string] | null = null;
      for (const f of fields) {
        const s = headerScore(cell, f);
        if (s && s[0] >= 0.75 && (!top || s[0] > top[0])) top = [s[0], f.key];
      }
      if (top && !named.has(top[1])) {
        named.add(top[1]);
        total += top[0];
      }
    }
    // A banner ("SENARAI LESEN SYARIKAT") names at most one field in one cell; a header names several.
    const score = named.size >= 2 || filled === 1 ? total : total * 0.5;
    if (score > bestScore + 1e-9) {
      best = i;
      bestScore = score;
    }
  }
  return best >= 0 ? best : Math.max(0, table.findIndex((r) => r.some((c) => String(c ?? '').trim())));
}

// ---------- Values ----------

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2,
  mar: 3, mac: 3, march: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6,
  jul: 7, julai: 7, july: 7,
  aug: 8, ogos: 8, ogo: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, okt: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, dis: 12, disember: 12, december: 12,
};

function isoOf(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}

/** Two-digit years: 00-49 are 20xx, 50-99 are 19xx (a 1965 birth date and a 2027 expiry both read right). */
const fullYear = (y: string) => (y.length === 2 ? (Number(y) < 50 ? 2000 + Number(y) : 1900 + Number(y)) : Number(y));

/**
 * An Excel date serial (days since 30 Dec 1899) to ISO. A bare number in a text column is read as a date only between
 * 1955 and 2119 (so a pay of 25000 in the wrong column is not); a cell Excel itself styles as a date (`styled`) from 1900.
 */
export function excelSerialDate(n: number, styled = false): string | null {
  if (!Number.isFinite(n) || n < (styled ? 1 : 20000) || n > (styled ? 2958465 : 80000)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

/**
 * A date as people type it, to ISO: 2027-03-01, 01/03/2027, 1-3-27, 01.03.2027, 1 Mac 2027, 01-Mar-27, an Excel
 * serial, or a date with a time after it. Day first, as in Malaysia. `matched` is false when the text is not a date at
 * all; `iso` is null when it looks like one that is not on the calendar (30/02).
 */
export function normDate(raw: string): { iso: string | null; matched: boolean } {
  const v = String(raw ?? '').trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?$/i, '').replace(/T\d{2}:\d{2}.*$/, '');
  if (!v) return { iso: null, matched: false };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (m) return { iso: isoOf(+m[1], +m[2], +m[3]), matched: true };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(v);
  if (m) return { iso: isoOf(fullYear(m[3]), +m[2], +m[1]), matched: true };
  m = /^(\d{1,2})[\s\-/.]*([a-z]+)[\s\-/.,]*(\d{2}|\d{4})$/i.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) return { iso: isoOf(fullYear(m[3]), MONTHS[m[2].toLowerCase()], +m[1]), matched: true };
  m = /^([a-z]+)[\s\-.]+(\d{1,2}),?[\s\-.]+(\d{4})$/i.exec(v);
  if (m && MONTHS[m[1].toLowerCase()]) return { iso: isoOf(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), matched: true };
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const iso = excelSerialDate(Number(v));
    return { iso, matched: iso !== null };
  }
  return { iso: null, matched: false };
}

const BOOL_TRUE = new Set(['yes', 'y', 'ya', 'true', '1', 'ada', 'betul', '✓', '✔', 'on']);
const BOOL_FALSE = new Set(['no', 'n', 'tidak', 'tak', 'false', '0', 'tiada', 'bukan', '-', 'off']);

/** Yes or no in English or Malay; null when it is neither. */
export function normBool(raw: string): boolean | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (BOOL_TRUE.has(v)) return true;
  if (BOOL_FALSE.has(v)) return false;
  return null;
}

/** "RM 1,234.50", "1 234.50", "(500.00)", "MYR2,000" to "1234.5"; null when it is not an amount. */
export function normMoney(raw: string): string | null {
  let v = String(raw ?? '').trim();
  if (!v) return null;
  let neg = false;
  if (/^\(.*\)$/.test(v)) {
    neg = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/^(rm|myr)\s*/i, '').replace(/\s*(rm|myr)$/i, '').replace(/[,\s]/g, '');
  if (v.startsWith('-')) {
    neg = !neg;
    v = v.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(v)) return null;
  const n = Number(v) * (neg ? -1 : 1);
  return Number.isFinite(n) ? String(n) : null;
}

/** A choice by its key, its label, or the Malay word for it, then by a close spelling; null when none or several. */
export function matchOption(raw: string, options: [string, string][]): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const n = normHeader(v);
  const english = VALUE_WORDS[n] ?? n.split(' ').map((w) => VALUE_WORDS[w] ?? w).join(' ');
  // The same words in another order ("Lesen KDN" is "KDN licence").
  const bag = (s: string) => s.split(' ').sort().join(' ');
  const sameWords = options.filter(([, label]) => bag(normHeader(label)) === bag(english));
  if (sameWords.length === 1) return sameWords[0][0];
  const exact = options.filter(([k, label]) => k === v || normHeader(k) === n || normHeader(label) === n || normHeader(label) === english || normHeader(k) === english);
  if (exact.length === 1) return exact[0][0];
  if (exact.length > 1) return null;
  // The label starts with the word ("Permanent" for "permanent staff"), or reads close enough.
  const starts = options.filter(([, label]) => normHeader(label).startsWith(english + ' ') || english.startsWith(normHeader(label) + ' '));
  if (starts.length === 1) return starts[0][0];
  const scored = options
    .map(([k, label]) => [k, Math.max(similarity(english, normHeader(label)), similarity(english, normHeader(k)))] as const)
    .sort((a, b) => b[1] - a[1]);
  if (scored.length && scored[0][1] >= 0.8 && (scored.length === 1 || scored[1][1] < scored[0][1] - 0.05)) return scored[0][0];
  return null;
}

/** A company name with the words that do not tell companies apart dropped. */
export function companyKey(name: string): string {
  const w = words(name).filter((x) => !COMPANY_NOISE.has(x));
  return (w.length ? w : words(name)).join(' ');
}

/**
 * Which of the person's companies a cell names: by code, by full name, by the name without "Sdn Bhd", then by a close
 * spelling (difflib cutoff 0.75), then by a unique part. `exact` is false for the guesses, so the preview can say so.
 */
export function matchCompany(raw: string, companies: { id: string; name: string; code?: string }[]): { id: string; exact: boolean } | null {
  const v = String(raw ?? '').trim();
  if (!v || !companies.length) return null;
  const n = normHeader(v);
  const byCode = companies.filter((c) => c.code && normHeader(c.code) === n);
  if (byCode.length === 1) return { id: byCode[0].id, exact: true };
  const byName = companies.filter((c) => normHeader(c.name) === n || c.id === v);
  if (byName.length === 1) return { id: byName[0].id, exact: true };
  const want = companyKey(v);
  const keys = companies.map((c) => ({ id: c.id, key: companyKey(c.name) }));
  const same = keys.filter((k) => k.key === want);
  if (same.length === 1) return { id: same[0].id, exact: true };
  const close = keys.map((k) => ({ ...k, s: similarity(want, k.key) })).sort((a, b) => b.s - a.s);
  if (close.length && close[0].s >= 0.75 && (close.length === 1 || close[1].s < close[0].s - 0.03)) return { id: close[0].id, exact: false };
  if (want.length >= 3) {
    const part = keys.filter((k) => k.key.includes(want) || (k.key.length >= 3 && want.includes(k.key)));
    if (part.length === 1) return { id: part[0].id, exact: false };
  }
  return null;
}

// ---------- Sheets ----------

/** Drop rows with nothing in them and trim the trailing empty cells, so the browser and the server count rows alike. */
export function cleanGrid(rows: unknown[][]): string[][] {
  const out: string[][] = [];
  for (const r of rows) {
    const cells = (r ?? []).map((c) => (c === null || c === undefined ? '' : String(c)));
    while (cells.length && !cells[cells.length - 1].trim()) cells.pop();
    if (cells.some((c) => c.trim())) out.push(cells);
  }
  return out;
}

/** A grid as RFC 4180 CSV (the import's transport): quoted where needed, CRLF between rows. */
export function toCsv(rows: string[][]): string {
  const cell = (c: string) => (/[",\r\n]/.test(c) || /^\s|\s$/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return rows.map((r) => r.map((c) => cell(String(c ?? ''))).join(',')).join('\r\n') + '\r\n';
}
