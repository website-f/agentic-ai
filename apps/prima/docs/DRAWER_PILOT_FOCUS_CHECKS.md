# Bounded shared Drawer improvements

The dialog has a unique visible-title/aria-labelledby binding and a focusable container. On mount the topmost dialog receives initial focus. Escape closes only the topmost dialog and respects already-consumed/composing key events. On cleanup, focus returns only to a connected prior opener (or a remaining dialog), without stealing focus deliberately moved elsewhere. A stable callback ref prevents inline onClose updates from resetting focus while staff type. Child-first nested effect mounting and React's detached-node cleanup are covered in synthetic tests.

This deliberately does **not** introduce a shared Tab focus trap, inert/background hiding or scroll-lock redesign in the pilot bundle. Those remain accessibility gaps requiring separate implementation and actual keyboard/screen-reader UAT. This is not a WCAG compliance or accessibility certification claim.

CI additions required in the combined candidate:
- Existing Node test job: `node --test scripts/drawer-focus.test.mjs`.
- Existing synthetic browser job, with its existing CI_SYNTHETIC_BROWSER and PLAYWRIGHT_MODULE environment: `node scripts/drawer-browser-smoke.mjs`.
- Keep `node scripts/connections-browser-smoke.mjs`: it now checks direct safe file-link attributes without opening external pages, plus explicit parse-only setup preview and user-bound IT-ticket receipt. These are in-page synthetic services, not Graph/admin grants.

Local evidence: seven fake-DOM/helper and actual React SSR tests; web typecheck; browser-script syntax checks. Browser scenarios are prepared, not locally executed. They must pass combined CI before claiming browser behavior. No live services or source data used.
