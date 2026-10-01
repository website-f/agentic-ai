# Third-party notices

Every code lift from an upstream project is recorded here with project, license, upstream commit, and the files it became.

| Project | License | Upstream commit | Our files |
|---|---|---|---|
| CrawlOps AI gateway (own code) | internal | n/a | `engine/gateway.py` (routing, cooldowns, reasoning retry), `engine/client.py`, `core/ssrf.py` (SSRF guard), stored-key URL pinning in `api/routers/ai_engine.py` |
| dataviz skill reference palette | bundled skill | n/a | `--series-1..8` tokens in `apps/web/src/styles.css` |
