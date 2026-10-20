import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { setTickerPrice, setTickerFailing, resetTickerPrices, tickerPrice } from './helpers/fake-hyperliquid'
import { TradingService } from '../src/services/TradingService'
import { OrderExecutionService } from '../src/services/OrderExecutionService'
import { resetBooks } from '../src/services/MatchingEngine'
import { OrderModel } from '../src/models/Order'
import { AssetModel } from '../src/models/Asset'
import { PositionModel } from '../src/models/Position'

const USER = 1

/** The demo (no-wallet) signature path: sha256 of the request minus the signature field. */
function demoSignature(data: any): string {
	const { signature: _drop, ...rest } = data
	return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

function seedTrader({ usdc = '100000', btc = '0' } = {}) {
	resetTickerPrices()
	resetBooks() // the in-memory CLOB is process state — wipe it between tests
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: USER, wallet_address: null, email: 't@t.t', google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
		assets: [
			{ id: 1, user_id: USER, asset: 'USDC', free: usdc, locked: '0', created_at: new Date(), updated_at: new Date() },
			{ id: 2, user_id: USER, asset: 'BTC', free: btc, locked: '0', created_at: new Date(), updated_at: new Date() },
		],
	})
}

async function assetOf(asset: string) {
	return (await AssetModel.findByUserAndAsset(USER, asset))!
}

/* --------------------- limit orders now REST (CLOB) ---------------------- */

test('limit perp BUY away from market: RESTS in the book, no position, notional stays locked', async () => {
	seedTrader()
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.5', price: '61000' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })

	// no crossing liquidity → the order rests instead of filling
	assert.equal(order.status, 'OPEN')
	assert.equal(order.filledQuantity, '0')
	assert.equal((await PositionModel.findByUserId(USER, 'BTC-PERP')).length, 0)

	// the full notional stays locked while resting
	const usdc = await assetOf('USDC')
	assert.equal(usdc.free, (100000 - 30500).toFixed(8))
	assert.equal(usdc.locked, '30500.00000000')
});

