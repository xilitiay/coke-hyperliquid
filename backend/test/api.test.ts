import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import type { Server } from 'node:http'
import { Wallet } from 'ethers'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import createApp from '../src/app'
import { generateToken } from '../src/middleware/auth'
import { OrderModel } from '../src/models/Order'
import { AssetModel } from '../src/models/Asset'

const WALLET = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') // anvil #1

let server: Server
let base: string

before(async () => {
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 1, wallet_address: WALLET.address, email: 't@t.t', google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
		assets: [{ id: 1, user_id: 1, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() }],
	})
	const app = createApp()
	await new Promise<void>((resolve) => {
		server = app.listen(0, '127.0.0.1', () => resolve())
	})
	const addr = server.address()
	const port = typeof addr === 'object' && addr ? addr.port : 0
	base = `http://127.0.0.1:${port}`
})

after(() => {
	server?.close()
})

const get = (p: string, headers: Record<string, string> = {}) =>
	fetch(base + p, { headers }).then(async (r) => ({ status: r.status, body: await r.json() }))
const post = (p: string, body: any = {}, headers: Record<string, string> = {}) =>
	fetch(base + p, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	}).then(async (r) => ({ status: r.status, body: await r.json() }))

function demoSignature(data: any): string {
	const { signature: _drop, ...rest } = data
	return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

/**
 * The controller rebuilds the order request with a fixed key order
 * (symbol, side, type, price, quantity — undefined fields are dropped by
 * JSON.stringify). The demo signature hashes that exact JSON, so it is
 * KEY-ORDER SENSITIVE: a client must serialize in the controller's order or
 * verification fails. This helper reproduces the controller's shape.
 */
function controllerShapedOrder(body: any): any {
	return { symbol: body.symbol, side: body.side, type: body.type, price: body.price, quantity: body.quantity }
}

async function login(): Promise<string> {
	const challenge = await get('/api/auth/challenge')
	const message = challenge.body.data.message as string
	const signature = await WALLET.signMessage(message)
	const res = await post('/api/auth/login', { walletAddress: WALLET.address, signature, message })
	assert.equal(res.status, 200)
	return res.body.data.token.token as string
}

/* -------------------------------- public ---------------------------------- */

test('GET /health returns ok', async () => {
	const r = await get('/health')
	assert.equal(r.status, 200)
	assert.equal(r.body.status, 'ok')
});

test('GET /api/market/pairs lists the four seeded pairs', async () => {
	const r = await get('/api/market/pairs')
	assert.equal(r.status, 200)
	assert.equal(r.body.success, true)
	assert.equal(r.body.data.length, 4)
	const symbols = r.body.data.map((p: any) => p.symbol)
	assert.deepEqual(symbols.sort(), ['BTC-PERP', 'BTC/USDC', 'ETH-PERP', 'ETH/USDC'])
});

test('GET /api/market/pair/:symbol → 404 for unknown', async () => {
	const r = await get('/api/market/pair/DOGE-PERP')
	assert.equal(r.status, 404)
	assert.equal(r.body.success, false)
	assert.equal(r.body.error.code, 'MARKET_NOT_FOUND')
});

test('GET /api/market/ticker/:symbol serves the stubbed Hyperliquid price', async () => {
	const r = await get('/api/market/ticker/BTC-PERP')
	assert.equal(r.status, 200)
	assert.equal(r.body.data.lastPrice, '61000')
});

test('GET /api/auth/challenge returns a signable message', async () => {
	const r = await get('/api/auth/challenge')
	assert.equal(r.status, 200)
	assert.match(r.body.data.message, /Hyperliquid Clone/)
	assert.ok(r.body.data.timestamp > 0)
});

test('unknown route → 404 envelope', async () => {
	const r = await get('/api/nope')
	assert.equal(r.status, 404)
	assert.equal(r.body.success, false)
});

/* --------------------------------- auth ----------------------------------- */

test('wallet login end-to-end, then protected profile', async () => {
	const token = await login()
	const me = await get('/api/auth/profile', { authorization: `Bearer ${token}` })
	assert.equal(me.status, 200)
	assert.equal(me.body.data.walletAddress, WALLET.address)

	// forged signature is rejected
	const challenge = await get('/api/auth/challenge')
	const other = new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
	const bad = await post('/api/auth/login', {
		walletAddress: WALLET.address,
		signature: await other.signMessage(challenge.body.data.message),
		message: challenge.body.data.message,
	})
	assert.equal(bad.status, 401)
});

test('protected routes reject missing/invalid tokens with the error envelope', async () => {
	const none = await get('/api/account/balance')
	assert.equal(none.status, 401)
	assert.equal(none.body.success, false)
	assert.equal(none.body.error.code, 'UNAUTHORIZED')

	const bad = await get('/api/account/balance', { authorization: 'Bearer garbage' })
	assert.equal(bad.status, 401)
});

/* ------------------------------ trading flow ------------------------------ */

test('full trading flow: deposit → limit order → balance → positions → cancel-all', async () => {
	// Wallet-login users can never pass verifySignature's wallet branch (pinned
	// in utils.test.ts), so the trading flow runs as a no-wallet user with a
	// directly-issued JWT — the middleware and endpoints are exercised for real.
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [
			{ id: 1, wallet_address: WALLET.address, email: 't@t.t', google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() },
			{ id: 2, wallet_address: null, email: 'g@t.t', google_id: 'g1', name: null, avatar: null, created_at: new Date(), updated_at: new Date() },
		],
		assets: [{ id: 1, user_id: 2, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() }],
	})
	const token = generateToken(2, 'g@t.t')
	const auth = { authorization: `Bearer ${token}` }

	// deposit (demo endpoint) — response shape: { message, asset }
	const dep = await post('/api/account/deposit', { asset: 'USDC', amount: '50000' }, auth)
	assert.equal(dep.status, 200)
	assert.equal(dep.body.data.asset.free, '150000.00000000')

	// market order on BTC-PERP (0.1 BTC). The signature must be computed
	// over the controller-shaped JSON (see controllerShapedOrder).
	const orderReq = { symbol: 'BTC-PERP', side: 'BUY', type: 'MARKET', quantity: '0.1' }
	const order = await post('/api/trade/order', { ...orderReq, signature: demoSignature(controllerShapedOrder(orderReq)) }, auth)
	assert.equal(order.status, 201)
	assert.equal(order.body.success, true)
	assert.equal(order.body.data.status, 'FILLED')

	// balance reflects the fill (margin consumed, unused lock released).
	// Balance shape: { totalEquity, availableBalance, usedMargin, unrealizedPnl, assets }
	const bal = await get('/api/account/balance', auth)
	assert.equal(bal.status, 200)
	// locked 0.1*61000*1.01 = 6161; margin 610 consumed; 5551 released
	assert.equal(bal.body.data.availableBalance, (150000 - 610).toFixed(8))
	assert.equal(bal.body.data.usedMargin, '0.00000000')
	assert.equal(bal.body.data.unrealizedPnl, '0.00000000')

	// positions
	const pos = await get('/api/account/positions', auth)
	assert.equal(pos.status, 200)
	assert.equal(pos.body.data.length, 1)
	assert.equal(pos.body.data[0].symbol, 'BTC-PERP')
	assert.equal(pos.body.data[0].side, 'LONG')
	assert.equal(pos.body.data[0].entryPrice, '61000.00000000')

	// account summary aggregates
	const summary = await get('/api/account/summary', auth)
	assert.equal(summary.status, 200)
	assert.equal(summary.body.data.positions.length, 1)
	assert.equal(summary.body.data.openOrdersCount, 0)
	assert.ok(Number(summary.body.data.balance.usedMargin) >= 0)

	// market orders fill immediately — nothing rests via the API
	const open = await get('/api/trade/orders/open', auth)
	assert.equal(open.body.data.length, 0)

	// seed a resting order at the model layer, then cancel-all through the API
	await OrderModel.create({
		orderId: 'rest-1', userId: 2, symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT',
		price: '10000', quantity: '0.1', timeInForce: 'GTC', reduceOnly: false, postOnly: false, signature: 'x',
	})
	await AssetModel.lock(2, 'USDC', '1000')
	assert.equal((await get('/api/trade/orders/open', auth)).body.data.length, 1)

	const cancelAllRes = await fetch(base + '/api/trade/orders/all', { method: 'DELETE', headers: auth })
	assert.equal(cancelAllRes.status, 200)
	const cancelAllBody = await cancelAllRes.json()
	assert.equal(cancelAllBody.data.count, 1)
	const openAfter = await get('/api/trade/orders/open', auth)
	assert.equal(openAfter.body.data.length, 0)
});

