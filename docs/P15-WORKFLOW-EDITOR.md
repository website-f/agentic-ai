# P15: Workflow editor (2026-10-03)

Staff hand whole jobs to their agents. A workflow maps how a job is done; it can be drawn by
hand, drafted by an AI analyst, or started from a template, and then used three ways.

## 1. Making a workflow

**New workflow** offers three ways in:

| Way in | What happens |
|---|---|
| Draw it yourself | An empty board and the full step library |
| Ask AI to draft it | Describe the job in plain words; `POST /api/workflows/draft` returns a laid-out graph |
| Start from a template | 12 office workflows (`pages/workflows/templates.ts`): enquiry to quotation, supplier invoice, leave, purchase request, weekly report, recruitment, complaint, social post, submission pack, month-end, meeting follow-up, onboarding |

In the editor, **Improve with AI** sends the current graph plus an instruction (or one of the
suggestions) to the same endpoint. Agents, review switches and notes people set are kept.

## 2. The editor (`pages/workflows/editor.tsx`, `canvas.tsx`)

Full screen, like a design tool: step library on the left, board in the middle, details on the
right; on phones and tablets the library and details open as sheets.

- **Board**: pan by dragging or scrolling; zoom with Ctrl/⌘ + scroll, pinch or the buttons;
  fit to screen; minimap; 20px snap grid.
- **Adding steps**: drag from the library onto the board, or click (it goes after the selected
  step, connected). Drag a step's `+` dot onto another step to connect, or onto empty space
  to choose the next step right there. A selected connection can have a step inserted into it.
- **Undo/redo** (typing in a field is one undo step), duplicate, delete, Tidy up (layered
  top-to-bottom layout, longest path, End steps on the bottom row; same rule on the server).
- **Problems**: unreachable steps, dead ends, decisions without two labelled branches, loops
  back (a run does each step once), missing Start/End.
- Shortcuts: Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z, Ctrl+D, Delete, Esc.

## 3. The step library (`pages/workflows/library.tsx`, server `procedure.ACTIONS`)

| Group | Steps |
|---|---|
| Flow | Start, Decision, Wait, End, Note |
| AI work | Agent task, Research, Read files, Write, Summarise, Translate, Analyse data, Calculate, Check, Sort & label, Plan |
| Communication | Draft email, Reply to customer, Message the team, Prepare meeting |
| Documents | Fill a template, Prepare a pack, Publish report, Spreadsheet |
| Web | Look up online, Fill a web form |
| People | Approval, Ask a person, Hand off |

A work step's **action** adds a "How:" line to the agent's brief (e.g. Draft email: "Do not
send it; a person sends it"). New node types in the engine (`workflows/runs.py`):

- `input` (Ask a person): the run waits; `POST /api/workflow-runs/{id}/answer` gives the
  answer, which becomes the step's output for every later step.
- `wait`: status `scheduled` until `wait_amount` × `wait_unit` passes (the driver ticks every
  15 s); `POST /api/workflow-runs/{id}/skip-wait` moves on early. Not counted as "needs you".
- `note`: on the canvas only; runs and the compiled procedure leave it out.
- Approval = a decision with `action: approval`, branches labelled approved / rejected.

## 4. Using a workflow

| How | Where |
|---|---|
| Run it: each step becomes a task for its agent; decisions, answers and reviews come to you | Run button in the editor |
| Give it with a task: "Agent follows it" adds the procedure to the brief (`TaskIn.workflow_id`); "Run step by step" starts a run with the brief as the job, filling unassigned steps with the chosen agent | New task dialog |
| Make it standard: active workflows are layered into the attached agents' prompts like an SOP | Editor settings, "Agents follow it" |

## 5. Tests

`apps/api/tests/test_workflow_editor.py` (8): new step kinds in the procedure, layout, input
and wait in a live run (incl. skip), AI improve keeps people's settings, tasks following a
workflow, actions only on the types that use them, a cut-off draft linked in order.
Live check: a real model drafted a 13-step expense-claim workflow with approval branches,
a 2-day wait and two End steps, laid out correctly.
