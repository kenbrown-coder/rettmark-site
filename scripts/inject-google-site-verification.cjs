/**
 * Injects Google Search Console HTML tag verification into index.html at build time.
 * Netlify: Site configuration → Environment variables → GOOGLE_SITE_VERIFICATION
 * (the "content" value only, from Search Console → HTML tag method).
 *
 * If unset, leaves the placeholder comment so the repo stays valid HTML.
 */

var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var indexPath = path.join(root, "index.html");
var marker = "<!--GOOGLE_SITE_VERIFICATION-->";

var token = String(
  process.env.GOOGLE_SITE_VERIFICATION || process.env.GOOGLE_SEARCH_CONSOLE_VERIFICATION || ""
).trim();

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

var html = fs.readFileSync(indexPath, "utf8");
if (html.indexOf(marker) === -1) {
  console.warn("inject-google-site-verification: marker missing in index.html");
  process.exit(0);
}

var replacement;
if (token) {
  replacement =
    '<meta name="google-site-verification" content="' + escapeAttr(token) + '" />';
} else {
  replacement = marker;
}

html = html.replace(marker, replacement);
fs.writeFileSync(indexPath, html, "utf8");

if (process.env.NETLIFY === "true" && !token) {
  console.warn(
    "inject-google-site-verification: GOOGLE_SITE_VERIFICATION not set; add it in Netlify to verify Search Console."
  );
}
