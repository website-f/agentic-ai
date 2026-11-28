/** P40 File storage: where company files live — the app's database, this server's disk, an
 * S3 bucket (Backblaze B2 and the like), or the company's own WebDAV file server — and which
 * of them feeds the Library. Terms: storage = storan, bucket = bucket, file server = pelayan
 * fail, endpoint = endpoint. */
export const STORAGE: Record<string, string> = {
  // nav
  "File storage": "Storan fail",
  "Where company files are kept: the database, this server's disk, a Backblaze B2 or S3 bucket, or your own file server, and what feeds the Library.":
    "Tempat fail syarikat disimpan: pangkalan data, cakera pelayan ini, bucket Backblaze B2 atau S3, atau pelayan fail anda sendiri, dan apa yang menyuap Perpustakaan.",

  // page
  "Where company files are kept. Files stay in the app's database unless you add storage here: this server's disk, a Backblaze B2 or other S3 bucket, or your company's own file server. Any of them can also feed the Library.":
    "Tempat fail syarikat disimpan. Fail kekal dalam pangkalan data aplikasi melainkan anda menambah storan di sini: cakera pelayan ini, bucket Backblaze B2 atau S3 lain, atau pelayan fail syarikat anda sendiri. Mana-mana daripadanya juga boleh menyuap Perpustakaan.",
  "Keys and passwords are encrypted with the server's master key and never shown again. Only owners and admins see this page.":
    "Kunci dan kata laluan disulitkan dengan kunci induk pelayan dan tidak ditunjukkan lagi. Hanya pemilik dan admin melihat halaman ini.",

  // current targets
  "The app's database": "Pangkalan data aplikasi",
  "Holds the files saved before you chose another storage.": "Menyimpan fail yang disimpan sebelum anda memilih storan lain.",
  "New files are kept here now. Backed up every night with everything else.":
    "Fail baharu disimpan di sini sekarang. Disandarkan setiap malam bersama yang lain.",
  "New files go here": "Fail baharu masuk sini",
  "{n} files here": "{n} fail di sini",
  "No other storage yet": "Belum ada storan lain",
  "Add a bucket or your file server to keep files outside the database, or to bring the documents already there into the Library.":
    "Tambah bucket atau pelayan fail anda untuk menyimpan fail di luar pangkalan data, atau untuk membawa dokumen yang sedia ada di sana ke dalam Perpustakaan.",

  // kinds
  "This server's disk": "Cakera pelayan ini",
  "A folder on the server the app runs on, included in the nightly backup.":
    "Satu folder pada pelayan tempat aplikasi berjalan, termasuk dalam sandaran malam.",
  "S3 bucket (Backblaze B2, AWS, R2, Wasabi)": "Bucket S3 (Backblaze B2, AWS, R2, Wasabi)",
  "Any S3-compatible bucket. For Backblaze B2 use its S3 endpoint and an application key.":
    "Mana-mana bucket serasi S3. Untuk Backblaze B2 gunakan endpoint S3-nya dan satu application key.",
  "Company file server (WebDAV)": "Pelayan fail syarikat (WebDAV)",
  "Nextcloud, ownCloud, Synology, QNAP or any WebDAV share.": "Nextcloud, ownCloud, Synology, QNAP atau mana-mana kongsi WebDAV.",

  // add form
  "Add storage": "Tambah storan",
  "Folder name (optional)": "Nama folder (pilihan)",
  Endpoint: "Endpoint",
  Region: "Wilayah",
  Bucket: "Bucket",
  "Key ID": "ID Kunci",
  "Application key (secret)": "Application key (rahsia)",
  "It is tested before it is saved: a small file is written, read back and deleted.":
    "Ia diuji sebelum disimpan: satu fail kecil ditulis, dibaca semula dan dipadam.",
  "Test and save": "Uji dan simpan",
  "Tested and saved: a file was written, read back and deleted.":
    "Diuji dan disimpan: satu fail ditulis, dibaca semula dan dipadam.",
  "It works: a file was written, read back and deleted.": "Ia berfungsi: satu fail ditulis, dibaca semula dan dipadam.",

  // keep new files here
  "Keep new files here": "Simpan fail baharu di sini",
  "New uploads and everything the AI makes go here. If it is ever unreachable, files are kept in the database instead, so nothing is lost.":
    "Muat naik baharu dan segala yang dibuat AI masuk sini. Jika ia tidak dapat dihubungi, fail disimpan dalam pangkalan data sebaliknya, jadi tiada yang hilang.",

  // import to library
  "Import its documents into the Library": "Import dokumennya ke dalam Perpustakaan",
  "SOPs, policies and documents kept here are read in place (not copied) and every agent of the company can search them. Checked again every hour.":
    "SOP, polisi dan dokumen yang disimpan di sini dibaca di tempatnya (tidak disalin) dan setiap ejen syarikat boleh mencarinya. Disemak semula setiap jam.",
  "Only this folder (optional)": "Folder ini sahaja (pilihan)",
  "Library folder": "Folder Perpustakaan",
  "Import now": "Import sekarang",
  "Last checked {when}: {n} documents": "Terakhir disemak {when}: {n} dokumen",
  "{n} new, {c} changed, {g} gone. New files are being read into the Library.":
    "{n} baharu, {c} berubah, {g} tiada. Fail baharu sedang dibaca ke dalam Perpustakaan.",

  // remove
  "Stop keeping new files here": "Berhenti menyimpan fail baharu di sini",
  "Only possible when no file is kept there any more. The files themselves are never deleted from your bucket or server.":
    "Hanya boleh apabila tiada lagi fail disimpan di sana. Fail itu sendiri tidak sekali-kali dipadam dari bucket atau pelayan anda.",

  // P149a: moving files to the file server, compression, database space, backups
  "Move files to the file server": "Pindahkan fail ke pelayan fail",
  "Make older files smaller": "Kecilkan fail lama",
  "the file server": "pelayan fail",
  "Files kept in the app's database are copied to {name}, checked there, then removed from the database. Opening them keeps working the whole time.":
    "Fail yang disimpan dalam pangkalan data aplikasi disalin ke {name}, disemak di sana, kemudian dibuang dari pangkalan data. Fail tetap boleh dibuka sepanjang masa.",
  "Files saved before compression was turned on are made smaller in the same format, at night and at weekends only.":
    "Fail yang disimpan sebelum pemampatan dihidupkan dikecilkan dalam format yang sama, pada waktu malam dan hujung minggu sahaja.",
  "{done} of {total} files moved ({before} sent as {after}); {left} left":
    "{done} daripada {total} fail dipindahkan ({before} dihantar sebagai {after}); tinggal {left}",
  "{done} files made smaller, {kept} already as small as they go; {left} left":
    "{done} fail dikecilkan, {kept} sudah sekecil mungkin; tinggal {left}",
  "{n} errors": "{n} ralat",
  "last worked {when}": "kali terakhir bekerja {when}",
  "Waiting for the evening (after 8 pm) or the weekend.": "Menunggu waktu malam (selepas 8 malam) atau hujung minggu.",
  "Paused by itself after repeated failures: {reason}": "Dijeda sendiri selepas gagal berulang kali: {reason}",
  "Last problem: {reason}": "Masalah terakhir: {reason}",
  "Moving and compressing files": "Memindah dan memampatkan fail",
  "{db} files ({dbsize}) are still in the app's database; {n} files ({size}) are on {name}. Compression has saved {saved}.":
    "{db} fail ({dbsize}) masih dalam pangkalan data aplikasi; {n} fail ({size}) berada di {name}. Pemampatan telah menjimatkan {saved}.",
  "Database: the files table takes {table}; {inside} of file bytes are still inside. About {free} can be given back to the server's disk.":
    "Pangkalan data: jadual fail menggunakan {table}; {inside} bait fail masih di dalamnya. Kira-kira {free} boleh dipulangkan kepada cakera pelayan.",
  "Giving it back locks the files table for a few minutes: the developer runs it once, at a quiet hour.":
    "Memulangkannya mengunci jadual fail selama beberapa minit: pembangun menjalankannya sekali, pada waktu lengang.",
  "Quick-open copy on the server: {n} files, {size} of {cap}.": "Salinan buka pantas di pelayan: {n} fail, {size} daripada {cap}.",
  "Last backup to the file server {when}: {size}, checked.": "Sandaran terakhir ke pelayan fail {when}: {size}, telah disemak.",
  "The last backup failed: {reason}": "Sandaran terakhir gagal: {reason}",
  "The last good one was {when}.": "Sandaran baik terakhir ialah {when}.",
  "No backup to the file server yet. It runs every night at 2:30 am.": "Belum ada sandaran ke pelayan fail. Ia berjalan setiap malam pada 2:30 pagi.",
};
