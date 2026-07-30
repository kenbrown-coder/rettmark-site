# Email-updates form — bot hardening

Spam hitting the contact “Email updates” list was able to POST straight to the public Google Apps Script `/exec` URL. Browser-only Turnstile and a CSS-hidden honeypot do not stop that.

## What ships in this repo

1. **Browser** ([contact.html](../contact.html) + [js/site.js](../js/site.js)): form posts JSON to `/.netlify/functions/notify-subscribe` after Turnstile; honeypot still present; submit is blocked if `TURNSTILE_SITE_KEY` was not injected at build.
2. **Netlify** ([notify-subscribe.js](../netlify/functions/notify-subscribe.js)): honeypot, **server** Turnstile `siteverify`, soft IP rate limit (Blobs), then forward to Apps Script with a shared webhook secret.
3. **Apps Script** ([notify-with-turnstile.gs](../google-apps-script/notify-with-turnstile.gs)): accepts Netlify’s `webhookSecret`; rejects anonymous posts. Unsubscribe links include an HMAC `sig` (uses `UNSUBSCRIBE_HMAC_SECRET` or falls back to `NOTIFY_WEBHOOK_SECRET`). **Do not put the `/exec` URL in HTML.**

## Required Netlify env (Functions scope or All)

| Variable | Purpose |
|----------|---------|
| `TURNSTILE_SITE_KEY` | Build-time public key (already used for checkout/contact widget) |
| `TURNSTILE_SECRET_KEY` | Server `siteverify` for notify **and** checkout |
| `NOTIFY_GOOGLE_SCRIPT_URL` | Full Apps Script web-app `/exec` URL |
| `NOTIFY_WEBHOOK_SECRET` | Long random string; same value in Apps Script script properties |
| `CHECKOUT_ALLOWED_ORIGINS` | Recommended so only your site can call the function |

Generate a secret (PowerShell):

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

## Apps Script cutover (required to kill the current bot)

1. Open the Google Sheet / Apps Script bound to your signup list.
2. Replace `doPost` with the logic in [notify-with-turnstile.gs](../google-apps-script/notify-with-turnstile.gs). Merge your existing sheet/email notification into `handleSignup_` (do not lose MailApp alerts if you use them).
3. **Project settings → Script properties** → add `NOTIFY_WEBHOOK_SECRET` (same as Netlify). Optional: `UNSUBSCRIBE_HMAC_SECRET` (otherwise unsubscribe signing uses the webhook secret).
4. **Deploy → Manage deployments → New deployment** (Web app: execute as you, access Anyone). Copy the **new** `/exec` URL.
5. Put that URL in Netlify `NOTIFY_GOOGLE_SCRIPT_URL`, set `NOTIFY_WEBHOOK_SECRET` and ensure `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` are set, then **redeploy** the site.
6. **Archive or delete older web-app deployments** so the scraped URL in the old HTML stops accepting signups.

After updating Apps Script to the signed-unsubscribe version, **Deploy → Manage deployments → Edit → New version** so welcome emails get `?email=&sig=` links. Unsigned `?email=` alone will no longer unsubscribe.

Until steps 4–6 are done, bots can still hit the old public URL even after the site code ships.

## Quick test after deploy

1. Open `/contact.html`, complete Turnstile, submit a real address you control → should land on `success.html` and appear in the Sheet with source `Website`.
2. `curl` the old `/exec` URL with only `email=…` (no secret) → should be rejected / no new row.
3. Netlify → Functions → `notify-subscribe` logs on failure (missing env, Turnstile fail, forward fail).
