# Running on a 4 GB VPS (P14, 2026-10-03)

The whole office (web, api, worker, Temporal, Postgres, Valkey, backups, code sandbox and the
local backup model) fits a 4 GB / 2 vCPU server with the `docker-compose.small.yml` overlay.

## 1. Swap first

A burst (several uploads being read at once, a big document export) can briefly pass 4 GB.
Swap turns that into a slow minute instead of the kernel killing a container.

```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.d/99-swap.conf
```

## 2. Start

```sh
docker compose -f docker-compose.yml -f docker-compose.vps.yml -f docker-compose.small.yml up -d --build
```

`ollama-pull` downloads `qwen3:0.6b` (522 MB) once into the `ollamadata` volume. On first use each
workspace registers it as the provider **Local backup**: the `local` model group, and the last
member of `fast`.

## 3. Measured memory (dev PC, small overlay, the help demo running)

| Service | Peak | Limit |
|---|---|---|
| ollama (qwen3:0.6b loaded, 4096 context, 8-bit attention cache) | 921 MiB | 1152 MiB |
| api (includes the ~300 MB embedding model) | 744 MiB | 900 MiB |
| worker | 718 MiB | 1 GiB |
| temporal | 183 MiB | 448 MiB |
| postgres | 147 MiB | 640 MiB |
| sandbox, web, backup, valkey | 73 MiB together | |
| **Whole stack** | **2.79 GB** | |

That leaves about 1 GB for the OS, Docker and the shared Caddy.

## 4. What the overlay changes

- **Browser is opt-in.** It idles at ~0.5 GB and grows to 1 GB per two agents. With
  `AGENTIC_BROWSER_URL` empty, agents are not offered browser tools at all (no prompt tokens).
  To turn it on: `AGENTIC_BROWSER_URL=http://browser:8600` in `.env`, then add
  `--profile browser` (one Firefox, two agents at once).
- **Temporal UI** only with `--profile ops`; reach it over an SSH tunnel.
- **4 agent steps at once** instead of 16 (`AGENTIC_WORKER_MAX_ACTIVITIES`); more tasks queue
  in Temporal and run in turn.
- Postgres `shared_buffers` 128 MB, Valkey 64 MB, Temporal `GOMEMLIMIT` 320 MiB.
- Every CPU limit fits 2 vCPUs; Docker refuses a container limit above the host's core count.

## 5. The local backup model

Chosen by measurement (`small_llm_eval`, CPU only): `qwen3:0.6b` is the smallest model that
reliably picks the right note, returns valid JSON and writes a usable file summary. It runs
with thinking off (`reasoning_effort: "none"`: 120 → 3 output tokens for "say hi").

| Job | What it does | Cloud fallback |
|---|---|---|
| `colleague.memory` | Picks the numbered note that answers a colleague question; the note is quoted verbatim, never rewritten | `fast` |
| `file.understand` | One-paragraph summary + kind of each upload | `fast` |
| `browser.digest` | Short digest of a long page | `fast` |
| Chat backup mode | When every cloud model in an agent's group is down, the agent still answers chat (no tools, prefixed with a notice) | none |

It **never runs tasks or drives tools**: in tests a model this small obeyed instructions
hidden in a web page. Expect 10-30 s per side job on 1.5 CPUs; they run in the background
of a task, so nobody waits on a screen for them.

To switch it off, set `AGENTIC_LOCAL_LLM_URL=` (empty) and skip the `ollama` service.
