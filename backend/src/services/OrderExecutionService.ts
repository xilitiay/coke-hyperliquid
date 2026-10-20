import { v4 as uuidv4 } from 'uuid'
import { OrderModel } from '../models/Order'
import { PositionModel } from '../models/Position'
import { AssetModel } from '../models/Asset'
import { TradingPairModel } from '../models/TradingPair'
import { Order, PositionSide, MarginMode } from '../types'
import { HyperliquidService } from './HyperliquidService'
import { match, addResting, type Fill } from './MatchingEngine'
import { UserSettingsModel } from '../models/UserSettings'
import { createError } from '../utils/response'
import logger from '../utils/logger'

export type ExecutionOutcome = 'FILLED' | 'PARTIALLY_FILLED' | 'RESTING'

/**
 * Order Execution Service — routes orders through the in-memory CLOB.
 *
 * Hyperliquid-aligned semantics:
 *   · MARKET orders consume resting liquidity (price improvement when the book
 *     is better than the reference price), remainder fills at the market price.
 *   · LIMIT orders that cross the book fill immediately; the uncrossed
 *     remainder RESTS in the book (status OPEN) rather than filling.
 *   · Every fill writes a trade row (the trades table used to be write-less).
 */
export class OrderExecutionService {
  /**
   * Execute (or rest) an order. Returns the resulting status so callers can
   * build accurate per-item status envelopes.
   */
  static async executeOrder(order: Order): Promise<ExecutionOutcome> {
    try {
      logger.info('Executing order', { orderId: order.orderId, symbol: order.symbol, side: order.side, type: order.type })

      const pair = await TradingPairModel.findBySymbol(order.symbol)
      if (!pair) {
        throw createError.marketNotFound(order.symbol)
      }

      const limitPrice = order.type === 'LIMIT' || order.type === 'STOP_LIMIT' ? parseFloat(order.price || '0') : null
      // Reference price for MARKET orders — also the basis TradingService used
      // when locking, so the unlock math reconciles against the same number.
      const refPrice =
        order.type === 'MARKET' ? parseFloat(await this.getExecutionPrice(order, pair)) : limitPrice || 0
      let filledQty = 0
      let consumedValue = 0 // quote consumed (spot BUY / perp margin) or base consumed (spot SELL)

      // 1) Cross the resting book
      const result = await match(
        {
          orderId: order.orderId,
          userId: order.userId,
          symbol: order.symbol,
          side: order.side,
          price: limitPrice,
          remaining: parseFloat(order.quantity),
        },
        async (fill: Fill) => {
          // aggressing side
          consumedValue += await this.applyFill(order, pair, fill.price, fill.quantity)
          // resting (maker) side — the maker order belongs to whoever rested it
          await this.applyMakerFill(fill, pair, fill.price, fill.quantity)
          await this.recordTrade(order, fill)
        }
      )
      filledQty = result.filledQty

      const totalQty = parseFloat(order.quantity)
      const remaining = Number((totalQty - filledQty).toFixed(8))

      // 2) MARKET orders: any remainder fills at the reference market price
      if (remaining > 1e-12 && order.type === 'MARKET') {
        const marketPrice = refPrice
        consumedValue += await this.applyFill(order, pair, marketPrice, remaining)
        await this.recordTrade(order, {
          makerOrderId: order.orderId,
          makerUserId: order.userId,
          price: marketPrice,
          quantity: remaining,
        })
        filledQty = totalQty
      }

      // 3) Reconcile locked balance: release the share that was NOT filled.
      //    A fully filled order releases everything unused (incl. the MARKET
      //    slippage buffer); a resting order keeps its lock untouched; a
      //    partially filled order keeps the lock for the resting remainder.
      await this.unlockUnused(order, pair, consumedValue, filledQty / totalQty, refPrice)

      // 4) Persist fill state / rest the remainder
      if (filledQty <= 0) {
        if (order.type === 'MARKET') {
          // nothing matched and no market price available — reject
          await OrderModel.updateStatus(order.orderId, 'REJECTED')
          throw createError.invalidOrder('Market order could not be priced')
        }
        // LIMIT with no crossing → rests in the book
        addResting({
          orderId: order.orderId,
          userId: order.userId,
          symbol: order.symbol,
          side: order.side,
          price: limitPrice || 0,
          remaining: totalQty,
        })
        logger.info('Order resting', { orderId: order.orderId, symbol: order.symbol, price: limitPrice })
        return 'RESTING'
      }

      const finalRemaining = Number((totalQty - filledQty).toFixed(8))
      if (finalRemaining <= 1e-12) {
        await OrderModel.updateFill(order.orderId, totalQty.toFixed(8), '0')
        logger.info('Order executed successfully', { orderId: order.orderId, filledQty })
        return 'FILLED'
      }

      // partially filled → the remainder rests
      await OrderModel.updateFill(order.orderId, filledQty.toFixed(8), finalRemaining.toFixed(8))
      addResting({
        orderId: order.orderId,
        userId: order.userId,
        symbol: order.symbol,
        side: order.side,
        price: limitPrice || 0,
        remaining: finalRemaining,
      })
      logger.info('Order partially filled, remainder resting', { orderId: order.orderId, filledQty, finalRemaining })
      return 'PARTIALLY_FILLED'
    } catch (error: any) {
      logger.error('Failed to execute order', { orderId: order.orderId, error: error.message })
      // Only mark cancelled if the order is still open (resting/partial is not an error)
      const current = await OrderModel.findById(order.orderId)
      if (current && (current.status === 'OPEN' || current.status === 'PARTIALLY_FILLED')) {
        await OrderModel.updateStatus(order.orderId, 'CANCELLED')
      }
      throw error
    }
  }

