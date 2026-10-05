"""Company documents that organise themselves (P24).

A person uploads a ZIP (folders kept), several files, or one file into a company. The office
then reads each file once (documents.service.process_file: text + OCR), scans it for secrets
and personal data, sorts it by kind and department, puts how-to material in the knowledge
library and reports what it did.

- `unpack`: safe ZIP reading (zip-slip, bombs, encrypted entries, junk, nested zips)
- `scan`: credentials and personal IDs in text (kinds, counts and pages only; never values)
- `sort`: kind and department from names, folders and first-page words, then the model's
  reading of the file (one extended `file.understand` call, no second call)
- `pipeline`: the batch: create files, read and sort each, build the report, call the
  builders' suggestions (`builders.py`, owned by the SOP/workflow builders)
"""
