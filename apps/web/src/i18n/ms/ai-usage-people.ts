/** P113: AI usage per user ("Penggunaan AI ikut pengguna"), the developer's report in the AI
 * Engine (pages/ai-engine/people-usage.tsx). Same terms as ai-use.ts: token, elaun, panggilan. */
export const AI_USAGE_PEOPLE: Record<string, string> = {
  "AI usage per user": "Penggunaan AI ikut pengguna",
  "Who uses the AI, how much, and what for. Only owners, admins and the system's developer see this page. Open a person for their full report: every call with what they asked and what came back, their conversations and tasks. Opening a report is recorded in the audit log.":
    "Siapa guna AI, berapa banyak, dan untuk apa. Hanya pemilik, admin dan pembangun sistem yang nampak halaman ini. Buka seseorang untuk laporan penuhnya: setiap panggilan dengan apa yang diminta dan jawapannya, perbualan dan tugasan mereka. Setiap laporan yang dibuka direkodkan dalam log audit.",

  // The period
  "Last month": "Bulan lepas",
  "Custom|period": "Pilih tarikh",
  "Pick a start and an end date (the end on or after the start).": "Pilih tarikh mula dan tarikh akhir (tarikh akhir pada atau selepas tarikh mula).",
  "{start} to {end}": "{start} hingga {end}",

  // What the work was for
  "Chat with agents": "Sembang dengan ejen",
  "Agent tasks": "Tugasan ejen",
  "Workflows and builders": "Aliran kerja dan pembina",
  "Meetings and minutes": "Mesyuarat dan minit",
  "Voice to text": "Suara ke teks",
  "Learning and memory": "Pembelajaran dan ingatan",
  "Reading files and pictures": "Membaca fail dan gambar",
  "Making pictures": "Menghasilkan gambar",
  "Overview summaries": "Ringkasan gambaran keseluruhan",
  "Digital twin": "Kembar digital",
  "Admin tools": "Alat pentadbir",
  "Engine tests and playground": "Ujian enjin dan taman uji",

  // The tiles
  "Total tokens": "Jumlah token",
  "{in} in, {out} out · {n} calls": "{in} masuk, {out} keluar · {n} panggilan",
  "Estimated cost": "Anggaran kos",
  "USD · {n} calls had no price": "USD · {n} panggilan tiada harga",
  "USD · every call priced": "USD · setiap panggilan ada harga",
  "Active users": "Pengguna aktif",
  "Plus {n} tokens of the office's own work": "Ditambah {n} token kerja pejabat sendiri",
  "People who used AI in this period": "Orang yang guna AI dalam tempoh ini",
  "Top feature": "Ciri paling banyak digunakan",
  "{n} tokens · {pct} of all": "{n} token · {pct} daripada semua",
  "No AI use yet": "Belum ada penggunaan AI",

  // The table
  "{start} to {end} ({tz}). Most tokens first; open a person for their full report. Cost is in US dollars from each model's price in this AI Engine.":
    "{start} hingga {end} ({tz}). Token paling banyak di atas; buka seseorang untuk laporan penuhnya. Kos dalam dolar AS, ikut harga setiap model dalam Enjin AI ini.",
  "Most tokens first; open a person for their full report.": "Token paling banyak di atas; buka seseorang untuk laporan penuhnya.",
  "Not a member now": "Bukan ahli lagi",
  "Input tokens": "Token masuk",
  "Output tokens": "Token keluar",
  "Cost (USD)": "Kos (USD)",
  "{n} unpriced": "{n} tiada harga",
  "Allowance today": "Elaun hari ini",
  "{used} · no limit": "{used} · tiada had",
  "Mostly for": "Kebanyakannya untuk",
  "Search by name, email or company": "Cari ikut nama, e-mel atau syarikat",
  "Office's own work": "Kerja pejabat sendiri",
  "Try another period, role or company.": "Cuba tempoh, peranan atau syarikat lain.",

  // One person's report
  "Work nobody asked for: routines, learning and the office's own jobs.": "Kerja yang tiada sesiapa minta: rutin, pembelajaran dan kerja pejabat sendiri.",
  "Last used {when}": "Kali terakhir digunakan {when}",
  "{n} calls had no price": "{n} panggilan tiada harga",
  "Every call priced": "Setiap panggilan ada harga",
  "of {limit} tokens": "daripada {limit} token",
  "Where it went": "Ke mana ia digunakan",
  "Feature": "Ciri",
  "Purpose": "Tujuan",
  "No agent (direct use)": "Tiada ejen (guna terus)",
  "Nothing in this period.": "Tiada apa-apa dalam tempoh ini.",
  "Every call": "Setiap panggilan",
  "When, what for, which task or agent, which model, tokens and cost. What was said is never shown.":
    "Bila, untuk apa, tugasan atau ejen mana, model mana, token dan kos. Apa yang dikatakan tidak pernah ditunjukkan.",
  "What for": "Untuk apa",
  "Failed: {why}": "Gagal: {why}",
  "Not counted in allowance": "Tidak dikira dalam elaun",
  "Task or agent": "Tugasan atau ejen",
  "Search purpose or model": "Cari tujuan atau model",
  "AI calls": "Panggilan AI",
  "All features": "Semua ciri",

  // P114: what each call was about, their conversations and tasks
  "Try another period, role, company or department.": "Cuba tempoh, peranan, syarikat atau jabatan lain.",
  "What it was about": "Tentang apa",
  "What they asked (task brief)": "Apa yang diminta (ringkasan tugasan)",
  "They wrote": "Mereka tulis",
  "The AI replied": "Jawapan AI",
  "Result": "Hasil",
  "In “{title}” · matched by time": "Dalam “{title}” · dipadankan ikut masa",
  "Matched by time": "Dipadankan ikut masa",
  "No text kept for this feature": "Tiada teks disimpan untuk ciri ini",
  "AI call": "Panggilan AI",
  "Search what they asked, the reply, task, purpose or model": "Cari apa yang diminta, jawapan, tugasan, tujuan atau model",
  "Their logs": "Log mereka",
  "Every call: when, what for, what they asked and what came back, which model, tokens and cost. Open a call to read it in full. Chat calls are matched to the conversation by time.":
    "Setiap panggilan: bila, untuk apa, apa yang diminta dan jawapannya, model, token dan kos. Buka panggilan untuk baca sepenuhnya. Panggilan sembang dipadankan dengan perbualan ikut masa.",
  "Their conversations with agents in this period. Open one to read it. Tokens are the chat calls with that agent while it ran.":
    "Perbualan mereka dengan ejen dalam tempoh ini. Buka satu untuk membacanya. Token ialah panggilan sembang dengan ejen itu sepanjang perbualan.",
  "The tasks their AI use paid for, most tokens first.": "Tugasan yang dibiayai oleh penggunaan AI mereka, token terbanyak dahulu.",
  "With {agent}": "Dengan {agent}",
  "Only the latest {n} messages are shown.": "Hanya {n} mesej terkini ditunjukkan.",
  "Search the title, agent or anything written": "Cari tajuk, ejen atau apa-apa yang ditulis",
  "Search the task, what was asked or the result": "Cari tugasan, apa yang diminta atau hasilnya",
  "No conversations": "Tiada perbualan",
  "{n} ({mine} theirs)": "{n} ({mine} daripada mereka)",
  "Tokens (about)": "Token (anggaran)",
  "Last message": "Mesej terakhir",
  "Last call": "Panggilan terakhir",
};
