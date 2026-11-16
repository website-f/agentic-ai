# ruff: noqa: E501
"""P99 Bahasa Melayu: what each member reaches, the office and Prima or Prima only, and the
Prima screens chosen for them (core/access.py, prima/client.py, api/routers/members.py)."""

MS_ACCESS: dict[str, str] = {
    "Your access is to Prima only. Open Prima to continue.": "Akses anda hanya untuk Prima. Buka Prima untuk teruskan.",
    "{screens} is not in your Prima access. Ask the person who manages members in the office to add it.": (
        "{screens} tiada dalam akses Prima anda. Minta orang yang mengurus ahli di pejabat untuk menambahnya."
    ),
    "This part of Prima is not in your Prima access. Ask the person who manages members in the office to add it.": (
        "Bahagian Prima ini tiada dalam akses Prima anda. Minta orang yang mengurus ahli di pejabat untuk menambahnya."
    ),
    "Only owners, admins, management and HR set what someone reaches.": (
        "Hanya pemilik, pentadbir, pengurusan dan HR yang menetapkan akses seseorang."
    ),
    "Pick an access.": "Pilih satu akses.",
    "Pick Prima screens from the list.": "Pilih skrin Prima daripada senarai.",
    "Owners always have the office and all of Prima.": "Pemilik sentiasa ada pejabat dan seluruh Prima.",
    "You can give only the Prima screens you have yourself.": (
        "Anda hanya boleh memberi skrin Prima yang anda sendiri ada."
    ),
    "You cannot change your own access. Ask another owner or admin.": (
        "Anda tidak boleh menukar akses anda sendiri. Minta pemilik atau pentadbir lain."
    ),
    "Group leadership": "Kepimpinan kumpulan",
    "PWVSB staff": "Staf PWVSB",
    "Company Manager": "Pengurus Syarikat",
    "Admin Executive": "Eksekutif Pentadbiran",
    "Supervisor": "Penyelia",
    "Guard": "Pengawal",
    "Site device": "Peranti tapak",
    "Owners open Prima as its top record (the CEO).": "Pemilik membuka Prima sebagai rekod teratasnya (CEO).",
    "Not opened Prima yet. Prima uses their staff record if it has one; else they get {prima_role} from their office role ({role}).": (
        "Belum membuka Prima. Prima menggunakan rekod staf mereka jika ada; jika tiada, mereka mendapat {prima_role} daripada peranan pejabat mereka ({role})."
    ),
    "Their own Prima account, given from their office role ({role}) when they first opened Prima.": (
        "Akaun Prima mereka sendiri, diberi daripada peranan pejabat mereka ({role}) semasa mereka mula membuka Prima."
    ),
    "Their Prima staff record ({name}). Its role is set in Prima, on that record.": (
        "Rekod staf Prima mereka ({name}). Peranannya ditetapkan dalam Prima, pada rekod itu."
    ),
    # P106: the developer opens Prima as their own account; a Prima department per member
    "Only the system's developer chooses how they open Prima.": (
        "Hanya pembangun sistem yang memilih cara mereka membuka Prima."
    ),
    "Pick how to open Prima.": "Pilih cara membuka Prima.",
    "Pick a Prima department from the list.": "Pilih jabatan Prima daripada senarai.",
    "HR in Prima is for central staff only. A branch manager cannot be in HR.": (
        "HR dalam Prima hanya untuk staf pusat. Pengurus cawangan tidak boleh berada dalam HR."
    ),
    "Someone else must OK what you loaded. You made this with your own Prima account, so another person (the CEO) gives the OK.": (
        "Orang lain mesti memberi OK untuk apa yang anda muatkan. Anda membuatnya dengan akaun Prima anda sendiri, jadi orang lain (CEO) yang memberi OK."
    ),
    "Prima could not check who made this. Try again in a minute.": (
        "Prima tidak dapat menyemak siapa yang membuat ini. Cuba lagi sebentar lagi."
    ),
    "The developer opens Prima as their own account (set on the Prima page).": (
        "Pembangun membuka Prima sebagai akaun mereka sendiri (ditetapkan di halaman Prima)."
    ),
}
