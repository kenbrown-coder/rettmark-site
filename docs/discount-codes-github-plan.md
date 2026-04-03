# Plan: GitHub-hosted discount rules (secure + no redeploy for rule changes)

This plan addresses:

1. **Server truth** — The payment function must recompute and enforce discounts; the browser is never authoritative.
2. **Secret codes** — If codes must stay private, rules cannot be loaded from a public `raw.githubusercontent.com` URL in the browser without exposing them.
3. **Fresh rules** — After you push JSON to GitHub, checkout should see updates without a Netlify **site** redeploy (once the integration is in place).

We will execute **one step at a time**; confirm each step before moving on.

---

## Step 0 — Decision (done)

**Chosen: Private (B)** — Rules live in a **private** GitHub repo; Netlify functions fetch with a **server-only** token. The browser never sees the raw GitHub URL with credentials; preview will go through a **small Netlify function** (Step 3).

**Important:** If this **site** repo (`rettmark-site`) is **public**, do **not** commit real promo codes here. Keep production JSON only in the private rules repo.

---

## Step 1 — Lock the JSON schema (done in repo)

**Goal:** One file format everyone agrees on.

**Delivered in this repo:**

- `docs/discount-codes-schema.md` — field definitions and case-insensitive `code` matching.
- `data/discount-codes.example.json` — placeholder examples only (safe to commit).
- `docs/discount-codes-private-setup.md` — your checklist: private repo + PAT + Netlify env names (to be wired in Step 2).

**You:** Create the **private** rules repo and your real `discount-codes.json` there (copy shape from the example). Optionally confirm the schema looks right.

**Verify:** Your private file is valid JSON and follows `docs/discount-codes-schema.md`.

---

## Step 2 — Server-side validation in `anet-transaction` (covers Caveat: browser forge)

**Goal:** Charge only succeeds if `discountCode` + `discountAmount` match **server-computed** discount from the same rules as GitHub.

**Actions:**

- In `netlify/functions/anet-transaction.js`, after parsing `body`, load rules from env-configured URL (public raw URL) or from GitHub API (private + token).
- Implement same math as today: `percent` of merchandise subtotal, `fixed` capped at subtotal; optional expiry / `active` skip.
- If code invalid or expired: reject with 400 (or treat as zero discount and reject if client sent a non-empty code—policy choice).
- Compare computed discount cents to `body.discountAmount`; must match within rounding rules.

**You:** Set Netlify env vars for **private** GitHub (see `docs/discount-codes-private-setup.md` — names finalized in Step 2).

**Verify:** Tampering `discountAmount` in DevTools fails the charge; valid code + correct amount succeeds.

---

## Step 3 — Browser UX: fetch rules for preview only (optional but nice)

**Goal:** User sees “code applied” before pay; still not trusted for money.

**Actions:**

- In `js/checkout-review.js`, call `/.netlify/functions/discount-preview` (or shared name) for **private** path — server reads GitHub with token, returns only what’s needed to preview (e.g. validate code + amount), **without** shipping the full rules list to the client if we choose a minimal API.
- Use `cache: 'no-store'` or short revalidate so new pushes show up quickly.
- On failure (network), show message; do not apply discount until rules load or user retries.
- Persist applied code in existing session totals flow only after it matches loaded rules.

**You:** N/A for private mode (browser never uses public raw URL for rules).

**Verify:** Changing JSON on GitHub (push only) updates preview within a minute without redeploying the site.

---

## Step 4 — Single source of truth for “where is the URL”

**Goal:** No drift between preview and charge.

**Actions:**

- Same env var on Netlify for the function; for **public** browser fetch, either:
  - embed the public raw URL in built `checkout-review.js` at build time from env (`DISCOUNT_RULES_PUBLIC_URL`), or
  - serve a tiny `/.netlify/functions/discount-config` that returns `{ "rulesUrl": "..." }` from env (one place to change in Netlify UI).

**You:** Choose: build-time inject vs one public config endpoint.

**Verify:** Preview and charge both use identical rule set (manual test with one code).

---

## Step 5 — Hardening and operations

**Actions:**

- **Rate limiting / abuse:** optional; low priority unless you see abuse.
- **Logging:** log rejected code attempts (no full PAN); optional.
- **Runbook for you:** “Edit **`data/discount-codes.local.txt`** in the site repo (mirror of private rules) → paste entire file into private **`discount-codes.json`** → commit → push; no Netlify deploy for rule-only JSON changes.”
- **When code deploy IS required:** changes to `anet-transaction.js`, checkout JS, or schema logic.

**You:** Confirm runbook; add branch protection if others edit the repo.

---

## Step 6 — Regression checklist (before trusting in production)

- [ ] Unknown code → charge rejected (or zero discount policy documented).
- [ ] Expired / `active: false` → rejected.
- [ ] Percent and fixed caps match subtotal edge cases (empty cart blocked elsewhere).
- [ ] Shipping/tax math unchanged after discount line.
- [ ] Receipt email still shows discount line when applied.

---

## Order we will follow together

| Order | Step | Typical owner |
|------:|------|----------------|
| 0 | Choose public vs private rules | You — **Private** ✓ |
| 1 | JSON schema + sample file | **Done** — you copy to private repo |
| 2 | Server validation in `anet-transaction` | Agent + you set env |
| 3 | Browser preview fetch | Agent |
| 4 | Unify URL / env story | Agent + you set env |
| 5 | Hardening + runbook | Agent + you |
| 6 | Manual QA checklist | You |

**Steps 2–4 (implemented in code):**

- **Step 2:** `anet-transaction.js` loads rules from GitHub and rejects discount/code mismatches (`netlify/functions/lib/discount-rules-from-github.js`).
- **Step 3:** `discount-validate` Netlify function + `checkout-review.js` calls it on Apply and to re-check a saved code.
- **Step 4:** Single source: same GitHub env vars for both functions (no public raw URL in the browser).

**You still need:** Create the private repo JSON, add Netlify env vars from `discount-codes-private-setup.md`, then deploy once so the new functions go live.

**Next:** Say **“Step 5”** for runbook / hardening, or test checkout after env is set.
