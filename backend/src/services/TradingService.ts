import { v4 as uuidv4 } from 'uuid'
import { OrderModel } from '../models/Order'
import { PositionModel } from '../models/Position'
import { AssetModel } from '../models/Asset'
import { TradingPairModel } from '../models/TradingPair'
import { Order, CreateOrderRequest, Position, MarginMode } from '../types'
import { createError } from '../utils/response'
import { verifySignature, verifyOrderActionSignatureAny, verifyDemoSignature, verifyApproveAgentSignature, verifyApproveBuilderSignature } from '../utils/signature'
import { checkSzDecimals, checkPrice } from '../utils/rounding'
import { UserSettingsModel } from '../models/UserSettings'
import { AgentModel } from '../models/AgentModel'
import config from '../config'
import { OrderExecutionService } from './OrderExecutionService'
import { HyperliquidService } from './HyperliquidService'
import logger from '../utils/logger'

/**
 * Trading Service - Business logic for trading operations
 */
export class TradingService {
  /**
   * Create a new order
   */
  static async createOrder(userId: number, request: CreateOrderRequest): Promise<Order> {
    // Verify trading pair exists
    const pair = await TradingPairModel.findBySymbol(request.symbol)
    if (!pair) {
      throw createError.marketNotFound(request.symbol)
    }

    // Validate order parameters (precision rules need the live asset meta)
    await this.validateOrder(request, pair)

    // Verify signature — routing depends on how the client signed:
    //   eip712      → structured signature over the order action (Hyperliquid
    //                 Exchange domain); the signer may be the account's own
    //                 wallet OR a registered agent (API-wallet model)
    //   demo-sha256 → wallet-less demo marker (no authorship guarantees)
    //   legacy      → EIP-191 personal_sign (wallet users) / SHA-256 (others)
    const scheme = request.signatureScheme
    let isValidSignature: boolean
    if (scheme === 'eip712') {
      isValidSignature = await verifyOrderActionSignatureAny(userId, request, request.signature)
    } else if (scheme === 'demo-sha256') {
      isValidSignature = await verifyDemoSignature(userId, request, request.signature)
    } else {
      isValidSignature = await verifySignature(userId, request, request.signature)
    }
    if (!isValidSignature) {
      throw createError.invalidSignature()
    }

    // Builder Codes: if this deployment has a builder configured and the user
    // has approved it, inject {b, f} onto the order (rate-capped per market).
    const builderFee = await this.resolveBuilderFee(userId, request, pair)

    // Calculate required balance
    const requiredBalance = await this.calculateRequiredBalance(request, pair)

    // Lock balance: quote asset (USDC) for buys, base asset for sells
    const asset = this.lockAsset(request, pair)
    await AssetModel.getOrCreate(userId, asset)

    try {
      // Get current balance for debugging
      const userAsset = await AssetModel.findByUserAndAsset(userId, asset)
      logger.info('Order balance check', {
        userId,
        asset,
        requiredBalance,
        availableBalance: userAsset?.free || '0',
        symbol: request.symbol,
        side: request.side,
        price: request.price,
        quantity: request.quantity
      })

      await AssetModel.lock(userId, asset, requiredBalance)
    } catch (error: any) {
      logger.error('Failed to lock balance', {
        userId,
        asset,
        requiredBalance,
        error: error.message
      })
      throw createError.insufficientBalance(error.message)
    }

    // Create order
    const orderId = uuidv4()
    const order = await OrderModel.create({
      orderId,
      userId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      price: request.price,
      stopPrice: request.stopPrice,
      quantity: request.quantity,
      timeInForce: request.timeInForce || 'GTC',
      reduceOnly: request.reduceOnly || false,
      postOnly: request.postOnly || false,
      signature: request.signature,
    })

    // Record the injected builder fee (audit trail, Hyperliquid Builder Codes)
    if (builderFee) {
      await AgentModel.recordBuilderFee(orderId, userId, builderFee.builderAddress, builderFee.fee)
      logger.info('Builder fee injected', { orderId, builder: builderFee.builderAddress, fee: builderFee.fee })
    }

    // Execute order immediately (for demo purposes)
    // In production, this would be handled by a separate matching engine
    try {
      await OrderExecutionService.executeOrder(order)
    } catch (error: any) {
      logger.error('Order execution failed', { orderId, error: error.message })
      // Order will remain in OPEN or CANCELLED state
    }

    // Fetch updated order to return latest status
    const updatedOrder = await OrderModel.findById(orderId)
    return updatedOrder || order
  }

