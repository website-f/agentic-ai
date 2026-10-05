"""The schedule summary a person reads, in Malay (the stored form stays English)."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from agentic.teams.when import parse, summary_in

TZ = "Asia/Kuala_Lumpur"
NOW = datetime(2026, 10, 5, 10, 0, tzinfo=ZoneInfo(TZ))


@pytest.mark.parametrize(
    ("text", "english", "malay"),
    [
        ("every Monday 9am", "every Monday at 09:00", "setiap Isnin jam 09:00"),
        (
            "setiap hari bekerja jam 8 pagi",
            "every weekday at 08:00",
            "setiap hari bekerja jam 08:00",
        ),
        (
            "hujung minggu 10 pagi",
            "every Saturday and Sunday at 10:00",
            "setiap Sabtu dan Ahad jam 10:00",
        ),
        ("setiap hari 7 pagi", "every day at 07:00", "setiap hari jam 07:00"),
        (
            "every Tuesday at 9am and 3pm",
            "every Tuesday at 09:00 and 15:00",
            "setiap Selasa jam 09:00 dan 15:00",
        ),
        (
            "every 2 hours on weekdays between 9am and 5pm",
            "every 2 hours on weekdays from 09:00 to 17:00",
            "setiap 2 jam pada hari bekerja dari 09:00 hingga 17:00",
        ),
        ("every 3 hours on Mondays", "every 3 hours on Mondays", "setiap 3 jam pada Isnin"),
        ("every 30 minutes", "every 30 minutes", "setiap 30 minit"),
        ("every hour", "every hour", "setiap jam"),
        (
            "1hb dan 15hb setiap bulan 9 pagi",
            "every month on the 1st and 15th at 09:00",
            "setiap bulan pada 1hb dan 15hb jam 09:00",
        ),
        (
            "setiap tahun 1 Januari 9 pagi",
            "every year on 1 Jan at 09:00",
            "setiap tahun pada 1 Jan jam 09:00",
        ),
        (
            "esok 3 petang",
            "once on Tue 6 Oct 2026 at 15:00",
            "sekali pada Sel 6 Okt 2026 jam 15:00",
        ),
    ],
)
def test_summary_reads_in_malay(text: str, english: str, malay: str) -> None:
    w = parse(text, TZ, NOW)
    assert w.summary == english
    assert summary_in(w.summary, "ms") == malay
    assert summary_in(w.summary, "en") == english
    assert summary_in(w.summary, None) == english
