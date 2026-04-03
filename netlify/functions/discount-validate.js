/**
 * Validate a discount code against private GitHub rules (preview for checkout UI).
 * POST JSON: { "code": "SAVE10", "subtotal": 199.99 }
 * Response: { "ok": true, "discountAmount": 19.99, "code": "SAVE10" } or { "ok": false, "error": "..." }
 *
 * Same env as lib/discount-rules-from-github.js
 */

var discountLib = require("./lib/discount-rules-from-github.js");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function json(status, obj) {
  return {
    statusCode: status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
    body: JSON.stringify(obj)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
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

  if (!discountLib.githubEnvConfigured()) {
    return json(503, { ok: false, error: "discount_service_unconfigured" });
  }

  var subtotalCents = Math.round(subtotal * 100);
  var resolved = await discountLib.resolveExpectedDiscountCents(codeRaw, subtotalCents, event);
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

  var amt = resolved.expectedCents / 100;
  return json(200, {
    ok: true,
    discountAmount: amt,
    code: codeRaw
  });
};
