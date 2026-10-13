/** Standard VAT rates in percent, per ISO 3166 region code. */
export const TAX_RATES = Object.freeze({
  FR: 20,
  DE: 19,
  BE: 21,
  NL: 21,
  ES: 21,
  IT: 22,
})

/** Rate in percent for a region, or 0 when the region is not configured. */
export const rateFor = region => TAX_RATES[String(region).toUpperCase()] ?? 0

/** VAT for one line amount in integer cents. Finance requires half-up rounding per line. */
export const taxFor = (cents, region) => {
  const rate = rateFor(region)
  return Math.floor((cents * rate) / 100)
}
