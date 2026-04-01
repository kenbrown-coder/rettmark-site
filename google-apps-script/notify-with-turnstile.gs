/**
 * Google Apps Script — honeypot + Turnstile verification for the site notify form.
 *
 * Setup:
 * 1. Cloudflare dashboard → Turnstile → create a widget; copy the secret key.
 * 2. Apps Script → Project settings → Script properties → TURNSTILE_SECRET = that secret.
 *    If TURNSTILE_SECRET is not set, the script skips Turnstile checks (deploy-time migration).
 * 3. Merge the checks below into your existing doPost (keep your Sheet/MailApp logic).
 *    Do not deploy this file as-is unless you fill in the TODO; otherwise signups are dropped.
 *
 * Expected POST fields: email, bot-field (empty), cf-turnstile-response (from the widget).
 */

function doPost(e) {
  var params = e && e.parameter ? e.parameter : {};

  if (params["bot-field"]) {
    return HtmlService.createHtmlOutput("").setTitle("OK");
  }

  var email = (params.email || "").toString().trim();
  if (!email || email.length > 320) {
    return HtmlService.createHtmlOutput("Invalid request.").setTitle("Error");
  }

  var secret = PropertiesService.getScriptProperties().getProperty("TURNSTILE_SECRET");
  if (secret) {
    var token = (params["cf-turnstile-response"] || "").toString().trim();
    if (!token) {
      return HtmlService.createHtmlOutput("Security check required.").setTitle("Error");
    }
    if (!verifyTurnstileToken_(token)) {
      return HtmlService.createHtmlOutput("Security check failed.").setTitle("Error");
    }
  }

  // --- Your existing signup handling goes here (append row, email notification, etc.) ---
  // var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Signups");
  // sheet.appendRow([new Date(), email]);

  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=https://rettmarkfirearms.com/success.html" /></head><body><a href="https://rettmarkfirearms.com/success.html">Continue</a></body></html>'
  );
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
