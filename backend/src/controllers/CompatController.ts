import { Request, Response } from 'express'
import { TradingService } from '../services/TradingService'
import { HyperliquidService } from '../services/HyperliquidService'
import { TradingPairModel } from '../models/TradingPair'
import { PositionModel } from '../models/Position'
import { AssetModel } from '../models/Asset'
import { UserModel } from '../models/User'
import {
  verifyOrderActionSignature,
  verifyCancelActionSignature,
} from '../utils/signature'

/**
 * Hyperliquid-compatible API surface.
 *
 *   POST /info      — read surface (meta / spotMeta / l2Book / candleSnapshot /
 *                     allMids / clearinghouseState), raw JSON, decimal strings
 *   POST /exchange  — write surface, EIP-712 signed actions, per-item status
 *                     envelopes exactly like the official protocol
 *
 * This mirrors the target site's three-surface design at the granularity our
 * demo can actually honour: the request/response SHAPES and the signing scheme
 * are identical, while execution stays the local simulated engine.
 */

/** Internal symbol → wire coin name ("BTC-PERP"/"BTC/USDC" → "BTC"). */
function coinOf(symbol: string): string {
  return symbol.replace(/-PERP$/i, '').replace(/\/USDC$/i, '')
}

/** HIP-style asset ids: perp = universe index; spot = 10000 + spot index. */
function perpAssetId(index: number): number {
  return index
}
function spotAssetId(index: number): number {
  return 10000 + index
}

export class CompatController {
  /**
   * POST /info  — body: { type, ...params }
   */
  static info = async (req: Request, res: Response) => {
    const body = req.body ?? {}
    const type = body.type

    switch (type) {
      case 'meta': {
        const { meta } = await HyperliquidService.getMetaAndAssetCtxs()
        // Wire shape: bare coin names; asset id = array index (HIP-1).
        const universe = meta.universe.map((a: any, i: number) => ({
          name: coinOf(a.name),
          szDecimals: a.szDecimals,
          maxLeverage: a.maxLeverage,
          ...(a.isDelisted ? { isDelisted: true } : {}),
          _assetId: perpAssetId(i), // informational: HL derives it from position
        }))
        return res.json({ universe })
      }

      case 'spotMeta': {
        const pairs = await TradingPairModel.findByType('SPOT')
        const tokens = [
          { name: 'USDC', index: 0, szDecimals: 6 },
          ...Array.from(new Set(pairs.map((p) => p.baseAsset))).map((base, i) => ({
            name: base,
            index: i + 1,
            szDecimals: 4,
          })),
        ]
        const universe = pairs.map((p, i) => {
          const baseIdx = tokens.findIndex((t) => t.name === p.baseAsset)
          return {
            name: `${p.baseAsset}/USDC`,
            tokens: [baseIdx, 0],
            _assetId: spotAssetId(i), // HIP-2: 10000 + index
          }
        })
        return res.json({ tokens, universe })
      }

      case 'l2Book': {
        const coin = String(body.coin ?? '')
        const symbol = `${coin}/USDC`
        const book = await HyperliquidService.getL2Book(HyperliquidService.symbolToCoin(symbol))
        const toWire = (levels: any[]) =>
          (levels ?? []).map((l) => [String(l.px), String(l.sz), Number(l.n ?? 1)])
        return res.json({
          coin,
          levels: [toWire(book.levels?.[0]), toWire(book.levels?.[1])],
          time: Date.now(),
        })
      }

      case 'candleSnapshot': {
        const coin = String(body.coin ?? '')
        const interval = String(body.interval ?? '1h')
        const endTime = Number(body.endTime ?? Date.now())
        const startTime = Number(body.startTime ?? endTime - 24 * 60 * 60 * 1000)
        const candles = await HyperliquidService.getCandles(
          HyperliquidService.symbolToCoin(`${coin}/USDC`),
          interval,
          startTime,
          endTime
        )
        return res.json(
          candles.map((c: any) => ({
            t: c.t,
            T: c.T,
            s: coin,
            i: interval,
            o: String(c.o),
            c: String(c.c),
            h: String(c.h),
            l: String(c.l),
            v: String(c.v),
            n: c.n ?? 0,
          }))
        )
      }

      case 'allMids': {
        const { meta, assetCtxs } = await HyperliquidService.getMetaAndAssetCtxs()
        const mids: Record<string, string> = {}
        meta.universe.forEach((a: any, i: number) => {
          const ctx = assetCtxs[i]
          if (ctx?.midPx || ctx?.markPx) mids[coinOf(a.name)] = String(ctx.midPx ?? ctx.markPx)
        })
        return res.json(mids)
      }

      case 'clearinghouseState': {
        const user = await resolveUser(body.user, req)
        if (!user) {
          return res.status(404).json({ error: 'Unknown user' })
        }
        const positions = await PositionModel.findByUserId(user.id)
        const assets = await AssetModel.findByUserId(user.id)
        const freeUsdc = parseFloat(assets.find((a) => a.asset === 'USDC')?.free ?? '0')
        const marginUsed = await PositionModel.getTotalMarginByUserId(user.id)
        const unrealized = await PositionModel.getTotalUnrealizedPnlByUserId(user.id)
        const accountValue = freeUsdc + parseFloat(marginUsed) + parseFloat(unrealized)

        const assetPositions = positions.map((p) => {
          const isLong = p.side === 'LONG'
          const szi = isLong ? p.quantity : `-${p.quantity}`
          return {
            position: {
              coin: coinOf(p.symbol),
              szi,
              entryPx: p.entryPrice,
              positionValue: (parseFloat(p.quantity) * parseFloat(p.markPrice)).toString(),
              unrealizedPnl: p.unrealizedPnl,
              leverage: { type: p.marginMode.toLowerCase(), value: p.leverage },
              liquidationPx: p.liquidationPrice,
              marginUsed: p.margin,
            },
            type: 'oneWay',
          }
        })

        return res.json({
          marginSummary: { accountValue: accountValue.toString() },
          crossMarginSummary: { accountValue: accountValue.toString() },
          assetPositions,
        })
      }

      default:
        return res.status(400).json({ error: `Unknown info type: ${String(type)}` })
    }
  }

