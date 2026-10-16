/**
 * AI privacy (P33): masking what is sent to cloud AI providers, trusted providers, and each
 * company's data level. Terms: penyedia (provider), label ganti (placeholder), sulit
 * (confidential), setempat (local, as on the Providers tab).
 */
export const PRIVACY: Record<string, string> = {
  // ---------------------------------------------------------------- data levels and categories
  Standard: "Standard",
  Confidential: "Sulit",
  "Local only": "Setempat sahaja",
  "Any connected provider, with private details masked.": "Mana-mana penyedia yang disambung, dengan butiran peribadi disembunyikan.",
  "Only providers you mark as trusted: no training, no retention.": "Hanya penyedia yang anda tandakan dipercayai: tiada latihan model, tiada simpanan data.",
  "Nothing leaves the server. Only the server's local model answers.": "Tiada apa-apa keluar dari pelayan. Hanya model setempat pada pelayan yang menjawab.",
  "The local model on the server is small, so answers are slower and less capable than cloud models. Best for short, simple work.":
    "Model setempat pada pelayan adalah kecil, jadi jawapannya lebih perlahan dan kurang mampu berbanding model awan. Sesuai untuk kerja ringkas dan mudah.",
  "IDs & bank/card numbers": "ID & nombor bank/kad",
  "People & contacts": "Orang & maklumat hubungan",
  "Company names & references": "Nama syarikat & rujukan",
  Amounts: "Amaun",
  "Hi team, please prepare the quotation for Encik Ahmad Faizal bin Rahman (MyKad 900101-14-5678, phone 012-345 6789, ahmad.faizal@harmonieng.com.my). Client: Harmoni Engineering Sdn Bhd, tender QT260000000027691. Agreed price RM 12,500. Payment to Maybank account 5140 1234 5678.":
    "Hai semua, sila sediakan sebut harga untuk Encik Ahmad Faizal bin Rahman (MyKad 900101-14-5678, telefon 012-345 6789, ahmad.faizal@harmonieng.com.my). Pelanggan: Harmoni Engineering Sdn Bhd, tender QT260000000027691. Harga dipersetujui RM 12,500. Bayaran ke akaun Maybank 5140 1234 5678.",

  // ---------------------------------------------------------------- AI engine: Privacy tab
  Privacy: "Privasi",
  "1. Masked on our server": "1. Disembunyikan di pelayan kita",
  "Private details become placeholders like [PERSON_K7Q2A].": "Butiran peribadi ditukar kepada label ganti seperti [PERSON_K7Q2A].",
  "2. Provider sees placeholders": "2. Penyedia hanya nampak label ganti",
  "The cloud AI never receives the real names, IDs or numbers.": "AI awan tidak pernah menerima nama, ID atau nombor sebenar.",
  "3. Real values put back": "3. Nilai sebenar dipulihkan",
  "Our server restores them in the answer and in the agent's actions.": "Pelayan kita memulihkannya dalam jawapan dan dalam tindakan ejen.",
  "Privacy settings saved.": "Tetapan privasi disimpan.",
  "Protect data sent to AI providers": "Lindungi data yang dihantar kepada penyedia AI",
  "Before anything is sent to a cloud AI provider, IDs and bank or card numbers, people's names and contacts, and company names are swapped for placeholders like [PERSON_K7Q2A]. The provider only ever sees the placeholders. Our server puts the real values back in the answer and in the agent's actions, so your team sees normal text. The local model on this server is never masked, because nothing leaves.":
    "Sebelum apa-apa dihantar kepada penyedia AI awan, ID dan nombor bank atau kad, nama dan maklumat hubungan orang, serta nama syarikat ditukar kepada label ganti seperti [PERSON_K7Q2A]. Penyedia hanya nampak label ganti itu. Pelayan kita memulihkan nilai sebenar dalam jawapan dan dalam tindakan ejen, jadi pasukan anda nampak teks biasa. Model setempat pada pelayan ini tidak pernah disembunyikan, kerana tiada apa-apa yang keluar.",
  "What to mask": "Apa yang disembunyikan",
  "MyKad, passport, bank account and card numbers.": "Nombor MyKad, pasport, akaun bank dan kad.",
  "Names, phone numbers, emails and addresses.": "Nama, nombor telefon, e-mel dan alamat.",
  "Company names, tender and reference numbers.": "Nama syarikat, nombor tender dan nombor rujukan.",
  "Off keeps quotations and calculations accurate.": "Biarkan mati supaya sebut harga dan pengiraan kekal tepat.",
  "Protection is off. Cloud providers receive your text exactly as written.": "Perlindungan dimatikan. Penyedia awan menerima teks anda sebiji seperti yang ditulis.",
  "You need AI Engine management permission to change these settings.": "Anda perlukan kebenaran mengurus Enjin AI untuk mengubah tetapan ini.",
  "You need AI Engine management permission to run the preview.": "Anda perlukan kebenaran mengurus Enjin AI untuk menjalankan pratonton.",
  "What your team writes":"Apa yang ditulis oleh pasukan anda",
  "Use the example again": "Guna contoh semula",
  "What the AI provider sees": "Apa yang dilihat oleh penyedia AI",
  "Text changed: preview again": "Teks berubah: pratonton semula",
  "Protection is off, so nothing was masked.": "Perlindungan dimatikan, jadi tiada apa-apa disembunyikan.",
  "{n} private details never leave your server.": "{n} butiran peribadi tidak pernah keluar dari pelayan anda.",
  "Nothing private found in this text.": "Tiada butiran peribadi dalam teks ini.",
  "Amounts stay readable.": "Amaun kekal boleh dibaca.",
  "Press Preview to see the text exactly as a cloud provider would receive it.": "Tekan Pratonton untuk melihat teks sebiji seperti yang akan diterima oleh penyedia awan.",
  "Trusted for confidential data": "Dipercayai untuk data sulit",
  Trusted: "Dipercayai",
  "{n} masked": "{n} disembunyikan",
  "{name} is now {level}.": "{name} kini {level}.",
  "Data protection for {name}": "Perlindungan data untuk {name}",
  "No AI calls in the last 30 days.": "Tiada panggilan AI dalam 30 hari lepas.",
  "Confidential, but used providers that are not trusted: {names}. Mark them trusted on Providers only if your agreement rules out training and retention.":
    "Sulit, tetapi menggunakan penyedia yang tidak dipercayai: {names}. Tandakan mereka dipercayai di Penyedia hanya jika perjanjian anda melarang latihan model dan simpanan data.",
  "Local only, but cloud providers were used: {names}.": "Setempat sahaja, tetapi penyedia awan telah digunakan: {names}.",
  "No companies yet. Add one on the Organization page.": "Belum ada syarikat. Tambah satu di halaman Organisasi.",
  "Data protection": "Perlindungan data",
  "AI providers used, last 30 days": "Penyedia AI digunakan, 30 hari lepas",
  "Only people who manage the organization can change a company's data protection.":
    "Hanya pengurus organisasi boleh mengubah perlindungan data syarikat.",
  "This server does not have AI privacy controls yet. Update the server to turn them on.":
    "Pelayan ini belum ada kawalan privasi AI. Kemas kini pelayan untuk menghidupkannya.",
  "Could not load privacy settings.": "Tetapan privasi tidak dapat dimuatkan.",
  "Decide what stays private when agents use a cloud AI.": "Tentukan apa yang kekal peribadi apabila ejen menggunakan AI awan.",
  "See what the AI provider sees": "Lihat apa yang dilihat oleh penyedia AI",
  "Type or paste anything. Nothing is sent to an AI provider by this preview.":
    "Taip atau tampal apa sahaja. Pratonton ini tidak menghantar apa-apa kepada penyedia AI.",
  "Data protection per company": "Perlindungan data setiap syarikat",
  "Standard: any provider, masked. Confidential: only trusted providers. Local only: nothing leaves the server.":
    "Standard: mana-mana penyedia, disembunyikan. Sulit: hanya penyedia dipercayai. Setempat sahaja: tiada apa-apa keluar dari pelayan.",

  // ---------------------------------------------------------------- AI engine: provider cards
  "{name} can now handle confidential companies.": "{name} kini boleh mengendalikan syarikat sulit.",
  "{name} will no longer get work from confidential companies.": "{name} tidak lagi menerima kerja daripada syarikat sulit.",
  "{name} now routes only to zero-retention endpoints.": "{name} kini hanya menghala ke titik akhir tanpa simpanan data.",
  "{name} may route to any endpoint again.": "{name} boleh menghala ke mana-mana titik akhir semula.",
  "Runs on this server. Nothing leaves, so nothing needs masking.": "Berjalan pada pelayan ini. Tiada apa-apa keluar, jadi tiada yang perlu disembunyikan.",
  "No training and no retention, per your agreement with this provider": "Tiada latihan model dan tiada simpanan data, mengikut perjanjian anda dengan penyedia ini",
  "Require zero data retention": "Wajibkan tanpa simpanan data",
  "OpenRouter only sends your prompts to model hosts that keep nothing.": "OpenRouter hanya menghantar prompt anda kepada hos model yang tidak menyimpan apa-apa.",
};
