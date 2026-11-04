# P61: the Library as a full-page file explorer

**Where:** the Library item in the menu (/files) now opens **/explorer**, a full page outside the
app's sidebar, like the full-screen chat. **Back** returns to where you came from, else home.
/files redirects there with its search params, so old links keep working.

## Desktop
- **Header:** Back, the company picker, "More in the Library" (the other tabs, Download
  everything), hide or show the folder tree, the bell and the account menu.
- **Folder tree** on the left: counts per folder. It takes dropped files, and a folder opens while
  you hold a drag over it.
- **Toolbar:**
  - Up, and the breadcrumb (also a drop target);
  - search (folders and files);
  - New folder, Upload, Paste;
  - Ask AI to organize;
  - Filter (type, label, made by AI, held back) and Sort (name, date, size, type);
  - Grid, List or Details view (sortable columns).
- **Selection:**
  - click, Ctrl/Cmd-click, Shift-click, Ctrl/Cmd+A, Escape, arrow keys;
  - a right-click menu, with the same actions in each item's "…" button.
- **Shortcuts:** Ctrl/Cmd+C, X, V; F2 to rename; Delete; Enter to open; Backspace or Alt+Up to go up.
- **Drag and drop:**
  - files and folders onto folders, to move them;
  - hold Ctrl while dropping to copy instead;
  - files dropped from your computer upload into that folder.
- **Status bar:** "N selected · size".

## Phone
- One column, with a Folders sheet.
- Tap opens; a long press selects.
- A bottom bar acts on the selection: Move, Copy, Labels or Download, Delete, More.
- Touch targets are 44px.

## Folders
- Create a folder, including an empty one.
- Rename or move a folder: everything inside moves with it.
- Delete a folder, only when it is empty.

## Labels
- Your own labels on any file: up to 12, each with a colour from its text. Edit them on one file
  or a selection, pick from labels already used, and filter by them.
- Files an AI agent made show **Made by AI** with the agent's name.
- The file's type (quotation, invoice...) stays editable.

## Previews
Double-click opens the side panel, which keeps previous/next and the file's actions:
- **Excel and CSV:** a grid with sheet tabs, column letters and row numbers.
- **Word:** a formatted page, built server-side from escaped text and checked again in the browser.
- **PDF and pictures:** shown in the panel.
- **Audio and video:** play in place.
- **Text, code, Markdown and JSON:** as text.
- **PowerPoint and old `.xls`:** their text (the libraries for richer previews are not installed).

## Ask AI to organize
On a folder or a selection, this opens a task, ready to give an agent, to file those documents
into sensible subfolders the way the company already keeps things (`list_folders`,
`file_document`).

## API (apps/api/agentic/api/routers/files.py, company_files.py)
- `POST /api/files/copy {ids, folder}` → `{copied, ids, skipped}`. It copies the bytes and details.
  The name gets "(copy)" only on a name clash, and held-back files are skipped.
- `POST /api/files/folders` and `/folders/rename`: rename also moves everything inside, and moving
  a folder into itself is refused.
- `POST /api/files/folders/delete`: answers 409 while the folder holds files. Empty folders are
  kept in the workspace setting `file_folders` and listed in `/tree`.
- Labels: `PATCH /api/files/{id} {labels}`, `POST /api/files/labels {ids, add, remove}`,
  `GET /api/files/labels`, and `GET /api/files?label=`.
- `GET /api/files/{id}/view` returns table, html, text, pdf, image, media or none
  (`documents/viewer.py`). Held-back files answer 403, as their preview does.
- `GET /api/files/{id}/download?inline=1` is inline only for PDF, pictures, audio and video. HTML,
  SVG and XML are always downloaded.

Migration `0045` (`files.labels`).

## P61b: the whole Library in one full-screen page
Before this, only Browse was full screen. Documents, SOPs, Guidelines, Templates, Packs, the
Company kit and Search still opened inside the old app shell, with its sidebar, so picking SOPs
from the explorer seemed to jump back to the old design.

Now every Library address opens in one full-screen frame (`apps/web/src/pages/explorer/frame.tsx`,
the pathless route `library` in `router.tsx`). The addresses and deep links are unchanged:
`/explorer?f=&folder=&view=&task=&from=`, `/documents?d=&new=&view=`, `/sops?sop=`, `/packs?p=`,
`/company-kit?b=` and `/search?q=`. `/files` still redirects to `/explorer`.
- **Header:** Back, "Library", the company picker, the whole-Library search (wide screens), the
  folder-tree toggle (Browse only), Download everything (when a company is picked), the bell and
  the account menu. Changing the company while on Browse goes back to that company's top folder.
  On the Company kit page, it opens that company's kit.
- **Tabs:** Browse, Documents, SOPs, Guidelines, Templates, Packs, Company kit and Search, in a row
  under the header. The row scrolls sideways on phones and keeps the open tab in view. Browse
  reopens the folder you last had open. The tabs replace the old "More in the Library" menu.
- **Back:** goes to the page you were on before you opened the Library, however many tabs and
  folders you opened since. Without such a page, it goes to `?from=`, else home. Each history
  entry stores where the visit began (sessionStorage, by router key), so this still works after a
  reload or the browser's own Back and Forward.
- **Pages:** Browse keeps its own full-height layout (folder tree and browser). The other tabs
  scroll in one area under the tabs. A new page starts at the top, and the browser's Back returns
  to where you were (`scrollToTopSelectors`). Inside the frame, `LibraryHeader` shows only the
  tab's own title, description and actions, because the frame already has "Library", the search
  and the tabs (the `InLibraryFrame` context). Phone action bars stick to the bottom, since there
  is no app tab bar (`--bottom-bar`).
- **Set up once in the frame:** the company store, live updates, the app badge, the command
  palette (Ctrl K) and the task composer.
