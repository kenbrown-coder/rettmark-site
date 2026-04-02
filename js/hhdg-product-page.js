/**
 * HHDG / shooting-glasses product pages: option → SKU sync + gallery thumbs.
 * Loaded as external file so Netlify CSP (script-src 'self' only) allows execution;
 * inline scripts on these pages are blocked.
 */
(function () {
  function initHhdgOptions() {
    var confEl = document.getElementById("hhdg-opt-json");
    var skuEl = document.getElementById("variant-sku");
    var colorEl = document.getElementById("variant-color");
    var btn = document.querySelector("[data-hhdg-options-add]");
    var selects = document.querySelectorAll("[data-hhdg-option-select]");
    if (!confEl || !skuEl || !colorEl || !btn || !selects.length) return;

    var conf;
    try {
      conf = JSON.parse(confEl.textContent);
    } catch (e) {
      return;
    }
    var sep = conf.sep || " // ";
    var base = conf.base || "";
    var labels = conf.labels || [];
    var frameSel = document.querySelector("[data-hhdg-frame-select]");

    function updateHeroFromFrame() {
      var hero = document.getElementById("product-hero-img");
      if (!frameSel || !hero) return;
      var opt = frameSel.options[frameSel.selectedIndex];
      if (!opt || !opt.value) return;
      var u = opt.getAttribute("data-img");
      if (u) hero.src = u;
    }

    function sync() {
      var parts = [];
      var meta = [];
      var ok = true;
      for (var i = 0; i < selects.length; i++) {
        var sel = selects[i];
        var v = (sel.value || "").trim();
        if (!v) ok = false;
        parts.push(v);
        var lab = labels[i] || "Option " + (i + 1);
        meta.push(lab + ": " + v);
      }
      updateHeroFromFrame();
      if (!ok) {
        skuEl.textContent = "";
        colorEl.textContent = "Choose all options above";
        btn.disabled = true;
        return;
      }
      skuEl.textContent = base + sep + parts.join(sep);
      colorEl.textContent = meta.join(" · ");
      btn.disabled = false;
    }

    for (var j = 0; j < selects.length; j++) {
      selects[j].addEventListener("change", sync);
    }
    sync();
  }

  function initGalleryThumbs() {
    var hero = document.getElementById("product-hero-img");
    if (!hero) return;
    var imgs = document.querySelectorAll(".product-gallery-sub-img");
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        img.addEventListener("click", function () {
          var s = img.getAttribute("src");
          if (s) hero.src = s;
        });
        img.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          var s = img.getAttribute("src");
          if (s) hero.src = s;
        });
      })(imgs[i]);
    }
  }

  initHhdgOptions();
  initGalleryThumbs();
})();
