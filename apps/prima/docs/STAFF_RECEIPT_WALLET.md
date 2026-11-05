# Staff receipt wallet and company head check

**Status (2 Nov 2026):** proposed on draft PR #49, branch `claude/project-thread-gmzh82`. Not merged, not deployed. No migration (receipts are `prima.evidence_docs` rows with two new JSONB fields, `walletOf` and `wallet`). Fauzan chose on 2 Nov 2026 to read receipts **on the phone, free**: no Azure service, nothing to set up or pay for.

## What Fauzan asked (2 Nov 2026)
> "staff can upload receipts when they get it, upload or phone camera scanner. Then system automatically read it. Staff have the power to push claim now or later. A place to store all receipt for claim. Hr and company head must be notify about the claim also to check or verify"

## How it works
1. **Keep.** On Claims > My claims > My receipts, staff tap **Scan with camera** (opens the phone's back camera) or **Upload file** (PDF, JPEG, PNG). Large photos are shrunk on the phone. The receipt is kept as the staff member's own; nobody else can see, confirm or remove it. The same file twice is refused.
2. **Read.** The phone reads the date, total, shop and kind (medical, dental, optical, check-up, toll, parking, hotel, fuel, other) from the photo before it is uploaded, then sends the figures with the photo. The server re-checks them (date not in the future or before 2000, amount above 0 and under RM1m, shop name cleaned, known kind) and stores them as a suggestion with low confidence (`by: 'phone'`); bad or missing figures mean "not read" and the staff member types them. A PDF is not read; staff type the figures. What the phone read is kept separately from what the staff member confirms.
3. **Confirm.** The staff member checks or corrects the figures ("These are right" / "Save the correction"). The reader never submits, approves or changes a claim.
4. **Claim now or later.** **Claim now** opens the claim form filled from the receipt. Or keep it for later: each receipt shows its last claim day (60 days from the receipt date, the existing rule) and the wallet warns when receipts have 7 days or less left. A receipt goes into one claim only; once claimed it no longer changes. A wrong photo can be removed with a reason (logged).
5. **HR and the company head.** Every new claim names its company head: the company manager of the staff member's company, or, for PWVSB central staff (or when no manager is found), their line manager. Never the claimant. The head and HR are told on their home screen. HR checks against the policy limits; the head verifies with a comment (a rejection, with a reason, ends the claim). Both happen in any order; the COO cannot approve until the head has verified. Finance then pays as before.

## The phone reader (chosen by Fauzan, 2 Nov 2026)
- Tesseract.js 6.0.1 (open source, Apache 2.0) runs in the browser. Its files are copied into the website at build time (`/ocr/`: worker, two WebAssembly cores, English language data), so the photo is never sent to another service to be read and no outside site is contacted.
- The first scan on a phone downloads about 7 MB once (then the browser keeps it). Reading takes a few seconds; it gives up after 60 seconds and the receipt is kept unread.
- The website's security policy now allows WebAssembly (`'wasm-unsafe-eval'` in `script-src`, `apps/web/public/staticwebapp.config.json`). No other policy change.
- Accuracy is lower than a paid service on crumpled or faded receipts, so every reading is only a suggestion the staff member confirms. Checked on 2 Nov 2026 with a rendered pharmacy receipt: date, RM42.50 total, shop and Medical were read correctly.
- The demo link keeps the file-name test reader.

## Code and tests
- `packages/core/src/receipts.ts` (reader interface, text parser, test reader), `service.ts` (`myReceipts`, `addReceipts`, `saveReceiptRead`, `receiptAction`, `headVerifyClaim`, `claimNotices`, wallet receipts in `submitStaffClaim`).
- `apps/web/src/ocr.ts` (phone reader), `apps/web/vite.config.ts` (copies the reader files), API routes `GET/POST /claims/receipts`, `POST /claims/receipts/:id/confirm|remove`, `POST /claims/:id/head`.
- `apps/web/src/views/Claims.tsx` (wallet, camera, claim now, head verify).
- Tests: `packages/core/test/receipts.test.ts`, `apps/api/test/receipts.test.ts` (PostgreSQL, restricted login; phone figures kept, bad figures refused).
