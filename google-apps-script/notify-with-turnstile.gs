/**
 * Google Apps Script — secure notify / email-updates signup.
 *
 * Intended caller: Netlify function `notify-subscribe` (not the public website).
 * The live /exec URL must stay in Netlify env NOTIFY_GOOGLE_SCRIPT_URL only —
 * never in HTML — and should be rotated if it was ever public.
 *
 * Setup:
 * 1. Paste this into your Apps Script project (replace the old doPost).
 * 2. Project settings → Script properties:
 *      NOTIFY_WEBHOOK_SECRET = same value as Netlify NOTIFY_WEBHOOK_SECRET
 *      (optional) TURNSTILE_SECRET = Cloudflare secret — only needed for legacy
 *      direct browser posts; Netlify already verifies Turnstile.
 * 3. Keep your Sheet / MailApp logic in handleSignup_ below.
 * 4. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * 5. Copy the new /exec URL into Netlify NOTIFY_GOOGLE_SCRIPT_URL and redeploy the site.
 * 6. Disable or delete older deployments so scraped URLs stop working.
 *
 * Expected POST fields from Netlify:
 *   email, bot-field (empty), source, webhookSecret
 */

function doPost(e) {
  var params = e && e.parameter ? e.parameter : {};

  if (params["bot-field"]) {
    return jsonOut_({ ok: true, skipped: true });
  }

  var email = (params.email || "").toString().trim().toLowerCase();
  if (!email || email.length > 320 || email.indexOf("@") < 1) {
    return jsonOut_({ ok: false, error: "invalid_email" });
  }

  var expectedSecret = PropertiesService.getScriptProperties().getProperty("NOTIFY_WEBHOOK_SECRET");
  var gotSecret = (params.webhookSecret || "").toString();
  var webhookOk = expectedSecret && gotSecret && gotSecret === expectedSecret;

  if (!webhookOk) {
    // Legacy path: direct browser POST with Turnstile (prefer webhook-only in production).
    var turnstileSecret = PropertiesService.getScriptProperties().getProperty("TURNSTILE_SECRET");
    if (!turnstileSecret) {
      return jsonOut_({ ok: false, error: "unauthorized" });
    }
    var token = (params["cf-turnstile-response"] || "").toString().trim();
    if (!token || !verifyTurnstileToken_(token)) {
      return jsonOut_({ ok: false, error: "security_failed" });
    }
  }

  var source = (params.source || "Website").toString().slice(0, 40);
  handleSignup_(email, source);

  return jsonOut_({ ok: true });
}

/**
 * Merge your existing Sheet append / MailApp notification logic here.
 * Default matches common columns: email | timestamp | source.
 */
function handleSignup_(email, source) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow([email, new Date(), source]);
}

function verifyTurnstileToken_(token) {
  var secret = PropertiesService.getScriptProperties().getProperty("TURNSTILE_SECRET");
  if (!secret) {
    return false;
  }

  var payload =
    "secret=" + encodeURIComponent(secret) + "&response=" + encodeURIComponent(token);

  var resp = UrlFetchApp.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: payload,
    muteHttpExceptions: true
  });

  try {
    var body = JSON.parse(resp.getContentText());
    return body && body.success === true;
  } catch (err) {
    return false;
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
