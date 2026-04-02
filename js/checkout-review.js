(function () {
  var CART_KEY = "rettmark_cart_v1";
  var ADDRESS_SESSION_KEY = "rettmark_checkout_address_v1";
  var TOTALS_SESSION_KEY = "rettmark_checkout_totals_v1";
  var OPAQUE_SESSION_KEY = "rettmark_checkout_opaque_v1";
  var OPAQUE_TTL_MS = 20 * 60 * 1000;

  function go(htmlFile) {
    window.location.href = new URL(htmlFile, window.location.href).href;
  }

  /**
   * Optional promo codes (merchant-editable). Keys are compared case-insensitively.
   * kind: "percent" (of subtotal) or "fixed" (dollars off). value: number.
   * Example: WELCOME10: { kind: "percent", value: 10 }
   */
  var DISCOUNT_CODES = {};

  function cartSignature(cart) {
    var t = cartTotal(cart);
    var parts = cart.map(function (item) {
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

  function readCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var cart = raw ? JSON.parse(raw) : [];
      return Array.isArray(cart) ? cart : [];
    } catch (e) {
      return [];
    }
  }

  function formatUsd(n) {
    var num = Number(n || 0);
    return "$" + num.toFixed(2);
  }

  function cartTotal(cart) {
    return cart.reduce(function (sum, item) {
      var q = parseInt(item.qty, 10) || 0;
      var p = Number(item.price) || 0;
      return sum + q * p;
    }, 0);
  }

  function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
  }

  function parseMoneyInput(raw) {
    if (raw == null) return 0;
    var s = String(raw).trim().replace(/[$,\s]/g, "");
    if (!s) return 0;
    var n = parseFloat(s);
    return isFinite(n) && n >= 0 ? roundMoney(n) : NaN;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function showReviewErr(msg) {
    var el = $("review-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function showCardErr(msg) {
    var el = $("review-card-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function showCodeHint(msg, isError) {
    var el = $("review-code-hint");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
    el.classList.toggle("checkout-review-hint--error", Boolean(isError));
  }

  function lookupDiscount(code) {
    var key = String(code || "").trim().toUpperCase();
    if (!key) return null;
    var found = null;
    Object.keys(DISCOUNT_CODES).forEach(function (k) {
      if (String(k).toUpperCase() === key) {
        found = DISCOUNT_CODES[k];
      }
    });
    return found;
  }

  function computeDiscountAmount(subtotal, def) {
    if (!def || !def.kind) return 0;
    var v = Number(def.value);
    if (!isFinite(v) || v < 0) return 0;
    if (def.kind === "percent") {
      var pct = Math.min(v, 100);
      return roundMoney((subtotal * pct) / 100);
    }
    if (def.kind === "fixed") {
      return roundMoney(Math.min(v, subtotal));
    }
    return 0;
  }

  var state = {
    cart: [],
    subtotal: 0,
    cartSig: "",
    appliedCode: "",
    discountAmount: 0,
    shippingAmount: 0,
    taxAmount: 0,
    taxRatePercent: 0,
    taxStateCode: ""
  };

  function formatSalesTaxPctLabel(code, pct) {
    if (!code) return "";
    var p = Number(pct);
    if (!isFinite(p) || p < 0) p = 0;
    var s = p.toFixed(4).replace(/\.?0+$/, "");
    return " (" + s + "%)";
  }

  function recalcShippingOnly() {
    var ship = parseMoneyInput($("review-shipping") && $("review-shipping").value);
    if (isNaN(ship)) return false;
    state.shippingAmount = ship;
    return true;
  }

  function applyComputedSalesTax(shipAddr) {
    var afterDisc = Math.max(0, roundMoney(state.subtotal - state.discountAmount));
    var taxable = roundMoney(afterDisc);
    var fn =
      typeof window !== "undefined" && typeof window.rettmarkComputeStateSalesTax === "function"
        ? window.rettmarkComputeStateSalesTax
        : null;
    if (!fn) {
      state.taxAmount = 0;
      state.taxRatePercent = 0;
      state.taxStateCode = "";
      if ($("review-tax")) $("review-tax").value = "0.00";
      return;
    }
    var r = fn(
      shipAddr && shipAddr.country,
      shipAddr && shipAddr.state,
      taxable
    );
    state.taxAmount = roundMoney((r && r.amount) || 0);
    state.taxRatePercent = r && isFinite(r.ratePercent) ? Number(r.ratePercent) : 0;
    state.taxStateCode = (r && r.code) || "";
    if ($("review-tax")) $("review-tax").value = state.taxAmount.toFixed(2);
  }

  function grandTotal() {
    var afterDiscount = Math.max(0, roundMoney(state.subtotal - state.discountAmount));
    return roundMoney(afterDiscount + state.shippingAmount + state.taxAmount);
  }

  function updateBreakdownDisplay() {
    $("review-line-subtotal") && ($("review-line-subtotal").textContent = formatUsd(state.subtotal));

    var discRow = $("review-line-discount-row");
    var discLabel = $("review-discount-label");
    var discVal = $("review-line-discount");
    if (state.discountAmount > 0) {
      if (discRow) discRow.hidden = false;
      if (discLabel) {
        discLabel.textContent = state.appliedCode ? " (" + state.appliedCode + ")" : "";
      }
      if (discVal) discVal.textContent = "−" + formatUsd(state.discountAmount);
    } else {
      if (discRow) discRow.hidden = true;
      if (discLabel) discLabel.textContent = "";
    }

    $("review-line-shipping") && ($("review-line-shipping").textContent = formatUsd(state.shippingAmount));
    $("review-line-tax") && ($("review-line-tax").textContent = formatUsd(state.taxAmount));
    var taxPctEl = $("review-tax-pct-label");
    if (taxPctEl) {
      taxPctEl.textContent = formatSalesTaxPctLabel(state.taxStateCode, state.taxRatePercent);
    }
    $("review-grand-total") && ($("review-grand-total").textContent = formatUsd(grandTotal()));
  }

  function addressSig(ship) {
    if (!ship || typeof ship !== "object") return "";
    return [
      String(ship.state || "").trim(),
      String(ship.zip || "").trim(),
      String(ship.country || "").trim()
    ]
      .join("|")
      .toUpperCase();
  }

  function persistTotals(shipAddr) {
    var payload = {
      cartSig: state.cartSig,
      subtotal: state.subtotal,
      discountCode: state.appliedCode,
      discountAmount: state.discountAmount,
      shippingAmount: state.shippingAmount,
      taxAmount: state.taxAmount,
      taxRatePercent: state.taxStateCode ? state.taxRatePercent : null,
      taxStateCode: state.taxStateCode || "",
      grandTotal: grandTotal(),
      shippingAddressSig: addressSig(shipAddr)
    };
    try {
      sessionStorage.setItem(TOTALS_SESSION_KEY, JSON.stringify(payload));
    } catch (e) {
      return false;
    }
    return true;
  }

  function loadSavedTotals(cartSig, subtotal, currentAddrSig) {
    var restoredShipping = false;
    try {
      var raw = sessionStorage.getItem(TOTALS_SESSION_KEY);
      if (!raw) return { restoredShipping: false };
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return { restoredShipping: false };
      if (saved.cartSig !== cartSig) return { restoredShipping: false };
      if (Math.abs(Number(saved.subtotal) - subtotal) > 0.005) {
        return { restoredShipping: false };
      }

      var sigOk =
        !saved.shippingAddressSig ||
        String(saved.shippingAddressSig).toUpperCase() === String(currentAddrSig || "").toUpperCase();

      if (sigOk && $("review-shipping") && saved.shippingAmount != null) {
        $("review-shipping").value = roundMoney(saved.shippingAmount).toFixed(2);
        restoredShipping = true;
      }
      if (saved.discountCode) {
        if ($("review-discount-code")) $("review-discount-code").value = String(saved.discountCode);
      }
      state.appliedCode = saved.discountCode ? String(saved.discountCode).trim() : "";
      state.discountAmount = roundMoney(saved.discountAmount || 0);

      if (state.appliedCode && Object.keys(DISCOUNT_CODES).length) {
        var def = lookupDiscount(state.appliedCode);
        var expected = def ? computeDiscountAmount(subtotal, def) : 0;
        if (!def || Math.abs(expected - state.discountAmount) > 0.02) {
          state.discountAmount = def ? expected : 0;
          if (!def) state.appliedCode = "";
        }
      }
    } catch (e) {}
    return { restoredShipping: restoredShipping };
  }

  function applyRulesShipping(shipAddr, subtotal, restoredShipping, cart) {
    if (restoredShipping) return;
    var fn =
      typeof window !== "undefined" && typeof window.rettmarkComputeShipping === "function"
        ? window.rettmarkComputeShipping
        : null;
    if (!fn) return;
    var quote = fn(subtotal, shipAddr, cart || []);
    if (!quote || !isFinite(quote.amount)) return;
    if ($("review-shipping")) {
      $("review-shipping").value = roundMoney(quote.amount).toFixed(2);
    }
  }

  function init() {
    var cart = readCart();
    if (!cart.length) {
      go("cart.html");
      return;
    }

    try {
      sessionStorage.removeItem(OPAQUE_SESSION_KEY);
    } catch (eClr) {}

    var addrRaw;
    try {
      addrRaw = sessionStorage.getItem(ADDRESS_SESSION_KEY);
      if (!addrRaw) {
        go("checkout-address.html");
        return;
      }
    } catch (e) {
      go("checkout-address.html");
      return;
    }

    var addrPayload;
    try {
      addrPayload = JSON.parse(addrRaw);
    } catch (e2) {
      go("checkout-address.html");
      return;
    }
    var shipAddr = (addrPayload && addrPayload.shipping) || {};
    var billZip = (addrPayload && addrPayload.billing && addrPayload.billing.zip) || "";
    if ($("review-card-billing-zip") && !String($("review-card-billing-zip").value || "").trim()) {
      $("review-card-billing-zip").value = billZip;
    }

    state.cart = cart;
    state.subtotal = roundMoney(cartTotal(cart));
    state.cartSig = cartSignature(cart);

    var linesEl = $("checkout-review-lines");
    if (linesEl) {
      var lines = cart
        .map(function (item) {
          var q = parseInt(item.qty, 10) || 0;
          var line = roundMoney(q * (Number(item.price) || 0));
          var meta = [item.variant || "", item.sku || ""].filter(Boolean).join(" · ");
          return (
            "<li><span>" +
            (item.name || "Item") +
            (meta ? " <small>(" + meta + ")</small>" : "") +
            " × " +
            q +
            "</span><strong>" +
            formatUsd(line) +
            "</strong></li>"
          );
        })
        .join("");
      linesEl.innerHTML =
        '<ul class="checkout-summary-list">' +
        lines +
        '</ul><p class="checkout-summary-total">Cart subtotal <strong>' +
        formatUsd(state.subtotal) +
        "</strong></p>";
    }

    var addrSig = addressSig(shipAddr);
    var loadResult = loadSavedTotals(state.cartSig, state.subtotal, addrSig);

    if (!recalcShippingOnly()) {
      if ($("review-shipping")) $("review-shipping").value = "0.00";
      recalcShippingOnly();
    }

    applyRulesShipping(shipAddr, state.subtotal, loadResult.restoredShipping, state.cart);
    recalcShippingOnly();
    applyComputedSalesTax(shipAddr);

    $("review-apply-code") &&
      $("review-apply-code").addEventListener("click", function () {
        showReviewErr("");
        var codeRaw = ($("review-discount-code") && $("review-discount-code").value) || "";
        var code = String(codeRaw).trim();
        if (!code) {
          state.appliedCode = "";
          state.discountAmount = 0;
          showCodeHint("", false);
          recalcShippingOnly();
          applyComputedSalesTax(shipAddr);
          updateBreakdownDisplay();
          return;
        }
        if (!Object.keys(DISCOUNT_CODES).length) {
          state.appliedCode = code;
          state.discountAmount = 0;
          showCodeHint(
            "Codes aren’t validated online here yet—your code is saved with the order when you continue.",
            false
          );
          recalcShippingOnly();
          applyComputedSalesTax(shipAddr);
          updateBreakdownDisplay();
          return;
        }
        var def = lookupDiscount(code);
        if (!def) {
          showCodeHint("That code isn’t recognized. Check spelling or try another code.", true);
          state.appliedCode = "";
          state.discountAmount = 0;
          recalcShippingOnly();
          applyComputedSalesTax(shipAddr);
          updateBreakdownDisplay();
          return;
        }
        state.appliedCode = code;
        state.discountAmount = computeDiscountAmount(state.subtotal, def);
        showCodeHint("Code applied.", false);
        recalcShippingOnly();
        applyComputedSalesTax(shipAddr);
        updateBreakdownDisplay();
      });

    updateBreakdownDisplay();

    var S = window.RettmarkCheckoutShared;
    var acceptReady = false;
    var anetCfg = null;

    if (!S) {
      showReviewErr("Checkout could not load. Please refresh the page.");
    } else {
      window.rettmarkCheckoutAcceptOnScriptError = function () {
        showCardErr("Could not load payment security script. Check your connection or try again.");
      };
      S.fetchPublicAnetConfig().then(function (remote) {
        anetCfg = S.mergeAnetConfig(remote, window.RETTMARK_ANET || {});
        if (!anetCfg.clientKey || !anetCfg.apiLoginId) {
          showCardErr(
            "Checkout is not fully configured yet. Please contact us or try again later."
          );
          return;
        }
        var acceptSrc = anetCfg.sandbox
          ? "https://jstest.authorize.net/v1/Accept.js"
          : "https://js.authorize.net/v1/Accept.js";
        S.loadScript(acceptSrc, function () {
          if (typeof Accept === "undefined") {
            showCardErr("Payment security script failed to initialize.");
            return;
          }
          acceptReady = true;
        });
      });
    }

    function resetContinueBtn(btn) {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = "Continue to review & pay";
    }

    $("review-continue") &&
      $("review-continue").addEventListener("click", function () {
        var btn = $("review-continue");
        showReviewErr("");
        showCardErr("");

        if (!recalcShippingOnly()) {
          showReviewErr("Shipping amount is invalid. Go back and try again or contact us.");
          updateBreakdownDisplay();
          return;
        }
        applyComputedSalesTax(shipAddr);
        updateBreakdownDisplay();

        if (!persistTotals(shipAddr)) {
          showReviewErr("Could not save totals. Check that cookies/storage are allowed.");
          return;
        }

        if (!S || !anetCfg || !anetCfg.clientKey) {
          showCardErr("Payment is still loading. Wait a moment and try again.");
          return;
        }
        if (!acceptReady || typeof Accept === "undefined") {
          showCardErr("Payment is still loading. Wait a moment and try again.");
          return;
        }

        var cardZipRaw = ($("review-card-billing-zip") && $("review-card-billing-zip").value) || "";
        var cardZip = String(cardZipRaw).trim();
        if (!cardZip) {
          showCardErr("Please enter the billing ZIP for this card.");
          return;
        }

        var expMonthRaw = ($("review-card-exp-month") && $("review-card-exp-month").value) || "";
        var expYearRaw = ($("review-card-exp-year") && $("review-card-exp-year").value) || "";
        var monthNum = parseInt(String(expMonthRaw).trim(), 10);
        var yearStr = String(expYearRaw).trim();
        if (!isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
          showCardErr("Please enter the card expiration month as 01–12.");
          return;
        }
        if (!yearStr || (!/^\d{2}$/.test(yearStr) && !/^\d{4}$/.test(yearStr))) {
          showCardErr("Please enter the expiration year as YY (e.g. 28) or YYYY (e.g. 2028).");
          return;
        }

        var cardData = {
          cardNumber:
            (($("review-card-number") && $("review-card-number").value) || "").replace(/\s/g, ""),
          month: S.pad2(monthNum),
          year: yearStr,
          cardCode: ($("review-card-cvv") && $("review-card-cvv").value) || "",
          zip: cardZip.slice(0, 20)
        };

        if (!String(cardData.cardNumber).trim()) {
          showCardErr("Please enter your card number.");
          return;
        }

        if (btn) {
          btn.disabled = true;
          btn.textContent = "Securing card…";
        }

        var authData = {
          clientKey: anetCfg.clientKey,
          apiLoginID: anetCfg.apiLoginId
        };
        var secureData = {
          authData: authData,
          cardData: cardData
        };

        var settled = false;
        var watchdog = setTimeout(function () {
          if (settled) return;
          settled = true;
          showCardErr(
            "Card security step timed out. Check your connection or try another browser."
          );
          resetContinueBtn(btn);
        }, 60000);

        Accept.dispatchData(secureData, function (response) {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);

          if (!response || !response.messages) {
            showCardErr("Unexpected response from payment security. Try again.");
            resetContinueBtn(btn);
            return;
          }

          if (response.messages.resultCode === "Error") {
            var rawMsgs = response.messages.message;
            var msgArr = Array.isArray(rawMsgs) ? rawMsgs : rawMsgs ? [rawMsgs] : [];
            var t = msgArr
              .map(function (m) {
                return m && m.text ? m.text : "";
              })
              .filter(Boolean)
              .join(" ");
            showCardErr(S.formatAnetClientError(t));
            resetContinueBtn(btn);
            return;
          }

          var opaque = response.opaqueData;
          if (!opaque || !opaque.dataDescriptor || !opaque.dataValue) {
            showCardErr("No payment token returned. Try again.");
            resetContinueBtn(btn);
            return;
          }

          var g = grandTotal();
          try {
            sessionStorage.setItem(
              OPAQUE_SESSION_KEY,
              JSON.stringify({
                opaqueData: {
                  dataDescriptor: opaque.dataDescriptor,
                  dataValue: opaque.dataValue
                },
                ts: Date.now(),
                cartSig: state.cartSig,
                grandTotal: g
              })
            );
          } catch (eStore) {
            showCardErr("Could not save payment session. Check that storage is allowed.");
            resetContinueBtn(btn);
            return;
          }

          go("checkout-confirm.html");
        });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
