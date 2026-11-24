# DEMO global admin (test version only)

Fauzan, 23 Nov 2026: "Create a global admin global user DEMO to see how the system works".

## What it is

On the sign-in screen of the **test version** (the single-file build made with `npm run demo:build`), a red card
**DEMO global admin** opens the system as the CEO with every made-up person able to sign in. A red bar at the top of
every screen then has a **View as** list of all made-up people, grouped by group leadership, each central department,
company managers, company admin executives, supervisors, guards and site devices. Picking a person shows exactly what
that person sees, under that person's own rules. **Back to CEO** returns to the CEO; **Leave demo admin** closes it and
puts the IT pilot sign-in list back.

## What it is not

- Not a new account, role or permission. Nothing in `packages/core` changed; every screen still checks the chosen
  person's own access.
- Not in the real system. The code is behind `__DEMO__`, which is `false` in the server-connected build, and the server
  build uses `HttpApi`, which has no demo sign-in. It cannot become a way into real data.
- In this browser only. The choice is kept in this browser's storage (`prima-demo-global-admin`,
  `prima-demo-all-staff`); made-up data changes stay in this browser, and **Reset data** starts again.

While it is on, the IT pilot limit is lifted in the test version, so the CEO and others see the system as it will run
after every department joins.

Database modules needed: none.
