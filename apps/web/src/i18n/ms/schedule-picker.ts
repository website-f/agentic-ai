/** P55: the schedule picker, its date and time pickers, and schedules in plain words. */
export const SCHEDULE_PICKER: Record<string, string> = {
  // ---- how often
  "Weekdays (Mon–Fri)": "Hari bekerja (Isn–Jum)",
  "Every week": "Setiap minggu",
  "Every few hours": "Setiap beberapa jam",
  "Schedule|verb": "Jadualkan",
  "On these days": "Pada hari-hari ini",
  "Day of the month": "Hari dalam bulan",
  "Up to the 28th, so it runs in every month.": "Hingga 28hb sahaja, supaya ia berjalan setiap bulan.",
  "Day {day}": "Hari {day}",
  "Every {n} hours": "Setiap {n} jam",
  "Only during working hours": "Hanya dalam waktu bekerja",
  "Off: around the clock.": "Dimatikan: sepanjang masa.",
  "Weekdays only": "Hari bekerja sahaja",
  "Monday to Friday.": "Isnin hingga Jumaat.",

  // ---- the summary and its problems
  "That timing does not work. Pick another.": "Masa itu tidak boleh digunakan. Pilih yang lain.",
  "That time has already passed. Pick a later one.": "Masa itu sudah berlalu. Pilih masa yang lebih lewat.",
  "Runs {when}, then switches itself off.": "Berjalan {when}, kemudian berhenti sendiri.",
  "Times are in {tz}.": "Masa mengikut zon {tz}.",

  // ---- a timing the picker cannot show
  "Custom timing": "Masa tersuai",
  "This schedule has a timing the picker cannot show. It keeps running as it is until you replace it.":
    "Jadual ini menggunakan masa yang tidak dapat dipaparkan di sini. Ia terus berjalan seperti biasa sehingga anda menggantikannya.",
  "Advanced": "Lanjutan",
  "As the scheduler reads it (minute, hour, day, month, weekday):": "Seperti yang dibaca oleh penjadual (minit, jam, hari, bulan, hari minggu):",
  "Replace with a simple schedule": "Ganti dengan jadual mudah",
  "Keep the original timing": "Kekalkan masa asal",

  // ---- date and time pickers
  "Pick a date": "Pilih tarikh",
  "{label}: {value}": "{label}: {value}",
  "Quick times": "Masa pantas",
  "Hour": "Jam",
  "Minute": "Minit",
  "Morning or afternoon": "Pagi atau petang",

  // ---- schedules in plain words (lib/teams.ts)
  "Once on {date} at {time}": "Sekali pada {date}, {time}",
  "Every day at {time}": "Setiap hari, {time}",
  "Every weekday at {time}": "Setiap hari bekerja, {time}",
  "Every {days} at {time}": "Setiap {days}, {time}",
  "Every month on day {day} at {time}": "Setiap bulan pada hari {day}, {time}",
  "Every year on {date} at {time}": "Setiap tahun pada {date}, {time}",
  "Every hour on weekdays": "Setiap jam pada hari bekerja",
  "Every {n} hours on weekdays": "Setiap {n} jam pada hari bekerja",
  "Every hour between {from} and {to}": "Setiap jam antara {from} dan {to}",
  "Every {n} hours between {from} and {to}": "Setiap {n} jam antara {from} dan {to}",
  "Every hour between {from} and {to} on weekdays": "Setiap jam antara {from} dan {to} pada hari bekerja",
  "Every {n} hours between {from} and {to} on weekdays": "Setiap {n} jam antara {from} dan {to} pada hari bekerja",
};
