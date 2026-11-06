/**
 * Guide cards (Arisha main review, 2 Nov 2026, section A): one shared, versioned, role-scoped mapping of every staff and
 * manager task. The screen and Arisha read the same cards, so Arisha's answers match the screen. Read-only help: a card
 * never saves, approves, sends or provisions anything, and it shows a task only to people the server already lets do it.
 *
 * Rules every card follows (checked by test):
 * - Bahasa Melayu first, with matching English.
 * - "Entered once, reused" is required: what not to key again, and where it comes from.
 * - Fields come from the real form (RECORD_KINDS); nothing is invented. Anything not built or not verified says so.
 * - Who to ask is a desk from the hand-over map, never a named person or a guessed contact.
 *
 * Department threads add cards with registerGuideCards() from their own module, in the same shape.
 */
import { IMPORTABLE_KINDS } from './org-import';
import { ORG_DESK_LABEL, ORG_FLOWS, type OrgDesk } from './org-links';
import { RECORD_KINDS, type FieldSpec, type RecordKind } from './records';
import type { User } from './types';

/** Bumped whenever a card's meaning changes, so Arisha and the screen can tell they read the same version. */
export const GUIDE_VERSION = '2026-11-03.2';

export interface GuideText {
  bm: string;
  en: string;
}
const t = (bm: string, en: string): GuideText => ({ bm, en });

/** Built and checked in code; partly built; or described but not built yet (shown, never offered as an action). */
/** off: built, but switched off in this environment (the release owner turns it on). */
export type GuideStatus = 'ready' | 'partial' | 'not_built' | 'off';

export interface GuideField {
  key: string;
  /** The label exactly as the form shows it. */
  label: string;
  required: boolean;
  format: GuideText;
  /** Synthetic, made from the field's own type and choices. */
  example: string;
  choices?: string[];
  /** A rule the server adds beyond the form's own marks (read from the save code, kept in step by test). */
  rule?: GuideText;
}

/**
 * Rules the server applies on save that the form's field marks do not show. Taken from PrimaService.saveRecord; a test
 * saves without each one and expects the refusal, so this list cannot quietly drift from the code.
 */
export const SERVER_FIELD_RULES: Partial<Record<RecordKind, Record<string, GuideText>>> = {
  officeStaff: {
    idFull: t('Wajib semasa menambah staf baharu.', 'Needed when adding a new staff member.'),
    branchId: t('Mesti cawangan syarikat yang dipilih.', 'Must be a branch of the chosen company.'),
    email: t('Mesti alamat emel yang sah.', 'Must look like an email address.'),
    phone: t('Digit sahaja, contoh 012-345 6789.', 'Digits only, e.g. 012-345 6789.'),
    emergencyPhone: t('Digit sahaja, contoh 012-345 6789.', 'Digits only, e.g. 012-345 6789.'),
    probationEndsOn: t('Wajib jika Pekerjaan ialah Dalam percubaan.', 'Needed when Employment is On probation.'),
    contractEndsOn: t('Wajib jika Pekerjaan ialah Kontrak tempoh tetap.', 'Needed when Employment is Fixed-term contract.'),
  },
};

export interface GuideCardView {
  id: string;
  version: string;
  status: GuideStatus;
  dept: string;
  title: GuideText;
  purpose: GuideText;
  who: GuideText;
  /** The screen (navigation view) and the button to press there. */
  screen: { view: string | null; name: string; action: GuideText };
  fields: GuideField[];
  /** Where the source record or paper is, and whom to ask if it is missing: a desk from the hand-over map, or the
   * record's own keepers as the form names them. Never a guessed person. */
  sources: { what: GuideText; askDesk: OrgDesk | null; askDeskName: string }[];
  /** Required: what is keyed once here and reused, and what must not be keyed again. */
  enteredOnce: GuideText;
  /** Which other desks get it automatically (hand-over map), when any. */
  feeds: { desk: string; kind: 'todo' | 'info' }[];
  steps: { save: GuideText; review: GuideText; returned: GuideText; done: GuideText; recover: GuideText };
  notVerified: GuideText[];
}

