/**
 * Load discount rules JSON from a private GitHub repo (Contents API).
 * Env: GITHUB_DISCOUNT_TOKEN, GITHUB_DISCOUNT_OWNER, GITHUB_DISCOUNT_REPO,
 *      GITHUB_DISCOUNT_PATH, optional GITHUB_DISCOUNT_REF (default main).
 */

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function githubEnvConfigured() {
  var token = String(process.env.GITHUB_DISCOUNT_TOKEN || "").trim();
  var owner = String(process.env.GITHUB_DISCOUNT_OWNER || "").trim();
  var repo = String(process.env.GITHUB_DISCOUNT_REPO || "").trim();
  var path = String(process.env.GITHUB_DISCOUNT_PATH || "").trim();
  return Boolean(token && owner && repo && path);
}

/**
 * @returns {Promise<{ ok: boolean, rules: object[]|null, error: string|null }>}
 */
async function fetchDiscountRulesFromGithub() {
  var token = String(process.env.GITHUB_DISCOUNT_TOKEN || "").trim();
  var owner = String(process.env.GITHUB_DISCOUNT_OWNER || "").trim();
  var repo = String(process.env.GITHUB_DISCOUNT_REPO || "").trim();
  var path = String(process.env.GITHUB_DISCOUNT_PATH || "").trim();
  var ref = String(process.env.GITHUB_DISCOUNT_REF || "main").trim();
  if (!token || !owner || !repo || !path) {
    return { ok: false, rules: null, error: "missing_env" };
  }
  var encPath = path
    .split("/")
    .filter(Boolean)
    .map(function (seg) {
      return encodeURIComponent(seg);
    })
    .join("/");
  var url =
    "https://api.github.com/repos/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repo) +
    "/contents/" +
    encPath +
    "?ref=" +
    encodeURIComponent(ref);
  var res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rettmark-netlify-discount"
    }
  });
  if (!res.ok) {
    return { ok: false, rules: null, error: "github_" + res.status };
  }
  var data = await res.json();
  if (!data || data.type !== "file" || !data.content || data.encoding !== "base64") {
    return { ok: false, rules: null, error: "github_bad_payload" };
  }
  var jsonStr = Buffer.from(String(data.content).replace(/\s/g, ""), "base64").toString("utf8");
  var arr = JSON.parse(jsonStr);
  if (!Array.isArray(arr)) {
    return { ok: false, rules: null, error: "json_not_array" };
  }
  return { ok: true, rules: arr, error: null };
}

function findRuleForCode(rules, code) {
  var key = String(code || "").trim().toUpperCase();
  if (!key || !Array.isArray(rules)) return null;
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    if (!r || typeof r.code !== "string") continue;
    if (String(r.code).trim().toUpperCase() !== key) continue;
    if (r.active === false) return null;
    if (r.expiresAt) {
      var t = Date.parse(String(r.expiresAt));
      if (!isNaN(t) && Date.now() > t) return null;
    }
    return r;
  }
  return null;
}

/**
 * @param {number} subtotalDollars
 * @param {object} def rule object
 * @returns {number} dollars discounted
 */
function computeDiscountDollars(subtotalDollars, def) {
  if (!def || !def.kind) return 0;
  var sub = Number(subtotalDollars);
  if (!isFinite(sub) || sub < 0) sub = 0;
  var v = Number(def.value);
  if (!isFinite(v) || v < 0) return 0;
  if (def.kind === "percent") {
    var pct = Math.min(v, 100);
    return roundMoney((sub * pct) / 100);
  }
  if (def.kind === "fixed") {
    return roundMoney(Math.min(v, sub));
  }
  return 0;
}

/**
 * @param {number} subtotalCents
 * @param {number} shippingCents gross quoted shipping
 * @param {object} rule matched rule
 * @returns {{ merchDiscCents: number, shipCreditCents: number, surchargeCents: number }}
 */
