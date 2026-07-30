/**
 * US state sales tax — keep rates in sync with js/sales-tax-rates.js.
 * Taxable base = merchandise after discount only (shipping not taxed).
 */

var STATE_SALES_TAX_PERCENT = {
  AL: 4.0,
  AK: 0,
  AZ: 5.6,
  AR: 6.5,
  CA: 7.25,
  CO: 2.9,
  CT: 6.35,
  DC: 6.0,
  DE: 0,
  FL: 6.0,
  GA: 4.0,
  HI: 4.0,
  ID: 6.0,
  IL: 6.25,
  IN: 7.0,
  IA: 6.0,
  KS: 6.5,
  KY: 6.0,
  LA: 4.45,
  ME: 5.5,
  MD: 6.0,
  MA: 6.25,
  MI: 6.0,
  MN: 6.875,
  MS: 7.0,
  MO: 4.225,
  MT: 0,
  NE: 5.5,
  NV: 6.85,
  NH: 0,
  NJ: 6.625,
  NM: 5.375,
  NY: 4.0,
  NC: 4.75,
  ND: 5.0,
  OH: 5.75,
  OK: 4.5,
  OR: 0,
  PA: 6.0,
  RI: 7.0,
  SC: 6.0,
  SD: 4.2,
  TN: 7.0,
  TX: 6.25,
  UT: 4.85,
  VT: 6.0,
  VA: 4.3,
  WA: 6.5,
  WV: 6.0,
  WI: 5.0,
  WY: 4.0
};

var US_STATE_NAME_TO_CODE = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY"
};

function normalizeStateCode(raw) {
  var s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "");
  if (!s) return "";
  if (/^[A-Z]{2}$/.test(s)) return s;
  var spaced = s.replace(/\s+/g, " ");
  if (US_STATE_NAME_TO_CODE[spaced]) return US_STATE_NAME_TO_CODE[spaced];
  var compact = s.replace(/\s/g, "");
  if (US_STATE_NAME_TO_CODE[compact]) return US_STATE_NAME_TO_CODE[compact];
  return "";
}

function isDomesticUs(country) {
  var c = String(country || "US")
    .trim()
    .toUpperCase();
  return !c || c === "US" || c === "USA" || c === "UNITED STATES" || c === "UNITED STATES OF AMERICA";
}

function roundSalesTaxUp(dollars) {
  var n = Number(dollars) || 0;
  if (n <= 0) return 0;
  return Math.ceil(n * 100 - 1e-9) / 100;
}

/**
 * @returns {{ amount: number, amountCents: number, ratePercent: number, code: string }}
 */
function computeStateSalesTax(country, stateRaw, taxableBaseDollars) {
  var base = Math.max(0, Number(taxableBaseDollars) || 0);
  if (base <= 0) {
    return { amount: 0, amountCents: 0, ratePercent: 0, code: "" };
  }
  if (!isDomesticUs(country)) {
    return { amount: 0, amountCents: 0, ratePercent: 0, code: "" };
  }
  var code = normalizeStateCode(stateRaw);
  if (!code || !Object.prototype.hasOwnProperty.call(STATE_SALES_TAX_PERCENT, code)) {
    return { amount: 0, amountCents: 0, ratePercent: 0, code: code };
  }
  var pct = Number(STATE_SALES_TAX_PERCENT[code]);
  if (!isFinite(pct) || pct < 0) pct = 0;
  var amount = roundSalesTaxUp((base * pct) / 100);
  return {
    amount: amount,
    amountCents: Math.round(amount * 100),
    ratePercent: pct,
    code: code
  };
}

module.exports = {
  computeStateSalesTax,
  normalizeStateCode,
  roundSalesTaxUp
};
