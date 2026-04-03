/**
 * Writes sitemap.xml at repo root from top-level *.html.
 * Excludes cart, checkout flow, thank-you pages, and 404 (align with robots.txt Disallow).
 * Runs on Netlify via npm run build; locally: node scripts/generate-sitemap.cjs
 */
var fs = require("fs");
var path = require("path");

var base = "https://rettmarkfirearms.com";
var root = path.join(__dirname, "..");
var skip = new Set([
  "404.html",
  "cart.html",
  "checkout.html",
  "checkout-address.html",
  "checkout-review.html",
  "checkout-confirm.html",
  "order-success.html",
  "success.html",
  "unsubscribe.html"
]);

var files = fs
  .readdirSync(root)
  .filter(function (f) {
    return f.endsWith(".html") && !skip.has(f);
  })
  .sort(function (a, b) {
    if (a === "index.html") return -1;
    if (b === "index.html") return 1;
    return a.localeCompare(b);
  });

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

var xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

for (var i = 0; i < files.length; i++) {
  var f = files[i];
  var loc = f === "index.html" ? base + "/" : base + "/" + encodeURI(f);
  var pri =
    f === "index.html"
      ? "1.0"
      : /^(bags|cases|contact|firearms|shooting-glasses)\.html$/.test(f)
        ? "0.9"
        : "0.8";
  xml +=
    "  <url><loc>" +
    esc(loc) +
    "</loc><changefreq>weekly</changefreq><priority>" +
    pri +
    "</priority></url>\n";
}

xml += "</urlset>\n";

fs.writeFileSync(path.join(root, "sitemap.xml"), xml, "utf8");
console.log("Wrote sitemap.xml with", files.length, "URLs");
