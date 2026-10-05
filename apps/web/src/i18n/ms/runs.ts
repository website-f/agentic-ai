/** Workflow runs and schedules (P23). Entries here override earlier files. */
export const RUNS: Record<string, string> = {
  // Schedules are now read in Malay too, so the hints give Malay examples (these override
  // the older entries in shell.ts that asked for simple English).
  "Say it in plain words: every weekday at 8am, every 1st of the month at 9am.": "Tulis seperti biasa, contohnya: setiap hari bekerja jam 8 pagi, 1hb setiap bulan jam 9 pagi.",
  "e.g. every Monday at 9am": "cth. setiap Isnin jam 9 pagi",
  "No duties yet. Add one, like \"every Monday at 9am, the weekly aging report\".": "Belum ada tugas. Tambah satu, contohnya laporan aging mingguan \"setiap Isnin jam 9 pagi\".",

  // A workflow run linked to an objective
  "Each step's agent sees why the job matters, and the whole run's cost counts toward the objective.": "Ejen setiap langkah nampak kenapa kerja ini penting, dan kos seluruh larian dikira dalam objektif itu.",
  "The run and its steps now count toward the objective.": "Larian ini dan langkah-langkahnya kini dikira dalam objektif itu.",
  "Workflow runs": "Larian aliran kerja",
};
