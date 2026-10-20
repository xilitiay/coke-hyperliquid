import { Order, OrderSide } from '../types'
import logger from '../utils/logger'

/**
 * In-memory CLOB matching engine (price-time priority).
 *
 * Hyperliquid semantics this mirrors:
 *   · LIMIT orders that do not cross the book REST (status stays OPEN) instead
 *     of filling immediately — they sit in the book and can be matched later.
 *   · MARKET orders and crossing LIMIT orders consume resting liquidity,
 *     possibly at prices better than their limit (price improvement).
 *   · Every fill produces a trade record (see OrderExecutionService).
 *
 * Scope notes (demo): the book is process-memory only and is NOT restored from
 * the database on boot — resting orders survive for the lifetime of the
 * server process. A production port would persist the book (or rebuild it from
 * open orders at startup, which is exactly what a real exchange does).
 */

export interface BookLevel {
  orderId: string
  userId: number
  side: OrderSide
  price: number
  remaining: number
  seq: number // arrival sequence for time priority
}

export interface Fill {
  makerOrderId: string
  makerUserId: number
  price: number
  quantity: number
}

interface SymbolBook {
  bids: BookLevel[] // sorted best (highest) first
  asks: BookLevel[] // sorted best (lowest) first
}

const books = new Map<string, SymbolBook>()
let seqCounter = 0

function bookFor(symbol: string): SymbolBook {
  let b = books.get(symbol)
  if (!b) {
    b = { bids: [], asks: [] }
    books.set(symbol, b)
  }
  return b
}

function insert(levels: BookLevel[], level: BookLevel, side: OrderSide) {
  levels.push(level)
  // bids: descending price; asks: ascending price; ties by seq (time priority)
  levels.sort((a, b) => (side === 'BUY' ? b.price - a.price : a.price - b.price) || a.seq - b.seq)
}

/** Add a resting order to the book. */
export function addResting(order: {
  orderId: string
  userId: number
  symbol: string
  side: OrderSide
  price: number
  remaining: number
}): void {
  const b = bookFor(order.symbol)
  insert(order.side === 'BUY' ? b.bids : b.asks, { ...order, seq: ++seqCounter }, order.side)
  logger.debug('Order resting in book', { orderId: order.orderId, symbol: order.symbol, side: order.side, price: order.price })
}

/** Remove a resting order (filled or cancelled). */
export function removeResting(symbol: string, orderId: string): void {
  const b = books.get(symbol)
  if (!b) return
  b.bids = b.bids.filter((l) => l.orderId !== orderId)
  b.asks = b.asks.filter((l) => l.orderId !== orderId)
}

/** Update a resting level's remaining quantity (partial fill); removes it at 0. */
function reduceLevel(symbol: string, orderId: string, filled: number): void {
  const b = books.get(symbol)
  if (!b) return
  for (const side of [b.bids, b.asks]) {
    const lvl = side.find((l) => l.orderId === orderId)
    if (lvl) {
      lvl.remaining = Number((lvl.remaining - filled).toFixed(8))
      if (lvl.remaining <= 0) {
        b.bids = b.bids.filter((l) => l.orderId !== orderId)
        b.asks = b.asks.filter((l) => l.orderId !== orderId)
      }
      return
    }
  }
}

/** Best resting price on the opposite side of `side`, or null if empty. */
export function bestOpposite(symbol: string, side: OrderSide): number | null {
  const b = books.get(symbol)
  if (!b) return null
  const levels = side === 'BUY' ? b.asks : b.bids
  return levels.length ? levels[0].price : null
}

/** Snapshot of resting levels for a symbol (test/introspection helper). */
export function restingLevels(symbol: string): { bids: BookLevel[]; asks: BookLevel[] } {
  const b = books.get(symbol)
  return b ? { bids: [...b.bids], asks: [...b.asks] } : { bids: [], asks: [] }
}

/** Wipe all books (test helper). */
export function resetBooks(): void {
  books.clear()
  seqCounter = 0
}

/**
 * Match an incoming order against resting liquidity.
 * Returns the fills consumed; the caller applies balances/positions per fill.
 * A LIMIT order only crosses levels at prices it is willing to accept:
 *   BUY  matches asks with price <= limit
 *   SELL matches bids with price >= limit
 */
export function match(
  order: { orderId: string; userId: number; symbol: string; side: OrderSide; price: number | null; remaining: number },
  onFill: (fill: Fill) => Promise<void>
): Promise<{ fills: Fill[]; filledQty: number; fullyFilled: boolean }> {
  const fills: Fill[] = []
  return (async () => {
    const b = bookFor(order.symbol)
    let remaining = order.remaining

    // Re-read the level list each iteration: reduceLevel() replaces the book's
    // arrays, so a captured reference would go stale and spin on qty=0.
    while (remaining > 1e-12) {
      const levels = order.side === 'BUY' ? b.asks : b.bids
      if (!levels.length) break
      const best = levels[0]

      // price check for limit orders
      if (order.price !== null) {
        if (order.side === 'BUY' && best.price > order.price) break
        if (order.side === 'SELL' && best.price < order.price) break
      }

      const qty = Math.min(remaining, best.remaining)
      if (qty <= 0) break // defensive: exhausted level, nothing to trade

      const fill: Fill = { makerOrderId: best.orderId, makerUserId: best.userId, price: best.price, quantity: qty }
      fills.push(fill)
      await onFill(fill)
      remaining = Number((remaining - qty).toFixed(8))
      reduceLevel(order.symbol, best.orderId, qty)
    }

    return {
      fills,
      filledQty: Number((order.remaining - remaining).toFixed(8)),
      fullyFilled: remaining <= 1e-12,
    }
  })()
}
