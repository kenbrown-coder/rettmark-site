/**
 * Public Accept.js settings (no transaction key). Avoids writing API Login ID into static js/* for Netlify secret scan.
 * GET /.netlify/functions/anet-public-config
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

  var clientKey =
    process.env.ANET_PUBLIC_CLIENT_KEY || process.env.AUTHORIZE_NET_CLIENT_KEY || "";
  var apiLoginId =
    process.env.ANET_API_LOGIN_ID || process.env.AUTHORIZE_NET_API_LOGIN || "";
  var sandboxRaw = (process.env.ANET_SANDBOX || "true").toLowerCase();
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
