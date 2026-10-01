# Pixel office

A live top-down pixel-art office where every agent is a character. It is the home screen on mobile and a tab on desktop. It must stay a **view onto real state**, never a simulation: every animation corresponds to an event from the API.

## 1. Build vs fork

Build our own on **Phaser 4 + Tiled**, porting patterns from two MIT repos:

| Repo | What we port |
|---|---|
| `geezerrrr/agent-town` (Next.js + Phaser 3 + Tiled) | Map loading, typed event bus between React and Phaser, "walk up to a worker and assign a task" interaction, task state badges |
| `pablodelucca/pixel-agents` (Canvas 2D, MIT) | Character state machine, BFS pathfinding on a collision grid, adapter boundary between state source and renderer, layout-editor idea |

Why not fork: pixel-agents is watch-only and tied to Claude Code hooks; Star-Office-UI art is non-commercial and the repo is stale; WorkAdventure is AGPL + Commons Clause and a full video platform; ai-town is bound to Convex; Claw3D is 3D and tied to OpenClaw.

## 2. Package boundary

`packages/office` is a standalone TypeScript package (Phaser 4, no React inside). `apps/web` mounts it in a `<canvas>` host and talks to it through a typed bridge:

```ts
// apps/web -> office
office.apply(event: OfficeEvent)        // agent.upsert, agent.status, agent.log, task.updated ...
office.focus(agentId)                    // camera pans to agent
office.setTheme("day" | "night")

// office -> apps/web
office.on("agent:tap", (agentId) => openAgentSheet(agentId))
office.on("task:drop", ({ taskId, agentId }) => assignTask(taskId, agentId))
office.on("desk:tap", (deskId) => openDeskInfo(deskId))
```

All panels, forms, logs and buttons are **DOM** (React), never drawn in the canvas. The canvas only shows the world.

## 3. The map

One office per **branch** (one branch per company), each a Tiled map (`office-<branch>.tmj`), 32 px tiles, about 48 x 32 tiles. Rooms are generated from the branch's departments using a room-template library, and any map can be hand-tuned in Tiled afterwards. Adding a department adds a room; adding an agent adds a desk in its department's room. A branch switcher sits above the canvas. Layers:

| Layer | Content |
|---|---|
| `floor`, `walls`, `decor` | Tiles (rendered with `TilemapGPULayer` for mobile performance) |
| `collision` | Walkability grid for pathfinding |
| `desks` (objects) | `deskId`, `role`, seat point, facing direction |
| `zones` (polygons) | `breakroom`, `approval_podium`, `library`, `workshop`, `bug_corner`, `meeting_room`, `server_room`, one `dept_zone_*` per department |

Rooms map to departments: Management office, Finance corner, Research desks, Operations bay, Data bay, Writing room, plus the shared zones above.

## 4. State to behaviour

| Agent state / event | What you see |
|---|---|
| `idle` | Walks to the breakroom, coffee loop |
| `working` | At desk, typing animation, small progress ring above head |
| `thinking` (model call in flight) | Typing slows, "..." bubble |
| `tool:brain.search` | Walks to the **library** shelf, returns |
| `tool:skills.manage` (writing a skill) | Walks to the **workshop** bench |
| `delegating` | Walks to the meeting room; child agents join, then disperse |
| `in_meeting` | Participants sit in the meeting room, speech bubbles alternate by turn; tap the room to open the live transcript |
| broadcast received | PA banner slides across the top of the canvas; targeted agents pause, show a "!" bubble, then an ack tick |
| `waiting_approval` | Walks to the **approval podium**, pulsing amber "!" bubble; badge count in the HUD |
| `error` | Red bubble, walks to the bug corner |
| `paused` / over budget | Sits at desk greyed out, "zz" bubble |
| `agent.log` | Speech bubble: max 1 per 3 s per agent, cut to 60 chars, fades in 4 s |
| `dream.completed` (nightly) | Office switches to night tint; one agent walks the library in the morning replay |

Pathfinding: BFS / A* on the collision grid (easystar.js or a pixel-agents-style BFS), recomputed only when the target changes. The server only sends the **target zone or desk**; the client animates the walk.

## 5. Interactions

| Gesture | Desktop | Mobile |
|---|---|---|
| Inspect agent | Click character | Tap character |
| Agent sheet | Side panel: current task, live log, instruct box, approve / deny if pending, pause / resume | Bottom sheet (Vaul), same content |
| Assign task | Drag a task card from the tray onto a character; agents whose role fits are highlighted | Long-press a task card to drag, or "Assign to" picker in the sheet |
| Move camera | Drag, wheel zoom | One-finger pan, pinch zoom |
| Zoom | Integer steps (1x, 2x, 3x) so pixels stay crisp | Same |
| Find agent | Roster strip at the bottom: tap avatar to fly the camera there | Same |
| Broadcast | Megaphone button on the HUD opens the composer with the audience picker | Same |
| Switch branch | Branch tabs above the canvas | Same |
| Accessibility | "List view" toggle shows the same state as a sortable table; full keyboard navigation of the roster | Same |

