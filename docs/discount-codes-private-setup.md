# Private discount rules — what you set up (before / during Step 2)

You chose **private** rules: codes are not exposed via a public `raw.githubusercontent.com` URL in the browser.

## 1. GitHub repository for rules

- Create a **private** repo (e.g. `rettmark-discount-rules`) **or** use an existing private repo.
- Add a file such as `discount-codes.json` at the path you prefer (e.g. root or `config/discount-codes.json`).
- Copy from this site’s `data/discount-codes.example.json`, replace with real codes, commit on `main` (or note the branch you use).

## 2. Token for Netlify (read-only)

- GitHub → **Settings → Developer settings → Personal access tokens** (classic) **or** fine-grained PAT.
- **Classic:** scope `repo` for private repos (or fine-grained: **Contents: Read-only** on that repo only).
- In **Netlify**: Site → **Environment variables** → add (names will match Step 2 implementation):

  - `GITHUB_DISCOUNT_TOKEN` — the PAT (mark **secret**).
  - `GITHUB_DISCOUNT_OWNER` — org or user name.
  - `GITHUB_DISCOUNT_REPO` — repo name (no `.git`).
  - `GITHUB_DISCOUNT_PATH` — path to file, e.g. `discount-codes.json` or `config/discount-codes.json`.
  - `GITHUB_DISCOUNT_REF` — optional; default `main` (branch, tag, or commit SHA).

## 3. Security habits

- Prefer a **fine-grained** GitHub PAT with **Contents: Read-only** on the discount-rules repo only (not full `repo` scope unless required).
- Rotate the PAT if it leaks; restrict to the smallest repo access possible.
- Never paste the token into frontend code or public issues.

See [security-checkout.md](security-checkout.md) for checkout hardening (CORS, Turnstile on pay, logging).

## 4. Updating promos later

- Edit `discount-codes.json` in the **private** repo → commit → push.  
- No Netlify **site** redeploy is required for content-only changes **after** Step 2–3 are implemented (functions read GitHub at runtime).

**Implemented names** (use these in Netlify):

- `GITHUB_DISCOUNT_TOKEN`
- `GITHUB_DISCOUNT_OWNER`
- `GITHUB_DISCOUNT_REPO`
- `GITHUB_DISCOUNT_PATH`
- `GITHUB_DISCOUNT_REF` (optional, default `main`)

After deploy, checkout calls **`POST /.netlify/functions/discount-validate`** (same-origin) to preview a code; **`anet-transaction`** uses the same GitHub file when charging.

## 5. Optional: limit how many times a code works (`maxUses`)

In `discount-codes.json`, add **`maxUses`** (positive integer) on a rule. The site counts **successful paid checkouts** where the code had any effect (merchandise discount, shipping credit, or surcharge) in **Netlify Blobs** (store name `rettmark-discount-usage`). No extra env vars are required on Netlify; Blobs context is injected for serverless functions.

The site repo must list **`@netlify/blobs`** in `package.json` so Netlify bundles it with functions. Run `npm install` locally or on CI before deploy if you add dependencies.
