/**
 * What the Operations Manager discusses with a client to learn what the site needs, and what can be done about it
 * (Fauzan, 6 Nov 2026: "list what OM need to discuss client to know what they need and what can be done to secure the
 * client site. OM can set task to patrolling officer, officer or guard following the needs.").
 *
 * Each topic has the questions to ask and what the company can offer. "Task" ideas can be set as site tasks that show
 * on the site's shared device on the days they are due.
 */
import type { SiteTaskFor } from './types';

export interface NeedTopic {
  key: string;
  title: string;
  ask: string[];
  canDo: string[];
  /** Ready-made task ideas the OM can set straight from the discussion. */
  tasks: { title: string; forRole: SiteTaskFor; days: 'daily' | 'weekdays' | 'weekly'; byTime: string | null; proof: 'none' | 'photo' }[];
}

export interface NeedSection {
  key: string;
  title: string;
  topics: NeedTopic[];
}

export const CLIENT_NEEDS: NeedSection[] = [
  {
    key: 'site',
    title: 'The site and its people',
    topics: [
      {
        key: 'site.use',
        title: 'What the site is and when it is busy',
        ask: [
          'What is the premises used for, and what are the working or opening hours?',
          'Who is inside: staff, students, patients, residents, the public? Anyone vulnerable (children, elderly, patients)?',
          'Peak times: opening, lunch, dismissal, shift change, deliveries?',
          'Is anyone inside after hours, at weekends or in holidays?',
        ],
        canDo: ['Match guard posts and hours to busy times.', 'Put an extra guard on the gate at peak times.'],
        tasks: [{ title: 'Gate post at peak time: keep the gate clear and watch who comes in', forRole: 'guard', days: 'weekdays', byTime: null, proof: 'none' }],
      },
      {
        key: 'site.contacts',
        title: 'Client contacts',
        ask: [
          'Who is the 24-hour contact for an emergency, and who is the backup?',
          'Who may approve visitors, contractors and after-hours entry?',
          'How does the client want to be told of an incident: call, message, and within how many minutes?',
        ],
        canDo: ['Keep the contact list on the shared device and with CMS.', 'Agree a call-within time for serious incidents.'],
        tasks: [],
      },
    ],
  },
  {
    key: 'access',
    title: 'Who comes in and out',
    topics: [
      {
        key: 'access.entrances',
        title: 'Entrances and exits',
        ask: [
          'How many entrances and exits are there? Which are manned, which locked, and at what times?',
          'Are there side gates, back doors or fence gaps people use?',
        ],
        canDo: ['Lock unused gates at set times and check them on rounds.', 'Record each gate opening and closing in the post log.'],
        tasks: [
          { title: 'Lock the side and back gates and photograph them locked', forRole: 'guard', days: 'daily', byTime: '19:00', proof: 'photo' },
          { title: 'Open the gates for the day and check nothing was tampered with overnight', forRole: 'guard', days: 'daily', byTime: '07:00', proof: 'photo' },
        ],
      },
      {
        key: 'access.visitors',
        title: 'Visitors',
        ask: [
          'What must a visitor show (IC, licence, appointment)? Who must agree before they enter?',
          'Should visitors be escorted? Are some areas off-limits?',
          'For schools: who may collect each child, and how is an early pick-up approved?',
        ],
        canDo: [
          'Record every visitor on the shared device with IC photo, face check and photo (full record kept for police).',
          'Call the host before letting a visitor in.',
          'Keep the client\'s list of approved adults for child pick-up.',
        ],
        tasks: [],
      },
      {
        key: 'access.contractors',
        title: 'Contractors and deliveries',
        ask: [
          'Which contractors and suppliers come regularly, and on which days?',
          'Where do deliveries go? Who signs for them?',
          'Do contractors need a permit to work or an escort?',
        ],
        canDo: ['Check contractors against the client\'s booking list.', 'Record deliveries and who received them.'],
        tasks: [],
      },
      {
        key: 'access.vehicles',
        title: 'Vehicles and parking',
        ask: [
          'Which vehicles are allowed in? Is there a list of staff or resident plates?',
          'Any vehicles that must never be let in (banned or reported)?',
          'Is there a barrier, plate camera or parking system to link with?',
        ],
        canDo: ['Keep the site vehicle list; a plate on watch alerts CMS at once.', 'Check vehicles parked overnight.'],
        tasks: [{ title: 'Note vehicles still parked overnight (plate and spot)', forRole: 'guard', days: 'daily', byTime: '23:00', proof: 'photo' }],
      },
      {
        key: 'access.barred',
        title: 'People who must not enter',
        ask: ['Is there anyone barred from the site (court order, dismissed staff, trespasser, custody dispute)?', 'Who keeps that list and who updates it?'],
        canDo: ['Keep the barred list at the gate and tell CMS if one appears.'],
        tasks: [],
      },
      {
        key: 'access.keys',
        title: 'Keys and access cards',
        ask: ['Does the guard hold keys or cards? Which rooms? Who may borrow them?'],
        canDo: ['Count keys at every shift handover and record it in the post log.'],
        tasks: [{ title: 'Count keys and cards at handover', forRole: 'guard', days: 'daily', byTime: null, proof: 'none' }],
      },
    ],
  },
  {
    key: 'risk',
    title: 'Risks and past incidents',
    topics: [
      {
        key: 'risk.valuables',
        title: 'Valuable or dangerous areas',
        ask: [
          'Where are the valuables: cash, IT or server room, labs, pharmacy, store, vehicles?',
          'Any dangerous areas: gas, chemicals, generator, rooftop, water tank, construction?',
        ],
        canDo: ['Add patrol checkpoints at these spots.', 'Check them at lock-up with a photo.'],
        tasks: [{ title: 'Check the high-risk rooms are locked (IT room, store, office)', forRole: 'guard', days: 'daily', byTime: '20:00', proof: 'photo' }],
      },
      {
        key: 'risk.history',
        title: 'What has happened before',
        ask: [
          'Thefts, break-ins, trespass, vandalism, fights or threats in the last 12 months? When and where?',
          'Any problem with the previous security company?',
          'What is the area like at night (crime, drug use, loitering)?',
        ],
        canDo: ['Put rounds where and when incidents happened.', 'Ask the patrolling officer to visit at those times.'],
        tasks: [{ title: 'Extra round of the trouble spot the client named', forRole: 'guard', days: 'daily', byTime: '02:00', proof: 'photo' }],
      },
    ],
  },
  {
    key: 'systems',
    title: 'What is already there',
    topics: [
      {
        key: 'systems.cctv',
        title: 'CCTV and alarms',
        ask: [
          'How many cameras, where, do they record, and for how many days? Who watches them?',
          'Any intruder alarm, sensors or panic buttons? Who responds?',
          'May our CMS view the cameras or receive the alarms?',
        ],
        canDo: ['Link CCTV and sensor alerts to CMS so the guard is sent to check with photo or video.', 'Check daily that cameras and recording work.'],
        tasks: [{ title: 'Check the CCTV screen: all cameras showing and recording', forRole: 'guard', days: 'daily', byTime: '09:00', proof: 'photo' }],
      },
      {
        key: 'systems.physical',
        title: 'Fence, lights and guardhouse',
        ask: [
          'Is the fence complete? Any holes or low parts?',
          'Are all outside lights working at night? Any dark spots?',
          'Is the guardhouse fit: shelter, toilet, water, power, fan, chair?',
        ],
        canDo: ['Report broken fence or lights to the client with a photo.', 'Check the fence line on rounds.'],
        tasks: [
          { title: 'Walk the fence line and photograph any damage', forRole: 'guard', days: 'daily', byTime: '22:00', proof: 'photo' },
          { title: 'Report outside lights not working', forRole: 'guard', days: 'daily', byTime: '20:30', proof: 'none' },
        ],
      },
      {
        key: 'systems.signal',
        title: 'Phone signal and internet',
        ask: ['Is there mobile signal at the guardhouse? Wi-Fi the guard may use?'],
        canDo: ['The shared device keeps entries encrypted when offline and sends them later.', 'Agree a landline or radio to reach CMS if there is no signal.'],
        tasks: [],
      },
    ],
  },
  {
    key: 'guarding',
    title: 'Guarding and patrols',
    topics: [
      {
        key: 'guarding.posts',
        title: 'Posts, hours and rounds',
        ask: [
          'How many guards, on which posts, and for which hours?',
          'How often should rounds be done, and which points must be covered?',
          'Armed guards needed (cash, high-value goods)?',
        ],
        canDo: ['Set posts, shifts and patrol checkpoints to match.', 'Set the patrol interval the client asks for.'],
        tasks: [],
      },
      {
        key: 'guarding.supervision',
        title: 'Supervision',
        ask: ['How often should an officer or patrolling officer visit? Day, night, or both?', 'Does the client want to meet the OM regularly?'],
        canDo: ['Set officer and patrolling officer visit tasks with a photo.', 'Monthly meeting with the client.'],
        tasks: [
          { title: 'Officer site check: guards awake, in uniform, post log written', forRole: 'officer', days: 'daily', byTime: null, proof: 'photo' },
          { title: 'Patrolling officer visit: check the post, the guards and the post log', forRole: 'patrol_officer', days: 'weekly', byTime: null, proof: 'photo' },
        ],
      },
      {
        key: 'guarding.routines',
        title: 'Opening and lock-up',
        ask: ['Does the guard open and close the premises? Which doors, lights, air-conditioners, gas, water?'],
        canDo: ['Opening and lock-up checklists with a photo, so the client knows the site was left safe.'],
        tasks: [
          { title: 'Lock-up round: doors, windows, lights, air-cond and gas off', forRole: 'guard', days: 'weekdays', byTime: '19:30', proof: 'photo' },
          { title: 'Opening round: all doors found locked, nothing damaged', forRole: 'guard', days: 'weekdays', byTime: '07:00', proof: 'photo' },
        ],
      },
    ],
  },
  {
    key: 'emergency',
    title: 'Emergencies',
    topics: [
      {
        key: 'emergency.plan',
        title: 'Emergency plan',
        ask: [
          'Where is the assembly point? Who leads an evacuation?',
          'Is there a lockdown plan (intruder, threat)? Who decides?',
          'Nearest police station, fire station and hospital? First aid kit and fire extinguishers?',
        ],
        canDo: ['Keep the emergency numbers on the shared device.', 'Guard SOS goes to CMS at once.', 'Check fire extinguishers monthly.'],
        tasks: [{ title: 'Check fire extinguishers and the first aid kit', forRole: 'officer', days: 'weekly', byTime: null, proof: 'photo' }],
      },
      {
        key: 'emergency.drills',
        title: 'Drills',
        ask: ['Does the client run fire or lockdown drills? Should guards take part?'],
        canDo: ['Record drills in the post log with the time taken.'],
        tasks: [],
      },
    ],
  },
  {
    key: 'reporting',
    title: 'Reports to the client',
    topics: [
      {
        key: 'reporting.what',
        title: 'What the client wants to see',
        ask: [
          'Which reports, how often, and to whom: daily, weekly, monthly?',
          'Do they want the visitor log, incident list, patrol rounds, or photos?',
        ],
        canDo: ['Monthly report with the client\'s acknowledgement and comment.', 'Incident report with photo or video proof.'],
        tasks: [{ title: 'Send the daily report to the client contact', forRole: 'officer', days: 'weekdays', byTime: '09:00', proof: 'none' }],
      },
    ],
  },
  {
    key: 'special',
    title: 'Special needs',
    topics: [
      {
        key: 'special.events',
        title: 'Events, holidays and shutdowns',
        ask: ['Any events, open days or VIP visits planned? Holidays or shutdowns when the site is empty?'],
        canDo: ['Add guards for events.', 'More rounds when the site is empty.'],
        tasks: [],
      },
      {
        key: 'special.pdpa',
        title: 'Personal data and notices',
        ask: [
          'Is there a notice at the gate that visitors are recorded and that records may be given to the police?',
          'Is there a CCTV notice? Who at the client may see visitor records?',
        ],
        canDo: ['Put up the gate notice.', 'Visitor details are sealed for the company\'s in-house server; police get them on request.'],
        tasks: [],
      },
    ],
  },
];

export const NEED_TOPICS: NeedTopic[] = CLIENT_NEEDS.flatMap((s) => s.topics);
export const NEED_TOPIC_KEYS = new Set(NEED_TOPICS.map((t) => t.key));

export const SITE_TASK_FOR_LABEL: Record<SiteTaskFor, string> = { guard: 'Guard', officer: 'Officer', patrol_officer: 'Patrolling officer' };
