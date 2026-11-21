# GSTBridge

Turns Amazon, Flipkart and Meesho sales reports into a **GSTR-1 JSON** (upload on the GST portal → Returns →
GSTR-1 → Prepare Offline → Upload) and the same data in the **official GSTN offline-tool Excel workbook**.
Sales files are processed in the browser and never uploaded. Downloads cost **₹99 per GSTIN per return month**
(Razorpay); preview, validation, error report and PDF summary are free.

## Run locally

```sh
npm install
npm run dev          # UI only. Payments show "Simulate payment (development only)".
npm run worker:dev   # UI + payment endpoints in Cloudflare's runtime (needs .dev.vars, see below)
```

## How a return is built

1. **Upload** one or more files for the month (e.g. Amazon MTR B2C **and** MTR B2B; Meesho `tcs_sales` **and**
   `tcs_sales_return`). Known layouts are detected and get derived `GSTBridge: …` columns (document type,
   combined GST rate, credit-note number/date, TCS, cess). Anything else is mapped on the column-mapping screen.
2. **Rows left out automatically:** cancelled orders, zero-value rows, and rows whose seller GSTIN differs from
   the GSTIN you entered (multi-state FBA sellers file one return per GSTIN).
3. **Classification:** registered buyer → B2B (4A). Unregistered inter-state invoices above the B2CL limit
   (₹1 lakh from Aug 2024, ₹2.5 lakh before), judged on the **whole invoice** → B2CL (5). Everything else → B2CS (7).
   B2C refunds/credit notes are **netted into B2CS** (GSTN instruction); notes on B2CL invoices go to CDNUR,
   registered-buyer notes to CDNR (9B).
4. **One model, two files.** `src/gst-engine/gstr1Builder.ts` builds a single GSTR-1 model. The JSON
   (`jsonExporter.ts`) and Excel (`excelExporter.ts`) are both written from it, so they always match. Tax is
   computed as rate × taxable value (CGST = SGST = half), exactly as the offline tool computes it from the
   workbook; marketplace-reported tax is used to catch wrong rate/column mappings.
5. **HSN (12)** is split into B2B/B2C, keyed by HSN + rate + UQC. **Table 13** can be auto-filled from the
   document numbers in the file. **Table 14** uses the operator GSTIN/name you enter.
6. **Blockers** (anything that would make the portal reject the file) disable payment and downloads, so a user
   never pays for a file that cannot be uploaded.

Not supported yet (they block export with a clear message): exports, SEZ, deemed exports, nil/exempt,
amendments, advances, and combining two marketplaces in one return.

## Payments (₹99) — Razorpay + Cloudflare Pages Functions

- `functions/api/create-order.ts` creates a ₹99 Razorpay order tagged with the GSTIN and period.
- `functions/api/verify-payment.ts` checks the Checkout signature, then confirms with Razorpay that the payment
  is captured/authorized, for the full amount, and for that GSTIN and period. Secrets stay on the server.
- `src/payments/payment.ts` runs Checkout and stores the receipt in the browser. One payment unlocks JSON +
  Excel for that GSTIN + month (re-downloads and corrections free).

Because files are processed in the browser, a technical user could bypass the paywall by editing the page's
JavaScript. Moving JSON generation to the server would close that gap but means sales data leaves the device.

### Setup

1. Create a Razorpay account and complete KYC. Razorpay checks your website before activating live mode, so fill
   in the `[BRACKETED]` details in `public/policies.html` (contact, terms, privacy, refunds) first.
2. Razorpay Dashboard → Account & Settings → API Keys → generate **test** keys first.
3. Local test: copy `.dev.vars.example` to `.dev.vars`, paste the test keys, run `npm run pages:dev`, and pay
   with a Razorpay test card/UPI.
4. Cloudflare Pages → your project → Settings → Variables and Secrets: add `RAZORPAY_KEY_ID` (plain text) and
   `RAZORPAY_KEY_SECRET` (**Secret**) for Production. Redeploy. Switch to `rzp_live_…` keys when ready.

## Deploy (free) — Cloudflare Worker or Pages

The repo works either way:

- **Worker** (`*.workers.dev`, what Cloudflare's "Import a repository" creates): uses `wrangler.jsonc` and
  `worker/index.ts`, which serves `dist/` and routes `/api/create-order` and `/api/verify-payment`.
  Worker → Settings → Build: build command `npm run build`, deploy command `npx wrangler deploy`,
  root directory `/`. The Worker's name in the dashboard must be `gstbridge` (same as in `wrangler.jsonc`).
- **Pages** (`*.pages.dev`): framework preset Vite, build command `npm run build`, output `dist`.
  The `functions/` folder is deployed automatically.

Then add `RAZORPAY_KEY_ID` (Text) and `RAZORPAY_KEY_SECRET` (Secret) under Settings → Variables and Secrets,
and redeploy. Local test of the Worker: put test keys in `.dev.vars` and run `npm run worker:dev`.

## Before relying on it

- Marketplace column layouts were written from their published report formats, not from your real files.
  Run one real month per marketplace and compare totals with the marketplace's own GST summary.
- Import the generated Excel into the latest GSTN Returns Offline Tool once, and upload one JSON on the portal,
  before charging customers. If GSTN publishes a newer workbook template, replace
  `public/templates/GSTR1_Excel_Workbook_Template_V2.2.xlsx` (the exporter verifies sheet names and headers and
  refuses to export if they changed).
