/**
 * JP Enterprises order request — not a cart checkout and not a charge.
 *
 * Browser posts JSON after Turnstile. This function:
 *   1) checks honeypot
 *   2) verifies Cloudflare Turnstile (TURNSTILE_SECRET_KEY)
 *   3) rate-limits by IP (Netlify Blobs when available)
 *   4) rewrites line items from the server MAP catalog (never trusts client prices)
 *   5) emails orders@ and the customer via Resend
 *
 * Env:
 *   TURNSTILE_SECRET_KEY, RESEND_API_KEY, RESEND_FROM
 *   Optional: RESEND_ORDERS_EMAIL (default orders@rettmarkfirearms.com), RESEND_REPLY_TO, CHECKOUT_ALLOWED_ORIGINS
 */

var corsAllowlist = require("./lib/cors-allowlist.js");
var turnstileVerify = require("./lib/turnstile-verify.js");
var catalogJson = require("./lib/jp-catalog.json");

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var MAX_PER_IP_PER_HOUR = 6;
var MAX_LINES = 40;
var MAX_QTY = 20;
var RATE_STORE = "rettmark-jp-order-rate";

function catalogById() {
  var map = Object.create(null);
  var items = (catalogJson && catalogJson.items) || [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it && it.id) map[String(it.id)] = it;
  }
  return map;
}

var CATALOG = catalogById();

function parseBody(event) {
  var raw = event.body || "";
  if (event.isBase64Encoded) {
    try {
      raw = Buffer.from(raw, "base64").toString("utf8");
    } catch (e) {
      return null;
    }
  }
  var ct = "";
  var headers = event.headers || {};
  for (var k in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, k) && String(k).toLowerCase() === "content-type") {
      ct = String(headers[k] || "").toLowerCase();
      break;
    }
  }
  if (ct.indexOf("application/json") !== -1) {
    try {
      return JSON.parse(raw || "{}");
    } catch (e) {
      return null;
    }
  }
  var params = new URLSearchParams(raw);
  var obj = {};
  params.forEach(function (value, key) {
    obj[key] = value;
  });
  return obj;
}

function hourBucket() {
  var d = new Date();
  return (
    d.getUTCFullYear() +
    "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getUTCDate()).padStart(2, "0") +
    "T" +
    String(d.getUTCHours()).padStart(2, "0")
  );
}

