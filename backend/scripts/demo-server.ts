/**
 * Demo server — boots the REAL Express app + WebSocket service against the
 * in-memory fake DB and stubbed Hyperliquid service, so the full UI can be
 * explored without MySQL, Redis or network access.
 *
 * Usage: npm run demo   (then open http://localhost:5173)
 *
 * Seeded demo account (anvil #1, public test key):
 *   0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 *   USDC 25,000 free + 9,100 locked · BTC 0.5 · 2 open positions · 2 resting
 *   orders · filled history. All prices are aligned with the stubbed ticker
 *   (BTC 61,000 / ETH 3,100) so the whole UI tells one consistent story.
 */

// The Vite dev server runs on 5173 — allow its REST calls (default CORS
// origin is 3000, which would block every browser request to the API).
process.env.CORS_ORIGIN = 'http://localhost:5173'

import '../test/helpers/fake-db'
import '../test/helpers/fake-hyperliquid'
import { fakeDb } from '../test/helpers/fake-db'

import createApp from '../src/app'
import config from '../src/config'
import logger from '../src/utils/logger'
import { initWebSocket } from '../src/websocket'
import { HyperliquidService } from '../src/services/HyperliquidService'
import { OrderModel } from '../src/models/Order'
import { FundingService } from '../src/services/FundingService'

const USER = 1
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const now = new Date()

// deterministic market data aligned with the stubbed ticker
const PRICES: Record<string, number> = { BTC: 61000, ETH: 3100 }
const SYMBOLS = ['BTC/USDC', 'ETH/USDC', 'BTC-PERP', 'ETH-PERP']

function deterministicOrderbook(symbol: string) {
	const coin = symbol.includes('BTC') ? 'BTC' : 'ETH'
	const base = PRICES[coin]
	const bids = Array.from({ length: 20 }, (_, i) => ({
		price: (base * (1 - (i + 1) * 0.0001)).toFixed(2),
		quantity: (5 - i * 0.2).toFixed(4),
	}))
	const asks = Array.from({ length: 20 }, (_, i) => ({
		price: (base * (1 + (i + 1) * 0.0001)).toFixed(2),
		quantity: (5 - i * 0.2).toFixed(4),
	}))
	return { symbol, bids, asks }
}

function deterministicTrade(symbol: string, i: number) {
	const coin = symbol.includes('BTC') ? 'BTC' : 'ETH'
	const base = PRICES[coin]
	return {
		symbol,
		tradeId: `demo-${symbol}-${i}`,
		price: (base + (i % 2 === 0 ? 5 : -5)).toFixed(2),
		quantity: (0.05 + (i % 5) * 0.01).toFixed(4),
		side: i % 2 === 0 ? 'BUY' : 'SELL',
		timestamp: Date.now(),
	}
}

const SEED_POSITIONS = [
	{
		symbol: 'BTC-PERP', side: 'LONG', quantity: '0.25', entryPrice: '60000.00',
		markPrice: '61000.00', liquidationPrice: '48000.00', leverage: 10,
		margin: '1525.00', unrealizedPnl: '250.00', marginRatio: '0.0250',
	},
	{
		symbol: 'ETH-PERP', side: 'SHORT', quantity: '2', entryPrice: '3150.00',
		markPrice: '3100.00', liquidationPrice: '3800.00', leverage: 5,
		margin: '1260.00', unrealizedPnl: '100.00', marginRatio: '0.0203',
	},
]

