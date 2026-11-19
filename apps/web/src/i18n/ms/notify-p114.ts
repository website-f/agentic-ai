/** P114: who started a task (whatever they named their AI), tasks paused at the AI allowance,
 * giving more for today or this week, and each person's notifications. Same terms as ai-use.ts:
 * token, elaun, jeda. */
export const NOTIFY_P114: Record<string, string> = {
  // Tasks
  "Started by {name}": "Dimulakan oleh {name}",
  "{name}'s AI": "AI {name}",
  "{n} tasks paused: the AI allowance is used up.": "{n} tugasan dijeda: elaun AI sudah habis.",
  "Started by {names} and {n} more.": "Dimulakan oleh {names} dan {n} lagi.",
  "Started by {names}.": "Dimulakan oleh {names}.",
  "See who and give more": "Lihat siapa dan beri lebih",
  // Giving more
  "{name} gets {n} more tokens each day until Sunday.": "{name} mendapat {n} token tambahan setiap hari hingga Ahad.",
  "{name} gets {n} more tokens for today.": "{name} mendapat {n} token tambahan untuk hari ini.",
  "{n} paused tasks started again.": "{n} tugasan yang dijeda bersambung semula.",
  "Today only": "Hari ini sahaja",
  "Ends at midnight": "Tamat tengah malam",
  "Added to every day until Sunday": "Ditambah pada setiap hari hingga Ahad",
  "Give {name} more AI": "Beri {name} lebih AI",
  "Used {used} of {limit} tokens today.": "Telah guna {used} daripada {limit} token hari ini.",
  "{n} of their tasks are paused. They start again as soon as you give more, the first paused first.":
    "{n} tugasan mereka dijeda. Ia bersambung sebaik sahaja anda memberi lebih, yang dijeda dahulu bersambung dahulu.",
  "Extra tokens each day": "Token tambahan setiap hari",
  "Extra tokens today": "Token tambahan hari ini",
  "Give between 1,000 and 5,000,000 tokens.": "Beri antara 1,000 dan 5,000,000 token.",
  "Give {n}": "Beri {n}",
  // AI use and limits
  "+{n} a day this week": "+{n} sehari minggu ini",
  "{n} tasks paused, waiting for more": "{n} tugasan dijeda, menunggu tambahan",
  "Give more": "Beri lebih",
  "Has paused tasks": "Ada tugasan dijeda",
  "Started by": "Dimulakan oleh",
  "Used {used} of {limit}": "Guna {used} daripada {limit}",
  "Their AI": "AI mereka",
  "Paused: AI allowance used up": "Dijeda: elaun AI sudah habis",
  "{n} tasks from {p} people wait for more allowance, the first paused at the top. Give more for today or for this week and they start again in this order.":
    "{n} tugasan daripada {p} orang menunggu elaun tambahan, yang dijeda dahulu di atas. Beri lebih untuk hari ini atau minggu ini dan ia bersambung mengikut susunan ini.",
  "Tasks paused for the AI allowance": "Tugasan dijeda kerana elaun AI",
  "Search by task, person or AI": "Cari mengikut tugasan, orang atau AI",
  // AI usage per user (developer)
  "Download full report (Excel)": "Muat turun laporan penuh (Excel)",
  "Nothing is paused.": "Tiada yang dijeda.",
  // My notifications
  "My notifications": "Notifikasi saya",
  "How the office tells you (email, this app, Telegram, WhatsApp) when your AI needs you, runs out of allowance or finishes.":
    "Cara pejabat memberitahu anda (e-mel, aplikasi ini, Telegram, WhatsApp) apabila AI anda memerlukan anda, kehabisan elaun atau selesai.",
  "My AI needs me": "AI saya memerlukan saya",
  "Your AI asks for a decision or has a question, or a task of yours failed.":
    "AI anda meminta keputusan atau ada soalan, atau tugasan anda gagal.",
  "My AI allowance": "Elaun AI saya",
  "Today's allowance is used up and your work is paused, or a manager gave you more.":
    "Elaun hari ini sudah habis dan kerja anda dijeda, atau pengurus memberi anda lebih.",
  "My tasks are done": "Tugasan saya selesai",
  "A task your AI did for you is finished or waits for your check.":
    "Tugasan yang dibuat oleh AI anda sudah selesai atau menunggu semakan anda.",
  "Decisions waiting for me": "Keputusan yang menunggu saya",
  "Approvals you may give, for your own AI or the people you look after, and people who ran out of allowance.":
    "Kelulusan yang boleh anda beri, untuk AI anda sendiri atau orang di bawah jagaan anda, dan orang yang kehabisan elaun.",
  "Everything else": "Lain-lain",
  "Tasks given to you, mentions, files for your company, schedules and reminders.":
    "Tugasan yang diberi kepada anda, sebutan, fail untuk syarikat anda, jadual dan peringatan.",
  "Sent a test to {n} places. It arrives in a minute.": "Ujian dihantar ke {n} tempat. Ia sampai dalam seminit.",
  "Nothing to send to: turn on a way to reach you first.": "Tiada tempat untuk dihantar: hidupkan satu cara untuk menghubungi anda dahulu.",
  "How the office tells you when your AI needs you, runs out of allowance or finishes, and when something waits for your decision. The bell at the top always lists what waits.":
    "Cara pejabat memberitahu anda apabila AI anda memerlukan anda, kehabisan elaun atau selesai, dan apabila sesuatu menunggu keputusan anda. Loceng di atas sentiasa menyenaraikan apa yang menunggu.",
  "Send me a test": "Hantar ujian kepada saya",
  "Where you hear it": "Di mana anda menerimanya",
  "Turn a way off and nothing is sent there. Approvals by phone or Telegram can be decided right from the message.":
    "Matikan satu cara dan tiada apa dihantar ke situ. Kelulusan melalui telefon atau Telegram boleh diputuskan terus dari mesej.",
  "The office's email is not set up yet": "E-mel pejabat belum disediakan",
  "No email address": "Tiada alamat e-mel",
  "Email me": "E-mel saya",
  "Your AI's questions, decisions, allowance and finished tasks.": "Soalan, keputusan, elaun dan tugasan selesai AI anda.",
  "Also email everything else": "E-mel juga semua yang lain",
  "Off: small notices come only to your phone, Telegram or WhatsApp.": "Mati: notis kecil hanya ke telefon, Telegram atau WhatsApp anda.",
  "This app on your phone or computer": "Aplikasi ini di telefon atau komputer anda",
  "{n} devices": "{n} peranti",
  "Notify my devices": "Beritahu peranti saya",
  "Pop-up notifications on each phone or browser where you turned them on.":
    "Notifikasi timbul pada setiap telefon atau pelayar yang anda hidupkan.",
  "Notify me on Telegram": "Beritahu saya di Telegram",
  "Approve or deny with the buttons in the message.": "Luluskan atau tolak dengan butang dalam mesej.",
  "Notify me on WhatsApp": "Beritahu saya di WhatsApp",
  "A message with a link to approve or answer.": "Mesej dengan pautan untuk meluluskan atau menjawab.",
  "What you hear about": "Apa yang anda dimaklumkan",
  "Applies to every way above. Turn off what you would rather check in the app.":
    "Terpakai untuk semua cara di atas. Matikan apa yang anda lebih suka semak dalam aplikasi.",
  "Link your number on the Channels page: it gives you a code to send to the office's bot or WhatsApp number.":
    "Pautkan nombor anda di halaman Saluran: ia memberi anda kod untuk dihantar kepada bot atau nombor WhatsApp pejabat.",
  // P115: WhatsApp (WAHA) sessions that fail
  "WhatsApp logged the office phone out. Scan the new QR code with the office phone to connect again.":
    "WhatsApp telah mengeluarkan telefon pejabat. Imbas kod QR baharu dengan telefon pejabat untuk menyambung semula.",
  "WhatsApp is connected again.": "WhatsApp bersambung semula.",
  "Press Start the session. It reconnects if the connection only dropped; if WhatsApp logged the office phone out, it shows a new QR code to scan with that phone.":
    "Tekan Mulakan sesi. Ia bersambung semula jika sambungan hanya terputus; jika WhatsApp telah mengeluarkan telefon pejabat, kod QR baharu dipaparkan untuk diimbas dengan telefon itu.",
  // P115: two-step sign-in and password, clearer (feedback 18 Nov)
  "Turn off two-step sign-in": "Matikan log masuk dua langkah",
  "Your company requires it for your role, so after turning it off you will be asked to set it up again.":
    "Syarikat anda mewajibkannya untuk peranan anda, jadi selepas dimatikan anda akan diminta menyediakannya semula.",
  "To turn it off you need your password and a code from your authenticator app (or a recovery code). New recovery codes are only for when you lost or used up the old ones.":
    "Untuk mematikannya anda perlukan kata laluan dan kod daripada aplikasi pengesah (atau kod pemulihan). Kod pemulihan baharu hanya untuk apabila kod lama hilang atau sudah habis digunakan.",
  "Your Agentic Office password (also opens Prima here). It is not your email password. Changing it signs out your other devices.":
    "Kata laluan Agentic Office anda (juga untuk Prima di sini). Ia bukan kata laluan e-mel anda. Menukarnya akan mengeluarkan anda daripada peranti lain.",
};
