"""P55: built-in skills for everyday office work (letters, filing, compiling, claims, HR
paperwork, replies, proofreading, tenders, status reports, research, spreadsheets).

Written in the open Agent Skills format (agentskills.io: a name, a description that says
when to use it, then the steps), the same shape community skill packs use, and pointed at
this office's own tools (draft_document, file_document, compile_documents, fill_form,
P140: docx_edit, xlsx_edit, pdf_edit, pptx_edit...).
store.BUILTIN includes them, so every workspace gains them once (store.ensure_builtin).
"""

OFFICE_SKILLS: list[tuple[str, str, str]] = [
    (
        "write-business-letter",
        "Write a formal business letter (offer, warning, confirmation, appointment, reply) on "
        "the company's letterhead, in English or Malay.",
        """## When to use
Someone asks for a letter: an offer or appointment letter, a warning, a confirmation, a reply
to a supplier, customer or government office.

## Steps
1. list_templates: use the company's own letter template when one fits; company_kit gives
   the legal name, registration number, address and signatory.
2. Gather the facts the letter needs (names, dates, amounts, reference numbers). Ask
   (ask_human) for anything missing; never invent a name, amount or date.
3. Write it with draft_document. Malaysian business style:
   - our reference and date at the top; the recipient's name, title and address;
   - English: "Dear Sir/Madam" or "Dear Encik/Puan <name>"; Malay: "Tuan/Puan,";
   - a bold subject line ("RE: ..." / "PER: ...");
   - one point per paragraph, numbered when there are several;
   - close with "Yours faithfully" (Malay: "Sekian, terima kasih." then "Yang benar,");
   - the signatory's name and position from the company kit.
4. check_document, then export_document as PDF (and Word if they will edit it).

## Output format
The draft for review, with one line on what still needs a person (a signature, a date).

## Pitfalls
- Never send a letter outside the company yourself: it waits for a person's review.
- Warning and termination letters: keep to facts and dates; no opinions.
""",
    ),
    (
        "file-documents",
        "File documents into the right folders (by type, party and month) the way the "
        "company already keeps them, and say what moved where.",
        """## When to use
Someone asks to file, sort, organise or tidy documents (receipts, invoices, staff papers,
contracts, letters).

## Steps
1. list_folders to learn how people already file. Follow their pattern; create a new folder
   only when nothing fits, using "Area/Type/Year-Month" (e.g. "Finance/Receipts/2026-10").
2. list_files (or search_documents) for the files to file. read_file only when the name does
   not say what it is (type, party, date).
3. Decide each file's folder: what it is, who it is about or from, and its date.
4. file_document in batches of the same destination.
5. Name files people cannot recognise with rename_file only if they are files you made or
   fetched for this task.

## Output format
A short table: file, from, to. Then anything you left alone and why.

## Pitfalls
- Never file a file you are unsure about: list it as "left alone" with your guess.
- Held-back files (secrets or personal data) stay where they are.
- Tidying a whole Library unit or company (many files): use the organize-library skill.
""",
    ),
    (
        "organize-library",
        "Organize a Library unit's or company's uploaded files (e.g. Unit HR) into folders by "
        "what each file is and its date, with keywords: plan first, show it, apply only after "
        "the person agrees; never delete.",
        """## When to use
Someone asks to organize, sort, group, tidy or arrange files in the Library: "please organize
the HR files", "susun fail Unit Kewangan", "group the payslips by month", "tag these as
payroll". Also when uploads were left loose at the top of a unit.

## Steps
1. Find the place: a unit (unit = hr, audit or finance: Unit HR, Unit Audit, Unit Kewangan),
   a department, or your company. list_folder_tree shows its folders, how many files lie
   loose, and the place's sorting rules. If you may not organize that place you get an error:
   say so plainly; never try another way round it.
2. suggest_organization for that place (folder = one folder when they named one). It plans,
   it moves nothing: each loose file goes to a folder by what it is (Payroll, Leave, Claims,
   Invoices, Contracts, Minutes, Letters, Reports, Policies, Forms...) and its date
   (Year/Month from the file name, its keywords or its first page, e.g. "Payroll/2026/11"),
   following the folders people already have. Add use_ai=true only when many files are left
   with "nothing to go by".
3. Show the plan to the person as a short table (file, from, to) with the files left alone
   and why. Ask (ask_human, options "Apply" / "Change" / "Cancel") before anything moves.
4. Only after they agree: apply_organization with confirmed=true and the moves (drop or
   change the ones they asked to). For a few files, move_files is enough.
5. Keywords: when they give words for files ("tag these as payroll, nov 2026") use tag_files;
   keywords are lower case and help people filter and search the Library.
6. Names: keep every file's original name unless the person asks for new names; then
   rename_file one by one.

## Output format
What moved where (a table, or counts per folder when there are many), the files left alone
and why, and any new folders.

## Pitfalls
- Never delete a file or a folder, and never move a file a person placed in a folder (the
  plan leaves them alone; so do you).
- Held-back files (passwords or personal data) stay where they are.
- Stay inside the place asked for: another unit's files are not yours to organize.
- A date in a file name is not always the document's date (a reference number can look like
  one): when the plan's reason looks wrong, leave that file and say so.
""",
    ),
    (
        "compile-document-pack",
        "Compile several files and drafts into one PDF with a contents page: a claim with its "
        "receipts, a staff file, a month's invoices, a submission.",
        """## When to use
Someone wants documents put together into one file to send, print or keep.

## Steps
1. Find every item (list_files, search_documents, or drafts you made). Confirm nothing the
   person named is missing; ask_human if one cannot be found.
2. Put them in a sensible order: the covering letter or form first, then supporting
   documents by date or by the order the requester listed.
3. compile_documents with a clear title ("Claim - Aina - October 2026").
4. If a submission pack exists for this (pack_status), attach the compiled file to it.

## Output format
The compiled file id and page count, the order used, and anything left out with the reason.

## Pitfalls
- A locked (protected) PDF cannot be compiled: say so, do not skip it silently.
""",
    ),
    (
        "summarise-document",
        "Summarise a long document (contract, report, tender, circular) into key points, "
        "figures, dates and obligations, with page references.",
        """## When to use
Someone shares a long document and wants to know what it says or what they must do.

## Steps
1. read_file in parts (use `find` for the sections that matter: scope, price, dates,
   penalties, termination, obligations).
2. Pull out: what it is, who the parties are, the key numbers, every deadline, what each
   party must do, and anything unusual or risky.
3. Quote exact figures and dates; give the page for each.

## Output format
- One-sentence summary.
- Key points (5-8 bullets, each with its page).
- Dates and deadlines table.
- "Watch out for" (risks or unusual terms).

## Pitfalls
- Do not paraphrase numbers or legal terms loosely; quote them.
""",
    ),
    (
        "reply-to-customer",
        "Draft a clear, polite reply to a customer or supplier message (email or WhatsApp) "
        "using what the company knows about them.",
        """## When to use
A customer or supplier asked something, complained or chased an order, and a reply is needed.

## Steps
1. Read the whole message; note every question asked.
2. Check what the office knows: recall/memory, past quotations or invoices, SOPs.
3. Answer every question in order. Facts only from company records; if unsure, say you will
   check and by when.
4. Match their language (English or Malay) and keep a warm, professional tone.
5. Save it as a draft (email_draft_reply or draft_document); a person sends it.

## Output format
The draft reply, then one line listing anything you could not confirm.

## Pitfalls
- Never promise prices, discounts, delivery dates or refunds the records do not support.
- Complaints: acknowledge first, then the facts, then the next step.
""",
    ),
    (
        "expense-claim",
        "Prepare a staff expense claim: check every receipt, total it, fill the company claim "
        "form and compile it with the receipts.",
        """## When to use
Someone asks to make, check or submit an expense or mileage claim.

## Steps
1. Collect the receipts (list_files, or the files given to the task); read each one:
   date, vendor, amount, tax, what it was for.
2. Flag receipts that are unreadable, duplicated, outside the claim period or missing tax
   details.
3. calc the total per category and overall; never add in your head.
4. If the company has a claim form (describe_form), fill_form it for the person.
5. compile_documents: the filled form first, then the receipts in date order.

## Output format
A table (date, vendor, category, amount), the total, the compiled file, and flagged items.

## Pitfalls
- Never change an amount on a receipt; report differences instead.
""",
    ),
    (
        "staff-onboarding-file",
        "Set up a new staff member's paperwork: offer or appointment letter, the documents to "
        "collect, and a tidy staff file.",
        """## When to use
HR asks to onboard a new hire or to prepare their paperwork.

## Steps
1. Gather: full name, IC or passport number, position, department, start date, salary and
   reporting manager. ask_human for anything missing.
2. Draft the appointment letter (write-business-letter steps) from the company template.
3. Make a checklist of what to collect: copy of IC, bank account details, EPF (KWSP), SOCSO
   (PERKESO), EIS and income tax (LHDN) numbers, emergency contact, signed letter.
4. Create the staff folder ("HR/Staff files/<Name>") and file what has arrived there
   (file_document).
5. Set follow-ups for missing items (notify_person or a reminder).

## Output format
The draft letter, the checklist with done or missing, and the folder path.

## Pitfalls
- IC and bank numbers are personal data: never put them in chat or reports, only in the
  staff file.
""",
    ),
    (
        "proofread-document",
        "Proofread a document for spelling, grammar, consistency of names, numbers and dates, "
        "and formatting, and list each fix.",
        """## When to use
Someone asks to check, proofread or polish a document before it goes out.

## Steps
1. read_file (or the draft) in full.
2. Check: spelling and grammar (English or Malay, not mixed by accident); names spelled the
   same everywhere; numbers and totals agree (calc); dates and days of the week match;
   headings and numbering consistent; company details match company_kit.
3. For a draft you may edit, apply the fixes with revise_document; otherwise list them.

## Output format
A numbered list: where, what is wrong, the fix. Most serious first.

## Pitfalls
- Do not rewrite the author's meaning or tone; fix errors only unless asked.
""",
    ),
    (
        "tender-document-check",
        "Check a tender or quotation submission against its requirements: every document "
        "present, signed, valid and not expired.",
        """## When to use
Before a tender, quotation or registration is submitted.

## Steps
1. Read the requirements (the tender document or pack checklist: pack_status).
2. For each required item find the file (search_documents) and check it is the right
   document, signed and stamped where needed, and not expired (SSM, CIDB, MOF, bank
   statements, audited accounts usually have dates).
3. pack_attach what matches; list what is missing or expiring within 30 days.
4. When complete, compile_documents in the order the tender asks.

## Output format
A checklist table: requirement, file, status (ok, missing, expired, unsigned), note.

## Pitfalls
- The tender's own order and naming win over yours.
- Never submit on a portal yourself; a person submits.
""",
    ),
    (
        "weekly-status-report",
        "Write a short weekly status report: what was done, what is stuck, what is next, with "
        "numbers from the task board.",
        """## When to use
A manager asks for a weekly (or monthly) update on a team, project or the agent's own work.

## Steps
1. Gather the facts: tasks finished, still open and blocked in the period; figures that
   matter (sales, collections, tickets) from the records you can read.
2. Group by project or area. Name owners for blocked items.
3. publish_report with a short summary table.

## Output format
- Headline: one sentence on how the week went.
- Done, In progress, Blocked (who can unblock), Next week.

## Pitfalls
- No vague words ("various", "several"): give counts and names.
""",
    ),
    (
        "research-brief",
        "Research a question on the web and write a short brief with sources: options, prices, "
        "rules or competitors.",
        """## When to use
Someone asks to find out, compare or check something outside the company.

## Steps
1. Restate the question and what a good answer looks like (e.g. three options with prices).
2. web_search with several phrasings, including Malaysian sources when it is about Malaysia
   (.gov.my, .com.my).
3. Read the best pages (web_fetch). Prefer official and recent sources.
4. publish_research when it is worth keeping for the office.

## Output format
Answer first, then a short comparison or findings list, each point with its source link and
date.

## Pitfalls
- Note when a source is old or unofficial. Never present a guess as a fact.
""",
    ),
    (
        "clean-spreadsheet",
        "Clean up a spreadsheet or list: remove duplicates, fix dates and phone numbers, split "
        "names, and report every change.",
        """## When to use
Someone gives you a messy Excel or CSV list (customers, stock, staff) to tidy.

## Steps
1. Look at the columns and a sample of rows first; say what is wrong (duplicates, mixed date
   formats, phone numbers without +60, extra spaces, blank rows).
2. xlsx_edit for direct changes (find_replace, set_cells, delete_rows), or run_python to clean
   a copy when the rules need code: never overwrite the original.
3. Count rows before and after; list removed duplicates.

## Output format
The cleaned file, then a short list: what changed and how many rows each rule touched.

## Pitfalls
- Two rows that look alike may be two people; only merge exact duplicates unless told.
""",
    ),
    (
        "edit-office-files",
        "Change an existing Word, Excel, PDF or PowerPoint file (replace names or dates, fill "
        "cells or a PDF form, stamp, rotate, split, merge, number pages) and keep the original; "
        "repeated jobs are learned and redone without the model.",
        """## When to use
Someone gives you a file to change rather than a new document to write: update a name, date
or amount in a Word letter or contract; put figures into an Excel sheet; stamp PAID, COPY or
a reference on a PDF; take out, rotate, reorder or merge pages; fill a fillable PDF form;
number pages; change the text on PowerPoint slides. Also the same change on many files.

## Steps
1. Find the file (the task's attached files, list_files or search_documents). read_file it
   first when you need to see the exact wording, the table numbers or the sheet names.
2. Use the editor for its type, with all the changes in one call where you can:
   - Word: docx_edit (replace_text, append_paragraph, insert_paragraph_after,
     set_table_cell, add_table_row, delete_paragraph_containing).
   - Excel: xlsx_edit (set_cells, append_rows, find_replace, add_sheet, rename_sheet,
     delete_rows, set_column_width). A company form: fill_form instead.
   - PDF: pdf_edit (extract_pages, delete_pages, rotate_pages, reorder, merge_with,
     stamp_text, fill_form_fields, add_page_numbers; list_form_fields shows a form's fields).
   - PowerPoint: pptx_edit (replace_text; list_texts shows each slide's text).
3. Each call saves a NEW file next to the original and returns its id; use that id for the
   next step (edit again, export, compile_documents, file_document).
4. Give the exact values from the task (names, dates, amounts) as written there: that is
   what lets the office learn the job and repeat it on the next file without the model.
5. Do not use run_python for these changes: code written for the occasion cannot be learned
   or repeated, and the editors keep the formatting.

## Output format
One line per file: what changed and the new file's id and name. Say what a person still has
to check (a signature, a figure you could not confirm).

## Pitfalls
- An operation that finds nothing is an error, so a wrong file is caught; mark an operation
  "optional": true only when it may rightly find nothing.
- Excel: deleting rows does not shift formulas elsewhere; pictures and charts in a workbook
  are not kept in the edited copy (say so if the file had them).
- Never present the edited copy as sent or signed: a person reviews it.
""",
    ),
    (
        "design-poster",
        "Make a poster, flyer, notice, social-media post or greeting card (event, hiring, "
        "promotion, safety notice, training, festive, stats, tender notice, menu, webinar, thank "
        "you, product) from ready templates with the company's logo and colours: PNG and PDF.",
        """## When to use
Someone wants something to print or post: a poster, flyer, notice-board sheet, Instagram or
Facebook post, WhatsApp status, LinkedIn banner, a festive greeting. Not for a letter or a
report (use draft_document) and not for an illustration or photo (generate_image).

## Steps
1. Pick the template (design_templates only if none below fits):
   event (dinners, launches) · announcement (closures, new policy) · hiring (jawatan kosong)
   · sale (promotions; big = "30%") · safety (rules, warnings; palette safety-yellow
   warning, safety-red prohibition, safety-blue mandatory, safety-green safe) · training
   (courses with modules) · festive-raya / festive-cny / festive-deepavali /
   festive-christmas / festive-merdeka · quote-milestone (a leader's words, "10 years")
   · stats (3-6 numbers) · tender-notice (formal notices, ref + label|value rows) · menu
   (items "Name|RM8.50|note") · webinar (people "Name|Role") · thank-you · product.
2. Size from where it goes: print a4-portrait (notice board a3-portrait); Instagram/Facebook
   ig-square; story or WhatsApp status ig-story / whatsapp-status; Facebook fb-post;
   LinkedIn linkedin-post or linkedin-banner. Several places: a list of up to 4 sizes.
3. Write the slots short, in the language people asked for (Malay or English): headline
   under 6 words; kicker 1-3 words; one subhead; details as "Label|Value" (Tarikh, Masa,
   Tempat); cta a few words; footer the contact line. Use only facts from the task; ask
   (ask_human) for a missing date, venue or number, never invent one. No emoji.
4. A photo: the id of a picture in the files (the task's attachment, list_files). The
   company logo and colour are added by themselves (palette "brand"); leave palette out
   unless asked for a colour or the template has its own (festive, safety, tender).
5. design_poster once. Read "Looks:" to check it; if text was cut short, shorten it.
6. Changes ("make the date bold", "change the venue", "in English", "story size"):
   design_revise with the poster's file id and ONLY the slots or size that change.

## Output format
The PNG and PDF file ids and names, one line on what it shows, and what a person should
check (dates, phone numbers, spelling of names).

## Pitfalls
- Never write HTML, CSS or code for a poster, and never call generate_image for text
  posters: the templates already do the design and cost almost nothing.
- Keep the same template, size and slot names for repeated jobs (monthly notices, weekly
  promotions): the office learns the job and repeats it without the model.
- Sensitive notices (safety, tender) must quote the exact rules, numbers and dates given.
""",
    ),
]
