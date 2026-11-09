/**
 * P96 (Fitri, 10 Nov 2026: "we will export it to APK and iOS later"): Prima in a browser, installed from the browser,
 * or wrapped as the Android and iOS app (a WebView, see apps/prima/docs/P96_MOBILE_APP_READY.md). A WebView cannot
 * print, open a second window or download a blob the way a browser does; these helpers keep every such button working
 * there: printing falls back to saving the page as a file, a new window falls back to a download, and the person is
 * told plainly what happened.
 */
import { saveFile } from './save';
import { notify } from './ui';

interface CapacitorLike {
  isNativePlatform?: () => boolean;
}

/** The wrapped app: Capacitor says so, or the wrapper adds "PrimaApp/" to the browser name (capacitor.config). */
export function inAppShell(w: { Capacitor?: CapacitorLike; navigator?: { userAgent?: string } } = typeof window === 'undefined' ? {} : (window as never)): boolean {
  try {
    if (w.Capacitor?.isNativePlatform?.()) return true;
  } catch {
    /* not the wrapper */
  }
  return /\bPrimaApp\//.test(w.navigator?.userAgent ?? '');
}

const PRINT_IN_APP = 'Printing is not available inside the app. The page was saved as a file instead: open it, then print or share it.';
const PRINT_BLOCKED = 'This screen could not print here. The page was saved as a file instead: open it, then print it.';

/** The screen as one HTML file (styles inlined from the page), for saving where printing is not possible. */
function pageAsHtml(title: string): string {
  const styles = [...document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel=stylesheet]')]
    .map((s) => (s instanceof HTMLLinkElement ? `<link rel="stylesheet" href="${s.href}">` : s.outerHTML))
    .join('\n');
  const main = (document.querySelector('.main .view-host') ?? document.querySelector('.main') ?? document.body).innerHTML;
  return `<!doctype html><html lang="${document.documentElement.lang || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title.replace(/[<&]/g, '')}</title>${styles}</head><body class="print-copy">${main}</body></html>`;
}

/** Print the screen. Inside the app (no printing there) the screen is saved as an HTML file to print from elsewhere. */
export async function printPage(title = 'Prima'): Promise<void> {
  if (!inAppShell() && typeof window.print === 'function') {
    window.print();
    return;
  }
  const failed = await saveFile(`${title}.html`, new Blob([pageAsHtml(title)], { type: 'text/html' }));
  notify(failed ?? (inAppShell() ? PRINT_IN_APP : PRINT_BLOCKED));
}

/** Open a ready HTML report in a new window to print; inside the app, or when the new window is blocked, save it. */
export async function printHtml(title: string, html: string): Promise<void> {
  const w = inAppShell() ? null : window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.print();
    return;
  }
  const failed = await saveFile(`${title}.html`, new Blob([html], { type: 'text/html' }));
  notify(failed ?? (inAppShell() ? PRINT_IN_APP : 'The browser blocked the new window. The report was saved as a file instead.'));
}

/** Show a stored file: a new tab in a browser; saved as a file inside the app or when the new tab is blocked. */
export async function openBlob(name: string, blob: Blob): Promise<void> {
  if (!inAppShell()) {
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    // With 'noopener' the browser returns null even when the tab opened; only a refused pop-up throws or is ignored,
    // so the file is opened in a tab and that is enough in a browser.
    void w;
    return;
  }
  const failed = await saveFile(name, blob);
  if (failed) notify(failed);
}
