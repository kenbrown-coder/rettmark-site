/**
 * Optional origin allowlist for browser-facing Functions.
 * CHECKOUT_ALLOWED_ORIGINS — comma-separated origins, e.g.
 *   https://rettmarkfirearms.com,https://www.rettmarkfirearms.com
 * Matching is normalized (scheme + host, case-insensitive host; optional non-default port).
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

function headerValue(event, nameLower) {
  var h = event.headers || {};
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k) && String(k).toLowerCase() === nameLower) {
      return String(h[k] || "").trim();
    }
  }
  return "";
}

function getRequestOrigin(event) {
  return headerValue(event, "origin");
}

/**
 * Canonical origin string for comparison: https://hostname or https://hostname:port
 */
function normalizeOrigin(input) {
  var s = String(input || "").trim();
  if (!s || s.toLowerCase() === "null") return "";
  try {
    var urlStr = s.indexOf("://") !== -1 ? s : "https://" + s;
    var u = new URL(urlStr);
    var scheme = (u.protocol || "https:").replace(/:$/, "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") return "";
    var host = u.hostname.toLowerCase();
    var port = u.port;
    if (port && port !== "80" && port !== "443") {
      return scheme + "://" + host + ":" + port;
    }
    return scheme + "://" + host;
  } catch (e) {
    return "";
  }
}

function originFromReferer(referer) {
  if (!referer) return "";
  try {
    var u = new URL(referer);
    var scheme = u.protocol.replace(/:$/, "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") return "";
    var host = u.hostname.toLowerCase();
    var port = u.port;
    if (port && port !== "80" && port !== "443") {
      return scheme + "://" + host + ":" + port;
    }
    return scheme + "://" + host;
  } catch (e) {
    return "";
  }
}

function buildNormalizedAllowSet(list) {
  var set = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var n = normalizeOrigin(list[i]);
    if (n) set[n] = true;
  }
  return set;
}

/**
 * Same-origin fetch GET often omits Origin. Netlify sends Host + x-forwarded-proto;
 * x-forwarded-host appears when Host differs from public hostname.
 */
function syntheticOriginFromRequest(event) {
  var host =
    headerValue(event, "host") ||
    headerValue(event, "x-forwarded-host").split(",")[0].trim();
  if (!host) return "";
  var proto = headerValue(event, "x-forwarded-proto").split(",")[0].trim().toLowerCase();
  if (proto !== "https" && proto !== "http") proto = "https";
  var lastColon = host.lastIndexOf(":");
  var hostname;
  var portNum = "";
  if (lastColon > 0 && /^\d+$/.test(host.slice(lastColon + 1))) {
    hostname = host.slice(0, lastColon).toLowerCase();
    portNum = host.slice(lastColon + 1);
  } else {
    hostname = host.toLowerCase();
  }
  if (portNum === "80" || portNum === "443") portNum = "";
  if (portNum) {
    return proto + "://" + hostname + ":" + portNum;
  }
  return proto + "://" + hostname;
}

/**
 * @param {object} event Lambda event
 * @param {string} allowMethods e.g. "POST, OPTIONS" or "GET, OPTIONS"
 * @returns {{ ok: boolean, headers: object }}
 */
function corsForRequest(event, allowMethods) {
  var list = parseAllowedOrigins();
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

  var allowedNorm = buildNormalizedAllowSet(list);
  var originHeader = getRequestOrigin(event);
  var refererOrigin = originFromReferer(headerValue(event, "referer"));
  var synthetic = syntheticOriginFromRequest(event);

  var candidates = [originHeader, synthetic, refererOrigin];
  var allowOriginValue = null;
  for (var i = 0; i < candidates.length; i++) {
    var cand = candidates[i];
    if (!cand) continue;
    var n = normalizeOrigin(cand);
    if (n && allowedNorm[n]) {
      allowOriginValue = n;
      break;
    }
  }

  if (allowOriginValue) {
    return {
      ok: true,
      headers: Object.assign(
        {
          "Access-Control-Allow-Origin": allowOriginValue,
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