function computePromoPartsCents(subtotalCents, shippingCents, rule) {
  var subD = subtotalCents / 100;
  var shipD = shippingCents / 100;
  if (!rule || !rule.kind) {
    return { merchDiscCents: 0, shipCreditCents: 0, surchargeCents: 0 };
  }
  if (rule.kind === "surcharge_percent") {
    var sp = Number(rule.value);
    if (!isFinite(sp) || sp < 0) sp = 0;
    sp = Math.min(sp, 500);
    var sur = roundMoney((subD * sp) / 100);
    return {
      merchDiscCents: 0,
      shipCreditCents: 0,
      surchargeCents: Math.round(sur * 100)
    };
  }
  var applyTo = String(rule.applyTo || "merchandise").toLowerCase();
  if (applyTo === "shipping") {
    var v2 = Number(rule.value);
    if (!isFinite(v2) || v2 < 0) v2 = 0;
    if (rule.kind === "fixed") {
      var creditD = roundMoney(Math.min(v2, shipD));
      return {
        merchDiscCents: 0,
        shipCreditCents: Math.round(creditD * 100),
        surchargeCents: 0
      };
    }
    if (rule.kind === "percent") {
      var pctS = Math.min(v2, 100);
      var credP = roundMoney((shipD * pctS) / 100);
      return {
        merchDiscCents: 0,
        shipCreditCents: Math.round(credP * 100),
        surchargeCents: 0
      };
    }
    return { merchDiscCents: 0, shipCreditCents: 0, surchargeCents: 0 };
  }
  var dollars = computeDiscountDollars(subD, rule);
  var cents = Math.round(dollars * 100);
  cents = Math.min(Math.max(0, cents), subtotalCents);
  return { merchDiscCents: cents, shipCreditCents: 0, surchargeCents: 0 };
}

/**
 * Merchandise discount, shipping credit, and surcharge (all cents) for a code.
 * @param {string} codeTrim
 * @param {number} subtotalCents
 * @param {number} shippingCents gross shipping before credit
 * @param {object} [lambdaEvent]
 * @returns {Promise<{ ok: boolean, merchDiscCents: number, shipCreditCents: number, surchargeCents: number, shippingCreditMaxCents?: number, error?: string }>}
 */
async function resolveExpectedPromoCents(codeTrim, subtotalCents, shippingCents, lambdaEvent) {
  var shipIn = Math.max(0, Math.round(Number(shippingCents) || 0));
  if (!codeTrim) {
    return { ok: true, merchDiscCents: 0, shipCreditCents: 0, surchargeCents: 0 };
  }
  if (!githubEnvConfigured()) {
    return {
      ok: false,
      merchDiscCents: 0,
      shipCreditCents: 0,
      surchargeCents: 0,
      error: "discount_validation_unconfigured"
    };
  }
  var loaded = await fetchDiscountRulesFromGithub();
  if (!loaded.ok || !loaded.rules) {
    return {
      ok: false,
      merchDiscCents: 0,
      shipCreditCents: 0,
      surchargeCents: 0,
      error: "discount_rules_unavailable"
    };
  }
  var rule = findRuleForCode(loaded.rules, codeTrim);
  if (!rule) {
    return {
      ok: false,
      merchDiscCents: 0,
      shipCreditCents: 0,
      surchargeCents: 0,
      error: "invalid_discount_code"
    };
  }
  var maxUsesNum = Number(rule.maxUses);
  if (isFinite(maxUsesNum) && maxUsesNum > 0) {
    var usage = require("./discount-usage-blobs.js");
    var used = await usage.getUseCount(lambdaEvent, codeTrim);
    if (used === null) {
      return {
        ok: false,
        merchDiscCents: 0,
        shipCreditCents: 0,
        surchargeCents: 0,
        error: "discount_usage_unavailable"
      };
    }
    if (used >= Math.floor(maxUsesNum)) {
      return {
        ok: false,
        merchDiscCents: 0,
        shipCreditCents: 0,
        surchargeCents: 0,
        error: "discount_code_exhausted"
      };
    }
  }
  var parts = computePromoPartsCents(subtotalCents, shipIn, rule);
  var sc = Math.min(Math.max(0, parts.shipCreditCents), shipIn);
  var out = {
    ok: true,
    merchDiscCents: parts.merchDiscCents,
    shipCreditCents: sc,
    surchargeCents: Math.max(0, parts.surchargeCents)
  };
  var applyToR = String(rule.applyTo || "merchandise").toLowerCase();
  if (applyToR === "shipping" && rule.kind === "fixed") {
    var capVal = Number(rule.value);
    if (isFinite(capVal) && capVal >= 0) {
      out.shippingCreditMaxCents = Math.round(roundMoney(capVal) * 100);
    }
  }
  return out;
}

module.exports = {
  githubEnvConfigured,
  fetchDiscountRulesFromGithub,
  findRuleForCode,
  computeDiscountDollars,
  computePromoPartsCents,
  roundMoney,
  resolveExpectedPromoCents
};
