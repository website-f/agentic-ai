/** The task composer, quick kinds of work, task cards in chat, and what to do with a task
 * afterwards (reassign, run again, repeat, turn into a workflow). Terms from ./glossary.ts:
 * tugasan, ejen, aliran kerja, jadual, pekerja AI, saringan. */
export const TASKS_FLOW: Record<string, string> = {
  // ---------------------------------------------------------------- composer
  "What do you need?": "Apa yang anda perlukan?",
  "Say what you need. Pick how, who and when; the agent follows its SOPs and asks you before anything risky.":
    "Nyatakan apa yang anda perlukan. Pilih cara, siapa dan bila; ejen ikut SOP dan tanya anda dahulu sebelum apa-apa yang berisiko.",
  "from the first line; change it if you like": "daripada baris pertama; tukar jika mahu",
  "A short name for the task": "Nama ringkas untuk tugasan",
  "e.g. Which suppliers in Selangor sell food-grade gloves, and at what price per box?":
    "cth. Pembekal mana di Selangor yang menjual sarung tangan gred makanan, dan berapa harga sekotak?",
  "e.g. Reconcile September bank statements and list anything that does not match.":
    "cth. Selaraskan penyata bank September dan senaraikan apa-apa yang tidak sepadan.",
  "General task": "Tugasan biasa",
  "Any work: it follows its SOPs and asks before risky steps.": "Apa-apa kerja: ikut SOP dan tanya dahulu sebelum langkah berisiko.",
  "Research the web": "Kaji di web",
  "Searches, reads the best pages and cites every source.": "Cari, baca halaman terbaik dan nyatakan setiap sumber.",
  "Browse a website": "Layari laman web",
  "Opens a site to read or fill in. You can watch it live.": "Buka laman untuk dibaca atau diisi. Anda boleh tonton secara langsung.",
  "Follow a workflow": "Ikut aliran kerja",
  "Runs one of your mapped procedures, step by step.": "Jalankan salah satu prosedur anda, langkah demi langkah.",
  "No workflows yet. Map one on the Workflows page.": "Belum ada aliran kerja. Petakan satu di halaman Aliran Kerja.",
  "No workflows yet.": "Belum ada aliran kerja.",
  "A short answer with links": "Jawapan ringkas dengan pautan",
  "A report with sources": "Laporan dengan sumber",
  "It searches the web, reads the best pages and cites every source. Reading a page may ask your approval first, depending on the agent's settings.":
    "Ia mencari di web, membaca halaman terbaik dan menyatakan setiap sumber. Membaca halaman mungkin perlukan kelulusan anda dahulu, bergantung pada tetapan ejen.",
  "{name} may not search the web. Ask whoever manages {name} to allow web search, or pick another agent.":
    "{name} tidak dibenarkan mencari di web. Minta pengurus {name} membenarkan carian web, atau pilih ejen lain.",
  "Each step becomes its own task for the right agent (the one picked below fills any gaps); decisions, answers and reviews come to you.":
    "Setiap langkah menjadi tugasan sendiri untuk ejen yang sesuai (ejen yang dipilih di bawah mengisi kekosongan); keputusan, jawapan dan semakan datang kepada anda.",
  Who: "Siapa",
  "Fills any step without its own agent.": "Mengisi langkah yang tiada ejen sendiri.",
  "No agent you can give work to yet.": "Belum ada ejen yang boleh anda beri kerja.",
  "Pick an agent for this.": "Pilih ejen untuk ini.",
  "Repeating works for general tasks and web research.": "Ulangan boleh untuk tugasan biasa dan kajian web.",
  Repeat: "Ulang",
  "How often": "Berapa kerap",
  "Every weekday": "Setiap hari bekerja",
  "Every Monday": "Setiap Isnin",
  "1st of each month": "1hb setiap bulan",
  At: "Pada",
  Time: "Masa",
  "Also run it once now": "Jalankan sekali sekarang juga",
  "Each run is a fresh task for the agent; it appears on the board.": "Setiap larian ialah tugasan baharu untuk ejen; ia muncul di papan.",
  "More options": "Lagi pilihan",
  "⌘ Enter to send": "⌘ Enter untuk hantar",
  "Ctrl+Enter to send": "Ctrl+Enter untuk hantar",
  "Start task": "Mulakan tugasan",
  "Start research": "Mulakan kajian",
  "Start browsing": "Mulakan pelayaran",
  "Scheduled, and the first run has started.": "Dijadualkan, dan larian pertama sudah bermula.",

  // ---------------------------------------------------------------- who
  "Working on {title}": "Sedang membuat {title}",
  "Waiting on a decision": "Menunggu keputusan",
  "Free now": "Lapang sekarang",
  "It waits in triage until someone picks it up.": "Ia menunggu dalam saringan sehingga ada yang mengambilnya.",
  "Show all {n} agents": "Tunjuk semua {n} ejen",

  // ---------------------------------------------------------------- quick kinds (staff home, desk, chat)
  "Give my AI a task": "Beri tugasan kepada AI saya",
  "Give {name} a task": "Beri tugasan kepada {name}",
  "Say what you need. It works on it and asks you before anything risky.":
    "Nyatakan apa yang anda perlukan. Ia akan buat dan tanya anda dahulu sebelum apa-apa yang berisiko.",
  "Research something on the web": "Kaji sesuatu di web",
  "A cited answer or a report from good sources.": "Jawapan bersumber atau laporan daripada sumber yang baik.",
  "Browse a website for me": "Layari laman web untuk saya",
  "Read a site, or fill in a form for your approval.": "Baca laman, atau isi borang untuk kelulusan anda.",
  "Summarise a file": "Ringkaskan fail",
  "The key points, numbers and what needs action.": "Perkara utama, angka dan apa yang perlu diambil tindakan.",
  "Summarise the attached file: the key points, the numbers that matter and anything I need to act on.":
    "Ringkaskan fail yang dilampirkan: perkara utama, angka yang penting dan apa-apa yang perlu saya ambil tindakan.",
  "Or hand it work right away:": "Atau beri kerja terus:",
  "From our chat:": "Daripada perbualan kita:",

  // ---------------------------------------------------------------- after a task
  "More for this task": "Lagi untuk tugasan ini",
  Reassign: "Tukar ejen",
  "Run again": "Jalankan semula",
  "Repeat on a schedule": "Ulang mengikut jadual",
  "Turn into a workflow": "Jadikan aliran kerja",
  "Started again as a new task. This one keeps its result.": "Dimulakan semula sebagai tugasan baharu. Tugasan ini kekal dengan hasilnya.",
  "Drafting a workflow from how this task was done…": "Mendraf aliran kerja daripada cara tugasan ini dibuat…",
  "Drafted from the task: {title}": "Didraf daripada tugasan: {title}",
  "Drafted. Check the steps and who does them, then save it as a workflow.":
    "Sudah didraf. Semak langkah dan siapa yang membuatnya, kemudian simpan sebagai aliran kerja.",
  "Handed to {name}.": "Diserahkan kepada {name}.",
  "Hand this task from {name} to another agent.": "Serahkan tugasan ini daripada {name} kepada ejen lain.",
  "Pick the agent that does this task.": "Pilih ejen yang membuat tugasan ini.",
  "Stop and restart with {name}": "Henti dan mula semula dengan {name}",
  "{name} is working on it now. Reassigning stops this run and starts the task again with the new agent; the conversation so far stays with the task.":
    "{name} sedang membuatnya sekarang. Menukar ejen akan menghentikan larian ini dan memulakan tugasan semula dengan ejen baharu; perbualan setakat ini kekal dengan tugasan.",
  "No other agent you can give work to.": "Tiada ejen lain yang boleh anda beri kerja.",
  "Start it with {name} now": "Mulakan dengan {name} sekarang",
  "A fresh run starts with the new agent.": "Larian baharu bermula dengan ejen baharu.",
  "It waits until you start it.": "Ia menunggu sehingga anda memulakannya.",
  "It is still stopping. Try again in a moment.": "Ia masih sedang berhenti. Cuba lagi sebentar nanti.",
};
