# ruff: noqa: E501
"""P109 Bahasa Melayu: tasks for people, Trello-like (api/routers/tasks.py, people_tasks.py,
teams/task_parts.py). Same style and terms as ms.py and ms_team.py (tugasan, pemerhati,
senarai semak, subtugasan)."""

MS_TASKS: dict[str, str] = {
    "Watchers and sub-tasks are for tasks given to people.": (
        "Pemerhati dan subtugasan hanya untuk tugasan yang diberi kepada orang."
    ),
    "Pick at most 25 people for each.": "Pilih paling banyak 25 orang bagi setiap satu.",
    "You can add as watchers the people you may give tasks to and the people you report to.": (
        "Anda boleh menambah sebagai pemerhati orang yang boleh anda beri tugasan dan orang yang anda lapor kepadanya."
    ),
    "The start is after the due date.": "Tarikh mula selepas tarikh akhir.",
    "This is for tasks given to people.": "Ini untuk tugasan yang diberi kepada orang.",
    "Pick at least one person.": "Pilih sekurang-kurangnya seorang.",
    "That item is not here.": "Item itu tiada di sini.",
    "A checklist holds up to 100 items.": "Senarai semak boleh memuatkan hingga 100 item.",
    "Sub-tasks go at most five levels deep.": "Subtugasan boleh bertingkat hingga lima paras sahaja.",
}