/** A card a department registers. `allowed` must call the same permission rule the server uses for the action. */
export interface GuideCardSpec extends Omit<GuideCardView, 'version' | 'feeds' | 'fields' | 'sources'> {
  allowed: (user: User) => boolean;
  recordKind?: RecordKind;
  fields?: GuideField[];
  sources: { what: GuideText; askDesk: OrgDesk | null; askName?: string }[];
  /** Audit actions this task writes, to look up who it feeds in the hand-over map. */
  actions?: string[];
}

const registered = new Map<string, GuideCardSpec>();

/** Add a department's cards. An id is registered once; a different card under the same id is refused. */
export function registerGuideCards(cards: GuideCardSpec[]): void {
  for (const c of cards) {
    const had = registered.get(c.id);
    if (had && had !== c) throw new Error(`Guide card ${c.id} is already registered.`);
    registered.set(c.id, c);
  }
}

// ---------- Field help, from the form itself ----------

function fieldFormat(f: FieldSpec): GuideText {
  switch (f.type) {
    case 'date':
      return t('Tarikh: hh/bb/tttt atau tttt-bb-hh; mesti tarikh sebenar dalam kalendar.', 'Date: dd/mm/yyyy or yyyy-mm-dd; must be a real calendar date.');
    case 'number':
      return t(
        `Nombor${f.min !== undefined ? `, sekurang-kurangnya ${f.min}` : ''}${f.max !== undefined ? `, paling banyak ${f.max}` : ''}.`,
        `Number${f.min !== undefined ? `, at least ${f.min}` : ''}${f.max !== undefined ? `, at most ${f.max}` : ''}.`,
      );
    case 'select':
      return t('Pilih satu daripada senarai.', 'Choose one from the list.');
    case 'bool':
      return t('Ya atau tidak.', 'Yes or no.');
    case 'ref':
      return t('Pilih rekod yang sudah ada (bukan taip baharu).', 'Pick an existing record (do not type a new one).');
    case 'textarea':
      return t('Teks, paling banyak 1,000 aksara.', 'Text, at most 1,000 characters.');
    default:
      return t('Teks, paling banyak 160 aksara.', 'Text, at most 160 characters.');
  }
}

function fieldExample(f: FieldSpec): string {
  switch (f.type) {
    case 'date':
      return '31/01/2027';
    case 'number':
      return String(f.min ?? 1);
    case 'select':
      return f.options?.[0]?.[1] ?? '';
    case 'bool':
      return 'ya / yes';
    case 'ref':
      return '(pilih / pick)';
    default:
      return f.restricted ? '(contoh tidak ditunjuk / no example shown)' : 'CONTOH-001 / EXAMPLE-001';
  }
}

export function guideFieldsOf(kind: RecordKind): GuideField[] {
  return RECORD_KINDS[kind].fields.map((f) => ({
    key: f.key,
    label: f.label,
    required: !!f.required,
    format: fieldFormat(f),
    example: fieldExample(f),
    ...(f.type === 'select' ? { choices: (f.options ?? []).map(([, l]) => l) } : {}),
    ...(SERVER_FIELD_RULES[kind]?.[f.key] ? { rule: SERVER_FIELD_RULES[kind]![f.key] } : {}),
  }));
}

function feedsOf(actions: string[]): { desk: string; kind: 'todo' | 'info' }[] {
  const out: { desk: string; kind: 'todo' | 'info' }[] = [];
  for (const f of ORG_FLOWS)
    if (f.actions.some((a) => actions.some((x) => (a.endsWith('.') ? x.startsWith(a) : x === a))))
      for (const target of f.targets) if (!out.some((o) => o.desk === ORG_DESK_LABEL[target.desk])) out.push({ desk: ORG_DESK_LABEL[target.desk], kind: target.kind });
  return out;
}

// ---------- Cards for every plain record form (one engine, so one card shape) ----------

