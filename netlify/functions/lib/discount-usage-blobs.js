/**
 * Persist discount redemption counts in Netlify Blobs (site-scoped).
 * Limited-use codes: tryReserveUse (CAS) before Authorize.Net charge; releaseUse if declined.
 *
 * Lambda compatibility: call connectLambda(event) before getStore (see Netlify Blobs docs).
 */

var STORE_NAME = "rettmark-discount-usage";

/** Netlify Blobs has no built-in deadline; a stuck store call would block checkout until the function limit. */
var BLOBS_DEADLINE_MS = 8000;
var CAS_ATTEMPTS = 8;

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

function usageKey(code) {
  return "uses/" + normalizeCode(code);
}

async function getStoreConnected(lambdaEvent) {
  var blobs = require("@netlify/blobs");
  if (lambdaEvent && typeof blobs.connectLambda === "function") {
    blobs.connectLambda(lambdaEvent);
  }
  return blobs.getStore(STORE_NAME);
}

function readCount(entry) {
  if (entry && typeof entry.count === "number" && isFinite(entry.count)) {
    return Math.max(0, Math.floor(entry.count));
  }
  return 0;
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
        var entry = await store.get(usageKey(key), { type: "json", consistency: "strong" });
        return readCount(entry);
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
 * Atomically increment usage if under maxUses (ETag / onlyIfNew CAS).
 * Call immediately before charging; call releaseUse if the charge is not approved.
 * @returns {Promise<{ ok: boolean, error?: string, count?: number }>}
 */
async function tryReserveUse(lambdaEvent, code, maxUses) {
  var key = normalizeCode(code);
  var max = Math.floor(Number(maxUses) || 0);
  if (!key || !(max > 0)) {
    return { ok: true, skipped: true };
  }

  try {
    return await withBlobsDeadline(
      (async function () {
        var store = await getStoreConnected(lambdaEvent);
        for (var attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
          var got = await store.getWithMetadata(usageKey(key), {
            type: "json",
            consistency: "strong"
          });
          var data = got && got.data;
          var etag = got && got.etag;
          var n = readCount(data);

          if (n >= max) {
            return { ok: false, error: "exhausted", count: n };
          }

          var next = { count: n + 1 };
          var writeOpts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
          var written = await store.setJSON(usageKey(key), next, writeOpts);
          if (written && written.modified) {
            return { ok: true, count: next.count };
          }
        }
        return { ok: false, error: "unavailable" };
      })(),
      "tryReserveUse:" + key
    );
  } catch (e) {
    var msg = e && e.message ? String(e.message) : String(e);
    if (msg.indexOf("blobs_deadline:") === 0) {
      console.error("[rettmark] discount tryReserveUse timed out", key);
    } else {
      console.error("[rettmark] discount tryReserveUse failed", msg);
    }
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Decrement after a failed/declined charge that had reserved a limited-use slot.
 */
async function releaseUse(lambdaEvent, code) {
  var key = normalizeCode(code);
  if (!key) return;

  try {
    await withBlobsDeadline(
      (async function () {
        var store = await getStoreConnected(lambdaEvent);
        for (var attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
          var got = await store.getWithMetadata(usageKey(key), {
            type: "json",
            consistency: "strong"
          });
          var data = got && got.data;
          var etag = got && got.etag;
          if (!data && !etag) {
            return;
          }
          var n = readCount(data);
          if (n <= 0) {
            return;
          }
          var next = { count: n - 1 };
          var written = await store.setJSON(usageKey(key), next, { onlyIfMatch: etag });
          if (written && written.modified) {
            return;
          }
        }
        console.error("[rettmark] discount releaseUse CAS exhausted", key);
      })(),
      "releaseUse:" + key
    );
  } catch (e) {
    var msg = e && e.message ? String(e.message) : String(e);
    if (msg.indexOf("blobs_deadline:") === 0) {
      console.error("[rettmark] discount releaseUse timed out", key);
    } else {
      console.error("[rettmark] discount releaseUse failed", msg);
    }
  }
}

/**
 * Legacy post-success increment (prefer tryReserveUse before charge).
 * Kept for callers that still need a best-effort bump without CAS.
 */
async function incrementUseCount(lambdaEvent, code) {
  var key = normalizeCode(code);
  if (!key) return;
  try {
    await withBlobsDeadline(
      (async function () {
        var store = await getStoreConnected(lambdaEvent);
        var entry = await store.get(usageKey(key), { type: "json", consistency: "strong" });
        var n = readCount(entry);
        await store.setJSON(usageKey(key), { count: n + 1 });
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
  tryReserveUse,
  releaseUse,
  incrementUseCount,
  normalizeCode
};
