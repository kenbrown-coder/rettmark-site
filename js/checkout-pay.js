(function () {
  var CART_KEY = "rettmark_cart_v1";

  function readCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var cart = raw ? JSON.parse(raw) : [];
      return Array.isArray(cart) ? cart : [];
    } catch (e) {
      return [];
    }
  }

  function writeCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
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

  function $(id) {
    return document.getElementById(id);
  }

  function showErr(msg) {
    var el = $("checkout-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function loadScript(src, onload, onerr) {
    var s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = onload;
    s.onerror = onerr || function () {
      showErr("Could not load payment security script. Check your connection or CSP.");
    };
    document.head.appendChild(s);
  }

  function init() {
    var cfg = window.RETTMARK_ANET || {};
    var summaryEl = $("checkout-cart-summary");
    var payBtn = $("checkout-pay-btn");
    var form = $("checkout-payment-form");

    var cart = readCart();
    if (!cart.length) {
      if (summaryEl) {
        summaryEl.innerHTML =
          '<p class="cart-empty">Your cart is empty. <a class="contact-link" href="cart.html" style="margin-top:0">Return to cart</a></p>';
      }
      if (form) form.hidden = true;
      if (payBtn) payBtn.disabled = true;
      return;
    }

    var total = cartTotal(cart);
    if (summaryEl) {
      var lines = cart
        .map(function (item) {
          var q = parseInt(item.qty, 10) || 0;
          var line = q * (Number(item.price) || 0);
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
      summaryEl.innerHTML =
        '<ul class="checkout-summary-list">' +
        lines +
        '</ul><p class="checkout-summary-total">Total <strong data-checkout-total>' +
        formatUsd(total) +
        "</strong></p>";
    }

    $("checkout-amount") && ($("checkout-amount").value = total.toFixed(2));

    if (!cfg.clientKey || !cfg.apiLoginId) {
      showErr(
        "Checkout is not configured yet. Set ANET_PUBLIC_CLIENT_KEY and ANET_API_LOGIN_ID in Netlify, redeploy, and add server secrets ANET_TRANSACTION_KEY."
      );
      if (payBtn) payBtn.disabled = true;
      return;
    }

    var acceptSrc = cfg.sandbox
      ? "https://jstest.authorize.net/v1/Accept.js"
      : "https://js.authorize.net/v1/Accept.js";

    loadScript(acceptSrc, function () {
      if (typeof Accept === "undefined") {
        showErr("Accept.js failed to initialize.");
        return;
      }
      if (payBtn) payBtn.disabled = false;
    });

    if (!form) return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      showErr("");

      if (typeof Accept === "undefined") {
        showErr("Payment form is still loading. Please wait a moment and try again.");
        return;
      }

      var billTo = {
        firstName: ($("bill-first") && $("bill-first").value) || "",
        lastName: ($("bill-last") && $("bill-last").value) || "",
        address: ($("bill-address") && $("bill-address").value) || "",
        city: ($("bill-city") && $("bill-city").value) || "",
        state: ($("bill-state") && $("bill-state").value) || "",
        zip: ($("bill-zip") && $("bill-zip").value) || "",
        country: ($("bill-country") && $("bill-country").value) || "US"
      };

      var email = ($("bill-email") && $("bill-email").value) || "";

      var cardData = {
        cardNumber: ($("card-number") && $("card-number").value.replace(/\s/g, "")) || "",
        month: ($("card-exp-month") && $("card-exp-month").value) || "",
        year: ($("card-exp-year") && $("card-exp-year").value) || "",
        cardCode: ($("card-cvv") && $("card-cvv").value) || ""
      };

      var authData = {
        clientKey: cfg.clientKey,
        apiLoginID: cfg.apiLoginId
      };

      var secureData = {
        authData: authData,
        cardData: cardData
      };

      if (payBtn) {
        payBtn.disabled = true;
        payBtn.textContent = "Processing…";
      }

      Accept.dispatchData(secureData, function (response) {
        if (response.messages.resultCode === "Error") {
          var msgs = response.messages.message || [];
          var t = msgs.map(function (m) { return m.text; }).join(" ");
          showErr(t || "Card validation failed.");
          if (payBtn) {
            payBtn.disabled = false;
            payBtn.textContent = "Pay now";
          }
          return;
        }

        var opaque = response.opaqueData;
        if (!opaque) {
          showErr("No payment token returned.");
          if (payBtn) {
            payBtn.disabled = false;
            payBtn.textContent = "Pay now";
          }
          return;
        }

        var freshCart = readCart();
        var amt = cartTotal(freshCart);
        var payload = {
          opaqueData: {
            dataDescriptor: opaque.dataDescriptor,
            dataValue: opaque.dataValue
          },
          amount: amt.toFixed(2),
          cart: freshCart,
          customerEmail: email,
          billTo: billTo,
          invoiceNumber: ($("order-ref") && $("order-ref").value) || undefined
        };

        fetch("/.netlify/functions/anet-transaction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
          .then(function (r) {
            return r.json().then(function (data) {
              return { ok: r.ok, status: r.status, data: data };
            });
          })
          .then(function (result) {
            if (result.ok && result.data && result.data.ok) {
              writeCart([]);
              try {
                sessionStorage.setItem(
                  "rettmark_last_order",
                  JSON.stringify({
                    transactionId: result.data.transactionId,
                    authCode: result.data.authCode
                  })
                );
              } catch (ignore) {}
              window.location.href = "order-success.html";
              return;
            }
            var err =
              (result.data && result.data.error) ||
              "Payment could not be completed.";
            showErr(err);
            if (payBtn) {
              payBtn.disabled = false;
              payBtn.textContent = "Pay now";
            }
          })
          .catch(function () {
            showErr("Network error. Try again or contact us.");
            if (payBtn) {
              payBtn.disabled = false;
              payBtn.textContent = "Pay now";
            }
          });
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