function recordCard(kind: RecordKind): GuideCardSpec {
  const spec = RECORD_KINDS[kind];
  const importable = IMPORTABLE_KINDS.includes(kind);
  return {
    id: `record.${kind}`,
    status: kind === 'company' ? 'partial' : 'ready',
    dept: spec.keptBy,
    title: t(`Tambah atau ubah: ${spec.label}`, `Add or edit: ${spec.label}`),
    purpose: t(`Simpan ${spec.label.toLowerCase()} sekali, dalam satu tempat.`, `Keep the ${spec.label.toLowerCase()} once, in one place.`),
    who: t(`Disimpan oleh: ${spec.keptBy}. Butang Tambah hanya muncul untuk mereka.`, `Kept by: ${spec.keptBy}. The Add button shows only for them.`),
    screen: { view: null, name: spec.screen, action: t('Tekan Tambah (atau Ubah pada rekod sedia ada).', 'Press Add (or Edit on an existing record).') },
    allowed: () => true, // replaced by the server's own recordKindsFor() in guideCardsFor
    recordKind: kind,
    sources: [
      {
        what: t(
          `Dokumen atau senarai asal ${spec.label.toLowerCase()} yang dipegang oleh ${spec.keptBy}.`,
          `The original paper or list for the ${spec.label.toLowerCase()} held by ${spec.keptBy}.`,
        ),
        askDesk: null,
        askName: spec.keptBy,
      },
    ],
    enteredOnce: t(
      `Kunci sekali di sini. Jika rekod sudah ada, guna Ubah, jangan Tambah semula.${importable ? ' Rekod lama yang banyak: Serahan, Import (semakan yang sama).' : ''}`,
      `Key it once here. If the record already exists, use Edit, never Add again.${importable ? ' Many existing records at once: Hand-overs, Import (the same checks).' : ''}`,
    ),
    actions: [`record.add.${kind}`],
    steps: {
      save: t('Tekan Simpan. Semakan yang sama berlaku di pelayan; jika salah, sebabnya ditunjuk dan tiada apa disimpan.', 'Press Save. The server runs the same checks; if something is wrong it shows why and saves nothing.'),
      review: spec.note
        ? t(`Simpanan direkod dalam log audit. Sebarang langkah semakan dinyatakan dalam nota borang: "${spec.note}"`, `The save is written to the audit log. Any check step is stated in the form's note: "${spec.note}"`)
        : t('Borang ini tiada langkah penyemak; simpanan direkod dalam log audit.', 'This form has no reviewer step; the save is written to the audit log.'),
      returned: spec.note
        ? t('Jika langkah semakan memulangkannya, atau untuk membetulkan, buka rekod dan tekan Ubah (perubahan diaudit).', 'If a check step returns it, or to correct it, open the record and press Edit (the change is audited).')
        : t('Tiada pemulangan pada borang ini. Untuk betulkan, buka rekod dan tekan Ubah (perubahan diaudit).', 'Nothing is returned on this form. To correct it, open the record and press Edit (the change is audited).'),
      done: t('Selesai apabila rekod muncul dalam senarai skrin itu.', 'Done when the record shows in that screen\'s list.'),
      recover: t('Jika Simpan gagal, baca sebabnya, betulkan medan itu dan simpan semula. Jangan minta orang lain simpan bagi pihak anda.', 'If Save fails, read the reason, fix that field and save again. Do not ask someone else to save it for you.'),
    },
    notVerified:
      kind === 'company'
        ? [t('Rekod induk syarikat ada semakan SSM sendiri; ikut skrin itu.', 'The company master record has its own SSM verification; follow that screen.')]
        : [],
  };
}

// ---------- Cards for this layer's own tasks ----------

