# Cloud file storage for photos and proof

Status (5 Nov 2026): **built in a draft PR, switched off.** No storage account is assumed to exist, and the API keeps
working exactly as before until the CEO completes the steps in section 4. No database migration is needed.

## 1. What it does

The app captures files itself: incident and site-visit photos from the in-app camera, proof documents (PDF, JPEG,
PNG) on cases, leave, SOCSO, FWM, hostel, claims and tenders, IT job proof, and clock-in pictures. Until now each
file was kept inside its database row as a data URL. That makes the database, its backups and every list query grow
with every photo.

Files move only for these records (`FILE_TABLES` in the code):

| Record | Holds |
|---|---|
| `evidencePhotos` | incident and site-visit photos |
| `evidenceDocs` | proof documents of every module (cases, leave, SOCSO, FWM, HR, hostel, claims, PDPA, vehicles, tenders) |
| `staffClocks` | clock-in and clock-out pictures |
| `itJobs` | proof that an IT job is done |

Files in other records stay in the row on purpose. The IT purchase, procurement and IT cleanup database rules hash
the stored record (`prima.ip_purchase_hash`, `prima.ic_hash`). A reference there would no longer match the hash
the service computes from the file, and those saves would be refused. A table joins the list only after checking
that no database rule reads its stored file values.

With `FILE_STORE=azure-blob`:

- **On save**, the API puts the file's bytes into one private Azure Blob container and keeps only a short reference
  in the row: `prima-file:v1:<record kind>/<company or group>/<sha256>.<jpg|png|pdf>`.
- **On read**, the API fetches the bytes, checks their SHA-256 against the name, and puts back the exact same data
  URL. Screens, permission checks and record fingerprints (the existing `sha256` of each photo) work unchanged.
- The **company wall is unchanged**: the row still lives in PostgreSQL under row-level security, so a person who cannot
  read the row never gets its reference, and the API never fetches the file.

What it does **not** do:

- It does not copy SharePoint files. SharePoint files are opened by link (staff usability rule 6). This store is only
  for what the app itself captures.
- It does not send alerts. Teams and email alerts are a separate change (`docs/ALERTS_TEAMS_EMAIL.md`).
- It does not move files already in the database. Old rows keep their data URL and stay readable. A one-off move
  can be added later with its own approval.
- It does not give browsers direct links to storage. Every file goes through the API, which has already checked the
  person's access.

## 2. Safety rules in the code (`apps/api/src/file-store.ts`)

| Rule | How |
|---|---|
| No keys or passwords | The API signs in to storage with its managed identity. No storage key or connection string exists. |
| Encrypted | Azure encrypts every blob at rest (AES-256, Microsoft-managed keys). The API talks to storage only over HTTPS, and every upload carries an MD5 checksum. |
| Write once | Files are named by the hash of their content and saved with `If-None-Match: *`. Nothing in the app overwrites or deletes a file. |
| Tamper check | Every read checks the SHA-256 of the bytes. A changed or missing file stops the request with a plain error. It never shows a different picture. |
| No forged references | A reference can only be made by the API. Any text from outside that starts with `prima-file:v1:` is refused (400) on every record. A reference in a record that is not on the list is never opened. |
| No cross-company reads | A reference only opens if its record kind and company match the row it sits in. A reference copied into another company's row does not open. |
| Save before link | The file is uploaded before the row is written, so a row never points at a missing file. A save that fails afterwards leaves only an unused file. |
| Fail closed at start-up | With storage switched on, the API in production first writes (once) and reads back a small check file. If it cannot, the API does not start. A wrong `FILE_STORE_CACHE_MB` also stops it. |
| Small things stay | Values under 2 KB, and anything that is not JPEG, PNG or PDF, stay in the row. |

Read speed: the API keeps recently read files in memory (64 MB by default, `FILE_STORE_CACHE_MB`, 0-1024). Names are
content hashes, so the cache never goes stale. A list fetches the files of all its rows together, eight at a time,
and the same file is fetched once. Screens that list every document of a company still fetch every file, as they
already read every file from the database today. Giving screens links instead of whole files is a later change.

