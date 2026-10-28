# P54: the dialect that would not switch off, smarter memory, and a bug sweep

## Sabah dialect kept answering after switching back to English

Three things kept the dialect alive after a person changed it:

1. **The dialect rode on every chat turn** whatever language the person wrote in. It now applies
   only when the message is in Malay (`dialects.style_for`, `writes_malay`). If you write in English, you get plain
   English back. If you write in Malay, you get your dialect. An unclear message ("ok") follows the app language.
   When no dialect applies, the turn says so explicitly (`plain_note`), so earlier dialect
   replies in the same conversation are not copied.
2. **Memory learned it.** Learning extracted facts like "Fitri prefers replies in Sabah dialect",
   and recall brought them back every turn. A preference about language, dialect or slang is now a setting, never
   a memory (`dialects.about_speech`):
   - learning skips such facts;
   - recall drops existing ones;
   - core memory refuses to save them, whether the agent or a person writes them ("How your AI speaks to you is set in Settings").
3. **A conversation froze its core memory** at its first message. The prompt now leaves out
   any speech note even from an older frozen copy (`agents/prompt.py`).

The Settings text now says when the dialect applies.

## Memory: smarter recall, visible and correctable

- **Follow-ups recall properly.** A short message ("and is that net?", "send it to him") is
  searched together with the person's message before it (`runtime._recall_query`). Without that, memory
  finds the customer or job the conversation is about only by luck.
- **"What it remembered"** under each chat answer lists the facts and library files it used (saved
  on the answer as `meta.recalled`). Files open at the right page. **Not right** forgets a fact at
  once; Brain can restore it. An office agent's private facts (how it works for other people)
  are used but not listed.
- **Fresher facts rank higher** among equals. A fact learned this month beats one from a year ago,
  fading to no less than 80% (`brain/search.py`, `FRESH_DAYS = 180`). The decay counts from when the fact was
  learned, not from when it was last recalled, so being used does not keep an old fact looking new.
- **WhatsApp and Telegram chats pick up memory changes.** These are one conversation forever.
  Their frozen core memory now refreshes after an hour of quiet, by which time the prompt cache is cold anyway.

## Bug sweep (checked against the code, each fixed)

| Severity | Bug | Fix |
|---|---|---|
| High | A connector sync erased the fields people added to a synced CRM list, such as a follow-up note or the auto-number. | Sync updates only its own fields and keeps the rest. |
| Medium-high | Turning on remote view for a staff computer left the switch showing "Off" until a reload. | The staff computer's own cached copy updates too. |
| Medium | PC backup: one failed folder listing made the next run copy that folder again. | Pruning is skipped after errors. |
| Medium | PC backup: removing a shared folder shifted the other folders onto old storage keys. | Keys are now a hash of the folder path. |
| Medium | PC backup: a big first backup waited a whole interval between batches. | It continues on the next round. |
| Medium | CRM "this week", "past", "this month" and dashboard dates used the server's UTC date, so a Malaysian office before 8am was looking at yesterday. | Dates use the workspace time zone (`engine._ZONE`, set in `all_rows`). |
| Medium | CRM board and calendar showed only the first 100 records. | They load the rest themselves, up to 2,000. |
| Medium | Renaming a choice, then importing or syncing its new label, created a duplicate choice. | Labels count as known. |
| Medium | Adding a connector whose first sync failed returned an error, and a retry duplicated the list. | Rows are re-read after the rollback. |
| Low | "Date is …" never matched a date-and-time field. | It compares the day. |
| Low | Board records whose choice had been removed disappeared. | They show under "(empty)". |
| Low | Synced and webhook records had no auto-number. | They are numbered like records added by hand. |
| Low | Searching "backup" on Staff computers clashed with the backup settings. | The roster has its own query key. |

**Noted, not changed:** `/overview` shows no hub tabs, because its own nav entry outranks the hub
match. This is cosmetic.

**Upgrade note:** existing PC backups move to the new folder keys. The first run after deploy copies each
shared folder once more. The old copies stay in the storage place and can be deleted there.
