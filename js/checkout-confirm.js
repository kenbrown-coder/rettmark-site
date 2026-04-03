(function () {
  var ADDRESS_SESSION_KEY = "rettmark_checkout_address_v1";
  var OPAQUE_SESSION_KEY = "rettmark_checkout_opaque_v1";
  var OPAQUE_TTL_MS = 20 * 60 * 1000;

  function $(id) {
    return document.getElementById(id);
  }

  function go(htmlFile) {
    window.location.href = new URL(htmlFile, window.location.href).href;
  }

  function showErr(msg) {
    var el = $("confirm-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatUsd(n) {
    var num = Number(n || 0);
    return "$" + num.toFixed(2);
  }

  function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
  }

  function addressesDiffer(bill, ship) {
    if (!bill || !ship) return false;
    return ["firstName", "lastName", "address", "city", "state", "zip", "country"].some(function (k) {
      return (
        String(bill[k] || "")
          .trim()
          .toLowerCase() !==
        String(ship[k] || "")
          .trim()
          .toLowerCase()
      );
    });
  }

  function writeCartEmpty(S) {
    try {
      localStorage.setItem(S.CART_KEY, "[]");
    } catch (e) {}
  }

  function loadOpaqueSession() {
    try {
      var raw = sessionStorage.getItem(OPAQUE_SESSION_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.opaqueData || !o.ts || !o.cartSig) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function clearCheckoutSession(S) {
    try {
      sessionStorage.removeItem(OPAQUE_SESSION_KEY);
      sessionStorage.removeItem(S.INVOICE_SESSION_KEY);
      sessionStorage.removeItem(S.TOTALS_SESSION_KEY);
      sessionStorage.removeItem(ADDRESS_SESSION_KEY);
    } catch (e) {}
  }

  function init() {
    var S = window.RettmarkCheckoutShared;
    if (!S) {
      showErr("Checkout could not load. Please refresh.");
      return;
    }

    var cart = S.readCart();
    if (!cart.length) {
      go("cart.html");
      return;
    }

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

    var opaque = loadOpaqueSession();
    if (!opaque) {
      go("checkout-review.html");
      return;
    }

    if (Date.now() - Number(opaque.ts) > OPAQUE_TTL_MS) {
      try {
        sessionStorage.removeItem(OPAQUE_SESSION_KEY);
      } catch (e3) {}
      go("checkout-review.html");
      return;
    }

    var cartSig = S.cartSignature(cart);
    if (opaque.cartSig !== cartSig) {
      go("checkout-review.html");
      return;
    }

    var totals = S.loadTotalsForCart(cart);
    if (!totals.ok) {
      go("checkout-review.html");
      return;
    }

    var og = Number(opaque.grandTotal);
    if (!isFinite(og) || Math.abs(og - totals.grandTotal) > 0.02) {
      go("checkout-review.html");
      return;
    }

    var invoice = S.getOrCreateCheckoutInvoice(cart);
    var bill = (addrPayload && addrPayload.billing) || {};
    var ship = (addrPayload && addrPayload.shipping) || {};
    var email = String((addrPayload && addrPayload.email) || "").trim();

    var shipToPayload = null;
    if (addressesDiffer(bill, ship)) {
      shipToPayload = {
        firstName: ship.firstName || "",
        lastName: ship.lastName || "",
        address: ship.address || "",
        city: ship.city || "",
        state: ship.state || "",
        zip: ship.zip || "",
        country: ship.country || "US"
      };
    }

    var root = $("confirm-invoice-root");
    if (root) {
      var lines = cart
        .map(function (item) {
          var q = parseInt(item.qty, 10) || 0;
          var line = q * (Number(item.price) || 0);
          var meta = [item.variant || "", item.sku || ""].filter(Boolean).join(" · ");
          return (
            "<li><span>" +
            escapeHtml(item.name || "Item") +
            (meta ? " <small>(" + escapeHtml(meta) + ")</small>" : "") +
            " × " +
            q +
            "</span><strong>" +
            formatUsd(line) +
            "</strong></li>"
          );
        })
        .join("");

      var surRow = "";
      var sur = Number(totals.surchargeAmount) || 0;
      if (sur > 0) {
        surRow =
          '<div class="checkout-review-breakdown__row"><span>Surcharge' +
          (totals.discountCode ? " (" + escapeHtml(totals.discountCode) + ")" : "") +
          '</span><strong>' +
          formatUsd(sur) +
          "</strong></div>";
      }
      var discRow = "";
      if (totals.discountAmount > 0) {
        discRow =
          '<div class="checkout-review-breakdown__row"><span>Discount' +
          (totals.discountCode ? " (" + escapeHtml(totals.discountCode) + ")" : "") +
          '</span><strong>−' +
          formatUsd(totals.discountAmount) +
          "</strong></div>";
      }
      var scRow = "";
      var sc = Number(totals.shippingCreditAmount) || 0;
      if (sc > 0) {
        scRow =
          '<div class="checkout-review-breakdown__row"><span>Shipping credit' +
          (totals.discountCode ? " (" + escapeHtml(totals.discountCode) + ")" : "") +
          '</span><strong>−' +
          formatUsd(sc) +
          "</strong></div>";
      }
      var shipPay =
        Math.max(0, roundMoney((Number(totals.shippingAmount) || 0) - (Number(totals.shippingCreditAmount) || 0)));

      var taxPctSuffix = "";
      if (totals.taxStateCode && totals.taxRatePercent != null && isFinite(totals.taxRatePercent)) {
        var tr = Number(totals.taxRatePercent);
        if (!isFinite(tr) || tr < 0) tr = 0;
        taxPctSuffix = " (" + escapeHtml(tr.toFixed(4).replace(/\.?0+$/, "")) + "%)";
      }

      var billHtml =
        "<p><strong>Billing</strong><br>" +
        escapeHtml((bill.firstName || "") + " " + (bill.lastName || "")) +
        "<br>" +
        escapeHtml(bill.address || "") +
        "<br>" +
        escapeHtml(
          [bill.city || "", bill.state || "", bill.zip || ""]
            .filter(Boolean)
            .join(", ")
        ) +
        "</p>";

      var shipHtml = "";
      if (shipToPayload) {
        shipHtml =
          "<p><strong>Shipping</strong><br>" +
          escapeHtml((ship.firstName || "") + " " + (ship.lastName || "")) +
          "<br>" +
          escapeHtml(ship.address || "") +
          "<br>" +
          escapeHtml(
            [ship.city || "", ship.state || "", ship.zip || ""]
              .filter(Boolean)
              .join(", ")
          ) +
          "</p>";
      }

      root.innerHTML =
        '<p class="checkout-summary-invoice">Order # <strong>' +
        escapeHtml(invoice) +
        "</strong></p>" +
        '<p><strong>Email</strong> ' +
        escapeHtml(email) +
        "</p>" +
        '<ul class="checkout-summary-list">' +
        lines +
        "</ul>" +
        '<div class="checkout-pay-breakdown">' +
        '<div class="checkout-review-breakdown__row"><span>Subtotal</span><strong>' +
        formatUsd(totals.subtotal) +
        "</strong></div>" +
        surRow +
        discRow +
        scRow +
        '<div class="checkout-review-breakdown__row"><span>Shipping</span><strong>' +
        formatUsd(shipPay) +
        "</strong></div>" +
        '<div class="checkout-review-breakdown__row"><span>Sales tax' +
        taxPctSuffix +
        '</span><strong>' +
        formatUsd(totals.taxAmount) +
        '</strong></div>' +
        '<div class="checkout-review-breakdown__row checkout-review-breakdown__row--total"><span>Total due</span><strong>' +
        formatUsd(totals.grandTotal) +
        "</strong></div></div>" +
        billHtml +
        shipHtml;
    }

    var submitBtn = $("confirm-submit");
    if (submitBtn) submitBtn.disabled = false;

    function resetSubmitBtn() {
      if (!submitBtn) return;
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit order & pay";
    }

    submitBtn &&
      submitBtn.addEventListener("click", function () {
        showErr("");
        var freshCart = S.readCart();
        if (!freshCart.length) {
          go("cart.html");
          return;
        }

        var op = loadOpaqueSession();
        if (!op || !op.opaqueData) {
          go("checkout-review.html");
          return;
        }
        if (Date.now() - Number(op.ts) > OPAQUE_TTL_MS) {
          try {
            sessionStorage.removeItem(OPAQUE_SESSION_KEY);
          } catch (e4) {}
          go("checkout-review.html");
          return;
        }
        if (op.cartSig !== S.cartSignature(freshCart)) {
          go("checkout-review.html");
          return;
        }

        var t = S.loadTotalsForCart(freshCart);
        if (!t.ok) {
          go("checkout-review.html");
          return;
        }
        if (Math.abs(Number(op.grandTotal) - t.grandTotal) > 0.02) {
          go("checkout-review.html");
          return;
        }

        var inv = S.getOrCreateCheckoutInvoice(freshCart);
        var billTo = (addrPayload && addrPayload.billing) || {};
        var shipAddr = (addrPayload && addrPayload.shipping) || {};
        var shipTo = null;
        if (addressesDiffer(billTo, shipAddr)) {
          shipTo = {
            firstName: shipAddr.firstName || "",
            lastName: shipAddr.lastName || "",
            address: shipAddr.address || "",
            city: shipAddr.city || "",
            state: shipAddr.state || "",
            zip: shipAddr.zip || "",
            country: shipAddr.country || "US"
          };
        }

        var payload = {
          opaqueData: {
            dataDescriptor: op.opaqueData.dataDescriptor,
            dataValue: op.opaqueData.dataValue
          },
          amount: t.grandTotal.toFixed(2),
          cart: freshCart,
          customerEmail: email,
          billTo: {
            firstName: billTo.firstName || "",
            lastName: billTo.lastName || "",
            address: billTo.address || "",
            city: billTo.city || "",
            state: billTo.state || "",
            zip: billTo.zip || "",
            country: billTo.country || "US"
          },
          invoiceNumber: inv,
          discountAmount: t.discountAmount.toFixed(2),
          shippingAmount: t.shippingAmount.toFixed(2),
          shippingCreditAmount: (Number(t.shippingCreditAmount) || 0).toFixed(2),
          surchargeAmount: (Number(t.surchargeAmount) || 0).toFixed(2),
          taxAmount: t.taxAmount.toFixed(2),
          discountCode: t.discountCode || ""
        };
        if (shipTo) {
          payload.shipTo = shipTo;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Processing…";
        }

        var ac = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timeoutId = ac
          ? setTimeout(function () {
              ac.abort();
            }, 90000)
          : null;

        var fetchOpts = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        };
        if (ac) fetchOpts.signal = ac.signal;

        fetch(S.netlifyFunctionUrl("anet-transaction"), fetchOpts)
          .then(function (r) {
            return r.text().then(function (text) {
              var data = {};
              try {
                data = text ? JSON.parse(text) : {};
              } catch (parseErr) {
                data = { error: "Invalid response from payment server." };
              }
              return { ok: r.ok, status: r.status, data: data };
            });
          })
          .then(function (result) {
            if (result.ok && result.data && result.data.ok) {
              writeCartEmpty(S);
              clearCheckoutSession(S);
              try {
                sessionStorage.setItem(
                  "rettmark_last_order",
                  JSON.stringify({
                    transactionId: result.data.transactionId,
                    authCode: result.data.authCode,
                    invoiceNumber: inv
                  })
                );
              } catch (e5) {}
              go("order-success.html");
              return;
            }
            var err =
              (result.data && result.data.error) || "Payment could not be completed.";
            showErr(err);
            resetSubmitBtn();
          })
          .catch(function (err) {
            if (err && err.name === "AbortError") {
              showErr("Payment timed out. Wait a moment and try again.");
            } else {
              showErr("Network error. Try again or contact us.");
            }
            resetSubmitBtn();
          })
          .finally(function () {
            if (timeoutId) clearTimeout(timeoutId);
          });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
