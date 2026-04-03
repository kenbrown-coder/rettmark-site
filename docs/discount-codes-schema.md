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
| `merchandiseDiscountPercent` | no | number | **Only with `applyTo: "shipping"`** and `kind` `fixed` or `percent`. Adds an extra **merchandise** discount of this percent (0–100) on the **promo-eligible** subtotal (same base as normal merch promos — **Hunters HD Gold excluded**). Shipping part of the rule runs as usual (e.g. fixed `value` 19.99 → at most $19.99 off quoted shipping). |

## Kinds

| `kind` | `applyTo` | Effect |
|--------|-----------|--------|
| `percent` | `merchandise` (default) | `value` is 0–100; percent off **cart subtotal**. |
| `fixed` | `merchandise` (default) | `value` is dollars off subtotal (capped at subtotal). |
| `percent` | `shipping` | `value` is 0–100; percent off **quoted shipping** (credit capped at shipping). Optional **`merchandiseDiscountPercent`** adds a percent off eligible merchandise (not HHDG). |
| `fixed` | `shipping` | `value` is the **maximum** shipping credit in dollars. The actual credit is **min(`value`, quoted shipping)** — e.g. `19.99` takes at most $19.99 off shipping, and if shipping is $8.50 the credit is $8.50. Optional **`merchandiseDiscountPercent`** stacks a percent off eligible merchandise (not HHDG). |
| `surcharge_percent` | (ignored) | `value` is percent **added** to merchandise subtotal before tax (e.g. `10` = +10%). Capped at 500% server-side. |

Checkout sends **gross** `shipping` to `discount-validate`; shipping credits are computed against that. **Sales tax** is calculated on merchandise after discount **and** surcharge.

## Future (not implemented until we add logic)

`minSubtotal`, SKU allowlists — document here when added.

## Workflow: local file mirrors private GitHub

- **`data/discount-codes.local.txt`** is the **canonical copy in this repo** of the rules file in your **private** GitHub repository (the file at `GITHUB_DISCOUNT_PATH`). The extension is **`.txt`** so you can open and copy-paste like a simple text document; the **body must still be valid JSON** (a top-level array of rule objects) so it pastes cleanly into the private **`discount-codes.json`**. Keep local and private **identical**.
- When you change promos: edit **`data/discount-codes.local.txt`** here → copy the **entire file contents** → paste into the private repo file (replacing what is there) → commit and push **only** the private repo. No Netlify deploy is needed for content-only JSON changes (functions read GitHub at request time).
- Netlify Functions **do not** read `discount-codes.local.txt` from the site repo at runtime; production always uses the private GitHub file.

## Example

`data/discount-codes.example.json` shows the same array **shape** and sample rules (safe to commit in a public site repo). Whenever you change **`discount-codes.local.txt`**, update **`discount-codes.example.json`** to match so the checked-in example stays accurate (unless you intentionally keep the example as placeholders only).

## Platform rule (not configurable in JSON)

**Hunters HD Gold** cart lines never receive **merchandise** percent/fixed discounts, **`merchandiseDiscountPercent`**, or **surcharges**. They are identified the same way as checkout shipping: `shippingClass === "glasses"` or product `url` containing `hhdg-`. Catalog pricing (e.g. **$299.99**) for those lines is therefore not reduced by merchandise-side promos. **Shipping credits** (`applyTo: shipping`) still apply to the order’s quoted shipping only (they do not change per-line item prices).

## Private mode

Production rules live in a **private** GitHub repository. Do not commit real codes to a **public** site repo.
