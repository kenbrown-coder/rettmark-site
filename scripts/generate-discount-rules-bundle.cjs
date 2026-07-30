/**
 * Bundle data/discount-codes.local.txt into the Netlify function package as a
 * runtime fallback when the private GitHub rules fetch fails.
 */
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var srcPath = path.join(root, "data", "discount-codes.local.txt");
var outPath = path.join(root, "netlify", "functions", "lib", "generated-discount-rules.json");

if (!fs.existsSync(srcPath)) {
  console.error("[discount-rules] missing", path.relative(root, srcPath));
  process.exit(1);
}

var raw = fs.readFileSync(srcPath, "utf8").replace(/^\uFEFF/, "").trim();
var rules;
try {
  rules = JSON.parse(raw);
} catch (e) {
  console.error("[discount-rules] invalid JSON in discount-codes.local.txt", e && e.message);
  process.exit(1);
}
if (!Array.isArray(rules)) {
  console.error("[discount-rules] discount-codes.local.txt must be a JSON array");
  process.exit(1);
}

var payload = {
  generatedAt: new Date().toISOString(),
  source: "data/discount-codes.local.txt",
  ruleCount: rules.length,
  rules: rules
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(
  "[discount-rules] wrote",
  rules.length,
  "rules →",
  path.relative(root, outPath)
);
