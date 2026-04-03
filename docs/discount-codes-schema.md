# Discount rules JSON schema

Used by Netlify functions (private GitHub fetch). **Match is case-insensitive** on `code`.

## File shape

Top level: **array** of rule objects.

## Rule object

| Field | Required | Type | Notes |
|--------|----------|------|--------|
| `code` | yes | string | Promo code; compared case-insensitively. |
| `kind` | yes | string | `"percent"` or `"fixed"`. |
| `value` | yes | number | Percent: 0–100 of **merchandise subtotal**. Fixed: dollars off, capped at subtotal. |
| `active` | no | boolean | Default `true`. If `false`, code is invalid. |
| `expiresAt` | no | string | ISO 8601 UTC end instant; after this moment the code is invalid. Omit = no expiry. |
| `maxUses` | no | number | If set to a **positive integer**, the code stops working after that many **successful paid orders** that applied a non-zero discount. Counts are stored in **Netlify Blobs** (`rettmark-discount-usage`). Omit or non-positive = unlimited. |

## Future (not implemented until we add logic)

`minSubtotal`, SKU allowlists — document here when added.

## Example

See `data/discount-codes.example.json` in this repo (placeholders only).

## Private mode

Production rules live in a **private** GitHub repository. Do not commit real codes to a **public** site repo.
