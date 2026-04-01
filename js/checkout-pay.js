(function () {
  var CART_KEY = "rettmark_cart_v1";
  var INVOICE_SESSION_KEY = "rettmark_checkout_invoice_v1";

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

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

  /** Reuse invoice for this cart in-session; new cart contents get a new number (Authorize.Net max 20 chars). */
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

  function cartTotalCents(cart) {
    return cart.reduce(function (sum, item) {
      var q = parseInt(item.qty, 10) || 0;
      var cents = Math.round((Number(item.price) || 0) * 100);
      return sum + q * cents;
    }, 0);
  }

  function cartTotal(cart) {
    return cartTotalCents(cart) / 100;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function netlifyFunctionUrl(name) {
    var origin = "";
    try {
      origin = String((window.location && window.location.origin) || "");
    } catch (e) {}
    return origin + "/.netlify/functions/" + name;
  }

  function showErr(msg) {
    var el = $("checkout-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function resetPayButton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = "Pay now";
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

  function mergeAnetConfig(remote, local) {
    local = local || {};
    remote = remote || {};
    function trimStr(v) {
      return String(v || "").trim();
    }
    return {
      clientKey: trimStr(remote.clientKey || local.clientKey),
      apiLoginId: trimStr(remote.apiLoginId || local.apiLoginId),
      sandbox:
        typeof remote.sandbox === "boolean"
          ? remote.sandbox
          : local.sandbox !== false
    };
  }

  /** Accept.js E_WC_21 and similar: wrong/mismatched Public Client Key + API Login or sandbox/live mismatch. */
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
        " Check Netlify: ANET_PUBLIC_CLIENT_KEY must be the Public Client Key (Account → Security → Manage Public Client Key), " +
        "not the Transaction Key. Use the same API Login ID as ANET_TRANSACTION_KEY. Set ANET_SANDBOX=true for sandbox, false for production. " +
        "Open " +
        netlifyFunctionUrl("anet-verify-keys") +
        " in your browser to see whether your public key matches Authorize.Net (and whether sandbox mode matches your credentials)."
      );
    }
    return t;
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

  function init() {
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

    var checkoutInvoice = getOrCreateCheckoutInvoice(cart);
    var orderRefInput = $("order-ref");
    if (orderRefInput) {
      orderRefInput.value = checkoutInvoice;
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
        '</ul><p class="checkout-summary-invoice">Order # <strong>' +
        checkoutInvoice +
        '</strong></p><p class="checkout-summary-total">Total <strong data-checkout-total>' +
        formatUsd(total) +
        "</strong></p>";
    }

    $("checkout-amount") && ($("checkout-amount").value = total.toFixed(2));

    fetchPublicAnetConfig().then(function (remote) {
      var cfg = mergeAnetConfig(remote, window.RETTMARK_ANET || {});

      if (!cfg.clientKey || !cfg.apiLoginId) {
        showErr(
          "Checkout is not configured yet. Set ANET_PUBLIC_CLIENT_KEY, ANET_API_LOGIN_ID, and ANET_TRANSACTION_KEY in Netlify, then redeploy."
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

      var shipDiffEl = $("ship-diff");
      var shipBlockEl = $("checkout-shipping-block");
      if (shipDiffEl && shipBlockEl) {
        function syncShippingBlock() {
          var show = shipDiffEl.checked;
          shipBlockEl.hidden = !show;
          shipBlockEl.setAttribute("aria-hidden", show ? "false" : "true");
          if (show) {
            var sf = $("ship-first");
            if (sf) sf.focus();
          }
        }
        shipDiffEl.addEventListener("change", syncShippingBlock);
        syncShippingBlock();
      }

      var checkoutSubmitting = false;

      form.addEventListener("submit", function (e) {
      e.preventDefault();
      showErr("");

      if (checkoutSubmitting) {
        return;
      }

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

      if (
        !String(billTo.address).trim() ||
        !String(billTo.city).trim() ||
        !String(billTo.state).trim() ||
        !String(billTo.zip).trim()
      ) {
        showErr("Please complete your billing address (street, city, state, and ZIP).");
        return;
      }

      var email = ($("bill-email") && $("bill-email").value) || "";

      var useDifferentShipping = $("ship-diff") && $("ship-diff").checked;
      var shipToPayload = null;
      if (useDifferentShipping) {
        shipToPayload = {
          firstName: ($("ship-first") && $("ship-first").value) || "",
          lastName: ($("ship-last") && $("ship-last").value) || "",
          address: ($("ship-address") && $("ship-address").value) || "",
          city: ($("ship-city") && $("ship-city").value) || "",
          state: ($("ship-state") && $("ship-state").value) || "",
          zip: ($("ship-zip") && $("ship-zip").value) || "",
          country: ($("ship-country") && $("ship-country").value) || "US"
        };
        if (
          !String(shipToPayload.firstName).trim() ||
          !String(shipToPayload.lastName).trim() ||
          !String(shipToPayload.address).trim() ||
          !String(shipToPayload.city).trim() ||
          !String(shipToPayload.state).trim() ||
          !String(shipToPayload.zip).trim()
        ) {
          showErr(
            "Please complete the shipping address, or uncheck 'Ship to a different address.'"
          );
          return;
        }
      }

      var cardZipRaw = ($("card-billing-zip") && $("card-billing-zip").value) || "";
      var cardZip = String(cardZipRaw).trim();
      if (!cardZip) {
        showErr("Please enter the billing ZIP for this card.");
        return;
      }

      var expMonthRaw = ($("card-exp-month") && $("card-exp-month").value) || "";
      var expYearRaw = ($("card-exp-year") && $("card-exp-year").value) || "";
      var monthNum = parseInt(String(expMonthRaw).trim(), 10);
      var yearStr = String(expYearRaw).trim();
      if (!isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
        showErr("Please enter the card expiration month as 01–12.");
        return;
      }
      if (!yearStr || !/^\d{2}$/.test(yearStr) && !/^\d{4}$/.test(yearStr)) {
        showErr("Please enter the expiration year as YY (e.g. 28) or YYYY (e.g. 2028).");
        return;
      }

      /* Accept.js requires a 2-digit month string; year may be YY or YYYY per Authorize.Net docs. */
      var cardData = {
        cardNumber: ($("card-number") && $("card-number").value.replace(/\s/g, "")) || "",
        month: pad2(monthNum),
        year: yearStr,
        cardCode: ($("card-cvv") && $("card-cvv").value) || "",
        zip: cardZip.slice(0, 20)
      };

        var authData = {
          clientKey: cfg.clientKey,
          apiLoginID: cfg.apiLoginId
        };

        var secureData = {
          authData: authData,
          cardData: cardData
        };

        checkoutSubmitting = true;

        if (payBtn) {
          payBtn.disabled = true;
          payBtn.textContent = "Processing…";
        }

        var acceptSettled = false;
        var acceptWatchdogMs = 60000;
        var acceptWatchdogId = setTimeout(function () {
          if (acceptSettled) return;
          acceptSettled = true;
          checkoutSubmitting = false;
          showErr(
            "Card security step timed out. Check your connection, disable VPN or strict blockers, or try another browser."
          );
          resetPayButton(payBtn);
        }, acceptWatchdogMs);

        function endAcceptPhase() {
          if (acceptWatchdogId) {
            clearTimeout(acceptWatchdogId);
            acceptWatchdogId = null;
          }
        }

        Accept.dispatchData(secureData, function (response) {
          if (acceptSettled) return;
          acceptSettled = true;
          endAcceptPhase();

          try {
            if (!response || !response.messages) {
              showErr("Unexpected response from payment security script. Try again.");
              checkoutSubmitting = false;
              resetPayButton(payBtn);
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
              showErr(formatAnetClientError(t));
              checkoutSubmitting = false;
              resetPayButton(payBtn);
              return;
            }

            var opaque = response.opaqueData;
            if (!opaque) {
              showErr("No payment token returned.");
              checkoutSubmitting = false;
              resetPayButton(payBtn);
              return;
            }

            var freshCart = readCart();
            var amt = cartTotal(freshCart);
            var invoiceForCharge = getOrCreateCheckoutInvoice(freshCart);
            var refInput = $("order-ref");
            if (refInput) refInput.value = invoiceForCharge;

            var payload = {
              opaqueData: {
                dataDescriptor: opaque.dataDescriptor,
                dataValue: opaque.dataValue
              },
              amount: amt.toFixed(2),
              cart: freshCart,
              customerEmail: email,
              billTo: billTo,
              invoiceNumber: invoiceForCharge
            };
            if (shipToPayload) {
              payload.shipTo = shipToPayload;
            }

            var ac = typeof AbortController !== "undefined" ? new AbortController() : null;
            var payTimeoutMs = 90000;
            var timeoutId = ac
              ? setTimeout(function () {
                  ac.abort();
                }, payTimeoutMs)
              : null;

            var fetchOpts = {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            };
            if (ac) fetchOpts.signal = ac.signal;

            fetch(netlifyFunctionUrl("anet-transaction"), fetchOpts)
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
                  writeCart([]);
                  try {
                    sessionStorage.removeItem(INVOICE_SESSION_KEY);
                    sessionStorage.setItem(
                      "rettmark_last_order",
                      JSON.stringify({
                        transactionId: result.data.transactionId,
                        authCode: result.data.authCode,
                        invoiceNumber: invoiceForCharge
                      })
                    );
                  } catch (ignore) {}
                  window.location.href = "/order-success";
                  return;
                }
                var err =
                  (result.data && result.data.error) ||
                  "Payment could not be completed.";
                showErr(err);
                checkoutSubmitting = false;
                resetPayButton(payBtn);
              })
              .catch(function (err) {
                if (err && err.name === "AbortError") {
                  showErr(
                    "Payment timed out. Check your connection, wait a moment, and try again."
                  );
                } else {
                  showErr("Network error. Try again or contact us.");
                }
                checkoutSubmitting = false;
                resetPayButton(payBtn);
              })
              .finally(function () {
                if (timeoutId) clearTimeout(timeoutId);
              });
          } catch (e) {
            showErr("Something went wrong processing payment. Try again.");
            checkoutSubmitting = false;
            resetPayButton(payBtn);
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
