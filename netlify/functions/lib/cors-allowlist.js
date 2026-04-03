/**
 * Optional origin allowlist for browser-facing Functions.
 * CHECKOUT_ALLOWED_ORIGINS — comma-separated origins, e.g.
 *   https://rettmarkfirearms.com,https://www.rettmarkfirearms.com
 * Matching is normalized (scheme + host, case-insensitive host; optional non-default port).
 * If unset or empty, behaves like legacy * (permissive). Set in production.
 */

function parseAllowedOrigins() {
  var raw = String(process.env.CHECKOUT_ALLOWED_ORIGINS || "")
    .replace(/^\uFEFF/, "")
    .replace(/\uFF0C/g, ",")
    .trim();
  if (!raw) return null;
  if (raw === "*" || raw.toLowerCase() === "any") return null;
  var parts = raw.split(",").map(function (s) {
    return s
      .trim()
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  }).filter(Boolean);
  return parts.length ? parts : null;
}

function isEmptyKeySet(set) {
  for (var k in set) {
    if (Object.prototype.hasOwnProperty.call(set, k)) return false;
  }
  return true;
}

function singleHeaderString(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[v.length - 1] || "").trim();
  return String(v).trim();
}

function headerValue(event, nameLower) {
  var h = event.headers || {};
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k) && String(k).toLowerCase() === nameLower) {
      return singleHeaderString(h[k]);
    }
  }
  var mv = event.multiValueHeaders || {};
  for (var k2 in mv) {
    if (Object.prototype.hasOwnProperty.call(mv, k2) && String(k2).toLowerCase() === nameLower) {
      var arr = mv[k2];
      if (Array.isArray(arr) && arr.length) return singleHeaderString(arr[arr.length - 1]);
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

function addHttpHttpsVariants(set, n) {
  if (!n) return;
  set[n] = true;
  if (n.indexOf("https://") === 0) {
    set["http://" + n.slice(8)] = true;
  } else if (n.indexOf("http://") === 0) {
    set["https://" + n.slice(7)] = true;
  }
}

function buildNormalizedAllowSet(list) {
  var set = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var n = normalizeOrigin(list[i]);
    addHttpHttpsVariants(set, n);
  }
  return set;
}

/** Hostnames from allowlist (for Host-header fallback if Origin/synthetic differ). */
function buildAllowedHostnameSet(list) {
  var set = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var n = normalizeOrigin(list[i]);
    if (!n) continue;
    try {
      var u = new URL(n);
      set[u.hostname.toLowerCase()] = true;
    } catch (e) {}
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
  if (isEmptyKeySet(allowedNorm)) {
    return {
      ok: true,
      headers: Object.assign({ "Access-Control-Allow-Origin": "*" }, base)
    };
  }

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

  if (!allowOriginValue) {
    var allowedHosts = buildAllowedHostnameSet(list);
    var rawHost =
      headerValue(event, "host") ||
      headerValue(event, "x-forwarded-host").split(",")[0].trim();
    var hn = "";
    if (rawHost) {
      var lc = rawHost.lastIndexOf(":");
      if (lc > 0 && /^\d+$/.test(rawHost.slice(lc + 1))) {
        hn = rawHost.slice(0, lc).toLowerCase();
      } else {
        hn = rawHost.toLowerCase();
      }
    }
    if (hn && allowedHosts[hn]) {
      var pr = headerValue(event, "x-forwarded-proto").split(",")[0].trim().toLowerCase();
      if (pr !== "http" && pr !== "https") pr = "https";
      allowOriginValue = pr + "://" + hn;
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
