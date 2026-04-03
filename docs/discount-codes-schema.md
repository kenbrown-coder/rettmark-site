# Discount rules JSON schema

Used by Netlify functions (private GitHub fetch). **Match is case-insensitive** on `code`.

## File shape

Top level: **array** of rule objects.

## Rule object

| Field | Required | Type | Notes |
|--------|----------|------|--------|
| `code` | yes | string | Promo code; compared case-insensitively. |
| `kind` | yes | string | See **Kinds** below. |
| `value` | yes | number | Meaning depends on `kind` and `applyTo`. |
| `applyTo` | no | string | `"merchandise"` (default) or `"shipping"`. Only applies when `kind` is `percent` or `fixed` (not `surcharge_percent`). |
| `active` | no | boolean | Default `true`. If `false`, code is invalid. |
| `expiresAt` | no | string | ISO 8601 UTC end instant; after this moment the code is invalid. Omit = no expiry. |
| `maxUses` | no | number | If set to a **positive integer**, the code stops working after that many **successful paid orders** where the code had any effect (merchandise discount, shipping credit, or surcharge). Counts are stored in **Netlify Blobs** (`rettmark-discount-usage`). Omit or non-positive = unlimited. |

## Kinds

| `kind` | `applyTo` | Effect |
|--------|-----------|--------|
| `percent` | `merchandise` (default) | `value` is 0–100; percent off **cart subtotal**. |
| `fixed` | `merchandise` (default) | `value` is dollars off subtotal (capped at subtotal). |
| `percent` | `shipping` | `value` is 0–100; percent off **quoted shipping** (credit capped at shipping). |
| `fixed` | `shipping` | `value` is the **maximum** shipping credit in dollars. The actual credit is **min(`value`, quoted shipping)** — e.g. `19.99` takes at most $19.99 off shipping, and if shipping is $8.50 the credit is $8.50. |
| `surcharge_percent` | (ignored) | `value` is percent **added** to merchandise subtotal before tax (e.g. `10` = +10%). Capped at 500% server-side. |

Checkout sends **gross** `shipping` to `discount-validate`; shipping credits are computed against that. **Sales tax** is calculated on merchandise after discount **and** surcharge.

## Future (not implemented until we add logic)

`minSubtotal`, SKU allowlists — document here when added.

## Example

See `data/discount-codes.example.json` in this repo (placeholders only).

## Platform rule (not configurable in JSON)

**Hunters HD Gold** cart lines never receive **merchandise** percent/fixed discounts or **surcharges**. They are identified the same way as checkout shipping: `shippingClass === "glasses"` or product `url` containing `hhdg-`. **Shipping credits** (`applyTo: shipping`) still apply to the order’s quoted shipping when the code allows it.

## Private mode

Production rules live in a **private** GitHub repository. Do not commit real codes to a **public** site repo.
