import { LedgerError } from './errors.js'

const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/

/** Parse a decimal string such as "12.5" or "-3.07" (or an integer number of units) into integer cents. */
export const toCents = value => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new LedgerError('LL_FLOAT_AMOUNT', `Pass "${value}" as a string to avoid float rounding.`)
    return value * 100
  }
  const match = DECIMAL.exec(String(value).trim())
  if (match === null) throw new LedgerError('LL_INVALID_AMOUNT', `Cannot parse amount "${value}".`)
  const [, sign, units, fraction = ''] = match
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, '0'))
  return sign === '-' ? -cents : cents
}

/** Render integer cents as a plain decimal string with two fraction digits ("1234" -> "12.34"). */
export const fromCents = cents => {
  if (!Number.isInteger(cents)) throw new LedgerError('LL_FLOAT_AMOUNT', `Expected integer cents, got ${cents}.`)
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** Format integer cents for display, e.g. formatMoney(123456, 'EUR', 'en-IE') -> "€1,234.56". */
export const formatMoney = (cents, currency = 'EUR', locale = 'en-IE') => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)

/** Sum any number of integer-cent amounts. */
export const addMoney = (...amounts) =>
  amounts.reduce((sum, amount) => {
    if (!Number.isInteger(amount)) throw new LedgerError('LL_FLOAT_AMOUNT', `Expected integer cents, got ${amount}.`)
    return sum + amount
  }, 0)

/**
 * Split `cents` across `ratios` (non-negative numbers) with the largest-remainder method, so the parts are integers
 * that always add up to `cents`. allocate(100, [1, 1, 1]) -> [34, 33, 33].
 */
export const allocate = (cents, ratios) => {
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0)
  if (total <= 0) throw new LedgerError('LL_INVALID_RATIOS', 'Ratios must add up to a positive number.')
  const exact = ratios.map(ratio => (cents * ratio) / total)
  const parts = exact.map(Math.floor)
  let remainder = cents - parts.reduce((sum, part) => sum + part, 0)
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((left, right) => right.fraction - left.fraction)
  for (const { index } of order) {
    if (remainder === 0) break
    parts[index] += 1
    remainder -= 1
  }
  return parts
}
