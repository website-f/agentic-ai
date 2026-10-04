"""Knowledge library (P18): SOPs, guidelines, manuals and policies people upload become
searchable passages that agents read and cite.

- `chunker.chunk_text`: split a document's text into passages (headings, pages, tables kept)
- `indexer`: rebuild a source's passages (`index_file`, `index_sop`, `remove`, `reindex`)
- `search`: hybrid keyword + meaning search, scoped to what the reader may see
"""
