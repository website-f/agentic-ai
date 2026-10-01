# Frontend

## 1. Design read

**Reading this as:** an agent operations console for a small team who live in it all day and check it on their phones between meetings. Calm, precise, slightly playful because of the pixel office, leaning toward **shadcn/ui on Tailwind v4 + Motion**, customized so it does not look like a stock template.

Dials (taste-skill scale): `DESIGN_VARIANCE 4` (product UI, predictable grids), `MOTION_INTENSITY 5` (state changes animate, nothing loops for show), `VISUAL_DENSITY 6` (dashboards need data, phones need breathing room).

The taste skill treats dashboards as out of its main scope, so we take its guardrails (dark mode protocol, icon rules, motion rules, copy rules, no AI tells) and use a real component foundation (shadcn/ui + Radix) for the product surfaces.

## 2. Tokens

One accent, locked across the whole app. Neutrals are cool with a slight green bias so they belong to the accent.

```css
:root {
  --bg:            #f6f8f7;
  --surface:       #ffffff;
  --surface-2:     #eef2f0;
  --border:        #d9e1dd;
  --text:          #121a17;
  --text-muted:    #5a6762;
  --accent:        #13895f;   /* jade */
  --accent-fg:     #ffffff;
  --accent-soft:   #dff2ea;
  --ok:            #1e8a4c;
  --warn:          #b7791f;
  --danger:        #c2412d;
  --info:          #2f6db5;
  --radius-sm: 8px;    /* inputs, chips */
  --radius-md: 12px;   /* cards, sheets */
  --radius-lg: 16px;   /* dialogs */
  --font-sans: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}
[data-theme="dark"] {
  --bg:          #0d1210;
  --surface:     #141b18;
  --surface-2:   #1b2420;
  --border:      #26322d;
  --text:        #e6ece9;
  --text-muted:  #93a39c;
  --accent:      #35c48c;
  --accent-fg:   #06130d;
  --accent-soft: #123426;
}
```

- Theme follows `prefers-color-scheme` by default, with a manual toggle (light / dark / system) stored per user.
- Semantic colors (ok / warn / danger / info) are only for state, never decoration.
- Radius rule: inputs and chips 8, cards and sheets 12, dialogs 16, status pills fully rounded. No exceptions.
- No pure black or pure white, no glows, no gradient text, no purple.

## 3. Typography

- Geist Sans for UI, Geist Mono for IDs, tokens, costs, code. Self-hosted (Fontsource), `font-display: swap`.
- Scale: 12 / 13 / 14 (body) / 16 / 20 / 24 / 32. Headings weight 600, body 400.
- All numbers in tables and stats use `tabular-nums`.
- Pixelify Sans only inside the office canvas.

## 4. App shell

| Width | Navigation | Layout |
|---|---|---|
| < 768 px (phone) | Bottom tab bar: **Office, Tasks, Approvals, Chat, More**. Approval tab shows a count badge | Single column, bottom sheets for detail, sticky action bar above the tab bar, safe-area insets respected |
| 768-1279 px (tablet) | Collapsible icon rail | Two panes where useful (list + detail) |
| >= 1280 px (desktop) | Full sidebar with workspace switcher, sections, pinned agents | Three panes on Tasks and Brain (list / detail / context) |

Global: command palette (Ctrl/Cmd+K) for every page, agent and action; **broadcast composer** (megaphone button) with an audience picker (all / branches / departments / agents) and ack tracking; branch switcher; notifications drawer; theme toggle; user menu.

## 5. Pages

| Page | Purpose | Key components |
|---|---|---|
| **Office** | Live pixel office | Phaser canvas, roster strip, task tray, approval badge, agent bottom sheet / side panel |
| **Command center** | Today at a glance | Live agent grid (status pills), pending approvals, running tasks, spend today vs budget, provider health, latest dream diary |
| **Agents** | Roster by branch and department | Branch switcher; department cards with their agents and SOPs; org chart (React Flow) with drag to change manager or department; **agent builder wizard** (placement, identity, soul, skills + SOPs, model / tools / budget) with prompt preview; agent detail tabs: Profile (SOUL.md editor), Model, Tools and permissions matrix, SOPs, Memory (core + recent facts), Skills, Budget, History |
| **Tasks** | Work tracking | Kanban (dnd-kit) with columns triage / ready / running / blocked / review / done; list view (TanStack Table); timeline; task detail with live trace, child tasks tree, outputs, approvals |
| **Approvals** | Decide fast | Inbox list with swipe right approve / left deny on mobile; card shows action, args preview, risk, rule; once / always / deny |
| **Chat** | Talk to any agent | Streaming messages, tool-call chips that expand, `/model` switcher, attachments, "make this a task" |
| **Meetings** | Watch agents discuss | Live transcript with turn-by-turn stream, participants bar, round counter and token budget, interject box, outcome card (decision, options, owners) saved to the Brain |
| **Broadcasts** | Announcements and directives | History list; detail view with per-agent delivered / acked / replied receipts; resend to non-ackers |
| **Brain** | Second brain | File tree, CodeMirror markdown editor with live preview and `[[link]]` autocomplete, backlinks panel, graph view (sigma.js), hybrid search with citations, facts table with validity, Dream diary review (accept / revert changes) |
| **Skills** | Learned procedures | Library with trust tier and success rate; Proposals queue with side-by-side diff, scan + eval results; Health tab |
| **Schedules** | Recurring work | Schedule list, cron builder, execution ledger with states and retry history, incident groups |
| **AI Engine** | Providers and spend | See AI-ENGINE.md section 9 |
| **Channels** | Telegram, web push, API tokens | Bindings table (channel to agent), delivery ledger |
| **Activity** | Audit | Virtualized, filterable log of every action by humans and agents |
| **Settings** | Workspace, members and roles, notifications, appearance, backups | |

