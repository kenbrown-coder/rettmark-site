(function () {
  function syncHeaderOffset() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    document.documentElement.style.setProperty("--header-offset", header.offsetHeight + "px");
  }

  syncHeaderOffset();
  window.addEventListener("resize", syncHeaderOffset);

  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

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

  function cartCount(cart) {
    return cart.reduce(function (sum, item) { return sum + (parseInt(item.qty, 10) || 0); }, 0);
  }

  function formatUsd(n) {
    var num = Number(n || 0);
    return "$" + num.toFixed(2);
  }

  function updateHeaderCartCount() {
    var cart = readCart();
    var count = cartCount(cart);
    var countEls = document.querySelectorAll(".cart-count");
    countEls.forEach(function (el) { el.textContent = String(count); });
    var pills = document.querySelectorAll(".cart-pill");
    pills.forEach(function (el) {
      el.setAttribute("aria-label", "Shopping cart, " + count + " items");
    });
  }

  function showToast(message) {
    var el = document.getElementById("site-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "site-toast";
      el.className = "site-toast";
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("is-visible");
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(function () {
      el.classList.remove("is-visible");
    }, 1600);
  }

  function renderCartPage() {
    var root = document.getElementById("cart-root");
    if (!root) return;
    var cart = readCart();
    if (!cart.length) {
      root.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
      return;
    }

    var total = 0;
    var list = cart.map(function (item, idx) {
      var qty = parseInt(item.qty, 10) || 0;
      var price = Number(item.price || 0);
      var line = qty * price;
      total += line;
      var meta = [item.variant || "", item.color || "", item.sku || ""].filter(Boolean).join(" · ");
      return (
        '<article class="cart-item">' +
          '<div class="cart-item-head">' +
            '<div>' +
              '<p class="cart-item-title">' + (item.name || "Item") + '</p>' +
              '<p class="cart-item-meta">' + meta + '</p>' +
            '</div>' +
            '<strong>' + formatUsd(line) + '</strong>' +
          '</div>' +
          '<div class="cart-item-controls">' +
            '<div class="qty-controls">' +
              '<button class="qty-btn" type="button" data-cart-dec="' + idx + '" aria-label="Decrease quantity">−</button>' +
              '<span class="qty-value">' + qty + '</span>' +
              '<button class="qty-btn" type="button" data-cart-inc="' + idx + '" aria-label="Increase quantity">+</button>' +
            '</div>' +
            '<button class="cart-remove" type="button" data-cart-remove="' + idx + '">Remove</button>' +
          '</div>' +
        '</article>'
      );
    }).join("");

    root.innerHTML =
      '<div class="cart-list">' + list + '</div>' +
      '<div class="cart-summary"><span>Estimated total</span><strong>' + formatUsd(total) + "</strong></div>" +
      '<div class="cart-tools"><button class="cart-remove" type="button" data-cart-clear="1">Clear cart</button></div>';
  }

  function selectedVariantDetails() {
    var sku =
      (document.getElementById("variant-sku") && document.getElementById("variant-sku").textContent) ||
      (document.getElementById("bag-sku") && document.getElementById("bag-sku").textContent) ||
      "";
    var color =
      (document.getElementById("variant-color") && document.getElementById("variant-color").textContent) ||
      (document.getElementById("bag-color") && document.getElementById("bag-color").textContent) ||
      "";
    var img =
      (document.getElementById("product-hero-img") && document.getElementById("product-hero-img").getAttribute("src")) ||
      (document.getElementById("bag-hero-img") && document.getElementById("bag-hero-img").getAttribute("src")) ||
      "";
    return { sku: (sku || "").trim(), color: (color || "").trim(), image: img || "" };
  }

  function addToCartFromButton(btn) {
    var mode = btn.getAttribute("data-mode") || "";
    var details = selectedVariantDetails();
    var sku = (mode === "selected-variant" ? details.sku : btn.getAttribute("data-sku")) || "";
    sku = sku.trim();
    if (!sku) {
      if (mode === "selected-variant") {
        showToast("Choose all options before adding to cart");
      }
      return;
    }

    var item = {
      sku: sku,
      name: btn.getAttribute("data-name") || "Item",
      variant: btn.getAttribute("data-variant") || "",
      color: mode === "selected-variant" ? details.color : "",
      price: parseFloat(btn.getAttribute("data-price") || "0"),
      image: mode === "selected-variant" ? details.image : (btn.getAttribute("data-image") || ""),
      url: btn.getAttribute("data-url") || "",
      qty: 1
    };

    var cart = readCart();
    var existing = cart.find(function (x) { return x.sku === item.sku; });
    if (existing) existing.qty = (parseInt(existing.qty, 10) || 0) + 1;
    else cart.push(item);
    writeCart(cart);
    updateHeaderCartCount();
    renderCartPage();
    showToast("Added to cart");
  }

  function initCart() {
    updateHeaderCartCount();
    renderCartPage();

    document.addEventListener("click", function (e) {
      var addBtn = e.target && e.target.closest && e.target.closest("[data-add-to-cart]");
      if (addBtn) {
        addToCartFromButton(addBtn);
        return;
      }

      var dec = e.target && e.target.getAttribute && e.target.getAttribute("data-cart-dec");
      var inc = e.target && e.target.getAttribute && e.target.getAttribute("data-cart-inc");
      var rem = e.target && e.target.getAttribute && e.target.getAttribute("data-cart-remove");
      var clr = e.target && e.target.getAttribute && e.target.getAttribute("data-cart-clear");
      if (dec !== null || inc !== null || rem !== null || clr !== null) {
        var cart = readCart();
        if (dec !== null) {
          var i = parseInt(dec, 10);
          if (!isNaN(i) && cart[i]) {
            cart[i].qty = Math.max(1, (parseInt(cart[i].qty, 10) || 1) - 1);
          }
        }
        if (inc !== null) {
          var j = parseInt(inc, 10);
          if (!isNaN(j) && cart[j]) {
            cart[j].qty = (parseInt(cart[j].qty, 10) || 0) + 1;
          }
        }
        if (rem !== null) {
          var k = parseInt(rem, 10);
          if (!isNaN(k) && cart[k]) cart.splice(k, 1);
        }
        if (clr !== null) {
          cart = [];
        }
        writeCart(cart);
        updateHeaderCartCount();
        renderCartPage();
      }
    });
  }

  initCart();

  function loadInventory() {
    function toInt(n) {
      var x = parseInt(n, 10);
      return isNaN(x) ? 0 : x;
    }

    function getQty(inv, sku) {
      if (!sku) return 0;
      var items = inv && inv.items;
      var entry = items && items[sku];
      if (entry && typeof entry.qty !== "undefined") return toInt(entry.qty);

      // Back-compat: older schema used status strings.
      if (entry && entry.status === "in_stock") return 1;
      return 0;
    }

    function getStatus(inv, sku) {
      // Policy: if qty == 0, we accept preorders (charge now, order to fulfill).
      return getQty(inv, sku) > 0 ? "in_stock" : "backorder";
    }

    function renderBadge(el, status) {
      if (!el) return;
      el.classList.remove("is-in-stock", "is-out", "is-preorder");
      if (status === "in_stock") {
        el.textContent = "In stock";
        el.classList.add("is-in-stock");
      } else if (status === "backorder") {
        el.textContent = "Preorder";
        el.classList.add("is-preorder");
      } else {
        el.textContent = "Out of stock";
        el.classList.add("is-out");
      }
    }

    function renderBadgeWithQty(el, status, qty) {
      renderBadge(el, status);
      if (status === "in_stock") {
        el.textContent = "In stock (" + qty + ")";
      }
    }

    function renderCta(cta, status) {
      if (!cta) return;
      if (status === "in_stock") cta.textContent = "Add to cart";
      else if (status === "backorder") cta.textContent = "Preorder";
      else cta.textContent = "Out of stock";
    }

    function applyInventory(inv) {
      // Catalog cards
      var cards = document.querySelectorAll("[data-stock-badge]");
      cards.forEach(function (el) {
        var sku = el.getAttribute("data-sku") || (el.closest("[data-sku]") && el.closest("[data-sku]").getAttribute("data-sku")) || "";
        var qty = getQty(inv, sku);
        var status = qty > 0 ? "in_stock" : "backorder";
        renderBadgeWithQty(el, status, qty);
      });

      // Product pages
      var statusEls = document.querySelectorAll("[data-stock-status]");
      statusEls.forEach(function (el) {
        var sku = el.getAttribute("data-sku") || "";
        var qty = getQty(inv, sku);
        var status = qty > 0 ? "in_stock" : "backorder";
        renderBadgeWithQty(el, status, qty);
      });

      var ctaEls = document.querySelectorAll("[data-stock-cta]");
      ctaEls.forEach(function (el) {
        // Prefer currently-selected SKU in the page, if present.
        var sku =
          (document.getElementById("variant-sku") && document.getElementById("variant-sku").textContent) ||
          (document.getElementById("bag-sku") && document.getElementById("bag-sku").textContent) ||
          (document.querySelector("[data-stock-status]") && document.querySelector("[data-stock-status]").getAttribute("data-sku")) ||
          "";
        sku = (sku || "").trim();
        var qty = getQty(inv, sku);
        var status = qty > 0 ? "in_stock" : "backorder";
        renderCta(el, status);
      });

      // When a variant chip is clicked, update stock display to that SKU.
      document.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest && e.target.closest(".variant-chip");
        if (!btn) return;
        var sku = (btn.getAttribute("data-variant-sku") || "").trim();
        if (!sku) return;
        var qty = getQty(inv, sku);
        var status = qty > 0 ? "in_stock" : "backorder";

        var badge = document.querySelector("[data-stock-status]");
        if (badge) {
          badge.setAttribute("data-sku", sku);
          renderBadgeWithQty(badge, status, qty);
        }
        var cta = document.querySelector("[data-stock-cta]");
        renderCta(cta, status);
      });
    }

    function parseCsv(text) {
      var lines = (text || "").split(/\r?\n/).filter(function (l) { return l.trim().length; });
      if (!lines.length) return null;
      var header = lines[0].split(",").map(function (h) { return h.trim().toLowerCase(); });
      var skuIdx = header.indexOf("sku");
      var qtyIdx = header.indexOf("qty");
      if (skuIdx === -1 || qtyIdx === -1) return null;

      var items = {};
      for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(",");
        var sku = (cols[skuIdx] || "").trim();
        if (!sku) continue;
        var qty = toInt((cols[qtyIdx] || "").trim());
        items[sku] = { qty: qty };
      }
      return { items: items };
    }

    // Prefer spreadsheet-friendly CSV; fall back to JSON.
    fetch("inventory.csv", { cache: "no-store" })
      .then(function (r) {
        try {
          var lm = r.headers && r.headers.get && r.headers.get("last-modified");
          if (lm) {
            setInventoryLastUpdated(lm);
          }
        } catch (e) {}
        return r.ok ? r.text() : "";
      })
      .then(function (csvText) {
        var inv = parseCsv(csvText);
        if (inv) {
          applyInventory(inv);
          return true;
        }
        return false;
      })
      .then(function (csvWorked) {
        if (csvWorked) return;
        return fetch("inventory.json", { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (inv) { if (inv) applyInventory(inv); });
      })
      .catch(function () {});
  }

  function setInventoryLastUpdated(lastModifiedHeader) {
    var date = new Date(lastModifiedHeader);
    if (!date || isNaN(date.getTime())) return;

    var formatted = date.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });

    var footerLegal = document.querySelector(".site-footer-legal");
    var footer = footerLegal || document.querySelector(".site-footer");
    if (!footer) return;

    var existing = document.getElementById("inventory-last-updated");
    if (existing) return;

    var el = document.createElement("div");
    el.id = "inventory-last-updated";
    el.className = "inventory-updated";
    el.textContent = "Inventory last updated: " + formatted;

    if (footerLegal) footerLegal.appendChild(el);
    else footer.appendChild(el);
  }

  loadInventory();

  function initCasesHelpers() {
    if (!document.body || !document.body.classList.contains("page-cases")) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "back-to-top";
    btn.setAttribute("aria-label", "Back to top");
    btn.textContent = "Top";
    document.body.appendChild(btn);

    function onScroll() {
      if (window.scrollY > 640) btn.classList.add("is-visible");
      else btn.classList.remove("is-visible");
    }

    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  initCasesHelpers();

  function initCasesSearchAndFilter() {
    if (!document.body || !document.body.classList.contains("page-cases")) return;

    var search = document.getElementById("cases-search");
    var filter = document.getElementById("cases-filter");
    if (!search && !filter) return;

    function normalize(s) {
      return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    }

    function apply() {
      var q = normalize(search && search.value);
      var cat = (filter && filter.value) || "";

      var sections = Array.prototype.slice.call(document.querySelectorAll(".cases-section"));
      sections.forEach(function (sec) {
        var details = sec.querySelector(".cases-accordion");
        var id = details && details.getAttribute("id");
        var inCategory = !cat || id === cat;

        var anyVisible = false;
        var cards = Array.prototype.slice.call(sec.querySelectorAll(".product-card"));
        cards.forEach(function (card) {
          var hay = normalize(
            (card.getAttribute("data-title") || "") + " " +
            (card.getAttribute("data-variant") || "") + " " +
            (card.textContent || "")
          );
          var matches = !q || hay.indexOf(q) !== -1;
          var show = inCategory && matches;
          card.style.display = show ? "" : "none";
          if (show) anyVisible = true;
        });

        sec.style.display = anyVisible ? "" : "none";
        if (details) {
          if (cat && id === cat) details.open = true;
          if (q && anyVisible) details.open = true;
        }
      });
    }

    if (search) search.addEventListener("input", apply);
    if (filter) filter.addEventListener("change", apply);
    apply();
  }

  initCasesSearchAndFilter();

  function initSupplyNotice() {
    var dlg = document.getElementById("supply-notice");
    if (!dlg || typeof dlg.showModal !== "function") return;
    dlg.showModal();
  }

  initSupplyNotice();

  function initHhdgOrderNotice() {
    var shop = document.getElementById("hhdg-shop");
    var catalog = document.getElementById("hhdg-catalog");
    var dlg = document.getElementById("hhdg-order-notice");
    if (!shop || !catalog || !dlg || typeof dlg.showModal !== "function") return;

    var key = "rettmark_hhdg_order_notice_v1";

    function unlock() {
      catalog.removeAttribute("inert");
      catalog.removeAttribute("aria-hidden");
      shop.classList.remove("is-locked");
    }

    if (localStorage.getItem(key) === "1") {
      unlock();
      return;
    }

    var form = dlg.querySelector("form");
    if (form) {
      form.addEventListener("submit", function () {
        try {
          localStorage.setItem(key, "1");
        } catch (e) {}
        unlock();
      });
    }

    dlg.showModal();
  }

  initHhdgOrderNotice();

  var crest = document.querySelector(".crest-wrap");
  if (!crest || document.body.dataset.shieldAnim === "off") {
    if (crest) {
      crest.classList.add("resting");
    }
    return;
  }

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isMobile = window.matchMedia("(max-width: 640px)").matches;

  if (prefersReduced) {
    crest.classList.add("resting");
    return;
  }

  var hold = isMobile ? 400 : 500;
  var spin = isMobile ? 2200 : 2600;
  var total = hold + spin;

  requestAnimationFrame(function () {
    crest.animate(
      [
        {
          offset: 0,
          opacity: 0,
          transform: "scale(1) rotateY(0deg)",
          filter:
            "drop-shadow(0 24px 44px rgba(0,0,0,0.5)) drop-shadow(0 0 12px rgba(230,0,0,0.12))"
        },
        {
          offset: 0.08,
          opacity: 1,
          transform: "scale(1) rotateY(0deg)",
          filter:
            "drop-shadow(0 24px 44px rgba(0,0,0,0.5)) drop-shadow(0 0 12px rgba(230,0,0,0.12))"
        },
        {
          offset: hold / total,
          opacity: 1,
          transform: "scale(1) rotateY(0deg)",
          filter:
            "drop-shadow(0 24px 44px rgba(0,0,0,0.5)) drop-shadow(0 0 12px rgba(230,0,0,0.12))"
        },
        {
          offset: 0.58,
          opacity: 1,
          transform: "scale(1.01) rotateY(-126deg)",
          filter:
            "drop-shadow(0 16px 26px rgba(0,0,0,0.35)) drop-shadow(0 0 6px rgba(230,0,0,0.06))"
        },
        {
          offset: 0.86,
          opacity: 1,
          transform: "scale(1) rotateY(-18deg)",
          filter: "drop-shadow(0 10px 16px rgba(0,0,0,0.25))"
        },
        {
          offset: 1,
          opacity: 0.28,
          transform: isMobile
            ? "translateY(-64px) scale(1) rotateY(0deg)"
            : "scale(1) rotateY(0deg)",
          filter: isMobile
            ? "brightness(1.4) contrast(1.1)"
            : "brightness(1.15) contrast(1.06)"
        }
      ],
      {
        duration: total,
        easing: "cubic-bezier(0.2, 0.72, 0.2, 1)",
        fill: "forwards"
      }
    ).onfinish = function () {
      crest.classList.add("resting");
    };
  });
})();
