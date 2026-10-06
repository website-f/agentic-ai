# Make the VPS reach ePerolehan from your own IP

**Problem.** The VPS exits from a Contabo datacenter IP (84.46.249.133). Government portals
like ePerolehan block datacenter ranges wholesale, no matter how gently you browse. Your
local machine exits from a normal Malaysian ISP line (61.6.47.248) and is **not** blocked.

**Fix.** Route *only* ePerolehan (and the MDA register) out through a trusted proxy running on
a machine on your own line, reached over a private Tailscale tunnel. Those sites then exit
**your** business IP. Everything else on the VPS (AI providers, backups, WhatsApp) keeps
going out the datacenter directly.

```
Agent on VPS ─► browser ─► egress (VPS) ──[eperolehan.gov.my only]──► Tailscale tunnel
                                        └──[everything else]──► direct from 84.46.249.133
                                                                        │
                                              your office/home PC ◄──────┘
                                              (egress proxy) ─► exits your ISP IP
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
  see the Tailscale admin console. Call it `LOCAL_TS_IP`.

### 2. Run the exit proxy on your local PC
The proxy is the project's own egress image (already built locally as `agentic-egress:dev`).
Run it bound to the Tailscale IP so only your tailnet can reach it:

```bash
docker run -d --name eperolehan-exit --restart unless-stopped \
  -p LOCAL_TS_IP:3129:3128 \
  -e EGRESS_LOG_ALLOWED=true \
  agentic-egress:dev
```

Check it: `docker logs eperolehan-exit` should show a `start` line. It exits your ISP line
and refuses any non-public address, same as on the VPS.

> If Docker on Windows will not bind to `LOCAL_TS_IP`, bind to `0.0.0.0` instead
> (`-p 3129:3128`) and rely on Tailscale ACLs + the Windows firewall to keep it tailnet-only.

### 3. Point the VPS egress at it
In the VPS `.env` (`/opt/agentic-ai/.env`):

```
EGRESS_UPSTREAM=LOCAL_TS_IP:3129
EGRESS_UPSTREAM_HOSTS=eperolehan.gov.my,mda.gov.my
```

Then redeploy: `cd /opt/agentic-ai && ./deploy/scripts/deploy-vps.sh`

The VPS egress must be able to reach `LOCAL_TS_IP:3129`. If the egress container cannot use
the host's Tailscale interface directly, run Tailscale on the VPS host and the container
reaches the tailnet through it (the `edge`/`egress-out` network already allows outbound); if
needed, add the tailnet subnet as an allowed route.

---

## Check it worked
From the VPS, confirm the agent's ePerolehan traffic now exits your IP:

```bash
# direct (everything else) — still the datacenter:
docker exec agentic-egress-1 python -c "import urllib.request;print(urllib.request.urlopen('https://api.ipify.org',timeout=10).read().decode())"
```

Then run a "Prepare a tender" task from the VPS app and watch `docker logs eperolehan-exit`
on your local PC: you should see `allow` lines for `eperolehan.gov.my` as the agent browses,
which means that traffic left through your line.

## Turn it off
Clear `EGRESS_UPSTREAM` in the VPS `.env` and redeploy; stop the local proxy with
`docker rm -f eperolehan-exit`. ePerolehan traffic goes back to direct.

## Notes
- Keep your local PC on while the VPS is driving the portal; if the exit proxy is down, those
  sites simply fail (they do **not** fall back to the datacenter IP).
- Gentle pacing (`BROWSER_PACE_*`) still applies, so even from your own IP the agent stays at
  a human speed.
- If your IP is already blocked, pacing + your own IP usually clears it; a stubborn block
  lifts via the ePerolehan helpdesk (03-8882 3400 / helpdesk@eperolehan.gov.my).
