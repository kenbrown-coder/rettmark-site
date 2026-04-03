/**
 * Cloudflare Turnstile server-side verification for charges.
 * Env: TURNSTILE_SECRET_KEY (optional), REQUIRE_TURNSTILE_ON_CHARGE=1 (optional).
 */

/**
 * @param {string} [token] from client body.turnstileToken
 * @param {string} [remoteIp] first hop from x-forwarded-for
 * @returns {Promise<{ ok: boolean, skipped?: boolean, status?: number, error?: string, userMessage?: string }>}
 */
async function verifyTurnstileForCharge(token, remoteIp) {
  var secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  var requireSecret = String(process.env.REQUIRE_TURNSTILE_ON_CHARGE || "")
    .trim()
    .toLowerCase();

  if (!secret) {
    if (requireSecret === "1" || requireSecret === "true") {
      return {
        ok: false,
        status: 503,
        error: "turnstile_not_configured",
        userMessage: "Payment security is not fully configured. Please try again later."
      };
    }
    return { ok: true, skipped: true };
  }

  if (!token || typeof token !== "string" || !String(token).trim()) {
    return {
      ok: false,
      status: 400,
      error: "turnstile_required",
      userMessage: "Security verification required. Please refresh and try again."
    };
  }

  var params = new URLSearchParams();
  params.append("secret", secret);
  params.append("response", String(token).trim());
  if (remoteIp) {
    params.append("remoteip", String(remoteIp).trim().slice(0, 45));
  }

  try {
    var res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString()
    });
    var data = await res.json();
    if (data && data.success === true) {
      return { ok: true, skipped: false };
    }
    var codes = data && data["error-codes"];
    console.warn("[rettmark] Turnstile siteverify failed", codes || "(no codes)");
    return {
      ok: false,
      status: 400,
      error: "turnstile_failed",
      userMessage: "Security verification failed. Please try again."
    };
  } catch (e) {
    console.error("[rettmark] Turnstile siteverify error", e && e.message ? e.message : String(e));
    return {
      ok: false,
      status: 503,
      error: "turnstile_unreachable",
      userMessage: "Could not verify security check. Please try again shortly."
    };
  }
}

function clientIpFromEvent(event) {
  var h = event.headers || {};
  var fwd = "";
  for (var k in h) {
    if (!Object.prototype.hasOwnProperty.call(h, k)) continue;
    if (String(k).toLowerCase() === "x-forwarded-for") {
      fwd = String(h[k] || "");
      break;
    }
  }
  var first = fwd.split(",")[0];
  return String(first || "").trim();
}

module.exports = {
  verifyTurnstileForCharge,
  clientIpFromEvent
};
