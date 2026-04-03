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

/**
 * Hunters HD Gold lines must not receive merchandise discounts or surcharges.
 * Matches cart rows from site.js: shippingClass "glasses" or product URL containing hhdg-.
 */
function isHuntersHdGoldCartLine(item) {
  if (!item || typeof item !== "object") return false;
  if (String(item.shippingClass || "").toLowerCase() === "glasses") return true;
  if (/hhdg-/i.test(String(item.url || ""))) return true;
  return false;
}

function sumCartLineCents(item) {
  var q = parseInt(item.qty, 10) || 0;
  var cents = Math.round((Number(item.price) || 0) * 100);
  return q * cents;
}

/** Full cart subtotal in cents (same math as checkout). */
function sumCartCents(cart) {
  if (!Array.isArray(cart)) return 0;
  var s = 0;
  for (var i = 0; i < cart.length; i++) {
    s += sumCartLineCents(cart[i]);
  }
  return s;
}

/**
 * Subtotal cents for lines that may receive percent/fixed merchandise promos and surcharges.
 * Hunters HD Gold (glasses / hhdg- URLs) is excluded so catalog pricing (e.g. $299.99) is not
 * reduced by merchandise discounts or surcharges.
 */
function sumPromoEligibleMerchCents(cart) {
  if (!Array.isArray(cart)) return 0;
  var s = 0;
  for (var i = 0; i < cart.length; i++) {
    if (!isHuntersHdGoldCartLine(cart[i])) {
      s += sumCartLineCents(cart[i]);
    }
  }
  return s;
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
 * Extra merchandise % stacked on shipping promos (see docs/discount-codes-schema.md).
 * Accepts a few alternate keys in case the private JSON was edited by hand.
 */
function readMerchandiseStackPercent(rule) {
  if (!rule || typeof rule !== "object") return NaN;
  var raw =
    rule.merchandiseDiscountPercent != null && rule.merchandiseDiscountPercent !== ""
      ? rule.merchandiseDiscountPercent
      : rule.merchDiscountPercent != null && rule.merchDiscountPercent !== ""
        ? rule.merchDiscountPercent
        : rule.MerchandiseDiscountPercent != null && rule.MerchandiseDiscountPercent !== ""
          ? rule.MerchandiseDiscountPercent
          : rule.merchandise_discount_percent != null && rule.merchandise_discount_percent !== ""
            ? rule.merchandise_discount_percent
            : rule.merchandiseDiscountPrecent != null && rule.merchandiseDiscountPrecent !== ""
              ? rule.merchandiseDiscountPrecent
              : NaN;
  var n = Number(raw);
  return isFinite(n) ? n : NaN;
}

/**
 * @param {number} shippingCents gross quoted shipping
 * @param {object} rule matched rule
 * @param {number} promoMerchBaseCents merchandise subtotal that may be discounted / surcharged (excludes HHDG)
 * @returns {{ merchDiscCents: number, shipCreditCents: number, surchargeCents: number }}
 */
function computePromoPartsCents(shippingCents, rule, promoMerchBaseCents) {
  var base = Math.max(0, Math.round(Number(promoMerchBaseCents) || 0));
  var subD = base / 100;
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
    var shipResult;
    if (rule.kind === "fixed") {
      var creditD = roundMoney(Math.min(v2, shipD));
      shipResult = {
        merchDiscCents: 0,
        shipCreditCents: Math.round(creditD * 100),
        surchargeCents: 0
      };
    } else if (rule.kind === "percent") {
      var pctS = Math.min(v2, 100);
      var credP = roundMoney((shipD * pctS) / 100);
      shipResult = {
        merchDiscCents: 0,
        shipCreditCents: Math.round(credP * 100),
        surchargeCents: 0
      };
    } else {
      shipResult = { merchDiscCents: 0, shipCreditCents: 0, surchargeCents: 0 };
    }
    var mdp = readMerchandiseStackPercent(rule);
    if (isFinite(mdp) && mdp > 0) {
      mdp = Math.min(mdp, 100);
      var extraD = roundMoney((subD * mdp) / 100);
      var exCents = Math.round(extraD * 100);
      exCents = Math.min(Math.max(0, exCents), base);
      shipResult.merchDiscCents = exCents;
    }
    return shipResult;
  }
  var dollars = computeDiscountDollars(subD, rule);
  var cents = Math.round(dollars * 100);
  cents = Math.min(Math.max(0, cents), base);
  return { merchDiscCents: cents, shipCreditCents: 0, surchargeCents: 0 };
}

/**
 * Merchandise discount, shipping credit, and surcharge (all cents) for a code.
 * @param {string} codeTrim
 * @param {number} subtotalCents
 * @param {number} shippingCents gross shipping before credit
 * @param {object} [lambdaEvent]
 * @param {object[]|null|undefined} cart same shape as checkout cart; used to exclude Hunters HD Gold from merch promos
 * @returns {Promise<{ ok: boolean, merchDiscCents: number, shipCreditCents: number, surchargeCents: number, shippingCreditMaxCents?: number, promoEligibleMerchCents?: number, merchandiseDiscountPercentOffered?: number|null, error?: string }>}
 */
async function resolveExpectedPromoCents(codeTrim, subtotalCents, shippingCents, lambdaEvent, cart) {
  var shipIn = Math.max(0, Math.round(Number(shippingCents) || 0));
  var promoMerchBaseCents = subtotalCents;
  if (Array.isArray(cart)) {
    promoMerchBaseCents = sumPromoEligibleMerchCents(cart);
  }
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
  var parts = computePromoPartsCents(shipIn, rule, promoMerchBaseCents);
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
  out.promoEligibleMerchCents = promoMerchBaseCents;
  if (applyToR === "shipping") {
    var mdpOffer = readMerchandiseStackPercent(rule);
    out.merchandiseDiscountPercentOffered =
      isFinite(mdpOffer) && mdpOffer > 0 ? Math.min(mdpOffer, 100) : null;
  } else {
    out.merchandiseDiscountPercentOffered = null;
  }
  return out;
}

module.exports = {
  githubEnvConfigured,
  fetchDiscountRulesFromGithub,
  findRuleForCode,
  computeDiscountDollars,
  computePromoPartsCents,
  readMerchandiseStackPercent,
  roundMoney,
  resolveExpectedPromoCents,
  sumCartCents,
  sumPromoEligibleMerchCents,
  isHuntersHdGoldCartLine
};
