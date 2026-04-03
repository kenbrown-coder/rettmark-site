/**
 * Shared checkout helpers (cart signature, review totals, invoice #, Accept.js config).
 * Used by checkout-review (tokenize) and checkout-confirm (charge).
 */
(function () {
  var CART_KEY = "rettmark_cart_v1";
  var INVOICE_SESSION_KEY = "rettmark_checkout_invoice_v1";
  var TOTALS_SESSION_KEY = "rettmark_checkout_totals_v1";

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function cartTotal(cart) {
    if (!Array.isArray(cart)) return 0;
    return cart.reduce(function (sum, item) {
      var q = parseInt(item.qty, 10) || 0;
      var p = Number(item.price) || 0;
      return sum + q * p;
    }, 0);
  }

  function cartSignature(cart) {
    var t = cartTotal(cart);
    var parts = (cart || []).map(function (item) {
      return (
        String(item.sku || item.name || "") +
        ":" +
        String(parseInt(item.qty, 10) || 0) +
        ":" +
        String(Number(item.price) || 0)
      );
    });
    return parts.sort().join("|") + "@" + t.toFixed(2);
  }

  function generateInvoiceNumber() {
    var d = new Date();
    var y = String(d.getFullYear()).slice(-2);
    var m = pad2(d.getMonth() + 1);
    var day = pad2(d.getDate());
    var rand = "";
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      var a = new Uint8Array(3);
      crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) {
        rand += ("0" + a[i].toString(16)).slice(-2);
      }
    } else {
      rand = ("000000" + Math.floor(Math.random() * 16777216).toString(16)).slice(-6);
    }
    var inv = "RM" + y + m + day + rand;
    return inv.length > 20 ? inv.slice(0, 20) : inv;
  }

  function getOrCreateCheckoutInvoice(cart) {
    var sig = cartSignature(cart);
    try {
      var raw = sessionStorage.getItem(INVOICE_SESSION_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (
          parsed &&
          parsed.sig === sig &&
          parsed.inv &&
          /^[A-Za-z0-9-]+$/.test(parsed.inv) &&
          parsed.inv.length <= 20
        ) {
          return parsed.inv;
        }
      }
    } catch (e) {}
    var inv = generateInvoiceNumber();
    try {
      sessionStorage.setItem(INVOICE_SESSION_KEY, JSON.stringify({ inv: inv, sig: sig }));
    } catch (e2) {}
    return inv;
  }

  function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
  }

  /** Step-2 review totals; must match current cart or caller treats as invalid. */
  function loadTotalsForCart(cart) {
    var subtotal = roundMoney(cartTotal(cart));
    var sig = cartSignature(cart);
    try {
      var raw = sessionStorage.getItem(TOTALS_SESSION_KEY);
      if (!raw) {
        return { ok: false, subtotal: subtotal, grandTotal: subtotal };
      }
      var t = JSON.parse(raw);
      if (!t || typeof t !== "object" || t.cartSig !== sig) {
        return { ok: false, subtotal: subtotal, grandTotal: subtotal };
      }
      var storedSub = roundMoney(t.subtotal);
      if (Math.abs(storedSub - subtotal) > 0.02) {
        return { ok: false, subtotal: subtotal, grandTotal: subtotal };
      }
      var grand = roundMoney(t.grandTotal);
      if (!isFinite(grand) || grand < 0) {
        return { ok: false, subtotal: subtotal, grandTotal: subtotal };
      }
      return {
        ok: true,
        subtotal: subtotal,
        discountCode: String(t.discountCode || "").trim(),
        discountAmount: roundMoney(t.discountAmount),
        shippingCreditAmount: roundMoney(t.shippingCreditAmount),
        surchargeAmount: roundMoney(t.surchargeAmount),
        shippingAmount: roundMoney(t.shippingAmount),
        taxAmount: roundMoney(t.taxAmount),
        taxRatePercent:
          t.taxStateCode && t.taxRatePercent != null && isFinite(Number(t.taxRatePercent))
            ? Number(t.taxRatePercent)
            : null,
        taxStateCode: String(t.taxStateCode || "").trim(),
        grandTotal: grand
      };
    } catch (e) {
      return { ok: false, subtotal: subtotal, grandTotal: subtotal };
    }
  }

  function readCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var cart = raw ? JSON.parse(raw) : [];
      return Array.isArray(cart) ? cart : [];
    } catch (e) {
      return [];
    }
  }

  function netlifyFunctionUrl(name) {
    var origin = "";
    try {
      origin = String((window.location && window.location.origin) || "");
    } catch (e) {}
    return origin + "/.netlify/functions/" + name;
  }

  function loadScript(src, onload, onerr) {
    var s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = onload;
    s.onerror =
      onerr ||
      function () {
        if (typeof window.rettmarkCheckoutAcceptOnScriptError === "function") {
          window.rettmarkCheckoutAcceptOnScriptError();
        }
      };
    document.head.appendChild(s);
  }

  function mergeAnetConfig(remote, local) {
    local = local || {};
    remote = remote || {};
    function trimStr(v) {
      return String(v || "").trim();
    }
    return {
      clientKey: trimStr(remote.clientKey || local.clientKey),
      apiLoginId: trimStr(remote.apiLoginId || local.apiLoginId),
      sandbox: typeof remote.sandbox === "boolean" ? remote.sandbox : local.sandbox !== false
    };
  }

  function fetchPublicAnetConfig() {
    return fetch(netlifyFunctionUrl("anet-public-config"))
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .catch(function () {
        return {};
      });
  }

  function formatAnetClientError(text) {
    var t = String(text || "").trim();
    if (!t) return "Card validation failed.";
    var lower = t.toLowerCase();
    if (
      lower.indexOf("authentication") !== -1 ||
      lower.indexOf("invalid authentication") !== -1 ||
      lower.indexOf("e_wc_21") !== -1 ||
      lower.indexOf("e_wc_19") !== -1
    ) {
      return (
        t +
        " Confirm in Netlify: ANET_PUBLIC_CLIENT_KEY is the Accept.js Public Client Key (not the transaction key), " +
        "ANET_API_LOGIN_ID matches that merchant account, and ANET_SANDBOX matches the environment " +
        "(false for production, including Authorize.Net “Test mode” on a live account)."
      );
    }
    return t;
  }

  window.RettmarkCheckoutShared = {
    CART_KEY: CART_KEY,
    INVOICE_SESSION_KEY: INVOICE_SESSION_KEY,
    TOTALS_SESSION_KEY: TOTALS_SESSION_KEY,
    pad2: pad2,
    cartTotal: cartTotal,
    cartSignature: cartSignature,
    getOrCreateCheckoutInvoice: getOrCreateCheckoutInvoice,
    loadTotalsForCart: loadTotalsForCart,
    readCart: readCart,
    roundMoney: roundMoney,
    netlifyFunctionUrl: netlifyFunctionUrl,
    loadScript: loadScript,
    mergeAnetConfig: mergeAnetConfig,
    fetchPublicAnetConfig: fetchPublicAnetConfig,
    formatAnetClientError: formatAnetClientError
  };
})();
