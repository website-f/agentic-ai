# ruff: noqa: E501
"""Bahasa Melayu for what the server says: English -> Malay.

Style: apps/web/src/i18n/README.md (natural Malaysian office Malay, short, "anda", no
"sila / adalah / dengan ini" padding) and the fixed terms in apps/web/src/i18n/ms/glossary.ts
(ejen, tugasan, kelulusan, kemahiran, pelan tugas, kembar AI, pembantu, ...). Where the web
app already says the same thing, the words here are the same, so the bot and the UI match.

A key may carry a "|tag" to keep two meanings of one English word apart; English shows the
part before "|". `{vars}` must stay exactly as in the English (tests/test_i18n.py checks).
"""

MS: dict[str, str] = {
    # ------------------------------------------------------------ sign-in and access (api/deps, auth)
    "Sign in to continue.": "Log masuk untuk teruskan.",
    "Your session ended. Sign in again.": "Sesi anda sudah tamat. Log masuk semula.",
    "This account no longer has access to the workspace.": (
        "Akaun ini tiada akses lagi ke ruang kerja ini."
    ),
    "Set a new password before continuing.": "Tetapkan kata laluan baharu sebelum teruskan.",
    "Your role ({role}) cannot do this.": "Peranan anda ({role}) tidak boleh buat ini.",
    "Send requests as application/json.": "Hantar permintaan sebagai application/json.",
    "Reload the page and try again.": "Muat semula halaman dan cuba lagi.",
    "Some fields need fixing.": "Ada medan yang perlu dibetulkan.",
    "Something failed on the server. Check the api logs.": (
        "Ada masalah di pelayan. Semak log api."
    ),
    "That page cursor is not valid.": "Kursor halaman itu tidak sah.",
    "Too many failed sign-ins. Try again in {minutes} min.": (
        "Terlalu banyak cubaan log masuk gagal. Cuba lagi dalam {minutes} minit."
    ),
    "Email or password is incorrect.": "E-mel atau kata laluan salah.",
    "This account is disabled.": "Akaun ini dinyahaktifkan.",
    "This account is not in any workspace yet.": "Akaun ini belum ada dalam mana-mana ruang kerja.",
    "Current password is incorrect.": "Kata laluan semasa salah.",
    "Pick a password you have not used here.": "Pilih kata laluan yang belum pernah anda guna di sini.",
    "This install is set up.": "Pemasangan ini sudah disediakan.",
    "Your role cannot read this workspace.": "Peranan anda tidak boleh membaca ruang kerja ini.",
    # ------------------------------------------------------------ role names and statuses (i18n/labels)
    "Owner": "Pemilik",
    "Admin": "Admin",
    "Branch manager": "Pengurus cawangan",
    "Head of department": "Ketua jabatan",
    "Supervisor": "Penyelia",
    "Staff": "Kakitangan",
    "Operator": "Operator",
    "Approver": "Pelulus",
    "Viewer": "Pemerhati",
    # "{name} is {status}." reads "{name} {status}." in Malay.
    "active|agent status": "aktif",
    "paused|agent status": "sedang dijeda",
    "retired|agent status": "sudah bersara",
    # "Status tugasan ini ({status}) ... kepada {new_status}"
    "in triage|task status": "dalam saringan",
    "ready|task status": "sedia",
    "running|task status": "sedang berjalan",
    "waiting|task status": "menunggu",
    "in review|task status": "dalam semakan",
    "done|task status": "selesai",
    "failed|task status": "gagal",
    "cancelled|task status": "dibatalkan",
    # "This was already {status}." -> "Ini sudah {status}."
    "pending|decision status": "menunggu",
    "approved|decision status": "diluluskan",
    "denied|decision status": "ditolak",
    "answered|decision status": "dijawab",
    "expired|decision status": "tamat tempoh",
    "cancelled|decision status": "dibatalkan",
    "done|decision status": "selesai",
    "sent|decision status": "dihantar",
    "discarded|decision status": "dibuang",
    "failed|decision status": "gagal",
    "the whole workspace": "seluruh ruang kerja",
    "your branch": "cawangan anda",
    "your department": "jabatan anda",
    "your own agents": "ejen anda sendiri",
    "your company": "syarikat anda",
    "its person": "pemiliknya",
    # ------------------------------------------------------------ form fields (pydantic, by error type)
    "Field required": "Wajib diisi",
    "Should have at least {min_length} characters": "Sekurang-kurangnya {min_length} aksara",
    "Should have at most {max_length} characters": "Paling banyak {max_length} aksara",
    "Should have at least {min_length} items": "Sekurang-kurangnya {min_length} item",
    "Should have at most {max_length} items": "Paling banyak {max_length} item",
    "Should be greater than {gt}": "Mesti lebih daripada {gt}",
    "Should be {ge} or more": "Mesti {ge} atau lebih",
    "Should be less than {lt}": "Mesti kurang daripada {lt}",
    "Should be {le} or less": "Mesti {le} atau kurang",
    "Should be a whole number": "Mesti nombor bulat",
    "Should be a number": "Mesti nombor",
    "Should be true or false": "Mesti true atau false",
    "Should be text": "Mesti teks",
    "Should be a list": "Mesti senarai",
    "Should be an object": "Mesti objek",
    "Should be one of: {expected}": "Mesti salah satu daripada: {expected}",
    "Not a known field": "Medan ini tidak dikenali",
    "Not valid JSON": "JSON tidak sah",
    "Not a valid web address": "Alamat web tidak sah",
    "Not a valid date and time": "Tarikh dan masa tidak sah",
    "Not a valid date": "Tarikh tidak sah",
    "Not a valid id": "ID tidak sah",
    # ------------------------------------------------------------ agents (routers/agents, twins, staff)
    "That agent is not here.": "Ejen itu tiada di sini.",
    "Your role ({role}) cannot change {name}.": "Peranan anda ({role}) tidak boleh mengubah {name}.",
    "Your role ({role}) cannot add or change agents.": (
        "Peranan anda ({role}) tidak boleh menambah atau mengubah ejen."
    ),
    "You already have your AI twin, {name}. You can change it any time.": (
        "Anda sudah ada kembar AI, {name}. Anda boleh mengubahnya bila-bila masa."
    ),
    "You already have {name}. Make it your AI twin instead of adding another agent.": (
        "Anda sudah ada {name}. Jadikan ia kembar AI anda; tidak perlu tambah ejen lain."
    ),
    "You already have {n} agents. Make one of them your AI twin instead of adding another agent.": (
        "Anda sudah ada {n} ejen. Jadikan salah satu daripadanya kembar AI anda; tidak perlu "
        "tambah ejen lain."
    ),
    "Pick a branch from this workspace.": "Pilih cawangan dalam ruang kerja ini.",
    "Pick a department from this workspace.": "Pilih jabatan dalam ruang kerja ini.",
    "That department is not in the chosen branch.": "Jabatan itu bukan dalam cawangan yang dipilih.",
    "One of the SOPs is not here.": "Salah satu SOP itu tiada di sini.",
    "Unknown tools: {tools}.": "Alat yang tidak dikenali: {tools}.",
    "Ask an admin to create a company first.": "Minta admin cipta syarikat dahulu.",
    "You can only place agents in {where}.": "Anda hanya boleh meletakkan ejen dalam {where}.",
    "You already have your AI twin. You can change it any time.": (
        "Anda sudah ada kembar AI. Anda boleh mengubahnya bila-bila masa."
    ),
    "{name} sits with {who}. Change {who}'s branch or department in Members; the twin follows when it is saved again.": (
        "{name} diletakkan bersama {who}. Tukar cawangan atau jabatan {who} di Ahli; kembar AI ikut "
        "bila ia disimpan semula."
    ),
    "{name} is {who}'s AI twin: only {who} can change its name, role, persona or colour. You can still pause it or adjust its tools, SOPs and budget.": (
        "{name} ialah kembar AI {who}: hanya {who} boleh menukar nama, peranan, persona atau "
        "warnanya. Anda masih boleh menjedanya atau melaraskan alat, SOP dan bajetnya."
    ),
    "An agent cannot report to itself.": "Ejen tidak boleh melapor kepada dirinya sendiri.",
    "That would make a loop: someone above would end up reporting to this agent.": (
        "Itu akan jadi kitaran: seseorang di atas akhirnya melapor kepada ejen ini."
    ),
    "That conversation is not here.": "Perbualan itu tiada di sini.",
    "{name} is {status}.": "{name} {status}.",
    "You have no AI twin yet.": "Anda belum ada kembar AI.",
    "Only an agent of your own can become your twin.": (
        "Hanya ejen milik anda sendiri boleh menjadi kembar AI anda."
    ),
    "You already have your AI twin.": "Anda sudah ada kembar AI.",
    "Not saved: memory cannot change the rules, approvals or SOPs.": (
        "Tidak disimpan: ingatan tidak boleh mengubah peraturan, kelulusan atau SOP."
    ),
    "Not saved: never keep passwords, keys, card or IC numbers in memory.": (
        "Tidak disimpan: jangan simpan kata laluan, kunci, nombor kad atau nombor IC dalam ingatan."
    ),
    "{name}'s memory is full. Remove or merge a few entries first.": (
        "Ingatan {name} sudah penuh. Buang atau gabungkan beberapa entri dahulu."
    ),
    "AI twins are for staff. Your role ({role}) adds agents from Agents.": (
        "Kembar AI untuk kakitangan. Peranan anda ({role}) menambah ejen di Ejen."
    ),
    "This is for staff. Your role ({role}) adds agents from Agents.": (
        "Ini untuk kakitangan. Peranan anda ({role}) menambah ejen di Ejen."
    ),
    "Meet your AI worker first (step 2).": "Kenali pekerja AI anda dahulu (langkah 2).",
    "Your company and department come with your role. Ask an admin to change them.": (
        "Syarikat dan jabatan anda ikut peranan anda. Minta admin untuk menukarnya."
    ),
    "Your company was set by your manager. Ask them to change it.": (
        "Pengurus anda yang menetapkan syarikat anda. Minta pengurus untuk menukarnya."
    ),
    "Your department was set by your manager. Ask them to change it.": (
        "Pengurus anda yang menetapkan jabatan anda. Minta pengurus untuk menukarnya."
    ),
    "Pick one of the companies.": "Pilih salah satu syarikat.",
    "That department is not in the chosen company.": "Jabatan itu bukan dalam syarikat yang dipilih.",
    "Duties repeat. For a one-off, give it a task instead.": (
        "Tugas memang berulang. Untuk kerja sekali sahaja, beri tugasan."
    ),
    "Duty {n} ({title})": "Tugas {n} ({title})",
    "{label}: {problem}": "{label}: {problem}",
    "{label}: duties repeat. For a one-off, give it a task instead.": (
        "{label}: tugas memang berulang. Untuk kerja sekali sahaja, beri tugasan."
    ),
    "Unknown workflow: {name}.": "Aliran kerja tidak dikenali: {name}.",
    "Pick one of the blueprints.": "Pilih salah satu pelan tugas.",
    "First task saved but not started: {problem}": (
        "Tugasan pertama disimpan tetapi belum dimulakan: {problem}"
    ),
    # ------------------------------------------------------------ AI Engine
    "A provider called {name} already exists.": "Penyedia bernama {name} sudah ada.",
    "Changing the address needs the key typed again.": "Untuk menukar alamat, taip semula kuncinya.",
    "That key looks too short.": "Kunci itu nampak terlalu pendek.",
    "No usable key is saved. Enter the key again.": (
        "Tiada kunci sah yang disimpan. Masukkan kunci semula."
    ),
    "Enter the address and the key to test.": "Masukkan alamat dan kunci untuk diuji.",
    "Save a key first.": "Simpan kunci dahulu.",
    "That model is not here.": "Model itu tiada di sini.",
    "That workspace is not here.": "Ruang kerja itu tiada di sini.",
    "That group is not here.": "Kumpulan itu tiada di sini.",
    "One of the models belongs to a provider that is not here.": (
        "Salah satu model itu milik penyedia yang tiada di sini."
    ),
    "That provider is not here.": "Penyedia itu tiada di sini.",
    # ------------------------------------------------------------ assistants, Gmail, Calendar
    "Up to 8 personal assistants each.": "Setiap orang boleh ada sehingga 8 pembantu peribadi.",
    "Create a company (branch) first.": "Cipta syarikat (cawangan) dahulu.",
    "That is not an OAuth Client ID (it ends with .apps.googleusercontent.com). An API key will not work for Gmail.": (
        "Itu bukan OAuth Client ID (ia berakhir dengan .apps.googleusercontent.com). Kunci API "
        "tidak boleh digunakan untuk Gmail."
    ),
    "Google sign-in was cancelled.": "Log masuk Google dibatalkan.",
    "Could not reach Google. Try again.": "Tidak dapat menghubungi Google. Cuba lagi.",
    "That draft is not here.": "Draf itu tiada di sini.",
    "Connect Gmail again first.": "Sambung semula Gmail dahulu.",
    "This draft was already handled.": "Draf ini sudah diuruskan.",
    "That calendar change is not here.": "Perubahan kalendar itu tiada di sini.",
    "Reconnect Google to add Calendar first.": "Sambung semula Google untuk menambah Calendar dahulu.",
    "This is being handled already.": "Perkara ini sedang diuruskan.",
    "This was already {status}.": "Ini sudah {status}.",
    "That event was cancelled already.": "Acara itu sudah dibatalkan.",
    "Google did not allow calendar access. Reconnect Google and tick the calendar box.": (
        "Google tidak membenarkan akses kalendar. Sambung semula Google dan tandakan kotak kalendar."
    ),
    "That sign-in link expired. Start again from the dashboard.": (
        "Pautan log masuk itu sudah tamat tempoh. Mula semula dari papan pemuka."
    ),
    "Google sign-in is not set up.": "Log masuk Google belum disediakan.",
    "Google sign-in is not set up yet (Channels > Gmail).": (
        "Log masuk Google belum disediakan (Saluran > Gmail)."
    ),
    "Google refused the sign-in: {why}": "Google menolak log masuk: {why}",
    "Google gave no refresh token. Remove the app's access in your Google account and connect again.": (
        "Google tidak memberi refresh token. Buang akses aplikasi ini dalam akaun Google anda, "
        "kemudian sambung semula."
    ),
    "Gmail access was not granted. Tick the Gmail boxes on Google's screen.": (
        "Akses Gmail tidak diberi. Tandakan kotak Gmail pada skrin Google."
    ),
    "Gmail needs reconnecting ({why}).": "Gmail perlu disambung semula ({why}).",
    # ------------------------------------------------------------ blueprints, skills, learning
    "One of the skills is not here.": "Salah satu kemahiran itu tiada di sini.",
    "That blueprint is not here.": "Pelan tugas itu tiada di sini.",
    "A blueprint with that name exists.": "Pelan tugas dengan nama itu sudah ada.",
    "Each tool is allow, ask or deny.": "Setiap alat mesti allow, ask atau deny.",
    "That proposal is not here.": "Cadangan itu tiada di sini.",
    "Only approvers can change who uses a skill or retire it.": (
        "Hanya pelulus boleh menukar siapa yang guna kemahiran atau membersarakannya."
    ),
    "Add at least one check, e.g. words the answer must contain.": (
        "Tambah sekurang-kurangnya satu semakan, contohnya perkataan yang mesti ada dalam jawapan."
    ),
    "That test case is not here.": "Kes ujian itu tiada di sini.",
    "The background worker is not reachable, so the tests cannot run.": (
        "Perkhidmatan latar belakang tidak dapat dihubungi, jadi ujian tidak boleh dijalankan."
    ),
    "Add a test case first.": "Tambah kes ujian dahulu.",
    "That skill is not here.": "Kemahiran itu tiada di sini.",
    "Only active skills are optimized.": "Hanya kemahiran aktif boleh ditambah baik.",
    "The background worker is not reachable, so the optimizer cannot run.": (
        "Perkhidmatan latar belakang tidak dapat dihubungi, jadi penambahbaikan tidak boleh dijalankan."
    ),
    # ------------------------------------------------------------ memory (brain)
    "That fact is not here.": "Fakta itu tiada di sini.",
    "That company is not here.": "Syarikat itu tiada di sini.",
    "There is no page at that path.": "Tiada halaman di laluan itu.",
    "{path} is part of the vault and cannot be deleted.": (
        "{path} sebahagian daripada vault dan tidak boleh dipadam."
    ),
    "Write one short fact. Secrets (passwords, keys, card or IC numbers) are never stored.": (
        "Tulis satu fakta pendek. Rahsia (kata laluan, kunci, nombor kad atau IC) tidak akan disimpan."
    ),
    "Restore this fact before editing it.": "Pulihkan fakta ini sebelum mengubahnya.",
    "Write one short fact, with no secrets.": "Tulis satu fakta pendek, tanpa rahsia.",
    "That dream is not here.": "Mimpi itu tiada di sini.",
    "The background worker is not reachable, so the dream cannot start.": (
        "Perkhidmatan latar belakang tidak dapat dihubungi, jadi mimpi tidak boleh dimulakan."
    ),
    "That change is not in this dream.": "Perubahan itu tiada dalam mimpi ini.",
    # ------------------------------------------------------------ broadcasts
    "No active agents match that audience.": "Tiada ejen aktif yang sepadan dengan sasaran itu.",
    "That broadcast is not here.": "Hebahan itu tiada di sini.",
    "Pick who should receive this.": "Pilih siapa yang patut menerimanya.",
    # ------------------------------------------------------------ channels: devices, Telegram, WhatsApp
    "That device is not yours.": "Peranti itu bukan milik anda.",
    "Turn on notifications on this device first.": "Hidupkan notifikasi pada peranti ini dahulu.",
    "Notifications work on this device.": "Notifikasi berfungsi pada peranti ini.",
    "This button expired. Open the app to decide.": (
        "Butang ini sudah tamat tempoh. Buka aplikasi untuk membuat keputusan."
    ),
    "That approval is gone.": "Kelulusan itu sudah tiada.",
    "You can no longer decide approvals.": "Anda tidak boleh lagi memutuskan kelulusan.",
    "Approved.": "Diluluskan.",
    "Denied.": "Ditolak.",
    "That approval is not here.": "Kelulusan itu tiada di sini.",
    "That channel is not here.": "Saluran itu tiada di sini.",
    "Telegram did not accept that token: {error}": "Telegram tidak menerima token itu: {error}",
    "Could not reach Telegram from the server.": "Pelayan tidak dapat menghubungi Telegram.",
    "That token is not a bot token.": "Token itu bukan token bot.",
    "That link is not here.": "Pautan itu tiada di sini.",
    "That delivery is not here.": "Penghantaran itu tiada di sini.",
    "Only failed deliveries can be retried.": "Hanya penghantaran yang gagal boleh dicuba semula.",
    "Approval notifications are not resent; the app shows it.": (
        "Notifikasi kelulusan tidak dihantar semula; aplikasi sudah memaparkannya."
    ),
    "That token is not here.": "Token itu tiada di sini.",
    "The subscription has no keys.": "Langganan itu tiada kunci.",
    "That is not a known browser push service.": "Itu bukan perkhidmatan push pelayar yang dikenali.",
    "WhatsApp is already connected. Remove it first.": "WhatsApp sudah disambungkan. Buang dahulu.",
    "The Meta Cloud API needs the phone number id, a permanent token and the app secret.": (
        "Meta Cloud API perlukan phone number id, token kekal dan app secret."
    ),
    "Only WAHA sessions are started here.": "Hanya sesi WAHA yang dimulakan di sini.",
    "Link your WhatsApp first.": "Pautkan WhatsApp anda dahulu.",
    "Test from {url}: WhatsApp works.": "Ujian dari {url}: WhatsApp berfungsi.",
    "No such channel.": "Saluran itu tiada.",
    "Signature mismatch.": "Tandatangan tidak sepadan.",
    # ------------------------------------------------------------ documents, files, packs, reports
    "Only admins or this company's manager can change its kit.": (
        "Hanya admin atau pengurus syarikat ini boleh menukar kitnya."
    ),
    "The logo must be an image.": "Logo mesti dalam bentuk gambar.",
    "That template is not here.": "Templat itu tiada di sini.",
    "A template with that name exists.": "Templat dengan nama itu sudah ada.",
    "Upload a Word (.docx) file.": "Muat naik fail Word (.docx).",
    "That Word file could not be opened.": "Fail Word itu tidak dapat dibuka.",
    "No {{placeholders}} found. Type them into the Word file where values go, e.g. {{client_name}}, then upload it again.": (
        "Tiada {{placeholders}} dijumpai. Taip {{placeholders}} dalam fail Word di tempat nilai "
        "akan diisi, contohnya {{client_name}}, kemudian muat naik semula."
    ),
    "That document is not here.": "Dokumen itu tiada di sini.",
    "This document is approved. Reopen it to change it.": (
        "Dokumen ini sudah diluluskan. Buka semula untuk mengubahnya."
    ),
    "Your role cannot approve documents.": "Peranan anda tidak boleh meluluskan dokumen.",
    "Fix these first: {problems}": "Betulkan perkara ini dahulu: {problems}",
    "That version is not kept.": "Versi itu tidak disimpan.",
    "The model gave no text. Try again.": "Model tidak memberi sebarang teks. Cuba lagi.",
    "This document has no fields to fill.": "Dokumen ini tiada medan untuk diisi.",
    "That file is not here.": "Fail itu tiada di sini.",
    "Pick a company you work in.": "Pilih syarikat tempat anda bekerja.",
    "Files can be up to {mb} MB.": "Fail boleh sehingga {mb} MB.",
    "That file is empty.": "Fail itu kosong.",
    "Only uploads are re-read.": "Hanya fail yang dimuat naik boleh dibaca semula.",
    # P24 company documents (routers/files.py, company_files.py, intake.py)
    "That folder name is not valid.": "Nama folder itu tidak sah.",
    "This file is held back for review: it contains passwords or personal data. Ask someone who manages files to release it.": (
        "Fail ini ditahan untuk disemak: ia mengandungi kata laluan atau data peribadi. "
        "Minta orang yang mengurus fail untuk melepaskannya."
    ),
    "Pick one of: {kinds}.": "Pilih salah satu: {kinds}.",
    "Pick a department of this file's company.": "Pilih jabatan dalam syarikat fail ini.",
    "There are no files here to download.": "Tiada fail di sini untuk dimuat turun.",
    "That is {size} MB of files; one download can hold up to 1 GB. Download one folder at a time.": (
        "Jumlah fail itu {size} MB; satu muat turun boleh memuatkan sehingga 1 GB. "
        "Muat turun satu folder pada satu masa."
    ),
    "Only people who manage files can release a held-back file.": (
        "Hanya orang yang mengurus fail boleh melepaskan fail yang ditahan."
    ),
    "This file is not held back.": "Fail ini tidak ditahan.",
    "That upload is not here.": "Muat naik itu tiada di sini.",
    "You can add documents to your company only.": (
        "Anda hanya boleh menambah dokumen ke syarikat anda."
    ),
    "Pick a department of that company.": "Pilih jabatan dalam syarikat itu.",
    "One upload can be up to {mb} MB. Split the zip into smaller ones.": (
        "Satu muat naik boleh sehingga {mb} MB. Pecahkan zip itu kepada beberapa yang lebih kecil."
    ),
    "That zip file cannot be opened.": "Fail zip itu tidak boleh dibuka.",
    "Company documents": "Dokumen syarikat",
    "That pack is not here.": "Pek itu tiada di sini.",
    "{label}: that file is not here.": "{label}: fail itu tiada di sini.",
    "{label}: that document is not here.": "{label}: dokumen itu tiada di sini.",
    "No checklist came back. Try rephrasing.": "Tiada senarai semak diterima. Cuba tulis dengan cara lain.",
    "That table is not here.": "Jadual data itu tiada di sini.",
    "That report is not here.": "Laporan itu tiada di sini.",
    "Your role ({role}) cannot see the impact report.": (
        "Peranan anda ({role}) tidak boleh melihat laporan impak."
    ),
    # ------------------------------------------------------------ library, SOPs, objectives
    "Pick a department.": "Pilih jabatan.",
    "That department is in another company.": "Jabatan itu dalam syarikat lain.",
    "Pick a company.": "Pilih syarikat.",
    "You can add guidelines for {where} only.": "Anda hanya boleh menambah garis panduan untuk {where}.",
    "That SOP is not here.": "SOP itu tiada di sini.",
    "That objective is not here.": "Objektif itu tiada di sini.",
    "Only owners, admins and managers set objectives.": (
        "Hanya pemilik, admin dan pengurus boleh menetapkan objektif."
    ),
    "You can manage objectives for {where} only.": "Anda hanya boleh mengurus objektif untuk {where}.",
    "Pick an objective you see.": "Pilih objektif yang anda boleh lihat.",
    "Pick an objective you can see.": "Pilih objektif yang anda boleh lihat.",
    '"{title}" belongs to another company.': '"{title}" milik syarikat lain.',
    "An objective cannot sit under itself or one of its own parts.": (
        "Objektif tidak boleh diletakkan di bawah dirinya sendiri atau bahagiannya sendiri."
    ),
    "Objectives nest at most {n} levels deep.": "Objektif hanya boleh bertingkat sehingga {n} peringkat.",
    # ------------------------------------------------------------ MCP servers, media, monitor
    "A server with that name exists.": "Pelayan dengan nama itu sudah ada.",
    "Pick agents in this workspace.": "Pilih ejen dalam ruang kerja ini.",
    "That server is not here.": "Pelayan itu tiada di sini.",
    "Give an http(s) URL.": "Beri URL http(s).",
    "Send a voice recording (audio/webm, audio/ogg, audio/mp4, audio/mpeg or audio/wav).": (
        "Hantar rakaman suara (audio/webm, audio/ogg, audio/mp4, audio/mpeg atau audio/wav)."
    ),
    "That is a lot of recordings in a short time. Wait a few minutes and try again.": (
        "Terlalu banyak rakaman dalam masa singkat. Tunggu beberapa minit dan cuba lagi."
    ),
    "Voice recordings can be up to {mb} MB.": "Rakaman suara boleh sehingga {mb} MB.",
    "That browser is not open.": "Pelayar itu tidak dibuka.",
    "Nothing on screen yet.": "Belum ada apa-apa pada skrin.",
    # ------------------------------------------------------------ members and org
    "Pick a department from here.": "Pilih jabatan di sini.",
    "Pick a branch from here.": "Pilih cawangan di sini.",
    "A branch manager needs a branch.": "Pengurus cawangan perlukan cawangan.",
    "A head of department or supervisor needs a department.": (
        "Ketua jabatan atau penyelia perlukan jabatan."
    ),
    "Staff need a branch (their own agents are placed there).": (
        "Kakitangan perlukan cawangan (ejen mereka diletakkan di situ)."
    ),
    "You can only add people to {where}.": "Anda hanya boleh menambah orang ke {where}.",
    "{email} is already a member.": "{email} sudah menjadi ahli.",
    "You cannot change your own role. Ask another owner or admin.": (
        "Anda tidak boleh menukar peranan sendiri. Minta pemilik atau admin lain."
    ),
    "A workspace needs at least one owner.": "Ruang kerja perlukan sekurang-kurangnya seorang pemilik.",
    "You cannot remove yourself.": "Anda tidak boleh membuang diri sendiri.",
    "Use Change password for your own account.": "Guna Tukar kata laluan untuk akaun anda sendiri.",
    "That member is not here.": "Ahli itu tiada di sini.",
    "Only an owner can change owner access.": "Hanya pemilik boleh menukar akses pemilik.",
    "You can add and change only {roles} members.": (
        "Anda hanya boleh menambah dan mengubah ahli {roles}."
    ),
    "Your role ({role}) cannot manage members.": "Peranan anda ({role}) tidak boleh mengurus ahli.",
    "{branch} already has a department called {name}.": "{branch} sudah ada jabatan bernama {name}.",
    "Pick an industry: {names}.": "Pilih industri: {names}.",
    "That branch is not here.": "Cawangan itu tiada di sini.",
    "That department is not here.": "Jabatan itu tiada di sini.",
    # ------------------------------------------------------------ tasks and approvals
    "That task is not here.": "Tugasan itu tiada di sini.",
    "This task does not wait for that one.": "Tugasan ini tidak menunggu tugasan itu.",
    "Pick an agent from {where}.": "Pilih ejen dari {where}.",
    "Pick files you can see.": "Pilih fail yang anda boleh lihat.",
    "Pick a workflow you can see.": "Pilih aliran kerja yang anda boleh lihat.",
    "Cancel the run before reassigning.": "Batalkan larian sebelum menugaskan semula.",
    "A {status} task cannot be moved to {new_status} by hand.": (
        "Status tugasan ini ({status}) tidak boleh ditukar kepada {new_status} secara manual."
    ),
    "Not a failed task you can see.": "Bukan tugasan gagal yang anda boleh lihat.",
    "Over {n} per run: retry again.": "Melebihi {n} sekali cuba: cuba semula lagi.",
    "Not tried: the worker service is not reachable.": (
        "Tidak dicuba: perkhidmatan latar belakang tidak dapat dihubungi."
    ),
    "Only done, failed or cancelled work can be deleted. Cancel it first.": (
        "Hanya kerja yang selesai, gagal atau dibatalkan boleh dipadam. Batalkan dahulu."
    ),
    "A sub-task of this work is still open. Let it finish or cancel it first.": (
        "Ada sub-tugasan kerja ini yang masih terbuka. Biarkan ia siap atau batalkan dahulu."
    ),
    'This is a step of the workflow run "{title}", which is still going.': (
        'Ini satu langkah dalam larian aliran kerja "{title}", yang masih berjalan.'
    ),
    "Only work in review can be accepted.": "Hanya kerja dalam semakan boleh diterima.",
    "Only finished work can be sent back.": "Hanya kerja yang sudah siap boleh dihantar semula.",
    "Assign an agent first.": "Tugaskan ejen dahulu.",
    "Pick tasks you can see to wait for.": "Pilih tugasan yang anda boleh lihat untuk ditunggu.",
    "Type an answer.": "Taip jawapan.",
    "Approve or deny this request.": "Luluskan atau tolak permintaan ini.",
    "Temporal is not reachable, so the decision was not sent. Try again in a moment.": (
        "Temporal tidak dapat dihubungi, jadi keputusan tidak dihantar. Cuba semula sebentar lagi."
    ),
    # ------------------------------------------------------------ meetings, schedules (routers/teams)
    "That meeting is not here.": "Mesyuarat itu tiada di sini.",
    "Pick a task from here.": "Pilih tugasan di sini.",
    "This meeting has ended.": "Mesyuarat ini sudah tamat.",
    "That schedule is not here.": "Jadual itu tiada di sini.",
    "Saved, but the worker service is not reachable, so it will not run yet. Save again in a moment.": (
        "Disimpan, tetapi perkhidmatan latar belakang tidak dapat dihubungi, jadi ia belum akan "
        "berjalan. Simpan semula sebentar lagi."
    ),
    "The worker service is not reachable; try again so the schedule really stops.": (
        "Perkhidmatan latar belakang tidak dapat dihubungi; cuba lagi supaya jadual betul-betul berhenti."
    ),
    "The worker service is not reachable.": "Perkhidmatan latar belakang tidak dapat dihubungi.",
    "Not here.": "Tiada di sini.",
    # ------------------------------------------------------------ saved logins, browser tasks
    "That login is not here.": "Log masuk itu tiada di sini.",
    "You cannot change this login.": "Anda tidak boleh mengubah log masuk ini.",
    "Pick agents you can see.": "Pilih ejen yang anda boleh lihat.",
    "You have no branch.": "Anda tiada cawangan.",
    "Give the site address.": "Beri alamat laman.",
    "A login with that name exists.": "Log masuk dengan nama itu sudah ada.",
    "Your role ({role}) cannot see saved logins.": (
        "Peranan anda ({role}) tidak boleh melihat log masuk tersimpan."
    ),
    "{name} cannot use the browser yet. Ask whoever manages {name} to give it the browser tools (Permissions), or pick another agent.": (
        "{name} belum boleh guna pelayar. Minta orang yang mengurus {name} memberinya alat pelayar "
        "(Kebenaran), atau pilih ejen lain."
    ),
    "{name} may not use a saved login called '{login}'.": (
        "{name} tidak dibenarkan guna log masuk tersimpan bernama '{login}'."
    ),
    # ------------------------------------------------------------ web addresses (core/ssrf)
    "Use an http:// or https:// address.": "Guna alamat http:// atau https://.",
    "Put the key in the key field, not in the URL.": "Letak kunci dalam medan kunci, bukan dalam URL.",
    "That address has no host name.": "Alamat itu tiada nama hos.",
    "{host} is a private address, which is not allowed.": (
        "{host} ialah alamat peribadi, dan itu tidak dibenarkan."
    ),
    "{host} points to a private address ({ip}), which is not allowed.": (
        "{host} menghala ke alamat peribadi ({ip}), dan itu tidak dibenarkan."
    ),
    "Could not find {host}. Check the address.": "{host} tidak dijumpai. Semak alamatnya.",
    # ------------------------------------------------------------ notifications (channels/deliver)
    "{name} has a question": "{name} ada soalan",
    "Open it to answer.": "Buka untuk menjawab.",
    "{name} is over budget": "{name} melebihi bajet",
    "Approve more budget to continue.": "Luluskan bajet tambahan untuk teruskan.",
    "{name} needs a decision": "{name} perlukan keputusan anda",
    "Wants to: {tool}": "Mahu {tool}",
    "Wants to: {tool}: {why}": "Mahu {tool}: {why}",
    "An agent": "Seorang ejen",
    "Task: {title}": "Tugasan: {title}",
    "Open to answer: {url}": "Buka untuk menjawab: {url}",
    "Open to approve or deny: {url}": "Buka untuk luluskan atau tolak: {url}",
    "Reply to this message with your answer.": "Balas mesej ini dengan jawapan anda.",
    "Approve": "Luluskan",
    "Deny": "Tolak",
    "Message from {agent}": "Mesej daripada {agent}",
    "Message from {agent} for {owner}": "Mesej daripada {agent} bagi pihak {owner}",
    "{name} drafted an email": "{name} sudah mendraf e-mel",
    "To {to}: {subject}\n\n{preview}\n\nApprove to send it.": (
        "Kepada {to}: {subject}\n\n{preview}\n\nLuluskan untuk menghantarnya."
    ),
    "{name} wants to add a calendar event": "{name} mahu menambah acara kalendar",
    "{name} wants to change a calendar event": "{name} mahu mengubah acara kalendar",
    "{name} wants to cancel a calendar event": "{name} mahu membatalkan acara kalendar",
    "Confirm it to add it and update the guests.": "Sahkan untuk menambahnya dan memaklumkan tetamu.",
    "Confirm it to change it and update the guests.": (
        "Sahkan untuk mengubahnya dan memaklumkan tetamu."
    ),
    "Confirm it to cancel it and update the guests.": (
        "Sahkan untuk membatalkannya dan memaklumkan tetamu."
    ),
    "Confirm it to add it.": "Sahkan untuk menambahnya.",
    "Confirm it to change it.": "Sahkan untuk mengubahnya.",
    "Confirm it to cancel it.": "Sahkan untuk membatalkannya.",
    # ------------------------------------------------------------ Telegram and WhatsApp bots
    "This bot belongs to a private office. To use it, open the dashboard: Channels > Telegram > Link my account, then send the code shown there.": (
        "Bot ini milik pejabat persendirian. Untuk menggunakannya, buka papan pemuka: "
        "Saluran > Telegram > Pautkan akaun saya, kemudian hantar kod yang dipaparkan di situ."
    ),
    "You are linked. Send a message to talk to your office.": (
        "Akaun anda sudah dipautkan. Hantar mesej untuk bercakap dengan pejabat anda."
    ),
    "Your account is no longer in this workspace.": "Akaun anda tiada lagi dalam ruang kerja ini.",
    "Messages here go to {name} ({role}).": "Mesej di sini dihantar kepada {name} ({role}).",
    "Messages here go to {name}.": "Mesej di sini dihantar kepada {name}.",
    "No agent answers in this chat yet.": "Belum ada ejen yang menjawab dalam sembang ini.",
    "No agent answers here yet.": "Belum ada ejen yang menjawab di sini.",
    "Approvals arrive here with buttons. Reply to a question to answer it.": (
        "Kelulusan sampai di sini dengan butang. Balas soalan untuk menjawabnya."
    ),
    "Notices and approvals arrive here too.": "Notis dan kelulusan juga sampai di sini.",
    "Your role can read but not instruct agents.": (
        "Peranan anda boleh membaca tetapi tidak boleh memberi arahan kepada ejen."
    ),
    "No agent answers in this chat yet. Bind one in the dashboard: Channels > Telegram.": (
        "Belum ada ejen yang menjawab dalam sembang ini. Tetapkan satu di papan pemuka: "
        "Saluran > Telegram."
    ),
    "No agent answers here yet. Create your assistant in the dashboard (My assistants).": (
        "Belum ada ejen yang menjawab di sini. Cipta pembantu anda di papan pemuka (Pembantu saya)."
    ),
    "(no answer)": "(tiada jawapan)",
    "{name} could not answer: {error}": "{name} tidak dapat menjawab: {error}",
    "{name} could not answer right now: {error}": "{name} tidak dapat menjawab sekarang: {error}",
    "That code is wrong or expired. Make a new one in the dashboard.": (
        "Kod itu salah atau sudah tamat tempoh. Jana kod baharu di papan pemuka."
    ),
    "That code is wrong or expired. Make a new one in the dashboard (Channels).": (
        "Kod itu salah atau sudah tamat tempoh. Jana kod baharu di papan pemuka (Saluran)."
    ),
    "That code is for a different bot.": "Kod itu untuk bot lain.",
    "That code is for a different channel.": "Kod itu untuk saluran lain.",
    "That account no longer exists.": "Akaun itu sudah tiada.",
    "Linked to {name}. Approvals will arrive here with buttons.": (
        "Dipautkan kepada {name}. Kelulusan akan sampai di sini dengan butang."
    ),
    "Linked to {name}. Your agents' notices and approvals will arrive here, and you can message your assistant on this chat.": (
        "Dipautkan kepada {name}. Notis dan kelulusan daripada ejen anda akan sampai di sini, "
        "dan anda boleh menghantar mesej kepada pembantu anda dalam sembang ini."
    ),
    "Your role cannot answer this agent's questions.": (
        "Peranan anda tidak boleh menjawab soalan ejen ini."
    ),
    "Thanks, your answer is on its way.": "Terima kasih, jawapan anda sedang dihantar.",
    "Unknown button.": "Butang tidak dikenali.",
    "Link your account first.": "Pautkan akaun anda dahulu.",
    "Your role cannot decide approvals.": "Peranan anda tidak boleh memutuskan kelulusan.",
    "This agent is outside your area.": "Ejen ini di luar kawasan anda.",
    "Approved": "Diluluskan",
    "Denied": "Ditolak",
    "someone": "seseorang",
    "✅ Approved by {name}": "✅ Diluluskan oleh {name}",
    "✖️ Denied by {name}": "✖️ Ditolak oleh {name}",
    # Voice notes (channels/voice)
    "Voice notes are not set up here yet: an admin can add a speech-to-text model in AI Engine > Model groups > Speech to text. Please type your message for now.": (
        "Nota suara belum disediakan di sini: admin boleh tambah model speech-to-text di "
        "Enjin AI > Kumpulan model > Speech to text. Buat masa ini, taip mesej anda."
    ),
    "I could not make out that voice note right now. Please try again or type it.": (
        "Saya tidak dapat menangkap nota suara itu sekarang. Cuba lagi atau taip mesej anda."
    ),
    "I could not hear any words in that voice note.": (
        "Saya tidak dengar sebarang perkataan dalam nota suara itu."
    ),
    "I could not download that voice note. Please send it again or type it.": (
        "Saya tidak dapat memuat turun nota suara itu. Hantar semula atau taip mesej anda."
    ),
    "That voice note is too long. Please keep it under {n} minutes.": (
        "Nota suara itu terlalu panjang. Pastikan kurang daripada {n} minit."
    ),
    "That voice note is too large (over {mb} MB).": "Nota suara itu terlalu besar (lebih {mb} MB).",
    # ------------------------------------------------------------ tool labels (approval notices: "Mahu ...")
    "Calculator": "Kalkulator",
    "Current time": "Masa sekarang",
    "Team directory": "Direktori pasukan",
    "Progress update": "Kemas kini kemajuan",
    "Ask a person": "Tanya seseorang",
    "Read a web page": "Baca halaman web",
    "Search the web": "Cari di web",
    "Search memory": "Cari dalam ingatan",
    "Read a wiki page": "Baca halaman wiki",
    "Write a wiki page": "Tulis halaman wiki",
    "Remember a fact": "Ingat satu fakta",
    "Edit core memory": "Ubah ingatan teras",
    "Use a skill": "Guna kemahiran",
    "Propose a skill": "Cadangkan kemahiran",
    "Delegate work": "Agihkan kerja",
    "Hold a meeting": "Adakan mesyuarat",
    "Ask a colleague": "Tanya rakan sekerja",
    "Call in helpers": "Panggil penolong",
    "Open a web page in the browser": "Buka halaman web dalam pelayar",
    "Look at the whole page": "Lihat seluruh halaman",
    "Find on the page": "Cari dalam halaman",
    "Wait for the page": "Tunggu halaman",
    "Click in the browser": "Klik dalam pelayar",
    "Type in the browser": "Taip dalam pelayar",
    "Fill a form": "Isi borang",
    "Choose an option": "Pilih satu pilihan",
    "Tick a box": "Tandakan kotak",
    "Scroll the page": "Tatal halaman",
    "Go back": "Kembali ke halaman sebelumnya",
    "Read the page": "Baca halaman",
    "Sign in with a saved login": "Log masuk dengan log masuk tersimpan",
    "Send a form": "Hantar borang",
    "Close the browser": "Tutup pelayar",
    "Find an SOP": "Cari SOP",
    "Publish a report": "Terbitkan laporan",
    "List the company's files": "Senaraikan fail syarikat",
    "Read a file": "Baca fail",
    "Look at an image": "Lihat gambar",
    "Company details": "Butiran syarikat",
    "List document templates": "Senaraikan templat dokumen",
    "Draft a document": "Draf dokumen",
    "Revise a document": "Pinda dokumen",
    "Check a document": "Semak dokumen",
    "Pack checklist": "Senarai semak pek",
    "Attach to a pack": "Lampirkan pada pek",
    "Find an external tool": "Cari alat luar",
    "Describe an external tool": "Terangkan alat luar",
    "Run an external tool": "Jalankan alat luar",
    "Run Python code": "Jalankan kod Python",
    "Company pulse": "Ringkasan syarikat",
    "Team performance": "Prestasi pasukan",
    "Where things slip": "Di mana kerja tertangguh",
    "Notify a person": "Maklumkan seseorang",
    "Message another agent": "Hantar mesej kepada ejen lain",
    "Search my email": "Cari e-mel saya",
    "Read an email": "Membaca e-mel",
    "Draft a reply": "Draf balasan",
    "Draft a new email": "Draf e-mel baharu",
    "Search the library": "Cari dalam perpustakaan",
    "Make a picture": "Hasilkan gambar",
    "Schedule a job": "Jadualkan kerja",
    "List my schedules": "Senaraikan jadual saya",
    "Cancel a schedule": "Batalkan jadual",
    "Read my calendar": "Baca kalendar saya",
    "Find free time": "Cari masa lapang",
    "Propose a calendar event": "Cadangkan acara kalendar",
    "Propose a calendar change": "Cadangkan perubahan kalendar",
    "Propose cancelling an event": "Cadangkan pembatalan acara",
    "Keep a plan": "Catat rancangan",
    "Finance calculator": "Kalkulator kewangan",
    "Forecast a series": "Ramal siri data",
    "Meeting minutes": "Minit mesyuarat",
    "Read a full tool result": "Baca hasil penuh alat",
    "Line up a task": "Masukkan tugasan dalam giliran",
    "Research a question on the web": "Kaji soalan di web",
    # ------------------------------------------------------------ English built in other modules
    # Not marked at the source (owned elsewhere). Errors and notices that reach a person as
    # plain English are matched against these templates when they are shown or sent.
    # agents/launch.py
    "Assign an agent before starting.": "Tugaskan ejen sebelum mula.",
    "The assigned agent is not active.": "Ejen yang ditugaskan tidak aktif.",
    "This task is already running.": "Tugasan ini sedang berjalan.",
    "Could not start: the worker service is not reachable ({error}).": (
        "Tidak dapat dimulakan: perkhidmatan latar belakang tidak dapat dihubungi ({error})."
    ),
    "Could not schedule the start: the worker service is not reachable.": (
        "Tidak dapat menjadualkan permulaan: perkhidmatan latar belakang tidak dapat dihubungi."
    ),
    # agents/work_hours.py
    "The start time must look like 09:00.": "Masa mula mesti dalam bentuk 09:00.",
    "The end time must look like 09:00.": "Masa tamat mesti dalam bentuk 09:00.",
    "The break start time must look like 09:00.": "Masa mula rehat mesti dalam bentuk 09:00.",
    "The break end time must look like 09:00.": "Masa tamat rehat mesti dalam bentuk 09:00.",
    "Working hours must be an object.": "Waktu bekerja mesti objek.",
    "Pick at least one working day.": "Pilih sekurang-kurangnya satu hari bekerja.",
    "Days are numbers from 1 (Monday) to 7 (Sunday).": "Hari ialah nombor 1 (Isnin) hingga 7 (Ahad).",
    "The day cannot start at 24:00.": "Hari tidak boleh bermula pada 24:00.",
    "The day must end after it starts (overnight shifts are not supported).": (
        "Waktu tamat mesti selepas waktu mula (syif semalaman tidak disokong)."
    ),
    "At most {n} breaks a day.": "Paling banyak {n} rehat sehari.",
    "The breaks leave no time to work.": "Masa rehat tidak meninggalkan masa untuk bekerja.",
    "Unknown time zone {tz}.": "Zon waktu tidak dikenali: {tz}.",
    "Each break needs a start and an end.": "Setiap rehat perlukan masa mula dan masa tamat.",
    "The break {start}–{end} must end after it starts.": (
        "Rehat {start} hingga {end} mesti tamat selepas ia bermula."
    ),
    "The break {start}–{end} must be inside the working day.": (
        "Rehat {start} hingga {end} mesti dalam waktu bekerja."
    ),
    "Breaks must not overlap.": "Masa rehat tidak boleh bertindih.",
    # teams/blockers.py, teams/reconcile.py
    "Only work that has not started can wait for other tasks.": (
        "Hanya kerja yang belum bermula boleh menunggu tugasan lain."
    ),
    "A task can wait for at most {n} tasks.": "Satu tugasan boleh menunggu paling banyak {n} tugasan.",
    "A task cannot wait for itself.": "Tugasan tidak boleh menunggu dirinya sendiri.",
    "There is no task {id} to wait for.": "Tiada tugasan {id} untuk ditunggu.",
    '"{title}" already waits for this task (directly or through others): waiting for it would block both forever.': (
        '"{title}" sudah menunggu tugasan ini (secara terus atau melalui tugasan lain): menunggunya '
        "akan menyekat kedua-duanya selama-lamanya."
    ),
    "Needs your decision: {title}": "Perlukan keputusan anda: {title}",
    '"{title}" was cancelled. Start this anyway, remove the wait, or cancel it.': (
        '"{title}" dibatalkan. Mulakan tugasan ini juga, buang penantian, atau batalkannya.'
    ),
    '"{title}" was failed. Start this anyway, remove the wait, or cancel it.': (
        '"{title}" gagal. Mulakan tugasan ini juga, buang penantian, atau batalkannya.'
    ),
    "Stopped unexpectedly: {title}": "Terhenti tanpa diduga: {title}",
    "The run stopped unexpectedly twice. Retry it or give it to another agent.": (
        "Larian terhenti tanpa diduga dua kali. Cuba semula atau beri kepada ejen lain."
    ),
    # teams/review.py, teams/schedules.py, teams/meetings.py
    "Pick an active office agent as the reviewer.": "Pilih ejen pejabat yang aktif sebagai penyemak.",
    "Use five cron fields: minute hour day month weekday.": (
        "Guna lima medan cron: minit jam hari bulan hari-minggu."
    ),
    "Run at most every 15 minutes.": "Jalankan paling kerap setiap 15 minit.",
    "That cron expression is not valid ({error}).": "Ungkapan cron itu tidak sah ({error}).",
    "Say what the meeting is about.": "Nyatakan tujuan mesyuarat.",
    "A meeting needs at least two agents.": "Mesyuarat perlukan sekurang-kurangnya dua ejen.",
    "At most {n} agents per meeting.": "Paling banyak {n} ejen setiap mesyuarat.",
    # teams/budget.py, teams/heartbeat.py, teams/objectives.py, teams/schedules.py (notices)
    "{name}: budget at {pct}%": "{name}: bajet sudah {pct}%",
    "{name} has used {pct}% of its budget (today).": "{name} sudah guna {pct}% bajetnya (hari ini).",
    "{name} has used {pct}% of its budget (this month).": (
        "{name} sudah guna {pct}% bajetnya (bulan ini)."
    ),
    "{name} is free": "{name} sedang lapang",
    "Nothing in my queue. What should I pick up, boss?": (
        "Tiada kerja dalam giliran saya. Apa yang patut saya buat, bos?"
    ),
    "Objective budget at {pct}%": "Bajet objektif sudah {pct}%",
    '"{title}" has spent US${spent} of its US${budget} budget ({pct}%).': (
        '"{title}" sudah membelanjakan US${spent} daripada bajet US${budget} ({pct}%).'
    ),
    '"{title}" has spent US${spent} of its US${budget} budget ({pct}%). New work under it now waits for an approval.': (
        '"{title}" sudah membelanjakan US${spent} daripada bajet US${budget} ({pct}%). Kerja '
        "baharu di bawahnya kini menunggu kelulusan."
    ),
    "{who} could not finish: {title}": "{who} tidak dapat menyiapkan: {title}",
    "Scheduled job failed: {name}": "Kerja berjadual gagal: {name}",
    "Done.": "Selesai.",
    "It failed.": "Gagal.",
    # brain/pages.py, brain/core.py
    "Give the page a path, like wiki/topics/payroll.md.": (
        "Beri laluan untuk halaman ini, contohnya wiki/topics/payroll.md."
    ),
    "That path is too long.": "Laluan itu terlalu panjang.",
    "'{part}' is not allowed in a page path. Use letters, numbers, spaces and - _ .": (
        "'{part}' tidak dibenarkan dalam laluan halaman. Guna huruf, nombor, ruang dan - _ ."
    ),
    "{file} is limited to {cap} characters ({used} given). Shorten or merge entries.": (
        "{file} dihadkan kepada {cap} aksara ({used} diberi). Pendekkan atau gabungkan entri."
    ),
    # skills/store.py, skills/format.py
    "There is no skill called {name} to update.": "Tiada kemahiran bernama {name} untuk dikemas kini.",
    "{name} already says exactly this.": "{name} sudah menyatakan perkara yang sama.",
    "The safety scan found problems. Edit the skill to fix them first.": (
        "Imbasan keselamatan menjumpai masalah. Ubah kemahiran itu untuk membetulkannya dahulu."
    ),
    "A skill called {name} exists now; propose a patch instead.": (
        "Kemahiran bernama {name} sudah ada; cadangkan pembetulan untuknya."
    ),
    "The skill this proposal changes no longer exists.": (
        "Kemahiran yang diubah oleh cadangan ini sudah tiada."
    ),
    "Skill names are short kebab-case, like compare-vendor-quotes.": (
        "Nama kemahiran pendek dalam kebab-case, contohnya compare-vendor-quotes."
    ),
    "The description is one sentence (10-300 characters): what it does and when to use it.": (
        "Keterangan mesti satu ayat (10-300 aksara): apa yang ia buat dan bila perlu digunakan."
    ),
    "The skill needs instructions.": "Kemahiran ini perlukan arahan.",
    "Keep a skill under {n} characters; split it if needed.": (
        "Pastikan kemahiran kurang daripada {n} aksara; pecahkan jika perlu."
    ),
    # api/routers/desk.py (My workspace)
    "Your workspace holds up to {n} pinned items. Unpin one first.": (
        "Ruang kerja anda memuatkan sehingga {n} item yang disemat. Nyahsemat satu dahulu."
    ),
    "That is not here, or you cannot open it.": "Item itu tiada, atau anda tidak boleh membukanya.",
    "That is not on your workspace.": "Item itu tiada dalam ruang kerja anda.",
    "You have no AI worker yet. Hire one in My AI worker, or pick an agent.": (
        "Anda belum ada pekerja AI. Ambil satu di Pekerja AI saya, atau pilih ejen."
    ),
    "Find: {what}": "Cari: {what}",
    "Only managers and owners choose who else may see a task.": (
        "Hanya pengurus dan pemilik boleh memilih siapa lagi yang boleh melihat tugasan."
    ),
    "You can only choose for your own AI workers or the agents you manage.": (
        "Anda hanya boleh memilih untuk pekerja AI anda sendiri atau ejen yang anda urus."
    ),
    # documents/fill.py KIT_FIELDS (the company kit's labels)
    "Legal name": "Nama berdaftar",
    "Trading name": "Nama perniagaan",
    "Registration no.": "No. pendaftaran",
    "Tax / SST no.": "No. cukai / SST",
    "Incorporated on": "Tarikh diperbadankan",
    "Address": "Alamat",
    "Phone": "Telefon",
    "Email": "E-mel",
    "Website": "Laman web",
    "Bank": "Bank",
    "Account no.": "No. akaun",
    "Account holder": "Pemegang akaun",
    "Signatory name": "Nama penandatangan",
    "Signatory title": "Jawatan penandatangan",
    "Directors (one per line)": "Pengarah (satu setiap baris)",
    "Currency": "Mata wang",
    "Tax label": "Label cukai",
    "Tax rate (%)": "Kadar cukai (%)",
    "Payment terms": "Terma bayaran",
    "Document language": "Bahasa dokumen",
    "Brand colour": "Warna jenama",
    "Footer note": "Nota kaki",
    # org/starter.py
    "Unknown industry. Pick one of: {names}.": "Industri tidak dikenali. Pilih salah satu: {names}.",
    # engine/gateway.py (what a person sees when no model can answer)
    "No model in the {group} group could answer.": (
        "Tiada model dalam kumpulan {group} yang dapat menjawab."
    ),
    "There is no model group called '{group}'.": "Tiada kumpulan model bernama '{group}'.",
    "The {group} group does not chat. Pick a chat group such as Smart or Fast.": (
        "Kumpulan {group} bukan untuk sembang. Pilih kumpulan sembang seperti Smart atau Fast."
    ),
    "The {group} group has no models yet. Add some in AI Engine > Model groups.": (
        "Kumpulan {group} belum ada model. Tambah di Enjin AI > Kumpulan model."
    ),
    "No model in the {group} group is usable right now (off, keyless or resting).": (
        "Tiada model dalam kumpulan {group} yang boleh digunakan sekarang (dimatikan, tiada "
        "kunci atau sedang berehat)."
    ),
    "The recording is empty.": "Rakaman itu kosong.",
    "Voice recordings can be up to {n} minutes long.": "Rakaman suara boleh sehingga {n} minit.",
    "Describe the picture to make.": "Terangkan gambar yang hendak dihasilkan.",
    # Schedules: the questions teams/when.py asks back (P23)
    "e.g. 'every Monday at 9am', 'every weekday at 8:30am', 'every 2 hours', "
    "'tomorrow 9am', 'on 10 Oct at 4pm', or a cron line like '0 9 * * 1'": (
        "cth. 'setiap Isnin 9 pagi', 'setiap hari bekerja jam 8.30 pagi', 'setiap 2 jam', "
        "'esok 9 pagi', '10 Okt jam 4 petang', atau baris cron seperti '0 9 * * 1'"
    ),
    "e.g. 'setiap Isnin 9 pagi', 'setiap hari bekerja jam 8.30 pagi', 'setiap 2 jam', "
    "'esok 3 petang', '1hb setiap bulan 9 pagi', or a cron line like '0 9 * * 1'": (
        "cth. 'setiap Isnin 9 pagi', 'setiap hari bekerja jam 8.30 pagi', 'setiap 2 jam', "
        "'esok 3 petang', '1hb setiap bulan 9 pagi', atau baris cron seperti '0 9 * * 1'"
    ),
    "Unknown time zone '{tz}'.": "Zon waktu '{tz}' tidak dikenali.",
    "'{raw}' is not a time of day. Say e.g. 9 pagi or 3.30 petang.": (
        "'{raw}' bukan waktu yang betul. Tulis, contohnya, 9 pagi atau 3.30 petang."
    ),
    "Is 12 pagi midnight or noon? Say 12 tengah malam or 12 tengah hari.": (
        "12 pagi itu tengah malam atau tengah hari? Tulis 12 tengah malam atau 12 tengah hari."
    ),
    "'{raw}' is not a time of day. Say e.g. 6 pagi.": (
        "'{raw}' bukan waktu yang betul. Tulis, contohnya, 6 pagi."
    ),
    "'{raw}': is that {h} pagi or {h} petang?": "'{raw}': maksud anda {h} pagi atau {h} petang?",
    "Do you mean {hhmm} after midnight? Say {h} pagi (or {hhmm}) so the day is clear.": (
        "Maksud anda {hhmm} selepas tengah malam? Tulis {h} pagi (atau {hhmm}) supaya harinya "
        "jelas."
    ),
    "'{raw}': midnight is 12 tengah malam. Which time do you mean?": (
        "'{raw}': tengah malam ialah 12 tengah malam. Pukul berapa yang anda maksudkan?"
    ),
    "'{raw}' is not a real date (day/month). Which day do you mean?": (
        "'{raw}' bukan tarikh yang wujud (hari/bulan). Hari apa yang anda maksudkan?"
    ),
    "Is '{raw}' in the morning or in the afternoon? Say {hm} pagi or {hm} petang "
    "(or {am} / {pm}).": (
        "'{raw}' itu pagi atau petang? Tulis {hm} pagi atau {hm} petang (atau {am} / {pm})."
    ),
    "Is that 12 noon or midnight? Say 12 tengah hari or 12 tengah malam.": (
        "Itu 12 tengah hari atau tengah malam? Tulis 12 tengah hari atau 12 tengah malam."
    ),
    "Is that {h} in the morning or in the evening? Say {h} pagi, {h} petang or {h} malam "
    "(or {am} / {pm}).": (
        "{h} itu pagi atau malam? Tulis {h} pagi, {h} petang atau {h} malam (atau {am} / {pm})."
    ),
    "'{raw}' is not a time of day. Say e.g. 9am or 4:30pm.": (
        "'{raw}' bukan waktu yang betul. Tulis, contohnya, 9 pagi atau 4.30 petang."
    ),
    "Is that {h} in the morning or in the evening? Say {h}am or {h}pm (or {am} / {pm}).": (
        "{h} itu pagi atau petang/malam? Tulis {h} pagi atau {h} petang/malam (atau {am} / {pm})."
    ),
    "At what time on that day? Say e.g. 9am or 16:30.": (
        "Pukul berapa pada hari itu? Tulis, contohnya, 9 pagi atau 16:30."
    ),
    "At what time should it run? Say e.g. 9am or 16:30.": (
        "Pukul berapa ia patut berjalan? Tulis, contohnya, 9 pagi atau 16:30."
    ),
    "At what time should it run? Say e.g. 9 pagi or 4.30 petang.": (
        "Pukul berapa ia patut berjalan? Tulis, contohnya, 9 pagi atau 4.30 petang."
    ),
    "That has more than one time ({times}). Which one? (For several, set up one schedule each.)": (
        "Ada lebih daripada satu waktu ({times}). Yang mana satu? (Untuk beberapa waktu, buat "
        "satu jadual bagi setiap satu.)"
    ),
    "Is {raw} the {a} {month_b} or the {b} {month_a}? Write the month as a word, e.g. '10 Oct'.": (
        "{raw} itu {a} {month_b} atau {b} {month_a}? Tulis nama bulan, contohnya '10 Okt'."
    ),
    "'{raw}' is not a real date. Which day do you mean?": (
        "'{raw}' bukan tarikh yang wujud. Hari apa yang anda maksudkan?"
    ),
    "When should it run? {examples}.": "Bila ia patut berjalan? {examples}.",
    "Name the days it should run instead, e.g. 'every Monday to Thursday at 9am' "
    "(or 'setiap Isnin hingga Khamis 9 pagi').": (
        "Sebutkan hari yang ia patut berjalan, contohnya 'setiap Isnin hingga Khamis 9 pagi'."
    ),
    "A schedule can't skip weeks or days. Shall it run every week on that day, or on fixed "
    "dates such as the 1st and 15th of the month?": (
        "Jadual tidak boleh melangkau minggu atau hari. Mahu ia berjalan setiap minggu pada hari "
        "itu, atau pada tarikh tetap seperti 1hb dan 15hb setiap bulan?"
    ),
    "'The last day of the month' isn't possible. The 28th, or the 1st?": (
        "'Hari terakhir bulan' tidak boleh dijadualkan. 28hb, atau 1hb?"
    ),
    "How long from now? Between a minute and a year.": (
        "Berapa lama dari sekarang? Antara satu minit hingga setahun."
    ),
    "Run at most every {n} minutes.": "Jadual boleh berjalan paling kerap setiap {n} minit.",
    "Between which times? Say e.g. 'between 9am and 5pm'.": (
        "Antara pukul berapa? Tulis, contohnya, 'antara 9 pagi dan 5 petang'."
    ),
    "Use whole hours for the window, start before end, e.g. 9am to 5pm.": (
        "Gunakan jam penuh untuk tempoh itu, dengan waktu mula sebelum waktu tamat, contohnya "
        "9 pagi hingga 5 petang."
    ),
    "Every {n} minutes doesn't fit evenly into an hour. 15, 20 or 30 minutes, or every hour?": (
        "Setiap {n} minit tidak sekata dalam sejam. 15, 20 atau 30 minit, atau setiap jam?"
    ),
    "That interval doesn't fit evenly into a day. Every 1, 2, 3, 4, 6, 8 or 12 hours?": (
        "Selang itu tidak sekata dalam sehari. Setiap 1, 2, 3, 4, 6, 8 atau 12 jam?"
    ),
    "Which day of the month? e.g. 'every month on the 1st at 9am'.": (
        "Hari bulan yang mana? Contohnya '1hb setiap bulan 9 pagi'."
    ),
    "Some months have no 29th, 30th or 31st, so it would skip them. The 28th or the 1st instead?": (
        "Ada bulan yang tiada 29hb, 30hb atau 31hb, jadi bulan itu akan terlepas. Guna 28hb atau "
        "1hb?"
    ),
    "Which date each year? e.g. 'every year on 1 Jan at 9am'.": (
        "Tarikh apa setiap tahun? Contohnya 'setiap tahun 1 Jan 9 pagi'."
    ),
    "Which day of the week? e.g. 'every Monday at 9am'.": (
        "Hari apa setiap minggu? Contohnya 'setiap Isnin 9 pagi'."
    ),
    "How often? {examples}.": "Berapa kerap? {examples}.",
    "Those times have different minutes. Set up one schedule for each time.": (
        "Minit bagi waktu-waktu itu berbeza. Buat satu jadual bagi setiap waktu."
    ),
    "That names several days. For a repeat, say 'every Monday and Friday'; for once, pick one "
    "day.": (
        "Itu menyebut beberapa hari. Untuk berulang, tulis 'setiap Isnin dan Jumaat'; untuk "
        "sekali sahaja, pilih satu hari."
    ),
    "Which day next month, and at what time?": "Hari apa bulan depan, dan pukul berapa?",
    "Which day next week, and at what time?": "Hari apa minggu depan, dan pukul berapa?",
    "Once (today or tomorrow?) or every day at that time? Say e.g. 'tomorrow at 9am' or "
    "'every day at 9am'.": (
        "Sekali sahaja (hari ini atau esok?) atau setiap hari pada waktu itu? Tulis, contohnya, "
        "'esok 9 pagi' atau 'setiap hari 9 pagi'."
    ),
    "I could not tell when. {examples}.": "Saya tidak pasti bila. {examples}.",
    "{when} has already passed. Did you mean another day?": (
        "{when} sudah berlalu. Maksud anda hari lain?"
    ),
    "That is more than a year away. Which date do you mean?": (
        "Itu lebih daripada setahun lagi. Tarikh mana yang anda maksudkan?"
    ),
    # Workflows and workflow runs (routers + workflows/runs.py)
    "That run is not here.": "Larian itu tiada di sini.",
    "That workflow is not here.": "Aliran kerja itu tiada di sini.",
    "Your role cannot take decisions.": "Peranan anda tidak boleh membuat keputusan.",
    "This run has already finished.": "Larian ini sudah selesai.",
    "{name} is not active.": "{name} tidak aktif.",
    "A workflow with that name exists.": "Aliran kerja dengan nama itu sudah ada.",
    "{n} run(s) of this workflow are still going. Cancel or finish them first.": "{n} larian aliran kerja ini masih berjalan. Batalkan atau selesaikannya dahulu.",
    "Describe the job in a sentence or two.": "Terangkan kerja itu dalam satu dua ayat.",
    "The model did not return a usable draft. Try again.": "Model tidak memberikan draf yang boleh digunakan. Cuba lagi.",
    "The draft had no steps. Try rephrasing.": "Draf itu tiada langkah. Cuba tulis dengan cara lain.",
    "This workflow has no steps yet.": "Aliran kerja ini belum ada langkah.",
    "A workflow can run at most {n} steps.": "Satu aliran kerja boleh menjalankan paling banyak {n} langkah.",
    "Add a Start step (or a step nothing leads into) so the run knows where to begin.": "Tambah langkah Mula (atau langkah yang tiada apa-apa menuju kepadanya) supaya larian tahu di mana hendak bermula.",
    "Choose who does: {steps}.": "Pilih siapa yang buat: {steps}.",
    'The decision "{title}" has no branches to choose from.': 'Keputusan "{title}" tiada cabang untuk dipilih.',
    "That decision is not waiting.": "Keputusan itu tidak sedang menunggu.",
    "Pick one of the decision's branches.": "Pilih satu cabang keputusan itu.",
    "That step is not waiting for an answer.": "Langkah itu tidak sedang menunggu jawapan.",
    "Write the answer first.": "Tulis jawapan dahulu.",
    "That step is not waiting.": "Langkah itu tidak sedang menunggu.",
    "Only a failed step can be retried.": "Hanya langkah yang gagal boleh dicuba semula.",
    # SOPs and workflows drafted from documents (P24: intake/builders.py, routers/builders.py)
    "Pick at least one document.": "Pilih sekurang-kurangnya satu dokumen.",
    "Pick documents from one workspace.": "Pilih dokumen daripada satu ruang kerja.",
    "None of these documents can be used yet: they are still being read, could not be read, or are held for review.": "Belum ada dokumen ini yang boleh digunakan: masih dibaca, tidak dapat dibaca, atau ditahan untuk semakan.",
    "Pick a department of this company.": "Pilih jabatan syarikat ini.",
    "Pick a company from this workspace.": "Pilih syarikat daripada ruang kerja ini.",
    "The model did not return a usable workflow. Try again.": "Model tidak memberi aliran kerja yang boleh digunakan. Cuba lagi.",
    "Reading part {i} of {n}": "Membaca bahagian {i} daripada {n}",
    "Putting the parts together": "Menggabungkan semua bahagian",
    "Writing the SOP": "Menulis SOP",
    "Drafting the workflow": "Menyediakan draf aliran kerja",
    "Waiting to start": "Menunggu untuk bermula",
    "The build failed on the server. Try again.": "Binaan gagal di pelayan. Cuba lagi.",
    'These documents do not seem to describe "{focus}". Check the name, or pick other documents.': 'Dokumen ini nampaknya tidak menerangkan "{focus}". Semak nama itu, atau pilih dokumen lain.',
    "{name} is held for review because it may hold passwords or personal data. Release it first.": "{name} ditahan untuk semakan kerana mungkin mengandungi kata laluan atau data peribadi. Lepaskan dahulu.",
    "{name} is still being read. Try again in a minute.": "{name} masih dibaca. Cuba lagi sekejap lagi.",
    "{name} could not be read, so it cannot be used.": "{name} tidak dapat dibaca, jadi tidak boleh digunakan.",
    "That build is not here.": "Binaan itu tiada di sini.",
    "That suggestion is not here.": "Cadangan itu tiada di sini.",
    "This suggestion is built already. Delete the draft instead.": "Cadangan ini sudah dibina. Padamkan drafnya jika tidak diperlukan.",
    # Meeting minutes (routers/minutes.py)
    "You can file meeting minutes for your department only.": "Anda hanya boleh memfailkan minit mesyuarat untuk jabatan anda.",
    "You can file meeting minutes for your company only.": "Anda hanya boleh memfailkan minit mesyuarat untuk syarikat anda.",
    "Recordings can be up to {size}.": "Rakaman boleh sehingga {size}.",
    "You can read these minutes, not change them.": "Anda boleh membaca minit ini, tetapi tidak boleh mengubahnya.",
    "Upload an audio or video recording (mp3, m4a, wav, ogg, webm, mp4, mov).": "Muat naik rakaman audio atau video (mp3, m4a, wav, ogg, webm, mp4, mov).",
    "The server is short of disk space for this recording. Tell an admin.": "Ruang cakera pelayan tidak cukup untuk rakaman ini. Beritahu admin.",
    "The minutes are not written yet.": "Minit belum ditulis lagi.",
    "These minutes are approved in Documents. Reopen them there to change them.": "Minit ini sudah diluluskan dalam Dokumen. Buka semula di sana untuk mengubahnya.",
    "Only a failed recording can be retried.": "Hanya rakaman yang gagal boleh dicuba semula.",
    "The recording is no longer on the server. Upload it again.": "Rakaman itu sudah tiada di pelayan. Muat naik semula.",
    "This recording is still being processed.": "Rakaman ini masih diproses.",
    "There is no transcript yet.": "Transkrip belum ada lagi.",
    "This recording has no separate speakers.": "Rakaman ini tidak diasingkan mengikut penutur.",
    "There is no speaker {label} in this recording.": "Tiada penutur {label} dalam rakaman ini.",
    "Names can be up to 80 characters.": "Nama boleh sehingga 80 aksara.",
    "That speaker is not here.": "Penutur itu tiada di sini.",
    "The audio is no longer kept.": "Audio itu sudah tidak disimpan.",
    "There is no clear stretch of this voice.": "Tiada bahagian yang jelas untuk suara ini.",
    "That action item is not here.": "Tindakan itu tiada di sini.",
    "Use a date like 2026-10-31.": "Gunakan tarikh seperti 2026-10-31.",
    "Pick an agent from {scope}.": "Pilih ejen daripada {scope}.",
    # P25 provenance and review of what agents make (documents/provenance, routers/documents)
    "{title}, made by {agent} (AI agent). Version {version}.": "{title}, disediakan oleh {agent} (ejen AI). Versi {version}.",
    "{title}, saved from Documents. Version {version}.": "{title}, disimpan daripada Dokumen. Versi {version}.",
    "This document is approved.": "Dokumen ini sudah diluluskan.",
    "No agent made this document. Edit it yourself instead.": "Dokumen ini bukan disediakan oleh ejen. Sunting sendiri.",
    "{name} is not active, so it cannot revise this. Edit it yourself instead.": "{name} tidak aktif, jadi tidak boleh membetulkan dokumen ini. Sunting sendiri.",
    "{name} is still working on this task. Send it back when the task finishes.": "{name} masih membuat tugasan ini. Hantar semula selepas tugasan selesai.",
    "Revise: {title}": "Betulkan: {title}",
    "This was sent back already. Wait for {name} to revise it.": "Dokumen ini sudah dihantar semula. Tunggu {name} membetulkannya.",
    "Export a document": "Eksport dokumen",
    # P25 document search (search_tools.py)
    "Search documents": "Cari dokumen",
}
