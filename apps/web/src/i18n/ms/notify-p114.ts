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
  // P116: reset the password with a code by email
  "Reset your password": "Set semula kata laluan anda",
  "We email you a 6-digit code. Enter it with your new password. This is your Agentic Office password, not your email password.":
    "Kami e-mel kod 6 digit kepada anda. Masukkannya bersama kata laluan baharu anda. Ini kata laluan Agentic Office anda, bukan kata laluan e-mel anda.",
  "Forgot your password? Reset it with a code": "Lupa kata laluan? Set semula dengan kod",
  "First time here?": "Kali pertama di sini?",
  "Email me a code": "E-mel kod kepada saya",
  "A new code is on its way.": "Kod baharu sedang dihantar.",
  "Type the 6 digits from the email.": "Taip 6 digit daripada e-mel.",
  "The two passwords are not the same.": "Kedua-dua kata laluan tidak sama.",
  "Your password is changed. Sign in with it.": "Kata laluan anda telah ditukar. Log masuk dengannya.",
  "If {email} belongs to someone in the office, a 6-digit code is on its way. Check your inbox (and Junk). It works for 15 minutes.":
    "Jika {email} milik seseorang di pejabat, kod 6 digit sedang dihantar. Semak peti masuk anda (dan Junk). Ia sah selama 15 minit.",
  "Code from the email": "Kod daripada e-mel",
  "New password again": "Kata laluan baharu sekali lagi",
  "Set my new password": "Tetapkan kata laluan baharu saya",
  "Send a new code": "Hantar kod baharu",
  // P116: the menu folds, the phone menu, "Ask my AI" on every page, the people picker
  "Fold the menu": "Lipat menu",
  "Open the menu with names": "Buka menu dengan nama",
  "Menu": "Menu",
  "You have no AI of your own yet. Make it once and it is here on every page.":
    "Anda belum mempunyai AI sendiri. Buat sekali dan ia ada di setiap halaman.",
  "Chat with your assistants, or any AI you work with.": "Bersembang dengan pembantu anda, atau mana-mana AI yang anda bekerja bersama.",
  "Make my AI": "Buat AI saya",
  "Open chats": "Buka sembang",
  "Search by name, email or place": "Cari mengikut nama, e-mel atau tempat",
  // P117: Prima inside the office: clocking in from My workspace, the sidebar's Prima group
  "My clock": "Jam saya",
  "Clocked in since {time}": "Daftar masuk sejak {time}",
  "Clocked in": "Sudah daftar masuk",
  "Not clocked in": "Belum daftar masuk",
  "Open my clock to clock out or see today.": "Buka jam saya untuk daftar keluar atau lihat hari ini.",
  "Clock in here, without leaving the office.": "Daftar masuk di sini, tanpa meninggalkan pejabat.",
  "Prima home": "Laman utama Prima",
  // P118: more than one Microsoft account (Microsoft 365 page)
  "Shared": "Dikongsi",
  "Main account": "Akaun utama",
  "Which account": "Akaun yang mana",
  "Your Microsoft accounts": "Akaun Microsoft anda",
  "Shared with {n}": "Dikongsi dengan {n}",
  "Call this account": "Namakan akaun ini",
  "Remove this account": "Buang akaun ini",
  "Add another Microsoft account": "Tambah akaun Microsoft lain",
  "You always sign in with {email}. Your AI, Teams and Prima use your main account.":
    "Anda sentiasa log masuk dengan {email}. AI, Teams dan Prima anda menggunakan akaun utama anda.",
  "Remove {email}?": "Buang {email}?",
  "Its mail stops showing here and the office forgets its sign-in. Nothing is deleted in the mailbox itself.":
    "E-melnya tidak lagi dipaparkan di sini dan pejabat melupakan log masuknya. Tiada apa dipadam dalam peti mel itu sendiri.",
  // P119: the sidebar in five groups
  "Your desk and what needs you today: tasks, approvals, chat, your AI and your mail.":
    "Meja anda dan apa yang memerlukan anda hari ini: tugasan, kelulusan, sembang, AI anda dan e-mel anda.",
  "Files and documents, forms and reports, and the steps work follows.":
    "Fail dan dokumen, borang dan laporan, dan langkah yang diikuti kerja.",
  // P120: hierarchy, people's requests, group HOD, select all, member page, chart.
  "Hide the people under {name}":
    "Sembunyikan orang di bawah {name}",
  "Show the people under {name}":
    "Tunjukkan orang di bawah {name}",
  "1 under them":
    "1 di bawahnya",
  "{n} under them":
    "{n} di bawahnya",
  "· {n} in your whole line":
    "· {n} dalam seluruh barisan anda",
  "The people under you":
    "Orang di bawah anda",
  "You can give tasks to everyone in your line and follow their work.":
    "Anda boleh memberi tugasan kepada semua orang dalam barisan anda dan mengikuti kerja mereka.",
  "{n} requests from your people to approve":
    "{n} permohonan daripada orang anda untuk diluluskan",
  "Request to approve":
    "Permohonan untuk diluluskan",
  "Approved. {name} is told.":
    "Diluluskan. {name} dimaklumkan.",
  "Declined. {name} is told why.":
    "Ditolak. {name} dimaklumkan sebabnya.",
  "Request cancelled.":
    "Permohonan dibatalkan.",
  "{name} asked {when}":
    "{name} memohon {when}",
  "Open it in SharePoint":
    "Buka dalam SharePoint",
  "Waiting for {name} to decide.":
    "Menunggu keputusan {name}.",
  "{name} decided {when}":
    "{name} memutuskan {when}",
  "Your reason":
    "Sebab anda",
  "Why you approve or decline it (they see this)":
    "Sebab anda meluluskan atau menolaknya (mereka nampak ini)",
  "Write at least {n} letters.":
    "Tulis sekurang-kurangnya {n} huruf.",
  "Cancel my request":
    "Batalkan permohonan saya",
  "No requests from people":
    "Tiada permohonan daripada orang",
  "When someone asks for something that needs approval (such as a SharePoint folder for the Library), the person above them decides it here.":
    "Apabila seseorang memohon sesuatu yang memerlukan kelulusan (seperti folder SharePoint untuk Pustaka), orang di atasnya memutuskannya di sini.",
  "Waiting for you ({n})":
    "Menunggu anda ({n})",
  "Nothing from your people waits for you.":
    "Tiada apa-apa daripada orang anda yang menunggu anda.",
  "My requests":
    "Permohonan saya",
  "Decided lately":
    "Diputuskan baru-baru ini",
  "All {n}":
    "Semua {n}",
  "Clear all":
    "Kosongkan semua",
  "Select the {n} found":
    "Pilih {n} yang ditemui",
  "Select all ({n})":
    "Pilih semua ({n})",
  "{n} of {total} picked":
    "{n} daripada {total} dipilih",
  "SharePoint or OneDrive folder for the Library":
    "Folder SharePoint atau OneDrive untuk Pustaka",
  "Group HOD":
    "Ketua jabatan kumpulan",
  "A head of department over several companies: runs the agents, work, approvals and people of each company they are added to.":
    "Ketua jabatan bagi beberapa syarikat: menguruskan ejen, kerja, kelulusan dan orang bagi setiap syarikat yang dia ditambah.",
  "Your AI waits here before risky actions, and your people's requests wait here for your decision.":
    "AI anda menunggu di sini sebelum tindakan berisiko, dan permohonan orang anda menunggu keputusan anda di sini.",
  "From AI":
    "Daripada AI",
  "From people":
    "Daripada orang",
  "AI history":
    "Sejarah AI",
  "Pick one or more companies":
    "Pilih satu atau lebih syarikat",
  "The form is added to each company picked.":
    "Borang ditambah kepada setiap syarikat yang dipilih.",
  "Everyone in each company":
    "Semua orang dalam setiap syarikat",
  "{name} added to {n} companies. Everyone it is for sees it under Forms.":
    "{name} ditambah kepada {n} syarikat. Semua orang yang berkenaan melihatnya di bawah Borang.",
  "Ask for a SharePoint folder":
    "Mohon folder SharePoint",
  "Paste a SharePoint or OneDrive folder link. The person you report to approves it on their Approvals page, then its files join the Library.":
    "Tampal pautan folder SharePoint atau OneDrive. Orang yang anda laporkan kepadanya meluluskannya di halaman Kelulusan, kemudian failnya masuk ke Pustaka.",
  "What is in it, and why the team needs it (optional)":
    "Apa isinya, dan mengapa pasukan memerlukannya (pilihan)",
  "Why you ask":
    "Mengapa anda memohon",
  "Ask for approval":
    "Mohon kelulusan",
  "My folder requests":
    "Permohonan folder saya",
  "Open their page":
    "Buka halaman mereka",
  "That member is not here.":
    "Ahli itu tiada di sini.",
  "Role, place and access":
    "Peranan, tempat dan akses",
  "Change anything here, then Save changes at the bottom.":
    "Ubah apa-apa di sini, kemudian Simpan perubahan di bawah.",
  "This is you. Ask an owner or admin to change your own role or place.":
    "Ini anda. Minta pemilik atau admin untuk mengubah peranan atau tempat anda sendiri.",
  "You can see this member. Owners, admins and their managers change them.":
    "Anda boleh melihat ahli ini. Pemilik, admin dan pengurus mereka yang mengubahnya.",
  "1 person reports to them":
    "1 orang melapor kepadanya",
  "{n} people report to them":
    "{n} orang melapor kepadanya",
  "Nobody reports to them yet.":
    "Belum ada sesiapa melapor kepadanya.",
  "Add someone under {name}":
    "Tambah seseorang di bawah {name}",
  "Add someone under them":
    "Tambah seseorang di bawahnya",
  "Now reports to {name}":
    "Kini melapor kepada {name}",
  "Reports to no one yet":
    "Belum melapor kepada sesiapa",
  "Pick the person who reports to {name}. They move from whoever they report to now.":
    "Pilih orang yang melapor kepada {name}. Mereka berpindah daripada orang yang mereka laporkan sekarang.",
  "Search for a person":
    "Cari seseorang",
  "There is nobody you may move under them.":
    "Tiada sesiapa yang boleh anda pindahkan ke bawahnya.",
  "Save changes":
    "Simpan perubahan",
  "Sent to {name} for approval.":
    "Dihantar kepada {name} untuk kelulusan.",
  "Sent for approval.":
    "Dihantar untuk kelulusan.",
  "For which company":
    "Untuk syarikat mana",
  "{name} now reports to {boss}.":
    "{name} kini melapor kepada {boss}.",
};
