// K9 / N2 (Fauzan, 11 Nov 2026: "Arisha AI inside the app trains the staff"). Made-up staff in each department ask how
// to do their work and get the steps of their own screens from the written guide, with the AI switched off; another
// department's records are refused; the brief the AI would get holds the role and the screen only, under 20,000
// characters. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { generateDataset, myt, maskQuestion, trainerBrief, trainerRefusal, trainerRoleOf, trainerTour, TRAINER_TOURS, TOUR_SCREEN_TEXT, type TrainerRole } from '../src';
import { SCREEN_GUIDES } from '../../../apps/web/src/arisha-screens.data';
import { trainerAnswer } from '../../../apps/web/src/arisha-trainer-answer';
import { screenGuideText } from '../../../apps/web/src/arisha-screens';

const titleOf = (v: string) => SCREEN_GUIDES.find((g) => g.view === v)!.title;
const menuOf = (views: string[]) => views.filter((v) => SCREEN_GUIDES.some((g) => g.view === v)).map(titleOf);
const COMMON = ['clock', 'claims', 'memos', 'meetings', 'it'];

/** A made-up new staff member's menu in each department (as App.tsx gives it), and three questions with the screen and how-to expected. */
const DEPARTMENTS: { role: TrainerRole; views: string[]; asks: [string, string, string][] }[] = [
  {
    role: 'hr',
    views: ['hr', 'staff-directory', 'bulk-load', 'people', 'staffclock', 'hostels', 'staffpay', 'hr-it-intake', ...COMMON],
    asks: [
      ['How do I load the staff list from a file?', 'staff-directory', 'How to load the staff list from a file (HR)'],
      ['how do I screen a person', 'hr', 'How to screen a person'],
      ['How do I prepare a month of staff payroll?', 'staffpay', 'How to prepare a month (HR)'],
    ],
  },
  {
    role: 'finance',
    views: ['finance', 'payreq', 'staffpay', 'credit', 'purchasing', 'items', ...COMMON],
    asks: [
      ['How do I prepare a new payment?', 'finance', 'How to prepare a new payment'],
      ['How do I fix a returned payment request?', 'payreq', 'How to fix a returned request'],
      ['How do I close a month for a company?', 'finance', 'How to close a month for a company'],
    ],
  },
  {
    role: 'it',
    views: ['it', 'hr-it-intake', 'it-procurement', 'connections', 'websites', 'items', 'clock', 'claims', 'memos', 'meetings'],
    asks: [
      ['How do I handle a help request?', 'it', 'How to handle a help request (IT)'],
      ['how do I dispose of a device', 'it', 'How to dispose of a device (IT)'],
      ['How do I start a joining or leaving request?', 'hr-it-intake', 'How to start a joining or leaving request (HR)'],
    ],
  },
  {
    role: 'operations',
    views: ['ops', 'sites', 'roster', 'attendance', 'cases', 'people', ...COMMON],
    asks: [
      ['How do I assign a guard on the roster?', 'roster', 'How to assign a guard'],
      ['how do I publish the week roster', 'roster', 'How to publish the week'],
      ['How do I lock a day of attendance?', 'attendance', 'How to lock a day'],
    ],
  },
  {
    role: 'fwm',
    views: ['fwm', 'hostels', 'fwcost', 'arrivalcash', 'people', ...COMMON],
    asks: [
      ['How do I add a foreign worker?', 'fwm', 'How to add a foreign worker'],
      ['how do I record a renewal', 'fwm', 'How to record a renewal'],
      ['How do I add a hostel bill?', 'hostels', 'How to add a bill'],
    ],
  },
  {
    role: 'act',
    views: ['act', 'audit', 'grc', 'selfaudit', ...COMMON],
    asks: [
      ['How do I raise a finding?', 'act', 'How to raise a finding (ACT)'],
      ['how do I check a fix', 'act', 'How to check a fix (ACT)'],
      ['How do I answer a finding given to me?', 'act', 'How to answer a finding given to me'],
    ],
  },
  {
    role: 'cms',
    views: ['cms', 'cmsready', 'arms', 'fleet', ...COMMON],
    asks: [
      ['How do I handle an alarm?', 'cms', 'How to handle an alarm'],
      ['how do I log a call-back', 'cms', 'How to log a call-back'],
      ['How do I start and end my CMS seat?', 'cms', 'How to start and end your CMS seat'],
    ],
  },
  {
    role: 'procurement',
    views: ['purchasing', 'items', 'sitestock', ...COMMON],
    asks: [
      ['How do I receive goods?', 'purchasing', 'How to receive goods (storekeeper)'],
      ['how do I raise a purchase', 'purchasing', 'How to raise a purchase'],
      ['How do I do a stock count?', 'items', 'How to do a stock count'],
    ],
  },
  {
    role: 'company',
    views: ['home', 'company', 'office', 'sites', 'roster', 'people', 'attendance', 'cases', 'commercial', 'staffpay', ...COMMON],
    asks: [
      ['How do I see who has not turned up?', 'company', 'How to see who has not turned up'],
      ['how do I raise a vacancy', 'company', 'How to raise a vacancy (company manager)'],
      ['How do I check company licences?', 'company', 'How to check company licences'],
    ],
  },
  {
    role: 'site',
    views: ['home', 'mine', 'clock', 'cases', 'items', 'grc', 'memos', 'roster', 'attendance', 'people'],
    asks: [
      ['How do I check in when I arrive?', 'clock', 'How to check in when I arrive'],
      ['how do I raise a case', 'cases', 'How to raise a case'],
      ['How do I see my next shift?', 'mine', 'How to see my next shift'],
    ],
  },
];