  /**
   * Reference price for MARKET orders: the live Hyperliquid ticker with the
   * same hardcoded fallback the rest of the engine uses.
   */
  private static async getExecutionPrice(order: Order, _pair: any): Promise<string> {
    if (order.type !== 'MARKET') {
      return order.price || '0'
    }
    try {
      const coin = HyperliquidService.symbolToCoin(order.symbol)
      const ticker = await HyperliquidService.getTicker(coin)
      return ticker.lastPrice
    } catch (error) {
      logger.warn('Failed to get market price, using fallback', { symbol: order.symbol })
      if (order.symbol.includes('BTC')) return '98000'
      if (order.symbol.includes('ETH')) return '3500'
      return '0'
    }
  }

  /**
   * Apply one fill to the AGGRESSING order's balances/positions.
   * Returns the value consumed from the locked asset (quote for BUY/perp,
   * base for spot SELL) so the caller can unlock the unused remainder.
   */
  private static async applyFill(order: Order, pair: any, price: number, quantity: number): Promise<number> {
    if (pair.type === 'SPOT') {
      const total = quantity * price
      if (order.side === 'BUY') {
        await AssetModel.deductLocked(order.userId, pair.quoteAsset, total.toFixed(8))
        await AssetModel.getOrCreate(order.userId, pair.baseAsset)
        await AssetModel.addFree(order.userId, pair.baseAsset, quantity.toFixed(8))
        return total
      }
      await AssetModel.deductLocked(order.userId, pair.baseAsset, quantity.toFixed(8))
      await AssetModel.getOrCreate(order.userId, pair.quoteAsset)
      await AssetModel.addFree(order.userId, pair.quoteAsset, total.toFixed(8))
      return quantity
    }

    // PERPETUAL — margin-based
    const { leverage, marginMode } = await this.userRiskParams(order.userId)
    const margin = (quantity * price) / leverage
    const positionSide: PositionSide = order.side === 'BUY' ? 'LONG' : 'SHORT'
    const existing = await PositionModel.findByUserAndSymbol(order.userId, order.symbol, positionSide)
    if (existing) {
      const existingQty = parseFloat(existing.quantity)
      const existingEntry = parseFloat(existing.entryPrice)
      const totalQty = existingQty + quantity
      const avgEntry = (existingQty * existingEntry + quantity * price) / totalQty
      await PositionModel.updateQuantity(existing.positionId, totalQty.toFixed(8), avgEntry.toFixed(8))
    } else {
      await PositionModel.create({
        positionId: uuidv4(),
        userId: order.userId,
        symbol: order.symbol,
        side: positionSide,
        quantity: quantity.toFixed(8),
        entryPrice: price.toFixed(8),
        leverage,
        margin: margin.toFixed(8),
        marginMode,
      })
    }
    await AssetModel.deductLocked(order.userId, pair.quoteAsset, margin.toFixed(8))
    return margin
  }

