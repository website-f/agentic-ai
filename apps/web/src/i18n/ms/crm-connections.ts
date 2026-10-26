/** P50 CRM connections: bring records in from other systems (Shopify, WooCommerce, Stripe,
 * HubSpot, Airtable, Google Sheet, a CSV file, any API, or a webhook) as CRM lists that keep
 * themselves up to date. Terms: record = rekod, list = senarai, sync = segerak, connection =
 * sambungan, key = kunci, web address = alamat web, field = medan. Product names, CSV, JSON,
 * API, webhook and token stay. */
export const CRM_CONNECTIONS: Record<string, string> = {
  // how often
  "Every 15 minutes": "Setiap 15 minit",
  "Every 30 minutes": "Setiap 30 minit",
  "Every hour": "Setiap jam",
  "Every 3 hours": "Setiap 3 jam",
  "Every 6 hours": "Setiap 6 jam",
  "Twice a day": "Dua kali sehari",
  "Once a day": "Sekali sehari",
  "Once a week": "Sekali seminggu",
  "Every {n} minutes": "Setiap {n} minit",

  // how the key is sent
  "As a \"Bearer\" token": "Sebagai token \"Bearer\"",
  "The most common way": "Cara paling biasa",
  "In a header with its own name": "Dalam header dengan namanya sendiri",
  "e.g. X-API-Key": "cth. X-API-Key",
  "Inside the web address": "Di dalam alamat web",
  "e.g. ?api_key=...": "cth. ?api_key=...",
  "Username and password": "Nama pengguna dan kata laluan",
  "The key is the password": "Kunci itu ialah kata laluan",

  // paging
  "Everything comes in one reply": "Semua datang dalam satu balasan",
  "Page numbers (page=2, page=3...)": "Nombor halaman (page=2, page=3...)",
  "Skip a number of records (offset=100...)": "Langkau sejumlah rekod (offset=100...)",
  "A \"next\" value inside the reply": "Nilai \"next\" di dalam balasan",
  "A \"next\" link in the reply headers": "Pautan \"next\" dalam header balasan",
  "Stripe style (starting_after)": "Gaya Stripe (starting_after)",

  // page
  "Connect a system": "Sambungkan sistem",
  "Other systems whose records show up in your CRM, kept up to date by themselves.":
    "Sistem lain yang rekodnya muncul dalam CRM anda, dikemas kini dengan sendirinya.",
  "Bring in data from your other systems": "Bawa masuk data daripada sistem anda yang lain",
  "Connect another system and its records show up here as a CRM list that keeps itself up to date. For example: orders from your online store (Shopify, WooCommerce), customers and payments from Stripe, contacts from HubSpot, or a list you keep in a Google Sheet.":
    "Sambungkan sistem lain dan rekodnya akan muncul di sini sebagai senarai CRM yang dikemas kini dengan sendirinya. Contohnya: pesanan daripada kedai dalam talian anda (Shopify, WooCommerce), pelanggan dan bayaran daripada Stripe, kenalan daripada HubSpot, atau senarai yang anda simpan dalam Google Sheet.",
  "Keys and passwords you give are stored encrypted and never shown again, not even to you.":
    "Kunci dan kata laluan yang anda berikan disimpan secara disulitkan dan tidak ditunjukkan lagi, termasuk kepada anda.",
  "It did not work this time.": "Kali ini ia tidak berjaya.",
  "{name} is on.": "{name} sudah dihidupkan.",

  // card
  "Nothing received yet": "Belum ada yang diterima",
  "Not synced yet": "Belum disegerakkan",
  "Last try failed {when}": "Cubaan terakhir gagal {when}",
  "Last received {when}": "Terakhir diterima {when}",
  "Synced {when}": "Disegerakkan {when}",
  "Another system sends us records": "Sistem lain menghantar rekod kepada kita",
  "Another system": "Sistem lain",
  "More for {name}": "Lagi untuk {name}",
  "Change key or password": "Tukar kunci atau kata laluan",
  "Change how often": "Tukar kekerapan",
  "Fills the list": "Mengisi senarai",
  "Its list was removed. Remove this connection and connect again.":
    "Senarainya telah dibuang. Buang sambungan ini dan sambungkan semula.",
  "Accept records": "Terima rekod",
  "Keep it up to date": "Kemas kini secara automatik",
  "Paused: what it sends is turned away": "Dijeda: apa yang dihantarnya ditolak",
  "Sync now": "Segerakkan sekarang",
  "We stop reading from this system. The records already brought in stay in {list}, and you can remove that list separately.":
    "Kami berhenti membaca daripada sistem ini. Rekod yang sudah dibawa masuk kekal dalam {list}, dan anda boleh membuang senarai itu secara berasingan.",
  "We stop reading from this system.": "Kami berhenti membaca daripada sistem ini.",
  "No changes": "Tiada perubahan",
  "{a} new, {b} changed": "{a} baharu, {b} berubah",
  "Up to date.": "Sudah terkini.",
  "Up to date. Nothing new.": "Sudah terkini. Tiada yang baharu.",
  "Up to date: {a} new, {b} changed.": "Sudah terkini: {a} baharu, {b} berubah.",

  // webhook address
  "The address to paste into the other system was shown once, when you made this.":
    "Alamat untuk ditampal ke dalam sistem lain hanya ditunjukkan sekali, semasa anda membuat ini.",
  "Get a new address": "Dapatkan alamat baharu",
  "Get a new address?": "Dapatkan alamat baharu?",
  "The old address stops working at once. Paste the new one into the other system.":
    "Alamat lama terus berhenti berfungsi. Tampal yang baharu ke dalam sistem lain.",
  "Paste this address into the other system where it asks where to send data (often called a \"webhook URL\"). Copy it now: it is shown only this once.":
    "Tampal alamat ini ke dalam sistem lain di tempat ia bertanya ke mana hendak menghantar data (selalunya dipanggil \"webhook URL\"). Salin sekarang: ia ditunjukkan sekali ini sahaja.",

  // change key
  "Saved, but it still did not work: {error}": "Disimpan, tetapi masih tidak berjaya: {error}",
  "Saved, and it works.": "Disimpan, dan ia berfungsi.",
  "Paste the new one from {name}. The old one is replaced.": "Tampal yang baharu daripada {name}. Yang lama akan diganti.",
  "Save and try it": "Simpan dan cuba",
  "New key or password": "Kunci atau kata laluan baharu",
  "A key is saved now. It is stored encrypted and never shown again.":
    "Satu kunci sudah disimpan. Ia disimpan secara disulitkan dan tidak ditunjukkan lagi.",
  "Stored encrypted and never shown again.": "Disimpan secara disulitkan dan tidak ditunjukkan lagi.",

  // how often
  "How often to sync": "Kekerapan segerak",
  "How often we read {name} for new and changed records.": "Seberapa kerap kami membaca {name} untuk rekod baharu dan yang berubah.",
  "Check for changes": "Semak perubahan",

  // key labels
  "Admin API access token": "Admin API access token",
  "Consumer secret": "Consumer secret",
  "Private app token": "Private app token",
  "Restricted key": "Restricted key",
  "Personal access token": "Personal access token",
  "Key or password from that system": "Kunci atau kata laluan daripada sistem itu",

  // form errors
  "Paste the web address.": "Tampal alamat web.",
  "Paste the full web address, starting with https://": "Tampal alamat web penuh, bermula dengan https://",
  "Paste the key from that system.": "Tampal kunci daripada sistem itu.",
  "Type your store address.": "Taip alamat kedai anda.",
  "Type your website address.": "Taip alamat laman web anda.",
  "Paste the consumer key.": "Tampal consumer key.",
  "That does not look like an Airtable table link. Open the table and copy the address from your browser.":
    "Itu tidak kelihatan seperti pautan jadual Airtable. Buka jadual itu dan salin alamat daripada pelayar anda.",
  "Choose a CSV file.": "Pilih fail CSV.",
  "Paste the Google Sheet's address (it starts with https://docs.google.com/spreadsheets/).":
    "Tampal alamat Google Sheet (ia bermula dengan https://docs.google.com/spreadsheets/).",
  "Say where the \"next\" value is in the reply.": "Nyatakan di mana nilai \"next\" berada dalam balasan.",
  "It answered, but no records were found. Check the address, or (Advanced) where the list sits in the reply.":
    "Ia menjawab, tetapi tiada rekod ditemui. Semak alamat, atau (Lanjutan) di mana senarai berada dalam balasan.",
  "Give the list a name.": "Beri nama kepada senarai.",

  // results
  "Copied from {file}": "Disalin daripada {file}",
  "{n} records copied in.": "{n} rekod disalin masuk.",
  "{n} rows were skipped.": "{n} baris dilangkau.",
  "{name} is connected.": "{name} sudah disambungkan.",
  "Records the other system sends will appear in this list.": "Rekod yang dihantar oleh sistem lain akan muncul dalam senarai ini.",
  "The list is made, but the first sync did not work: {error}": "Senarai sudah dibuat, tetapi segerak pertama tidak berjaya: {error}",
  "{n} records brought in. It will keep itself up to date.": "{n} rekod dibawa masuk. Ia akan dikemas kini dengan sendirinya.",

  // wizard
  "Which system has the records you want in your CRM?": "Sistem mana yang ada rekod yang anda mahu dalam CRM anda?",
  "Step {a} of {b}: where to read from": "Langkah {a} daripada {b}: dari mana hendak dibaca",
  "Test and continue": "Uji dan teruskan",
  "Choose what to keep": "Pilih apa yang hendak disimpan",
  "Step {a} of {b}: we found {n} records. Tick what you want in the list.":
    "Langkah {a} daripada {b}: kami menemui {n} rekod. Tandakan apa yang anda mahu dalam senarai.",
  "Name the list": "Namakan senarai",
  "Step {a} of {b}: last step": "Langkah {a} daripada {b}: langkah terakhir",
  "You will get a web address to paste into the other system. Each record it sends there (as JSON) lands in this list.":
    "Anda akan mendapat alamat web untuk ditampal ke dalam sistem lain. Setiap rekod yang dihantarnya ke situ (sebagai JSON) akan masuk ke senarai ini.",
  "Name of the list": "Nama senarai",
  "e.g. Online orders, Stripe customers": "cth. Pesanan dalam talian, Pelanggan Stripe",
  "This is how it shows in your CRM. You can rename it later.": "Begini ia dipaparkan dalam CRM anda. Anda boleh menukar namanya kemudian.",
  "New and changed records are brought in by themselves. You can also sync any time.":
    "Rekod baharu dan yang berubah dibawa masuk dengan sendirinya. Anda juga boleh segerakkan pada bila-bila masa.",
  "The file is copied in once. To keep it up to date by itself, put it online (for example as a Google Sheet) and connect its link instead.":
    "Fail ini disalin masuk sekali sahaja. Untuk memastikan ia dikemas kini dengan sendirinya, letakkan ia dalam talian (contohnya sebagai Google Sheet) dan sambungkan pautannya.",
  "Advanced (optional)": "Lanjutan (pilihan)",
  "Which value is each record's ID": "Nilai mana yang menjadi ID setiap rekod",
  "A record sent again with the same ID updates the one already here. Usually \"id\".":
    "Rekod yang dihantar semula dengan ID yang sama akan mengemas kini rekod yang sedia ada. Biasanya \"id\".",
  "Copy it in": "Salin masuk",
  "Almost there": "Hampir siap",
  "All set": "Semua sudah sedia",
  "Fix it from the ... menu on its card (Change key or password), then press Sync now.":
    "Betulkan melalui menu ... pada kadnya (Tukar kunci atau kata laluan), kemudian tekan Segerakkan sekarang.",
  "Paste this address into the other system where it asks where to send data (often called a \"webhook URL\"). It must send each record as JSON. Copy it now: it is shown only this once.":
    "Tampal alamat ini ke dalam sistem lain di tempat ia bertanya ke mana hendak menghantar data (selalunya dipanggil \"webhook URL\"). Ia mesti menghantar setiap rekod sebagai JSON. Salin sekarang: ia ditunjukkan sekali ini sahaja.",
  "Open the list": "Buka senarai",
  "Key or password from that system (optional)": "Kunci atau kata laluan daripada sistem itu (pilihan)",
  "Only if it asks for one. Stored encrypted and never shown again.":
    "Hanya jika ia memintanya. Disimpan secara disulitkan dan tidak ditunjukkan lagi.",
  "That file is too big (up to 3 MB). Split it, or put it online and use its link.":
    "Fail itu terlalu besar (had 3 MB). Pecahkannya, atau letakkan dalam talian dan gunakan pautannya.",

  // source fields
  "Your Shopify store address": "Alamat kedai Shopify anda",
  "The one that ends in .myshopify.com (you see it in Shopify admin).":
    "Yang berakhir dengan .myshopify.com (anda boleh melihatnya dalam Shopify admin).",
  "Your website address": "Alamat laman web anda",
  "Consumer key": "Consumer key",
  "Starts with ck_": "Bermula dengan ck_",
  "Link to your Airtable table": "Pautan ke jadual Airtable anda",
  "Open the table in Airtable and copy the address from your browser.": "Buka jadual dalam Airtable dan salin alamat daripada pelayar anda.",
  "Link to the Google Sheet": "Pautan ke Google Sheet",
  "The tab open in the link is read. Its first row must hold the column names.":
    "Tab yang terbuka dalam pautan itu yang akan dibaca. Baris pertamanya mesti mengandungi nama lajur.",
  "Where is the file?": "Di mana fail itu?",
  "A link to the file": "Pautan ke fail",
  "Kept up to date": "Sentiasa dikemas kini",
  "A file on this device": "Fail pada peranti ini",
  "Copied in once": "Disalin masuk sekali",
  "Web address of the CSV file": "Alamat web fail CSV",
  "For example an export link from another system.": "Contohnya pautan eksport daripada sistem lain.",
  "Choose a CSV file": "Pilih fail CSV",
  "Tap to choose another": "Ketik untuk memilih yang lain",
  "Up to 3 MB. The first row must hold the column names.": "Had 3 MB. Baris pertama mesti mengandungi nama lajur.",
  "Columns found: {list}": "Lajur ditemui: {list}",
  "Web address that lists the records": "Alamat web yang menyenaraikan rekod",
  "The other system's help pages usually give it (sometimes called an API address).":
    "Halaman bantuan sistem lain itu biasanya memberikannya (kadangkala dipanggil alamat API).",
  "Web address of the file": "Alamat web fail",
  "How the key is sent": "Cara kunci dihantar",
  "Not sure? Leave it as it is; the test tells you if it is wrong.":
    "Tidak pasti? Biarkan sahaja; ujian akan memberitahu anda jika ia salah.",
  "Header name": "Nama header",
  "Name in the web address": "Nama dalam alamat web",
  "Where the list sits in the reply": "Di mana senarai berada dalam balasan",
  "Leave empty if the reply is the list itself. Use dots for deeper places, like data.items.":
    "Biarkan kosong jika balasan itu sendiri ialah senarai. Gunakan titik untuk tempat yang lebih dalam, seperti data.items.",
  "So a record that changes is updated, not added twice. Usually \"id\".":
    "Supaya rekod yang berubah dikemas kini, bukan ditambah dua kali. Biasanya \"id\".",
  "When there are many records": "Apabila terdapat banyak rekod",
  "Name of the setting in the web address": "Nama tetapan dalam alamat web",
  "Where the \"next\" value is in the reply": "Di mana nilai \"next\" berada dalam balasan",

  // choose fields
  "Which one names each record?": "Yang mana menamakan setiap rekod?",
  "Shown as the title of each card and row, like a customer's name or an order number.":
    "Dipaparkan sebagai tajuk setiap kad dan baris, seperti nama pelanggan atau nombor pesanan.",
  "Tick at least one thing to keep.": "Tandakan sekurang-kurangnya satu untuk disimpan.",
  "{a} of {b} kept": "{a} daripada {b} disimpan",
  "Keep all": "Simpan semua",
  "Keep none": "Jangan simpan apa-apa",
  "Keep {name}": "Simpan {name}",
  "Name of this field": "Nama medan ini",
  "Kind of field": "Jenis medan",
  "Example: {value}": "Contoh: {value}",
  "Empty in the records we saw": "Kosong dalam rekod yang kami lihat",
};
