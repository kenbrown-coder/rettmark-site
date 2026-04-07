/**
 * Rettmark — flat shipping rules (no carrier APIs).
 *
 * Cart lines should include `shippingClass`: "glasses" | "casebag" (see site.js).
 * Legacy lines without it: URL containing "hhdg-" → glasses, else casebag.
 *
 * - Glasses-only (Hunters HD Gold / HHDG): flat casebag.base ($14.99) when there is glasses
 *   merchandise; no per-$100 scaling. If they also order any case/bag (qty &gt; 0), the glasses
 *   shipping line is waived (ship with the rest).
 * - Cases & bags: $14.99 when their merchandise subtotal is $0 < subtotal ≤ $100;
 *   above $100, add $5 for each $100 increment (e.g. $100.01 → $19.99, $200.01 → $24.99).
 */
(function (global) {
  global.RETTMARK_SHIPPING_RULES = {
    /** Cases/bags tiers; `base` is also the flat rate for glasses-only orders (no tier scaling on glasses). */
    casebag: {
      /** Merchandise subtotal from $0.01 through this amount → base only. */
      firstTierMax: 100,
      base: 14.99,
      /** Added for each full $100 increment above firstTierMax. */
      perHundred: 5,
      step: 100
    },
    /**
     * Optional: when ship country is not US, multiply the **combined** flat total by this.
     * 1 = same dollars as domestic.
     */
    internationalMultiplier: 1
  };

  function mergeRules() {
    var r = global.RETTMARK_SHIPPING_RULES;
    if (!r || typeof r !== "object") r = {};
    var c = r.casebag && typeof r.casebag === "object" ? r.casebag : {};
    return {
      casebag: {
        firstTierMax: Math.max(0, Number(c.firstTierMax) || 100),
        base: Math.max(0, Number(c.base) || 0),
        perHundred: Math.max(0, Number(c.perHundred) || 0),
        step: Math.max(1, Number(c.step) || 100)
      },
      internationalMultiplier: Math.max(0, Number(r.internationalMultiplier) || 1)
    };
  }

  function inferShippingClass(item) {
    var u = String((item && item.url) || "").toLowerCase();
    if (u.indexOf("hhdg-") !== -1) return "glasses";
    if (item && item.shippingClass === "glasses") return "glasses";
    return "casebag";
  }

  function lineSubtotal(item) {
    var q = Math.max(0, parseInt(item && item.qty, 10) || 0);
    var p = Number(item && item.price) || 0;
    return Math.round(q * p * 100) / 100;
  }

  function sumSubtotalByClass(cart, cls) {
    if (!Array.isArray(cart)) return 0;
    var sum = 0;
    for (var i = 0; i < cart.length; i++) {
      if (inferShippingClass(cart[i]) === cls) {
        sum += lineSubtotal(cart[i]);
      }
    }
    return Math.round(sum * 100) / 100;
  }

  function hasLineClass(cart, cls) {
    if (!Array.isArray(cart)) return false;
    for (var i = 0; i < cart.length; i++) {
      if (inferShippingClass(cart[i]) === cls) return true;
    }
    return false;
  }

  /** Any case/bag line with quantity &gt; 0 (triggers free glasses shipping add-on). */
  function hasCasebagQuantity(cart) {
    if (!Array.isArray(cart)) return false;
    for (var i = 0; i < cart.length; i++) {
      if (inferShippingClass(cart[i]) !== "casebag") continue;
      var q = Math.max(0, parseInt(cart[i].qty, 10) || 0);
      if (q > 0) return true;
    }
    return false;
  }

  function casebagShippingAmount(sub, rules) {
    var c = rules.casebag;
    if (!(sub > 0)) return 0;
    if (sub <= c.firstTierMax) {
      return Math.round(c.base * 100) / 100;
    }
    var over = sub - c.firstTierMax;
    var steps = Math.ceil(over / c.step);
    var add = steps * c.perHundred;
    return Math.round((c.base + add) * 100) / 100;
  }

  function isDomesticUs(country) {
    var co = String(country || "US")
      .trim()
      .toUpperCase();
    return !co || co === "US" || co === "USA" || co === "UNITED STATES" || co === "UNITED STATES OF AMERICA";
  }

  /**
   * @param {number} subtotal - full cart subtotal (unused for math; cart is source of truth)
   * @param {{ country?: string }} ship
   * @param {Array=} cart
   */
  function computeShipping(subtotal, ship, cart) {
    var rules = mergeRules();
    ship = ship || {};
    cart = cart || [];

    var gSub = sumSubtotalByClass(cart, "glasses");
    var cSub = sumSubtotalByClass(cart, "casebag");
    var hasGlasses = hasLineClass(cart, "glasses");
    var withOther = hasCasebagQuantity(cart);

    var glassesPart =
      hasGlasses && !withOther && gSub > 0
        ? Math.round(rules.casebag.base * 100) / 100
        : 0;
    var casePart = casebagShippingAmount(cSub, rules);

    var combined = Math.round((glassesPart + casePart) * 100) / 100;
    if (!isDomesticUs(ship.country)) {
      combined = Math.round(combined * rules.internationalMultiplier * 100) / 100;
    }

    var parts = [];
    if (glassesPart > 0) {
      parts.push("Glasses $" + glassesPart.toFixed(2) + (gSub > 0 ? " (merch $" + gSub.toFixed(2) + ")" : ""));
    }
    if (hasGlasses && glassesPart === 0 && withOther) {
      parts.push("Glasses free w/ cases/bags");
    }
    if (casePart > 0) parts.push("Cases/bags $" + casePart.toFixed(2) + (cSub > 0 ? " (merch $" + cSub.toFixed(2) + ")" : ""));
    if (!parts.length) parts.push("No ship items");
    var detail = parts.join(" + ");
    if (!isDomesticUs(ship.country) && rules.internationalMultiplier !== 1) {
      detail += " (intl adj.)";
    }

    return {
      amount: combined,
      detail: detail
    };
  }

  global.rettmarkComputeShipping = computeShipping;
})(typeof window !== "undefined" ? window : this);