  /**
   * Apply one fill to the RESTING (maker) order's owner. The maker's locked
   * asset is the mirror image of the aggressor's.
   */
  private static async applyMakerFill(fill: Fill, pair: any, price: number, quantity: number): Promise<void> {
    const makerOrder = await OrderModel.findById(fill.makerOrderId)
    if (!makerOrder) return

    // value consumed from the maker's locked asset, and which asset that is
    let consumed: number
    let lockedAsset: string

    if (pair.type === 'SPOT') {
      const total = quantity * price
      if (makerOrder.side === 'BUY') {
        consumed = total
        lockedAsset = pair.quoteAsset
        await AssetModel.deductLocked(makerOrder.userId, pair.quoteAsset, total.toFixed(8))
        await AssetModel.getOrCreate(makerOrder.userId, pair.baseAsset)
        await AssetModel.addFree(makerOrder.userId, pair.baseAsset, quantity.toFixed(8))
      } else {
        consumed = quantity
        lockedAsset = pair.baseAsset
        await AssetModel.deductLocked(makerOrder.userId, pair.baseAsset, quantity.toFixed(8))
        await AssetModel.getOrCreate(makerOrder.userId, pair.quoteAsset)
        await AssetModel.addFree(makerOrder.userId, pair.quoteAsset, total.toFixed(8))
      }
    } else {
      const { leverage, marginMode } = await this.userRiskParams(makerOrder.userId)
      const margin = (quantity * price) / leverage
      consumed = margin
      lockedAsset = pair.quoteAsset
      const positionSide: PositionSide = makerOrder.side === 'BUY' ? 'LONG' : 'SHORT'
      const existing = await PositionModel.findByUserAndSymbol(makerOrder.userId, makerOrder.symbol, positionSide)
      if (existing) {
        const existingQty = parseFloat(existing.quantity)
        const existingEntry = parseFloat(existing.entryPrice)
        const totalQty = existingQty + quantity
        const avgEntry = (existingQty * existingEntry + quantity * price) / totalQty
        await PositionModel.updateQuantity(existing.positionId, totalQty.toFixed(8), avgEntry.toFixed(8))
      } else {
        await PositionModel.create({
          positionId: uuidv4(),
          userId: makerOrder.userId,
          symbol: makerOrder.symbol,
          side: positionSide,
          quantity: quantity.toFixed(8),
          entryPrice: price.toFixed(8),
          leverage,
          margin: margin.toFixed(8),
          marginMode,
        })
      }
      await AssetModel.deductLocked(makerOrder.userId, pair.quoteAsset, margin.toFixed(8))
    }

    // advance the maker order's own fill state
    const makerFilled = parseFloat(makerOrder.filledQuantity) + quantity
    const makerRemaining = Number((parseFloat(makerOrder.quantity) - makerFilled).toFixed(8))
    await OrderModel.updateFill(
      makerOrder.orderId,
      makerFilled.toFixed(8),
      makerRemaining > 0 ? makerRemaining.toFixed(8) : '0'
    )

    // release the maker's unused lock for the FILLED share (a partially filled
    // maker keeps the lock for its resting remainder)
    const makerRefPrice = parseFloat(makerOrder.price || '0')
    const makerBuffer = makerOrder.type === 'MARKET' ? 1.01 : 1
    const fillShare = quantity / parseFloat(makerOrder.quantity)
    const makerLocked = parseFloat(makerOrder.quantity) * makerRefPrice * makerBuffer * fillShare
    const makerUnused = Number((makerLocked - consumed).toFixed(8))
    if (makerUnused > 0) {
      await AssetModel.unlock(makerOrder.userId, lockedAsset, makerUnused.toFixed(8))
    }
  }

  /**
   * The user's persisted risk parameters (leverage + margin mode), with the
   * same defaults the account model uses (10x cross).
   */
  private static async userRiskParams(userId: number): Promise<{ leverage: number; marginMode: MarginMode }> {
    const settings = await UserSettingsModel.get(userId)
    return { leverage: settings.leverage, marginMode: settings.marginMode }
  }

  /** Write one trade row per fill (taker perspective). */
  private static async recordTrade(order: Order, fill: Fill): Promise<void> {
    await OrderModel.recordTrade({
      tradeId: uuidv4(),
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      price: fill.price.toFixed(8),
      quantity: fill.quantity.toFixed(8),
      fee: '0',
      isMaker: false,
    })
  }

  /**
   * Release the locked balance that the filled portion did not consume.
   * `fillRatio` (0..1) scales the original lock so a resting order keeps its
   * full lock while a filled one releases the unused remainder (including the
   * MARKET slippage buffer). Mirrors TradingService.calculateRequiredBalance,
   * including its use of the reference price for MARKET orders.
   */
  private static async unlockUnused(
    order: Order,
    pair: any,
    consumed: number,
    fillRatio: number,
    refPrice: number
  ): Promise<void> {
    const isSpotSell = pair.type === 'SPOT' && order.side === 'SELL'
    const asset = isSpotSell ? pair.baseAsset : pair.quoteAsset
    const buffer = order.type === 'MARKET' ? 1.01 : 1
    const qty = parseFloat(order.quantity)
    const lockedTotal = (isSpotSell ? qty * buffer : qty * refPrice * buffer) * fillRatio
    const unused = Number((lockedTotal - consumed).toFixed(8))
    if (unused > 0) {
      await AssetModel.unlock(order.userId, asset, unused.toFixed(8))
    }
  }
}