## 6. Assets

| Use | Pack | License |
|---|---|---|
| Default tiles, furniture and characters (committed) | Kenney **Roguelike Indoors** + JIK-A-4 **MetroCity** characters | CC0, free. The plan ships entirely on these (free-only constraint) |
| Optional art upgrade, only if ever wanted | LimeZu **Modern Interiors** + **Modern Office** (32 px) | Paid (about USD 4 total). Commercial use with credit, no redistribution; would live outside the repo |
| UI font in canvas | Pixelify Sans | OFL |

Pack textures into atlases (TexturePacker or free-tex-packer). One atlas for tiles, one per character set.

## 7. Performance budget

- `pixelArt: true`, `roundPixels: true`, device pixel ratio capped at 2.
- Target 60 fps desktop, 30 fps on a mid-range Android; drop to 15 fps when nothing moves.
- Pause the game loop on `visibilitychange` hidden; on return, pull `GET /api/events?since=<seq>` and apply.
- Handle WebGL context loss (rebuild textures).
- Max 40 animated characters on screen; beyond that, aggregate idle agents into a "breakroom crowd" sprite.
- Lazy-load `packages/office` as its own chunk so the dashboard does not pay for Phaser.

## 8. Theme

Day palette follows the app light theme, night palette the dark theme (tint pass over the tilemap). The HUD (roster strip, approval badge, task tray) is DOM using the app design tokens, so it matches the rest of the dashboard.

## 9. As built in P5 (2026-10-01)

Two changes from the plan, both to keep it small, free and testable:

- **Own Canvas 2D engine instead of Phaser 4.** It follows pixel-agents' approach: Canvas 2D,
  a BFS grid and a clean adapter boundary. A top-down office with up to 40 sprites does not
  need a game framework. The office chunk is 16.5 KB gzipped (Phaser alone is about 350 KB),
  there is no WebGL context loss to handle, and layout and pathfinding are unit-tested.
- **Pixel art drawn in code instead of Kenney/MetroCity packs.** Every tile, desk and character is
  original and drawn at 1 px per art pixel. Each agent's shirt uses its own colour, with skin
  and hair varied from its id, so there are no binary assets and no licences. `office/art.ts` is the
  only module to replace if a real art pack is ever wanted.
- **No Tiled file yet.** The map is generated from the branch's departments every time
  (`office/layout.ts`, deterministic). A hand-tuned Tiled map can be added later per branch.

| Piece | Where |
|---|---|
| Snapshot per branch: departments + each agent's state derived from tasks and approvals | `apps/api/agentic/api/routers/office.py` |
| Live signals: `agent.status` (now with `error`), `agent.thinking`, tool name on `task.event` | `apps/api/agentic/agents/runtime.py` |
| Map generation (rooms per department, shared places, collision grid) | `apps/web/src/office/layout.ts` |
| BFS pathfinding | `office/path.ts` |
| Tiles, furniture, character sheets | `office/art.ts` |
| Engine: camera, state machine, walking, bubbles, input, drag and drop, render loop | `office/engine.ts` |
| Page: company tabs, HUD, roster, task tray, agent panel, list view, broadcast banner | `apps/web/src/pages/office/` |

Rules that keep it honest and light:

- The snapshot is the truth (refetched on task and approval changes, and every 60 s); events only
  make the change immediate. Errands (library, workshop) last 6 s, then the agent goes back to
  what its state says. The only invented motion is idle agents drifting between breakroom seats.
- Zoom is in whole device-pixel steps, so pixels stay crisp; text is drawn in screen space, so
  it is sharp at every zoom.
- It draws every frame only while someone walks. Typing, bubbles and the podium pulse run at
  about 8 fps, and when nothing changes nothing is drawn.
- The engine folder may not import React or app code (an ESLint rule enforces it). The app talks
  to it through `createOffice()`: `setData`, `apply`, `focus`, `zoom`, `fit`, `setTheme`, `select`,
  `agentPosition`, plus `onAgentTap` and `onTaskDrop` callbacks.

Verified: layout tests (every agent gets a desk, every seat can reach every shared place,
deterministic), office API tests (state derivation, thinking and tool signals), and a run on the
full stack with 8 agents in every state, checked on desktop day and night and on a phone. In that
run, tapping a character opened its panel, and dragging a task card onto an agent assigned and
started the task, after which the agent walked to its desk.

