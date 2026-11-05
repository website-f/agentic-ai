import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

declare const __DEMO__: boolean;

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
