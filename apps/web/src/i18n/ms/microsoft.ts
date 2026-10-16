/** P34 Microsoft 365 / Outlook: the company's Entra app on Channels, each person's own Outlook
 * (My AI, My assistants), shared mailboxes and the Mail page. Terms: mailbox = peti mel,
 * shared mailbox = peti mel kongsi, digest = ringkasan harian, draft = draf, tenant = tenant,
 * redirect URI = URI ubah hala. Product names (Outlook, Microsoft 365, Entra) stay as they are. */
export const MICROSOFT: Record<string, string> = {
  // categories and statuses (lib/microsoft.ts)
  Invoices: "Invois",
  "Customer requests": "Permintaan pelanggan",
  Tenders: "Tender",
  Complaints: "Aduan",
  Internal: "Dalaman",
  Newsletters: "Surat berita",
  "Customer request": "Permintaan pelanggan",
  Tender: "Tender",
  Complaint: "Aduan",
  "Internal|mail": "Dalaman",
  Newsletter: "Surat berita",
  "Other|mail": "Lain-lain",
  "New|mail": "Baharu",
  Handled: "Diuruskan",
  Ignored: "Diabaikan",
  "Tasks: {list}": "Tugasan: {list}",
  "No tasks": "Tiada tugasan",
  "Saves attachments": "Simpan lampiran",
  "Digest {time}": "Ringkasan {time}",
  "Follow up after {n}h": "Susulan selepas {n} jam",
  "Checks every 3 minutes": "Semak setiap 3 minit",

  // nav
  Mail: "Mel",
  "Mail that reached your Outlook and the company's shared mailboxes, and what the AI did with each: the task it made, the file it saved, the reply it drafted for you.":
    "Mel yang masuk ke Outlook anda dan peti mel kongsi syarikat, serta apa yang AI buat dengan setiap satu: tugasan yang dibuat, fail yang disimpan, balasan yang didrafkan untuk anda.",

  // drafts (My assistants)
  "Draft updated in Outlook.": "Draf dikemas kini dalam Outlook.",
  "It is removed from your Outlook drafts. Nothing was sent.": "Ia dibuang daripada draf Outlook anda. Tiada apa-apa dihantar.",
  "Outlook calendar": "Kalendar Outlook",
  "No mailbox connected": "Tiada peti mel disambungkan",
  "Connect Gmail or Outlook in Settings and your assistants can read your inbox and calendar, draft replies and propose events. Nothing is sent or added until you approve it here.":
    "Sambungkan Gmail atau Outlook dalam Tetapan dan pembantu anda boleh membaca peti masuk dan kalendar anda, mendrafkan balasan dan mencadangkan acara. Tiada apa-apa dihantar atau ditambah sehingga anda meluluskannya di sini.",

  // Channels > Microsoft 365
  "Bills and payment requests": "Bil dan permintaan bayaran",
  "Quotes, orders, questions from customers": "Sebut harga, pesanan, soalan daripada pelanggan",
  "Tender notices and RFQs": "Notis tender dan RFQ",
  "Unhappy customers, service problems": "Pelanggan tidak berpuas hati, masalah perkhidmatan",
  "Mail from colleagues": "Mel daripada rakan sekerja",
  "Outlook mail and calendar for each person, and shared mailboxes (accounts@, tender@) that a company's agent works through.":
    "Mel dan kalendar Outlook untuk setiap orang, dan peti mel kongsi (accounts@, tender@) yang diuruskan oleh ejen syarikat.",
  "Setup guide": "Panduan persediaan",
  "Your Outlook": "Outlook anda",
  "Each person connects their own mail and calendar. Drafts wait for them.": "Setiap orang menyambungkan mel dan kalendar sendiri. Draf menunggu mereka.",
  "Shared mailboxes": "Peti mel kongsi",
  "Invoices, requests and tenders become tasks for the company's agent.": "Invois, permintaan dan tender menjadi tugasan untuk ejen syarikat.",
  "Nothing is sent until a person approves it. Private details are masked before any AI sees them.":
    "Tiada apa-apa dihantar sehingga seseorang meluluskannya. Butiran peribadi disamarkan sebelum mana-mana AI melihatnya.",
  "Change the app registration": "Tukar pendaftaran aplikasi",
  "Connect the office's Microsoft Entra app": "Sambungkan aplikasi Microsoft Entra pejabat",
  "Once, for the whole office. Your Microsoft 365 admin registers an app in Microsoft Entra and gives you its IDs.":
    "Sekali sahaja, untuk seluruh pejabat. Pentadbir Microsoft 365 anda mendaftarkan aplikasi dalam Microsoft Entra dan memberi anda ID-nya.",
  "Ask an admin to set up Microsoft 365. Then you can connect your Outlook here.":
    "Minta pentadbir menyediakan Microsoft 365. Kemudian anda boleh menyambungkan Outlook anda di sini.",
  "Checks every 3 minutes — webhooks need the public https address": "Semak setiap 3 minit — webhook memerlukan alamat https awam",
  "App {id}": "Aplikasi {id}",
  "Microsoft 365 is set up for the office.": "Microsoft 365 sudah disediakan untuk pejabat.",
  "Any work account": "Mana-mana akaun kerja",
  "Only {tenant}": "Hanya {tenant}",
  "Change app registration": "Tukar pendaftaran aplikasi",
  "New mail:": "Mel baharu:",
  "Microsoft 365 is set up. Everyone can now connect their Outlook.": "Microsoft 365 sudah disediakan. Semua orang kini boleh menyambungkan Outlook mereka.",
  "In the Entra app, add these as a Web redirect URI and (for live mail) allow Microsoft to reach the notification URL. The setup guide has every click.":
    "Dalam aplikasi Entra, tambah ini sebagai URI ubah hala Web dan (untuk mel masa nyata) benarkan Microsoft mencapai URL pemberitahuan. Panduan persediaan menunjukkan setiap klik.",
  "Redirect URI (Web)": "URI ubah hala (Web)",
  "Notification URL": "URL pemberitahuan",
  "Open the setup guide": "Buka panduan persediaan",
  "Application (client) ID": "ID aplikasi (klien)",
  "Saved: {id}. Enter it again to change anything.": "Disimpan: {id}. Masukkan semula untuk menukar apa-apa.",
  "On the app's Overview page in Microsoft Entra.": "Di halaman Overview aplikasi dalam Microsoft Entra.",
  "That is not an Application (client) ID. It looks like 1a2b3c4d-…, on the app's Overview page (not the secret value or the secret ID).":
    "Itu bukan ID aplikasi (klien). Ia kelihatan seperti 1a2b3c4d-…, di halaman Overview aplikasi (bukan nilai rahsia atau ID rahsia).",
  "Client secret value": "Nilai rahsia klien",
  "Saved. Leave blank to keep it.": "Disimpan. Biarkan kosong untuk mengekalkannya.",
  "The secret's Value (shown once in Entra), not its Secret ID. Stored encrypted, never shown again.":
    "Value rahsia itu (ditunjukkan sekali dalam Entra), bukan Secret ID. Disimpan secara disulitkan, tidak akan ditunjukkan lagi.",
  "Who may sign in": "Siapa boleh log masuk",
  "Only our company": "Hanya syarikat kami",
  "Any Microsoft 365 work or school account (tenant: organizations). Pick this if staff sign in from more than one company.":
    "Mana-mana akaun kerja atau sekolah Microsoft 365 (tenant: organizations). Pilih ini jika kakitangan log masuk dari lebih daripada satu syarikat.",
  "Only accounts in your company's Microsoft 365. Enter its tenant ID or domain.": "Hanya akaun dalam Microsoft 365 syarikat anda. Masukkan ID tenant atau domainnya.",
  "Tenant ID or domain": "ID tenant atau domain",
  "Use the tenant ID (a GUID) or a domain like company.com.my.": "Gunakan ID tenant (GUID) atau domain seperti company.com.my.",
  "Personal Microsoft accounts are not supported. Use your work tenant.": "Akaun Microsoft peribadi tidak disokong. Gunakan tenant kerja anda.",
  "Entra admin center > Overview > Tenant ID.": "Entra admin center > Overview > Tenant ID.",
  "Save Microsoft 365": "Simpan Microsoft 365",
  "Not checked yet": "Belum disemak",
  "The mailbox answered.": "Peti mel itu menjawab.",
  "The mailbox did not answer.": "Peti mel itu tidak menjawab.",
  "Mailboxes like accounts@ or tender@. The company's agent reads new mail, makes tasks, saves attachments and sends a daily digest.":
    "Peti mel seperti accounts@ atau tender@. Ejen syarikat membaca mel baharu, membuat tugasan, menyimpan lampiran dan menghantar ringkasan harian.",
  "Grant company-wide access for shared mailboxes": "Beri akses seluruh syarikat untuk peti mel kongsi",
  "Add mailbox": "Tambah peti mel",
  "Shared mailboxes need company-wide access: a Microsoft 365 admin presses the button above (admin consent), then limits the app to these mailboxes with RBAC for Applications. See the setup guide.":
    "Peti mel kongsi memerlukan akses seluruh syarikat: pentadbir Microsoft 365 menekan butang di atas (admin consent), kemudian mengehadkan aplikasi kepada peti mel ini dengan RBAC for Applications. Lihat panduan persediaan.",
  "No shared mailboxes yet. Add one and pick the company and the agent that handles it.":
    "Belum ada peti mel kongsi. Tambah satu dan pilih syarikat serta ejen yang menguruskannya.",
  "No agent": "Tiada ejen",
  "Synced {ago}": "Disegerakkan {ago}",
  Rules: "Peraturan",
  "Last sync": "Segerak terakhir",
  "Remove {address}?": "Buang {address}?",
  "The office stops reading this mailbox. Tasks and files it already made stay. The mailbox itself is not touched.":
    "Pejabat berhenti membaca peti mel ini. Tugasan dan fail yang sudah dibuat kekal. Peti mel itu sendiri tidak disentuh.",
  "Mailbox removed.": "Peti mel dibuang.",
  "Paused. The office stops reading it until you resume.": "Dijeda. Pejabat berhenti membacanya sehingga anda menyambungnya semula.",
  "Resume {name}": "Sambung semula {name}",
  "Pause {name}": "Jeda {name}",
  "Mailbox added. Press Test to check the office can read it.": "Peti mel ditambah. Tekan Uji untuk memastikan pejabat boleh membacanya.",
  "Edit shared mailbox": "Sunting peti mel kongsi",
  "Add a shared mailbox": "Tambah peti mel kongsi",
  "The agent you pick reads this mailbox for its company. Replies are drafts a person approves.":
    "Ejen yang anda pilih membaca peti mel ini untuk syarikatnya. Balasan ialah draf yang diluluskan oleh seseorang.",
  "Mailbox address": "Alamat peti mel",
  "Enter an email address.": "Masukkan alamat e-mel.",
  "It must be a shared mailbox the app is allowed to read (see the setup guide).": "Ia mesti peti mel kongsi yang aplikasi dibenarkan baca (lihat panduan persediaan).",
  "Agent that handles it": "Ejen yang menguruskannya",
  "No agent: only sort and save": "Tiada ejen: hanya isih dan simpan",
  "Make a task for": "Buat tugasan untuk",
  "Save attachments to the Library": "Simpan lampiran ke Perpustakaan",
  "Into the company's folder, so agents and people can find them.": "Ke dalam folder syarikat, supaya ejen dan orang boleh menemuinya.",
  "Daily digest": "Ringkasan harian",
  "One summary of the day's mail to the agent's people.": "Satu ringkasan mel hari itu kepada orang ejen tersebut.",
  "Digest time": "Masa ringkasan",
  "Follow up after (hours)": "Susulan selepas (jam)",
  "Whole hours, 0 to 720.": "Jam penuh, 0 hingga 720.",
  "A reminder task when a customer mail waits this long for a reply. 0 turns it off.":
    "Tugasan peringatan apabila mel pelanggan menunggu selama ini untuk dibalas. 0 mematikannya.",

  // in-app setup guide
  "Microsoft 365 setup guide": "Panduan persediaan Microsoft 365",
  "For your Microsoft 365 admin. About 15 minutes. The full guide, with the PowerShell for shared mailboxes, is MICROSOFT-365.md in the docs folder.":
    "Untuk pentadbir Microsoft 365 anda. Kira-kira 15 minit. Panduan penuh, dengan PowerShell untuk peti mel kongsi, ialah MICROSOFT-365.md dalam folder docs.",
  "1. Register the app": "1. Daftarkan aplikasi",
  "In the {entra}, open {path} and press {new}.": "Dalam {entra}, buka {path} dan tekan {new}.",
  "Name it (e.g. {name}). Supported account types: {single} for one company, or {multi} if staff sign in from several companies.":
    "Namakannya (cth. {name}). Jenis akaun yang disokong: {single} untuk satu syarikat, atau {multi} jika kakitangan log masuk dari beberapa syarikat.",
  "Under {redirect}, choose {web} and paste the redirect URI from this card.": "Di bawah {redirect}, pilih {web} dan tampal URI ubah hala daripada kad ini.",
  "Copy the {id} and the {tenant} from the app's Overview page.": "Salin {id} dan {tenant} daripada halaman Overview aplikasi.",
  "2. Create a client secret": "2. Cipta rahsia klien",
  "Open {path} and press {new}. Pick an expiry (e.g. 12 or 24 months).": "Buka {path} dan tekan {new}. Pilih tempoh tamat (cth. 12 atau 24 bulan).",
  "Copy the secret's {value} right away: Entra shows it only once. Paste it in this card.": "Salin {value} rahsia itu segera: Entra menunjukkannya sekali sahaja. Tampal dalam kad ini.",
  "Put the expiry date in your calendar and make a new secret before it runs out, then paste the new one here.":
    "Masukkan tarikh tamat dalam kalendar anda dan buat rahsia baharu sebelum ia tamat, kemudian tampal yang baharu di sini.",
  "3. API permissions (Microsoft Graph)": "3. Kebenaran API (Microsoft Graph)",
  "Delegated, for each person's own Outlook:": "Delegated, untuk Outlook setiap orang:",
  "Application, only if you use shared mailboxes:": "Application, hanya jika anda menggunakan peti mel kongsi:",
  "Add them under {path}, then press {grant}.": "Tambahkannya di bawah {path}, kemudian tekan {grant}.",
  "Or press Grant company-wide access on this card: it opens the same consent page.":
    "Atau tekan Beri akses seluruh syarikat pada kad ini: ia membuka halaman persetujuan yang sama.",
  "4. Limit the app to the shared mailboxes": "4. Hadkan aplikasi kepada peti mel kongsi",
  "Application permissions reach every mailbox in the company unless you limit them. Use Exchange Online RBAC for Applications (it replaced Application Access Policies): put the shared mailboxes in a group, make a management scope for that group, and give the app the Application Mail.ReadWrite and Mail.Send roles only within that scope. Then remove the tenant-wide Application permissions from the Entra app so RBAC is the only grant.":
    "Kebenaran Application mencapai setiap peti mel dalam syarikat kecuali anda mengehadkannya. Gunakan Exchange Online RBAC for Applications (ia menggantikan Application Access Policies): letakkan peti mel kongsi dalam satu kumpulan, buat management scope untuk kumpulan itu, dan beri aplikasi peranan Application Mail.ReadWrite dan Mail.Send hanya dalam skop itu. Kemudian buang kebenaran Application seluruh tenant daripada aplikasi Entra supaya RBAC menjadi satu-satunya kebenaran.",
  "Check the exact cmdlets on Microsoft Learn: \"Role Based Access Control for Applications in Exchange Online\". The Test button on each mailbox here shows what Microsoft answers.":
    "Semak cmdlet yang tepat di Microsoft Learn: \"Role Based Access Control for Applications in Exchange Online\". Butang Uji pada setiap peti mel di sini menunjukkan jawapan Microsoft.",
  "5. Live mail": "5. Mel masa nyata",
  "Microsoft pushes new mail to the notification URL, which must be a public https address. Without one the office checks every 3 minutes instead; everything else works the same.":
    "Microsoft menolak mel baharu ke URL pemberitahuan, yang mesti alamat https awam. Tanpanya pejabat menyemak setiap 3 minit; yang lain berfungsi sama.",
  "This server:": "Pelayan ini:",
  "What the office keeps": "Apa yang pejabat simpan",
  "Mail details (sender, subject, time, category) are stored; message bodies are fetched only when needed.":
    "Butiran mel (pengirim, subjek, masa, kategori) disimpan; kandungan mesej diambil hanya apabila perlu.",
  "Every AI call goes through the privacy gateway, which masks names, IDs and contacts first.":
    "Setiap panggilan AI melalui gerbang privasi, yang menyamarkan nama, ID dan maklumat hubungan terlebih dahulu.",
  "Replies and calendar changes are drafts until a person approves them.": "Balasan dan perubahan kalendar kekal draf sehingga seseorang meluluskannya.",
  "A person disconnects their Outlook on My AI; an admin can also revoke the app in Entra (Enterprise applications) at any time.":
    "Seseorang memutuskan Outlook mereka di AI saya; pentadbir juga boleh membatalkan aplikasi dalam Entra (Enterprise applications) bila-bila masa.",

  // Mail page
  "My Outlook": "Outlook saya",
  "What reached your Outlook and the company's shared mailboxes, and what the AI did with each.":
    "Apa yang masuk ke Outlook anda dan peti mel kongsi syarikat, serta apa yang AI buat dengan setiap satu.",
  "Microsoft 365 is not set up yet": "Microsoft 365 belum disediakan",
  "Register the office's app in Microsoft Entra once (Channels > Microsoft 365). Then everyone connects their own Outlook, and you can add shared mailboxes like accounts@ or tender@.":
    "Daftarkan aplikasi pejabat dalam Microsoft Entra sekali (Saluran > Microsoft 365). Kemudian semua orang menyambungkan Outlook sendiri, dan anda boleh menambah peti mel kongsi seperti accounts@ atau tender@.",
  "Ask an admin to set up Microsoft 365. Then you can connect your Outlook here and see what your AI does with your mail.":
    "Minta pentadbir menyediakan Microsoft 365. Kemudian anda boleh menyambungkan Outlook anda di sini dan melihat apa yang AI anda buat dengan mel anda.",
  Mailbox: "Peti mel",
  "Recent mail": "Mel terkini",
  "Newest first. Chips show what the AI did; open one to see the task, the file or the draft.":
    "Terbaharu dahulu. Cip menunjukkan apa yang AI buat; buka satu untuk melihat tugasan, fail atau draf.",
  "Which mail": "Mel mana",
  "No mail yet": "Belum ada mel",
  "New mail shows here a few seconds after it reaches your Outlook.": "Mel baharu dipaparkan di sini beberapa saat selepas ia sampai ke Outlook anda.",
  "New mail shows here within a few minutes of reaching your Outlook.": "Mel baharu dipaparkan di sini dalam beberapa minit selepas ia sampai ke Outlook anda.",
  "New mail to {address} shows here once the office has checked the mailbox.": "Mel baharu kepada {address} dipaparkan di sini sebaik pejabat menyemak peti mel itu.",
  "Nothing in this view.": "Tiada apa-apa dalam paparan ini.",
  "Shared mailboxes (accounts@, tender@) are added on Channels > Microsoft 365.": "Peti mel kongsi (accounts@, tender@) ditambah di Saluran > Microsoft 365.",
  "Connect your Outlook": "Sambungkan Outlook anda",
  "Your AI then reads new mail as it arrives, sorts it, turns invoices and requests into tasks, saves attachments and drafts replies. Nothing is sent until you approve it.":
    "AI anda kemudian membaca mel baharu sebaik ia tiba, mengisihnya, menukar invois dan permintaan menjadi tugasan, menyimpan lampiran dan mendrafkan balasan. Tiada apa-apa dihantar sehingga anda meluluskannya.",
  "Connect Outlook": "Sambungkan Outlook",
  "Handled by {name}": "Diuruskan oleh {name}",
  "No agent assigned": "Tiada ejen ditugaskan",
  "Replies waiting for you": "Balasan menunggu anda",
  "Your AI drafted these in your Outlook. Nothing is sent until you press Send.": "AI anda mendrafkan ini dalam Outlook anda. Tiada apa-apa dihantar sehingga anda tekan Hantar.",
  "All drafts": "Semua draf",
  "(no subject)": "(tiada subjek)",

  // Outlook connection
  "Company-wide access granted. The office can now read the shared mailboxes you add.":
    "Akses seluruh syarikat diberikan. Pejabat kini boleh membaca peti mel kongsi yang anda tambah.",
  "Company-wide access was not granted.": "Akses seluruh syarikat tidak diberikan.",
  "Outlook connected: {detail}.": "Outlook disambungkan: {detail}.",
  "Outlook connected.": "Outlook disambungkan.",
  "Microsoft sign-in failed.": "Log masuk Microsoft gagal.",
  "This server does not have the Microsoft 365 connection yet. Update the server to turn it on.":
    "Pelayan ini belum ada sambungan Microsoft 365. Kemas kini pelayan untuk menghidupkannya.",
  "Connected as {email}": "Disambungkan sebagai {email}",
  "Outlook disconnected.": "Outlook diputuskan.",
  "Set up Microsoft 365 once for the office (Channels > Microsoft 365), then connect your Outlook here.":
    "Sediakan Microsoft 365 sekali untuk pejabat (Saluran > Microsoft 365), kemudian sambungkan Outlook anda di sini.",
  "Microsoft asks you to sign in with your work account and allow access, then brings you back here.":
    "Microsoft meminta anda log masuk dengan akaun kerja dan membenarkan akses, kemudian membawa anda kembali ke sini.",
  "Microsoft stopped accepting this connection (the password changed, or access was removed). Reconnect to fix it.":
    "Microsoft berhenti menerima sambungan ini (kata laluan ditukar, atau akses dibuang). Sambung semula untuk membetulkannya.",
  "Some access was not allowed at sign-in. Reconnect and accept every permission Microsoft asks for.":
    "Sebahagian akses tidak dibenarkan semasa log masuk. Sambung semula dan terima setiap kebenaran yang diminta Microsoft.",
  "Disconnect your Outlook?": "Putuskan Outlook anda?",
  "Your AI can no longer read your Outlook mail or calendar, or draft replies. Drafts already in Outlook stay there.":
    "AI anda tidak lagi boleh membaca mel atau kalendar Outlook anda, atau mendrafkan balasan. Draf yang sudah ada dalam Outlook kekal di sana.",
  "Your AI reads your Outlook mail and calendar, drafts replies and proposes events. Nothing is sent until you approve it.":
    "AI anda membaca mel dan kalendar Outlook anda, mendrafkan balasan dan mencadangkan acara. Tiada apa-apa dihantar sehingga anda meluluskannya.",
  "See what came in and what your AI did": "Lihat apa yang masuk dan apa yang AI anda buat",
  "Microsoft stopped accepting this connection. Reconnect to fix it.": "Microsoft berhenti menerima sambungan ini. Sambung semula untuk membetulkannya.",
  "Read your Outlook mail and calendar, and draft replies you approve.": "Baca mel dan kalendar Outlook anda, dan draf balasan yang anda luluskan.",
  "Set up Microsoft 365 first (Channels > Microsoft 365).": "Sediakan Microsoft 365 dahulu (Saluran > Microsoft 365).",
  "Ask an admin to set up Microsoft 365.": "Minta pentadbir menyediakan Microsoft 365.",
  "Outlook (Microsoft 365)": "Outlook (Microsoft 365)",
  "Reconnect Outlook": "Sambung semula Outlook",
  "Outlook · {state}": "Outlook · {state}",
  "Your Outlook needs to be reconnected.": "Outlook anda perlu disambung semula.",
  "Until then your AI cannot read new mail or send the replies you approve.": "Sehingga itu AI anda tidak boleh membaca mel baharu atau menghantar balasan yang anda luluskan.",
  "Connect Google or Outlook and I can read your inbox and calendar too.": "Sambungkan Google atau Outlook dan saya boleh membaca peti masuk dan kalendar anda juga.",
  "Saved an email attachment": "Menyimpan lampiran e-mel",
  "What your AI does with your mail": "Apa yang AI anda buat dengan mel anda",
  "Daily report at {time}": "Laporan harian pada {time}",
  "No daily report": "Tiada laporan harian",
  "Daily report": "Laporan harian",
  "One summary of yesterday's mail: what needs you, what waits for a reply, what your AI did.":
    "Satu ringkasan mel semalam: apa yang perlukan anda, apa yang menunggu balasan, apa yang AI anda buat.",
  "Report time": "Masa laporan",
  "Make a task for my AI when mail is a": "Buat tugasan untuk AI saya apabila mel ialah",
  "Nothing ticked: your AI only flags mail and lists it in the report.":
    "Tiada yang ditanda: AI anda hanya menandakan mel dan menyenaraikannya dalam laporan.",
  "Save attachments to my workspace": "Simpan lampiran ke ruang kerja saya",
  "Into My workspace > Email attachments, checked for passwords and IDs like every upload.":
    "Ke Ruang kerja saya > Lampiran e-mel, disemak untuk kata laluan dan nombor pengenalan seperti setiap muat naik.",
  "Use a time like 08:00.": "Gunakan masa seperti 08:00.",
  "Waiting to be sorted": "Menunggu untuk diisih",
  "Waiting for your approval": "Menunggu kelulusan anda",
  "Replies and calendar changes the AI prepared in Outlook. Nothing is sent or booked until you approve it.":
    "Balasan dan perubahan kalendar yang disediakan oleh AI dalam Outlook. Tiada yang dihantar atau ditempah sehingga anda meluluskannya.",
  "Due {date}": "Tarikh akhir {date}",
  "Replied": "Sudah dibalas",
};
