/**
 * Authorize.Net: charge cart using Accept.js opaqueData (server-side only secrets).
 *
 * Env (Netlify → Site configuration → Environment variables):
 *   ANET_API_LOGIN_ID
 *   ANET_TRANSACTION_KEY
 *   ANET_SANDBOX          — "true" | "false" (default true)
 *
 * POST JSON body:
 *   { opaqueData: { dataDescriptor, dataValue }, amount, cart, customerEmail,
 *     billTo: { firstName, lastName, address, city, state, zip, country } }
 */

var ANET_JSON =
  process.env.ANET_SANDBOX === "false" || process.env.ANET_SANDBOX === "0"
    ? "https://api.authorize.net/xml/v1/request.api"
    : "https://apitest.authorize.net/xml/v1/request.api";

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

function sumCartTotal(cart) {
  if (!Array.isArray(cart)) return 0;
  return cart.reduce(function (sum, item) {
    var q = parseInt(item.qty, 10) || 0;
    var p = Number(item.price) || 0;
    return sum + q * p;
  }, 0);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  var login = process.env.ANET_API_LOGIN_ID || process.env.AUTHORIZE_NET_API_LOGIN;
  var key = process.env.ANET_TRANSACTION_KEY || process.env.AUTHORIZE_NET_TRANSACTION_KEY;

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
  var computed = sumCartTotal(cart);
  var rounded = Math.round(amountNum * 100) / 100;
  var roundedComputed = Math.round(computed * 100) / 100;
  if (Math.abs(rounded - roundedComputed) > 0.02) {
    return json(400, { error: "Amount does not match cart total" });
  }

  var bill = body.billTo || {};
  var first = String(bill.firstName || "").trim().slice(0, 50);
  var last = String(bill.lastName || "").trim().slice(0, 50);
  if (!first || !last) {
    return json(400, { error: "Billing first and last name are required" });
  }

  var amountStr = rounded.toFixed(2);

  var payload = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: login,
        transactionKey: key
      },
      refId: "rettmark-" + Date.now(),
      transactionRequest: {
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
          address: String(bill.address || "").trim().slice(0, 60),
          city: String(bill.city || "").trim().slice(0, 40),
          state: String(bill.state || "").trim().slice(0, 40),
          zip: String(bill.zip || "").trim().slice(0, 20),
          country: String(bill.country || "US").trim().slice(0, 60)
        },
        customer: String(body.customerEmail || "").trim()
          ? { email: String(body.customerEmail || "").trim().slice(0, 255) }
          : undefined,
        order: {
          invoiceNumber: String(body.invoiceNumber || "").trim().slice(0, 20) || undefined,
          description: "Rettmark web — see cart payload in gateway reports"
        }
      }
    }
  };

  try {
    var res = await fetch(ANET_JSON, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    var data = await res.json();
    var tx = data && data.transactionResponse;
    var resultCode = data && data.messages && data.messages.resultCode;

    if (resultCode === "Ok" && tx && tx.responseCode === "1") {
      return json(200, {
        ok: true,
        transactionId: tx.transId,
        authCode: tx.authCode,
        message: "Payment approved"
      });
    }

    var errText = "Transaction declined";
    if (tx && tx.errors && tx.errors.length) {
      errText = tx.errors.map(function (e) { return e.errorText; }).join("; ");
    } else if (data && data.messages && data.messages.message && data.messages.message.length) {
      errText = data.messages.message.map(function (m) { return m.text; }).join("; ");
    }

    return json(402, { ok: false, error: errText });
  } catch (e) {
    return json(502, { error: "Payment gateway request failed" });
  }
};
