/**
 * Email-updates (notify) signup — server-side gate in front of Google Apps Script.
 *
 * Bots were POSTing directly to the public script.google.com URL, bypassing the
 * browser Turnstile widget. This function:
 *   1) checks honeypot
 *   2) verifies Cloudflare Turnstile (TURNSTILE_SECRET_KEY)
 *   3) lightly rate-limits by IP (Netlify Blobs when available)
 *   4) forwards to NOTIFY_GOOGLE_SCRIPT_URL with NOTIFY_WEBHOOK_SECRET
 *
 * Env (Netlify → Environment variables):
 *   TURNSTILE_SECRET_KEY     — required (fail closed)
 *   NOTIFY_GOOGLE_SCRIPT_URL — Apps Script /exec URL (keep out of HTML)
 *   NOTIFY_WEBHOOK_SECRET    — shared secret; Apps Script must require the same
 *   CHECKOUT_ALLOWED_ORIGINS — same CORS allowlist as checkout (recommended)
 */

var corsAllowlist = require("./lib/cors-allowlist.js");
var turnstileVerify = require("./lib/turnstile-verify.js");

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var MAX_PER_IP_PER_HOUR = 8;
var RATE_STORE = "rettmark-notify-rate";

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

/**
 * Soft rate limit; never blocks signup if Blobs are unavailable.
 * @returns {Promise<{ ok: boolean, limited?: boolean }>}
 */
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
      "[rettmark] notify rate-limit skipped",
      e && e.message ? e.message : String(e)
    );
    return { ok: true };
  }
}

async function forwardToAppsScript(email) {
  var url = String(process.env.NOTIFY_GOOGLE_SCRIPT_URL || "").trim();
  var secret = String(process.env.NOTIFY_WEBHOOK_SECRET || "").trim();
  if (!url) {
    return { ok: false, reason: "missing_NOTIFY_GOOGLE_SCRIPT_URL" };
  }
  if (!secret) {
    return { ok: false, reason: "missing_NOTIFY_WEBHOOK_SECRET" };
  }

  var body = new URLSearchParams();
  body.set("email", email);
  body.set("bot-field", "");
  body.set("source", "Website");
  body.set("webhookSecret", secret);

  var opts = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
    redirect: "follow"
  };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    opts.signal = AbortSignal.timeout(15000);
  }

  var res = await fetch(url, opts);
  if (!res.ok) {
    var text = "";
    try {
      text = await res.text();
    } catch (e) {}
    console.error(
      "[rettmark] Apps Script forward failed",
      res.status,
      text ? text.slice(0, 300) : ""
    );
    return { ok: false, reason: "forward_failed", status: res.status };
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

  // Honeypot — bots that fill hidden fields are dropped quietly (looks like success).
  if (String(body["bot-field"] || body.botField || "").trim()) {
    return json(200, { ok: true, skipped: true });
  }

  var email = String(body.email || "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return json(400, {
      ok: false,
      error: "invalid_email",
      userMessage: "Please enter a valid email address."
    });
  }

  var secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) {
    console.error("[rettmark] notify-subscribe: TURNSTILE_SECRET_KEY is not set");
    return json(503, {
      ok: false,
      error: "turnstile_not_configured",
      userMessage: "Sign-up is temporarily unavailable. Please try again later."
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

  try {
    var fwd = await forwardToAppsScript(email);
    if (!fwd.ok) {
      console.error("[rettmark] notify-subscribe forward", fwd.reason || "unknown");
      return json(503, {
        ok: false,
        error: "upstream_unavailable",
        userMessage: "Sign-up is temporarily unavailable. Please try again later."
      });
    }
  } catch (e) {
    console.error(
      "[rettmark] notify-subscribe forward error",
      e && e.message ? e.message : String(e)
    );
    return json(503, {
      ok: false,
      error: "upstream_error",
      userMessage: "Sign-up is temporarily unavailable. Please try again later."
    });
  }

  return json(200, { ok: true });
};