## 6. Advanced components (and where they are used)

| Component | Library | Used in |
|---|---|---|
| Command palette | cmdk | everywhere |
| Kanban with drag | dnd-kit | Tasks |
| Drag task onto agent | dnd-kit + office bridge | Office, Agents |
| Org chart / workflow graph | @xyflow/react | Agents, task delegation tree |
| Knowledge graph | sigma.js + graphology | Brain |
| Markdown editor | CodeMirror 6 + react-markdown | Brain, SOUL.md, skills |
| Diff viewer | @git-diff-view/react | Skill proposals, dream diary |
| Data grid | TanStack Table + Virtual | Usage, Activity, facts |
| Charts | Recharts with tokens (area, bar, sparkline) | AI Engine usage, Command center |
| Live log stream | Virtualized list, auto-scroll lock, level filters | Task detail, agent sheet |
| Trace waterfall | custom (div bars on a time scale) | Task detail |
| Bottom sheets | Vaul | all detail views on mobile |
| Toasts | Sonner | confirmations ("Approved", "Task assigned") |
| Step list with live status | custom + Motion | Test connection, task progress |
| Cron builder | custom form + human-readable preview | Schedules |
| Broadcast composer | custom sheet + cmdk audience picker | global shell |
| Meeting transcript | virtualized stream + Motion turn highlights | Meetings |
| Skeleton loaders | shaped per component | everywhere |

## 7. States (every view ships all four)

- **Loading:** skeletons shaped like the final layout. No spinners except inside buttons.
- **Empty:** what will appear and the one action to create it ("No agents yet. Create your first agent").
- **Error:** inline, says what failed and how to fix it, with a retry button.
- **Partial / stale:** banner when the SSE stream is reconnecting ("Reconnecting. Showing data from 12:04").

## 8. Motion

- Spring transitions (`stiffness 300, damping 30`) for sheets, cards entering, kanban moves (`layout` animations).
- Status pill color changes cross-fade; progress rings animate value changes.
- Button press: `scale(0.98)`.
- Nothing loops except real live indicators (running task pulse, office).
- Everything respects `prefers-reduced-motion` (Motion `useReducedMotion`, office drops to static positions).

## 9. Copy rules

- Name things the way users think: "Approvals", "Skills", "Brain", not "HITL gates" or "procedural memory".
- Buttons say exactly what happens: "Approve", "Test connection", "Assign to Researcher".
- Errors explain the fix. No apologies, no "Oops".
- No em dashes in UI copy. No filler verbs ("elevate", "seamless", "unleash").

## 10. PWA

- `vite-plugin-pwa` in `injectManifest` mode with our own service worker.
- Local-first testing: `localhost` is a secure context, so install and push work on the dev machine without HTTPS; for a phone on the same network, Tailscale's free HTTPS serve (or mkcert) provides the secure origin. No domain needed until the stack goes public.
- Manifest: `display: standalone`, theme color from `--surface`, maskable icons, shortcuts (Approvals, New task, Office).
- Offline: app shell + last snapshot cached; actions queue is **not** offline (approvals must reach the server live).
- Push: VAPID Web Push. Permission asked only from a user tap in Settings or after the first approval.
  - Android / desktop Chromium: notification actions **Approve** / **Deny** call the API from the service worker with a single-use signed token (scoped to that approval, 10 min expiry), then show a confirmation notification.
  - iOS (16.4+, installed to Home Screen only): no action buttons; tapping opens `/approve/<id>`, a one-screen page with large buttons. Declarative Web Push payload added for iOS 18.4+.
  - Badge API set to the number of pending approvals.
  - Re-subscribe on every app open; prune subscriptions that return 404/410.
- Background: pause SSE and the office loop when hidden; on resume, replay from `since=<seq>`.
- Capacitor wrap (reusing the existing APK pipeline) only if iOS push limits become a real problem.

## 11. Accessibility and performance

- WCAG AA contrast in both themes, visible focus rings, full keyboard support, 44 px touch targets.
- Office has a list-view equivalent.
- Route-level code splitting; office, graph view, editor and charts are lazy chunks.
- Budgets: initial JS under 200 KB gzip for the shell; LCP under 2.5 s on 4G; INP under 200 ms.
- Playwright e2e runs on desktop and on iPhone / Pixel viewports in CI.