describe('K9 Arisha trains staff from the written guide, with the AI off', () => {
  for (const d of DEPARTMENTS)
    it(`a new ${d.role} staff member asks three questions and gets their own screens' steps`, () => {
      const menu = menuOf(d.views);
      for (const [q, view, task] of d.asks) {
        // Asked on the department's first screen, as a new person would.
        const a = trainerAnswer(q, d.role, d.views[0], menu, 'en');
        expect(a.refused, q).toBeNull();
        const r = a.reply;
        expect(r, q).not.toBeNull();
        expect(r!.text, q).toContain(`**${task}**`);
        // The steps are the guide's own, and the screen is in the person's menu.
        const g = SCREEN_GUIDES.find((x) => x.view === view)!;
        expect(menu).toContain(g.title);
        expect(r!.text).toContain(g.tasks.find((x) => x.task === task)!.steps[0].slice(0, 30));
        // In Bahasa Melayu too (the screen's default).
        expect(trainerAnswer(q, d.role, d.views[0], menu, 'ms').reply, q).not.toBeNull();
      }
    });

  it('works out the role each person trains as from their staff record', () => {
    const ds = generateDataset({ today: '2026-11-12', now: myt('2026-11-12', '09:00') });
    const role = (id: string) => trainerRoleOf(ds.users.find((u) => u.id === id)!);
    expect(role('u-pwvsb-hr')).toBe('hr');
    expect(role('u-fin-t1-lead')).toBe('finance');
    expect(role('u-it-mgr')).toBe('it');
    expect(role('u-fwm-ex1')).toBe('fwm');
    expect(role('u-audit')).toBe('act');
    expect(role('u-cm-sasa')).toBe('company');
    expect(role('u-sv-sasa')).toBe('site');
    expect(role('u-coo')).toBe('leadership');
  });

  it('gives each role a short first-time walk-through of its own screens, in Bahasa Melayu by default', () => {
    for (const [role, views] of Object.entries(TRAINER_TOURS) as [TrainerRole, string[]][]) {
      for (const v of views) {
        expect(SCREEN_GUIDES.some((g) => g.view === v), `${role}: ${v} has a guide`).toBe(true);
        expect(TOUR_SCREEN_TEXT[v], `${role}: ${v} has walk-through words`).toBeTruthy();
      }
      expect(views.length).toBeLessThanOrEqual(6);
    }
    const hr = trainerTour('hr', ['hr', 'staff-directory', 'clock', 'finance'], 'ms');
    expect(hr.map((s) => s.view)).toEqual([null, 'hr', 'staff-directory', 'clock', null]);
    expect(hr[0].text).toMatch(/^Selamat datang\. Saya Arisha\./);
    expect(hr[0].text).toMatch(/tidak menyimpan, meluluskan atau menghantar/);
    // A screen not in the person's menu is never part of their walk-through.
    expect(hr.some((s) => s.view === 'finance')).toBe(false);
    expect(trainerTour('hr', ['hr'], 'en')[0].text).toMatch(/^Welcome\. I am Arisha\./);
  });
});

