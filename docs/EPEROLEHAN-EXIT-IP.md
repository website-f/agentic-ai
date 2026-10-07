# Make the VPS reach ePerolehan from your own IP

**Problem.** The VPS exits from a datacenter IP (`<VPS_IP>`). Government portals like
ePerolehan block datacenter ranges wholesale, no matter how gently you browse. A machine on
your own office/home line exits from a normal ISP address (`<HOME_IP>`) and is **not** blocked.

**Fix.** Route *only* ePerolehan out through a trusted proxy running on a machine on your own
line, reached over a private Tailscale tunnel. That site then exits **your** business IP.
Everything else on the VPS (AI providers, backups, WhatsApp) keeps going out the datacenter
directly.

```
Agent on VPS ─► browser ─► egress (VPS) ──[eperolehan.gov.my only]──► Tailscale tunnel
                                        └──[everything else]──► direct from <VPS_IP>
                                                                        │
                                              your office/home PC ◄──────┘
                                              (exit proxy, tailnet IP only,
                                               ePerolehan only) ─► exits <HOME_IP>
```

This is honest (it is genuinely you), safe (both ends are your own machines — no stranger in
the middle), and free (Tailscale personal plan, open-source clients). **Do not** use a rented
or "free" residential proxy: it would sit in the middle of your ePerolehan login and, later,
your digital-certificate signing — unacceptable for a government procurement account.

> **Simplest alternative:** run tender tasks from the **local** app (http://localhost:8500),
> whose IP is not blocked, and keep the VPS as the demo instance. No tunnel needed. Use the
> steps below only when you need the VPS itself to drive the portal.

---

## One-time setup

### 1. Tailscale on both machines (free)
- Install Tailscale on your **local PC** (the exit) and on the **VPS**, signed in to the same
  account: https://tailscale.com/download
- VPS: `curl -fsSL https://tailscale.com/install.sh | sh && tailscale up`
- Find your **local PC's** Tailscale IP (starts with `100.`): run `tailscale ip -4` on it, or
  see the Tailscale admin console. Below it is `<TAILNET_IP>`.
- Recommended: a Tailscale ACL that lets only the VPS reach `<TAILNET_IP>:3129`.

### 2. Run the exit proxy on your local PC

The exit proxy has no login of its own, so it must be reachable **only** over the tailnet and
may go **only** to ePerolehan:

- it is bound to `<TAILNET_IP>` and nothing else. **Never** publish it on `0.0.0.0` (all
  interfaces): on a LAN or a public line that is an open proxy for anyone who finds it;
- `EGRESS_ONLY_HOSTS` makes it refuse every destination except ePerolehan (and subdomains),
  on top of the usual refusal of private/internal addresses.

With Docker (the project's own egress image, built locally as `agentic-egress:dev`):

```bash
docker run -d --name eperolehan-exit --restart unless-stopped \
  -p <TAILNET_IP>:3129:3128 \
  -e EGRESS_ONLY_HOSTS=eperolehan.gov.my \
  -e EGRESS_ALLOW_PORTS=443,80 \
  -e EGRESS_LOG_ALLOWED=true \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  agentic-egress:dev
```

If Docker (e.g. Docker Desktop on Windows) will not bind to `<TAILNET_IP>`, do **not** fall
back to `-p 3129:3128`. Run the same proxy without Docker instead; it is one standard-library
Python file, and it listens on exactly the address you give it:

```bash
# from a checkout of this repo, Python 3.12+
EGRESS_LISTEN=<TAILNET_IP>:3129 EGRESS_ONLY_HOSTS=eperolehan.gov.my \
EGRESS_ALLOW_PORTS=443,80 EGRESS_LOG_ALLOWED=true python apps/egress/egress.py
```

(PowerShell: set the four variables with `$env:NAME = "value"` first.) Check it: the log shows
a `start` line with `listen` = `<TAILNET_IP>:3129` and `only_hosts` = `["eperolehan.gov.my"]`.
From another machine that is **not** on the tailnet, the port must not answer.

If the tender work also needs the MDA register, add `mda.gov.my` to `EGRESS_ONLY_HOSTS` here
and to `EGRESS_UPSTREAM_HOSTS` on the VPS. Add nothing else.

### 3. Point the VPS egress at it
In the VPS `.env`:

```
EGRESS_UPSTREAM=<TAILNET_IP>:3129
EGRESS_UPSTREAM_HOSTS=eperolehan.gov.my
```

Then redeploy: `./deploy/scripts/deploy-vps.sh` (from the install directory).

Both `https://` (CONNECT) and plain `http://` requests to those hosts go through the
upstream; neither ever leaves the VPS directly. The VPS egress trusts the upstream to do the
address checks for those hosts (it does not resolve them itself), which is why the upstream
must be this proxy, run as above, and nothing else.

The VPS egress must be able to reach `<TAILNET_IP>:3129`. Run Tailscale on the VPS host; the
egress container reaches the tailnet through the host (its `egress-out` network allows
outbound). If it cannot, add the tailnet subnet as an allowed route.

---

## Check it worked
From the VPS, confirm the direct path still exits the datacenter:

```bash
docker exec agentic-egress-1 python -c "import urllib.request;print(urllib.request.urlopen('https://api.ipify.org',timeout=10).read().decode())"
```

Then run a "Prepare a tender" task from the VPS app and watch the exit proxy's log on your
local PC (`docker logs eperolehan-exit`): you should see `allow` lines for
`eperolehan.gov.my` as the agent browses, which means that traffic left through your line.
Any other host shows a `deny` line with `host not in EGRESS_ONLY_HOSTS`.

## Turn it off
Clear `EGRESS_UPSTREAM` in the VPS `.env` and redeploy; stop the local proxy with
`docker rm -f eperolehan-exit` (or stop the Python process). ePerolehan traffic goes back to
direct.

## Notes
- Keep your local PC on while the VPS is driving the portal; if the exit proxy is down, those
  sites simply fail (they do **not** fall back to the datacenter IP).
- Gentle pacing (`BROWSER_PACE_*`) still applies, so even from your own IP the agent stays at
  a human speed.
- If your IP is already blocked, pacing + your own IP usually clears it; a stubborn block
  lifts via the ePerolehan helpdesk (03-8882 3400 / helpdesk@eperolehan.gov.my).
