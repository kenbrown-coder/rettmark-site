/**
 * Build SKU/URL -> price map for server-side checkout validation.
 * Scans top-level *.html data-add-to-cart buttons + js/hhdg-frames.json.
 * Writes netlify/functions/lib/generated-product-catalog.json (bundled with functions).
 */
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var outPath = path.join(root, "netlify", "functions", "lib", "generated-product-catalog.json");

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

function shippingClassForUrl(urlBase) {
  return /hhdg-/i.test(urlBase) ? "glasses" : "casebag";
}

function dollarsToCents(raw) {
  var n = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Extract attrs from a single HTML start-tag (no nested tags). */
function parseTagAttrs(tag) {
  var attrs = {};
  var re = /([a-zA-Z0-9:-]+)\s*=\s*"([^"]*)"/g;
  var m;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  re = /([a-zA-Z0-9:-]+)\s*=\s*'([^']*)'/g;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  return attrs;
}

var byUrl = Object.create(null);

function upsertUrl(urlBase, priceCents, source) {
  if (!urlBase || priceCents == null) return;
  var prev = byUrl[urlBase];
  if (prev && prev.priceCents !== priceCents) {
    console.warn(
      "[product-catalog] price conflict for",
      urlBase,
      prev.priceCents,
      "vs",
      priceCents,
      "(" + source + ")"
    );
  }
  byUrl[urlBase] = {
    priceCents: priceCents,
    shippingClass: shippingClassForUrl(urlBase),
    source: source
  };
}

var htmlFiles = fs.readdirSync(root).filter(function (f) {
  return f.endsWith(".html");
});

for (var i = 0; i < htmlFiles.length; i++) {
  var file = htmlFiles[i];
  var text = fs.readFileSync(path.join(root, file), "utf8");
  var tagRe = /<[^>]*\bdata-add-to-cart\b[^>]*>/gi;
  var tm;
  while ((tm = tagRe.exec(text))) {
    var attrs = parseTagAttrs(tm[0]);
    if (!Object.prototype.hasOwnProperty.call(attrs, "data-price")) continue;
    var priceCents = dollarsToCents(attrs["data-price"]);
    if (priceCents == null) continue;
    var urlBase = basenameUrl(attrs["data-url"] || file);
    if (!urlBase) continue;
    upsertUrl(urlBase, priceCents, file);
  }
}

var hhdgPath = path.join(root, "js", "hhdg-frames.json");
if (fs.existsSync(hhdgPath)) {
  var hhdg = JSON.parse(fs.readFileSync(hhdgPath, "utf8"));
  var products = (hhdg && hhdg.products) || [];
  for (var p = 0; p < products.length; p++) {
    var prod = products[p];
    if (!prod || !prod.localPage) continue;
    var urlBase2 = basenameUrl(prod.localPage);
    var cents =
      dollarsToCents(prod.retailPriceNum) != null
        ? dollarsToCents(prod.retailPriceNum)
        : dollarsToCents(prod.retailPriceDisplay);
    if (cents == null) continue;
    upsertUrl(urlBase2, cents, "hhdg-frames.json");
  }
}

var urls = Object.keys(byUrl).sort();
var catalog = {
  generatedAt: new Date().toISOString(),
  urlCount: urls.length,
  byUrl: byUrl
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log("[product-catalog] wrote", urls.length, "URLs →", path.relative(root, outPath));
