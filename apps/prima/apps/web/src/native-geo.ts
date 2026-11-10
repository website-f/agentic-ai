/**
 * P97 (Fitri, 11 Nov 2026: "the location must be logged even if they close the thing"): following the location in the
 * background. A web page (Chrome, Safari, the installed web app) cannot read the location once Prima is closed or the
 * phone is asleep: no browser allows it. The Prima app for Android and iPhone (the Capacitor wrapper,
 * docs/P96_MOBILE_APP_READY.md) can, with the background-geolocation plugin installed in the wrapper
 * (@capacitor-community/background-geolocation): the phone shows a notification "Prima is following your location
 * while you are clocked in" and keeps sending positions with Prima in the background.
 *
 * This file only talks to that plugin when it is there; in a browser it says it is not, and the tracker keeps to the
 * web's watchPosition. It never starts on its own: the tracker starts it after a check-in and stops it at check-out.
 */
import { inAppShell } from './native';

/** One position from the plugin (the fields Prima reads). */
export interface NativeFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  time: number | null;
}

interface WatcherOptions {
  backgroundMessage?: string;
  backgroundTitle?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
}

/** The plugin's calls Prima uses (@capacitor-community/background-geolocation 1.x). */
interface BackgroundGeolocationPlugin {
  addWatcher(options: WatcherOptions, callback: (fix?: NativeFix, error?: { code?: string; message?: string }) => void): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings?(): Promise<void>;
}

type Win = { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } };

/** The plugin, when Prima runs inside its own app with the plugin installed; otherwise null (a browser). */
export function backgroundGeo(w: Win | undefined = typeof window === 'undefined' ? undefined : (window as never)): BackgroundGeolocationPlugin | null {
  try {
    if (!w || !inAppShell(w as never)) return null;
    const p = w.Capacitor?.Plugins?.BackgroundGeolocation as BackgroundGeolocationPlugin | undefined;
    return p && typeof p.addWatcher === 'function' && typeof p.removeWatcher === 'function' ? p : null;
  } catch {
    return null;
  }
}

/**
 * Start following in the background with the plugin. Calls `onFix` for each position and `onDenied` when the person
 * refused location for the app. Returns the stop function, or null when there is no plugin (then the web path is used).
 */
export async function startBackgroundGeo(
  onFix: (f: NativeFix) => void,
  onDenied: () => void,
  plugin: BackgroundGeolocationPlugin | null = backgroundGeo(),
): Promise<(() => void) | null> {
  if (!plugin) return null;
  try {
    const id = await plugin.addWatcher(
      {
        backgroundTitle: 'Prima: clocked in',
        backgroundMessage: 'Prima is following your location while you are clocked in. It stops when you check out.',
        requestPermissions: true,
        stale: false,
        // A position about every 25 m moved; still phones send little (battery).
        distanceFilter: 25,
      },
      (fix, error) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') onDenied();
          return;
        }
        if (fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)) onFix(fix);
      },
    );
    return () => void plugin.removeWatcher({ id }).catch(() => undefined);
  } catch {
    return null;
  }
}
