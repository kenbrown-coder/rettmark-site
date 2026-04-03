# Resend — order confirmation email (step by step)

After a successful card charge, **`anet-transaction`** sends the customer an HTML invoice via [Resend](https://resend.com). If Resend is not configured, **the order can still succeed**; only the email is skipped (see Netlify function logs).

---

## 1. Resend account and domain

1. Go to [resend.com](https://resend.com) and sign up or sign in.
2. Open **Domains** → **Add domain**.
3. Enter **`rettmarkfirearms.com`** (or the domain you want to send *from* — it must be one you control in DNS).
4. Resend shows **DNS records** (often SPF/DKIM and related entries). Add them at **wherever DNS for that domain is hosted** (registrar, Cloudflare, etc.).
5. Wait until Resend shows the domain as **Verified** (DNS can take a few minutes; DKIM sometimes longer).
6. **If you use Google Workspace** (or any email on this domain), you probably already have **one** SPF **`TXT`** on **`@`** / root, starting with `v=spf1` and including `include:_spf.google.com`. Rules:
   - If Resend’s DNS instructions only add records on a **subdomain** (e.g. `send.rettmarkfirearms.com`), add those as shown; your **root** Google SPF often stays unchanged.
   - If Resend asks for **another** `v=spf1` **`TXT` on the root**, you must **not** have two SPF records — combine into **one** line, e.g. `v=spf1 include:_spf.google.com include:<Resend’s include> ~all`, using the exact pieces Resend and Google require (only one `v=spf1`, one `~all` or `-all` at the end).
   - **DKIM** records from Resend (e.g. under `resend._domainkey…`) are separate; add them as Resend shows — they don’t replace Google’s mail setup.

You do **not** need a separate “mailbox” product for Resend to send *from* `orders@…` on a verified domain — Resend sends on your behalf once the domain is verified.

---

## 2. API key

1. In Resend: **API Keys** → **Create API key**.
2. Name it e.g. `Netlify rettmark-site`.
3. Copy the key once shown (starts with `re_`). Store it in a password manager; you cannot see it again in full.

---

## 3. Choose the “from” address

Pick an address **on the verified domain**, for example:

- `orders@rettmarkfirearms.com`

The Netlify variable must match what Resend accepts. Recommended format (friendly name + angle brackets):

```text
Rettmark Firearms <orders@rettmarkfirearms.com>
```

Use your real domain and the local part you prefer (`orders`, `noreply`, etc.).

---

## 4. Netlify environment variables

**Site configuration** → **Environment variables** (same place as Authorize.Net).

| Key | Value | Scope |
|-----|--------|--------|
| `RESEND_API_KEY` | `re_…` (paste full key) | **Functions** or **All** (not Builds-only) |
| `RESEND_FROM` | e.g. `Rettmark Firearms <orders@rettmarkfirearms.com>` | Same |

**Optional**

| Key | Purpose |
|-----|--------|
| `RESEND_SALES_EMAIL` | Staff BCC (default in code: `sales@rettmarkfirearms.com`) |
| `RESEND_REPLY_TO` | `Reply-To` header (defaults to sales email) |
| `RESEND_DEBUG` | Set to `1` **only while testing** — successful charge response may include `emailDelivery`. Remove or set empty for production. |

Save, then **trigger a new deploy** (or “Clear cache and deploy”) so functions pick up changes.

---

## 5. Test

1. Place a **small test order** on the live site with an email address you can open (including spam folder).
2. Netlify → **Functions** → **`anet-transaction`** → **Logs** (or **Observability**).
   - Success: log line like **`Invoice email queued in Resend`** with an id.
   - Failure: **`Resend API error`** and status/body — common causes: wrong key, unverified domain, invalid `RESEND_FROM`, or Resend account limits.
3. With **`RESEND_DEBUG=1`**, a successful payment response JSON may include **`emailDelivery`** (ok / error detail). Turn **`RESEND_DEBUG`** off after debugging.

---

## 6. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| No email, payment OK | Logs: `missing_RESEND_API_KEY` or `missing_RESEND_FROM` → set both in Netlify, redeploy. |
| Resend 403 / invalid | API key typo or revoked; create a new key. |
| Domain / sender errors | Domain not verified in Resend; `RESEND_FROM` must use **that** domain. |
| Email to customer missing; staff gets copy | Check customer entered email on checkout; without it, code sends **only** to `RESEND_SALES_EMAIL` (see `anet-transaction.js`). |
| Everything “works” but inbox empty | Spam folder; Resend dashboard **Emails** / logs for delivery events. |

---

## 7. Security

- Treat **`RESEND_API_KEY`** like a password (Netlify secrets, never commit).
- **`RESEND_DEBUG=1`** can expose email delivery details in HTTP responses — use briefly, then disable.

No git change is required for Resend to work; configuration is entirely Resend + Netlify + DNS.