async function checkRateLimit(event, ip) {
  if (!ip) return { ok: true };
  try {
    var blobs = require("@netlify/blobs");
    if (typeof blobs.connectLambda === "function") {
      blobs.connectLambda(event);
    }
    var store = blobs.getStore(RATE_STORE);
    var key = "ip:" + ip.slice(0, 64) + ":" + hourBucket();
    var prev = await store.get(key);
    var n = parseInt(prev || "0", 10);
    if (!isFinite(n) || n < 0) n = 0;
    if (n >= MAX_PER_IP_PER_HOUR) {
      return { ok: false, limited: true };
    }
    await store.set(key, String(n + 1));
    return { ok: true };
  } catch (e) {
    console.warn(
      "[rettmark] JP order rate-limit skipped",
      e && e.message ? e.message : String(e)
    );
    return { ok: true };
  }
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUsd(cents) {
  var n = Math.ceil(Number(cents || 0) / 100);
  return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function clip(s, max) {
  var t = String(s || "").trim();
  if (t.length > max) return t.slice(0, max);
  return t;
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { ok: false, error: "empty_request" };
  }
  if (rawItems.length > MAX_LINES) {
    return { ok: false, error: "too_many_lines" };
  }
  var out = [];
  var seen = Object.create(null);
  var total = 0;
  var hasFirearm = false;
  for (var i = 0; i < rawItems.length; i++) {
    var row = rawItems[i] || {};
    var id = String(row.id || "").trim();
    if (!id || seen[id]) continue;
    var cat = CATALOG[id];
    if (!cat) {
      return { ok: false, error: "unknown_item" };
    }
    var qty = parseInt(row.qty, 10);
    if (!isFinite(qty) || qty < 1) qty = 1;
    if (qty > MAX_QTY) qty = MAX_QTY;
    seen[id] = true;
    var mapCents = parseInt(cat.mapCents, 10) || 0;
    total += mapCents * qty;
    if (cat.firearm) hasFirearm = true;
    out.push({
      id: cat.id,
      sku: cat.sku,
      name: cat.name,
      category: cat.category,
      kind: cat.kind,
      upgrade: !!cat.upgrade,
      firearm: !!cat.firearm,
      qty: qty,
      mapCents: mapCents
    });
  }
  if (!out.length) return { ok: false, error: "empty_request" };
  return { ok: true, items: out, totalCents: total, hasFirearm: hasFirearm };
}

function buildEmail(payload) {
  var rows = payload.items
    .map(function (it) {
      return (
        "<tr>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;font-family:sans-serif;font-size:13px'>" +
        esc(it.sku) +
        "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;font-family:sans-serif;font-size:13px'>" +
        esc(it.name) +
        (it.upgrade ? " <em>(build option)</em>" : "") +
        (it.firearm ? " <em>(built firearm — extra lead time)</em>" : "") +
        "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;font-family:sans-serif;font-size:13px;text-align:right'>" +
        it.qty +
        "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;font-family:sans-serif;font-size:13px;text-align:right'>" +
        formatUsd(it.mapCents) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  var html =
    "<p style='font-family:sans-serif;font-size:15px'>JP Enterprises <strong>order request</strong> — not a paid checkout.</p>" +
    "<p style='font-family:sans-serif;font-size:14px'>" +
    "<strong>Name:</strong> " +
    esc(payload.name) +
    "<br><strong>Email:</strong> " +
    esc(payload.email) +
    "<br><strong>Phone:</strong> " +
    esc(payload.phone) +
    (payload.ffl ? "<br><strong>FFL:</strong> " + esc(payload.ffl) : "") +
    "</p>" +
    (payload.notes
      ? "<p style='font-family:sans-serif;font-size:14px'><strong>Notes:</strong><br>" +
        esc(payload.notes).replace(/\n/g, "<br>") +
        "</p>"
      : "") +
    "<table style='border-collapse:collapse;width:100%;max-width:720px'>" +
    "<thead><tr>" +
    "<th align='left' style='padding:6px 8px;border-bottom:2px solid #333;font-family:sans-serif;font-size:12px'>SKU</th>" +
    "<th align='left' style='padding:6px 8px;border-bottom:2px solid #333;font-family:sans-serif;font-size:12px'>Item</th>" +
    "<th align='right' style='padding:6px 8px;border-bottom:2px solid #333;font-family:sans-serif;font-size:12px'>Qty</th>" +
    "<th align='right' style='padding:6px 8px;border-bottom:2px solid #333;font-family:sans-serif;font-size:12px'>Price</th>" +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table>" +
    "<p style='font-family:sans-serif;font-size:14px'><strong>Estimated total:</strong> " +
    formatUsd(payload.totalCents) +
    " (before tax, shipping, and transfer).</p>" +
    (payload.hasFirearm
      ? "<p style='font-family:sans-serif;font-size:14px'>This request includes a built rifle or pistol. Factory builds take additional time after the order is confirmed.</p>"
      : "") +
    "<p style='font-family:sans-serif;font-size:13px;color:#555'>Rettmark will contact the customer to confirm before placing or charging the order.</p>";

  var text =
    "JP Enterprises order request (not a paid checkout)\n\n" +
    "Name: " +
    payload.name +
    "\nEmail: " +
    payload.email +
    "\nPhone: " +
    payload.phone +
    (payload.ffl ? "\nFFL: " + payload.ffl : "") +
    (payload.notes ? "\nNotes: " + payload.notes : "") +
    "\n\n" +
    payload.items
      .map(function (it) {
        return it.qty + " x " + it.sku + " — " + it.name + " — " + formatUsd(it.mapCents);
      })
      .join("\n") +
    "\n\nEstimated total: " +
    formatUsd(payload.totalCents) +
    (payload.hasFirearm ? "\nIncludes a built firearm; extra lead time after confirmation." : "") +
    "\n\nRettmark will contact the customer to confirm before placing or charging the order.";

  return { html: html, text: text };
}

function ordersInbox() {
  return String(process.env.RESEND_ORDERS_EMAIL || "orders@rettmarkfirearms.com").trim();
}

async function sendResendEmail(key, msg) {
  var resendOpts = {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(msg)
  };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    resendOpts.signal = AbortSignal.timeout(12000);
  }
  var res = await fetch("https://api.resend.com/emails", resendOpts);
  var raw = await res.text();
  if (!res.ok) {
    console.error("[rettmark] JP request Resend error", res.status, raw ? raw.slice(0, 400) : "");
    return { ok: false, httpStatus: res.status };
  }
  return { ok: true };
}

async function sendRequestEmails(payload) {
  var key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) {
    return { ok: false, skipped: true, reason: "missing_RESEND_API_KEY" };
  }
  var from = String(process.env.RESEND_FROM || "").trim();
  if (!from) {
    return { ok: false, skipped: true, reason: "missing_RESEND_FROM" };
  }
  var ordersTo = ordersInbox();
  var replyTo = String(process.env.RESEND_REPLY_TO || ordersTo).trim();
  var mail = buildEmail(payload);

  var staff = await sendResendEmail(key, {
    from: from,
    to: [ordersTo],
    reply_to: [payload.email],
    subject: "JP order request — " + payload.name,
    html: mail.html,
    text: mail.text
  });
  if (!staff.ok) return staff;

  var customer = await sendResendEmail(key, {
    from: from,
    to: [payload.email],
    reply_to: [replyTo],
    subject: "JP order request received — Rettmark Firearms",
    html: mail.html,
    text: mail.text
  });
  if (!customer.ok) {
    console.error("[rettmark] JP request customer copy failed after orders inbox send");
  }
  return { ok: true };
}

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
  if (!corsResult.ok) {
    return json(403, { ok: false, error: "forbidden" });
  }

  var body = parseBody(event);
  if (!body) {
    return json(400, { ok: false, error: "invalid_body", userMessage: "Invalid request." });
  }

  if (String(body["bot-field"] || body.botField || "").trim()) {
    return json(200, { ok: true, skipped: true });
  }

  var name = clip(body.name, 80);
  var email = clip(String(body.email || "").toLowerCase(), 320);
  var phone = clip(body.phone, 40);
  var ffl = clip(body.ffl, 200);
  var notes = clip(body.notes, 2000);

  if (!name || name.length < 2) {
    return json(400, {
      ok: false,
      error: "invalid_name",
      userMessage: "Please enter your name."
    });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return json(400, {
      ok: false,
      error: "invalid_email",
      userMessage: "Please enter a valid email address."
    });
  }
  if (!phone || phone.length < 7) {
    return json(400, {
      ok: false,
      error: "invalid_phone",
      userMessage: "Please enter a phone number so we can confirm the request."
    });
  }

  var normalized = normalizeItems(body.items);
  if (!normalized.ok) {
    return json(400, {
      ok: false,
      error: normalized.error,
      userMessage: "Please add valid JP items from the list on this page."
    });
  }

  var secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) {
    console.error("[rettmark] jp-order-request: TURNSTILE_SECRET_KEY is not set");
    return json(503, {
      ok: false,
      error: "turnstile_not_configured",
      userMessage: "Requests are temporarily unavailable. Please email orders@rettmarkfirearms.com."
    });
  }

  var token = String(
    body.turnstileToken || body["cf-turnstile-response"] || body["cf_turnstile_response"] || ""
  ).trim();
  var ip = turnstileVerify.clientIpFromEvent(event);
  var ts = await turnstileVerify.verifyTurnstileForCharge(token, ip);
  if (!ts.ok) {
    return json(ts.status || 400, {
      ok: false,
      error: ts.error || "turnstile_failed",
      userMessage: ts.userMessage || "Security verification failed. Please try again."
    });
  }

  var rl = await checkRateLimit(event, ip);
  if (!rl.ok) {
    return json(429, {
      ok: false,
      error: "rate_limited",
      userMessage: "Too many attempts. Please try again later."
    });
  }

  var payload = {
    name: name,
    email: email,
    phone: phone,
    ffl: ffl,
    notes: notes,
    items: normalized.items,
    totalCents: normalized.totalCents,
    hasFirearm: normalized.hasFirearm
  };

  try {
    var sent = await sendRequestEmails(payload);
    if (!sent.ok) {
      console.error("[rettmark] jp-order-request email", sent.reason || sent.httpStatus || "unknown");
      return json(503, {
        ok: false,
        error: "email_unavailable",
        userMessage: "Could not send the request right now. Please email orders@rettmarkfirearms.com."
      });
    }
  } catch (e) {
    console.error(
      "[rettmark] jp-order-request email error",
      e && e.message ? e.message : String(e)
    );
    return json(503, {
      ok: false,
      error: "email_error",
      userMessage: "Could not send the request right now. Please email orders@rettmarkfirearms.com."
    });
  }

  return json(200, { ok: true });
};
