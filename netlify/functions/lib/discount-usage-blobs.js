/**
 * Persist discount redemption counts in Netlify Blobs (site-scoped).
 * Requires @netlify/blobs. Increments only after successful payment in anet-transaction.
 *
 * Lambda compatibility: call connectLambda(event) before getStore (see Netlify Blobs docs).
 */

var STORE_NAME = "rettmark-discount-usage";

/** Netlify Blobs has no built-in deadline; a stuck store call would block checkout until the function limit. */
var BLOBS_DEADLINE_MS = 8000;

function withBlobsDeadline(promise, label) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error("blobs_deadline:" + String(label || "op")));
      }, BLOBS_DEADLINE_MS);
    })
  ]);
}

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
    return await withBlobsDeadline(
      (async function () {
        var store = await getStoreConnected(lambdaEvent);
        var entry = await store.get("uses/" + key, { type: "json" });
        if (entry && typeof entry.count === "number" && isFinite(entry.count)) {
          return Math.max(0, Math.floor(entry.count));
        }
        return 0;
      })(),
      "getUseCount:" + key
    );
  } catch (e) {
    var msg = e && e.message ? String(e.message) : String(e);
    if (msg.indexOf("blobs_deadline:") === 0) {
      console.warn("[rettmark] discount getUseCount timed out", key);
    } else {
      console.warn("[rettmark] discount getUseCount failed", msg);
    }
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
    await withBlobsDeadline(
      (async function () {
        var store = await getStoreConnected(lambdaEvent);
        var entry = await store.get("uses/" + key, { type: "json" });
        var n = 0;
        if (entry && typeof entry.count === "number" && isFinite(entry.count)) {
          n = Math.max(0, Math.floor(entry.count));
        }
        await store.setJSON("uses/" + key, { count: n + 1 });
      })(),
      "incrementUseCount:" + key
    );
  } catch (e) {
    var msg = e && e.message ? String(e.message) : String(e);
    if (msg.indexOf("blobs_deadline:") === 0) {
      console.error("[rettmark] discount incrementUseCount timed out", key);
    } else {
      console.error("[rettmark] discount incrementUseCount failed", msg);
    }
  }
}

module.exports = {
  getUseCount,
  incrementUseCount,
  normalizeCode
};
