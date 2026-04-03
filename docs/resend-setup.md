# Resend (order confirmation email)

Order confirmation runs in **`anet-transaction`** after a successful charge. Emails are skipped if Resend is not configured; the payment can still succeed.

## What you do in Resend

1. Sign in at [resend.com](https://resend.com) and add your **domain** (DNS records they provide).
2. After verification, create an **API key** with permission to send.
3. Choose a **from** address on that verified domain, e.g. `Rettmark Firearms <orders@yourdomain.com>`.

## What you set in Netlify

| Variable | Notes |
|----------|--------|
| `RESEND_API_KEY` | Secret; Functions (or All) scope. |
| `RESEND_FROM` | Must use the verified domain; same format as in Resend docs. |
| `RESEND_SALES_EMAIL` | Optional; BCC for staff (default in code: `sales@rettmarkfirearms.com`). |
| `RESEND_REPLY_TO` | Optional. |
| `RESEND_DEBUG` | Set to `1` only while testing; response JSON may include `emailDelivery`. Turn off in production. |

Redeploy after changing variables.

## Verify

1. Netlify → **Functions** → **anet-transaction** → **Logs**.
2. After a test order, look for `Invoice email queued in Resend` or a Resend API error line.
3. Check spam for the customer and BCC inboxes.

No repository change can substitute for these steps; they require your Resend and DNS access.
