/** P81: start fresh for go-live (Data and privacy), and deleting many files and SOPs at once
 * (Library, Browse, SOPs). Terms: go-live = mula guna sebenar, sample = contoh, backup =
 * sandaran, AI worker = pekerja AI, Browse = Semak imbas, library SOP = SOP perpustakaan. */
export const GOLIVE: Record<string, string> = {
  // bulk delete
  "Delete 1 item": "Padam 1 item",
  "Delete {n} items": "Padam {n} item",
  "Delete 1 item?": "Padam 1 item?",
  "Delete {n} items?": "Padam {n} item?",
  "Delete {what}": "Padam {what}",
  "Delete 1 SOP?": "Padam 1 SOP?",
  "Delete {n} SOPs?": "Padam {n} SOP?",
  "Deleted 1 item.": "1 item dipadam.",
  "Deleted {n} items.": "{n} item dipadam.",
  "{n} could not be deleted: not yours to delete, or already gone.":
    "{n} tidak dapat dipadam: bukan anda yang boleh memadamnya, atau sudah tiada.",
  "Nothing was deleted: these are not yours to delete, or already gone.":
    "Tiada apa-apa dipadam: ini bukan anda yang boleh memadamnya, atau sudah tiada.",
  "Files are deleted from Files and Browse too, and SOPs stop applying to every agent. Agents no longer find them. This cannot be undone.":
    "Fail turut dipadam daripada Fail dan Semak imbas, dan SOP tidak lagi terpakai kepada mana-mana ejen. Ejen tidak akan menjumpainya lagi. Ini tidak boleh dibatalkan.",
  "Agents stop following them immediately and they are detached from every agent. This cannot be undone.":
    "Ejen berhenti mengikutinya serta-merta dan ia ditanggalkan daripada setiap ejen. Ini tidak boleh dibatalkan.",

  // start fresh for go-live
  "Start fresh for go-live": "Mula semula untuk guna sebenar",
  "Turn this practice office into the real one: the sample people and companies go; AI workers, SOPs, settings, Microsoft and the AI Engine stay.":
    "Jadikan pejabat latihan ini pejabat sebenar: orang dan syarikat contoh dibuang; pekerja AI, SOP, tetapan, Microsoft dan Enjin AI kekal.",
  "1 AI worker": "1 pekerja AI",
  "{n} AI workers": "{n} pekerja AI",
  "1 person": "1 orang",
  "{n} owners stay": "{n} pemilik kekal",
  "All kept": "Semua dikekalkan",
  "Companies to remove": "Syarikat untuk dibuang",
  "{n} of {total} ticked": "{n} daripada {total} ditanda",
  "Tick the sample companies. Keep the real ones; the staff import adds any that are missing.":
    "Tanda syarikat contoh. Kekalkan yang sebenar; import staf akan menambah mana-mana yang belum ada.",
  "Find a company": "Cari syarikat",
  "Tick all {n} found": "Tanda kesemua {n} yang dijumpai",
  "Tick all": "Tanda semua",
  "This office has no companies yet.": "Pejabat ini belum ada syarikat.",
  "Move their AI workers and files to": "Pindahkan pekerja AI dan fail mereka ke",
  "{a} AI workers and {f} files move to {company}. The files go in a folder named after the company they came from.":
    "{a} pekerja AI dan {f} fail dipindahkan ke {company}. Fail diletakkan dalam folder bernama syarikat asalnya.",
  "Keep at least one company: the AI workers and files of the removed ones need somewhere to go.":
    "Kekalkan sekurang-kurangnya satu syarikat: pekerja AI dan fail syarikat yang dibuang perlu tempat untuk dipindahkan.",
  "What happens": "Apa yang berlaku",
  "{n} members leave; the {owners} owners stay. They are signed out at once, their Prima links end, and anyone with no other workspace is deactivated (not deleted).":
    "{n} ahli keluar; {owners} pemilik kekal. Mereka dilog keluar serta-merta, pautan Prima mereka ditamatkan, dan sesiapa yang tiada ruang kerja lain dinyahaktifkan (tidak dipadam).",
  "{n} companies are removed with their {d} departments and {o} records that belong only to them (memory pages, skills, workflows, forms).":
    "{n} syarikat dibuang bersama {d} jabatan dan {o} rekod yang hanya milik syarikat itu (halaman memori, kemahiran, aliran kerja, borang).",
  "No company is removed.": "Tiada syarikat dibuang.",
  "AI workers, SOPs, settings, Microsoft and the AI Engine stay. An SOP of a removed company becomes a library SOP, still attached to its AI workers.":
    "Pekerja AI, SOP, tetapan, Microsoft dan Enjin AI kekal. SOP syarikat yang dibuang menjadi SOP perpustakaan, masih dilampirkan pada pekerja AInya.",
  "Files stay. Delete the ones you do not want in Library or Browse, where you can select many at once.":
    "Fail kekal. Padam yang anda tidak mahu di Perpustakaan atau Semak imbas, di mana anda boleh memilih banyak sekaligus.",
  "A backup is taken first": "Sandaran diambil dahulu",
  "This page cannot take one itself: the server's backup (every night, and before every deploy) is the safety net.":
    "Halaman ini tidak boleh mengambilnya sendiri: sandaran pelayan (setiap malam, dan sebelum setiap deploy) ialah jaring keselamatannya.",
  "The last one finished {when}.": "Yang terakhir siap {when}.",
  "When the last one ran is not visible from here: ask whoever runs the server to take one now.":
    "Bila sandaran terakhir dibuat tidak kelihatan dari sini: minta pengendali pelayan mengambil satu sekarang.",
  "For your own copy, use Export all data above.": "Untuk salinan anda sendiri, guna Eksport semua data di atas.",
  "Start fresh…": "Mula semula…",
  "Start fresh": "Mula semula",
  "Start fresh for {name}": "Mula semula untuk {name}",
  "{n} members leave and {c} companies are removed. This cannot be undone from here.":
    "{n} ahli keluar dan {c} syarikat dibuang. Ini tidak boleh dibatalkan dari sini.",
  "Done. This office starts fresh.": "Selesai. Pejabat ini bermula semula.",
  "{n} members left; {owners} owners stayed.": "{n} ahli keluar; {owners} pemilik kekal.",
  "{n} companies and {d} departments removed.": "{n} syarikat dan {d} jabatan dibuang.",
  "{a} AI workers and {f} files moved.": "{a} pekerja AI dan {f} fail dipindahkan.",
  "{n} Prima links ended.": "{n} pautan Prima ditamatkan.",
  "Next: Members › Import to bring in your staff.": "Seterusnya: Ahli › Import untuk membawa masuk staf anda.",
};
