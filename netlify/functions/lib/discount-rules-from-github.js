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
 * Expected discount cents from GitHub rules, or null if invalid / unavailable.
 * @param {string} codeTrim
 * @param {number} subtotalCents
 * @param {object} [lambdaEvent] Netlify function event (for Netlify Blobs + connectLambda).
 * @returns {Promise<{ ok: boolean, expectedCents: number, error?: string }>}
 */
async function resolveExpectedDiscountCents(codeTrim, subtotalCents, lambdaEvent) {
  var subDollars = subtotalCents / 100;
  if (!codeTrim) {
    return { ok: true, expectedCents: 0 };
  }
  if (!githubEnvConfigured()) {
    return { ok: false, expectedCents: 0, error: "discount_validation_unconfigured" };
  }
  var loaded = await fetchDiscountRulesFromGithub();
  if (!loaded.ok || !loaded.rules) {
    return { ok: false, expectedCents: 0, error: "discount_rules_unavailable" };
  }
  var rule = findRuleForCode(loaded.rules, codeTrim);
  if (!rule) {
    return { ok: false, expectedCents: 0, error: "invalid_discount_code" };
  }
  var maxUsesNum = Number(rule.maxUses);
  if (isFinite(maxUsesNum) && maxUsesNum > 0) {
    var usage = require("./discount-usage-blobs.js");
    var used = await usage.getUseCount(lambdaEvent, codeTrim);
    if (used === null) {
      return { ok: false, expectedCents: 0, error: "discount_usage_unavailable" };
    }
    if (used >= Math.floor(maxUsesNum)) {
      return { ok: false, expectedCents: 0, error: "discount_code_exhausted" };
    }
  }
  var dollars = computeDiscountDollars(subDollars, rule);
  var cents = Math.round(dollars * 100);
  cents = Math.min(Math.max(0, cents), subtotalCents);
  return { ok: true, expectedCents: cents };
}

module.exports = {
  githubEnvConfigured,
  fetchDiscountRulesFromGithub,
  findRuleForCode,
  computeDiscountDollars,
  roundMoney,
  resolveExpectedDiscountCents
};
