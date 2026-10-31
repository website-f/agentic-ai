/** P56: the "Needs you" list (each item, Mark all as read), stopping a task from its approval,
 * the brain graph's agents and facts, and skill test results. */
export const NEEDS_MEMORY: Record<string, string> = {
  // Stop from an approval (components/approval-card.tsx)
  "Stop the whole task": "Hentikan seluruh tugasan",
  "Stopped. {name} will not ask about this task again.": "Dihentikan. {name} tidak akan bertanya tentang tugasan ini lagi.",

  // The bell (components/needs-bell.tsx)
  "Approval or question": "Kelulusan atau soalan",
  "Waits for your decision": "Menunggu keputusan anda",
  "Finished, to accept": "Siap, untuk diterima",
  "Document to review": "Dokumen untuk disemak",
  "Task failed": "Tugasan gagal",
  "Email draft": "Draf e-mel",
  "Bill to approve": "Bil untuk diluluskan",
  "Skill proposal": "Cadangan kemahiran",
  "Learned routine": "Rutin yang dipelajari",
  "{n} new things need you": "{n} perkara baharu perlukan anda",
  "Mark all as read": "Tandakan semua sudah dibaca",
  "Untitled": "Tanpa tajuk",

  // Brain graph (lib/brain.ts, pages/brain/graph-tab.tsx)
  "Learned fact": "Fakta yang dipelajari",
  "Nothing learned yet": "Belum ada apa-apa dipelajari",
  "The graph shows what your agents learned and how wiki pages link together. It fills in as they work.":
    "Graf menunjukkan apa yang dipelajari oleh ejen anda dan bagaimana halaman wiki saling berpaut. Ia terisi apabila mereka bekerja.",

  // Skill tests (pages/skills/eval-results.tsx)
  "{label}: no tests yet": "{label}: belum ada ujian",
  "No tests yet": "Belum ada ujian",
  "Tests run the skill with simulated tools: they check that the steps are followed, not live data.":
    "Ujian menjalankan kemahiran dengan alat simulasi: ia menyemak langkah diikuti, bukan data sebenar.",
};
