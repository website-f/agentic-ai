/**
 * P81: camera and location permission for the check-in and the face check. What the browser says (Permissions API, and
 * the error a refused camera or location gives), and plain-language help to switch it back on in Chrome, Edge and
 * Safari, on Android, iPhone and computers. No React here, so it is tested on its own (scripts/checkin-permissions.test.mjs).
 */
export type PermKind = 'camera' | 'location';
/** 'unknown': this browser cannot say (Safari and Firefox often cannot for the camera); asking will tell. */
export type PermState = 'granted' | 'prompt' | 'denied' | 'unknown';

export interface Platform {
  os: 'android' | 'ios' | 'windows' | 'mac' | 'other';
  browser: 'chrome' | 'edge' | 'safari' | 'samsung' | 'firefox' | 'other';
  /** Opened inside another app (WhatsApp, Facebook, Teams ...): these often cannot use the camera or location. */
  inApp: boolean;
}

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  const u = ua || '';
  // iPadOS reports itself as a Mac with a touch screen.
  const ios = /iPhone|iPad|iPod/i.test(u) || (/Macintosh/i.test(u) && maxTouchPoints > 1);
  const os: Platform['os'] = ios ? 'ios' : /Android/i.test(u) ? 'android' : /Windows/i.test(u) ? 'windows' : /Macintosh|Mac OS X/i.test(u) ? 'mac' : 'other';
  const browser: Platform['browser'] = /EdgiOS|EdgA|Edg\//i.test(u)
    ? 'edge'
    : /SamsungBrowser/i.test(u)
      ? 'samsung'
      : /FxiOS|Firefox\//i.test(u)
        ? 'firefox'
        : /CriOS|Chrome\//i.test(u)
          ? 'chrome'
          : /Safari\//i.test(u)
            ? 'safari'
            : 'other';
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|; wv\)|Teams\//i.test(u);
  return { os, browser, inApp };
}

/** What the browser says about a permission now, without asking. Never throws. */
export async function queryPermission(kind: PermKind, nav: Pick<Navigator, 'permissions'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<PermState> {
  try {
    if (!nav?.permissions?.query) return 'unknown';
    const s = await nav.permissions.query({ name: (kind === 'location' ? 'geolocation' : 'camera') as PermissionName });
    return s.state === 'granted' || s.state === 'prompt' || s.state === 'denied' ? s.state : 'unknown';
  } catch {
    return 'unknown';
  }
}

export type CameraProblem = 'denied' | 'missing' | 'busy' | 'insecure' | 'unsupported' | 'other';

/** Why the camera did not open, from getUserMedia's error. */
export function cameraProblem(e: unknown): CameraProblem {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'SecurityError') return 'insecure';
  if (name === 'TypeError' || name === 'NotSupportedError') return 'unsupported';
  return 'other';
}

export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, string> = {
  denied: 'The camera is blocked for Prima. Allow it with the steps below, then tap Try again.',
  missing: 'No camera was found on this device. Use a phone, or plug in a webcam, then tap Try again.',
  busy: 'Another app is using the camera (a video call, or the camera app). Close it, then tap Try again.',
  insecure: 'The camera only works on the secure Prima address (https). Open Prima from the Agentic Office.',
  unsupported: 'This browser cannot open the camera. Use Chrome, Edge or Safari.',
  other: 'The camera did not open. Tap Try again; if it still fails, restart the browser.',
};

export type LocationProblem = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

/** Why the location did not come, from the GeolocationPositionError code (1 denied, 2 unavailable, 3 timeout). */
export function locationProblem(e: { code?: number } | null | undefined): LocationProblem {
  if (!e) return 'unsupported';
  return e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable';
}

export const LOCATION_PROBLEM_TEXT: Record<LocationProblem, string> = {
  denied: 'Location is blocked for Prima. Allow it with the steps below, then tap Try again.',
  unavailable: 'Your phone could not find its location. Turn on Location (GPS) in the phone settings, step near a window or outside, then try again.',
  timeout: 'Finding your location took too long. Step near a window or outside, then try again.',
  unsupported: 'This browser cannot give a location. Use Chrome, Edge or Safari.',
};

export interface HelpGuide {
  id: string;
  title: string;
  steps: string[];
}

