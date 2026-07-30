/**
 * Flat shipping rules — keep in sync with js/shipping-rules.js.
 * Cart lines must already have authoritative shippingClass from product-catalog.
 */

var RULES = {
  casebag: {
    firstTierMax: 100,
    base: 14.99,
    perHundred: 5,
    step: 100
  },
  internationalMultiplier: 1
};

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

function hasCasebagQuantity(cart) {
  if (!Array.isArray(cart)) return false;
  for (var i = 0; i < cart.length; i++) {
    if (inferShippingClass(cart[i]) !== "casebag") continue;
    var q = Math.max(0, parseInt(cart[i].qty, 10) || 0);
    if (q > 0) return true;
  }
  return false;
}

function casebagShippingAmount(sub) {
  var c = RULES.casebag;
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
 * @param {Array} cart - normalized cart
 * @param {{ country?: string }} ship
 * @returns {{ amount: number, amountCents: number }}
 */
function computeShipping(cart, ship) {
  ship = ship || {};
  cart = cart || [];

  var gSub = sumSubtotalByClass(cart, "glasses");
  var cSub = sumSubtotalByClass(cart, "casebag");
  var hasGlasses = hasLineClass(cart, "glasses");
  var withOther = hasCasebagQuantity(cart);

  var glassesPart =
    hasGlasses && !withOther && gSub > 0 ? Math.round(RULES.casebag.base * 100) / 100 : 0;
  var casePart = casebagShippingAmount(cSub);

  var combined = Math.round((glassesPart + casePart) * 100) / 100;
  if (!isDomesticUs(ship.country)) {
    combined = Math.round(combined * RULES.internationalMultiplier * 100) / 100;
  }

  return {
    amount: combined,
    amountCents: Math.round(combined * 100)
  };
}

module.exports = {
  computeShipping,
  inferShippingClass
};
