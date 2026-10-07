/** P31 My computers: a person's own Windows or Mac computer, linked so their own AI can find
 * files in the folders they chose and browse on their screen. Terms: computer = komputer,
 * folder = folder, unlink = nyahpaut, paused = dijeda, link code = kod pautan. */
export const COMPUTERS: Record<string, string> = {
  // nav + page
  "My computers": "Komputer saya",
  "Let your own AI find files on your computer and browse on your screen. Only your AI can use it, only in the folders you choose.":
    "Biar AI anda sendiri mencari fail di komputer anda dan melayari web di skrin anda. Hanya AI anda boleh menggunakannya, hanya dalam folder yang anda pilih.",
  "Link a computer": "Pautkan komputer",
  "You have no personal AI yet. Only your own AI twin can use your computer: set it up first.":
    "Anda belum ada AI peribadi. Hanya kembar AI anda sendiri boleh menggunakan komputer anda: sediakannya dahulu.",
  "You have no personal assistant yet. Only your own private assistant can use your computer: make one first.":
    "Anda belum ada pembantu peribadi. Hanya pembantu peribadi anda sendiri boleh menggunakan komputer anda: buat satu dahulu.",
  "Open My assistants": "Buka Pembantu saya",
  "No computer linked yet": "Belum ada komputer dipautkan",
  "Install a small program on your Windows or Mac computer and link it with a one-time code. It takes about two minutes.":
    "Pasang satu program kecil di komputer Windows atau Mac anda dan pautkannya dengan kod sekali guna. Ia mengambil kira-kira dua minit.",

  // indicator
  "Linked to 1 computer · online": "Dipautkan ke 1 komputer · dalam talian",
  "Linked to 1 computer · offline": "Dipautkan ke 1 komputer · luar talian",
  "Linked to {n} computers · {online} online": "Dipautkan ke {n} komputer · {online} dalam talian",

  // device card
  Online: "Dalam talian",
  Offline: "Luar talian",
  "Computer name": "Nama komputer",
  "Last seen {when}": "Terakhir dilihat {when}",
  "Agent {version}": "Ejen {version}",
  "While paused, your AI cannot use this computer at all.": "Semasa dijeda, AI anda tidak boleh menggunakan komputer ini langsung.",
  "Browsers it can use": "Pelayar yang boleh digunakan",
  "No Chrome or Edge found, so browsing on this computer is off.": "Tiada Chrome atau Edge ditemui, jadi melayari web di komputer ini dimatikan.",
  "It opens its own window with a separate profile, never yours.": "Ia membuka tetingkapnya sendiri dengan profil berasingan, bukan profil anda.",
  "Your AI can only look in these folders, and the folders inside them.": "AI anda hanya boleh melihat dalam folder ini, dan folder di dalamnya.",
  "No folders: your AI cannot see any file on this computer.": "Tiada folder: AI anda tidak dapat melihat sebarang fail di komputer ini.",
  "Add a folder": "Tambah folder",
  "Tip: in Finder, right-click the folder, hold Option and choose Copy as Pathname.":
    "Petua: dalam Finder, klik kanan folder, tahan Option dan pilih Copy as Pathname.",
  "Tip: in File Explorer, right-click the folder and choose Copy as path.": "Petua: dalam File Explorer, klik kanan folder dan pilih Copy as path.",
  "Add back:": "Tambah semula:",
  "{folder} added.": "{folder} ditambah.",
  "Type or paste a folder.": "Taip atau tampal folder.",
  "Use the full path, e.g. C:\\Users\\you\\Documents on Windows or /Users/you/Documents on a Mac.":
    "Gunakan laluan penuh, cth. C:\\Users\\you\\Documents di Windows atau /Users/you/Documents di Mac.",
  "That path is for the other kind of computer.": "Laluan itu untuk jenis komputer yang lain.",
  "That is a whole disk. Pick a folder inside it.": "Itu satu cakera penuh. Pilih folder di dalamnya.",
  "Write the folder's full path without . or ..": "Tulis laluan penuh folder tanpa . atau ..",
  "That folder holds passwords or keys, so it is always refused.": "Folder itu menyimpan kata laluan atau kunci, jadi ia sentiasa ditolak.",
  "That folder is already on the list.": "Folder itu sudah ada dalam senarai.",
  "Recent activity": "Aktiviti terkini",
  "Nothing yet. Everything your AI does on this computer shows here.": "Belum ada. Semua yang AI anda buat di komputer ini dipaparkan di sini.",
  "Searched for files": "Mencari fail",
  "Looked in a folder": "Melihat dalam folder",
  "Copied a file to your workspace": "Menyalin fail ke meja kerja anda",
  "Read a file": "Membaca fail",
  "Saved a file to the computer": "Menyimpan fail ke komputer",
  Browsed: "Melayari web",
  "Settings changed": "Tetapan diubah",
  "Checked the computer": "Menyemak komputer",
  OK: "OK",
  "Outside your folders": "Di luar folder anda",
  "Not found": "Tidak dijumpai",
  "Too big": "Terlalu besar",
  "No browser": "Tiada pelayar",
  Busy: "Sibuk",
  "No answer": "Tiada jawapan",
  Unlinked: "Dinyahpaut",
  "Your AI can no longer use this computer, and the program on it forgets this account at once. To use it again, link it with a new code.":
    "AI anda tidak lagi boleh menggunakan komputer ini, dan program di dalamnya melupakan akaun ini serta-merta. Untuk menggunakannya semula, pautkannya dengan kod baharu.",

  // safety
  "What your AI can do on your computer": "Apa yang AI anda boleh buat di komputer anda",
  "Your AI can": "AI anda boleh",
  "Find and read files, only in the folders you picked.": "Mencari dan membaca fail, hanya dalam folder yang anda pilih.",
  "Copy a file into your workspace (My workspace › From my PC).": "Menyalin fail ke ruang kerja anda (Meja kerja saya › Dari PC saya).",
  "Open a browser window on your screen, with its own separate profile, and browse while you watch.":
    "Membuka tetingkap pelayar di skrin anda, dengan profilnya sendiri yang berasingan, dan melayari web sambil anda melihat.",
  "It asks you first": "Ia bertanya anda dahulu",
  "Before it saves a file to your computer.": "Sebelum menyimpan fail ke komputer anda.",
  "Before it sends a form on a website.": "Sebelum menghantar borang di laman web.",
  "It never": "Ia tidak sekali-kali",
  "Works for anyone else: company agents, colleagues and managers never reach your computer.":
    "Bekerja untuk orang lain: ejen syarikat, rakan sekerja dan pengurus tidak sekali-kali sampai ke komputer anda.",
  "Opens passwords or keys: SSH and cloud keys, password managers, keychains, browser data, .env files and certificates are always refused.":
    "Membuka kata laluan atau kunci: kunci SSH dan awan, pengurus kata laluan, keychain, data pelayar, fail .env dan sijil sentiasa ditolak.",
  "Uses your own Chrome or Edge profile, so your saved passwords and cookies stay out of reach.":
    "Menggunakan profil Chrome atau Edge anda sendiri, jadi kata laluan dan kuki tersimpan anda kekal di luar jangkauan.",
  "Does anything while the computer is paused.": "Membuat apa-apa semasa komputer dijeda.",
  "Everything it does is listed under Recent activity here, and on the computer itself (agentic-pc logs). Pause or unlink any time: it stops at once.":
    "Semua yang dibuatnya disenaraikan di bawah Aktiviti terkini di sini, dan di komputer itu sendiri (agentic-pc logs). Jeda atau nyahpaut bila-bila masa: ia berhenti serta-merta.",

  // link dialog
  "Install a small program on your computer and link it with a one-time code. Only your own AI can use it.":
    "Pasang satu program kecil di komputer anda dan pautkannya dengan kod sekali guna. Hanya AI anda sendiri boleh menggunakannya.",
  "How to install": "Cara memasang",
  "Download the app": "Muat turun aplikasi",
  "Install with one command — no warnings": "Pasang dengan satu arahan — tanpa amaran",
  "Your link code": "Kod pautan anda",
  "Works once. Expires in {time}.": "Sekali guna. Tamat dalam {time}.",
  "Waiting for your computer…": "Menunggu komputer anda…",
  "This code has expired.": "Kod ini telah tamat tempoh.",
  "Get a new code": "Dapatkan kod baharu",
  "Your computer": "Komputer anda",
  "your computer": "komputer anda",
  "Download for {os}": "Muat turun untuk {os}",
  "Windows 10 or 11 · .exe": "Windows 10 atau 11 · .exe",
  "macOS 12 or newer · .dmg": "macOS 12 atau lebih baharu · .dmg",
  "Then open it": "Kemudian bukanya",
  "The app is not signed yet, so your computer asks once whether to trust it. This is what you will see:":
    "Aplikasi ini belum ditandatangani, jadi komputer anda bertanya sekali sama ada mahu mempercayainya. Inilah yang anda akan lihat:",
  "Open the downloaded file.": "Buka fail yang dimuat turun.",
  "If you see “Windows protected your PC”, click More info → Run anyway.":
    "Jika anda nampak “Windows protected your PC”, klik More info → Run anyway.",
  "Paste the code in the app and click Link.": "Tampal kod dalam aplikasi dan klik Link.",
  "Open the downloaded file and drag Agentic Office into Applications, then open it.":
    "Buka fail yang dimuat turun dan seret Agentic Office ke Applications, kemudian bukanya.",
  "If macOS says it can't check the app: open System Settings → Privacy & Security, scroll down, click Open Anyway, then open the app again.":
    "Jika macOS kata ia tidak dapat menyemak aplikasi: buka System Settings → Privacy & Security, tatal ke bawah, klik Open Anyway, kemudian buka aplikasi sekali lagi.",
  "No download, no warnings: one line installs the program and links this computer.":
    "Tanpa muat turun, tanpa amaran: satu baris memasang program dan memautkan komputer ini.",
  "Copy the command": "Salin arahan",
  "The code inside works once and expires in 10 minutes.": "Kod di dalamnya sekali guna dan tamat dalam 10 minit.",
  "Press Start, type PowerShell, open it, paste, press Enter.": "Tekan Start, taip PowerShell, bukanya, tampal, tekan Enter.",
  "Open Terminal (Spotlight → Terminal), paste, press Enter.": "Buka Terminal (Spotlight → Terminal), tampal, tekan Enter.",
  "Wait for “Linked” (about a minute: it downloads Node.js from nodejs.org and the agent).":
    "Tunggu “Linked” (kira-kira seminit: ia memuat turun Node.js dari nodejs.org dan ejen).",
  "It starts by itself with your computer from now on. No admin rights needed.":
    "Mulai sekarang ia bermula sendiri bersama komputer anda. Tidak perlu hak pentadbir.",
  "Linked: {name}": "Dipautkan: {name}",
  "Set the folders": "Tetapkan folder",
  "Your AI can now look in Documents, Desktop and Downloads on it. Pick other folders, or remove these, any time.":
    "AI anda kini boleh melihat dalam Documents, Desktop dan Downloads di komputer itu. Pilih folder lain, atau buang yang ini, bila-bila masa.",

  // captions of the pictures of the one-time warnings (the pictures keep the system's English)
  "1. Click More info": "1. Klik More info",
  "2. Click Run anyway": "2. Klik Run anyway",
  "1. Click Done (not Move to Bin)": "1. Klik Done (bukan Move to Bin)",
  "2. Privacy & Security → Open Anyway": "2. Privacy & Security → Open Anyway",
  "scroll down": "tatal ke bawah",

  // task composer
  "Where to browse": "Di mana melayari web",
  "On the server (virtual)": "Di pelayan (maya)",
  "A browser in the office's cloud. You can watch it live.": "Pelayar dalam awan pejabat. Anda boleh menontonnya secara langsung.",
  "On my computer: {name}": "Di komputer saya: {name}",
  "A real window on your screen, from your own internet line.": "Tetingkap sebenar di skrin anda, melalui talian internet anda sendiri.",
  "No Chrome or Edge on it": "Tiada Chrome atau Edge padanya",
  "Find a file on my computer": "Cari fail di komputer saya",
  "Find the file … on my computer and save it to my workspace.": "Cari fail … di komputer saya dan simpan ke meja kerja saya.",
};
