/**
 * Server product catalog (generated at build). Validates cart line prices / shipping class.
 */
var catalogJson = require("./generated-product-catalog.json");

function basenameUrl(u) {
  var s = String(u || "")
    .trim()
    .replace(/\\/g, "/")
    .split("?")[0]
    .split("#")[0];
  var parts = s.split("/");
  var last = parts[parts.length - 1] || "";
  return last.toLowerCase();
}

function getEntryForUrl(url) {
  var key = basenameUrl(url);
  if (!key) return null;
  var byUrl = catalogJson && catalogJson.byUrl;
  if (!byUrl || typeof byUrl !== "object") return null;
  return byUrl[key] || null;
}

/**
 * Rewrite cart lines with catalog price + shippingClass. Reject unknown products.
 * @returns {{ ok: true, cart: Array } | { ok: false, error: string }}
 */
function validateAndNormalizeCart(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, error: "empty_cart" };
  }
  if (cart.length > 50) {
    return { ok: false, error: "cart_too_large" };
  }

  var out = [];
  for (var i = 0; i < cart.length; i++) {
    var item = cart[i];
    if (!item || typeof item !== "object") {
      return { ok: false, error: "invalid_cart_line" };
    }
    var sku = String(item.sku || "").trim();
    if (!sku || sku.length > 120) {
      return { ok: false, error: "invalid_sku" };
    }
    var qty = parseInt(item.qty, 10);
    if (!isFinite(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: "invalid_qty" };
    }
    var entry = getEntryForUrl(item.url);
    if (!entry) {
      return { ok: false, error: "unknown_product" };
    }
    var priceDollars = entry.priceCents / 100;
    out.push({
      sku: sku,
      name: String(item.name || "Item").slice(0, 200),
      variant: String(item.variant || "").slice(0, 200),
      color: String(item.color || "").slice(0, 80),
      price: priceDollars,
      image: String(item.image || "").slice(0, 500),
      url: basenameUrl(item.url),
      qty: qty,
      shippingClass: entry.shippingClass === "glasses" ? "glasses" : "casebag"
    });
  }
  return { ok: true, cart: out };
}

module.exports = {
  basenameUrl,
  getEntryForUrl,
  validateAndNormalizeCart,
  catalogMeta: function () {
    return {
      generatedAt: catalogJson && catalogJson.generatedAt,
      urlCount: catalogJson && catalogJson.urlCount
    };
  }
};