  /**
   * Cancel an order
   */
  static async cancelOrder(userId: number, orderId: string): Promise<void> {
    const order = await OrderModel.findById(orderId)

    if (!order) {
      throw createError.notFound('Order not found')
    }

    if (order.userId !== userId) {
      throw createError.forbidden('Not authorized to cancel this order')
    }

    if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') {
      throw createError.badRequest('Order cannot be cancelled')
    }

    // Release locked balance (same asset the order locked)
    const pair = await TradingPairModel.findBySymbol(order.symbol)
    if (pair) {
      const asset = this.lockAsset(order, pair)
      const lockedAmount = await this.calculateLockedAmount(order, pair)
      await AssetModel.unlock(userId, asset, lockedAmount)
    }

    // Cancel order
    await OrderModel.cancel(orderId)
  }

  /**
   * Cancel all orders for a user
   */
  static async cancelAllOrders(userId: number, symbol?: string): Promise<number> {
    const orders = await OrderModel.findOpenByUserId(userId, symbol)

    // Release locked balances
    for (const order of orders) {
      const pair = await TradingPairModel.findBySymbol(order.symbol)
      if (pair) {
        const asset = this.lockAsset(order, pair)
        const lockedAmount = await this.calculateLockedAmount(order, pair)
        try {
          await AssetModel.unlock(userId, asset, lockedAmount)
        } catch (error) {
          // Continue even if unlock fails
        }
      }
    }

    const cancelledCount = await OrderModel.cancelAllByUserId(userId, symbol)
    return cancelledCount
  }

  /**
   * Get user's open orders
   */
  static async getOpenOrders(userId: number, symbol?: string): Promise<Order[]> {
    return await OrderModel.findOpenByUserId(userId, symbol)
  }

  /**
   * Get user's order history
   */
  static async getOrderHistory(
    userId: number,
    limit: number = 50,
    offset: number = 0
  ): Promise<Order[]> {
    return await OrderModel.findByUserId(userId, limit, offset)
  }

  /**
   * Get order by ID
   */
  static async getOrder(userId: number, orderId: string): Promise<Order> {
    const order = await OrderModel.findById(orderId)

    if (!order) {
      throw createError.notFound('Order not found')
    }

    if (order.userId !== userId) {
      throw createError.forbidden('Not authorized to view this order')
    }

    return order
  }

  /**
   * Set leverage for a symbol — persisted per user and validated against the
   * LIVE maxLeverage from the universe (not the old hardcoded 1..100 range).
   */
  static async setLeverage(
    userId: number,
    symbol: string,
    leverage: number
  ): Promise<{ leverage: number; maxLeverage: number }> {
    // Verify trading pair exists and is perpetual
    const pair = await TradingPairModel.findBySymbol(symbol)
    if (!pair) {
      throw createError.marketNotFound(symbol)
    }

    if (pair.type !== 'PERPETUAL') {
      throw createError.badRequest('Leverage is only available for perpetual markets')
    }

    // Live max leverage from meta (fallback: 50)
    let maxLeverage = 50
    try {
      const assetMeta = await HyperliquidService.getAssetMeta(symbol)
      if (assetMeta) maxLeverage = assetMeta.maxLeverage
    } catch {
      // meta unavailable — keep the fallback cap
    }

    // Validate leverage
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > maxLeverage) {
      throw createError.badRequest(`Leverage must be an integer between 1 and ${maxLeverage}`)
    }

    // Check if user has open positions
    const positions = await PositionModel.findByUserId(userId, symbol)
    if (positions.length > 0) {
      throw createError.badRequest('Cannot change leverage with open positions')
    }

    await UserSettingsModel.setLeverage(userId, leverage)
    return { leverage, maxLeverage }
  }

  /**
   * Set margin mode (cross / isolated) — persisted per user, blocked while
   * positions are open (same guard as Hyperliquid).
   */
  static async setMarginMode(
    userId: number,
    symbol: string,
    marginMode: MarginMode
  ): Promise<{ marginMode: MarginMode }> {
    const pair = await TradingPairModel.findBySymbol(symbol)
    if (!pair) {
      throw createError.marketNotFound(symbol)
    }
    if (pair.type !== 'PERPETUAL') {
      throw createError.badRequest('Margin mode is only available for perpetual markets')
    }
    if (marginMode !== 'CROSS' && marginMode !== 'ISOLATED') {
      throw createError.badRequest('Margin mode must be CROSS or ISOLATED')
    }
    const positions = await PositionModel.findByUserId(userId, symbol)
    if (positions.length > 0) {
      throw createError.badRequest('Cannot change margin mode with open positions')
    }
    await UserSettingsModel.setMarginMode(userId, marginMode)
    return { marginMode }
  }

  /**
   * Validate order parameters — Hyperliquid-style precision rules:
   *   · quantity ≤ szDecimals places (from LIVE meta; unrounded → rejected)
   *   · price is a tick multiple, ≤5 sig figs, ≤8 decimals
   * Unrounded values are REJECTED, not silently fixed (protocol semantics).
   */
  private static async validateOrder(request: CreateOrderRequest, pair: any): Promise<void> {
    const quantity = parseFloat(request.quantity)

    // Validate quantity
    if (isNaN(quantity) || quantity <= 0) {
      throw createError.invalidOrder('Invalid quantity')
    }

    const minOrderSize = parseFloat(pair.minOrderSize)
    const maxOrderSize = parseFloat(pair.maxOrderSize)

    if (quantity < minOrderSize) {
      throw createError.invalidOrder(
        `Order size too small. Minimum: ${minOrderSize}`,
        { minOrderSize }
      )
    }

    if (quantity > maxOrderSize) {
      throw createError.invalidOrder(
        `Order size too large. Maximum: ${maxOrderSize}`,
        { maxOrderSize }
      )
    }

    // Precision: szDecimals from the live universe (fallback: pair default of 4)
    let szDecimals = 4
    try {
      const assetMeta = await HyperliquidService.getAssetMeta(request.symbol)
      if (assetMeta) szDecimals = assetMeta.szDecimals
    } catch {
      // meta unavailable — fall back to the pair default rather than rejecting
    }
    const szCheck = checkSzDecimals(request.quantity, szDecimals)
    if (!szCheck.ok) {
      throw createError.invalidOrder(szCheck.reason!, { szDecimals, rounded: szCheck.rounded })
    }

    // Validate price for limit orders
    if (request.type === 'LIMIT' || request.type === 'STOP_LIMIT') {
      if (!request.price) {
        throw createError.invalidOrder('Price is required for limit orders')
      }

      const price = parseFloat(request.price)
      if (isNaN(price) || price <= 0) {
        throw createError.invalidOrder('Invalid price')
      }

      // Validate tick size + sig-fig/decimal limits
      const tickSize = parseFloat(pair.tickSize)
      const pxCheck = checkPrice(request.price, tickSize)
      if (!pxCheck.ok) {
        throw createError.invalidOrder(pxCheck.reason!, { tickSize, rounded: pxCheck.rounded })
      }
    }

    // Validate stop price for stop orders
    if (request.type === 'STOP_LIMIT' || request.type === 'STOP_MARKET') {
      if (!request.stopPrice) {
        throw createError.invalidOrder('Stop price is required for stop orders')
      }

      const stopPrice = parseFloat(request.stopPrice)
      if (isNaN(stopPrice) || stopPrice <= 0) {
        throw createError.invalidOrder('Invalid stop price')
      }
    }
  }

  /**
   * Estimate the execution price for a MARKET order.
   * Uses the live Hyperliquid ticker with the same hardcoded fallback as
   * OrderExecutionService, so the locked amount and the executed amount are
   * computed from the same price source.
   */
  private static async estimateMarketPrice(symbol: string): Promise<number> {
    try {
      const coin = HyperliquidService.symbolToCoin(symbol)
      const ticker = await HyperliquidService.getTicker(coin)
      const px = parseFloat(ticker.lastPrice)
      if (Number.isFinite(px) && px > 0) return px
    } catch {
      // fall through to the hardcoded fallback
    }
    if (symbol.includes('BTC')) return 98000
    if (symbol.includes('ETH')) return 3500
    return 0
  }

  /**
   * The asset an order locks:
   *   · spot SELL locks the BASE asset (you are selling BTC, not USDC)
   *   · everything else (spot BUY, perps of both sides — margin is USDC)
   *     locks the QUOTE asset
   */
  private static lockAsset(request: { side: string }, pair: any): string {
    return pair.type === 'SPOT' && request.side === 'SELL' ? pair.baseAsset : pair.quoteAsset
  }

  /**
   * Builder Codes: resolve the {b, f} pair to inject on an order.
   * Requires (a) this deployment to have a builder configured, (b) the user to
   * have approved it, and (c) the fee to respect the per-market cap:
   * perp ≤ 100 (10bp), spot ≤ 1000 (100bp), in 0.1bp units.
   */
  private static async resolveBuilderFee(
    userId: number,
    request: CreateOrderRequest,
    pair: any
  ): Promise<{ builderAddress: string; fee: number } | null> {
    if (!config.builder.address) return null
    const approvals = await AgentModel.listBuilderApprovals(userId)
    const approval = approvals.find(
      (a) => a.builderAddress.toLowerCase() === config.builder.address.toLowerCase()
    )
    if (!approval) return null
    const cap = pair.type === 'PERPETUAL' ? 100 : 1000
    const requested = request.builderFee ?? config.builder.defaultFee
    const fee = Math.min(requested, approval.maxFee, cap)
    if (fee <= 0) return null
    return { builderAddress: config.builder.address, fee }
  }

  /**
   * Calculate required balance for an order, denominated in the asset that
   * lockAsset() returns:
   *   · spot SELL          → base-asset quantity
   *   · spot BUY           → quote (price × quantity)
   *   · perp (both sides)  → quote notional (price × quantity)
   * MARKET orders add a 1% buffer against slippage.
   */
  private static async calculateRequiredBalance(request: CreateOrderRequest, pair: any): Promise<string> {
    const quantity = parseFloat(request.quantity)
    const buffer = request.type === 'MARKET' ? 1.01 : 1
    const isSpotSell = pair.type === 'SPOT' && request.side === 'SELL'

    if (isSpotSell) {
      return (quantity * buffer).toFixed(8)
    }
    const price =
      request.type === 'MARKET'
        ? await this.estimateMarketPrice(request.symbol)
        : parseFloat(request.price!)
    return (quantity * price * buffer).toFixed(8)
  }

  /**
   * Calculate locked amount from order — must mirror calculateRequiredBalance.
   */
  private static async calculateLockedAmount(order: Order, pair: any): Promise<string> {
    const remainingQty = parseFloat(order.remainingQuantity)
    const buffer = order.type === 'MARKET' ? 1.01 : 1
    const isSpotSell = pair.type === 'SPOT' && order.side === 'SELL'

    if (isSpotSell) {
      return (remainingQty * buffer).toFixed(8)
    }
    const price = order.type === 'MARKET' ? await this.estimateMarketPrice(order.symbol) : parseFloat(order.price!)
    return (remainingQty * price * buffer).toFixed(8)
  }
}
