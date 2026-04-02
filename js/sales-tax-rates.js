/**
 * Rettmark — US state sales tax (state rate only, interim until TaxJar).
 *
 * Rates are **state-level** percentages only (no city/county). Update
 * RETTMARK_STATE_SALES_TAX_PERCENT as laws change.
 *
 * Tax is rounded **up** to the next cent whenever the exact amount has
 * more than two decimal places (ceil to cents).
 *
 * Taxable base = **merchandise after discount only** (shipping is not taxed here).
 */
(function (global) {
  /**
   * State portion of sales tax, percent (e.g. 6.25 means 6.25%).
   * No general statewide sales tax: 0
   */
  global.RETTMARK_STATE_SALES_TAX_PERCENT = {
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

  /** Round tax dollars up to the next cent (any fractional cent rounds up). */
  function roundSalesTaxUp(dollars) {
    var n = Number(dollars) || 0;
    if (n <= 0) return 0;
    return Math.ceil(n * 100 - 1e-9) / 100;
  }

  /**
   * @param {string} country - shipping country
   * @param {string} stateRaw - shipping state / province as entered
   * @param {number} taxableBaseDollars - merchandise after discount (shipping excluded)
   * @returns {{ amount: number, ratePercent: number, code: string, detail: string }}
   */
  function computeStateSalesTax(country, stateRaw, taxableBaseDollars) {
    var base = Math.max(0, Number(taxableBaseDollars) || 0);
    if (base <= 0) {
      return { amount: 0, ratePercent: 0, code: "", detail: "No taxable total" };
    }
    if (!isDomesticUs(country)) {
      return { amount: 0, ratePercent: 0, code: "", detail: "Outside US — no state tax in this estimate" };
    }
    var code = normalizeStateCode(stateRaw);
    var table = global.RETTMARK_STATE_SALES_TAX_PERCENT;
    if (!table || typeof table !== "object") {
      return { amount: 0, ratePercent: 0, code: code, detail: "Tax table missing" };
    }
    if (!code || !Object.prototype.hasOwnProperty.call(table, code)) {
      return {
        amount: 0,
        ratePercent: 0,
        code: code,
        detail: code ? "Unknown state code — tax not estimated" : "Enter a state on the address step"
      };
    }
    var pct = Number(table[code]);
    if (!isFinite(pct) || pct < 0) pct = 0;
    var rawTax = (base * pct) / 100;
    var amount = roundSalesTaxUp(rawTax);
    var detail =
      code +
      " state est. " +
      pct +
      "% on merchandise $" +
      base.toFixed(2) +
      " excl. shipping (rounded up to cents)";
    return { amount: amount, ratePercent: pct, code: code, detail: detail };
  }

  global.rettmarkRoundSalesTaxUp = roundSalesTaxUp;
  global.rettmarkComputeStateSalesTax = computeStateSalesTax;
})(typeof window !== "undefined" ? window : this);
