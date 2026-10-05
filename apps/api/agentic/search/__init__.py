"""P25: search inside every document a company has.

- `text`: how text and queries become words (amounts, dates, codes, Malay roots) and how
  snippets get their <mark>s
- `models`: search_passages, search_headings, search_sources (migration 0026)
- `index`: keep them in step with files, SOPs, documents, templates and wiki pages
- `viewer`: who may find what (the rules of the pages that open each result)
- `engine`: the ranked search (people: /api/search; agents: search_documents)
- `vocab`, `suggest`: suggestions as people type, and their recent searches

`python -m agentic.search reindex [--workspace ID]` rebuilds the index (after a deploy).
"""