const HANDOVER_CARDS: GuideCardSpec[] = [
  {
    id: 'org.handover.close',
    status: 'ready',
    dept: 'All departments',
    title: t('Selesaikan serahan dari jabatan lain', 'Finish a hand-over from another department'),
    purpose: t('Apa yang jabatan lain sudah kunci dan anda perlu buat atau tahu.', 'What another department already keyed that you must act on or know.'),
    who: t('Hanya penerima yang dinamakan pada serahan itu.', 'Only the receivers named on that hand-over.'),
    screen: { view: 'handovers', name: 'Hand-overs', action: t('Serahan saya: buka rekod, kemudian Selesai atau Tidak perlu.', 'My hand-overs: open the record, then Done or Not needed.') },
    allowed: (u) => !u.integration,
    sources: [{ what: t('Rekod asal, melalui butang Buka pada serahan.', 'The original record, through the Open button on the hand-over.'), askDesk: 'company_office' }],
    enteredOnce: t('Butirannya sudah dikunci oleh jabatan asal. Jangan taip semula; buka rekod itu.', 'The details were keyed by the sending department. Do not type them again; open that record.'),
    actions: [],
    steps: {
      save: t('Tulis apa yang dibuat (rujukan membantu), kemudian Selesai. Serahan penyertaan IT ditutup dari permohonan penyertaan HR/IT, bukan dari nota.', 'Write what was done (a reference helps), then Done. IT\'s joining hand-over closes from the HR/IT joining request, not from a note.'),
      review: t('Tiada penyemak; ACT dan pimpinan kumpulan melihat yang lewat.', 'No reviewer; ACT and group leadership see what is late.'),
      returned: t('Jika bukan untuk anda, tekan Tidak perlu dengan sebab.', 'If it is not for you, press Not needed with the reason.'),
      done: t('Ditutup sekali, atas nama anda.', 'Closed once, under your name.'),
      recover: t('Jika butang Buka tiada, anda tiada akses ke syarikat itu: minta pejabat syarikat.', 'If there is no Open button, you have no access to that company: ask its company office.'),
    },
    notVerified: [t('Notis emel dan Teams belum disambung; hanya dalam aplikasi.', 'Email and Teams notices are not connected; in-app only.')],
  },
  {
    id: 'org.import',
    status: 'ready',
    dept: 'All departments',
    title: t('Import rekod sedia ada dari hamparan', 'Import existing records from a spreadsheet'),
    purpose: t('Masukkan rekod lama sekali gus, dengan semakan yang sama seperti borang.', 'Load existing records at once, with the same checks as the form.'),
    who: t('Sesiapa yang boleh menambah jenis rekod itu.', 'Anyone who may add that kind of record.'),
    screen: { view: 'handovers', name: 'Hand-overs', action: t('Import: pilih jenis, lampirkan CSV, Semak fail, kemudian Import.', 'Import: choose the kind, attach the CSV, Check the file, then Import.') },
    allowed: (u) => !u.integration,
    sources: [{ what: t('Hamparan sedia ada jabatan anda, disimpan sebagai CSV.', 'Your department\'s existing spreadsheet, saved as CSV.'), askDesk: null, askName: 'The people who keep that kind of record (shown on the Import tab)' }],
    enteredOnce: t('Fail yang sama tidak boleh diimport dua kali. Rekod yang diimport tidak menghantar serahan.', 'The same file can never be imported twice. Imported records send no hand-overs.'),
    actions: [],
    steps: {
      save: t('Semak fail dahulu: tiada apa disimpan. Import hanya jika semua baris betul.', 'Check the file first: nothing is kept. Import only when every row is right.'),
      review: t('Tiada penyemak; import direkod dalam log audit dengan resit.', 'No reviewer; the import is audited with a receipt.'),
      returned: t('Baris yang salah ditunjuk dengan sebab; betulkan dalam hamparan dan semak semula.', 'Wrong rows are shown with the reason; fix them in the spreadsheet and check again.'),
      done: t('Semua baris atau tiada langsung.', 'All rows or none.'),
      recover: t('Jika diberitahu sudah diimport, semak senarai dahulu; jangan ubah fail untuk mengelak semakan.', 'If told it was already imported, check the list first; do not change the file to get round the check.'),
    },
    notVerified: [],
  },
];

// ---------- Reading ----------

function view(c: GuideCardSpec): GuideCardView {
  const { allowed: _a, recordKind, actions, ...rest } = c;
  return {
    ...rest,
    version: GUIDE_VERSION,
    fields: c.fields ?? (recordKind ? guideFieldsOf(recordKind) : []),
    sources: c.sources.map(({ askName, ...s }) => ({ ...s, askDeskName: s.askDesk ? ORG_DESK_LABEL[s.askDesk] : (askName ?? '') })),
    feeds: feedsOf(actions ?? []),
  };
}

/** Every card, unfiltered: for the checks in tests and the developer map only, never for a person. */
export function allGuideCards(): GuideCardView[] {
  return [...(Object.keys(RECORD_KINDS) as RecordKind[]).map(recordCard), ...HANDOVER_CARDS, ...registered.values()].map(view);
}

/**
 * The cards this person may use, from the server's own permission rules. The screen and Arisha both call this, so
 * neither ever describes a task the person cannot do, or another role's records. `recordKinds` is the server's
 * recordKindsFor(user).
 */
