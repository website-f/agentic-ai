"""The "when" parser in Malay, and Malay mixed with English (P23).

Office staff type schedules the way they talk: "setiap Isnin 9 pagi", "esok jam 3 petang",
"1hb setiap bulan". The same cron lines come out as for the English, and anything that does
not pin down one time is a question back, never a guessed schedule."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from agentic.teams import schedules, when

KL = ZoneInfo("Asia/Kuala_Lumpur")
MON = datetime(2026, 10, 5, 10, 0, tzinfo=KL)  # Monday 5 Oct 2026, 10:00


def parse(text: str) -> when.When:
    return when.parse(text, "Asia/Kuala_Lumpur", MON)


@pytest.mark.parametrize(
    ("text", "cron"),
    [
        # days
        ("setiap Isnin 9 pagi", "0 9 * * 1"),
        ("tiap Selasa jam 3 petang", "0 15 * * 2"),
        ("tiap-tiap Rabu pukul 10 pagi", "0 10 * * 3"),
        ("setiap Khamis 2.30 petang", "30 14 * * 4"),
        ("setiap Jumaat 8 malam", "0 20 * * 5"),
        ("setiap Jumat 9 pagi", "0 9 * * 5"),
        ("setiap Sabtu 10 pagi", "0 10 * * 6"),
        ("setiap Ahad 9 pagi", "0 9 * * 0"),
        ("setiap Ahd 9 pagi", "0 9 * * 0"),
        ("setiap hari Minggu 9 pagi", "0 9 * * 0"),
        ("Isn dan Kha 9 pagi setiap minggu", "0 9 * * 1,4"),
        ("setiap hari Isnin, Rabu dan Jumaat jam 10 pagi", "0 10 * * 1,3,5"),
        ("setiap Isnin hingga Jumaat 8 pagi", "0 8 * * 1-5"),
        ("setiap Isnin-Khamis 8 pagi", "0 8 * * 1-4"),
        ("setiap minggu hari Rabu 4 petang", "0 16 * * 3"),
        ("seminggu sekali hari Isnin 9 pagi", "0 9 * * 1"),
        ("setiap hari bekerja jam 8 pagi", "0 8 * * 1-5"),
        ("setiap hari kerja 8.30 pagi", "30 8 * * 1-5"),
        ("hari bekerja 9 pagi", "0 9 * * 1-5"),
        ("setiap hujung minggu jam 10 pagi", "0 10 * * 0,6"),
        ("setiap hari 9 pagi", "0 9 * * *"),
        ("tiap hari jam 8 malam", "0 20 * * *"),
        ("hari-hari 12 tengah hari", "0 12 * * *"),
        ("setiap hari tengah hari", "0 12 * * *"),
        ("setiap hari tengah malam", "0 0 * * *"),
        ("setiap hari 12 tengah malam", "0 0 * * *"),
        ("setiap pagi jam 8", "0 8 * * *"),
        ("setiap jam 9 pagi", "0 9 * * *"),
        ("harian 7 pagi", "0 7 * * *"),
        ("setiap hari 9 pagi dan 5 petang", "0 9,17 * * *"),
        ("pukul lapan malam setiap hari", "0 20 * * *"),
        # times written other ways
        ("setiap Isnin 9:30 pagi", "30 9 * * 1"),
        ("setiap Isnin 9.30pg", "30 9 * * 1"),
        ("setiap Isnin 3ptg", "0 15 * * 1"),
        ("setiap Isnin 8mlm", "0 20 * * 1"),
        ("setiap Isnin jam 9 setengah pagi", "30 9 * * 1"),
        ("setiap Isnin 0900", "0 9 * * 1"),
        ("setiap Isnin pukul 0830", "30 8 * * 1"),
        ("setiap Isnin pukul 9.30", "30 9 * * 1"),
        ("setiap Isnin jam 14:00", "0 14 * * 1"),
        ("setiap Isnin 1 tengah hari", "0 13 * * 1"),
        # month and year
        ("1hb setiap bulan jam 9 pagi", "0 9 1 * *"),
        ("setiap bulan 1hb 9 pagi", "0 9 1 * *"),
        ("setiap 1hb jam 9 pagi", "0 9 1 * *"),
        ("setiap 15 haribulan 9 pagi", "0 9 15 * *"),
        ("hari pertama setiap bulan 9 pagi", "0 9 1 * *"),
        ("hari ke-15 setiap bulan 9 pagi", "0 9 15 * *"),
        ("setiap bulan pada 1hb dan 15hb jam 9 pagi", "0 9 1,15 * *"),
        ("sebulan sekali pada 1hb 9 pagi", "0 9 1 * *"),
        ("setiap tahun 1 Januari 9 pagi", "0 9 1 1 *"),
        ("setiap tahun pada 31 Dis 5 petang", "0 17 31 12 *"),
        # every few minutes or hours
        ("setiap 3 jam", "0 */3 * * *"),
        ("setiap jam", "0 * * * *"),
        ("sejam sekali", "0 * * * *"),
        ("2 jam sekali", "0 */2 * * *"),
        ("setiap 30 minit", "*/30 * * * *"),
        ("setiap setengah jam", "*/30 * * * *"),
        ("setiap suku jam", "*/15 * * * *"),
        ("setiap 2 jam pada hari bekerja antara 9 pagi dan 5 petang", "0 9-17/2 * * 1-5"),
        ("setiap 3 jam dari 8 pagi hingga 6 petang", "0 8-18/3 * * *"),
        # mixed with English
        ("every Isnin 9 pagi", "0 9 * * 1"),
        ("setiap Monday 9am", "0 9 * * 1"),
        ("every weekday jam 8 pagi", "0 8 * * 1-5"),
        ("setiap hari at 5pm", "0 17 * * *"),
        ("1hb every month 9am", "0 9 1 * *"),
    ],
)
def test_malay_repeats(text, cron):
    w = parse(text)
    assert (w.cron, w.once) == (cron, False), text
    assert w.first > MON


@pytest.mark.parametrize(
    ("text", "at"),
    [
        ("esok 3 petang", datetime(2026, 10, 6, 15, 0)),
        ("besok jam 10 pagi", datetime(2026, 10, 6, 10, 0)),
        ("esok pagi pukul 10", datetime(2026, 10, 6, 10, 0)),
        ("tengah hari esok", datetime(2026, 10, 6, 12, 0)),
        ("lusa 10 pagi", datetime(2026, 10, 7, 10, 0)),
        ("hari ini 5 petang", datetime(2026, 10, 5, 17, 0)),
        ("hari ni jam 4 petang", datetime(2026, 10, 5, 16, 0)),
        ("petang ini 3 petang", datetime(2026, 10, 5, 15, 0)),
        ("malam ni pukul 9", datetime(2026, 10, 5, 21, 0)),
        ("Jumaat ini 4 petang", datetime(2026, 10, 9, 16, 0)),
        ("Khamis 11 pagi", datetime(2026, 10, 8, 11, 0)),
        ("Isnin 9 pagi", datetime(2026, 10, 12, 9, 0)),  # today's 9am is gone: next week's
        ("Isnin depan 9 pagi", datetime(2026, 10, 12, 9, 0)),
        ("Isnin minggu depan jam 10 pagi", datetime(2026, 10, 12, 10, 0)),
        ("minggu depan hari Rabu 2 petang", datetime(2026, 10, 7, 14, 0)),
        ("5 Okt jam 3 petang", datetime(2026, 10, 5, 15, 0)),
        ("12 Oktober 9 pagi", datetime(2026, 10, 12, 9, 0)),
        ("5hb Disember 9 pagi", datetime(2026, 12, 5, 9, 0)),
        ("pada 1 Mac jam 9 pagi", datetime(2027, 3, 1, 9, 0)),
        ("2 Ogos 9 pagi", datetime(2027, 8, 2, 9, 0)),
        ("5 Mei 9 pagi", datetime(2027, 5, 5, 9, 0)),
        ("5/10 jam 3 petang", datetime(2026, 10, 5, 15, 0)),
        ("10/11 jam 3 petang", datetime(2026, 11, 10, 15, 0)),  # Malay dates are day first
        ("1/12/2026 jam 10 pagi", datetime(2026, 12, 1, 10, 0)),
        ("20.10.2026 jam 10 pagi", datetime(2026, 10, 20, 10, 0)),
        ("dalam 2 jam", datetime(2026, 10, 5, 12, 0)),
        ("2 jam lagi", datetime(2026, 10, 5, 12, 0)),
        ("dalam 30 minit", datetime(2026, 10, 5, 10, 30)),
        ("dalam setengah jam", datetime(2026, 10, 5, 10, 30)),
        ("2 hari lagi", datetime(2026, 10, 7, 10, 0)),
        ("ingatkan saya esok jam 3 petang", datetime(2026, 10, 6, 15, 0)),
        ("tomorrow 3 petang", datetime(2026, 10, 6, 15, 0)),
        ("esok at 9am", datetime(2026, 10, 6, 9, 0)),
    ],
)
def test_malay_one_offs(text, at):
    w = parse(text)
    assert w.once, text
    assert w.first == at.replace(tzinfo=KL), text


def test_summaries_read_the_same_as_english():
    assert parse("setiap hari bekerja jam 8 pagi").summary == "every weekday at 08:00"
    assert parse("1hb setiap bulan jam 9 pagi").summary == "every month on the 1st at 09:00"
    assert parse("setiap Isnin dan Khamis 2 petang").summary == (
        "every Monday and Thursday at 14:00"
    )
    assert parse("esok 3 petang").summary == "once on Tue 6 Oct 2026 at 15:00"
    assert parse("every Monday to Thursday at 9am").summary == (
        "every Monday, Tuesday, Wednesday and Thursday at 09:00"
    )


@pytest.mark.parametrize(
    ("text", "cron"),
    [
        # small English fixes that came with the Malay
        ("every Monday to Thursday at 9am", "0 9 * * 1-4"),
        ("every mon-fri at 9am", "0 9 * * 1-5"),
        ("every 9am", "0 9 * * *"),
        ("every day at 0900", "0 9 * * *"),
        ("every 2 hours between 0900 and 1700", "0 9-17/2 * * *"),
        ("day after tomorrow 9am", "0 9 7 10 *"),
        ("at 1400 tomorrow", "0 14 6 10 *"),
        ("1730 hrs tomorrow", "30 17 6 10 *"),
        ("on 10 Oct 2026 at 4pm", "0 16 10 10 *"),  # a year is not a time
    ],
)
def test_english_extras(text, cron):
    assert parse(text).cron == cron


@pytest.mark.parametrize(
    ("text", "asks"),
    [
        ("setiap Isnin", "At what time"),
        ("setiap hari bekerja", "9 pagi"),
        ("setiap Isnin jam 9", "morning or in the evening"),
        ("esok jam 9", "9 pagi"),
        ("esok pukul 3.30", "morning or in the afternoon"),
        ("esok 2 malam", "after midnight"),
        ("esok 12 pagi", "midnight or noon"),
        ("esok jam 12", "noon or midnight"),
        ("setiap hari 15 petang", "not a time of day"),
        ("jam 5 petang", "Once (today or tomorrow?)"),
        ("setiap 2 minggu", "can't skip weeks"),
        ("dua minggu sekali", "can't skip weeks"),
        ("selang seminggu hari Isnin 9 pagi", "can't skip weeks"),
        ("setiap 2 hari 9 pagi", "can't skip weeks"),
        ("hari bekerja terakhir setiap bulan", "isn't possible"),
        ("hari terakhir setiap bulan 9 pagi", "isn't possible"),
        ("setiap bulan 30hb 9 pagi", "28th"),
        ("setiap minggu 9 pagi", "Which day of the week"),
        ("setiap bulan 9 pagi", "Which day of the month"),
        ("Isnin pertama setiap bulan 9 pagi", "Which day of the month"),  # not the 1st
        ("setiap hari kecuali Jumaat 9 pagi", "Name the days"),
        ("every day except Friday at 9am", "Name the days"),
        ("Isnin dan Jumaat 9 pagi", "several days"),
        ("minggu depan", "next week"),
        ("bulan depan", "next month"),
        ("Isnin depan", "At what time on that day"),
        ("hari ini 9 pagi", "already passed"),
        ("5/13 jam 3 petang", "not a real date"),
        ("31/2 jam 9 pagi", "not a real date"),
        ("bila-bila masa", "setiap Isnin 9 pagi"),  # the examples come in Malay
        ("setiap 45 minit", "fit evenly"),
    ],
)
def test_malay_asks_when_unclear(text, asks):
    with pytest.raises(when.Unclear) as e:
        parse(text)
    assert asks in str(e.value), str(e.value)


@pytest.mark.parametrize("text", ["setiap 5 minit", "setiap 10 minit"])
def test_malay_minimum_interval(text):
    with pytest.raises(schedules.ScheduleError, match="15 minutes"):
        parse(text)


@pytest.mark.parametrize(
    "text",
    [
        "remind Hari tomorrow 9am",  # a name, not "day"
        "remind Dan on Friday 4pm",
        "every Monday at 9am",
        "tomorrow 9am",
    ],
)
def test_english_names_are_left_alone(text):
    assert parse(text).first > MON


def test_questions_come_back_in_the_persons_language():
    from agentic.i18n import use_lang

    with use_lang("ms"), pytest.raises(when.Unclear) as e:
        parse("setiap Isnin")
    assert (
        str(e.value) == "Pukul berapa ia patut berjalan? Tulis, contohnya, 9 pagi atau 4.30 petang."
    )
    with use_lang("ms"), pytest.raises(when.Unclear) as e:
        parse("every Monday at 9")
    assert str(e.value).startswith("9 itu pagi atau petang/malam?")
    with use_lang("ms"), pytest.raises(when.Unclear) as e:
        parse("whenever")
    assert str(e.value).startswith("Saya tidak pasti bila. cth. 'setiap Isnin 9 pagi'")
    with use_lang("en"), pytest.raises(when.Unclear) as e:
        parse("setiap Isnin")
    assert str(e.value) == "At what time should it run? Say e.g. 9 pagi or 4.30 petang."
