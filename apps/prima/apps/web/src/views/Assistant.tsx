import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  BriefcaseIcon,
  BugIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CarIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  ClipboardTextIcon,
  ClockIcon,
  CoinsIcon,
  DesktopIcon,
  FileTextIcon,
  GasPumpIcon,
  HandshakeIcon,
  HardDrivesIcon,
  LifebuoyIcon,
  ListChecksIcon,
  LockIcon,
  NotebookIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  ReceiptIcon,
  ScalesIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SirenIcon,
  TShirtIcon,
  TimerIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WalletIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { api } from '../api';
import { useApp, type ViewName } from '../App';
import { useLang } from '../i18n';
import { Empty, PageHead, Search } from '../kit';
import { useFold } from '../fold';
import { Chip, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import '../styles/fold.css';
import '../styles/assistant.css';

/**
 * Prima helper (Fauzan, 23 Nov 2026: "Make sure ai agent can help with everything ... What prima app give permission
 * for the person or department can do, agent can help it do"). The person says what they need in their own words; the
 * helper fills the form with fixed rules from Prima's own lists, the team's skills and the person's own style. The
 * person checks it and presses Send, which runs the same action as the job's own screen, as them. Nothing is sent by
 * itself, and nothing is approved, signed or paid here.
 *
 * P129 (Fitri, 24 Nov 2026: "what is helper? what does it do? the UI is not enhanced and looks shabby"): the same
 * behaviour, API calls and permissions, laid out as Say it, Check it, Send it: a page head that says what it does, a
 * large composer with example requests from the person's own jobs, the filled form as one card with each value's origin,
 * the jobs it can fill as a searchable grid by kind, and skills and style folded away. New English text is translated
 * by the page translator (i18n.ts); the text that was already written in both languages stays so.
 */
type Home = Awaited<ReturnType<typeof api.assistantHome>>;
type Understood = Awaited<ReturnType<typeof api.assistantUnderstand>>;
type Action = Home['actions'][number];
type Field = Action['fields'][number];
type Line = { stockItemId: string; qty: number };
type Where = 'compose' | 'draft' | 'done' | 'skills';

/** An icon for each job the helper fills; a new job gets the plain form icon until one is chosen here. */
const JOB_ICON: Record<string, typeof FileTextIcon> = {
  'site-supplies': PackageIcon,
  leave: CalendarBlankIcon,
  'it-help': DesktopIcon,
  problem: BugIcon,
  'time-slip': ClockIcon,
  'ot-claim': TimerIcon,
  meeting: UsersThreeIcon,
  'help-ask': LifebuoyIcon,
  'my-task': NotebookIcon,
  'staff-claim': ReceiptIcon,
  'office-request': BuildingsIcon,
  'client-request': HandshakeIcon,
  vacancy: UserPlusIcon,
  'payment-request': CoinsIcon,
  'police-help': SirenIcon,
  'leave-for': CalendarBlankIcon,
  'case-report': WarningIcon,
  'uniform-guard': TShirtIcon,
  'purchase-request': ShoppingCartIcon,
  'fwm-task': BriefcaseIcon,
  'vehicle-request': CarIcon,
  fuel: GasPumpIcon,
  'rent-payment': WalletIcon,
  'act-finding': ClipboardTextIcon,
  'it-purchase': HardDrivesIcon,
  'pdpa-request': LockIcon,
  'legal-matter': ScalesIcon,
};

/** The jobs by kind, for the grid. A job not listed here falls under "Other jobs". */
const GROUPS: { key: string; title: string; ids: string[] }[] = [
  { key: 'mine', title: 'For yourself', ids: ['leave', 'it-help', 'problem', 'time-slip', 'ot-claim', 'staff-claim', 'help-ask', 'my-task', 'meeting', 'vehicle-request'] },
  { key: 'ops', title: 'Sites, guards and clients', ids: ['site-supplies', 'leave-for', 'case-report', 'uniform-guard', 'police-help', 'client-request'] },
  { key: 'money', title: 'Office, money and buying', ids: ['office-request', 'payment-request', 'purchase-request', 'it-purchase', 'rent-payment', 'fuel'] },
  { key: 'people', title: 'People, legal and audit', ids: ['vacancy', 'fwm-task', 'act-finding', 'pdpa-request', 'legal-matter'] },
];

/** A made-up request for each job, in the person's language, to show how to ask. Never real names or records. */
const EXAMPLES: Record<string, { bm: string; en: string }> = {
  'site-supplies': { bm: 'OGM minta 20 seluar saiz 32 untuk tapak baharu', en: 'OGM asks for 20 trousers size 32 for the new site' },
  leave: { bm: 'Cuti tahunan esok, urusan keluarga', en: 'Annual leave tomorrow, family matter' },
  'it-help': { bm: 'Laptop saya rosak, segera', en: 'My laptop is broken, urgent' },
  problem: { bm: 'Skrin kehadiran tidak terbuka di telefon saya', en: 'The attendance screen does not open on my phone' },
  'time-slip': { bm: 'Slip masa esok 3pm hingga 5pm, temujanji klinik', en: 'Time slip tomorrow 3pm to 5pm, clinic appointment' },
  'ot-claim': { bm: 'Tuntutan lebih masa 3 jam semalam untuk kiraan stok', en: 'Overtime claim 3 hours yesterday for the stock count' },
  meeting: { bm: 'Mesyuarat esok 10 pagi tentang jadual tugas baharu', en: 'Set up a meeting tomorrow 10am about the new roster' },
  'help-ask': { bm: 'Minta bantuan pengurus untuk laporan hujung bulan', en: 'Ask my manager for help with the month-end report' },
  'my-task': { bm: 'Tambah tugasan saya: kemas kini fail tapak esok', en: 'Add a task for myself: update the site file tomorrow' },
  'staff-claim': { bm: 'Tuntutan perubatan RM 80, ke klinik semalam', en: 'Medical claim RM 80, clinic visit yesterday' },
  'office-request': { bm: 'Bil elektrik pejabat November RM 420', en: 'Office electricity bill for November RM 420' },
  'client-request': { bm: 'Klien minta tambah 2 pengawal di pintu utama', en: 'The client asks for 2 more guards at the main gate' },
  vacancy: { bm: 'Kekosongan kerani pentadbiran, 1 orang', en: 'Vacancy for an admin clerk, 1 person' },
  'payment-request': { bm: 'Permohonan bayaran RM 1200 untuk baiki pencetak', en: 'Payment request RM 1200 for the printer repair' },
  'police-help': { bm: 'Minta polis datang ke tapak malam ini selepas kes pecah masuk', en: 'Ask the police to visit the site tonight after a break-in' },
  'leave-for': { bm: 'Masukkan cuti tahunan untuk pengawal esok hingga lusa', en: 'Annual leave for a guard from tomorrow to the day after' },
  'case-report': { bm: 'Lapor insiden: palang pintu pagar rosak hari ini', en: 'Report an incident: the gate barrier was damaged today' },
  'uniform-guard': { bm: 'Seragam untuk pengawal: 2 baju saiz L', en: 'Uniform for a guard: 2 shirts size L' },
  'purchase-request': { bm: 'Permohonan pembelian 5 kotak kertas A4', en: 'Purchase request for 5 boxes of A4 paper' },
  'fwm-task': { bm: 'Tugasan pekerja asing: perbaharui permit minggu depan', en: 'Foreign worker task: renew the permit next week' },
  'vehicle-request': { bm: 'Perlu kereta esok 9 pagi untuk lawatan tapak', en: 'I need a car tomorrow 9am for a site visit' },
  fuel: { bm: 'Isi minyak 40 liter RM 82 hari ini', en: 'Fuel fill-up 40 litres RM 82 today' },
  'rent-payment': { bm: 'Bayaran sewa diterima RM 900 hari ini', en: 'Rent payment received RM 900 today' },
  'act-finding': { bm: 'Penemuan audit: buku log pelawat tidak ditandatangani', en: 'Audit finding: the visitor log was not signed' },
  'it-purchase': { bm: 'Pembelian IT: 2 laptop baharu untuk pejabat', en: 'IT purchase: 2 new laptops for the office' },
  'pdpa-request': { bm: 'Permohonan PDPA: bekas staf minta salinan data mereka', en: 'PDPA request: a former staff member asks for a copy of their data' },
  'legal-matter': { bm: 'Perkara undang-undang: surat tuntutan daripada pembekal', en: 'Legal matter: a letter of demand from a supplier' },
};

const MAX_TEXT = 1500;
const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'number' && Number.isNaN(v));
/** Fields that take the whole width of the form: long text, item lines, files and a tick box. */
const WIDE = new Set(['longtext', 'items', 'proof', 'bool']);

