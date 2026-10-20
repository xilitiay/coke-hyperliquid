/**
 * Shared formatting helpers for the demo UI.
 * Keeps number/address formatting consistent across all section pages.
 */

/** Format a number with thousands separators and fixed decimals. */
export function formatNumber(value: number, min = 2, max = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  })
}

/** Format a price: more decimals for small values, fewer for large. */
export function formatPrice(value: number): string {
  if (value >= 1000) return formatNumber(value, 2, 2)
  if (value >= 1) return formatNumber(value, 2, 2)
  return formatNumber(value, 4, 4)
}

/** Compact USD, e.g. 1.2B / 34.5M / 12.3K. */
export function formatUsdCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`
  return `${sign}$${abs.toFixed(2)}`
}

/** Compact number without currency, e.g. 1.2B. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`
  return `${sign}${abs.toFixed(2)}`
}

/** Format a signed percentage, e.g. +4.21% / -1.10%. */
export function formatPercent(value: number, withSign = true): string {
  const sign = withSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/** Shorten an 0x address: 0x1234…abcd. */
export function shortenAddress(addr: string, head = 6, tail = 4): string {
  if (!addr) return ''
  if (addr.length <= head + tail) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

/** Tailwind color class for a signed value. */
export function changeClass(value: number): string {
  if (value > 0) return 'price-up'
  if (value < 0) return 'price-down'
  return 'text-text-secondary'
}

/** Copy text to clipboard (best-effort). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
