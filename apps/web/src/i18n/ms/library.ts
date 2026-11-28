/** The Library: one nav entry for every file, document, SOP and guideline, its tabs, and the
 * Browse tab's folder directory (company folders, ready-made folders, sort, list or grid).
 * "Library" stays "Perpustakaan"; the guideline library is "Garis panduan". */
export const LIBRARY: Record<string, string> = {
  // Navigation
  "Every file, document, SOP and guideline in one place, in folders.": "Setiap fail, dokumen, SOP dan garis panduan di satu tempat, dalam folder.",
  "Every file, document, SOP and guideline in one place: browse the company's folders, or open Documents, SOPs, Guidelines, Templates, Packs, the Company kit and Search as tabs.":
    "Setiap fail, dokumen, SOP dan garis panduan di satu tempat: semak imbas folder syarikat, atau buka Dokumen, SOP, Garis panduan, Templat, Pek, Kit syarikat dan Cari sebagai tab.",
  "AI know-how": "Pengetahuan AI",
  "What your agents know and learn: the brain, the skills they learned, how learning went, and reusable role packages.":
    "Apa yang ejen anda tahu dan pelajari: brain, kemahiran yang mereka pelajari, hasil pembelajaran, dan pakej peranan yang boleh diguna semula.",
  "Give work, follow it, answer what the agents ask you, and automate the jobs you repeat.":
    "Beri tugasan, ikuti perkembangannya, jawab soalan ejen, dan automasikan kerja yang berulang.",

  // Tabs
  "Every file in folders: the company's own folders, plus ready-made folders for documents, SOPs, guidelines, templates and what agents made or downloaded.":
    "Setiap fail dalam folder: folder syarikat sendiri, serta folder sedia ada untuk dokumen, SOP, garis panduan, templat dan apa yang ejen hasilkan atau muat turun.",
  "Written procedures your agents follow. Company and department SOPs apply automatically; the others are attached to specific agents.":
    "Prosedur bertulis yang ejen anda ikuti. SOP syarikat dan jabatan terpakai secara automatik; yang lain dilampirkan pada ejen tertentu.",
  "Open the Documents tab": "Buka tab Dokumen",
  "Open the SOPs tab": "Buka tab SOP",
  "Open the Guidelines tab": "Buka tab Garis panduan",
  "Open the Templates tab": "Buka tab Templat",
  "Upload in Browse →": "Muat naik dalam Semak imbas →",
  "Attached to agents": "Dilampirkan pada ejen",

  // Browse: the folder directory
  "Library folders": "Folder perpustakaan",
  "Company folders": "Folder syarikat",
  "Documents and know-how": "Dokumen dan pengetahuan",
  "Quick views": "Paparan pantas",
  "Task files": "Fail tugasan",
  "Quotations, letters, proposals and reports drafted by people or agents.": "Sebut harga, surat, cadangan dan laporan yang dirangka oleh orang atau ejen.",
  "Written procedures agents follow.": "Prosedur bertulis yang ejen ikuti.",
  "Starting points for the documents you write again and again.": "Titik mula untuk dokumen yang anda tulis berulang kali.",
  "Search this folder": "Cari dalam folder ini",
  "Into the folder {folder}": "Ke dalam folder {folder}",
  "used {n} times": "diguna {n} kali",

  // Sort, list or grid
  Sort: "Susun",
  "Newest first": "Terbaru dahulu",
  "Oldest first": "Terlama dahulu",
  "Name A to Z": "Nama A hingga Z",
  "Show as": "Papar sebagai",
  Grid: "Grid",

  // Guidelines (the guideline library)
  "Add to guidelines": "Tambah ke garis panduan",
  "1 file added to the guidelines.": "1 fail ditambah ke garis panduan.",
  "{n} files added to the guidelines.": "{n} fail ditambah ke garis panduan.",
  "Search the guidelines": "Cari dalam garis panduan",
  "No guideline matches “{q}”. Try other words.": "Tiada garis panduan sepadan dengan “{q}”. Cuba perkataan lain.",
  "Files agents search": "Fail yang ejen cari",
  "No guidelines yet": "Belum ada garis panduan",
  "Take this file out of the guidelines?": "Keluarkan fail ini daripada garis panduan?",
  "Taken out of the guidelines. The file itself is kept.": "Dikeluarkan daripada garis panduan. Failnya tetap disimpan.",

  // P143b: the units first (named Malay first, as the owner wrote them), then one picker for
  // the other companies.
  "Units": "Unit",
  "Unit HR": "Unit HR",
  "Unit Audit": "Unit Audit",
  "Unit Kewangan": "Unit Kewangan",
  "Other companies": "Syarikat lain",
  "Search {n} companies": "Cari {n} syarikat",

  // P149c: keywords at upload, sorting into folders, the AI organizes
  "e.g. payroll, nov 2026, staff A": "cth. gaji, nov 2026, staf A",
  "Keywords for these files": "Kata kunci untuk fail-fail ini",
  "Used here": "Digunakan di sini",
  "Keywords": "Kata kunci",
  "Keywords…": "Kata kunci…",
  "Keywords for {n} files": "Kata kunci untuk {n} fail",
  "Add keywords to all of them, or take one off all of them.": "Tambah kata kunci pada semuanya, atau buang satu daripada semuanya.",
  "On these files": "Pada fail-fail ini",
  "No keywords yet.": "Belum ada kata kunci.",
  "Save keywords": "Simpan kata kunci",
  "Keywords saved.": "Kata kunci disimpan.",
  "1 file ready to upload": "1 fail sedia dimuat naik",
  "{n} files ready to upload": "{n} fail sedia dimuat naik",
  "Added to every file in this upload, so you can find, filter and sort them later.":
    "Ditambah pada setiap fail dalam muat naik ini, supaya mudah dicari, ditapis dan disusun kemudian.",
  "Sort into folders automatically": "Susun ke dalam folder secara automatik",
  "By what each file is and the date in its name or content, e.g. Payroll/2026/11. Folders you upload keep their own folders.":
    "Mengikut jenis setiap fail dan tarikh pada nama atau kandungannya, cth. Payroll/2026/11. Folder yang anda muat naik kekal dengan folder sendiri.",
  "The files stay in the folder you chose.": "Fail-fail kekal dalam folder yang anda pilih.",
  "Proposed folders: {n} of {total} files sorted": "Folder dicadangkan: {n} daripada {total} fail disusun",
  "stays here": "kekal di sini",
  "From the file names and keywords; once read, a file's content can still decide its folder.":
    "Berdasarkan nama fail dan kata kunci; selepas dibaca, kandungan fail masih boleh menentukan foldernya.",
  "Organize these {n} files from the folder {folder} with the organize-library skill: plan sub-folders by what each file is and its date (suggest_organization), show me the plan, and move them only after I agree; never delete or rename.":
    "Susun {n} fail ini daripada folder {folder} dengan kemahiran organize-library: rancang subfolder mengikut jenis setiap fail dan tarikhnya (suggest_organization), tunjukkan rancangan kepada saya, dan pindahkan hanya selepas saya setuju; jangan padam atau tukar nama.",
  "Organize the folder {folder} of {place} with the organize-library skill: plan sub-folders by what each file is and its date (suggest_organization), show me the plan, and move them only after I agree; never delete or rename.":
    "Susun folder {folder} di {place} dengan kemahiran organize-library: rancang subfolder mengikut jenis setiap fail dan tarikhnya (suggest_organization), tunjukkan rancangan kepada saya, dan pindahkan hanya selepas saya setuju; jangan padam atau tukar nama.",
};
