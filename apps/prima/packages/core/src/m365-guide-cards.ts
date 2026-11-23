/**
 * Microsoft 365 guide cards (Fauzan, 23 Nov 2026: "Make sure guide can help them to do microsoft. Or help them to do
 * it."). Read-only help in the shared guide-card shape: a card never signs anyone in, changes a Microsoft setting or
 * raises a request by itself. The steps for each item are USE_STEPS in m365-usage.ts, shown on the Microsoft use board
 * with the official Microsoft page and an "Ask IT to help" button that raises an ordinary IT help request. Never ask
 * for passwords or sign-in codes.
 */
import { registerGuideCards, type GuideCardSpec, type GuideText } from './guide-cards';
import { usageCovered } from './m365-usage';
import type { User } from './types';

const t = (bm: string, en: string): GuideText => ({ bm, en });
/** Office staff the Microsoft use board covers (the same rule the server uses); the date only decides closed access. */
const office = (u: User) => usageCovered(u, new Date().toISOString().slice(0, 10));
const fromIt = [{ what: t('Akaun Microsoft kerja anda dan aplikasi yang dibenarkan diuruskan oleh IT.', 'Your work Microsoft account and the apps allowed for it are managed by IT.'), askDesk: 'it' as const }];
const notVerified = [
  t('Papan ini membaca rekod Microsoft sekali sehari; perubahan hari ini muncul dalam 2 hingga 3 hari.', 'The board reads Microsoft records once a day; what you do today shows in 2 to 3 days.'),
  t('Tiada siapa akan minta kata laluan atau kod masuk anda, termasuk IT.', 'Nobody will ask for your password or sign-in code, including IT.'),
];

export const M365_GUIDE_CARDS: GuideCardSpec[] = [
  {
    id: 'm365.checklist',
    status: 'ready',
    dept: 'IT',
    title: t('Guna Microsoft 365 sepenuhnya', 'Make full use of Microsoft 365'),
    purpose: t(
      'Lihat apa yang belum disediakan atau digunakan dalam Microsoft 365, dan siapkan satu demi satu dengan langkah mudah.',
      'See what is not yet set up or used in Microsoft 365, and finish each item with simple steps.',
    ),
    who: t('Semua staf pejabat dengan akaun Prima.', 'Every office staff member with a Prima sign-in.'),
    screen: { view: 'connections', name: 'Connections > Microsoft use', action: t('Buka "Cara buat" pada setiap perkara yang belum siap.', 'Open "How to do it" on each item that is not done yet.') },
    allowed: office,
    sources: fromIt,
    enteredOnce: t(
      'Tiada apa ditaip: Prima membaca rekod Microsoft sendiri, jadi anda tidak perlu melaporkan apa-apa.',
      'Nothing is typed in: Prima reads Microsoft’s own records, so you never report anything yourself.',
    ),
    steps: {
      save: t('Ikut langkah bernombor dan tekan "Buka" untuk halaman Microsoft yang betul.', 'Follow the numbered steps and press "Open" for the right Microsoft page.'),
      review: t('Tiada semakan: ini bimbingan, bukan tindakan disiplin.', 'No review: this is coaching, never discipline.'),
      returned: t('Jika langkah tidak berjaya, tekan "Minta IT bantu".', 'If a step does not work, press "Ask IT to help".'),
      done: t('Perkara bertukar kepada Siap selepas Microsoft melaporkannya.', 'The item turns Done once Microsoft reports it.'),
      recover: t('Tersalah langkah? Ulang dari langkah 1 atau minta IT bantu.', 'Made a mistake? Start again from step 1 or ask IT to help.'),
    },
    notVerified,
  },
  {
    id: 'm365.ask_it',
    status: 'ready',
    dept: 'IT',
    title: t('Minta IT sediakan Microsoft untuk anda', 'Ask IT to set up Microsoft for you'),
    purpose: t(
      'IT boleh duduk bersama anda untuk pasang Authenticator, Teams, Outlook, OneDrive, Office desktop atau daftar laptop.',
      'IT can sit with you to set up Authenticator, Teams, Outlook, OneDrive, desktop Office or enrol your laptop.',
    ),
    who: t('Semua staf pejabat dengan akaun Prima.', 'Every office staff member with a Prima sign-in.'),
    screen: { view: 'connections', name: 'Connections > Microsoft use', action: t('Tekan "Minta IT bantu" pada perkara itu.', 'Press "Ask IT to help" on that item.') },
    allowed: office,
    sources: fromIt,
    enteredOnce: t(
      'Permintaan dibuka terus sebagai permintaan bantuan IT (Microsoft 365) dengan nama perkara itu; tiada borang lain.',
      'It opens an IT help request (Microsoft 365) with the item already named; there is no other form to fill.',
    ),
    steps: {
      save: t('Tekan "Minta IT bantu"; nombor permintaan dipaparkan.', 'Press "Ask IT to help"; the request number is shown.'),
      review: t('IT ambil permintaan dan hubungi anda untuk masa yang sesuai.', 'IT takes the request and contacts you for a suitable time.'),
      returned: t('Jika IT perlukan maklumat, mereka tulis dalam permintaan di skrin IT > Permintaan saya.', 'If IT needs more, they write it on the request under IT > My requests.'),
      done: t('IT selesaikan, kemudian anda sahkan di IT > Permintaan saya.', 'IT resolves it, then you confirm under IT > My requests.'),
      recover: t('Tersilap hantar? Tambah nota pada permintaan yang sama di skrin IT.', 'Sent by mistake? Add a note on the same request in the IT screen.'),
    },
    notVerified,
  },
];

registerGuideCards(M365_GUIDE_CARDS);
