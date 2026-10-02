# Document Studio (P10)

The office prepares real documents for people to check and send: it reads the files a
company hands over, keeps each company's facts in one place, fills templates, checks every
draft, exports PDF / Word / Excel, and compiles submission packs into one PDF. People approve
documents and submit packs themselves; nothing leaves the office on its own.

Sidebar: **Documents** — Company kit → Files → Templates → Documents → Packs (the order you
set things up in).

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Files | `files` table, `api/routers/files.py` | Uploads (raw `application/octet-stream`, 20 MB). The bytes live in Postgres so api and worker both reach them and the database backup covers them. |
| Reading | `documents/extract.py`, `workflows/document_*.py` | The worker reads each upload once: PDF text (pypdfium2), Word, Excel, CSV, text; OCR (Tesseract, English + Malay) for scans and photos. The `fast` group then writes a kind, title, summary, up to 12 key facts and an expiry date. Agents read this text, never the raw file again. |
| Company kit | `company_kits` (one per branch), `documents/fill.py` `KIT_FIELDS` | Legal name, registration and tax numbers, address, contacts, bank, signatory, tax rate, payment terms, colour, logo, plus custom facts. Templates use `{{company.<key>}}`. |
| Templates | `doc_templates`, `documents/starter.py` | Markdown with `{{placeholders}}` and typed fields (text, long text, date, number, amount, line items, choice), or your own Word file filled in place (`documents/docx_template.py`, keeps its layout; `{{item.*}}` table rows repeat per line item). Eight starters per workspace. |
| Documents | `documents`, `document_versions`, `api/routers/documents.py` | Source markdown + field values. Preview, checks and every export render from that one source. Every save keeps the previous version (50 kept). draft → review → approved (locked; reopen to change). Numbers per company and prefix: `QT-2026-0001`. |
| Checks | `documents/checks.py` | Deterministic, free, on every render: missing values, required fields, leftover TODO / TBD / `[insert …]`, table totals that do not add up, registration numbers that differ from the kit, due dates before the document date, kit gaps. Approval is refused while any error remains. |
| Rendering | `render_pdf.py` (fpdf2), `render_docx.py` (python-docx), `render_xlsx.py` (openpyxl) | Letterhead from the kit, A4, tables with numbers right-aligned, sign line, "Page x of y". No browser or office suite needed. |
| Packs | `packs`, `documents/packs.py`, `api/routers/packs.py` | A checklist (typed, or drafted by the `smart` group). Auto-fill matches items to the company's files and documents with the local embedding model plus word overlap (no tokens), marked "please confirm"; expired files are flagged. Compile builds a cover with contents and page numbers, every item as PDF pages (PDF as-is, images fitted to a page, other files as text), and stamps "title · Page n of N" on every page. |

## AI help (people)

All optional, all returned for the person to accept — nothing is saved silently.

- **Fill with AI** (`POST /api/documents/{id}/ai-fill`, smart): fields from a description and up to 5 files. Only keys the template defines are kept; it is told never to invent prices, names or registration numbers.
- **Write with AI** (`POST /api/documents/ai-write`, smart): a whole free-form draft; unknown facts come back as `[[What is needed]]`, which the checks flag.
- **Rewrite a selection** (`POST /api/documents/{id}/rewrite`, fast): shorter, more formal, friendlier, fix grammar, to Bahasa Melayu, to English, or a custom instruction. Shown beside the original; "Use it" applies it.
- **Review with AI** (`POST /api/documents/{id}/review`, smart): up to 8 issues on top of the deterministic checks.
- **Draft checklist** (`POST /api/packs/draft-checklist`, smart).

## Agent tools

Default `allow`, low risk (drafts inside the office only), deniable per agent or blueprint:
`list_files`, `read_file` (pages=, or find= to have the cheap model pull just the relevant
parts — the token saver for long files), `company_kit`, `list_templates`, `draft_document`
(template + values, or free-form body; re-drafting the same title in a task revises it),
`revise_document`, `check_document`, `pack_status`, `pack_attach`.

An agent sees only its own company's files and documents, plus anything given to its task.
Files attached to a task are listed (with their summaries) in the task's first message.
"Ask an agent" on a pack creates a task with a fixed brief: find each item, draft what we
write ourselves, check it, ask a person for what only they have, never submit anything.

## Limits and choices

- 20 MB per file (nginx allows 25 MB). OCR reads up to 40 scanned pages per PDF; text up to 300 pages / 400k characters.
- A Word template exports to Word in its own layout; its PDF uses the standard letterhead layout (no office suite in the image).
- Fonts: Liberation Sans in the container (any Latin text, including Malay); Arial on a Windows dev box; otherwise Helvetica with unsupported characters replaced.
- Downloads are served with `Content-Security-Policy: sandbox`; only PDF and images open inline, never HTML or SVG.
