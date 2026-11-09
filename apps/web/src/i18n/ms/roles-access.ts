/** P92: management and HR roles, Settings > Roles and access, correcting a name or email. */
export const ROLES_ACCESS: Record<string, string> = {
  // Roles
  Management: "Pengurusan",
  "Runs the whole workspace like an admin, without the AI engine, file storage and MCP tools. The owner can change this.":
    "Menguruskan seluruh ruang kerja seperti admin, tanpa Enjin AI, storan fail dan alat MCP. Pemilik boleh mengubahnya.",
  "People, members and the whole workspace like an admin, without the AI engine, file storage and MCP tools. The owner can change this.":
    "Orang, ahli dan seluruh ruang kerja seperti admin, tanpa Enjin AI, storan fail dan alat MCP. Pemilik boleh mengubahnya.",
  "Management see the whole workspace.":
    "Pengurusan boleh lihat seluruh ruang kerja.",
  "HR see the whole workspace.": "HR boleh lihat seluruh ruang kerja.",
  "Recommended. Everyone who can change the whole workspace: owners, admins, management and HR.":
    "Disyorkan. Semua yang boleh mengubah seluruh ruang kerja: pemilik, admin, pengurusan dan HR.",

  // Roles and access page
  "Roles and access": "Peranan dan akses",
  "What each role may do, area by area. Only the owner changes it.":
    "Apa yang boleh dibuat oleh setiap peranan, mengikut bahagian. Hanya pemilik boleh mengubahnya.",
  "What each role may do, area by area. Turn an area on or off for a role; it applies to everyone in that role from their next click. Owners always have everything.":
    "Apa yang boleh dibuat oleh setiap peranan, mengikut bahagian. Hidupkan atau matikan sesuatu bahagian untuk sesuatu peranan; ia terpakai kepada semua dalam peranan itu mulai klik mereka yang seterusnya. Pemilik sentiasa ada semuanya.",
  "Saved. Each person gets the new access on their next click.":
    "Disimpan. Setiap orang mendapat akses baharu pada klik mereka yang seterusnya.",
  "Reset to defaults": "Kembali ke asal",
  "Changed from the default": "Berubah daripada asal",
  "Never given to anyone: making owners, this page, erasing the workspace.":
    "Tidak pernah diberi kepada sesiapa: melantik pemilik, halaman ini, memadam ruang kerja.",
  "{role} ({n} changed)": "{role} ({n} diubah)",
  "(partly)": "(sebahagian)",
  "{area} for {role}": "{area} untuk {role}",
  "{n} changed": "{n} diubah",
  "Customers (CRM) are shared part by part from the CRM page. Prima uses each person's own Prima access, and the owner links people on the Prima page.":
    "Pelanggan (CRM) dikongsi sebahagian demi sebahagian dari halaman CRM. Prima menggunakan akses Prima setiap orang sendiri, dan pemilik memautkan orang di halaman Prima.",
  "A person who can manage members can only give roles with no more access than their own.":
    "Orang yang boleh mengurus ahli hanya boleh memberi peranan yang aksesnya tidak lebih daripada akses mereka sendiri.",
  "Reset every role to its defaults?": "Kembalikan semua peranan kepada asal?",
  "Every change on this page is undone. Each person gets the default access of their role on their next click.":
    "Semua perubahan di halaman ini dibatalkan. Setiap orang mendapat akses asal peranan mereka pada klik yang seterusnya.",

  // Areas
  "AI engine: see": "Enjin AI: lihat",
  "The AI providers, models and what the AI costs.":
    "Penyedia AI, model dan kos AI.",
  "AI engine: change": "Enjin AI: ubah",
  "Add or remove AI keys, choose models, privacy masking.":
    "Tambah atau buang kunci AI, pilih model, penyamaran privasi.",
  "Where company files are kept, with bucket keys and file server passwords.":
    "Tempat fail syarikat disimpan, dengan kunci baldi dan kata laluan pelayan fail.",
  "Connect tools from other systems for the agents.":
    "Sambungkan alat daripada sistem lain untuk ejen.",
  "Add people, change their role, name or email, reset passwords. Never more access than their own.":
    "Tambah orang, tukar peranan, nama atau emel mereka, set semula kata laluan. Tidak pernah lebih daripada akses sendiri.",
  "Their own team": "Pasukan sendiri",
  "Add and change the people below them in their branch or department.":
    "Tambah dan ubah orang di bawah mereka dalam cawangan atau jabatan mereka.",
  "Organisation settings": "Tetapan organisasi",
  "Companies, departments, approval limits, web connections and approved services.":
    "Syarikat, jabatan, had kelulusan, sambungan web dan perkhidmatan yang diluluskan.",
  "The whole office": "Seluruh pejabat",
  "Command center, every agent, schedules, reports and the company overview.":
    "Pusat kawalan, semua ejen, jadual, laporan dan gambaran keseluruhan syarikat.",
  "Give work to the AI": "Beri kerja kepada AI",
  "Tasks, chat and workflows.": "Tugasan, sembang dan aliran kerja.",
  "Decide what agents ask before they act.":
    "Putuskan apa yang ejen minta sebelum mereka bertindak.",
  "AI team and agents": "Pasukan AI dan ejen",
  "Create and change agents, their skills and SOPs.":
    "Cipta dan ubah ejen, kemahiran dan SOP mereka.",
  "Brain and learning": "Brain dan pembelajaran",
  "What the office knows and how agents learn.":
    "Apa yang pejabat tahu dan cara ejen belajar.",
  "Money: see": "Wang: lihat",
  "Invoices, bills, payments and cash flow.":
    "Invois, bil, bayaran dan aliran tunai.",
  "Money: change": "Wang: ubah",
  "Record payments, send reminders, approve bills.":
    "Rekod bayaran, hantar peringatan, luluskan bil.",
  "Library files and saved logins": "Fail perpustakaan dan log masuk tersimpan",
  "Manage company files and the website logins agents use.":
    "Urus fail syarikat dan log masuk laman web yang digunakan ejen.",
  "Telegram, WhatsApp, Microsoft 365 and API tokens for the company.":
    "Telegram, WhatsApp, Microsoft 365 dan token API untuk syarikat.",
  "Audit log": "Log audit",
  "Every change made by people and agents.":
    "Setiap perubahan yang dibuat oleh orang dan ejen.",
  "Private assistants": "Pembantu peribadi",
  "Their own assistants for company pulse, mail and chasing people.":
    "Pembantu mereka sendiri untuk denyut syarikat, mel dan mengejar orang.",
  "Own AI twin": "Kembar AI sendiri",
  "One personal AI that works for them, with its own logins.":
    "Satu AI peribadi yang bekerja untuk mereka, dengan log masuknya sendiri.",

  // Name, email and Microsoft link
  "Change name or email": "Tukar nama atau emel",
  "Correct a name or email typed wrong when they were added.":
    "Betulkan nama atau emel yang tersalah taip semasa mereka ditambah.",
  "They will need to sign in again. With Microsoft, they will be linked to the account of the new email, here and in Prima.":
    "Mereka perlu log masuk semula. Dengan Microsoft, mereka akan dipautkan kepada akaun emel baharu, di sini dan dalam Prima.",
  "Saved. {name} signs in again with {email}.":
    "Disimpan. {name} log masuk semula dengan {email}.",
  "Reset Microsoft link": "Set semula pautan Microsoft",
  "Reset {name}'s Microsoft link?": "Set semula pautan Microsoft {name}?",
  "Use this when the wrong Microsoft account got linked. They are signed out, their Outlook connection stops, and their next Microsoft sign-in with {email} links again, here and in Prima.":
    "Gunakan ini apabila akaun Microsoft yang salah telah dipautkan. Mereka dilog keluar, sambungan Outlook mereka berhenti, dan log masuk Microsoft mereka yang seterusnya dengan {email} memaut semula, di sini dan dalam Prima.",
  "{name} links again at their next Microsoft sign-in.":
    "{name} dipautkan semula pada log masuk Microsoft mereka yang seterusnya.",
  "Change your sign-in email": "Tukar emel log masuk anda",
  "You will sign in with the new email from now on. Your other devices are signed out, and your next Microsoft sign-in links the Microsoft account of the new email.":
    "Anda akan log masuk dengan emel baharu mulai sekarang. Peranti anda yang lain dilog keluar, dan log masuk Microsoft anda yang seterusnya memautkan akaun Microsoft emel baharu.",
  "New email": "Emel baharu",
  "Signed in with Microsoft in the last ten minutes? You can leave this empty.":
    "Log masuk dengan Microsoft dalam sepuluh minit lepas? Anda boleh biarkan kosong.",
  "Your sign-in email is now {email}.": "Emel log masuk anda kini {email}.",
};
