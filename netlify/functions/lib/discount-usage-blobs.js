/**
 * Persist discount redemption counts in Netlify Blobs (site-scoped).
 * Requires @netlify/blobs. Increments only after successful payment in anet-transaction.
 *
 * Lambda compatibility: call connectLambda(event) before getStore (see Netlify Blobs docs).
 */

var STORE_NAME = "rettmark-discount-usage";

/** Match discount-rules-from-github findRuleForCode (trim + uppercase). */
function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function getStoreConnected(lambdaEvent) {
  var blobs = require("@netlify/blobs");
  if (lambdaEvent && typeof blobs.connectLambda === "function") {
    blobs.connectLambda(lambdaEvent);
  }
  return blobs.getStore(STORE_NAME);
}

/**
 * @returns {Promise<number|null>} Redemption count, or null if storage failed.
 */
async function getUseCount(lambdaEvent, code) {
  var key = normalizeCode(code);
  if (!key) return 0;
  try {
    var store = await getStoreConnected(lambdaEvent);
    var entry = await store.get("uses/" + key, { type: "json" });
    if (entry && typeof entry.count === "number" && isFinite(entry.count)) {
      return Math.max(0, Math.floor(entry.count));
    }
    return 0;
  } catch (e) {
    console.warn("[rettmark] discount getUseCount failed", e && e.message ? e.message : String(e));
    return null;
  }
}

/**
 * Call after payment succeeds when a code was applied.
 */
async function incrementUseCount(lambdaEvent, code) {
  var key = normalizeCode(code);
  if (!key) return;
  try {
    var store = await getStoreConnected(lambdaEvent);
    var entry = await store.get("uses/" + key, { type: "json" });
    var n = 0;
    if (entry && typeof entry.count === "number" && isFinite(entry.count)) {
      n = Math.max(0, Math.floor(entry.count));
    }
    await store.setJSON("uses/" + key, { count: n + 1 });
  } catch (e) {
    console.error("[rettmark] discount incrementUseCount failed", e && e.message ? e.message : String(e));
  }
}

module.exports = {
  getUseCount,
  incrementUseCount,
  normalizeCode
};
