/** P92: lessons people teach the agents (Learning > Lessons, "Noted for next time", the daily
 * digest). "Lesson" is "pengajaran" throughout. */
export const LESSONS: Record<string, string> = {
  // ---------------------------------------------------------------- how it was taught
  "sent the work back": "menghantar kerja itu balik",
  "answered its question": "menjawab soalannya",
  "turned a request down": "menolak satu permintaan",
  "corrected it in chat": "membetulkannya dalam sembang",
  "asked it to remember": "meminta ia ingat",
  "edited the lesson": "menyunting pengajaran itu",

  // ---------------------------------------------------------------- "Noted for next time"
  "Noted for next time:": "Dicatat untuk lain kali:",
  "Already known, noted again:": "Sudah diketahui, dicatat sekali lagi:",
  "Taken back:": "Ditarik balik:",
  "Taken back. The earlier lesson is used again.": "Ditarik balik. Pengajaran sebelumnya digunakan semula.",
  "Taken back. It will not be used.": "Ditarik balik. Ia tidak akan digunakan.",
  "taught it a lesson": "mengajarnya satu pengajaran",

  // ---------------------------------------------------------------- one lesson
  "When": "Bila",
  "Do": "Buat",
  "Don't": "Jangan",
  "Example": "Contoh",
  "taught by {name}, {when}": "diajar oleh {name}, {when}",
  "taught {n} times": "diajar {n} kali",
  "used {n}×, last {when}": "digunakan {n}×, terakhir {when}",
  "not used yet": "belum digunakan",
  "in skill {name}": "dalam kemahiran {name}",
  "only this AI": "AI ini sahaja",
  "Replaced by a newer lesson": "Diganti dengan pengajaran yang lebih baharu",
  "Not in use": "Tidak digunakan",
  "Forget": "Lupakan",
  "Edit lesson": "Sunting pengajaran",
  "Your change is kept as a correction: the agents use the new wording from now on.":
    "Perubahan anda disimpan sebagai pembetulan: ejen menggunakan ayat baharu mulai sekarang.",
  "Saved. The old wording is kept in the history.": "Disimpan. Ayat lama disimpan dalam sejarah.",
  "The lesson, in one sentence": "Pengajaran itu, dalam satu ayat",
  "Field or step": "Medan atau langkah",

  // ---------------------------------------------------------------- the daily digest
  "Getting smarter every day": "Semakin bijak setiap hari",
  "What one day taught the agents: lessons from people, skills that improved, and mistakes corrected more than once.":
    "Apa yang dipelajari ejen dalam sehari: pengajaran daripada orang, kemahiran yang bertambah baik, dan kesilapan yang dibetulkan lebih daripada sekali.",
  "The day before": "Hari sebelumnya",
  "The day after": "Hari berikutnya",
  "Lessons learned": "Pengajaran dipelajari",
  "{n} replaced an older one": "{n} menggantikan yang lebih lama",
  "From people's corrections": "Daripada pembetulan orang",
  "Skills improved": "Kemahiran bertambah baik",
  "New versions that day": "Versi baharu pada hari itu",
  "Repeated mistakes": "Kesilapan berulang",
  "Corrected more than once": "Dibetulkan lebih daripada sekali",
  "No new lessons this day. When someone corrects an agent, the lesson shows here.":
    "Tiada pengajaran baharu pada hari ini. Apabila seseorang membetulkan ejen, pengajarannya dipaparkan di sini.",
  "version {n}": "versi {n}",
  "went live by itself after its tests": "digunakan sendiri selepas lulus ujiannya",
  "approved by a person": "diluluskan oleh seseorang",

  // ---------------------------------------------------------------- the Lessons list
  "Lessons": "Pengajaran",
  "Each time someone corrects an agent, it keeps one short lesson and uses it on that kind of work every time.":
    "Setiap kali seseorang membetulkan ejen, ia menyimpan satu pengajaran ringkas dan menggunakannya setiap kali membuat kerja seperti itu.",
  "Topic": "Topik",
  "All topics": "Semua topik",
  "All agents": "Semua ejen",
  "In use": "Sedang digunakan",
  "Also replaced and forgotten": "Termasuk yang diganti dan dilupakan",
  "No lessons yet": "Belum ada pengajaran",
  "Send work back with what was wrong, answer an agent's question with the rule, or tell it in chat: it keeps the lesson for next time.":
    "Hantar kerja balik dengan apa yang salah, jawab soalan ejen dengan peraturannya, atau beritahu dalam sembang: ia menyimpan pengajaran itu untuk lain kali.",
  "Forget this lesson?": "Lupakan pengajaran ini?",
  "Forgotten. The agents no longer use it.": "Dilupakan. Ejen tidak lagi menggunakannya.",
  "What people taught {name}": "Apa yang diajar orang kepada {name}",
  "Lessons from corrections. It uses them on that kind of work every time.":
    "Pengajaran daripada pembetulan. Ia menggunakannya setiap kali membuat kerja seperti itu.",
  'Nothing yet. When you correct {name} (send work back, answer its question, or say "no, ..." in chat), the lesson shows here.':
    'Belum ada. Apabila anda membetulkan {name} (hantar kerja balik, jawab soalannya, atau kata "tak, ..." dalam sembang), pengajarannya dipaparkan di sini.',
  // ---------------------------------------------------------------- P96: what an agent does from memory
  "What {name} does from memory": "Apa yang {name} buat daripada ingatan",
  "Jobs it has done well before run again step by step without the AI, and the same first question gets the same answer. Anything new or different still goes to the AI, and sending or uploading always waits for a person.":
    "Kerja yang pernah dibuatnya dengan baik dijalankan semula langkah demi langkah tanpa AI, dan soalan pertama yang sama mendapat jawapan yang sama. Apa-apa yang baharu atau berbeza tetap ke AI, dan menghantar atau memuat naik sentiasa menunggu seseorang.",
  "{jobs} jobs done from memory, {answers} answers reused: {n} tokens saved":
    "{jobs} kerja dibuat daripada ingatan, {answers} jawapan diguna semula: {n} token dijimatkan",
  "Reuse what it learned": "Guna semula apa yang dipelajarinya",
  "Off: it always works with the AI. It keeps learning.": "Dimatikan: ia sentiasa bekerja dengan AI, dan tetap belajar.",
  "Switched off for the whole office in Skills > Routines.": "Dimatikan untuk seluruh pejabat di Kemahiran > Rutin.",
  "in the browser": "dalam pelayar",
  "its own, for one person": "miliknya sendiri, untuk seorang",
  "shared with its company": "dikongsi dengan syarikatnya",
  "learned by a colleague": "dipelajari oleh rakan sekerja",
  "Nothing yet. When {name} does the same kind of job twice the same way and people accept it, the steps show here.":
    "Belum ada. Apabila {name} membuat kerja yang sama dua kali dengan cara yang sama dan orang menerimanya, langkahnya dipaparkan di sini.",
};
