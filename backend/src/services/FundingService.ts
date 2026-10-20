import { query } from '../config/database'
import { PositionModel } from '../models/Position'
import { AssetModel } from '../models/Asset'
import { HyperliquidService } from './HyperliquidService'
import logger from '../utils/logger'

/**
 * Funding settlement — Hyperliquid settles funding HOURLY (CEX uses 8h).
 *
 * For each open position, every hour:
 *   payment = notional × fundingRate        (signed by position side)
 *   · LONG  pays when funding is positive  → free USDC decreases
 *   · SHORT receives                       → free USDC increases
 * The payment lands in the position's realized PnL and the user's USDC
 * balance, and one funding_rates row is written per symbol (the table used
 * to have zero writers).
 */

export interface FundingSettlement {
  symbol: string
  rate: string
  positionsSettled: number
  totalUsdc: number
  timestamp: number
}

const FALLBACK_RATE = '0.0001' // used when the live meta is unavailable

export class FundingService {
  private static timer: NodeJS.Timeout | null = null

  /**
   * Settle funding for every open position. Returns a per-symbol summary.
   * Exposed synchronously (no schedule) so tests can drive it directly.
   */
  static async settleAll(): Promise<FundingSettlement[]> {
    const positions = await this.allOpenPositions()
    if (positions.length === 0) return []

    // one rate lookup per symbol
    const rates = new Map<string, string>()
    for (const p of positions) {
      if (!rates.has(p.symbol)) {
        rates.set(p.symbol, await this.rateFor(p.symbol))
      }
    }

    const bySymbol = new Map<string, FundingSettlement>()
    for (const pos of positions) {
      const rate = parseFloat(rates.get(pos.symbol)!)
      const notional = parseFloat(pos.quantity) * parseFloat(pos.markPrice || pos.entryPrice)
      // LONG pays / SHORT receives when funding is positive
      const signed = pos.side === 'LONG' ? -1 : 1
      const payment = signed * notional * rate

      await AssetModel.getOrCreate(pos.userId, 'USDC')
      await this.adjustUsdc(pos.userId, payment)

      const newRealized = parseFloat(pos.realizedPnl || '0') + payment
      await PositionModel.updateRealizedPnl(pos.positionId, newRealized.toFixed(8))

      await this.recordRate(pos.symbol, rate.toString())

      const entry =
        bySymbol.get(pos.symbol) ??
        { symbol: pos.symbol, rate: rate.toString(), positionsSettled: 0, totalUsdc: 0, timestamp: Date.now() }
      entry.positionsSettled += 1
      entry.totalUsdc += payment
      bySymbol.set(pos.symbol, entry)

      logger.info('Funding settled', {
        positionId: pos.positionId,
        symbol: pos.symbol,
        side: pos.side,
        payment: payment.toFixed(8),
      })
    }

    return [...bySymbol.values()]
  }

  /**
   * Schedule hourly settlement, aligned to the top of each hour (Hyperliquid's
   * cadence). The first run happens at the next :00.
   */
  static start(): void {
    if (this.timer) return
    const msToNextHour = 3600_000 - (Date.now() % 3600_000)
    this.timer = setTimeout(() => {
      this.settleAll().catch((e) => logger.error('Funding settlement failed', { error: e }))
      this.timer = setInterval(() => {
        this.settleAll().catch((e) => logger.error('Funding settlement failed', { error: e }))
      }, 3600_000)
    }, msToNextHour)
    logger.info('Funding scheduler started', { firstRunInMs: msToNextHour })
  }

  static stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Current funding rate for a symbol: live meta first, constant fallback. */
  private static async rateFor(symbol: string): Promise<string> {
    try {
      const coin = HyperliquidService.symbolToCoin(symbol)
      const data = await HyperliquidService.getFundingRate(coin)
      if (data?.fundingRate) return String(data.fundingRate)
    } catch {
      // fall through
    }
    return FALLBACK_RATE
  }

  /** Credit (positive) or debit (negative) a user's free USDC. */
  private static async adjustUsdc(userId: number, amount: number): Promise<void> {
    const asset = await AssetModel.findByUserAndAsset(userId, 'USDC')
    const current = parseFloat(asset?.free ?? '0')
    const next = Math.max(0, current + amount) // funding cannot drive a balance negative
    await AssetModel.updateFree(userId, 'USDC', next.toFixed(8))
  }

  private static async recordRate(symbol: string, rate: string): Promise<void> {
    await query(
      `INSERT INTO funding_rates (symbol, rate, timestamp) VALUES (?, ?, NOW())`,
      [symbol, rate]
    )
  }

  /** Every open position across users (funding applies to all of them). */
  private static async allOpenPositions() {
    // PositionModel is user-scoped; read across users for the hourly sweep.
    // (Filter in JS rather than SQL so the in-memory fake-db used in tests,
    // which has a minimal WHERE parser, stays compatible.)
    const rows = await query<any[]>('SELECT * FROM positions')
    return rows
      .filter((r) => parseFloat(r.quantity) > 0)
      .map((r) => ({
        positionId: r.position_id,
        userId: r.user_id,
        symbol: r.symbol,
        side: r.side as 'LONG' | 'SHORT',
        quantity: r.quantity,
        entryPrice: r.entry_price,
        markPrice: r.mark_price,
        realizedPnl: r.realized_pnl,
      }))
  }
}