  /**
   * POST /exchange — body: { action, signature, signatureScheme?, nonce }
   * Requires a session (JWT); the signature must be the account's own EIP-712
   * signature over the action.
   */
  static exchange = async (req: Request, res: Response) => {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ status: 'err', response: 'Not authenticated' })
    }

    const { action, signature, nonce } = req.body ?? {}
    if (!action || typeof action.type !== 'string' || !signature) {
      return res.status(400).json({ status: 'err', response: 'Missing action or signature' })
    }

    if (action.type === 'order') {
      const valid = await verifyOrderActionSignature(
        userId,
        {
          symbol: action.symbol,
          side: action.side,
          type: action.orderType,
          price: action.price,
          quantity: action.quantity,
          reduceOnly: action.reduceOnly,
          postOnly: action.postOnly,
          nonce,
        },
        signature
      )
      if (!valid) {
        return res.status(401).json({ status: 'err', response: 'Invalid signature' })
      }

      try {
        const order = await TradingService.createOrder(userId, {
          symbol: action.symbol,
          side: action.side,
          type: action.orderType,
          price: action.price,
          quantity: action.quantity,
          reduceOnly: action.reduceOnly,
          postOnly: action.postOnly,
          signature,
          signatureScheme: 'eip712',
          nonce,
        })

        // Per-item status envelope, exactly like the official protocol.
        // Wire convention: decimal quantities/prices as strings.
        const status =
          order.status === 'FILLED'
            ? { filled: { totalSz: String(order.filledQuantity), avgPx: String(order.price ?? '0') } }
            : order.status === 'CANCELLED' || order.status === 'REJECTED'
              ? { error: `Order ${order.status.toLowerCase()}` }
              : { resting: { oid: order.orderId } }
        return res.json({
          status: 'ok',
          response: { type: 'order', data: { statuses: [status] } },
        })
      } catch (error: any) {
        return res.status(400).json({ status: 'err', response: error.message ?? 'Order failed' })
      }
    }

    if (action.type === 'cancel') {
      const valid = await verifyCancelActionSignature(
        userId,
        { symbol: action.symbol, orderId: action.orderId, nonce },
        signature
      )
      if (!valid) {
        return res.status(401).json({ status: 'err', response: 'Invalid signature' })
      }
      try {
        await TradingService.cancelOrder(userId, action.orderId)
        return res.json({ status: 'ok', response: { type: 'cancel', data: { status: 'success' } } })
      } catch (error: any) {
        return res.status(400).json({ status: 'err', response: error.message ?? 'Cancel failed' })
      }
    }

    return res.status(400).json({ status: 'err', response: `Unknown action type: ${action.type}` })
  }
}

/** Resolve a user by address param, or fall back to the session user. */
async function resolveUser(address: unknown, req: Request) {
  if (typeof address === 'string' && address.startsWith('0x')) {
    return await UserModel.findByWalletAddress(address)
  }
  if (req.user?.id) {
    return await UserModel.findById(req.user.id)
  }
  return null
}
