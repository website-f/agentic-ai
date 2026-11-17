/** P109: heads of several departments and the Team filter (Members), the Library by department,
 * files uploaded for other companies (Library > For other companies), and comments with
 * @mentions on the Feedbacks page. Same terms as team.ts (ketua jabatan, melapor kepada). */
export const ORG_P109: Record<string, string> = {
  // Members: HOD, people under them, Team filter
  "Heads of a company's departments are told when files are uploaded for it. A department can have more than one head.":
    "Ketua jabatan sesebuah syarikat dimaklumkan apabila fail dimuat naik untuknya. Satu jabatan boleh mempunyai lebih daripada seorang ketua.",
  "Departments they head": "Jabatan yang diketuai",
  "Pick one or more departments": "Pilih satu atau lebih jabatan",
  "Search departments or companies": "Cari jabatan atau syarikat",
  "To give tasks to the people under them, give them a manager role too, such as Head of department.":
    "Untuk memberi tugasan kepada orang di bawahnya, beri juga peranan pengurus, seperti Ketua jabatan.",
  "People under them": "Orang di bawahnya",
  "Search by name, email, company or department": "Cari mengikut nama, e-mel, syarikat atau jabatan",
  "Their team now: 1 person.": "Pasukan mereka sekarang: 1 orang.",
  "Their team now: {n} people.": "Pasukan mereka sekarang: {n} orang.",
  "HOD: {names} +{n} more": "Ketua: {names} +{n} lagi",
  "HOD: {names}": "Ketua: {names}",
  "HOD": "Ketua jabatan",
  "Heads of department (HOD)": "Ketua jabatan (HOD)",
  "Have people under them": "Ada orang di bawahnya",
  "Report to no one": "Tidak melapor kepada sesiapa",
  "Team of {name}": "Pasukan {name}",
  "Own department only": "Jabatan sendiri sahaja",
  "Whole company": "Seluruh syarikat",
  "May upload files for other companies": "Boleh memuat naik fail untuk syarikat lain",
  "Uploads": "Muat naik",
  "Files they can see": "Fail yang boleh dilihat",
  "Their role sees more than one department, so this applies only to heads of department, supervisors and staff.":
    "Peranan mereka melihat lebih daripada satu jabatan, jadi ini hanya untuk ketua jabatan, penyelia dan kakitangan.",
  "They and their AI see only their department's files, plus their own files and the work they are part of.":
    "Mereka dan AI mereka hanya melihat fail jabatan mereka, serta fail mereka sendiri dan kerja yang mereka sertai.",
  "They and their AI see their company's files, as before.": "Mereka dan AI mereka melihat fail syarikat mereka, seperti sebelum ini.",
  "They upload in Library > For other companies; each file waits for their check, then goes to that company. Its heads of department are told.":
    "Mereka memuat naik di Pustaka > Untuk syarikat lain; setiap fail menunggu semakan mereka, kemudian pergi ke syarikat itu. Ketua jabatannya dimaklumkan.",
  // Library > For other companies
  "For other companies": "Untuk syarikat lain",
  "Upload files for other companies, check them and hand them over; see what others uploaded for your company.":
    "Muat naik fail untuk syarikat lain, semak dan serahkannya; lihat apa yang orang lain muat naik untuk syarikat anda.",
  "Upload files for other companies: pick the companies each file is for, check it, then approve it. Their heads of department are told, and the files they receive show here.":
    "Muat naik fail untuk syarikat lain: pilih syarikat bagi setiap fail, semak, kemudian luluskan. Ketua jabatan mereka dimaklumkan, dan fail yang mereka terima dipaparkan di sini.",
  "1 file uploaded. Check it, then approve it.": "1 fail dimuat naik. Semak, kemudian luluskan.",
  "{n} files uploaded. Check them, then approve them.": "{n} fail dimuat naik. Semak, kemudian luluskan.",
  "Drop files here, or choose them": "Lepaskan fail di sini, atau pilih",
  "Pick the companies each file is for. Each company's heads of department are told who uploaded what.":
    "Pilih syarikat bagi setiap fail. Ketua jabatan setiap syarikat dimaklumkan siapa memuat naik apa.",
  "Companies for every file": "Syarikat untuk semua fail",
  "Pick companies": "Pilih syarikat",
  "Sets every file below; change one file's companies after.": "Menetapkan semua fail di bawah; tukar syarikat satu fail selepas itu.",
  "Task that asked for it (optional)": "Tugasan yang memintanya (pilihan)",
  "Search tasks": "Cari tugasan",
  "No task": "Tiada tugasan",
  "The AI writes it when it reads the file": "AI menulisnya apabila membaca fail",
  "Type a title": "Taip tajuk",
  "Let AI describe it": "Biar AI menerangkannya",
  "Companies for {name}": "Syarikat untuk {name}",
  "Upload 1 file": "Muat naik 1 fail",
  "Upload {n} files": "Muat naik {n} fail",
  "Each file needs a company, and a title or Let AI describe it.": "Setiap fail perlu syarikat, dan tajuk atau Biar AI menerangkannya.",
  "Handed over to {company}.": "Diserahkan kepada {company}.",
  "Title by AI": "Tajuk oleh AI",
  "Take back": "Tarik balik",
  "Take back {name}?": "Tarik balik {name}?",
  "The file is removed from {company}. Nobody there has it in their Library yet.":
    "Fail dibuang daripada {company}. Belum ada sesiapa di sana yang memilikinya dalam Pustaka mereka.",
  "A new company's heads of department are told about it.": "Ketua jabatan syarikat baharu dimaklumkan mengenainya.",
  "Waiting for the uploader's check": "Menunggu semakan pemuat naik",
  "In the Library": "Dalam Pustaka",
  "Uploaded by": "Dimuat naik oleh",
  "To check": "Untuk disemak",
  "Handed over": "Diserahkan",
  "Check each file, fix its title or company, then approve it. Once approved it goes to that company's Library and leaves this list.":
    "Semak setiap fail, betulkan tajuk atau syarikatnya, kemudian luluskan. Setelah diluluskan ia pergi ke Pustaka syarikat itu dan keluar dari senarai ini.",
  "Nothing to check": "Tiada untuk disemak",
  "Files you upload for other companies wait here for your check.": "Fail yang anda muat naik untuk syarikat lain menunggu semakan anda di sini.",
  "{company} · {date}": "{company} · {date}",
  "Nothing handed over yet": "Belum ada yang diserahkan",
  "Approved files are listed here as a record. The file itself is the other company's.":
    "Fail yang diluluskan disenaraikan di sini sebagai rekod. Fail itu sendiri milik syarikat lain.",
  "Nothing received": "Tiada yang diterima",
  "Files others upload for the companies you head show here.": "Fail yang orang lain muat naik untuk syarikat yang anda ketuai dipaparkan di sini.",
  "Files others upload for the companies you head show here. To upload files for other companies, ask your manager or an owner to switch it on for you.":
    "Fail yang orang lain muat naik untuk syarikat yang anda ketuai dipaparkan di sini. Untuk memuat naik fail untuk syarikat lain, minta pengurus anda atau pemilik menghidupkannya untuk anda.",
  // Needs you
  "{n} files you uploaded for other companies to check": "{n} fail yang anda muat naik untuk syarikat lain perlu disemak",
  "File to check and hand over": "Fail untuk disemak dan diserahkan",
  "{n} files uploaded for your company": "{n} fail dimuat naik untuk syarikat anda",
  "File uploaded for your company": "Fail dimuat naik untuk syarikat anda",
  "{n} mentions in feedback comments": "{n} sebutan dalam komen maklum balas",
  "Mentioned in feedback": "Disebut dalam maklum balas",
  // Feedbacks: comments and mentions
  "What people say about the system, sent from the feedback button on every page. Read it and talk about it in comments; mention someone with @ to bring them in.":
    "Apa kata orang tentang sistem, dihantar dari butang maklum balas di setiap halaman. Baca dan bincangkannya dalam komen; sebut seseorang dengan @ untuk melibatkan mereka.",
  "1 comment": "1 komen",
  "{n} comments": "{n} komen",
  "The developer's answer": "Jawapan pembangun",
  "Comment added. The people you mentioned are told.": "Komen ditambah. Orang yang anda sebut dimaklumkan.",
  "Comment added.": "Komen ditambah.",
  "Comments": "Komen",
  "No comments yet. Start the conversation.": "Belum ada komen. Mulakan perbualan.",
  "Write a comment": "Tulis komen",
  "Mention": "Sebut",
  "Pick people to tell": "Pilih orang untuk dimaklumkan",
  "They are told in the app and by email, with a link to this feedback.":
    "Mereka dimaklumkan dalam aplikasi dan melalui e-mel, dengan pautan ke maklum balas ini.",
};
