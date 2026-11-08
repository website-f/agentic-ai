import { hasOwnStaffRecord } from "./access";
import { isGroupLeader } from "./access";
import type { User } from "./types";


/**
 * Who may open the rebalance screen and ask for advice (the server's own check in workRebalance). The list only shows
 * people in the user's line, so someone with nobody under them sees an empty list. Moving work also needs the server
 * to confirm the user manages both people.
 */
export function workRebalanceAllowed(user: User): boolean {
  const staff = !user.integration && user.role !== 'guard' && user.role !== 'site_device' && hasOwnStaffRecord(user);
  return staff || isGroupLeader(user);
}

const t = (bm: string, en: string) => ({ bm, en });
const NO_STEP = t('Tiada langkah semakan: pengurus membuat keputusan.', 'No review step: the manager decides.');
const SOURCES = [
  {
    what: t('Tugasan, masa siap dan tarikh cuti datang daripada rekod Prima sendiri.', 'Tasks, finishing times and leave dates come from Prima’s own records.'),
    askDesk: null,
    askName: 'Pengurus barisan orang itu / the person’s line manager',
  },
];

export const WORK_REBALANCE_GUIDE_CARDS = [
  {
    id: 'work.rebalance.advice',
    status: 'ready' as const,
    dept: 'all',
    title: t('Lihat nasihat Arisha untuk mengimbangi kerja pasukan', 'See Arisha’s advice on rebalancing your team’s work'),
    purpose: t(
      'Tunjuk kerja yang patut dipindah, dikongsi atau diberi masa baharu: cuti, lewat, beban berat, masa ketat.',
      'Shows work to move, share or give a new time: leave, overdue, heavy load, tight timing.',
    ),
    who: t('Pengurus yang ada staf di bawahnya.', 'Managers with staff under them.'),
    screen: { view: 'work', name: 'Kerja / Work → Rebalance (Arisha advice)', action: t('Baca nasihat dan fakta di bawahnya.', 'Read the advice and the facts under it.') },
    enteredOnce: t(
      'Tiada apa ditaip semula: nasihat dibaca daripada tugasan, cuti dan masa ACT yang sudah ada.',
      'Nothing is keyed again: the advice reads existing tasks, leave and ACT timing.',
    ),
    steps: {
      save: t('Tiada simpanan: nasihat sahaja.', 'Nothing is saved: advice only.'),
      review: NO_STEP,
      returned: NO_STEP,
      done: t('Selesai apabila anda pindah atau ubah kerja, atau biarkan.', 'Done when you move or readjust the work, or leave it.'),
      recover: t('Jika nasihat berubah, muat semula skrin.', 'If the advice changed, reload the screen.'),
    },
    notVerified: [
      t(
        'Butang "Tanya Arisha AI" tutup sehingga dihidupkan; belum diuji dengan perkhidmatan AI sebenar.',
        'The "Ask Arisha AI" button is off until switched on and has not been tried against the real AI service.',
      ),
      t(
        'Masa ACT untuk setiap aliran kerja datang daripada daftar ACT (PR #55); di PostgreSQL pengurus belum boleh membacanya.',
        'ACT timing per workflow comes from ACT’s register (PR #55); on PostgreSQL managers cannot read it yet.',
      ),
    ],
    sources: SOURCES,
    allowed: workRebalanceAllowed,
    actions: ['work.rebalance_ai'],
  },
  {
    id: 'work.task.reassign',
    status: 'ready' as const,
    dept: 'all',
    title: t('Pindah tugasan kepada staf lain', 'Move a task to another staff member'),
    purpose: t('Wakilkan kerja terbuka kepada orang lain dalam barisan anda, syarikat yang sama.', 'Delegate open work to someone else in your line, in the same company.'),
    who: t('Pengurus dalam barisan orang itu, atau pimpinan kumpulan.', 'A manager in the person’s line, or group leadership.'),
    screen: { view: 'work', name: 'Kerja / Work → My team → (orang / person)', action: t('Tekan "Move or readjust" → "Move to someone else".', 'Press "Move or readjust" → "Move to someone else".') },
    enteredOnce: t(
      'Tugasan yang sama dipindah, bukan ditaip semula; sejarah dan bukti kekal pada tugasan.',
      'The same task moves; it is not keyed again. History and proof stay on the task.',
    ),
    steps: {
      save: t('Pilih orang, beri sebab; tugasan lewat perlu masa siap baharu.', 'Choose the person and give a reason; overdue work needs a new due time.'),
      review: t('Pengurus barisan orang baharu menyemak apabila siap.', 'The new person’s line manager reviews it when done.'),
      returned: t('Tugasan yang dipulangkan boleh dipindah semula.', 'A returned task can be moved again.'),
      done: t('Tugasan ada pada senarai orang baharu; jejak audit disimpan.', 'The task is on the new person’s list; the audit keeps the trail.'),
      recover: t('Jika ditolak, baca sebabnya (barisan, syarikat, peranan atau tugasan sudah siap).', 'If refused, read why (line, company, role, or the task is already finished).'),
    },
    notVerified: [],
    sources: SOURCES,
    allowed: workRebalanceAllowed,
    actions: ['work.task_reassign'],
  },
  {
    id: 'work.task.adjust',
    status: 'ready' as const,
    dept: 'all',
    title: t('Ubah masa siap atau keutamaan tugasan', 'Change a task’s due time or priority'),
    purpose: t('Laraskan kerja terbuka staf anda dengan sebab.', 'Readjust your staff’s open work, with a reason.'),
    who: t('Pengurus dalam barisan orang itu, atau pimpinan kumpulan.', 'A manager in the person’s line, or group leadership.'),
    screen: { view: 'work', name: 'Kerja / Work → My team → (orang / person)', action: t('Tekan "Move or readjust" → "Readjust".', 'Press "Move or readjust" → "Readjust".') },
    enteredOnce: t('Hanya masa atau keutamaan berubah; tugasan tidak ditaip semula.', 'Only the time or priority changes; the task is not keyed again.'),
    steps: {
      save: t('Beri masa baharu dan/atau keutamaan, dan sebab.', 'Give the new time and/or priority, and a reason.'),
      review: NO_STEP,
      returned: NO_STEP,
      done: t('Staf melihat perubahan dan sebabnya pada tugasan.', 'The staff member sees the change and its reason on the task.'),
      recover: t('"Nothing changed" bermaksud masa dan keutamaan sama seperti sebelum.', '"Nothing changed" means the time and priority are the same as before.'),
    },
    notVerified: [],
    sources: SOURCES,
    allowed: workRebalanceAllowed,
    actions: ['work.task_adjust'],
  },
];