const CAMERA: HelpGuide[] = [
  {
    id: 'android-chrome',
    title: 'Chrome on Android',
    steps: [
      'Tap the icon on the left of the address bar (a lock or two sliders).',
      'Tap Permissions (or Site settings), then Camera, and choose Allow.',
      'Still blocked? Open the phone Settings > Apps > Chrome > Permissions > Camera > Allow.',
      'Come back to Prima and tap Try again.',
    ],
  },
  {
    id: 'android-edge',
    title: 'Edge on Android',
    steps: [
      'Tap the menu (···) at the bottom, then Settings > Privacy and security > Site permissions > Camera.',
      'Find this site and choose Allow.',
      'Still blocked? Phone Settings > Apps > Edge > Permissions > Camera > Allow.',
      'Come back to Prima and tap Try again.',
    ],
  },
  {
    id: 'android-samsung',
    title: 'Samsung Internet',
    steps: ['Tap the menu (three lines) > Settings > Sites and downloads > Site permissions > Camera.', 'Allow this site, come back and tap Try again.'],
  },
  {
    id: 'ios-safari',
    title: 'Safari on iPhone or iPad',
    steps: [
      'Tap aA (or the page icon) in the address bar, then Website Settings.',
      'Set Camera to Allow (or Ask).',
      'Still blocked? iPhone Settings > Apps > Safari > Camera > Allow.',
      'Come back to Prima and tap Try again.',
    ],
  },
  {
    id: 'ios-chrome',
    title: 'Chrome on iPhone or iPad',
    steps: ['Open iPhone Settings > Apps > Chrome and turn Camera on.', 'Come back to Prima, reload the page and tap Try again.'],
  },
  {
    id: 'ios-edge',
    title: 'Edge on iPhone or iPad',
    steps: ['Open iPhone Settings > Apps > Edge and turn Camera on.', 'Come back to Prima, reload the page and tap Try again.'],
  },
  {
    id: 'desktop-chrome',
    title: 'Chrome on a computer',
    steps: [
      'Click the icon on the left of the address bar (two sliders or a lock).',
      'Turn Camera on (or open Site settings and set Camera to Allow), then reload the page.',
      'On Windows, also check Settings > Privacy & security > Camera: camera access and "Let desktop apps access your camera" on.',
    ],
  },
  {
    id: 'desktop-edge',
    title: 'Edge on a computer',
    steps: [
      'Click the lock on the left of the address bar > Permissions for this site.',
      'Set Camera to Allow, then reload the page.',
      'On Windows, also check Settings > Privacy & security > Camera is on.',
    ],
  },
  {
    id: 'mac-safari',
    title: 'Safari on a Mac',
    steps: ['Safari menu > Settings > Websites > Camera.', 'Set this site to Allow, then reload the page.', 'Also check System Settings > Privacy & Security > Camera.'],
  },
];

const LOCATION: HelpGuide[] = [
  {
    id: 'android-chrome',
    title: 'Chrome on Android',
    steps: [
      'Make sure the phone Location is on: swipe down from the top and tap Location.',
      'Tap the icon on the left of the address bar > Permissions (or Site settings) > Location > Allow.',
      'Still blocked? Phone Settings > Apps > Chrome > Permissions > Location > Allow only while using the app, with "Use precise location" on.',
      'Come back to Prima and tap Try again.',
    ],
  },
  {
    id: 'android-edge',
    title: 'Edge on Android',
    steps: [
      'Make sure the phone Location is on.',
      'Tap the menu (···) > Settings > Privacy and security > Site permissions > Location, and allow this site.',
      'Still blocked? Phone Settings > Apps > Edge > Permissions > Location > Allow, precise location on.',
    ],
  },
  {
    id: 'android-samsung',
    title: 'Samsung Internet',
    steps: ['Make sure the phone Location is on.', 'Tap the menu (three lines) > Settings > Sites and downloads > Site permissions > Location, and allow this site.'],
  },
  {
    id: 'ios-safari',
    title: 'Safari on iPhone or iPad',
    steps: [
      'iPhone Settings > Privacy & Security > Location Services: on.',
      'In the same list, Safari Websites: While Using the App, with Precise Location on.',
      'In Safari, tap aA > Website Settings > Location > Allow.',
      'Come back to Prima and tap Try again.',
    ],
  },
  {
    id: 'ios-chrome',
    title: 'Chrome on iPhone or iPad',
    steps: ['iPhone Settings > Privacy & Security > Location Services > Chrome: While Using the App, with Precise Location on.', 'Come back to Prima, reload and tap Try again.'],
  },
  {
    id: 'ios-edge',
    title: 'Edge on iPhone or iPad',
    steps: ['iPhone Settings > Privacy & Security > Location Services > Edge: While Using the App, with Precise Location on.', 'Come back to Prima, reload and tap Try again.'],
  },
  {
    id: 'desktop-chrome',
    title: 'Chrome on a computer',
    steps: [
      'Click the icon on the left of the address bar and turn Location on (or Site settings > Location > Allow), then reload.',
      'On Windows, also check Settings > Privacy & security > Location: Location services on, and "Let desktop apps access your location" on.',
    ],
  },
  {
    id: 'desktop-edge',
    title: 'Edge on a computer',
    steps: ['Click the lock on the left of the address bar > Permissions for this site > Location > Allow, then reload.', 'On Windows, also check Settings > Privacy & security > Location is on.'],
  },
  {
    id: 'mac-safari',
    title: 'Safari on a Mac',
    steps: ['Safari menu > Settings > Websites > Location: set this site to Allow.', 'System Settings > Privacy & Security > Location Services: on for Safari.', 'Reload the page.'],
  },
];

/** The guide id for this device and browser. */
export function guideId(p: Platform): string {
  if (p.os === 'ios') return p.browser === 'chrome' ? 'ios-chrome' : p.browser === 'edge' ? 'ios-edge' : 'ios-safari';
  if (p.os === 'android') return p.browser === 'edge' ? 'android-edge' : p.browser === 'samsung' ? 'android-samsung' : 'android-chrome';
  if (p.os === 'mac' && p.browser === 'safari') return 'mac-safari';
  return p.browser === 'edge' ? 'desktop-edge' : 'desktop-chrome';
}

/** Every guide for the kind, this device's first. */
export function permissionHelp(kind: PermKind, p: Platform): { mine: HelpGuide; others: HelpGuide[]; inAppNote: string | null } {
  const all = kind === 'camera' ? CAMERA : LOCATION;
  const id = guideId(p);
  const mine = all.find((g) => g.id === id) ?? all[0];
  return {
    mine,
    others: all.filter((g) => g !== mine),
    inAppNote: p.inApp ? 'You opened Prima inside another app (such as WhatsApp or Teams). Open it in Chrome, Edge or Safari instead: apps often block the camera and location.' : null,
  };
}
