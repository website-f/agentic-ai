# P62: Web connections as one choice, and Allow on the computer itself

## Why
- **The proxy issue:** the Webshare proxies tested fine, but ePerolehan still showed its block
  page with the server's own address (84.46.249.133). The gateway had quiet fallbacks that sent
  a site out from this server instead of the chosen way:
  - with the approved-services lock on and "Web proxies" not approved;
  - when every proxy failed to open the connection (answered 409, "go direct");
  - with the computer's fallback set to "Go from the server" or "Use the proxies".
- **The computer issue:** turning a computer on needed `agentic-pc tunnel on` in a terminal. The
  Windows app has no console and puts no `agentic-pc` command on the PATH, so it could not work
  for most people.

## Settings > Web connections (owner)
**One choice:**
- **Browse from here** (the default): this server.
- **Browse through a computer:** one of the company's linked computers, for the listed sites
  (default `eperolehan.gov.my`). There is a switch to show the work on that computer's screen
  (P59).
- **Use your proxies:** the pasted list (Webshare's `host:port:user:password`), for the listed
  sites or every website. Test them shows the address sites see through each.

**The chosen way is used, or the site is refused with why.** There is no fallback to this
server.
- **The browser:** gets a 503 from the gateway.
- **The agent:** `browser_open` checks first (`tunnel.unavailable`) and says why, for example
  "Aina's PC is offline" or "the web proxies wait for an owner's approval", and is told to tell
  the person rather than try another way.
- **Unchanged:** a site that refuses or blocks a request never moves elsewhere.

**Check the connection** opens a site once, the way the agents' browsers would (through the
egress proxy with the workspace's credentials). It shows:
- which way it went;
- the proxy's address, if a proxy was used;
- the site's answer: opened, or refused, with the address the site says it saw (ePerolehan's
  block page shows it).

It is limited to one check every 8 seconds.

## Allow on the computer (PC agent 0.5.0)
1. The owner chooses a computer and saves.
2. The server sends `tunnel_ask` to that computer, and sends it again each time the computer
   connects, until its person allows it.
3. The agent opens its own status page there, at most once every 10 minutes for the same sites.
   The page shows who asks, which sites, and what passing them through means, with **Allow** and
   **Not now**.
4. **Allow** writes the setting. The agent reports it to the server, which then routes through
   the computer.
5. The same page shows the current state, with **Turn off**, or **Turn on** for the listed
   sites.

Nothing passes through a computer until its person presses Allow. The CLI
(`agentic-pc tunnel on|off`) still works.

**Older agents (before 0.5.0):** shown as "Needs the new app". Download the app again from My
computers and run it; it replaces the old one.

## API
- `GET /api/org/web`:
  - `{mode, sites, device_id, show}`;
  - `computers`, each with `allows`, `version` and `can_ask`;
  - `proxies`, with users masked;
  - `proxies_approved`.
- `PUT /api/org/web {mode, sites, device_id, show, proxy_list?}`:
  - returns the same, plus `asked`;
  - audited as `web.route`;
  - refuses `"*"` for a computer, a computer that is not the company's, and proxies with no list.
- `POST /api/org/web/ask`: asks the chosen computer again.
- `POST /api/org/web/check {site}` → `{way, why, via, proxy_ip, status, ok, blocked, seen_ip, says,
  error}`.
- The older endpoints (`/api/org/computers/tunnel`, `/api/org/proxies`) still work and update
  the same choice.

**Stored as:** the workspace setting `web_route` `{mode, sites}`.
- The computer's id and the show switch stay in `pc_tunnel`.
- The encrypted proxy list stays in `web_proxy`.
- Settings saved before P62 are read as the same choice: the computer's switch first, then the
  proxies.

**Config:** `AGENTIC_EGRESS_URL` (default `http://egress:3128`), used by Check.

## Staff computers
"ePerolehan through a computer" became a **Web connections** button. The old dialog is gone.