test('limit spot BUY: rests, USDC locked, no BTC credited', async () => {
	seedTrader()
	const req = { symbol: 'BTC/USDC', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.2', price: '61000' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'OPEN')
	const btc = await assetOf('BTC')
	const usdc = await assetOf('USDC')
	assert.equal(btc.free, '0') // seeded as '0', untouched
	assert.equal(usdc.free, (100000 - 12200).toFixed(8)) // 0.2*61000 locked
	assert.equal(usdc.locked, '12200.00000000')
});

test('limit spot SELL: rests, base BTC locked', async () => {
	seedTrader({ usdc: '0', btc: '1' })
	const req = { symbol: 'BTC/USDC', side: 'SELL' as const, type: 'LIMIT' as const, quantity: '0.4', price: '61000' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'OPEN')
	const btc = await assetOf('BTC')
	assert.equal(btc.free, '0.60000000') // 0.4 locked
	assert.equal(btc.locked, '0.40000000')
	assert.equal((await assetOf('USDC')).free, '0') // seeded as '0', untouched
});

test('resting perp bid is crossed by a market SELL: both fill, SHORT opens, trade recorded', async () => {
	seedTrader()
	// 1) rest a bid
	const bid = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.5', price: '61000' }
	const bidOrder = await TradingService.createOrder(USER, { ...bid, signature: demoSignature(bid) })
	assert.equal(bidOrder.status, 'OPEN')

	// 2) aggressive market SELL crosses the resting bid at 61000 (price improvement vs 61000 ticker)
	const ask = { symbol: 'BTC-PERP', side: 'SELL' as const, type: 'MARKET' as const, quantity: '0.5' }
	const askOrder = await TradingService.createOrder(USER, { ...ask, signature: demoSignature(ask) })
	assert.equal(askOrder.status, 'FILLED')

	// the resting bid is now filled too
	const bidAfter = await OrderModel.findById(bidOrder.orderId)
	assert.equal(bidAfter?.status, 'FILLED')
	assert.equal(bidAfter?.filledQuantity, '0.50000000')

	// both sides get filled: the aggressor opens a SHORT at the maker price,
	// and the resting bid opens its own LONG (CLOB fills both counterparties)
	const positions = await PositionModel.findByUserId(USER, 'BTC-PERP')
	const short = positions.find((p) => p.side === 'SHORT')
	const long = positions.find((p) => p.side === 'LONG')
	assert.ok(short, 'aggressing market SELL must open a SHORT')
	assert.equal(short!.quantity, '0.50000000')
	assert.equal(short!.entryPrice, '61000.00000000')
	assert.ok(long, 'the resting bid must open its LONG')
	assert.equal(long!.quantity, '0.50000000')
	assert.equal(long!.entryPrice, '61000.00000000')

	// a trade row was written (the trades table used to be write-less)
	const trades = fakeDb.table('trades')
	assert.equal(trades.length, 1)
	assert.equal(trades[0].symbol, 'BTC-PERP')
	assert.equal(trades[0].price, '61000.00000000')
	assert.equal(trades[0].quantity, '0.50000000')

	// both sides' locks are fully consumed: maker margin 3050 + aggressor margin 3050
	const usdc = await assetOf('USDC')
	assert.equal(usdc.locked, '0.00000000')
	assert.equal(usdc.free, (100000 - 6100).toFixed(8))
});

test('resting spot bid is crossed by a market SELL: USDC proceeds credited, trade recorded', async () => {
	seedTrader({ btc: '1' }) // the market SELL must lock base BTC
	const bid = { symbol: 'BTC/USDC', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.2', price: '61000' }
	await TradingService.createOrder(USER, { ...bid, signature: demoSignature(bid) })
	const ask = { symbol: 'BTC/USDC', side: 'SELL' as const, type: 'MARKET' as const, quantity: '0.2' }
	const askOrder = await TradingService.createOrder(USER, { ...ask, signature: demoSignature(ask) })
	assert.equal(askOrder.status, 'FILLED')
	// aggressor receives 0.2*61000 = 12200 USDC; the maker's 12200 lock was consumed
	assert.equal((await assetOf('USDC')).free, (100000 - 12200 + 12200).toFixed(8))
	assert.equal((await assetOf('BTC')).free, '1.00000000') // 0.2 sold by aggressor, 0.2 received by maker
	assert.equal(fakeDb.table('trades').length, 1)
});

test('second market order on the same side increases the position at the weighted entry', async () => {
	seedTrader()
	const a = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	setTickerPrice('BTC', '61000')
	await TradingService.createOrder(USER, { ...a, signature: demoSignature(a) })
	const b = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	setTickerPrice('BTC', '63000')
	await TradingService.createOrder(USER, { ...b, signature: demoSignature(b) })
	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.quantity, '1.00000000')
	assert.equal(pos.entryPrice, '62000.00000000') // (0.5*61000 + 0.5*63000)/1
});

/* ------------------------- market orders (fixed) -------------------------- */
// calculateRequiredBalance now estimates the market price (Hyperliquid ticker
// with hardcoded fallback) and locks quote/base per side, so market orders
// fill end-to-end with a 1% buffer left in `locked`.

test('market perp BUY: locks price-estimated notional, fills at the live price', async () => {
	seedTrader()
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'FILLED')

	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.quantity, '0.50000000')
	assert.equal(pos.entryPrice, '61000.00000000')
	assert.equal(pos.margin, '3050.00000000')

	const usdc = await assetOf('USDC')
	// locked 0.5*61000*1.01 = 30805; margin 3050 consumed; the unused 27755
	// (incl. the 1% slippage buffer) is released back to free
	assert.equal(usdc.free, '96950.00000000')
	assert.equal(usdc.locked, '0.00000000')
})

test('market spot BUY: locks price-estimated USDC, credits BTC', async () => {
	seedTrader()
	const req = { symbol: 'BTC/USDC', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.2' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'FILLED')
	assert.equal((await assetOf('BTC')).free, '0.20000000')
	const usdc = await assetOf('USDC')
	// locked 0.2*61000*1.01 = 12322; paid 12200; the 122 buffer is released
	assert.equal(usdc.free, '87800.00000000')
	assert.equal(usdc.locked, '0.00000000')
})

test('market spot SELL: locks base BTC, credits USDC', async () => {
	seedTrader({ usdc: '0', btc: '1' })
	const req = { symbol: 'BTC/USDC', side: 'SELL' as const, type: 'MARKET' as const, quantity: '0.4' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'FILLED')
	const btc = await assetOf('BTC')
	const usdc = await assetOf('USDC')
	assert.equal(btc.free, '0.60000000') // 0.404 locked, 0.4 deducted
	assert.equal(btc.locked, '0.00000000') // 0.004 buffer released
	assert.equal(usdc.free, '24400.00000000') // 0.4 * 61000 proceeds
})

test('market order margin check uses the estimated price (1 BTC ≠ 1.01 USDC)', async () => {
	seedTrader({ usdc: '10' })
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '1' }
	// 1 BTC ≈ 61000 → requires 61610 USDC > 10 → rejected before anything is locked
	await assert.rejects(
		() => TradingService.createOrder(USER, { ...req, signature: demoSignature(req) }),
		(err: any) => err.statusCode === 400 && err.code === 'INSUFFICIENT_BALANCE'
	)
	assert.equal(fakeDb.table('orders').length, 0)
	assert.equal((await assetOf('USDC')).locked, '0')
})

