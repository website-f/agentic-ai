"""P31: the PC agent, server side (docs/PC-AGENT.md is the contract).

A person links their own Windows or Mac computer with a one-time code; the PC keeps one
WebSocket open to the API (`hub`), and their own AI (their twin or private assistant) uses it
through `bridge` (agents/pc_tools.py). File bytes travel over HTTPS uploads and downloads kept
briefly in Valkey (`files`); a browser on the PC is driven over a CDP relay (`relay`).

- `core`: codes, tokens, names, folders, online state, activity log, who may use a PC.
- `hub`: the live PC sockets in this (API) process.
- `bridge`: calls to a PC from any process (the worker reaches the API's socket over HTTP).
- `relay`: pairs the PC's CDP socket with the browser service's.
- `install`: the install scripts with the server and code filled in.
"""