export function guideCardsFor(
  user: User,
  recordKinds: RecordKind[],
  env: { handovers: boolean } = { handovers: false },
): { version: string; handovers: 'on' | 'off'; cards: GuideCardView[] } {
  if (user.integration) return { version: GUIDE_VERSION, handovers: env.handovers ? 'on' : 'off', cards: [] };
  const mine = new Set(recordKinds);
  // Import only for someone who may add at least one importable kind; otherwise the card would promise a task the
  // server refuses.
  const imports = IMPORTABLE_KINDS.some((k) => mine.has(k as RecordKind));
  const handovers = HANDOVER_CARDS.filter((c) => c.allowed(user) && (c.id !== 'org.import' || imports)).map((c) =>
    env.handovers
      ? c
      : {
          ...c,
          status: 'off' as const,
          notVerified: [
            t('Serahan dan import dimatikan di sini sehingga pemilik keluaran menghidupkannya; tiada apa sampai lagi.', 'Hand-overs and import are switched off here until the release owner turns them on; nothing arrives yet.'),
            ...c.notVerified,
          ],
        },
  );
  const cards = [
    ...(Object.keys(RECORD_KINDS) as RecordKind[]).filter((k) => mine.has(k)).map(recordCard),
    ...handovers,
    ...[...registered.values()].filter((c) => c.allowed(user)),
  ];
  const views = cards.map(view);
  // With hand-overs off nothing is sent to another desk, so no card may say it is (review of PR #56 at 9092c89).
  if (!env.handovers)
    for (const v of views)
      if (v.feeds.length) {
        v.feeds = [];
        v.notVerified = [
          t('Serahan dimatikan di sini: jabatan lain belum diberitahu secara automatik. Beritahu mereka seperti biasa.', 'Hand-overs are switched off here: other departments are not told automatically yet. Tell them as you do today.'),
          ...v.notVerified,
        ];
      }
  return { version: GUIDE_VERSION, handovers: env.handovers ? 'on' : 'off', cards: views };
}

/**
 * What Arisha reads: the same cards, from the same call, cut to the words she needs. Ids, version and order are those
 * of guideCardsFor for this person, so Arisha can never describe a task the screen does not show them.
 */
export function arishaGuideView(g: ReturnType<typeof guideCardsFor>, cardId?: string) {
  const cards = cardId ? g.cards.filter((c) => c.id === cardId) : g.cards;
  return {
    version: g.version,
    handovers: g.handovers,
    cards: cards.map((c) => ({
      id: c.id,
      status: c.status,
      title: c.title,
      who: c.who,
      screen: { view: c.screen.view, name: c.screen.name, action: c.screen.action },
      enteredOnce: c.enteredOnce,
      steps: c.steps,
      fields: c.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, format: f.format, rule: f.rule ?? null })),
      notVerified: c.notVerified,
    })),
  };
}

/** Problems with a card, for tests: missing language, missing "entered once", invented fields. Names only. */
export function guideCardProblems(c: GuideCardView): string[] {
  const out: string[] = [];
  const texts: [string, GuideText][] = [
    ['title', c.title],
    ['purpose', c.purpose],
    ['who', c.who],
    ['action', c.screen.action],
    ['enteredOnce', c.enteredOnce],
    ...Object.entries(c.steps),
    ...c.sources.map((s, i) => [`source${i}`, s.what] as [string, GuideText]),
    ...c.notVerified.map((n, i) => [`notVerified${i}`, n] as [string, GuideText]),
  ];
  for (const [k, v] of texts) if (!v?.bm?.trim() || !v?.en?.trim()) out.push(`${c.id}: ${k} needs both BM and English`);
  if ((c.enteredOnce.en ?? '').length < 20) out.push(`${c.id}: say what is entered once and reused`);
  if (!c.sources.length) out.push(`${c.id}: name where the source is and whom to ask`);
  for (const s of c.sources) {
    if (s.askDesk !== null && !(s.askDesk in ORG_DESK_LABEL)) out.push(`${c.id}: unknown desk ${s.askDesk}`);
    if (!s.askDeskName.trim()) out.push(`${c.id}: say whom to ask`);
  }
  if (c.id.startsWith('record.')) {
    const kind = c.id.slice('record.'.length) as RecordKind;
    const real = new Set(RECORD_KINDS[kind]?.fields.map((f) => f.key) ?? []);
    for (const f of c.fields) if (!real.has(f.key)) out.push(`${c.id}: field ${f.key} is not on the form`);
  }
  return out;
}
