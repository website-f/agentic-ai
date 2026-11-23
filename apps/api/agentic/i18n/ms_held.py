"""P125 Malay: the IT support role and its changes that wait for approval (org/held.py)."""

MS_HELD: dict[str, str] = {
    # roles (i18n/labels.py)
    "Global admin": "Admin global",
    "IT support": "Sokongan IT",
    # holding a change (api/held_guard.py)
    "Changes held for approval can be up to {mb} MB.": (
        "Perubahan yang menunggu kelulusan boleh sehingga {mb} MB."
    ),
    "IT support asks: {title}": "Sokongan IT memohon: {title}",
    "Sent to the admins for approval: {summary}": (
        "Dihantar kepada admin untuk kelulusan: {summary}"
    ),
    "IT support cannot change their own account. Ask an owner or a global admin.": (
        "Sokongan IT tidak boleh mengubah akaun sendiri. Minta pemilik atau admin global."
    ),
    "IT support cannot change an owner, a global admin or another IT support person.": (
        "Sokongan IT tidak boleh mengubah pemilik, admin global atau orang sokongan IT lain."
    ),
    "IT support cannot give the owner, global admin or IT support role.": (
        "Sokongan IT tidak boleh memberi peranan pemilik, admin global atau sokongan IT."
    ),
    "You have {n} changes waiting already. Wait for an answer, or cancel one.": (
        "Anda sudah ada {n} perubahan yang menunggu. Tunggu jawapan, atau batalkan satu."
    ),
    # deciding (api/routers/held_changes.py)
    "That change is not here.": "Perubahan itu tiada di sini.",
    "This change was decided already.": "Perubahan ini sudah diputuskan.",
    "This change expired. Ask for it again.": "Perubahan ini sudah tamat tempoh. Mohon semula.",
    "Only an owner, the developer or a global admin approves IT support's changes.": (
        "Hanya pemilik, pembangun atau admin global yang meluluskan perubahan sokongan IT."
    ),
    "{name} approved it: {reason}. It is done.": "{name} meluluskannya: {reason}. Ia sudah dibuat.",
    "{name} declined it: {reason}.": "{name} menolaknya: {reason}.",
    # summaries (org/held.py)
    "(none)": "(tiada)",
    "yes": "ya",
    "no": "tidak",
    "{who} as {role}": "{who} sebagai {role}",
    "Add member {name} ({email}) as {role}": "Tambah ahli {name} ({email}) sebagai {role}",
    "Remove {n} members: {names}": "Buang {n} ahli: {names}",
    "Change {n} members to {role}: {names}": "Tukar {n} ahli kepada {role}: {names}",
    "Make {n} members report to {manager}: {names}": (
        "Jadikan {n} ahli melapor kepada {manager}: {names}"
    ),
    "Make {n} members report to no one: {names}": (
        "Jadikan {n} ahli tidak melapor kepada sesiapa: {names}"
    ),
    "Change the Prima access of {n} members: {names}": "Tukar akses Prima {n} ahli: {names}",
    "Add {n} members from a sheet: {names}": "Tambah {n} ahli daripada helaian: {names}",
    "Add {n} companies: {names}": "Tambah {n} syarikat: {names}",
    "Email sign-in passwords to {n} members": "E-mel kata laluan log masuk kepada {n} ahli",
    "Remove {name} from the office": "Buang {name} daripada pejabat",
    "Reset {name}'s password": "Set semula kata laluan {name}",
    "Reset {name}'s Microsoft sign-in": "Set semula log masuk Microsoft {name}",
    "Email {name} a sign-in password": "E-mel kata laluan log masuk kepada {name}",
    "Set the {n} people who report to {name}": "Tetapkan {n} orang yang melapor kepada {name}",
    "Change what {name} reads in the Library": "Tukar apa yang {name} baca dalam Pustaka",
    "Change {name}'s access and Prima modules": "Tukar akses dan modul Prima {name}",
    "role to {role}": "peranan kepada {role}",
    "manager to {manager}": "pengurus kepada {manager}",
    "no manager": "tiada pengurus",
    "the departments they head": "jabatan yang diketuai",
    "access and Prima modules": "akses dan modul Prima",
    "company and department": "syarikat dan jabatan",
    "name or email": "nama atau e-mel",
    "job title": "jawatan",
    "Change {name}: {what}": "Tukar {name}: {what}",
    "Add the company {name}": "Tambah syarikat {name}",
    "Delete the company {branch}": "Padam syarikat {branch}",
    "Rename the company {branch} to {name}": "Tukar nama syarikat {branch} kepada {name}",
    "Change the company {branch}": "Tukar syarikat {branch}",
    "Add the department {name} to {branch}": "Tambah jabatan {name} ke {branch}",
    "Add the starter team to {branch}": "Tambah pasukan permulaan ke {branch}",
    "Delete the department {dept}": "Padam jabatan {dept}",
    "Rename the department {dept} to {name}": "Tukar nama jabatan {dept} kepada {name}",
    "Change the department {dept}": "Tukar jabatan {dept}",
    "Change the AI allowance rules": "Tukar peraturan peruntukan AI",
    "Give {name} more AI allowance": "Beri {name} lebih peruntukan AI",
    "Change {name}'s AI allowance": "Tukar peruntukan AI {name}",
    "Change the work scope rule": "Tukar peraturan skop kerja",
    "Change the two-step sign-in rule to {policy}": (
        "Tukar peraturan log masuk dua langkah kepada {policy}"
    ),
    "Reset {name}'s two-step sign-in": "Set semula log masuk dua langkah {name}",
    "Link office people to their Prima records": "Pautkan orang pejabat kepada rekod Prima mereka",
    "Change": "Tukar",
    "Delete": "Padam",
    "Add or run": "Tambah atau jalankan",
    "{verb} {path} ({fields})": "{verb} {path} ({fields})",
    "{verb} {path}": "{verb} {path}",
}
