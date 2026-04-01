/**
 * Writes a static js/anet-config.js with NO credentials (Netlify secret scan rejects
 * API Login IDs baked into published assets). Checkout loads public Accept.js values
 * from GET /.netlify/functions/anet-public-config at runtime.
 *
 * Optional: for local testing without Netlify Dev, you may temporarily edit js/anet-config.js
 * (do not commit real values).
 */

var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var outPath = path.join(root, "js", "anet-config.js");

var banner =
  "/**\n" +
  " * Accept.js placeholders only — real values come from /.netlify/functions/anet-public-config\n" +
  " * on deploy. Do not commit API Login ID or client key here.\n" +
  " */\n";

var body =
  "window.RETTMARK_ANET = " +
  JSON.stringify({ clientKey: "", apiLoginId: "", sandbox: true }, null, 0) +
  ";\n";

fs.writeFileSync(outPath, banner + body, "utf8");