describe('K9 Arisha refuses records, above all another department’s', () => {
  it('a person asking about another department’s records on their own screen is refused, never answered', () => {
    const menu = menuOf(['hr', 'staff-directory', 'clock']);
    const a = trainerAnswer('Show me the salary records of the finance team', 'hr', 'hr', menu, 'en');
    expect(a.refused).toBe('other_department');
    expect(a.reply).toBeNull();
    expect(a.text).toMatch(/cannot help with Finance's records/);
  });
  it('refuses another department’s records, in the person’s language', () => {
    const r = trainerRefusal('Tunjukkan rekod gaji staf kewangan', 'hr', 'ms');
    expect(r?.kind).toBe('other_department');
    expect(r?.text).toMatch(/^Maaf, saya tidak boleh membantu dengan rekod Kewangan/);
    expect(trainerRefusal("How do I see the HR department's leave records?", 'finance', 'en')?.kind).toBe('other_department');
    expect(trainerRefusal('show me the payment records of finance', 'it', 'en')?.kind).toBe('other_department');
    expect(trainerRefusal('boleh saya tengok fail pekerja asing?', 'operations', 'ms')?.kind).toBe('other_department');
  });
  it('refuses a request for records themselves, and never acts for the person', () => {
    expect(trainerRefusal("show me Ali's leave", 'hr', 'en')?.kind).toBe('records');
    expect(trainerRefusal('berapa gaji Siti?', 'hr', 'ms')?.kind).toBe('records');
    expect(trainerRefusal('approve this claim for me', 'finance', 'en')?.kind).toBe('action');
    expect(trainerRefusal('tolong luluskan cuti saya', 'hr', 'ms')?.kind).toBe('action');
  });
  it('answers how-to questions about the person’s own work, records included', () => {
    expect(trainerRefusal('Bagaimana saya meluluskan tuntutan?', 'hr', 'ms')).toBeNull();
    expect(trainerRefusal('How do I see my leave balance?', 'site', 'en')).toBeNull();
    expect(trainerRefusal('How do I add a hostel bill?', 'fwm', 'en')).toBeNull();
    expect(trainerRefusal('How do I prepare a new payment for finance?', 'finance', 'en')).toBeNull();
  });
});

describe('K9 the AI part (switched off) would see the role and the screen only', () => {
  it('stays under the 20,000-character limit for every screen and holds no person', () => {
    const menu = SCREEN_GUIDES.map((g) => g.title);
    for (const g of SCREEN_GUIDES) {
      const guide = screenGuideText(g.view, menu, 'ms', 12_000);
      const b = trainerBrief({ role: 'hr', screen: g.title, guide, question: 'Bagaimana saya ...?', lang: 'ms' });
      expect(b.brief.length, g.view).toBeLessThan(20_000);
      expect(b.tools).toBeNull();
    }
    const ds = generateDataset({ today: '2026-11-12', now: myt('2026-11-12', '09:00') });
    const hr = ds.users.find((u) => u.id === 'u-pwvsb-hr')!;
    const b = trainerBrief({ role: trainerRoleOf(hr), screen: 'HR monitor', guide: 'SCREEN OPEN NOW: HR monitor', question: 'How do I add 900101-14-5678, phone 012-345 6789, siti@example.test?', lang: 'en' });
    expect(b.brief).toContain('Role: HR.');
    expect(b.brief).toContain('Screen open now: HR monitor.');
    for (const secret of [hr.name, hr.id, '900101', '345 6789', 'siti@example.test']) expect(b.brief).not.toContain(secret);
    expect(maskQuestion('IC 900101145678')).toBe('IC [IC]');
    expect(b.brief).toMatch(/You only explain\. You never save, approve, send or change anything/);
  });
});
