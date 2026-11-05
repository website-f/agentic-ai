/** Imported first by main.tsx, before the office's i18n (which sets <html lang> as it loads):
 * the page's own language attribute, so the widget can put it back. */
export const HOST_LANG: string | null = document.documentElement.getAttribute("lang");
