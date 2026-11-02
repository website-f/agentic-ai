"""P57: a workspace's data, exported and erased (an NDA's return-or-destroy clause).

- inventory.py   where a workspace's data lives (tables, storage, vault, Valkey, Temporal)
- export.py      one ZIP of everything, on this server's disk, downloadable once
- erase.py       revoke, then delete everywhere, then verify; steps run on the worker
- certificate.py the deletion certificate (JSON + PDF) and its SHA-256
- models.py      workspace_exports (per workspace) and erasure_records (server level)
"""