export function AssistantView() {
  const { lang } = useLang();
  const en = lang === 'en';
  const { go } = useApp();
  const { data: home, error, reload } = useLoad(() => api.assistantHome(), []);
  const [text, setText] = useState('');
  const [u, setU] = useState<Understood | null>(null);
  const [actionId, setActionId] = useState<string>('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState<{ actionId: string; ref: string; view: string; values: Record<string, unknown> } | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillWords, setSkillWords] = useState('');
  const [skillScope, setSkillScope] = useState('me');
  // P129: a job chosen from the grid before anything is typed; the next "Fill the form" fills that job's form.
  const [picked, setPicked] = useState('');
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState<Where>('compose');
  const [checked, setChecked] = useState<'ok' | 'missing' | null>(null);
  const [skillsOpen, toggleSkills] = useFold('assistant.skills', false);
  const [jobsOpen, toggleJobs] = useFold('assistant.jobs', true);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<HTMLElement>(null);
  const jobsHead = useId();
  const skillsHead = useId();
  const act = useAction();
  const L = (x: { bm: string; en: string }) => (en ? x.en : x.bm);

  const actions = home?.actions ?? [];
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (a: Action) => !q || `${a.label.en} ${a.label.bm} ${a.words.join(' ')}`.toLowerCase().includes(q);
    const known = new Set(GROUPS.flatMap((g) => g.ids));
    const all = [...GROUPS, { key: 'other', title: 'Other jobs', ids: actions.filter((a) => !known.has(a.id)).map((a) => a.id) }];
    return all
      .map((g) => ({ ...g, items: actions.filter((a) => g.ids.includes(a.id) && hit(a)).sort((a, b) => g.ids.indexOf(a.id) - g.ids.indexOf(b.id)) }))
      .filter((g) => g.items.length > 0);
  }, [actions, query]);

  if (error) return <ErrorNotice error={error} />;
  if (!home) return <Loading what="helper" />;
  const action = home.actions.find((a) => a.id === actionId) ?? null;
  const pickedAction = home.actions.find((a) => a.id === picked) ?? null;
  const lists = u?.lists ?? {};
  const origin = (name: string) => u?.draft.origins[name as keyof typeof u.draft.origins];
  const nameOf = (list: { id: string; name: string }[] | undefined, id: unknown) => list?.find((x) => x.id === id)?.name ?? '';
  const examples = home.actions.filter((a) => EXAMPLES[a.id]).slice(0, 4).map((a) => ({ id: a.id, text: L(EXAMPLES[a.id]) }));
  const stage = done ? 3 : u ? 1 : 0;
  const focusAsk = () => requestAnimationFrame(() => askRef.current?.focus());

  const fill = async (chosen?: string, from: Where = 'compose') => {
    setDone(null);
    setChecked(null);
    setWhere(from);
    const r = await act.run(() => api.assistantUnderstand({ text, actionId: chosen || null, lang }));
    if (!r) return;
    setU(r);
    setActionId(r.draft.actionId ?? '');
    setValues({ ...r.draft.values });
    setPicked('');
    if (from === 'compose') requestAnimationFrame(() => draftRef.current?.scrollIntoView({ block: 'nearest' }));
  };
  const send = async () => {
    if (!action) return;
    setWhere('draft');
    const labels: Record<string, string> = {};
    for (const x of [...(lists.sites ?? []), ...(lists.receivers ?? []), ...(lists.items ?? []), ...Object.values(lists.pick ?? {}).flat()]) labels[x.id] = x.name;
    const r = await act.run(() => api.assistantAct('send', { actionId: action.id, values, text, draft: u?.draft, labels }), en ? 'Sent' : 'Dihantar');
    if (r) {
      setDone({ actionId: action.id, ref: r.ref ?? '', view: r.view, values });
      setU(null);
      setText('');
      setChecked(null);
      setWhere('done');
      reload();
    }
  };
  const startAgain = () => {
    setText('');
    setU(null);
    setActionId('');
    setValues({});
    setDone(null);
    setPicked('');
    setChecked(null);
    act.clearError();
    focusAsk();
  };
  // A job card: with words already typed, fill that job's form now; otherwise remember it and ask for the words.
  const pickJob = (id: string) => {
    if (text.trim().length >= 3) {
      void fill(id);
      return;
    }
    setPicked(id);
    askRef.current?.scrollIntoView({ block: 'center' });
    focusAsk();
  };
  const onAskKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !act.busy && text.trim().length >= 3) {
      e.preventDefault();
      void fill(picked || undefined);
    }
  };
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  // A list can depend on a choice (the company's staff, the vehicle's cards): read the lists again, as the person.
  const choose = async (k: string, v: unknown) => {
    const next = { ...values, [k]: v };
    setValues(next);
    if (!action || !u || !action.fields.some((f) => f.type === 'pick')) return;
    const l = await api.assistantLists({ actionId: action.id, values: next }).catch(() => null);
    if (l) setU((x) => (x ? { ...x, lists: { ...x.lists, ...l } } : x));
  };
  const emptyRequired = action ? action.fields.filter((f) => f.required && isEmpty(values[f.name])) : [];
  // Check: a look over the form on this device before Send. The server still checks everything when Send is pressed.
  const check = () => {
    const first = emptyRequired[0];
    setChecked(first ? 'missing' : 'ok');
    if (first) {
      const el = document.getElementById(`as-${first.name}`);
      el?.scrollIntoView({ block: 'center' });
      if (el && 'focus' in el) (el as HTMLElement).focus();
    }
  };
  const originChip = (name: string) => {
    const o = origin(name);
    if (!o) return null;
    const [tone, label]: [Tone, string] =
      o === 'said'
        ? ['ok', en ? 'From your words' : 'Daripada kata anda']
        : o === 'skill'
          ? ['info', en ? 'From the skill' : 'Daripada kemahiran']
          : o === 'usual'
            ? ['neutral', en ? 'Your usual' : 'Kebiasaan anda']
            : o === 'default'
              ? ['warn', en ? 'The only one, check' : 'Satu-satunya, semak']
              : ['ok', en ? 'From your text' : 'Daripada teks anda'];
    return (
      <span className="as-origin">
        <Chip tone={tone}>{label}</Chip>
      </span>
    );
  };

  const input = (f: Field) => {
    const v = values[f.name];
    const id = `as-${f.name}`;
    const common = { id, 'aria-label': L(f.label) };
    switch (f.type) {
      case 'site':
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">{en ? 'Choose' : 'Pilih'}</option>
            {(lists.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        );
      case 'receiver':
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">{(lists.receivers ?? []).length ? (en ? 'Choose' : 'Pilih') : en ? 'Not needed (you are the OM) or choose the site first' : 'Tidak perlu (anda OM) atau pilih tapak dahulu'}</option>
            {(lists.receivers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        );
      case 'choice':
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => choose(f.name, e.target.value)}>
            <option value="">{en ? 'Choose' : 'Pilih'}</option>
            {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case 'pick': {
        const list = (f.list && lists.pick?.[f.list]) || [];
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => choose(f.name, e.target.value || undefined)}>
            <option value="">{list.length ? (en ? 'Choose' : 'Pilih') : en ? 'Nothing to choose yet (choose the box above first)' : 'Tiada pilihan lagi (pilih kotak di atas dahulu)'}</option>
            {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        );
      }
      case 'proof':
        return (
          <div id={id} aria-label={L(f.label)} tabIndex={-1} className="as-proof">
            <ProofPicker site={null} refText={action?.label.en ?? 'helper'} items={(Array.isArray(v) ? v : []) as never} onChange={(items) => set(f.name, items)} documentsOnly={f.documentsOnly} required={f.required} />
          </div>
        );
      case 'month':
        return <input {...common} className="input" type="month" value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />;
      case 'bool':
        return <input {...common} type="checkbox" checked={v === true} onChange={(e) => set(f.name, e.target.checked)} />;
      case 'longtext':
        return <textarea {...common} className="input" rows={3} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />;
      case 'items': {
        const lines = (Array.isArray(v) ? v : []) as Line[];
        const put = (n: Line[]) => set(f.name, n);
        return (
          <div className="as-lines" id={id} tabIndex={-1}>
            {lines.map((l, i) => (
              <div key={i} className="as-line">
                <span className="as-line-n" aria-hidden="true">{i + 1}</span>
                <select className="select as-line-item" aria-label={`${en ? 'Item' : 'Barang'} ${i + 1}`} value={l.stockItemId} onChange={(e) => put(lines.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}>
                  {(lists.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className="input as-line-qty" type="number" min={1} aria-label={`${en ? 'Quantity' : 'Kuantiti'} ${i + 1}`} value={l.qty} onChange={(e) => put(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
                <button type="button" className="btn btn-ghost btn-sm as-line-x" onClick={() => put(lines.filter((_, j) => j !== i))}>
                  <XIcon size={14} weight="bold" aria-hidden="true" />
                  {en ? 'Remove' : 'Buang'}
                </button>
              </div>
            ))}
            {(lists.items ?? []).length > 0 && (
              <button type="button" className="btn btn-sm as-line-add" onClick={() => put([...lines, { stockItemId: lists.items![0].id, qty: 1 }])}>
                {en ? 'Add an item' : 'Tambah barang'}
              </button>
            )}
            {!(lists.items ?? []).length && <span className="muted small">{en ? 'Choose the site first; its store list appears here.' : 'Pilih tapak dahulu; senarai stor dipaparkan di sini.'}</span>}
          </div>
        );
      }
      default:
        return <input {...common} className="input" type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'number' ? 'number' : 'text'} value={String(v ?? '')} onChange={(e) => set(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)} />;
    }
  };

  const steps = [
    { title: 'Say it', note: 'Type what you need in your own words, in Malay or English.', icon: ChatCircleTextIcon },
    { title: 'Check it', note: "The helper fills the form from Prima's own lists. Each box shows where its value came from.", icon: ListChecksIcon },
    { title: 'Send it', note: "Press Send. It goes through the job's own screen, as you.", icon: PaperPlaneTiltIcon },
  ];

  return (
    <div className="page as-page">
      <PageHead
        title={en ? 'Prima helper' : 'Pembantu Prima'}
        sub="Tell it what you need in your own words. It fills in the right form for you from Prima's own lists, and you check it before you press Send."
      />

      <section className="as-how" aria-label="How it works">
        <ol className="as-how-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="as-how-step" data-state={i < stage ? 'done' : i === stage ? 'now' : 'todo'}>
              <span className="as-how-icon" aria-hidden="true">
                {i < stage ? <CheckCircleIcon size={20} weight="fill" /> : <s.icon size={20} weight="duotone" />}
              </span>
              <span className="as-how-text">
                <span className="as-how-title">
                  <span className="as-how-n" aria-hidden="true">{i + 1}</span>
                  <span>{s.title}</span>
                </span>
                <span className="as-how-note">{s.note}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="as-safe">
          <ShieldCheckIcon size={18} weight="fill" aria-hidden="true" />
          <span>Nothing is sent by itself. Nothing is approved, signed or paid here.</span>
        </p>
      </section>

      <section className="as-composer">
        <label className="as-ask-label" htmlFor="as-text">
          {en ? 'What do you need?' : 'Apa yang anda perlukan?'}
        </label>
        {pickedAction && (
          <div className="as-picked">
            <span className="as-picked-label">Job:</span>
            <Chip tone="info">{L(pickedAction.label)}</Chip>
            <button type="button" className="as-picked-x" aria-label="Clear the job" title="Clear the job" onClick={() => setPicked('')}>
              <XIcon size={14} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}
        <textarea
          id="as-text"
          ref={askRef}
          className="input as-ask"
          rows={4}
          maxLength={MAX_TEXT}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onAskKey}
          placeholder={pickedAction && EXAMPLES[pickedAction.id] ? L(EXAMPLES[pickedAction.id]) : en ? 'e.g. OGM asks for 20 trousers size 32 for the new site at ...' : 'cth. OGM minta 20 seluar saiz 32 untuk tapak baharu di ...'}
        />
        <div className="as-ask-meta">
          <span className="as-ask-key">Ctrl + Enter to fill</span>
          <span className="as-ask-count" data-near={text.length > MAX_TEXT - 100 || undefined}>
            {text.length} / {MAX_TEXT}
          </span>
        </div>
        {examples.length > 0 && !u && (
          <div className="as-examples">
            <span className="as-examples-label">Try one of these:</span>
            <div className="as-examples-list">
              {examples.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className="as-example"
                  onClick={() => {
                    setText(x.text);
                    focusAsk();
                  }}
                >
                  {x.text}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="as-actions">
          <button className="btn btn-primary as-fill" disabled={act.busy || text.trim().length < 3} aria-busy={(act.busy && where === 'compose') || undefined} onClick={() => fill(picked || undefined)}>
            {act.busy && where === 'compose' ? <CircleNotchIcon className="as-spin" size={16} weight="bold" aria-hidden="true" /> : <ChatCircleTextIcon size={16} weight="bold" aria-hidden="true" />}
            {en ? 'Fill the form' : 'Isi borang'}
          </button>
          {!u && (text || done || picked) && (
            <button type="button" className="btn btn-ghost" onClick={startAgain}>
              <ArrowCounterClockwiseIcon size={16} aria-hidden="true" />
              Start again
            </button>
          )}
        </div>
        {act.busy && where === 'compose' && (
          <p className="as-busy" role="status">
            Reading your words
          </p>
        )}
        {where === 'compose' && act.error && <ErrorNotice error={act.error} />}
      </section>

      {done && (
        <section className="as-done" aria-label={en ? 'Sent' : 'Dihantar'}>
          <div className="as-done-head" role="status">
            <span className="as-done-icon" aria-hidden="true">
              <CheckCircleIcon size={28} weight="fill" />
            </span>
            <div className="as-done-text">
              <p className="as-done-title">{en ? 'Sent.' : 'Dihantar.'} {done.ref}</p>
              <p className="as-done-sub">It went through the job's own screen, as you. Follow it there.</p>
            </div>
            <button type="button" className="btn as-done-open" onClick={() => go({ view: done.view as ViewName })}>
              {en ? 'Open its screen' : 'Buka skrinnya'}
              <ArrowSquareOutIcon size={16} aria-hidden="true" />
            </button>
          </div>
          {home.installed && (
            <div className="as-teach">
              <div className="as-teach-head">
                <h3>Do this often? Save it as a skill</h3>
                <p>A skill keeps the choices (the site, the kind, who receives), never dates, amounts or items. Next time, the words you give here call it up.</p>
              </div>
              <div className="as-teach-grid">
                <label className="as-f">
                  <span className="as-f-label">{en ? 'Skill name' : 'Nama kemahiran'}</span>
                  <input className="input" aria-label={en ? 'Skill name' : 'Nama kemahiran'} placeholder={en ? 'e.g. New site start-up' : 'cth. Mula tapak baharu'} value={skillName} onChange={(e) => setSkillName(e.target.value)} />
                </label>
                <label className="as-f">
                  <span className="as-f-label">{en ? 'Words that call it up' : 'Perkataan untuk memanggilnya'}</span>
                  <input className="input" aria-label={en ? 'Words that call it up' : 'Perkataan untuk memanggilnya'} placeholder={en ? 'words, comma between' : 'perkataan, pisah dengan koma'} value={skillWords} onChange={(e) => setSkillWords(e.target.value)} />
                </label>
                <label className="as-f">
                  <span className="as-f-label">{en ? 'For whom' : 'Untuk siapa'}</span>
                  <select className="select" aria-label={en ? 'For whom' : 'Untuk siapa'} value={skillScope} onChange={(e) => setSkillScope(e.target.value)}>
                    <option value="me">{en ? 'Only me' : 'Saya sahaja'}</option>
                    {home.teams.filter((t) => t.mayPublish).map((t) => <option key={t.owner} value={t.owner}>{en ? 'My team' : 'Pasukan saya'} ({t.owner.split(':')[1]})</option>)}
                  </select>
                </label>
                <div className="as-teach-go">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={act.busy || skillName.trim().length < 3}
                    onClick={async () => {
                      setWhere('done');
                      const r = await act.run(() => api.assistantAct('skills', { scope: skillScope === 'me' ? 'me' : 'team', owner: skillScope === 'me' ? undefined : skillScope, name: skillName, words: skillWords ? skillWords.split(',') : [skillName], actionId: done.actionId, values: done.values }), en ? 'Skill saved' : 'Kemahiran disimpan');
                      if (r) {
                        setSkillName('');
                        setSkillWords('');
                        reload();
                        // Show where it went: the skills section opens with the new skill in it.
                        toggleSkills(true);
                      }
                    }}
                  >
                    {en ? 'Save skill' : 'Simpan kemahiran'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {where === 'done' && act.error && <ErrorNotice error={act.error} />}
        </section>
      )}

      {u && (
        <section ref={draftRef} className="as-draft" aria-label={en ? 'Filled form' : 'Borang diisi'}>
          <div className="as-draft-head">
            <div className="as-draft-title">
              <span className="as-eyebrow">Check it</span>
              <h2>{action ? L(action.label) : en ? 'Which job is it?' : 'Kerja yang mana?'}</h2>
              <p>
                {action
                  ? en
                    ? 'Filled by the helper. Check each box before you send.'
                    : 'Diisi oleh pembantu. Semak setiap kotak sebelum menghantar.'
                  : 'Choose the job; the helper fills its form from your words.'}
              </p>
            </div>
            {u.draft.skillId && <Chip tone="info">{en ? 'Skill used' : 'Kemahiran digunakan'}: {home.skills.find((s) => s.id === u.draft.skillId)?.name ?? ''}</Chip>}
          </div>

          <div className="as-draft-body">
            <div className="as-job-row">
              <label className="as-f">
                <span className="as-f-label">{en ? 'Job' : 'Kerja'}</span>
                <select className="select" aria-label={en ? 'Job' : 'Kerja'} value={actionId} onChange={(e) => fill(e.target.value, 'draft')}>
                  <option value="">{en ? 'Choose the job' : 'Pilih kerja'}</option>
                  {home.actions.map((a) => <option key={a.id} value={a.id}>{L(a.label)}</option>)}
                </select>
              </label>
              {u.draft.alternatives.filter((x) => x !== actionId && home.actions.some((a) => a.id === x)).length > 0 && (
                <div className="as-alts">
                  <span className="as-alts-label">It could also be:</span>
                  {u.draft.alternatives
                    .filter((x) => x !== actionId)
                    .map((x) => home.actions.find((a) => a.id === x))
                    .filter((a): a is Action => !!a)
                    .map((a) => (
                      <button key={a.id} type="button" className="as-alt" disabled={act.busy} onClick={() => fill(a.id, 'draft')}>
                        {L(a.label)}
                      </button>
                    ))}
                </div>
              )}
            </div>

            {action && (
              <div className="as-fields">
                {action.fields.map((f) =>
                  f.type === 'bool' ? (
                    <div key={f.name} className="as-field as-field-bool" data-wide>
                      <label htmlFor={`as-${f.name}`} className="as-bool">
                        {input(f)}
                        <span>{L(f.label)}</span>
                      </label>
                      {originChip(f.name)}
                    </div>
                  ) : (
                    <div key={f.name} className="as-field" data-wide={WIDE.has(f.type) || undefined} data-missing={(f.required && isEmpty(values[f.name])) || undefined}>
                      <div className="as-field-head">
                        <label htmlFor={`as-${f.name}`} className="as-f-label">
                          {L(f.label)}
                          {f.required && (
                            <span className="as-req" aria-hidden="true">
                              {' '}
                              *
                            </span>
                          )}
                        </label>
                        {originChip(f.name)}
                      </div>
                      {input(f)}
                      {f.type === 'site' && values.siteId ? <span className="as-field-note">{nameOf(lists.sites, values.siteId)}</span> : null}
                    </div>
                  ),
                )}
              </div>
            )}

            {action && u.draft.missing.length > 0 && (
              <div className="notice" data-tone="warn">
                <p>
                  {en ? 'Still to fill:' : 'Belum diisi:'} {u.draft.missing.map((m) => L(action.fields.find((f) => f.name === m)?.label ?? { bm: m, en: m })).join(', ')}
                </p>
              </div>
            )}
            {action && checked === 'ok' && emptyRequired.length === 0 && (
              <div className="notice" data-tone="ok" role="status">
                Every box that is needed is filled. Read them once more, then press Send.
              </div>
            )}
            {action && checked === 'missing' && emptyRequired.length > 0 && (
              <div className="notice" data-tone="warn" role="status">
                Some boxes that are needed are still empty. They are marked in the form.
              </div>
            )}
            {where === 'draft' && act.error && <ErrorNotice error={act.error} />}
          </div>

          {action && (
            <div className="as-draft-foot">
              <button className="btn btn-primary as-send" disabled={act.busy} onClick={send}>
                {act.busy && where === 'draft' ? <CircleNotchIcon className="as-spin" size={16} weight="bold" aria-hidden="true" /> : <PaperPlaneTiltIcon size={16} weight="bold" aria-hidden="true" />}
                {en ? 'Send' : 'Hantar'}
              </button>
              <button type="button" className="btn" disabled={act.busy} onClick={check}>
                <ListChecksIcon size={16} aria-hidden="true" />
                Check
              </button>
              {action.fields.some((f) => f.type === 'site' || f.type === 'pick') && (
                <button type="button" className="btn btn-ghost" disabled={act.busy} onClick={() => fill(action.id, 'draft')}>
                  {en ? 'Read my words again' : 'Baca semula'}
                </button>
              )}
              <span className="as-foot-gap" />
              <button type="button" className="btn btn-ghost" onClick={() => go({ view: action.view as ViewName })}>
                {en ? 'Use the full screen instead' : 'Guna skrin penuh'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={startAgain}>
                <ArrowCounterClockwiseIcon size={16} aria-hidden="true" />
                Start again
              </button>
            </div>
          )}
          {!action && (
            <div className="as-draft-foot">
              <button type="button" className="btn btn-ghost" onClick={startAgain}>
                <ArrowCounterClockwiseIcon size={16} aria-hidden="true" />
                Start again
              </button>
            </div>
          )}

          {u.guide.length > 0 && (
            <div className="as-guide">
              <h3>{en ? 'How to do it in Prima' : 'Cara membuatnya dalam Prima'}</h3>
              <div className="as-guide-list">
                {u.guide.map((g) => (
                  <article key={g.id} className="as-guide-card">
                    <div className="as-guide-head">
                      <strong>{g.title}</strong>
                      <span className="as-guide-where">
                        {g.screen}: {g.button}
                      </span>
                    </div>
                    <ol className="as-guide-steps">
                      {g.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                    {g.view && (
                      <button type="button" className="btn btn-sm" onClick={() => go({ view: g.view as ViewName })}>
                        {en ? 'Open screen' : 'Buka skrin'}
                        <ArrowSquareOutIcon size={14} aria-hidden="true" />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="fold-sec as-jobs-sec" data-open={jobsOpen || undefined} aria-labelledby={jobsHead}>
        <div className="fold-sec-head">
          <h2 className="fold-sec-title">
            <button type="button" id={jobsHead} className="fold-sec-toggle" aria-expanded={jobsOpen} onClick={() => toggleJobs()}>
              <CaretDownIcon className="fold-caret" size={16} weight="bold" aria-hidden="true" />
              <span>What it can do for you</span>
            </button>
          </h2>
          <Chip tone="neutral">{home.actions.length}</Chip>
          {!jobsOpen && <span className="fold-sec-summary">The jobs you may start here. Pick one, or just type above.</span>}
        </div>
        {jobsOpen && (
          <div className="fold-sec-body">
            {home.actions.length === 0 ? (
              <Empty title="No jobs to fill for you yet">You can still type what you need above: the helper shows where to do it in Prima.</Empty>
            ) : (
              <>
                <div className="as-jobs-bar">
                  <p className="as-jobs-intro">Pick a job, or just type what you need above. These are the jobs your role may start in Prima.</p>
                  <Search value={query} onChange={setQuery} placeholder={en ? 'Search jobs' : 'Cari kerja'} />
                </div>
                {groups.length === 0 && <Empty title="No job matches your search">Try another word, or just type what you need above.</Empty>}
                {groups.map((g) => (
                  <div key={g.key} className="as-group">
                    <h3 className="as-group-title">
                      <span>{g.title}</span>
                      <span className="as-group-n">{g.items.length}</span>
                    </h3>
                    <div className="as-jobs">
                      {g.items.map((a) => {
                        const Ico = JOB_ICON[a.id] ?? FileTextIcon;
                        const need = a.fields.filter((f) => f.required).map((f) => L(f.label));
                        return (
                          <button key={a.id} type="button" className="as-job" data-picked={picked === a.id || actionId === a.id || undefined} disabled={act.busy} onClick={() => pickJob(a.id)}>
                            <span className="as-job-icon" aria-hidden="true">
                              <Ico size={20} weight="duotone" />
                            </span>
                            <span className="as-job-text">
                              <span className="as-job-name">{L(a.label)}</span>
                              {need.length > 0 && <span className="as-job-need">{need.join(' · ')}</span>}
                            </span>
                            <ArrowRightIcon className="as-job-go" size={16} aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </section>

      <section className="fold-sec as-skills-sec" data-open={skillsOpen || undefined} aria-labelledby={skillsHead}>
        <div className="fold-sec-head">
          <h2 className="fold-sec-title">
            <button type="button" id={skillsHead} className="fold-sec-toggle" aria-expanded={skillsOpen} onClick={() => toggleSkills()}>
              <CaretDownIcon className="fold-caret" size={16} weight="bold" aria-hidden="true" />
              <span>{en ? 'Skills and my style' : 'Kemahiran dan gaya saya'}</span>
            </button>
          </h2>
          {home.installed && <Chip tone="neutral">{home.skills.length}</Chip>}
          {!skillsOpen && <span className="fold-sec-summary">Teach the helper your usual ways of doing a job.</span>}
        </div>
        {skillsOpen && (
          <div className="fold-sec-body as-skills">
            {!home.installed ? (
              <div className="notice" data-tone="neutral">
                {en ? 'The skill library is not installed in this database yet. The helper still fills forms; it does not remember yet.' : 'Pustaka kemahiran belum dipasang dalam pangkalan data ini. Pembantu masih mengisi borang tetapi belum mengingat.'}
              </div>
            ) : (
              <>
                <p className="as-skills-intro">A skill is a saved way of doing one job, called up by your words. Save one after you send a form. A head of department can save one for the whole team.</p>
                <div className="as-card">
                  <h3>{en ? 'Skills my helper uses' : 'Kemahiran yang digunakan'}</h3>
                  {home.skills.length === 0 && <p className="muted small">{en ? 'None yet. After you send a form, save it as a skill.' : 'Belum ada. Selepas menghantar borang, simpan sebagai kemahiran.'}</p>}
                  {home.skills.length > 0 && (
                    <ul className="as-skill-list">
                      {home.skills.map((s) => (
                        <li key={s.id} className="as-skill">
                          <div className="as-skill-main">
                            <strong>{s.name}</strong>
                            <span className="as-skill-meta">
                              <Chip tone={s.scope === 'me' ? 'neutral' : 'info'}>{s.scope === 'me' ? (en ? 'mine' : 'saya') : s.owner.split(':')[1]}</Chip>
                              {s.words.map((w) => (
                                <span key={w} className="as-word">
                                  {w}
                                </span>
                              ))}
                            </span>
                          </div>
                          {(s.scope === 'me' || home.teams.some((t) => t.owner === s.owner && t.mayPublish)) && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={act.busy}
                              onClick={() => {
                                setWhere('skills');
                                void act.run(() => api.assistantAct('retire', { id: s.id, reason: en ? 'No longer used' : 'Tidak digunakan lagi' }), en ? 'Retired' : 'Dihentikan').then(() => reload());
                              }}
                            >
                              {en ? 'Retire' : 'Henti guna'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="as-card">
                  <h3>{en ? 'My style (only you see it)' : 'Gaya saya (hanya anda melihatnya)'}</h3>
                  <p className="as-style-line">
                    {en ? 'Sign-off' : 'Penutup'}: {home.style.signOff ?? '—'}
                  </p>
                  <p className="as-style-line">
                    {en ? 'Words learned' : 'Perkataan dipelajari'}: {home.style.words.length ? home.style.words.map((w) => `"${w.said}" = ${w.label || w.value}`).join(', ') : '—'}
                  </p>
                  <div className="as-style-edit">
                    <label className="as-f">
                      <span className="as-f-label">{en ? 'My sign-off' : 'Penutup saya'}</span>
                      <input
                        className="input"
                        aria-label={en ? 'My sign-off' : 'Penutup saya'}
                        placeholder={en ? 'Sign-off, e.g. Thank you' : 'Penutup, cth. Terima kasih'}
                        defaultValue={home.style.signOff ?? ''}
                        onBlur={(e) => {
                          if (e.target.value !== (home.style.signOff ?? '')) {
                            setWhere('skills');
                            void act.run(() => api.assistantAct('style', { signOff: e.target.value }), en ? 'Saved' : 'Disimpan').then(() => reload());
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost as-forget"
                      disabled={act.busy}
                      onClick={() => {
                        setWhere('skills');
                        void act.run(() => api.assistantAct('forget', { all: true }), en ? 'Cleared' : 'Dikosongkan').then(() => reload());
                      }}
                    >
                      {en ? 'Clear what it learned about me' : 'Padam apa yang dipelajari tentang saya'}
                    </button>
                  </div>
                </div>
              </>
            )}
            {where === 'skills' && act.error && <ErrorNotice error={act.error} />}
          </div>
        )}
      </section>
    </div>
  );
}
