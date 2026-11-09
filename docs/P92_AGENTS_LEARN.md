# P92: how the agents learn from you (in plain words)

Fitri asked (9 Nov 2026): "In ePerolehan work, when the agent gets something wrong and the user
tells it the right thing, the agent learns from it, takes a note, and gets smarter every day."

This is how it works now.

## 1. You correct an agent, it keeps one lesson at once

Any of these is a correction:

| What you do | Where |
| --- | --- |
| Send finished work back with what was wrong | Task > Send back |
| Answer the agent's question with a rule ("No, always attach the SSM copy from Company files") | Approvals / the task's question |
| Turn a request down and say why | Approvals > Deny, with a reason |
| Say "no, ...", "salah, ...", "jangan ..." in chat | Chat |
| Say "remember this", "ingat ini", "lain kali ..." | Chat, a send-back or an answer |

Straight away (not at the end of the task) a small, cheap AI model turns what you said into
**one lesson**: one plain sentence, plus when it applies, what to do, what not to do, the form
field it is about (for example *Catatan*) and an example. If no small model is set up, your own
words become the lesson (for answers and denials nothing is kept then: a short answer like
"October" is not a rule).

You see it right there: **"Noted for next time: ..."** under the chat answer or on the task's
timeline, with an **Undo** button.

The lesson is filed under a topic: **ePerolehan** for tender work (tender mode, or a task that
mentions ePerolehan, a tender, a quotation or a QT number); otherwise the skill the work
follows, the task's label, or "general".

Nothing secret is ever kept. Passwords, PINs, OTP/TAC codes, IC and card numbers are blanked
out before the model sees your words, and the lesson is checked again before it is saved (a
lesson that still holds one is dropped).

If you teach the same point again, the lesson is not stored twice: it is marked "taught 2
times" (a repeated mistake). If you teach something that updates an older lesson, the newer
one replaces it; the old one is kept in the history and Undo brings it back.

Who gets the lesson: a lesson taught to a team agent is used by that company's agents. A
lesson taught to someone's own AI (their twin) stays with that AI, unless a manager taught it.
A private assistant's lessons are only ever its own.

## 2. The agents use the lessons every time

- Every tender (ePerolehan) task starts with a **"Lessons learned for ePerolehan"** list: the
  best twelve lessons (most certain, most recent, most used). This is not left to chance search.
- Every other task gets the lessons of its own topic, and the agent's own general lessons.
- When you send work back, the agent's next run looks in memory again, so the lesson you just
  taught is in front of it while it fixes the work.
- In chat, every message carries the lessons of what you are talking about.
- Each time a lesson is used it is counted, so you can see which lessons matter.

## 3. ePerolehan has a real skill now: `eperolehan-tender`

Tender mode follows the office's built-in skill **eperolehan-tender** (Skills page). Every
tender task records that it uses it, so the learning engine improves *this* skill, and the
task's brief carries the skill's **Pitfalls**.

Every night the dream takes the new lessons of the day and proposes adding them to the skill's
Pitfalls. The proposal is tested (old version against new). The learning autopilot switches it
on only when its rules allow (Learning > Overview and autopilot); otherwise it waits for you in
Skills > Proposals. A proposal you reject is not proposed again. Once a lesson is in the skill,
it is not repeated in the lessons list of the task.

## 4. "Getting smarter every day": where to look

**Learning > Lessons** (owners, admins and managers):

- **Getting smarter every day**: one day at a time (arrows for the day before/after): lessons
  learned, skills that got a new version, and repeated mistakes (points people had to teach
  more than once).
- **Lessons**: every lesson, filtered by topic and agent. Each shows who taught it, when, how
  it was taught, how many times it was used and when last.

The Monday **weekly report** ("What the AI team learned") now counts the lessons per agent and
says how many had to be taught more than once.

Staff see what people taught their own AI on **My AI > What it knows**.

## 5. How to review, change or forget a lesson

- **Undo** (on the "Noted for next time" note, or on the lesson): the person who taught it can
  take it back for 7 days; owners and admins any time.
- **Edit** (owners and admins, Learning > Lessons): change the sentence or its parts. The edit
  is itself a correction: the old wording is kept, ended, with who changed it and when (audit
  log "lesson.edited").
- **Forget** (owners and admins): the agents stop using it at once (audit log "lesson.forgotten").

## 6. Also fixed in this round (QA of agents, brain, skills, library)

- A person's lesson can no longer be overwritten by the agent's own after-task note-taking, and
  the nightly dream keeps a person's lesson over an agent's guess.
- The nightly curator no longer merges a skill of one company (or one agent) into another's.
- A skill draft written against an older version can no longer quietly undo a newer approved
  version (it asks for a fresh draft, or a person edits it while approving).
- Staff can no longer change or forget what the whole office remembers; they change only their
  own AI's memory.

## For the developer

- Lessons are `brain_facts` rows with `source_kind = 'lesson'` and their structure in the new
  `brain_facts.meta` JSON column (migration `0056`, down revision `0053`).
- Code: `apps/api/agentic/brain/lessons.py` (capture, use, fold), `skills/eperolehan.py` (the
  skill), `api/routers/lessons.py` (`/api/lessons`, `/api/learning/digest`).
- Tests: `apps/api/tests/test_p92_lessons.py`, `apps/web/src/pages/learning/lessons.test.tsx`.
