/**
 * Hyperliquid-style precision rules.
 *
 * The protocol REJECTS orders whose quantity/price are not properly rounded
 * rather than silently fixing them:
 *   · quantity → at most `szDecimals` decimal places (from live meta)
 *   · price    → a multiple of the pair's tick size, at most 5 significant
 *               figures and 8 decimal places
 * Keeping these as pure functions makes the rules unit-testable without a DB.
 */

export interface PrecisionCheck {
  ok: boolean
  /** The value rounded DOWN to the allowed precision (valid when ok). */
  rounded: string
  reason?: string
}

/** Number of decimal places in a decimal string ("0.001" → 3). */
export function decimalsOf(value: string | number): number {
  const raw = typeof value === 'number' ? String(value) : value
  const s = raw.includes('e') || raw.includes('E') ? Number(raw).toFixed(20).replace(/0+$/, '') : raw
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/** Count significant figures of a decimal string ("61000" → 5, "0.00123" → 3). */
export function sigFigsOf(value: string | number): number {
  const s = String(value).replace(/[^0-9]/g, '').replace(/^0+/, '')
  return s.length
}

/** Round a numeric string DOWN to `decimals` places (no float math). */
export function roundDownTo(value: string | number, decimals: number): string {
  const raw = typeof value === 'number' ? String(value) : value
  const neg = raw.startsWith('-')
  const [intPart, fracPart = ''] = (neg ? raw.slice(1) : raw).split('.')
  const frac = fracPart.padEnd(decimals, '0').slice(0, decimals)
  const out = decimals > 0 ? `${intPart || '0'}.${frac}` : `${intPart || '0'}`
  return neg ? `-${out}` : out
}

/** Quantity must not exceed szDecimals places; returns the rounded value. */
export function checkSzDecimals(quantity: string | number, szDecimals: number): PrecisionCheck {
  const q = typeof quantity === 'number' ? String(quantity) : quantity
  if (!/^\d*\.?\d+$/.test(q)) {
    return { ok: false, rounded: q, reason: 'Quantity is not a valid decimal' }
  }
  const decimals = decimalsOf(q)
  if (decimals > szDecimals) {
    return {
      ok: false,
      rounded: roundDownTo(q, szDecimals),
      reason: `Quantity has ${decimals} decimals; this asset allows ${szDecimals}`,
    }
  }
  return { ok: true, rounded: roundDownTo(q, szDecimals) }
}

/** Price must be a multiple of tick, ≤5 sig figs and ≤8 decimals. */
export function checkPrice(price: string | number, tickSize: number, maxSigFigs = 5, maxDecimals = 8): PrecisionCheck {
  const p = typeof price === 'number' ? String(price) : price
  if (!/^\d*\.?\d+$/.test(p)) {
    return { ok: false, rounded: p, reason: 'Price is not a valid decimal' }
  }
  if (decimalsOf(p) > maxDecimals) {
    return { ok: false, rounded: p, reason: `Price exceeds ${maxDecimals} decimal places` }
  }
  if (sigFigsOf(p) > maxSigFigs) {
    return { ok: false, rounded: p, reason: `Price exceeds ${maxSigFigs} significant figures` }
  }
  const px = parseFloat(p)
  const rounded = Math.floor(px / tickSize) * tickSize
  if (Math.abs(px - rounded) > 1e-9) {
    return { ok: false, rounded: rounded.toFixed(decimalsOf(p)), reason: `Price must be a multiple of tick size ${tickSize}` }
  }
  return { ok: true, rounded: p }
}
