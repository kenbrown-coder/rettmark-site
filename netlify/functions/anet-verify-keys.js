/**
 * GET — Compare ANET_PUBLIC_CLIENT_KEY to the key Authorize.Net returns for your
 * API Login + Transaction Key. Use when Accept.js reports invalid authentication.
 *
 * Does not expose the transaction key. Public client key prefixes are included only
 * if they differ (both are already public once used on checkout).
 *
 * Disabled by default: set ANET_VERIFY_KEYS_ENABLED=1 to expose this endpoint.
 * CORS: optional CHECKOUT_ALLOWED_ORIGINS — see docs/security-checkout.md
 */
var corsAllowlist = require("./lib/cors-allowlist.js");

function buildHeaders(corsResult) {
  return Object.assign(
    {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    corsResult.headers
  );
}

function anetApiUrl() {
  var sandboxRaw = String(
    process.env.ANET_SANDBOX != null ? process.env.ANET_SANDBOX : "true"
  )
    .trim()
    .toLowerCase();
  var useSandbox = sandboxRaw !== "false" && sandboxRaw !== "0";
  return useSandbox
    ? "https://apitest.authorize.net/xml/v1/request.api"
    : "https://api.authorize.net/xml/v1/request.api";
}

function extractPublicClientKey(data) {
  if (!data || typeof data !== "object") return "";
  if (data.publicClientKey) return String(data.publicClientKey).trim();
  var gmdr = data.getMerchantDetailsResponse;
  if (gmdr && gmdr.publicClientKey) return String(gmdr.publicClientKey).trim();

  function walk(obj, depth) {
    if (!obj || typeof obj !== "object" || depth > 8) return "";
    if (typeof obj.publicClientKey === "string" && obj.publicClientKey.length) {
      return String(obj.publicClientKey).trim();
    }
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var found = walk(obj[k], depth + 1);
      if (found) return found;
    }
    return "";
  }

  return walk(data, 0);
}

exports.handler = async function (event) {
  var enabled = String(process.env.ANET_VERIFY_KEYS_ENABLED || "")
    .trim()
    .toLowerCase();
  if (enabled !== "1" && enabled !== "true") {
    return { statusCode: 404, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Not found" };
  }

  var corsResult = corsAllowlist.corsForRequest(event, "GET, OPTIONS");
  function json(status, obj) {
    if (!corsResult.ok) {
      return {
        statusCode: 403,
        headers: Object.assign({ "Content-Type": "application/json" }, corsResult.headers),
        body: JSON.stringify({ error: "Forbidden" })
      };
    }
    return {
      statusCode: status,
      headers: buildHeaders(corsResult),
      body: JSON.stringify(obj)
    };
  }

  if (event.httpMethod === "OPTIONS") {
    if (!corsResult.ok) {
      return { statusCode: 403, headers: corsResult.headers, body: "" };
    }
    return { statusCode: 204, headers: buildHeaders(corsResult), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  if (!corsResult.ok) {
    return {
      statusCode: 403,
      headers: Object.assign({ "Content-Type": "application/json" }, corsResult.headers),
      body: JSON.stringify({ error: "Forbidden" })
    };
  }

  var login = String(
    process.env.ANET_API_LOGIN_ID || process.env.AUTHORIZE_NET_API_LOGIN || ""
  ).trim();
  var key = String(
    process.env.ANET_TRANSACTION_KEY || process.env.AUTHORIZE_NET_TRANSACTION_KEY || ""
  ).trim();
  var envPublic = String(
    process.env.ANET_PUBLIC_CLIENT_KEY || process.env.AUTHORIZE_NET_CLIENT_KEY || ""
  ).trim();

  var sandboxRaw = String(
    process.env.ANET_SANDBOX != null ? process.env.ANET_SANDBOX : "true"
  )
    .trim()
    .toLowerCase();
  var useSandbox = sandboxRaw !== "false" && sandboxRaw !== "0";

  if (!login || !key) {
    return json(503, {
      error: "Missing ANET_API_LOGIN_ID or ANET_TRANSACTION_KEY (Functions scope in Netlify)."
    });
  }

  var payload = {
    getMerchantDetailsRequest: {
      merchantAuthentication: {
        name: login,
        transactionKey: key
      }
    }
  };

  try {
    var res = await fetch(anetApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    var rc = data && data.messages && data.messages.resultCode;
    var official = extractPublicClientKey(data);
    var match = Boolean(official && envPublic && official === envPublic);

    var out = {
      messagesResultCode: rc,
      useSandbox: useSandbox,
      chargeAndVerifyApiHost: useSandbox ? "apitest.authorize.net" : "api.authorize.net",
      acceptJsShouldLoadFrom: useSandbox ? "jstest.authorize.net" : "js.authorize.net",
      envHasPublicClientKey: Boolean(envPublic),
      gatewayReturnedPublicKey: Boolean(official),
      publicClientKeyMatches: match
    };

    if (!match && envPublic && official) {
      out.envPublicKeyPrefix = envPublic.slice(0, 8);
      out.gatewayPublicKeyPrefix = official.slice(0, 8);
      out.hint =
        "ANET_PUBLIC_CLIENT_KEY in Netlify does not match the key tied to this API Login. In Merchant Interface: Account → Security → Manage Public Client Key — copy the shown key, or generate a new one and paste into ANET_PUBLIC_CLIENT_KEY.";
    } else if (!official && rc === "Ok") {
      out.hint =
        "Gateway OK but publicClientKey was not found in the response shape we parse. Contact support with your Authorize.Net API version.";
    } else if (rc && rc !== "Ok") {
      var msg = (data.messages && data.messages.message) || [];
      var arr = Array.isArray(msg) ? msg : [msg];
      out.gatewayError = arr
        .map(function (m) {
          return m && m.text ? m.text : "";
        })
        .filter(Boolean)
        .join("; ");
      out.hint =
        "Merchant authentication to Authorize.Net failed. Confirm ANET_API_LOGIN_ID and ANET_TRANSACTION_KEY (Transaction Key, not Signature Key) and that ANET_SANDBOX matches sandbox vs production credentials.";
    } else if (match) {
      out.hint =
        "Public client key matches Authorize.Net. If checkout still fails, try a new Public Client Key anyway, confirm ANET_SANDBOX matches this environment, and test in a private window.";
    }

    return json(200, out);
  } catch (e) {
    return json(502, { error: "Could not reach Authorize.Net", detail: String(e && e.message) });
  }
};
