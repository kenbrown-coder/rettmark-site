/**
 * Public Accept.js settings (no transaction key). Avoids writing API Login ID into static js/* for Netlify secret scan.
 * GET /.netlify/functions/anet-public-config
 *
 * ANET_SANDBOX: true → jstest.authorize.net; false → js.authorize.net (live account + UI Test Mode → false).
 * In Netlify, scope this variable for Functions (or “All”), not Builds-only — otherwise functions see it as unset and default to sandbox.
 */
function headers() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store"
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headers(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: headers(), body: JSON.stringify({ error: "Method not allowed" }) };
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
    headers: headers(),
    body: JSON.stringify({
      clientKey: clientKey,
      apiLoginId: apiLoginId,
      sandbox: sandbox
    })
  };
};
