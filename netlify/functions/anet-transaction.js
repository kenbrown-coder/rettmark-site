/**
 * Authorize.Net: charge cart using Accept.js opaqueData (server-side only secrets).
 *
 * Env (Netlify → Site configuration → Environment variables):
 *   ANET_API_LOGIN_ID
 *   ANET_TRANSACTION_KEY  — API Transaction Key (not Public Client Key, not Signature Key).
 *   ANET_SANDBOX          — "true" = apitest host; "false" = production api host
 *
 * Invoice emails (Resend) — both require a verified domain in Resend:
 *   RESEND_API_KEY       — API key (re_…); without this, no email is sent.
 *   RESEND_FROM          — required for sending; e.g. "Rettmark Firearms <orders@yourdomain.com>"
 *                          (domain must be verified at resend.com/domains).
 * Optional:
 *   RESEND_SALES_EMAIL   — BCC destination; default sales@rettmarkfirearms.com
 *   RESEND_REPLY_TO      — reply_to header; default same as sales email
 *   RESEND_DEBUG=1       — on approved payments, JSON includes emailDelivery (remove after debugging)
 *
 * POST JSON body:
 *   { opaqueData, amount, cart, customerEmail, billTo, shipTo?, invoiceNumber?,
 *     discountAmount?, shippingAmount?, taxAmount? }
 *   When discountAmount, shippingAmount, or taxAmount are present (even 0), amount must equal
 *   merchandise subtotal − discount + shipping + tax (all in dollars, 2 decimal places).
 *   Omit all three for legacy behavior: amount must equal sum of cart line totals only.
 *
 * Private discount rules (GitHub): GITHUB_DISCOUNT_TOKEN, GITHUB_DISCOUNT_OWNER,
 * GITHUB_DISCOUNT_REPO, GITHUB_DISCOUNT_PATH, optional GITHUB_DISCOUNT_REF.
 * When a discount code or non-zero discount is present, the server recomputes the
 * discount from GitHub and rejects mismatches.
 */

var discountLib = require("./lib/discount-rules-from-github.js");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function json(status, obj) {
  return {
    statusCode: status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
    body: JSON.stringify(obj)
  };
}

function sumCartCents(cart) {
  if (!Array.isArray(cart)) return 0;
  return cart.reduce(function (sum, item) {
    var q = parseInt(item.qty, 10) || 0;
    var cents = Math.round((Number(item.price) || 0) * 100);
    return sum + q * cents;
  }, 0);
}

