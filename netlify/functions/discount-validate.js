/**
 * Validate a discount code against private GitHub rules (preview for checkout UI).
 * POST JSON: { "code", "subtotal", "shipping"?, "cart": [ line items same as checkout ] }
 *   cart is required; subtotal must match sum(cart) within 2¢. Merch discounts/surcharges exclude Hunters HD Gold lines.
 * Response: { ok, discountAmount, shippingCreditAmount, surchargeAmount, code } (amounts in dollars).
 *   shippingCreditMaxAmount — optional; promotion cap for fixed shipping credits (actual credit = min(cap, quoted shipping)).
 *   eligibleMerchandiseSubtotal — dollars; promo-eligible merchandise only (Hunters HD Gold / hhdg- lines excluded).
 *   merchandiseDiscountPercentOffered — optional; if the matched rule is applyTo shipping with merchandiseDiscountPercent in JSON.
 *   Shipping rules may set merchandiseDiscountPercent (see docs/discount-codes-schema.md) for a stacked merch discount (HHDG excluded).
 *
 * Same env as lib/discount-rules-from-github.js
 * CORS: optional CHECKOUT_ALLOWED_ORIGINS — see docs/security-checkout.md
 */

var discountLib = require("./lib/discount-rules-from-github.js");
var corsAllowlist = require("./lib/cors-allowlist.js");

exports.handler = async function (event) {
  var corsResult = corsAllowlist.corsForRequest(event, "POST, OPTIONS");
  function json(status, obj) {
    if (!corsResult.ok) {
      return {
        statusCode: 403,
        headers: Object.assign({ "Content-Type": "application/json" }, corsResult.headers),
        body: JSON.stringify({ ok: false, error: "forbidden" })
      };
    }
    return {
      statusCode: status,
      headers: Object.assign({ "Content-Type": "application/json" }, corsResult.headers),
      body: JSON.stringify(obj)
    };
  }

  if (event.httpMethod === "OPTIONS") {
    if (!corsResult.ok) {
      return { statusCode: 403, headers: corsResult.headers, body: "" };
    }
    return { statusCode: 204, headers: corsResult.headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  var body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { ok: false, error: "invalid_json" });
  }

  var codeRaw = String(body.code || "").trim();
  if (!codeRaw) {
    return json(400, { ok: false, error: "empty_code" });
  }

  var subtotal = Number(body.subtotal);
  if (!isFinite(subtotal) || subtotal < 0) {
    return json(400, { ok: false, error: "invalid_subtotal" });
  }

  var shipping = Number(body.shipping);
  if (!isFinite(shipping) || shipping < 0) {
    shipping = 0;
  }

  if (!discountLib.githubEnvConfigured()) {
    return json(503, { ok: false, error: "discount_service_unconfigured" });
  }

  var subtotalCents = Math.round(subtotal * 100);
  var shippingCents = Math.round(shipping * 100);

  if (!Array.isArray(body.cart)) {
    return json(400, { ok: false, error: "missing_cart" });
  }
  var cartSumCents = discountLib.sumCartCents(body.cart);
  if (Math.abs(cartSumCents - subtotalCents) > 2) {
    return json(400, { ok: false, error: "cart_subtotal_mismatch" });
  }

  var resolved = await discountLib.resolveExpectedPromoCents(
    codeRaw,
    subtotalCents,
    shippingCents,
    event,
    body.cart
  );
  if (!resolved.ok) {
    var err = resolved.error || "invalid";
    if (err === "invalid_discount_code") {
      return json(200, { ok: false, error: "invalid_code" });
    }
    if (err === "discount_code_exhausted") {
      return json(200, { ok: false, error: "code_exhausted" });
    }
    if (err === "discount_usage_unavailable") {
      return json(503, { ok: false, error: "discount_usage_unavailable" });
    }
    return json(503, { ok: false, error: "discount_rules_unavailable" });
  }

  var resBody = {
    ok: true,
    discountAmount: resolved.merchDiscCents / 100,
    shippingCreditAmount: resolved.shipCreditCents / 100,
    surchargeAmount: resolved.surchargeCents / 100,
    code: codeRaw
  };
  if (resolved.promoEligibleMerchCents != null && isFinite(resolved.promoEligibleMerchCents)) {
    resBody.eligibleMerchandiseSubtotal = discountLib.roundMoney(resolved.promoEligibleMerchCents / 100);
  }
  if (resolved.merchandiseDiscountPercentOffered != null) {
    resBody.merchandiseDiscountPercentOffered = resolved.merchandiseDiscountPercentOffered;
  }
  if (resolved.shippingCreditMaxCents != null && isFinite(resolved.shippingCreditMaxCents)) {
    resBody.shippingCreditMaxAmount = resolved.shippingCreditMaxCents / 100;
  }
  return json(200, resBody);
};
