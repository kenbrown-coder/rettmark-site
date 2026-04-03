# Checkout security baseline

Reference for what is already implemented and which environment variables harden payment flows.

## Already implemented (do not duplicate)

- **Card data:** Accept.js tokenizes the card in the browser; only **opaqueData** is sent to [anet-transaction](../netlify/functions/anet-transaction.js). **ANET_TRANSACTION_KEY** stays server-side (Netlify env).
- **Tampering:** Order `amount` and breakdown fields are validated against the cart and private GitHub discount rules (including Hunters HD Gold exclusions).
- **Secrets:** Authorize.Net, Resend, and GitHub discount tokens are env-only; see comments in [netlify.toml](../netlify.toml).
- **HTTP headers:** Site-wide **HSTS**, **CSP** (Turnstile + Authorize.Net hosts), **X-Frame-Options** in [netlify.toml](../netlify.toml).
- **Turnstile (contact):** [contact.html](../contact.html) uses Turnstile on the notify form; site key is injected at build from `TURNSTILE_SITE_KEY`.

## Template file for Netlify

Fill [`.env`](../.env) in the repo root, then import with Netlify CLI (`netlify env:import .env`) or the dashboard **Import from .env file**. For local-only secrets without changing the tracked `.env`, use `.env.local` (gitignored).

## Hardening env vars (set in Netlify → Site configuration → Environment variables)

| Variable | Scope | Purpose |
|----------|--------|---------|
| `CHECKOUT_ALLOWED_ORIGINS` | Functions | Comma-separated **exact** origins allowed to call checkout APIs (e.g. `https://rettmarkfirearms.com,https://www.rettmarkfirearms.com`). If **unset**, functions keep legacy `Access-Control-Allow-Origin: *` (set this in production). |
| `TURNSTILE_SECRET_KEY` | Functions | Cloudflare Turnstile **secret** for server-side `siteverify` on charges. If set, `anet-transaction` requires a valid `turnstileToken` from the client. |
| `REQUIRE_TURNSTILE_ON_CHARGE` | Functions | If `1` and `TURNSTILE_SECRET_KEY` is missing, charges return **503** (catches misconfiguration). |
| `ANET_VERIFY_KEYS_ENABLED` | Functions | If `1`, [anet-verify-keys](../netlify/functions/anet-verify-keys.js) is exposed; otherwise it returns **404** (default for production). |

## Logging (audit)

Netlify Functions must **not** log full `event.body`, `opaqueData`, or card-related fields. A pass over `netlify/functions/**/*.js` confirmed no such logging; keep it that way when adding features.

## Medium-priority checklist (process / merchant console)

- **Authorize.Net:** In the merchant interface, enable **AVS** and **CVV** checks as appropriate for your risk tolerance; turn on **email alerts** for suspicious transactions; rotate the **transaction key** on a schedule and keep an internal runbook.
- **GitHub discount PAT:** Prefer a fine-grained token with read-only access to the rules repo only; rotate if exposed (see [discount-codes-private-setup.md](discount-codes-private-setup.md)).
- **Rate limiting:** If automated abuse appears (many `anet-transaction` calls), consider Netlify tier **WAF**/edge limits or a small **IP + invoice** throttle inside the function.
- **PCI:** Confirm **SAQ** type with your processor; keep **RESEND_DEBUG** off in production.
