/** P107: data tables everywhere a list can grow (the shared table's numbered pages and filter
 * chips, Organization, Members). First in ./index.ts, so an existing translation wins. */
export const TABLES_P107: Record<string, string> = {
  // The table itself
  "Page {page}": "Halaman {page}",
  "Nothing matches these filters.": "Tiada yang sepadan dengan penapis ini.",

  // Organization: companies and departments as tables
  "See its members": "Lihat ahlinya",
  "New department": "Jabatan baharu",
  "What it does": "Bidang perniagaan",
  "Knowledge and data": "Pengetahuan dan data",
  "Added": "Ditambah",
  "Search companies or departments": "Cari syarikat atau jabatan",
  "Every kind of business": "Semua bidang perniagaan",
  "Shared or private": "Dikongsi atau tertutup",
  "Any protection": "Semua tahap perlindungan",

  // Members
  "Joined": "Sertai",
  "Manages": "Mengurus",
  "members": "ahli",

  // The table's standard actions: View, Export, Delete with its confirmation, bulk delete
  "View|verb": "Lihat",
  "1 row exported.": "1 baris dieksport.",
  "{n} rows exported.": "{n} baris dieksport.",
  "Save the 1 row shown as a CSV file": "Simpan 1 baris yang dipaparkan sebagai fail CSV",
  "Save the {n} rows shown as a CSV file": "Simpan {n} baris yang dipaparkan sebagai fail CSV",
  "Export ticked": "Eksport yang ditanda",
  "Remove ticked": "Buang yang ditanda",
  "Delete ticked": "Padam yang ditanda",
  "This cannot be undone.": "Tindakan ini tidak boleh dibatalkan.",
  "Remove 1 ticked row?": "Buang 1 baris yang ditanda?",
  "Remove {n} ticked rows?": "Buang {n} baris yang ditanda?",
  "Delete 1 ticked row?": "Padam 1 baris yang ditanda?",
  "Delete {n} ticked rows?": "Padam {n} baris yang ditanda?",
  "1 ticked row is not yours to change and stays.": "1 baris yang ditanda bukan di bawah kuasa anda dan kekal.",
  "{n} ticked rows are not yours to change and stay.": "{n} baris yang ditanda bukan di bawah kuasa anda dan kekal.",
  "1 removed.": "1 dibuang.",
  "{n} removed.": "{n} dibuang.",
  "1 deleted.": "1 dipadam.",
  "{n} deleted.": "{n} dipadam.",
  "{done} done, {failed} not done: {reason}": "{done} selesai, {failed} tidak selesai: {reason}",

  // Organization: counts, Prima link, delete
  "Short name": "Nama ringkas",
  "Prima link": "Pautan Prima",
  "Linked or not": "Dipautkan atau tidak",
  "Linked to Prima": "Dipautkan ke Prima",
  "Not linked to Prima": "Belum dipautkan ke Prima",
  "With or without members": "Dengan atau tanpa ahli",
  "Has members": "Ada ahli",
  "No members": "Tiada ahli",
  "Departments of {name}": "Jabatan {name}",
  "Members of {name}": "Ahli {name}",
  "See its 1 member": "Lihat 1 ahlinya",
  "See its {n} members": "Lihat {n} ahlinya",
  "People who can sign in": "Orang yang boleh log masuk",
  "Department added.": "Jabatan ditambah.",
  "companies": "syarikat",
  "departments": "jabatan",
  "Delete 1 company?": "Padam 1 syarikat?",
  "Delete {n} companies?": "Padam {n} syarikat?",
  "Each goes with its departments. It cannot be undone.": "Setiap satu dipadam bersama jabatannya. Tindakan ini tidak boleh dibatalkan.",
  "Delete 1 department?": "Padam 1 jabatan?",
  "Delete {n} departments?": "Padam {n} jabatan?",
  "Its people, agents and SOPs stay in the company without a department. It cannot be undone.":
    "Orang, ejen dan SOP di dalamnya kekal dalam syarikat tanpa jabatan. Tindakan ini tidak boleh dibatalkan.",
  "Their people, agents and SOPs stay in their companies without a department. It cannot be undone.":
    "Orang, ejen dan SOP di dalamnya kekal dalam syarikat masing-masing tanpa jabatan. Tindakan ini tidak boleh dibatalkan.",
};