test('market perp SELL: margin is USDC (locks quote, not base) and opens a SHORT', async () => {
	seedTrader()
	const req = { symbol: 'BTC-PERP', side: 'SELL' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'FILLED')
	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.side, 'SHORT')
	assert.equal(pos.quantity, '0.50000000')
	assert.equal(pos.entryPrice, '61000.00000000')
	// same quote-side accounting as a BUY: locked 30805, margin 3050 consumed,
	// the unused 27755 (incl. buffer) released
	const usdc = await assetOf('USDC')
	assert.equal(usdc.free, '96950.00000000')
	assert.equal(usdc.locked, '0.00000000')
})

test('market order falls back to 98000 when the ticker is unavailable', async () => {
	seedTrader()
	setTickerFailing(true)
	try {
		const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.1' }
		const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
		assert.equal(order.status, 'FILLED')
	} finally {
		setTickerFailing(false)
	}
	// locked AND executed at the same fallback price: lock = 0.1*98000*1.01 = 9898,
	// margin 980 consumed, the unused 8918 released
	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.entryPrice, '98000.00000000')
	const usdc = await assetOf('USDC')
	assert.equal(usdc.free, (100000 - 980).toFixed(8))
	assert.equal(usdc.locked, '0.00000000')
})

/* --------------------------- createOrder: rejections ----------------------- */

test('unknown market → 404 MARKET_NOT_FOUND', async () => {
	seedTrader()
	const request = { symbol: 'DOGE-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.5', price: '100' }
	await assert.rejects(
		() => TradingService.createOrder(USER, { ...request, signature: demoSignature(request) }),
		(err: any) => err.statusCode === 404 && err.code === 'MARKET_NOT_FOUND'
	)
})

test('invalid signature → 401 INVALID_SIGNATURE, nothing locked or persisted', async () => {
	seedTrader()
	await assert.rejects(
		() => TradingService.createOrder(USER, { symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '0.5', price: '100', signature: 'forged' }),
		(err: any) => err.statusCode === 401 && err.code === 'INVALID_SIGNATURE'
	)
	assert.equal(fakeDb.table('orders').length, 0)
	assert.equal((await assetOf('USDC')).locked, '0')
})

test('quantity below min / above max / non-numeric → 400 INVALID_ORDER', async () => {
	seedTrader()
	const bad: any[] = [
		{ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '0.00001', price: '100' }, // < 0.0001 min
		{ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '2000', price: '100' }, // > 1000 max
		{ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: 'abc', price: '100' },
		{ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '-1', price: '100' },
	]
	for (const request of bad) {
		await assert.rejects(
			() => TradingService.createOrder(USER, { ...request, signature: demoSignature(request) }),
			(err: any) => err.statusCode === 400 && err.code === 'INVALID_ORDER',
			JSON.stringify(request)
		)
	}
})

test('limit order without price / bad tick alignment → 400', async () => {
	seedTrader()
	await assert.rejects(
		() => TradingService.createOrder(USER, { symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '0.5', signature: demoSignature({ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '0.5' }) }),
		(err: any) => err.statusCode === 400 && /Price is required/.test(err.message)
	)
	// price not a multiple of tickSize 0.01 (kept within the 5-sig-fig limit
	// so the TICK rule is what fires: 5,0,0,0,5 = 5 sig figs)
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.5', price: '10.005' }
	await assert.rejects(
		() => TradingService.createOrder(USER, { ...req, signature: demoSignature(req) }),
		(err: any) => err.statusCode === 400 && /tick size/.test(err.message)
	)
})

test('quantity with more decimals than szDecimals → 400 (rejected, not rounded)', async () => {
	seedTrader()
	// ETH szDecimals = 4 in the stubbed universe; 5 decimals must be rejected
	const req = { symbol: 'ETH-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.12345', price: '3100' }
	await assert.rejects(
		() => TradingService.createOrder(USER, { ...req, signature: demoSignature(req) }),
		(err: any) => err.statusCode === 400 && /decimals/.test(err.message)
	)
	// BTC szDecimals = 5 → 4 decimals is fine (order rests, no rejection)
	const ok = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.1234', price: '61000' }
	const order = await TradingService.createOrder(USER, { ...ok, signature: demoSignature(ok) })
	assert.equal(order.status, 'OPEN')
})

