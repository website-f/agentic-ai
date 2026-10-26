/** P36: each person's daily AI allowance ("elaun AI"), the work-scope check, routines ("rutin")
 * the office repeats without the AI, the setup checklist and companies. */
export const AI_USE: Record<string, string> = {
  // My allowance
  "My AI allowance today": "Elaun AI saya hari ini",
  "{used} of {limit} tokens": "{used} daripada {limit} token",
  "AI allowance used": "Elaun AI digunakan",
  "Used up for today. It resets at midnight, or ask your manager for more.": "Sudah habis untuk hari ini. Ia diset semula pada tengah malam, atau minta pengurus anda tambah.",
  "Resets at midnight. Work your AI repeats from what it learned uses almost none.": "Diset semula pada tengah malam. Kerja yang AI anda ulang daripada apa yang dipelajarinya hampir tidak guna apa-apa.",
  "{person}: {used} of {limit} tokens today": "{person}: {used} daripada {limit} token hari ini",
  "This person": "Orang ini",
  "is paused: the AI allowance for today is used up": "dijeda: elaun AI untuk hari ini sudah habis",
  "A manager decides on more AI budget. They have been told.": "Pengurus yang tentukan tambahan bajet AI. Mereka sudah dimaklumkan.",

  // AI use and limits
  "AI use and limits": "Penggunaan dan had AI",
  "Each person's daily AI allowance, what staff may use their AI for, and what was refused.": "Elaun AI harian setiap orang, untuk apa kakitangan boleh guna AI mereka, dan apa yang ditolak.",
  "{used} today, no limit": "{used} hari ini, tiada had",
  "Who it applies to": "Untuk siapa",
  "Saved. It counts from now, for today too.": "Disimpan. Ia dikira mulai sekarang, termasuk hari ini.",
  "Daily AI allowance": "Elaun AI harian",
  "Every AI call is counted against the person the work is for. When their allowance is used up, their AI stops and a manager decides on more. It resets at midnight.":
    "Setiap panggilan AI dikira untuk orang yang punya kerja itu. Bila elaun mereka habis, AI mereka berhenti dan pengurus tentukan sama ada beri lebih. Ia diset semula pada tengah malam.",
  "Tokens per person per day": "Token setiap orang sehari",
  "About 1,000 tokens is a short chat answer; a task that reads documents and writes a report uses 20,000 to 60,000. Jobs your AI learned to repeat use almost none.":
    "Lebih kurang 1,000 token untuk jawapan sembang yang pendek; tugasan yang membaca dokumen dan menulis laporan guna 20,000 hingga 60,000. Kerja yang AI sudah belajar ulang hampir tidak guna apa-apa.",
  "The owner is never limited by this. Anyone can still get their own allowance below.": "Pemilik tidak pernah dihadkan oleh ini. Sesiapa pun boleh diberi elaun sendiri di bawah.",
  "Save allowance": "Simpan elaun",
  "{name}'s allowance is saved.": "Elaun {name} disimpan.",
  "+{n} given today": "+{n} diberi hari ini",
  "Allowance for {name}": "Elaun untuk {name}",
  "Default for their role": "Lalai untuk peranan mereka",
  "Their own amount": "Jumlah sendiri",
  "Tokens per day for {name}": "Token sehari untuk {name}",
  "Set": "Tetapkan",
  "What staff may use their AI for": "Untuk apa kakitangan boleh guna AI mereka",
  "Before any work starts, a request from these roles is checked against your business. Homework, games, personal shopping and attempts to switch the AI's rules off are refused and listed below. When unsure, it counts as work.":
    "Sebelum kerja bermula, permintaan daripada peranan ini disemak berbanding perniagaan anda. Kerja sekolah, permainan, membeli-belah peribadi dan cubaan mematikan peraturan AI ditolak dan disenaraikan di bawah. Jika ragu-ragu, ia dikira sebagai kerja.",
  "Check requests are about work": "Semak permintaan berkaitan kerja",
  "Off: only the daily allowance limits use.": "Mati: hanya elaun harian yang mengehadkan penggunaan.",
  "What the work is (optional)": "Apa kerjanya (pilihan)",
  "e.g. Security guard services: rosters, payroll, client sites, tenders, incident reports and customer letters.":
    "cth. Perkhidmatan kawalan keselamatan: jadual tugas, gaji, tapak pelanggan, tender, laporan insiden dan surat pelanggan.",
  "Your company's name and industry are already used. Add what your teams actually do, so work that sounds unusual still passes.":
    "Nama dan industri syarikat anda sudah digunakan. Tambah apa yang pasukan anda betul-betul buat, supaya kerja yang kedengaran luar biasa tetap lulus.",
  "Refused requests": "Permintaan yang ditolak",
  "The latest requests the check turned away, newest first.": "Permintaan terkini yang ditolak oleh semakan, yang terbaru dahulu.",
  "Nothing refused. Requests have all been about work.": "Tiada yang ditolak. Semua permintaan berkaitan kerja.",
  "Why: {why}": "Sebab: {why}",
  "Keep AI use fair and on the job: a daily allowance for each person, a check that staff use their AI for work, and who used what today.":
    "Pastikan penggunaan AI adil dan untuk kerja: elaun harian setiap orang, semakan bahawa kakitangan guna AI untuk kerja, dan siapa guna berapa hari ini.",
  "Used today": "Digunakan hari ini",
  "Tokens, by everyone you manage": "Token, oleh semua yang anda urus",
  "People at their limit": "Orang yang capai had",
  "Their AI waits for a manager": "AI mereka menunggu pengurus",
  "Nobody": "Tiada sesiapa",
  "Each person today": "Setiap orang hari ini",
  "Give someone their own amount, or no limit. Changes count straight away.": "Beri seseorang jumlah sendiri, atau tiada had. Perubahan berkuat kuasa serta-merta.",
  "Add people in Members and roles.": "Tambah orang di Ahli dan peranan.",

  // Getting started
  "Connect an AI provider": "Sambungkan penyedia AI",
  "A key is in, but the Smart group has no model yet. Pick one in Model groups.": "Kunci sudah ada, tetapi kumpulan Smart belum ada model. Pilih satu di Kumpulan model.",
  "Paste one key (Groq and OpenRouter are free) and test it. Its models are set up for your agents straight away.":
    "Tampal satu kunci (Groq dan OpenRouter percuma) dan uji. Modelnya terus disediakan untuk ejen anda.",
  "Add your company and its AI team": "Tambah syarikat anda dan pasukan AI-nya",
  "Name it and pick your industry: departments and a ready-made team of AI agents are created for you.":
    "Namakan dan pilih industri anda: jabatan dan pasukan ejen AI siap sedia dicipta untuk anda.",
  "Add company": "Tambah syarikat",
  "Put your SOPs and documents in the Library": "Masukkan SOP dan dokumen anda ke Perpustakaan",
  "Drop a zip or folders of procedures, policies, forms and templates. Every agent reads and searches them.":
    "Lepaskan zip atau folder prosedur, polisi, borang dan templat. Setiap ejen membaca dan mencarinya.",
  "Add your staff and their daily AI allowance": "Tambah kakitangan anda dan elaun AI harian mereka",
  "Each person gets their own AI and a daily allowance you set. Staff see only their own work.":
    "Setiap orang dapat AI sendiri dan elaun harian yang anda tetapkan. Kakitangan hanya nampak kerja mereka sendiri.",
  "Add people": "Tambah orang",
  "Give the first task": "Beri tugasan pertama",
  "Say what you need in plain words and pick an agent. Jobs it repeats are learned and later cost almost nothing.":
    "Nyatakan apa yang anda perlukan dengan kata-kata biasa dan pilih ejen. Kerja yang diulang dipelajari dan kemudian hampir tiada kos.",

  // Library
  "Restricted": "Terhad",
  "Open to all agents": "Buka kepada semua ejen",
  "Restrict": "Hadkan",
  "Restricted: only its department's agents and managers read it now.": "Terhad: hanya ejen jabatannya dan pengurus boleh baca sekarang.",
  "Open to every agent of the company now.": "Kini dibuka kepada setiap ejen syarikat.",

  // Companies
  "Company updated.": "Syarikat dikemas kini.",
  "Company created.": "Syarikat dicipta.",
  "Edit company": "Edit syarikat",
  "New company": "Syarikat baharu",
  "Each company has its own departments, AI team, office and knowledge. Pick what it does and a team that fits is hired for you.":
    "Setiap syarikat ada jabatan, pasukan AI, pejabat dan pengetahuan sendiri. Pilih apa yang ia buat dan pasukan yang sesuai diambil untuk anda.",
  "Create company": "Cipta syarikat",
  "Also add the standard departments": "Tambah juga jabatan standard",
  "Management, Finance, Research, Operations, Data and Writing. Not needed with a ready-made team: it brings its own departments.":
    "Pengurusan, Kewangan, Penyelidikan, Operasi, Data dan Penulisan. Tidak perlu dengan pasukan siap sedia: ia bawa jabatannya sendiri.",

  // Routines
  "Routines": "Rutin",
  "Runs by itself": "Berjalan sendiri",
  "Learned by {name}": "Dipelajari oleh {name}",
  "Seen done this way {n} of {needed} times": "Dilihat dibuat cara ini {n} daripada {needed} kali",
  "{n} runs": "{n} kali dijalankan",
  "{ok} accepted, {bad} sent back or failed": "{ok} diterima, {bad} dihantar semula atau gagal",
  "{n} tokens saved": "{n} token dijimatkan",
  "last used {when}": "terakhir digunakan {when}",
  "Learned from:": "Dipelajari daripada:",
  "Changes each time:": "Berubah setiap kali:",
  "Exactly the same every time.": "Sama setiap kali.",
  "The answer:": "Jawapannya:",
  "a fixed reply, no AI needed": "jawapan tetap, tidak perlu AI",
  "written by the cheapest AI from the results: {how}": "ditulis oleh AI paling murah daripada hasilnya: {how}",
  "Trust it now": "Percaya sekarang",
  "Forget": "Lupakan",
  "Forget {name}?": "Lupakan {name}?",
  "Agents will do this job with the AI again, and may learn it again.": "Ejen akan buat kerja ini dengan AI semula, dan mungkin mempelajarinya semula.",
  "When an agent does the same kind of job twice the same way and people accept it, the office keeps the steps. Next time the steps run by themselves and only the final write-up (if any) goes to the cheapest AI. Every step still asks for approval where it must, and anything unexpected hands the job back to the agent.":
    "Bila ejen buat kerja yang sama dua kali dengan cara yang sama dan orang menerimanya, pejabat simpan langkah-langkahnya. Kali seterusnya langkah itu berjalan sendiri dan hanya penulisan akhir (jika ada) dihantar ke AI paling murah. Setiap langkah tetap minta kelulusan bila perlu, dan apa-apa yang tidak dijangka diserahkan semula kepada ejen.",
  "Run by themselves": "Berjalan sendiri",
  "Being learned": "Sedang dipelajari",
  "Waiting for a second accepted job": "Menunggu kerja kedua yang diterima",
  "Jobs done this way": "Kerja dibuat cara ini",
  "Tokens saved": "Token dijimatkan",
  "Against the first time each job was done": "Berbanding kali pertama setiap kerja dibuat",
  "Let agents repeat learned jobs without the AI": "Benarkan ejen ulang kerja yang dipelajari tanpa AI",
  "Off: agents still learn routines, but always work with the AI.": "Mati: ejen tetap belajar rutin, tetapi sentiasa bekerja dengan AI.",
  "No routines yet": "Belum ada rutin",
  "They appear after agents finish work that used tools and could be repeated, such as a monthly report or a regular check. Give the same kind of task twice and accept the results.":
    "Ia muncul selepas ejen siapkan kerja yang guna alat dan boleh diulang, seperti laporan bulanan atau semakan berkala. Beri tugasan yang sama dua kali dan terima hasilnya.",
};