## 3. Settings

| Variable | Value |
|---|---|
| `FILE_STORE` | `off` (default) or `azure-blob` |
| `FILE_STORE_ACCOUNT` | the storage account name, e.g. `<storage-account>` |
| `FILE_STORE_CONTAINER` | `evidence` (default) |
| `FILE_STORE_CLIENT_ID` | the client ID of the API's user-assigned managed identity (`<application-id>` form). Staging uses a user-assigned identity, so set it. |
| `FILE_STORE_CACHE_MB` | optional, whole number 0-1024, default 64 |

A wrong or half-filled setting stops the API from starting. It never quietly keeps files somewhere else.
`GET /api/health/files` returns `{ "files": "off" }` or `{ "files": "azure-blob" }`, and says nothing about where.

## 4. Switching it on (CEO, needs approval: creates an Azure resource and gives the API a new right)

Do these steps in Azure Cloud Shell only after approving. They are not run by any workflow in this repository.

1. **Storage account** in `rg-prima-staging-sea`, Southeast Asia: Standard, **LRS**, Hot. Security settings:
   public blob access **off**, **storage account key access off**, minimum TLS **1.2**, secure transfer required.
   **Infrastructure encryption on** (double encryption at rest, free, can only be chosen at creation). Soft delete
   for blobs **7 days**.
2. **Container** `evidence`, private (no anonymous access).
3. **Network**: allow access only from the Container Apps environment's virtual network (`snet-apps`) or, if that is
   not ready, from selected networks. Do not leave it open to all networks for real data.
4. **Access**: give the API's managed identity the role **Storage Blob Data Contributor** on the `evidence`
   container only (not the account, not the resource group). This is a new right for `id-prima-staging-app`, so it
   needs the CEO's explicit approval. The deploy identity gets nothing.
5. **Settings** on the API Container App: `FILE_STORE=azure-blob`, `FILE_STORE_ACCOUNT=<storage-account>`,
   `FILE_STORE_CLIENT_ID=<client ID of id-prima-staging-app>`.
6. **Check**: the new revision starts only if the check file can be written and read. Then
   `GET /api/health/files` shows `azure-blob`. Take one test photo on a synthetic case and confirm in the portal that a
   blob appeared under `evidence/evidencePhotos/<company>/`.

To switch off again, set `FILE_STORE=off`. Rows saved while it was on keep their references, so keep the storage
account and the role while any such row exists.

## 5. Cost

Blob Hot LRS is priced per GB stored plus a small fee per 10,000 reads and writes. At pilot volumes (a few GB,
tens of thousands of operations a month) this is expected to be well under USD 1 a month. That figure is an estimate,
not checked against the Southeast Asia price list. Confirm it with the Azure Pricing Calculator before switching on.
Moving photos out of PostgreSQL also keeps the B1ms database's 32 GB disk and its backups small.

## 6. Tests

- `apps/api/test/file-store.test.ts`: settings, photo round trip through the service, nested proof, updates and
  transactions, IT purchases left untouched, one fetch per file for a list, refused forged and moved references,
  tamper and missing-file errors, old rows, and the Azure REST calls (one shared token, write-once check) against a
  fake HTTP function. In-memory file backend, synthetic data only.
- `apps/api/test/file-store-pg.test.ts`: the same round trip through `Db.asUser` on local PostgreSQL as the restricted
  `prima_app` role with row-level security, plus the company wall refusing another company.

Not tested: a real Azure storage account, managed identity, or network rules. Those are proved only by step 6
above after the CEO switches the store on.

## 7. Later, with separate approval

- Move existing in-row files into storage (one-off, audited script).
- Optional lifecycle rule to move files older than 1 year to the Cool tier.
- Optional legal-hold / immutability policy on the container once retention periods are decided.