test('stop order without stopPrice → 400', async () => {
	seedTrader()
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'STOP_LIMIT' as const, quantity: '0.5', price: '50000' }
	await assert.rejects(
		() => TradingService.createOrder(USER, { ...req, signature: demoSignature(req) }),
		(err: any) => err.statusCode === 400 && /Stop price is required/.test(err.message)
	)
})

test('insufficient balance on a limit order → 400 INSUFFICIENT_BALANCE, nothing persisted', async () => {
	seedTrader({ usdc: '10' })
	// limit BUY 10 BTC @ 50000 needs 500000 USDC > 10
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '10', price: '50000' }
	await assert.rejects(
		() => TradingService.createOrder(USER, { ...req, signature: demoSignature(req) }),
		(err: any) => err.statusCode === 400 && err.code === 'INSUFFICIENT_BALANCE'
	)
	assert.equal(fakeDb.table('orders').length, 0)
})

/* ------------------------------- cancelOrder ------------------------------- */

test('cancelOrder: unknown order → 404', async () => {
	seedTrader()
	await assert.rejects(() => TradingService.cancelOrder(USER, 'nope'), (err: any) => err.statusCode === 404)
})

test("cancelOrder: another user's order → 403; filled order → 400", async () => {
	seedTrader()
	// MARKET fills immediately (LIMIT now rests) → filled orders cannot be cancelled
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'FILLED')
	await assert.rejects(() => TradingService.cancelOrder(USER, order.orderId), (err: any) => err.statusCode === 400)
	// ownership check: craft an order owned by user 2
	const other = '22222222-2222-2222-2222-222222222222'
	await OrderModel.create({
		orderId: other, userId: 2, symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT',
		price: '10000', quantity: '0.1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	await assert.rejects(() => TradingService.cancelOrder(USER, other), (err: any) => err.statusCode === 403)
})

test('cancelOrder: open order unlocks the balance and flips to CANCELLED', async () => {
	seedTrader()
	const oid = '11111111-1111-1111-1111-111111111111'
	await OrderModel.create({
		orderId: oid, userId: USER, symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT',
		price: '10000', quantity: '0.5', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	await AssetModel.lock(USER, 'USDC', '5000')
	const before = await assetOf('USDC')
	await TradingService.cancelOrder(USER, oid)
	const after = await assetOf('USDC')
	assert.equal(after.free, (parseFloat(before.free) + 5000).toFixed(8))
	assert.equal(after.locked, (parseFloat(before.locked) - 5000).toFixed(8))
	const order = await OrderModel.findById(oid)
	assert.equal(order?.status, 'CANCELLED')
})

test('cancelAllOrders: cancels every open order and unlocks each', async () => {
	seedTrader()
	for (let i = 0; i < 3; i++) {
		await OrderModel.create({
			orderId: `oid-${i}`, userId: USER, symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT',
			price: '10000', quantity: '0.1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
		})
		await AssetModel.lock(USER, 'USDC', '1000')
	}
	const before = await assetOf('USDC')
	const count = await TradingService.cancelAllOrders(USER)
	assert.equal(count, 3)
	const after = await assetOf('USDC')
	assert.equal(after.free, (parseFloat(before.free) + 3000).toFixed(8))
	assert.equal(after.locked, '0.00000000')
	// symbol filter
	await OrderModel.create({
		orderId: 'oid-eth', userId: USER, symbol: 'ETH-PERP', side: 'BUY', type: 'LIMIT',
		price: '1000', quantity: '1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	assert.equal(await TradingService.cancelAllOrders(USER, 'ETH-PERP'), 1)
})

/* -------------------------------- queries ---------------------------------- */

test('getOpenOrders / getOrderHistory / getOrder', async () => {
	seedTrader()
	await OrderModel.create({
		orderId: 'h1', userId: USER, symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT',
		price: '10000', quantity: '0.1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	await OrderModel.create({
		orderId: 'h2', userId: USER, symbol: 'ETH-PERP', side: 'SELL', type: 'LIMIT',
		price: '2000', quantity: '1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	const open = await TradingService.getOpenOrders(USER)
	assert.equal(open.length, 2)
	const perpOnly = await TradingService.getOpenOrders(USER, 'BTC-PERP')
	assert.equal(perpOnly.length, 1)
	const history = await TradingService.getOrderHistory(USER, 10, 0)
	assert.equal(history.length, 2)
	const one = await TradingService.getOrder(USER, 'h1')
	assert.equal(one.orderId, 'h1')
	await assert.rejects(() => TradingService.getOrder(USER, 'missing'), (err: any) => err.statusCode === 404)
})

/* ------------------------------- setLeverage ------------------------------- */

test('setLeverage: spot rejected, range enforced, blocked with open positions', async () => {
	seedTrader()
	await assert.rejects(() => TradingService.setLeverage(USER, 'BTC/USDC', 10), (err: any) => err.statusCode === 400)
	await assert.rejects(() => TradingService.setLeverage(USER, 'BTC-PERP', 0), (err: any) => err.statusCode === 400)
	await assert.rejects(() => TradingService.setLeverage(USER, 'BTC-PERP', 101), (err: any) => err.statusCode === 400)
	await assert.rejects(() => TradingService.setLeverage(USER, 'DOGE-PERP', 10), (err: any) => err.statusCode === 404)
	// no position → ok (no-op in this demo)
	await TradingService.setLeverage(USER, 'BTC-PERP', 20)
	// with an open position → blocked
	await PositionModel.create({
		positionId: 'p1', userId: USER, symbol: 'BTC-PERP', side: 'LONG',
		quantity: '0.1', entryPrice: '61000', leverage: 10, margin: '610', marginMode: 'CROSS',
	})
	await assert.rejects(() => TradingService.setLeverage(USER, 'BTC-PERP', 20), (err: any) => err.statusCode === 400 && /open positions/.test(err.message))
})

/* -------------------------- OrderExecutionService -------------------------- */

test('executeOrder: market order falls back to 98000/3500 when Hyperliquid is unreachable', async () => {
	seedTrader()
	// place + fund a market order directly at the model layer
	await OrderModel.create({
		orderId: 'fb-1', userId: USER, symbol: 'BTC-PERP', side: 'BUY', type: 'MARKET',
		quantity: '0.1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	await AssetModel.lock(USER, 'USDC', '10000') // ample locked funds
	setTickerFailing(true)
	try {
		const order = (await OrderModel.findById('fb-1'))!
		await OrderExecutionService.executeOrder(order)
	} finally {
		setTickerFailing(false)
	}
	// executed at the hardcoded BTC fallback price
	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.entryPrice, '98000.00000000')
	assert.equal(pos.margin, '980.00000000') // 0.1*98000/10
	assert.equal((await OrderModel.findById('fb-1'))?.status, 'FILLED')
})

test('executeOrder: ETH fallback price is 3500', async () => {
	seedTrader()
	await OrderModel.create({
		orderId: 'fb-2', userId: USER, symbol: 'ETH-PERP', side: 'BUY', type: 'MARKET',
		quantity: '1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	await AssetModel.lock(USER, 'USDC', '10000')
	setTickerFailing(true)
	try {
		const order = (await OrderModel.findById('fb-2'))!
		await OrderExecutionService.executeOrder(order)
	} finally {
		setTickerFailing(false)
	}
	const pos = (await PositionModel.findByUserId(USER, 'ETH-PERP'))[0]
	assert.equal(pos.entryPrice, '3500.00000000')
})

test('executeOrder: failure marks the order CANCELLED and rethrows', async () => {
	seedTrader()
	const order = {
		orderId: 'fail-1', userId: USER, symbol: 'DOGE-PERP', side: 'BUY' as const, type: 'MARKET' as const,
		quantity: '1', filledQuantity: '0', remainingQuantity: '1', status: 'OPEN' as const,
		timeInForce: 'GTC' as const, reduceOnly: false, postOnly: false, signature: 'x',
		createdAt: new Date(), updatedAt: new Date(),
	}
	await OrderModel.create({
		orderId: order.orderId, userId: USER, symbol: 'DOGE-PERP', side: 'BUY', type: 'MARKET',
		quantity: '1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	await assert.rejects(() => OrderExecutionService.executeOrder(order as any), (err: any) => err.statusCode === 404)
	const after = await OrderModel.findById('fail-1')
	assert.equal(after?.status, 'CANCELLED')
})

test('tickerPrice helper reflects overrides and resets', async () => {
	resetTickerPrices()
	assert.equal(tickerPrice('BTC'), '61000')
	setTickerPrice('BTC', '62000')
	assert.equal(tickerPrice('BTC'), '62000')
	resetTickerPrices()
	assert.equal(tickerPrice('BTC'), '61000')
})
