(function () {
  var CATALOG_URL = "/js/jp-catalog.json";
  var REQUEST_KEY = "rettmark_jp_request_v1";
  var MAX_LINES = 40;
  var MAX_QTY = 20;

  var catalog = [];
  var byId = {};
  var requestLines = [];

  var statusEl = document.getElementById("jp-catalog-status");
  var emptyEl = document.getElementById("jp-request-empty");
  var linesEl = document.getElementById("jp-request-lines");
  var totalEl = document.getElementById("jp-request-total");
  var form = document.getElementById("jp-order-form");
  var rifleSelectEl = document.getElementById("jp-rifle-select");
  var rifleDetailEl = document.getElementById("jp-rifle-detail");
  var rifleEmptyEl = document.getElementById("jp-rifle-empty");
  var addSelectedBtn = document.getElementById("jp-add-selected");

  if (!form || !rifleSelectEl) return;

  function formatUsd(cents) {
    var n = Number(cents || 0) / 100;
    var parts = n.toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "$" + parts.join(".");
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readRequest() {
    try {
      var raw = sessionStorage.getItem(REQUEST_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeRequest() {
    try {
      sessionStorage.setItem(REQUEST_KEY, JSON.stringify(requestLines));
    } catch (e) {}
  }

  function lineQty(id) {
    for (var i = 0; i < requestLines.length; i++) {
      if (requestLines[i].id === id) return requestLines[i].qty;
    }
    return 0;
  }

  function addToRequest(id) {
    var item = byId[id];
    if (!item) return;
    var existing = null;
    for (var i = 0; i < requestLines.length; i++) {
      if (requestLines[i].id === id) {
        existing = requestLines[i];
        break;
      }
    }
    if (existing) {
      existing.qty = Math.min(MAX_QTY, (parseInt(existing.qty, 10) || 0) + 1);
    } else {
      if (requestLines.length >= MAX_LINES) {
        showFormError("This request is at the " + MAX_LINES + " item limit. Remove a line or note extras in the comments.");
        return;
      }
      requestLines.push({ id: id, qty: 1 });
    }
    writeRequest();
    renderRequest();
    renderRifleDetail();
  }

  function setQty(id, qty) {
    var n = parseInt(qty, 10);
    if (!isFinite(n) || n < 1) {
      requestLines = requestLines.filter(function (line) {
        return line.id !== id;
      });
    } else {
      for (var i = 0; i < requestLines.length; i++) {
        if (requestLines[i].id === id) {
          requestLines[i].qty = Math.min(MAX_QTY, n);
          break;
        }
      }
    }
    writeRequest();
    renderRequest();
    renderRifleDetail();
  }

  function requestTotalCents() {
    var sum = 0;
    for (var i = 0; i < requestLines.length; i++) {
      var item = byId[requestLines[i].id];
      var qty = parseInt(requestLines[i].qty, 10) || 0;
      if (item) sum += item.mapCents * qty;
    }
    return sum;
  }

  function requestHasFirearm() {
    for (var i = 0; i < requestLines.length; i++) {
      var item = byId[requestLines[i].id];
      if (item && item.firearm) return true;
    }
    return false;
  }

  function renderRequest() {
    if (!requestLines.length) {
      emptyEl.hidden = false;
      linesEl.hidden = true;
      totalEl.hidden = true;
      linesEl.innerHTML = "";
      return;
    }
    emptyEl.hidden = true;
    linesEl.hidden = false;
    totalEl.hidden = false;
    var html = "";
    for (var i = 0; i < requestLines.length; i++) {
      var line = requestLines[i];
      var item = byId[line.id];
      if (!item) continue;
      html +=
        '<li class="jp-request-line">' +
        '<div class="jp-request-line__meta">' +
        '<span class="jp-request-line__sku">' +
        esc(item.sku) +
        "</span>" +
        '<span class="jp-request-line__name">' +
        esc(item.name) +
        "</span>" +
        '<span class="jp-request-line__price">Price ' +
        formatUsd(item.mapCents) +
        "</span>" +
        "</div>" +
        '<div class="jp-request-line__qty">' +
        '<label>Qty <input class="jp-qty" type="number" min="1" max="' +
        MAX_QTY +
        '" value="' +
        esc(String(line.qty)) +
        '" data-id="' +
        esc(item.id) +
        '" /></label>' +
        '<button type="button" class="jp-remove" data-remove="' +
        esc(item.id) +
        '">Remove</button>' +
        "</div>" +
        "</li>";
    }
    linesEl.innerHTML = html;
    var extra = requestHasFirearm()
      ? " Built rifles take additional time after we confirm the order."
      : "";
    totalEl.textContent =
      "Estimated total " +
      formatUsd(requestTotalCents()) +
      " (before tax, shipping, and transfer)." +
      extra;
  }

  function syncAddSelected() {
    if (!addSelectedBtn) return;
    var id = rifleSelectEl.value;
    var item = id ? byId[id] : null;
    if (!item) {
      addSelectedBtn.disabled = true;
      addSelectedBtn.textContent = "Add to request";
      return;
    }
    var inReq = lineQty(item.id);
    addSelectedBtn.disabled = false;
    addSelectedBtn.textContent = inReq ? "Add another (" + inReq + ")" : "Add to request";
  }

  function fillRifleSelect() {
    var current = rifleSelectEl.value;
    var html = '<option value="">Select a rifle or pistol</option>';
    var lastCat = "";
    for (var i = 0; i < catalog.length; i++) {
      var item = catalog[i];
      if (!item.firearm) continue;
      if (item.category !== lastCat) {
        if (lastCat) html += "</optgroup>";
        lastCat = item.category;
        html += '<optgroup label="' + esc(lastCat) + '">';
      }
      var label =
        (item.model ? item.model + " · " : "") +
        item.sku +
        " — " +
        formatUsd(item.mapCents);
      if (item.limited) label += " · limited";
      html += '<option value="' + esc(item.id) + '">' + esc(label) + "</option>";
    }
    if (lastCat) html += "</optgroup>";
    rifleSelectEl.innerHTML = html;
    if (current && byId[current]) rifleSelectEl.value = current;
  }

  function renderRifleDetail() {
    var id = rifleSelectEl.value;
    var item = id ? byId[id] : null;
    syncAddSelected();
    if (!rifleDetailEl || !rifleEmptyEl) return;
    if (!item) {
      rifleDetailEl.hidden = true;
      rifleDetailEl.innerHTML = "";
      rifleEmptyEl.hidden = false;
      return;
    }
    rifleEmptyEl.hidden = true;
    rifleDetailEl.hidden = false;
    var inReq = lineQty(item.id);
    var img = item.image
      ? '<div class="jp-rifle-photo-wrap"><img class="jp-rifle-photo" src="' +
        esc(item.image) +
        '" alt="' +
        esc((item.model || item.name) + " from JP Enterprises") +
        '" decoding="async" /></div>'
      : "";
    var badges = "";
    if (item.firearm) badges += '<span class="jp-badge jp-badge--firearm">Built rifle/pistol — extra lead time</span>';
    if (item.limited) badges += '<span class="jp-badge jp-badge--limited">Limited inventory</span>';
    var more = item.sourceUrl
      ? '<p class="jp-rifle-source">Photo and description from JP Enterprises. <a href="' +
        esc(item.sourceUrl) +
        '" rel="noopener noreferrer" target="_blank">Read more on jprifles.com</a></p>'
      : "";
    rifleDetailEl.innerHTML =
      img +
      '<div class="jp-rifle-copy">' +
      "<h3>" +
      esc(item.model || item.name) +
      "</h3>" +
      '<p class="jp-row__sku">' +
      esc(item.sku) +
      "</p>" +
      '<p class="jp-rifle-config">' +
      esc(item.name) +
      "</p>" +
      (badges ? '<p class="jp-row__badges">' + badges + "</p>" : "") +
      (item.description ? '<p class="jp-rifle-desc">' + esc(item.description) + "</p>" : "") +
      more +
      '<div class="jp-rifle-buy">' +
      '<div class="jp-row__price">' +
      '<p class="jp-map">Price ' +
      formatUsd(item.mapCents) +
      "</p>" +
      (item.retailCents && item.retailCents !== item.mapCents
        ? '<p class="jp-retail">MSRP ' + formatUsd(item.retailCents) + "</p>"
        : "") +
      "</div>" +
      '<button type="button" class="jp-add" data-add="' +
      esc(item.id) +
      '">' +
      (inReq ? "Add another (" + inReq + ")" : "Add to request") +
      "</button>" +
      "</div></div>";
  }

  function showFormError(msg) {
    var el = form.querySelector(".notify-form__error");
    if (!el) return;
    el.textContent = msg;
    el.removeAttribute("hidden");
  }

  function clearFormError() {
    var el = form.querySelector(".notify-form__error");
    if (!el) return;
    el.textContent = "";
    el.setAttribute("hidden", "");
  }

  function showSuccess(msg) {
    var el = document.getElementById("jp-order-success");
    if (!el) return;
    el.textContent = msg;
    el.removeAttribute("hidden");
  }

  rifleSelectEl.addEventListener("change", renderRifleDetail);

  if (rifleDetailEl) {
    rifleDetailEl.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-add]") : null;
      if (!btn) return;
      ev.preventDefault();
      addToRequest(btn.getAttribute("data-add"));
    });
  }

  if (addSelectedBtn) {
    addSelectedBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      addToRequest(rifleSelectEl.value);
    });
  }

  linesEl.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest("[data-remove]") : null;
    if (!btn) return;
    ev.preventDefault();
    setQty(btn.getAttribute("data-remove"), 0);
  });

  linesEl.addEventListener("change", function (ev) {
    var input = ev.target;
    if (!input || !input.getAttribute("data-id")) return;
    setQty(input.getAttribute("data-id"), input.value);
  });

  fetch(CATALOG_URL, { cache: "no-store" })
    .then(function (res) {
      return res.ok ? res.json() : Promise.reject(new Error("catalog"));
    })
    .then(function (data) {
      catalog = (data && data.items) || [];
      byId = {};
      for (var i = 0; i < catalog.length; i++) {
        byId[catalog[i].id] = catalog[i];
      }
      var stored = readRequest();
      requestLines = [];
      for (var j = 0; j < stored.length; j++) {
        if (stored[j] && byId[stored[j].id] && byId[stored[j].id].firearm) {
          requestLines.push({
            id: stored[j].id,
            qty: Math.min(MAX_QTY, Math.max(1, parseInt(stored[j].qty, 10) || 1))
          });
        }
      }
      renderRequest();
      fillRifleSelect();
      renderRifleDetail();
    })
    .catch(function () {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "Could not load the JP list. Refresh the page or email orders@rettmarkfirearms.com.";
      }
      if (rifleEmptyEl) {
        rifleEmptyEl.hidden = false;
        rifleEmptyEl.textContent = "Could not load the JP list. Refresh the page or email orders@rettmarkfirearms.com.";
      }
    });

  var siteKey =
    typeof window.RETTMARK_TURNSTILE_SITE_KEY === "string"
      ? window.RETTMARK_TURNSTILE_SITE_KEY.trim()
      : "";

  function setSubmitting(busy) {
    var btn = form.querySelector(".jp-submit");
    if (!btn) return;
    if (busy) {
      btn.disabled = true;
      btn.dataset.jpLabel = btn.textContent || "Submit order request";
      btn.textContent = "Sending request…";
    } else {
      btn.textContent = btn.dataset.jpLabel || "Submit order request";
      btn.disabled = !siteKey;
    }
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    clearFormError();

    if (!requestLines.length) {
      showFormError("Add at least one JP rifle to the request list first.");
      return;
    }
    if (!siteKey) {
      showFormError("Request security is not configured on this site. Please email orders@rettmarkfirearms.com instead.");
      return;
    }

    var honeypot = form.querySelector('input[name="bot-field"]');
    if (honeypot && String(honeypot.value || "").trim()) {
      showSuccess("Request received. We will contact you to confirm.");
      form.querySelectorAll("input, textarea, button").forEach(function (el) {
        el.disabled = true;
      });
      return;
    }

    var name = String((form.querySelector("#jp-name") || {}).value || "").trim();
    var email = String((form.querySelector("#jp-email") || {}).value || "").trim();
    var phone = String((form.querySelector("#jp-phone") || {}).value || "").trim();
    var ffl = String((form.querySelector("#jp-ffl") || {}).value || "").trim();
    var notes = String((form.querySelector("#jp-notes") || {}).value || "").trim();
    if (!name || !email || !phone) {
      showFormError("Name, email, and phone are required so we can confirm the request.");
      return;
    }

    var tokenEl = form.querySelector(
      'textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]'
    );
    var token = tokenEl && tokenEl.value;
    if (!token) {
      showFormError("Please complete the security check before submitting.");
      return;
    }

    setSubmitting(true);
    fetch(form.getAttribute("action") || "/.netlify/functions/jp-order-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone,
        ffl: ffl,
        notes: notes,
        items: requestLines,
        "bot-field": honeypot ? String(honeypot.value || "") : "",
        turnstileToken: token
      })
    })
      .then(function (res) {
        return res.json().then(
          function (data) {
            return { res: res, data: data || {} };
          },
          function () {
            return { res: res, data: {} };
          }
        );
      })
      .then(function (pack) {
        if (pack.res.ok && pack.data.ok) {
          requestLines = [];
          writeRequest();
          renderRequest();
          renderRifleDetail();
          showSuccess(
            "Request received. This is not a charge. We will contact you to confirm the order, FFL details if needed, and payment."
          );
          form.querySelectorAll("input:not([name='bot-field']), textarea, button, select").forEach(function (el) {
            el.disabled = true;
          });
          return;
        }
        setSubmitting(false);
        showFormError(
          pack.data.userMessage ||
            "Could not send the request right now. Please try again or email orders@rettmarkfirearms.com."
        );
        if (
          window.turnstile &&
          typeof window.turnstile.reset === "function" &&
          form._rettmarkTurnstileWidgetId != null
        ) {
          window.turnstile.reset(form._rettmarkTurnstileWidgetId);
        }
      })
      .catch(function () {
        setSubmitting(false);
        showFormError("Could not send the request right now. Please try again or email orders@rettmarkfirearms.com.");
      });
  });

  function loadTurnstile() {
    var mount = form.querySelector("[data-turnstile-mount]");
    var btn = form.querySelector(".jp-submit");
    if (!siteKey) {
      if (btn) btn.disabled = true;
      showFormError(
        "Request security is not configured on this preview. On the live site you can submit here; for now email orders@rettmarkfirearms.com."
      );
      return;
    }
    if (!mount || !btn) return;

    function renderWidget() {
      if (!window.turnstile) return;
      btn.disabled = true;
      form._rettmarkTurnstileWidgetId = window.turnstile.render(mount, {
        sitekey: siteKey,
        theme: "dark",
        callback: function () {
          clearFormError();
          btn.disabled = false;
        },
        "expired-callback": function () {
          btn.disabled = true;
        },
        "error-callback": function () {
          btn.disabled = true;
          showFormError("Security check failed. Please refresh the page.");
        }
      });
    }

    if (window.turnstile) {
      renderWidget();
      return;
    }
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = renderWidget;
    s.onerror = function () {
      btn.disabled = true;
      showFormError("Security check could not load. Please try again later.");
    };
    document.head.appendChild(s);
  }

  loadTurnstile();
})();
