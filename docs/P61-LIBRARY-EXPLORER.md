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
