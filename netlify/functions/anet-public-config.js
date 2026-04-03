/**
 * Public Accept.js settings (no transaction key). Avoids writing API Login ID into static js/* for Netlify secret scan.
 * GET /.netlify/functions/anet-public-config
 *
 * ANET_PUBLIC_CLIENT_KEY — “Public Client Key” from Merchant Interface → Security Settings → Manage Public Client Key.
 *   Not the Transaction Key and not the Signature Key.
 * ANET_API_LOGIN_ID — same API Login ID you use with the Transaction Key on the server.
 *
 * ANET_SANDBOX: true → jstest.authorize.net; false → js.authorize.net (live account + UI Test Mode → false).
 * In Netlify, scope this variable for Functions (or “All”), not Builds-only — otherwise functions see it as unset and default to sandbox.
 *
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

exports.handler = async function (event) {
  var corsResult = corsAllowlist.corsForRequest(event, "GET, OPTIONS");

  if (event.httpMethod === "OPTIONS") {
    if (!corsResult.ok) {
      return { statusCode: 403, headers: corsResult.headers, body: "" };
    }
    return { statusCode: 204, headers: buildHeaders(corsResult), body: "" };
  }
  if (event.httpMethod !== "GET") {
    if (!corsResult.ok) {
      return { statusCode: 403, headers: corsResult.headers, body: JSON.stringify({ error: "Forbidden" }) };
    }
    return {
      statusCode: 405,
      headers: buildHeaders(corsResult),
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  if (!corsResult.ok) {
    return {
      statusCode: 403,
      headers: Object.assign({ "Content-Type": "application/json" }, corsResult.headers),
      body: JSON.stringify({ error: "Forbidden" })
    };
  }

  var clientKey = String(
    process.env.ANET_PUBLIC_CLIENT_KEY || process.env.AUTHORIZE_NET_CLIENT_KEY || ""
  ).trim();
  var apiLoginId = String(
    process.env.ANET_API_LOGIN_ID || process.env.AUTHORIZE_NET_API_LOGIN || ""
  ).trim();
  // Default "true" only when unset. Trim handles pasted whitespace; Netlify must expose this var to Functions (not Builds-only).
  var sandboxRaw = String(process.env.ANET_SANDBOX != null ? process.env.ANET_SANDBOX : "true")
    .trim()
    .toLowerCase();
  var sandbox = sandboxRaw !== "false" && sandboxRaw !== "0";

  return {
    statusCode: 200,
    headers: buildHeaders(corsResult),
    body: JSON.stringify({
      clientKey: clientKey,
      apiLoginId: apiLoginId,
      sandbox: sandbox
    })
  };
};