function dollarsToCents(n) {
  var x = Number(n);
  if (!isFinite(x)) return NaN;
  return Math.round(x * 100);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addrLinesHtml(prefix, a) {
  if (!a || typeof a !== "object") return "";
  var lines = [
    escapeHtml((a.firstName || "") + " " + (a.lastName || "")).trim(),
    escapeHtml(a.address || ""),
    escapeHtml(
      [a.city || "", a.state || "", a.zip || ""]
        .filter(Boolean)
        .join(", ")
    ),
    escapeHtml(a.country || "")
  ].filter(Boolean);
  if (!lines.length) return "";
  return (
    "<p><strong>" +
    escapeHtml(prefix) +
    "</strong><br>" +
    lines.join("<br>") +
    "</p>"
  );
}

function buildInvoiceEmailHtml(body, amountStr) {
  var cart = Array.isArray(body.cart) ? body.cart : [];
  var inv = escapeHtml(body.invoiceNumber || "");
  var email = escapeHtml(body.customerEmail || "");
  var rows = cart
    .map(function (item) {
      var q = parseInt(item.qty, 10) || 0;
      var line = ((Number(item.price) || 0) * q).toFixed(2);
      var meta = [item.variant || "", item.sku || ""].filter(Boolean).join(" · ");
      var name = escapeHtml(item.name || "Item") + (meta ? " <small>(" + escapeHtml(meta) + ")</small>" : "");
      return (
        "<tr><td>" +
        name +
        " × " +
        q +
        "</td><td style=\"text-align:right\">$" +
        line +
        "</td></tr>"
      );
    })
    .join("");

  var subCents = sumCartCents(cart);
  var sub = (subCents / 100).toFixed(2);
  var hasBreakdown =
    Object.prototype.hasOwnProperty.call(body, "discountAmount") ||
    Object.prototype.hasOwnProperty.call(body, "shippingAmount") ||
    Object.prototype.hasOwnProperty.call(body, "taxAmount");

  var extra = "";
  if (hasBreakdown) {
    var discCents = dollarsToCents(body.discountAmount || 0);
    var ship = (dollarsToCents(body.shippingAmount || 0) / 100).toFixed(2);
    var tax = (dollarsToCents(body.taxAmount || 0) / 100).toFixed(2);
    var code = String(body.discountCode || "").trim();
    if (discCents > 0) {
      var disc = (discCents / 100).toFixed(2);
      extra +=
        "<tr><td>Discount" +
        (code ? " (" + escapeHtml(code) + ")" : "") +
        '</td><td style="text-align:right">−$' +
        disc +
        "</td></tr>";
    }
    extra += '<tr><td>Shipping</td><td style="text-align:right">$' + ship + "</td></tr>";
    extra += '<tr><td>Sales tax</td><td style="text-align:right">$' + tax + "</td></tr>";
  }

  var bill = addrLinesHtml("Billing", body.billTo);
  var shipBlock = "";
  if (body.shipTo && typeof body.shipTo === "object") {
    shipBlock = addrLinesHtml("Shipping", body.shipTo);
  }

  return (
    "<!DOCTYPE html><html><body style=\"font-family:sans-serif;font-size:14px\">" +
    "<h2>Rettmark Firearms — Order receipt</h2>" +
    (inv ? "<p><strong>Order #</strong> " + inv + "</p>" : "") +
    (email ? "<p><strong>Email</strong> " + email + "</p>" : "") +
    "<table style=\"border-collapse:collapse;width:100%;max-width:520px\">" +
    "<thead><tr><th style=\"text-align:left\">Item</th><th style=\"text-align:right\">Amount</th></tr></thead><tbody>" +
    rows +
    '<tr><td>Subtotal</td><td style="text-align:right">$' +
    sub +
    "</td></tr>" +
    extra +
    '<tr><td><strong>Total charged</strong></td><td style="text-align:right"><strong>$' +
    escapeHtml(amountStr) +
    "</strong></td></tr></tbody></table>" +
    bill +
    shipBlock +
    "<p>Thank you for your order.</p></body></html>"
  );
}

function anetApiUrl() {
  var sandboxRaw = String(
    process.env.ANET_SANDBOX != null ? process.env.ANET_SANDBOX : "true"
  )
    .trim()
    .toLowerCase();
  var useSandbox = sandboxRaw !== "false" && sandboxRaw !== "0";
  return useSandbox
    ? "https://apitest.authorize.net/xml/v1/request.api"
    : "https://api.authorize.net/xml/v1/request.api";
}

function htmlToPlainText(html) {
  return String(html || "")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One Resend request: customer in To, sales in BCC (hidden from customer).
 * If there is no customer email, only sales receives the message.
 * Returns a small status object for logs / optional RESEND_DEBUG response.
 */
async function sendInvoiceEmails(body, amountStr) {
  var key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) {
    console.warn(
      "[rettmark] Invoice email skipped: set RESEND_API_KEY in Netlify environment variables."
    );
    return { ok: false, skipped: true, reason: "missing_RESEND_API_KEY" };
  }

  var from = String(process.env.RESEND_FROM || "").trim();
  if (!from) {
    console.error(
      "[rettmark] Invoice email skipped: set RESEND_FROM to a sender on a domain verified in Resend " +
        "(e.g. \"Rettmark Firearms <orders@yourdomain.com>\")."
    );
    return { ok: false, skipped: true, reason: "missing_RESEND_FROM" };
  }

  var html = buildInvoiceEmailHtml(body, amountStr);
  var text = htmlToPlainText(html);
  var inv = String(body.invoiceNumber || "").trim();
  var subject = inv ? "Rettmark Firearms order " + inv : "Rettmark Firearms order confirmation";

  var customerTo = String(body.customerEmail || "").trim();
  var salesTo = String(process.env.RESEND_SALES_EMAIL || "sales@rettmarkfirearms.com").trim();
  var replyTo = String(process.env.RESEND_REPLY_TO || salesTo).trim();

  var payload = {
    from: from,
    subject: subject,
    html: html,
    text: text
  };

  if (customerTo) {
    payload.to = [customerTo];
    payload.bcc = [salesTo];
    if (replyTo) {
      payload.reply_to = [replyTo];
    }
  } else {
    console.warn(
      "[rettmark] No customerEmail on order; sending invoice only to " + salesTo + "."
    );
    payload.to = [salesTo];
    if (replyTo) {
      payload.reply_to = [replyTo];
    }
  }

  try {
    var res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    var raw = await res.text();
    var parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (parseErr) {
      parsed = null;
    }
    if (!res.ok) {
      console.error(
        "[rettmark] Resend API error",
        res.status,
        raw || "(empty body)"
      );
      return {
        ok: false,
        skipped: false,
        httpStatus: res.status,
        resendMessage: raw ? raw.slice(0, 500) : ""
      };
    }
    var id = parsed && parsed.id ? String(parsed.id) : "";
    console.log("[rettmark] Invoice email queued in Resend", id || "(no id in response)");
    return { ok: true, skipped: false, resendId: id };
  } catch (e) {
    console.error("[rettmark] Resend fetch failed", e && e.message ? e.message : String(e));
    return { ok: false, skipped: false, reason: "fetch_error", message: e && e.message };
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  var login = String(
    process.env.ANET_API_LOGIN_ID || process.env.AUTHORIZE_NET_API_LOGIN || ""
  ).trim();
  var key = String(
    process.env.ANET_TRANSACTION_KEY || process.env.AUTHORIZE_NET_TRANSACTION_KEY || ""
  ).trim();

  if (!login || !key) {
    return json(503, {
      error: "Payment server is not configured (missing ANET_API_LOGIN_ID or ANET_TRANSACTION_KEY)."
    });
  }

  var body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON body" });
  }

  var opaque = body.opaqueData;
  if (!opaque || !opaque.dataDescriptor || !opaque.dataValue) {
    return json(400, { error: "Missing opaqueData from Accept.js" });
  }

  var amountNum = Number(body.amount);
  if (!isFinite(amountNum) || amountNum <= 0) {
    return json(400, { error: "Invalid amount" });
  }

  var cart = body.cart;
  var amountCents = Math.round(amountNum * 100);
  var subtotalCents = sumCartCents(cart);

  var hasBreakdown =
    Object.prototype.hasOwnProperty.call(body, "discountAmount") ||
    Object.prototype.hasOwnProperty.call(body, "shippingAmount") ||
    Object.prototype.hasOwnProperty.call(body, "taxAmount");

  var expectedCents;
  if (!hasBreakdown) {
    expectedCents = subtotalCents;
  } else {
    var discountCents = Math.max(0, dollarsToCents(body.discountAmount || 0));
    if (isNaN(discountCents)) {
      return json(400, { error: "Invalid discount amount" });
    }
    discountCents = Math.min(discountCents, subtotalCents);
    var codeTrim = String(body.discountCode || "").trim();
    var wantsDiscount = discountCents > 0 || codeTrim.length > 0;
    if (wantsDiscount) {
      if (discountCents > 0 && !codeTrim) {
        return json(400, { error: "Discount requires a valid code" });
      }
      if (codeTrim) {
        if (!discountLib.githubEnvConfigured()) {
          return json(503, { error: "Discount validation is not configured" });
        }
        var resolvedDisc = await discountLib.resolveExpectedDiscountCents(codeTrim, subtotalCents, event);
        if (!resolvedDisc.ok) {
          if (resolvedDisc.error === "invalid_discount_code") {
            return json(400, { error: "Invalid or expired discount code" });
          }
          if (resolvedDisc.error === "discount_code_exhausted") {
            return json(400, { error: "This discount code has reached its usage limit" });
          }
          if (resolvedDisc.error === "discount_usage_unavailable") {
            return json(503, { error: "Could not verify discount usage; try again shortly" });
          }
          return json(503, { error: "Could not validate discount" });
        }
        if (resolvedDisc.expectedCents !== discountCents) {
          return json(400, { error: "Discount amount does not match code" });
        }
      }
    }
    var shippingCents = Math.max(0, dollarsToCents(body.shippingAmount || 0));
    var taxCents = Math.max(0, dollarsToCents(body.taxAmount || 0));
    if (isNaN(shippingCents) || isNaN(taxCents)) {
      return json(400, { error: "Invalid shipping or tax amount" });
    }
    expectedCents = subtotalCents - discountCents + shippingCents + taxCents;
    if (expectedCents < 0) {
      return json(400, { error: "Invalid order total" });
    }
  }

  if (amountCents !== expectedCents) {
    return json(400, { error: "Amount does not match order total" });
  }

  var bill = body.billTo || {};
  var first = String(bill.firstName || "").trim().slice(0, 50);
  var last = String(bill.lastName || "").trim().slice(0, 50);
  if (!first || !last) {
    return json(400, { error: "Billing first and last name are required" });
  }

  var addr = String(bill.address || "").trim().slice(0, 60);
  var city = String(bill.city || "").trim().slice(0, 40);
  var state = String(bill.state || "").trim().slice(0, 40);
  var zip = String(bill.zip || "").trim().slice(0, 20);
  if (!addr || !city || !state || !zip) {
    return json(400, {
      error: "Complete billing address (street, city, state, and ZIP) is required for the gateway."
    });
  }

  var amountStr = (amountCents / 100).toFixed(2);

  var email = String(body.customerEmail || "").trim().slice(0, 255);

  /* Key order matches typical AnetApi transactionRequest XML sequence (payment → billTo → shipTo → userFields). */
  var txRequest = {
    transactionType: "authCaptureTransaction",
    amount: amountStr,
    payment: {
      opaqueData: {
        dataDescriptor: opaque.dataDescriptor,
        dataValue: opaque.dataValue
      }
    },
    billTo: {
      firstName: first,
      lastName: last,
      address: addr,
      city: city,
      state: state,
      zip: zip,
      country: String(bill.country || "US").trim().slice(0, 60)
    }
  };

  var ship = body.shipTo;
  if (ship && typeof ship === "object") {
    var sf = String(ship.firstName || "").trim().slice(0, 50);
    var sl = String(ship.lastName || "").trim().slice(0, 50);
    var sAddr = String(ship.address || "").trim().slice(0, 60);
    var sCity = String(ship.city || "").trim().slice(0, 40);
    var sState = String(ship.state || "").trim().slice(0, 40);
    var sZip = String(ship.zip || "").trim().slice(0, 20);
    if (sf && sl && sAddr && sCity && sState && sZip) {
      txRequest.shipTo = {
        firstName: sf,
        lastName: sl,
        address: sAddr,
        city: sCity,
        state: sState,
        zip: sZip,
        country: String(ship.country || "US").trim().slice(0, 60)
      };
    }
  }

  var userFieldArr = [];
  if (email) {
    userFieldArr.push({ name: "customerEmail", value: email });
  }
  var inv = String(body.invoiceNumber || "").trim().slice(0, 20);
  if (inv) {
    userFieldArr.push({ name: "invoiceNumber", value: inv });
  }
  userFieldArr.push({
    name: "orderSource",
    value: "Rettmark web"
  });
  if (userFieldArr.length > 20) {
    userFieldArr = userFieldArr.slice(0, 20);
  }
  if (userFieldArr.length) {
    txRequest.userFields = { userField: userFieldArr };
  }

  var payload = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: login,
        transactionKey: key
      },
      refId: "rettmark-" + Date.now(),
      transactionRequest: txRequest
    }
  };

  try {
    var gatewayOpts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      gatewayOpts.signal = AbortSignal.timeout(35000);
    }
    var res = await fetch(anetApiUrl(), gatewayOpts);

    var data;
    try {
      data = await res.json();
    } catch (parseErr) {
      return json(502, { error: "Payment gateway returned an invalid response." });
    }
    var tx = data && data.transactionResponse;
    var resultCode =
      data && data.messages && String(data.messages.resultCode || "").toLowerCase();

    var txApproved =
      tx &&
      (String(tx.responseCode) === "1" ||
        tx.responseCode === 1);

    if (resultCode === "ok" && txApproved) {
      var codeForUsage = String(body.discountCode || "").trim();
      var paidDiscCents = Math.max(0, dollarsToCents(body.discountAmount || 0));
      if (codeForUsage && paidDiscCents > 0) {
        try {
          var usageMod = require("./lib/discount-usage-blobs.js");
          await usageMod.incrementUseCount(event, codeForUsage);
        } catch (usageErr) {
          console.error(
            "[rettmark] discount usage increment",
            usageErr && usageErr.message ? usageErr.message : String(usageErr)
          );
        }
      }
      var emailDelivery = await sendInvoiceEmails(body, amountStr);
      var successBody = {
        ok: true,
        transactionId: tx.transId,
        authCode: tx.authCode,
        message: "Payment approved"
      };
      if (String(process.env.RESEND_DEBUG || "").trim() === "1") {
        successBody.emailDelivery = emailDelivery;
      }
      return json(200, successBody);
    }

    var errText = "Transaction declined";
    if (tx && tx.errors && tx.errors.length) {
      errText = tx.errors.map(function (e) { return e.errorText; }).join("; ");
    } else if (data && data.messages && data.messages.message) {
      var topMsgs = data.messages.message;
      var topArr = Array.isArray(topMsgs) ? topMsgs : [topMsgs];
      errText = topArr
        .map(function (m) {
          return m && m.text ? m.text : "";
        })
        .filter(Boolean)
        .join("; ");
    }

    return json(402, { ok: false, error: errText });
  } catch (e) {
    return json(502, { error: "Payment gateway request failed" });
  }
};
