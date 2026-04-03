/**
 * Optional origin allowlist for browser-facing Functions.
 * CHECKOUT_ALLOWED_ORIGINS — comma-separated exact origins, e.g.
 *   https://rettmarkfirearms.com,https://www.rettmarkfirearms.com
 * If unset or empty, behaves like legacy * (permissive). Set in production.
 */

function parseAllowedOrigins() {
  var raw = String(process.env.CHECKOUT_ALLOWED_ORIGINS || "").trim();
  if (!raw) return null;
  var parts = raw.split(",").map(function (s) {
    return s.trim();
  }).filter(Boolean);
  return parts.length ? parts : null;
}

function getRequestOrigin(event) {
  var h = event.headers || {};
  var origin = "";
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k) && String(k).toLowerCase() === "origin") {
      origin = String(h[k] || "").trim();
      break;
    }
  }
  return origin;
}

/**
 * @param {object} event Lambda event
 * @param {string} allowMethods e.g. "POST, OPTIONS" or "GET, OPTIONS"
 * @returns {{ ok: boolean, headers: object }}
 */
function corsForRequest(event, allowMethods) {
  var list = parseAllowedOrigins();
  var origin = getRequestOrigin(event);
  var base = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": allowMethods
  };

  if (!list) {
    return {
      ok: true,
      headers: Object.assign({ "Access-Control-Allow-Origin": "*" }, base)
    };
  }

  if (origin && list.indexOf(origin) !== -1) {
    return {
      ok: true,
      headers: Object.assign(
        {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin"
        },
        base
      )
    };
  }

  return {
    ok: false,
    headers: base
  };
}

module.exports = {
  corsForRequest,
  getRequestOrigin,
  parseAllowedOrigins
};
