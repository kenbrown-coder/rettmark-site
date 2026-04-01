/**
 * Authorize.Net: charge cart using Accept.js opaqueData (server-side only secrets).
 *
 * Env (Netlify → Site configuration → Environment variables):
 *   ANET_API_LOGIN_ID
 *   ANET_TRANSACTION_KEY
 *   ANET_SANDBOX          — "true" = apitest host; "false" = production api host (use false for live
 *                           account + merchant “Test Mode”; that toggle is separate from this flag)
 *
 * POST JSON body:
 *   { opaqueData: { dataDescriptor, dataValue }, amount, cart, customerEmail,
 *     billTo: { firstName, lastName, address, city, state, zip, country },
 *     shipTo?: same shape when shipping differs from billing }
 */

var ANET_SANDBOX_RAW = String(process.env.ANET_SANDBOX || "").trim().toLowerCase();
var ANET_USE_PRODUCTION_API =
  ANET_SANDBOX_RAW === "false" || ANET_SANDBOX_RAW === "0";
var ANET_JSON = ANET_USE_PRODUCTION_API
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

  var addr = String(bill.address || "").trim().slice(0, 60);
  var city = String(bill.city || "").trim().slice(0, 40);
  var state = String(bill.state || "").trim().slice(0, 40);
  var zip = String(bill.zip || "").trim().slice(0, 20);
  if (!addr || !city || !state || !zip) {
    return json(400, {
      error: "Complete billing address (street, city, state, and ZIP) is required for the gateway."
    });
  }

  var amountStr = rounded.toFixed(2);

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
    },
    customer: String(body.customerEmail || "").trim()
      ? { email: String(body.customerEmail || "").trim().slice(0, 255) }
      : undefined,
    order: {
      invoiceNumber: String(body.invoiceNumber || "").trim().slice(0, 20) || undefined,
      description: "Rettmark web — see cart payload in gateway reports"
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
    var res = await fetch(ANET_JSON, gatewayOpts);

    var data;
    try {
      data = await res.json();
    } catch (parseErr) {
      return json(502, { error: "Payment gateway returned an invalid response." });
    }
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
