(function () {
  var CART_KEY = "rettmark_cart_v1";
  var ADDRESS_SESSION_KEY = "rettmark_checkout_address_v1";

  /** Resolve next page from current URL (works on Netlify, Live Server, and subfolders — avoids broken `/page.html` to domain root). */
  function go(htmlFile) {
    window.location.href = new URL(htmlFile, window.location.href).href;
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

  function $(id) {
    return document.getElementById(id);
  }

  function showErr(msg) {
    var el = $("checkout-address-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  var shipIds = ["ship-first", "ship-last", "ship-address", "ship-city", "ship-state", "ship-zip", "ship-country"];
  var billIds = ["bill-first", "bill-last", "bill-address", "bill-city", "bill-state", "bill-zip", "bill-country"];

  function getShipPayload() {
    return {
      firstName: ($("ship-first") && $("ship-first").value) || "",
      lastName: ($("ship-last") && $("ship-last").value) || "",
      address: ($("ship-address") && $("ship-address").value) || "",
      city: ($("ship-city") && $("ship-city").value) || "",
      state: ($("ship-state") && $("ship-state").value) || "",
      zip: ($("ship-zip") && $("ship-zip").value) || "",
      country: ($("ship-country") && $("ship-country").value) || "US"
    };
  }

  function getBillPayload() {
    return {
      firstName: ($("bill-first") && $("bill-first").value) || "",
      lastName: ($("bill-last") && $("bill-last").value) || "",
      address: ($("bill-address") && $("bill-address").value) || "",
      city: ($("bill-city") && $("bill-city").value) || "",
      state: ($("bill-state") && $("bill-state").value) || "",
      zip: ($("bill-zip") && $("bill-zip").value) || "",
      country: ($("bill-country") && $("bill-country").value) || "US"
    };
  }

  function copyShipToBill() {
    var ship = getShipPayload();
    var map = [
      ["ship-first", "bill-first"],
      ["ship-last", "bill-last"],
      ["ship-address", "bill-address"],
      ["ship-city", "bill-city"],
      ["ship-state", "bill-state"],
      ["ship-zip", "bill-zip"],
      ["ship-country", "bill-country"]
    ];
    map.forEach(function (pair) {
      var s = $(pair[0]);
      var b = $(pair[1]);
      if (s && b) b.value = s.value;
    });
  }

  function setBillingFieldsDisabled(disabled) {
    billIds.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.disabled = disabled;
      el.setAttribute("aria-disabled", disabled ? "true" : "false");
    });
  }

  function validateAddress(label, a) {
    if (!String(a.firstName).trim() || !String(a.lastName).trim()) {
      return label + ": enter first and last name.";
    }
    if (
      !String(a.address).trim() ||
      !String(a.city).trim() ||
      !String(a.state).trim() ||
      !String(a.zip).trim()
    ) {
      return label + ": enter street, city, state, and ZIP.";
    }
    return "";
  }

  function init() {
    var cart = readCart();
    if (!cart.length) {
      go("cart.html");
      return;
    }

    var summaryEl = $("checkout-address-summary");
    if (summaryEl) {
      var total = cartTotal(cart);
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
        '</ul><p class="checkout-summary-total">Estimated total <strong>' +
        formatUsd(total) +
        "</strong></p>";
    }

    var sameChk = $("bill-same-as-ship");
    var form = $("checkout-address-form");
    if (!sameChk || !form) return;

    function syncSameAsShip() {
      var on = sameChk.checked;
      setBillingFieldsDisabled(on);
      if (on) {
        copyShipToBill();
      }
    }

    shipIds.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("input", function () {
        if (sameChk.checked) copyShipToBill();
      });
      el.addEventListener("change", function () {
        if (sameChk.checked) copyShipToBill();
      });
    });

    sameChk.addEventListener("change", function () {
      syncSameAsShip();
    });

    syncSameAsShip();

    try {
      var raw = sessionStorage.getItem(ADDRESS_SESSION_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          if (saved.email && $("checkout-email")) $("checkout-email").value = saved.email;
          if (saved.shipping) {
            var sh = saved.shipping;
            if ($("ship-first")) $("ship-first").value = sh.firstName || "";
            if ($("ship-last")) $("ship-last").value = sh.lastName || "";
            if ($("ship-address")) $("ship-address").value = sh.address || "";
            if ($("ship-city")) $("ship-city").value = sh.city || "";
            if ($("ship-state")) $("ship-state").value = sh.state || "";
            if ($("ship-zip")) $("ship-zip").value = sh.zip || "";
            if ($("ship-country")) $("ship-country").value = sh.country || "US";
          }
          if (typeof saved.billingSameAsShipping === "boolean") {
            sameChk.checked = saved.billingSameAsShipping;
          }
          if (saved.billing && !saved.billingSameAsShipping) {
            var bi = saved.billing;
            if ($("bill-first")) $("bill-first").value = bi.firstName || "";
            if ($("bill-last")) $("bill-last").value = bi.lastName || "";
            if ($("bill-address")) $("bill-address").value = bi.address || "";
            if ($("bill-city")) $("bill-city").value = bi.city || "";
            if ($("bill-state")) $("bill-state").value = bi.state || "";
            if ($("bill-zip")) $("bill-zip").value = bi.zip || "";
            if ($("bill-country")) $("bill-country").value = bi.country || "US";
          }
          syncSameAsShip();
        }
      }
    } catch (e) {}

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      showErr("");

      var email = ($("checkout-email") && $("checkout-email").value) || "";
      if (!String(email).trim()) {
        showErr("Please enter your email.");
        return;
      }

      var shipping = getShipPayload();
      var shipErr = validateAddress("Shipping", shipping);
      if (shipErr) {
        showErr(shipErr);
        return;
      }

      if (sameChk.checked) {
        copyShipToBill();
      }

      var billing = getBillPayload();
      var billErr = validateAddress("Billing", billing);
      if (billErr) {
        showErr(billErr);
        return;
      }

      var payload = {
        email: String(email).trim(),
        shipping: {
          firstName: String(shipping.firstName).trim(),
          lastName: String(shipping.lastName).trim(),
          address: String(shipping.address).trim(),
          city: String(shipping.city).trim(),
          state: String(shipping.state).trim(),
          zip: String(shipping.zip).trim(),
          country: String(shipping.country || "US").trim() || "US"
        },
        billing: {
          firstName: String(billing.firstName).trim(),
          lastName: String(billing.lastName).trim(),
          address: String(billing.address).trim(),
          city: String(billing.city).trim(),
          state: String(billing.state).trim(),
          zip: String(billing.zip).trim(),
          country: String(billing.country || "US").trim() || "US"
        },
        billingSameAsShipping: Boolean(sameChk.checked)
      };

      try {
        sessionStorage.setItem(ADDRESS_SESSION_KEY, JSON.stringify(payload));
      } catch (e2) {
        showErr("Could not save your addresses. Check that cookies/storage are allowed.");
        return;
      }

      go("checkout-review.html");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
