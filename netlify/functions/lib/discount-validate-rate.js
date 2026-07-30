/**
 * Soft IP rate limit for discount-validate (Blobs when available).
 * Never blocks if Blobs are unavailable.
 */
var RATE_STORE = "rettmark-discount-validate-rate";
var MAX_PER_IP_PER_HOUR = 60;

function hourBucket() {
  return new Date().toISOString().slice(0, 13);
}

function clientIpFromEvent(event) {
  var h = (event && event.headers) || {};
  var xf = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0].trim().slice(0, 64);
  }
  var real = h["x-real-ip"] || h["X-Real-Ip"] || "";
  if (typeof real === "string" && real.trim()) return real.trim().slice(0, 64);
  return "";
}

/**
 * @returns {Promise<{ ok: boolean, limited?: boolean }>}
 */
async function checkRateLimit(event) {
  var ip = clientIpFromEvent(event);
  if (!ip) return { ok: true };
  try {
    var blobs = require("@netlify/blobs");
    if (typeof blobs.connectLambda === "function") {
      blobs.connectLambda(event);
    }
    var store = blobs.getStore(RATE_STORE);
    var key = "ip:" + ip + ":" + hourBucket();
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
      "[rettmark] discount-validate rate-limit skipped",
      e && e.message ? e.message : String(e)
    );
    return { ok: true };
  }
}

module.exports = {
  checkRateLimit,
  clientIpFromEvent
};
