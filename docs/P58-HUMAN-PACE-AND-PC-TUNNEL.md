# P58: the agent's browser at a person's pace, and ePerolehan through a company computer

## At a person's pace (apps/browser/service.py)
Each agent has its own browser machine on the server: its own profile, screen and stay-signed-in
cookies, like its own computer. What it does there is done the way a person does it:

- **Typing:** the agent clicks into the field first (new), then types key by key with an uneven
  rhythm, a beat after words and punctuation, and the odd typo it backspaces at once. The final
  text is always exact.
  - Saved passwords are the one exception: they go in whole into the marked password field, so
    their keystroke timing can never leak.
- **Clicking:** one click at a time across all agents. Before each click the cursor moves along a
  curved path to the element, overshoots slightly, settles, hovers and pauses.
- **Dropdowns and tick boxes (new):** the cursor goes there first. A tick box gets a real click
  rather than being set directly.
- **Between fields (new):** a short pause, 0.25 to 0.8 seconds (`BROWSER_HUMAN_THINK_MS_MIN/MAX`).
- **Scrolling:** a few small wheel steps.
- **Pacing:** at least 2.5 seconds, plus a random extra, between actions that reach the site's
  server. At most 20 such actions a minute.

The browser does not fake fingerprints, solve CAPTCHAs or use borrowed or rotating proxies.
Submitting a form or uploading a file always waits for a person's approval.

## ePerolehan through a company computer
**Why:** the portal sees the office's own internet line, like staff logging in themselves, instead
of this server's datacenter address.

**How it works:**
1. The agent's browser stays on the server and sends ePerolehan's traffic to the egress proxy as
   always.
2. For the chosen sites, the egress proxy asks the browser for its workspace's signed proxy
   credentials (407). Pages cannot set or read them. It then hands the connection to the gateway
   in the API (`devices/tunnel.py`, port 3130 on the browser network).
3. The gateway checks four things:
   - the workspace turned this on, for this site;
   - its chosen company computer is online and not paused;
   - the computer's own person allowed the site there (`agentic-pc tunnel on eperolehan.gov.my`).
4. If all hold, it asks the computer to open the connection (`net.open`) and relays the bytes both
   ways.
5. TLS stays between the server's browser and the portal, so the computer passes encrypted bytes
   and cannot read them.

**When it cannot go through the computer:**
- Off, another site, or the computer is unavailable with "Go from the server" chosen: traffic goes
  out directly as before.
- The computer is unavailable with "Wait for it" chosen (the default): it is refused, and the
  agent is told why ("Aina's PC is offline").

**On the computer (PC agent 0.4.0):**
- `agentic-pc tunnel on [sites]` or `agentic-pc tunnel off`, and status shown on its status page.
- Only the listed sites pass, on port 443 only, with at most 24 open at once.
- Pausing or turning it off closes open connections at once.
- Each connection is logged on the computer with its size and length, never its content.

**In the app:** Staff computers > **ePerolehan through a computer** (owner):
- an on/off switch;
- which computer, showing whether it is online and whether its person allowed the sites;
- the sites;
- what happens when that computer is off: Wait for it, or Go from the server.

Changes are audited (`devices.tunnel`).

**Setup:**
- compose: `AGENTIC_PC_TUNNEL_LISTEN=0.0.0.0:3130` on the API, and
  `EGRESS_PC_TUNNEL=api:3130` with `EGRESS_PC_TUNNEL_HOSTS=eperolehan.gov.my` on the egress proxy.
- The computer needs PC agent 0.4.0. Re-download it from My computers.

Migration `0044_pc_tunnel` (`devices.tunnel_hosts`).

## P59: the site budget, and watching the work on the computer

### The site budget (apps/browser/service.py)
A portal such as ePerolehan (`BROWSER_BUDGET_HOSTS`) is used the way one person at a desk uses it.
The budget is counted per company, across all its agents, since they share one address:
- **Sittings and breaks:** after 25 minutes of activity (`BROWSER_BUDGET_SITTING_MIN`), a break of
  4 to 10 minutes. Six quiet minutes start a new sitting.
- **Caps:** at most 90 actions on the site an hour (`BROWSER_BUDGET_PER_HOUR`) and 500 a day
  (`BROWSER_BUDGET_PER_DAY`).
- **Office hours:** 07:30 to 22:00 Malaysia time (`BROWSER_BUDGET_HOURS`, `BROWSER_BUDGET_TZ`).

Over the budget, the action is not done, and the browser says how long to rest:
- **30 seconds or less:** the worker waits it out inside the call.
- **Longer:** the task rests. The agent reads "Paused on the site: a short break... Resumed at
  14:32. Carry on where you were", the task's history records the rest, and the task workflow
  sleeps that long (`site-rest-v1`) before carrying on. A cancel still stops it at once.
- A rest never counts as a browser error.

### Watching it on the computer
In Staff computers > ePerolehan through a computer, **Show the work on that computer's screen** is
on by default.

- **When it applies:** a task that works only on the chosen sites, such as an ePerolehan task.
- **What happens:** the task opens its browser as a real Chrome or Edge window on the chosen
  computer, through the existing CDP relay. The person there watches every step; the human-pace
  layer and the site budget still apply. The traffic naturally leaves from that computer's own
  connection.
- **Other tasks**, and the switch turned off, stay on the server's browser.
- **One task at a time** uses the window, like a person.
- **Consent:** the computer opens it only for sites its own person let through (`agentic-pc tunnel
  on`, checked on the computer). Unlike "browse on my computer", this works for any of the office's
  agents, but only for those sites.
- **When the computer is unavailable:** with "Wait for it", the agent is told why. With "Go from the
  server", it uses the server's browser.

## P60: Web connections (this server, a company computer, your proxies)
**Where:** Settings > **Web connections** (owner).

The agents' browsers reach websites one of three ways:
1. **This server**, which is always available.
2. **A company computer**, for chosen sites such as ePerolehan (P58/P59).
3. **The company's own proxies:** a pasted list, one per line, `host:port:user:password` (Webshare's
   format) or `http://user:password@host:port`.
   - The list is stored encrypted in the workspace's settings, and the passwords are never shown
     again.
   - **Test them** shows which proxies answer and the address sites see through each.

**Routing, done by the gateway (`devices/tunnel.py route`) for every new connection, so a change
applies at once:**
- The company computer's sites go through it.
- With proxies on, their sites go through them: every other site, or only listed ones.
- Everything else goes from this server.

**When a way out is down:**
- If the computer is offline or paused, its setting decides: wait, use the proxies, or go from the
  server.
- Each site keeps one proxy (sticky per workspace and site). One that does not answer is set aside
  for 10 minutes and the next one is used. If none answers, the connection goes from the server.

**What never happens:** switching to another way out because a site refused or blocked a request.
Connections switch only when a way out itself cannot connect.

**Under the hood:** the egress proxy now offers every https site to the gateway
(`EGRESS_PC_TUNNEL_HOSTS=*`), after its public-address check. A site that is not routed goes out
directly to the address the check approved.

**Approved services:** the proxy list appears on Approved services as "Web proxies". With the lock
on, it is used only once approved.

Plain `http://` pages, and the agents' non-browser web tools (web_search, web_fetch), still go from
this server.
