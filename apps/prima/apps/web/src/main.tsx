import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
// P90: the page-by-page spacing pass; loaded last so its shared rules settle the older ones.
import './styles/ux.css';
// P96: phone first and ready for the Android and iOS app wrapper; loaded after the spacing pass.
import './styles/mobile.css';
import { startMobile } from './mobile';

declare const __DEMO__: boolean;

startMobile();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The fonts are linked as print-only so they never hold up the first screen; switch them on once the app runs, in case
// the page's own onload switch is not allowed where the app is hosted.
document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet][media=print]').forEach((l) => (l.media = 'all'));

// Installable app with an offline shell. Not registered in the single-file test version,
// where service workers are not available.
if (!__DEMO__ && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Under its own path when served beside another app (Agentic Office: /prima/).
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined);
  });
}

// P75: the Agentic Office's feedback button (built by apps/web, served by the office at the site root as
// /feedback-widget.js). Loaded at run time, only inside the office (not in the test version, which has no office).
// P80: in host mode: Prima's own launcher (Launcher.tsx) opens its panels, so it draws no button of its own.
if (!__DEMO__ && import.meta.env.VITE_OFFICE === 'true') {
  window.__agenticLauncher = 'host';
  const widget = document.createElement('script');
  widget.type = 'module';
  widget.src = '/feedback-widget.js';
  document.body.appendChild(widget);
}