test('wallet user can place orders with an EIP-191 signature over the payload', async () => {
	// re-seed the wallet user with funds
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 1, wallet_address: WALLET.address, email: 't@t.t', google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
		assets: [{ id: 1, user_id: 1, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() }],
	})
	const token = await login()
	const auth = { authorization: `Bearer ${token}` }
	// the wallet branch signs the controller-shaped payload WITHOUT the signature field
	const orderReq = { symbol: 'BTC-PERP', side: 'BUY', type: 'MARKET', quantity: '0.1' }
	const signature = await WALLET.signMessage(JSON.stringify(controllerShapedOrder(orderReq)))
	const r = await post('/api/trade/order', { ...orderReq, signature }, auth)
	assert.equal(r.status, 201)
	assert.equal(r.body.data.status, 'FILLED')
	const pos = await get('/api/account/positions', auth)
	assert.equal(pos.body.data.length, 1)
	assert.equal(pos.body.data[0].entryPrice, '61000.00000000')
});

test('order endpoint enforces validation and returns 400 envelopes', async () => {
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 2, wallet_address: null, email: 'g@t.t', google_id: 'g1', name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
		assets: [{ id: 1, user_id: 2, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() }],
	})
	const token = generateToken(2, 'g@t.t')
	const auth = { authorization: `Bearer ${token}` }
	const bad = { symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '0.5', signature: demoSignature(controllerShapedOrder({ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', quantity: '0.5' })) }
	const r = await post('/api/trade/order', bad, auth)
	assert.equal(r.status, 400)
	assert.equal(r.body.success, false)
	assert.equal(r.body.error.code, 'INVALID_ORDER')
});

test('deposit endpoint validates asset and amount', async () => {
	const token = await login()
	const auth = { authorization: `Bearer ${token}` }
	const badAsset = await post('/api/account/deposit', { asset: 'SHIB', amount: '100' }, auth)
	assert.equal(badAsset.status, 400)
	const badAmount = await post('/api/account/deposit', { asset: 'USDC', amount: '-5' }, auth)
	assert.equal(badAmount.status, 400)
});

test('email update endpoint validates format', async () => {
	// re-seed the wallet user (earlier tests reset the tables)
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 1, wallet_address: WALLET.address, email: 't@t.t', google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
		assets: [],
	})
	const token = await login()
	const auth = { authorization: `Bearer ${token}` }
	const bad = await fetch(base + '/api/auth/email', {
		method: 'PUT',
		headers: { 'content-type': 'application/json', ...auth },
		body: JSON.stringify({ email: 'nope' }),
	})
	assert.equal(bad.status, 400)
	const ok = await fetch(base + '/api/auth/email', {
		method: 'PUT',
		headers: { 'content-type': 'application/json', ...auth },
		body: JSON.stringify({ email: 'vip@example.com' }),
	})
	assert.equal(ok.status, 200)
	const user1 = fakeDb.table('users').find((u) => u.id === 1)
	assert.equal(user1.email, 'vip@example.com')
});
