/** P60/P62 Settings > Web connections: one choice for how the AI's browser reaches websites. */
export const WEB_CONNECTIONS: Record<string, string> = {
  "Web connections": "Sambungan web",
  "How the AI's browsers reach websites: this server, a company computer, or your own proxies.":
    "Cara pelayar AI sampai ke laman web: pelayan ini, komputer syarikat, atau proksi anda sendiri.",
  "How the AI's browser reaches websites. Pick one way; a change applies to the next page it opens.":
    "Cara pelayar AI sampai ke laman web. Pilih satu cara; perubahan terpakai pada halaman seterusnya yang dibukanya.",
  "How the AI browses": "Cara AI melayari web",
  "Browse from here": "Layari dari sini",
  "From the office server. Always available. The usual choice.":
    "Dari pelayan pejabat. Sentiasa tersedia. Pilihan biasa.",
  "Browse through a computer": "Layari melalui komputer",
  "Through one of your company computers, so sites see your office's own internet line. Best for ePerolehan.":
    "Melalui salah satu komputer syarikat anda, supaya laman melihat talian internet pejabat anda sendiri. Terbaik untuk ePerolehan.",
  "Use your proxies": "Guna proksi anda",
  "Through your proxy provider, such as Webshare.": "Melalui penyedia proksi anda, seperti Webshare.",

  // A computer
  "Which computer": "Komputer mana",
  "Allowed": "Dibenarkan",
  "Needs the new app": "Perlu aplikasi baharu",
  "Waiting for OK on that computer": "Menunggu kebenaran di komputer itu",
  "No company computer is linked yet. On the computer you want to use, open this app, go to My computers and press Link a computer, then run the downloaded file.":
    "Belum ada komputer syarikat dipautkan. Pada komputer yang anda mahu guna, buka aplikasi ini, pergi ke Komputer saya dan tekan Pautkan komputer, kemudian jalankan fail yang dimuat turun.",
  "Open My computers": "Buka Komputer saya",
  "When you save, {name} shows a page asking to allow these sites. Someone at that computer presses Allow once. Nothing goes through a computer until its person says yes.":
    "Apabila anda simpan, {name} memaparkan halaman yang meminta kebenaran untuk laman ini. Seseorang di komputer itu menekan Benarkan sekali. Tiada apa yang melalui sesebuah komputer sehingga penggunanya bersetuju.",
  "Ask that computer again": "Minta komputer itu sekali lagi",
  "{name} has an older Agentic Office app. On that computer, open My computers, download the app again and run it: the new one asks with an Allow button.":
    "{name} mempunyai aplikasi Agentic Office yang lama. Pada komputer itu, buka Komputer saya, muat turun aplikasi sekali lagi dan jalankannya: yang baharu meminta dengan butang Benarkan.",
  "Show the AI's work on that computer's screen": "Tunjukkan kerja AI pada skrin komputer itu",
  "Work on these sites opens a browser window on that computer, so the person there watches every step. One task at a time, like a person.":
    "Kerja pada laman ini membuka tetingkap pelayar pada komputer itu, supaya pengguna di sana melihat setiap langkah. Satu tugasan pada satu masa, seperti manusia.",
  "The AI works in its own browser on the server; only the traffic goes through the computer.":
    "AI bekerja dalam pelayarnya sendiri di pelayan; hanya trafik melalui komputer itu.",
  "The site and its subdomains, separated by commas. Every other site goes from this server.":
    "Laman itu dan subdomainnya, dipisahkan dengan koma. Laman lain keluar dari pelayan ini.",

  // Proxies
  "Use them for": "Gunakan untuk",
  "Only these sites": "Laman ini sahaja",
  "Every website": "Setiap laman web",
  "Replace the list": "Ganti senarai",
  "Proxy list": "Senarai proksi",
  "Leave it empty to keep the {n} saved proxies.": "Biarkan kosong untuk mengekalkan {n} proksi yang disimpan.",
  "Paste the list from your proxy provider: one per line, host:port:user:password. It is stored encrypted; the passwords are never shown again.":
    "Tampal senarai daripada penyedia proksi anda: satu setiap baris, host:port:pengguna:kata laluan. Ia disimpan secara disulitkan; kata laluan tidak dipaparkan lagi.",
  "{n} proxies saved": "{n} proksi disimpan",
  "Test them": "Uji",
  "{ok} of {n} answered.": "{ok} daripada {n} menjawab.",
  "Sites see {ip}": "Laman melihat {ip}",
  "Not answering": "Tidak menjawab",
  "The approved-services lock is on and the proxies are not approved yet, so sites using them are refused until you approve Web proxies.":
    "Kunci perkhidmatan diluluskan dihidupkan dan proksi belum diluluskan, jadi laman yang menggunakannya ditolak sehingga anda meluluskan Proksi web.",
  "Open Approved services": "Buka Perkhidmatan diluluskan",
  "A proxy provider can see which sites are visited and when (the pages themselves stay encrypted).":
    "Penyedia proksi boleh melihat laman mana yang dilawati dan bila (halaman itu sendiri kekal disulitkan).",

  // Saving
  "Every site goes from this server.": "Setiap laman keluar dari pelayan ini.",
  "If the chosen way is unavailable (the computer offline, the proxies not answering), the AI stops and tells you why. It never quietly uses this server's address instead.":
    "Jika cara yang dipilih tidak tersedia (komputer di luar talian, proksi tidak menjawab), AI berhenti dan memberitahu anda sebabnya. Ia tidak sekali-kali menggunakan alamat pelayan ini secara senyap.",
  "This is what the AI uses now.": "Inilah yang digunakan AI sekarang.",
  "Choose a computer.": "Pilih komputer.",
  "List at least one site.": "Senaraikan sekurang-kurangnya satu laman.",
  "Paste your proxy list first.": "Tampal senarai proksi anda dahulu.",
  "Saved. New connections use it now.": "Disimpan. Sambungan baharu menggunakannya sekarang.",
  "Saved. We asked {name}: someone at that computer presses Allow on the Agentic Office page that just opened there.":
    "Disimpan. Kami telah meminta {name}: seseorang di komputer itu menekan Benarkan pada halaman Agentic Office yang baru dibuka di sana.",
  "Saved. {name} is offline: it asks the person there as soon as it is back on.":
    "Disimpan. {name} di luar talian: ia akan meminta pengguna di sana sebaik sahaja ia dihidupkan semula.",
  "Asked again. The Agentic Office page opens on that computer.":
    "Sudah diminta semula. Halaman Agentic Office dibuka pada komputer itu.",
  "That computer is offline. It asks as soon as it is back on.":
    "Komputer itu di luar talian. Ia akan meminta sebaik sahaja ia dihidupkan semula.",

  // Check
  "Check the connection": "Semak sambungan",
  "Opens a site once, the way the AI's browser would, and shows which way it went and what the site answered.":
    "Membuka laman sekali, seperti pelayar AI, dan menunjukkan jalan yang dilalui dan jawapan laman itu.",
  "Site": "Laman",
  "Checks what is saved now: save your change first to check it.":
    "Menyemak tetapan yang disimpan sekarang: simpan perubahan anda dahulu untuk menyemaknya.",
  "through {name}": "melalui {name}",
  "the company computer": "komputer syarikat",
  "through the proxy {via}": "melalui proksi {via}",
  "from this server": "dari pelayan ini",
  "Not opened: {why}.": "Tidak dibuka: {why}.",
  "{site} went {way}.": "{site} pergi {way}.",
  "Sites see {ip} through it.": "Laman melihat {ip} melaluinya.",
  "Could not reach the site: {error}": "Tidak dapat sampai ke laman: {error}",
  "The site refused it ({status}). It saw the address {ip}.": "Laman itu menolaknya ({status}). Ia melihat alamat {ip}.",
  "The site refused it ({status}).": "Laman itu menolaknya ({status}).",
  "The site opened ({status}).": "Laman itu dibuka ({status}).",
  "The site answered {status}.": "Laman itu menjawab {status}.",
  "The site refuses this proxy's address too. Browse through a computer uses your office's own internet line, the way your staff reach the site.":
    "Laman itu juga menolak alamat proksi ini. Layari melalui komputer menggunakan talian internet pejabat anda sendiri, seperti cara staf anda sampai ke laman itu.",
  "The site refuses this server's address. Browse through a computer uses your office's own internet line, the way your staff reach the site.":
    "Laman itu menolak alamat pelayan ini. Layari melalui komputer menggunakan talian internet pejabat anda sendiri, seperti cara staf anda sampai ke laman itu.",
};
