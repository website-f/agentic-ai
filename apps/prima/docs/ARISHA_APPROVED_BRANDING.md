# Approved Arisha portrait — draft implementation, 31 October 2026

## Approved source

- Canva asset: [`MAHZdTZmsoA`](https://www.canva.com/M/MAHZdTZmsoA).
- Library ID: `libfile_c7265276b32081918d4c664cb432186b`.
- File ID: `file_000000003f2481f5a8e8642bb25cb265`; filename: `Arisha-preview.png`.
- Available image: **200 × 200 PNG preview**, unchanged. The reported 1264-pixel original was not available; this is not a high-resolution export or a new generated design.
- SHA-256: `4923e1d8962fb84c27c57115fa9a68198e1c9704adce91d662274e30410748fc`.

## Implementation

`ArishaAvatar.tsx` imports the approved local PNG with `?inline`. The existing 56-pixel draggable launcher contains a 52-pixel portrait inside its unchanged border; the chat header uses the same asset at 28 pixels. Existing launcher pointer, keyboard, position and open/close handlers are unchanged. The image does not handle pointer events or native image dragging. The header title can truncate rather than displacing its controls on narrow screens.

Image failure switches to an **A** fallback. Standalone component use has the accessible name “Arisha”; the launcher/header slots are decorative because their button/dialog already provide localized accessible names. No Canva runtime request, account/profile-photo change, AI call, authentication change or connection change is introduced.

The approved Prima Secure logo is **not included**: its retrieval was reported as HTTP 403. No substitute logo was invented or claimed to be approved. Existing application branding outside this avatar is unchanged.

## Verification actually run

| Check | Result |
|---|---|
| `npm run typecheck -w @prima/web` | Passed |
| `VITE_ALLOW_SAME_ORIGIN_API=true npm run build -w @prima/web` | Passed |
| `npm run build:demo -w @prima/web` | Passed |
| `node --test scripts/arisha-avatar.test.mjs` after both builds | **6/6 passed, 0 skipped** |
| `git diff --check` | Passed |

The offline tests verify approved bytes/dimensions, actual component SSR, the captured image `onError` callback followed by a state-driven fallback re-render, decorative accessibility, preserved interaction hooks, and exact PNG bytes embedded in the self-contained demo. These are **not** desktop/mobile browser interaction or visual tests.

Desktop/mobile browser UAT remains **not run** because the local Chromium environment previously rejected its required socket. Before release, check the launcher image, keyboard opening, drag/release, cancellation, header controls and fallback at desktop and narrow mobile widths using an authorized browser environment.

This change is prepared for a separate draft pull request based on main `62ec74795c38ff5c70d5a8b3bb7fe3eac808155b`. It changes only the avatar integration, bundled asset, focused tests and documentation. It does not include the separate IT review UI or import work. No merge or deployment is authorized by this draft; build success is not deployment or runtime-health evidence.