function seedDemoData() {
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [
			{ id: USER, wallet_address: WALLET, email: 'demo@hyperliquid.clone', google_id: null, name: 'Demo Trader', avatar: null, created_at: now, updated_at: now },
		],
		assets: [
			// locked 9,100 = 5,900 (BTC-PERP bid) + 3,200 (ETH-PERP offer)
			{ id: 1, user_id: USER, asset: 'USDC', free: '25000.00000000', locked: '9100.00000000', created_at: now, updated_at: now },
			{ id: 2, user_id: USER, asset: 'BTC', free: '0.50000000', locked: '0.00000000', created_at: now, updated_at: now },
		],
		positions: [
			{
				position_id: 'pos-btc-1', user_id: USER, symbol: 'BTC-PERP', side: 'LONG',
				quantity: '0.25000000', entry_price: '60000.00000000', mark_price: '61000.00000000',
				liquidation_price: '48000.00000000', leverage: 10, margin: '1525.00000000',
				unrealized_pnl: '250.00000000', realized_pnl: '820.00000000', margin_mode: 'CROSS',
				created_at: now, updated_at: now,
			},
			{
				position_id: 'pos-eth-1', user_id: USER, symbol: 'ETH-PERP', side: 'SHORT',
				quantity: '2.00000000', entry_price: '3150.00000000', mark_price: '3100.00000000',
				liquidation_price: '3800.00000000', leverage: 5, margin: '1260.00000000',
				unrealized_pnl: '100.00000000', realized_pnl: '-45.00000000', margin_mode: 'CROSS',
				created_at: now, updated_at: now,
			},
		],
	})
}

async function seedOrders() {
	// resting orders (the locked USDC above matches these)
	await OrderModel.create({
		orderId: 'ord-open-1', userId: USER, symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT',
		price: '59000', quantity: '0.1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'demo',
	})
	await OrderModel.create({
		orderId: 'ord-open-2', userId: USER, symbol: 'ETH-PERP', side: 'SELL', type: 'LIMIT',
		price: '3200', quantity: '1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'demo',
	})
	// filled history
	await OrderModel.create({
		orderId: 'ord-hist-1', userId: USER, symbol: 'BTC-PERP', side: 'BUY', type: 'MARKET',
		quantity: '0.25', timeInForce: 'IOC', reduceOnly: false, postOnly: false, signature: 'demo',
	})
	await OrderModel.updateFill('ord-hist-1', '0.25', '0')
	await OrderModel.create({
		orderId: 'ord-hist-2', userId: USER, symbol: 'ETH-PERP', side: 'SELL', type: 'LIMIT',
		price: '3100', quantity: '2', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'demo',
	})
	await OrderModel.updateFill('ord-hist-2', '2', '0')
}

/**
 * websocket.ts broadcasts random mock data every 1-3s which would overwrite
 * the seeded REST state with noise. Replace the instance's broadcast method
 * so market streams carry deterministic data instead.
 */
function stabilizeWebSocketStreams(ws: any) {
	const original = ws.broadcastToChannel.bind(ws)
	let tradeTick = 0
	ws.broadcastToChannel = (channel: string, data: any) => {
		if (channel.startsWith('orderbook:')) {
			return original(channel, deterministicOrderbook(data.symbol))
		}
		if (channel.startsWith('trades:')) {
			return original(channel, deterministicTrade(data.symbol, tradeTick++))
		}
		if (channel === 'user:positions') {
			return original(channel, { positions: SEED_POSITIONS })
		}
		return original(channel, data)
	}
	logger.info('Demo WS streams stabilized (deterministic orderbook/trades/positions)')
}

async function main() {
	seedDemoData()
	await seedOrders()

	HyperliquidService.initialize()
	const ws = initWebSocket()
	stabilizeWebSocketStreams(ws)

	// hourly funding settlement (Hyperliquid cadence)
	FundingService.start()

	const app = createApp()
	app.listen(config.port, config.host, () => {
		logger.info(`DEMO HTTP server on http://${config.host}:${config.port} (fake DB, no MySQL needed)`)
		logger.info(`DEMO WS server on ws://${config.host}:${config.websocket.port}`)
		logger.info(`Demo wallet: ${WALLET}`)
	})
}

main().catch((e) => {
	logger.error('demo server failed', { error: e })
	process.exit(1)
})
