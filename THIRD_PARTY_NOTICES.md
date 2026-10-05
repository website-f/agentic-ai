# Third-party notices

Every code lift from an upstream project is recorded here with project, license, upstream commit, and the files it became.

| Project | License | Upstream commit | Our files |
|---|---|---|---|
| CrawlOps AI gateway (own code) | internal | n/a | `engine/gateway.py` (routing, cooldowns, reasoning retry), `engine/client.py`, `core/ssrf.py` (SSRF guard), stored-key URL pinning in `api/routers/ai_engine.py` |
| dataviz skill reference palette | bundled skill | n/a | `--series-1..8` tokens in `apps/web/src/styles.css` |
| Hermes Agent (Nous Research) | MIT | 5c975b9 (2026-10-02) | Algorithms, patterns and prompt ideas re-implemented, no code copied verbatim. P12: `agents/context.py` (tool-result pruning, structured checkpoint with iterative update, anchor index, cache-stable cut points), `skills/reflect.py` (lesson placement order, correction signal, do-not-capture rules, cadence trigger), `skills/store.py` (stale skills named only in the index), memory guidance in `agents/tools.py`. P13: `core/threats.py` (injection/exfil scanner), `agents/goals.py` (goal loop), `agents/websearch.py` (multi-backend search), `agents/vision.py` (vision), `agents/mcp.py` + the tool_search/describe/call bridge (MCP client, lazy tool loading), `apps/sandbox/` + `agents/codetool.py` (isolated code execution). Copyright (c) 2025 Nous Research. |
| Crawl4AI (UncleCode) | Apache-2.0 | main (2026-10-05) | Algorithms re-implemented, no code copied verbatim. `agents/extract.py`: pruning content filter (composite block score: text density, link density, tag weight, class/id penalty, log text length; threshold with dynamic fallback; minimum word count), BM25 content filter with priority-tag (heading/bold) boosts, markdown with numbered link citations and a reference list. `agents/research_tools.py`: adaptive crawling ideas (key-term coverage, saturation stop, confidence threshold, best-first link scoring on anchor + surrounding text). Required attribution below. |
| agent-browser (Vercel Labs) | Apache-2.0 | main (2026-10-05) | Ideas only, no code copied: markdown-first page reads (`Accept: text/markdown` negotiation) and `/llms.txt` site overviews in `web_fetch` (`agents/tools.py`). Copyright Vercel, Inc. |

## Required attributions

This product includes software developed by UncleCode (https://x.com/unclecode) as part of the Crawl4AI project (https://github.com/unclecode/crawl4ai).
