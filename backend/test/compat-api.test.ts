import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { Wallet } from 'ethers'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import createApp from '../src/app'
import {
	HL_EXCHANGE_DOMAIN,
	ORDER_ACTION_TYPES,
	buildOrderActionValue,
} from '../src/utils/signature'

const WALLET = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') // anvil #1
const USER = 1
const now = new Date()

let server: Server
let base: string
let token: string

before(async () => {
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [
			{ id: USER, wallet_address: WALLET.address, email: 't@t.t', google_id: null, name: null, avatar: null, created_at: now, updated_at: now },
		],
		assets: [
			{ id: 1, user_id: USER, asset: 'USDC', free: '100000', locked: '0', created_at: now, updated_at: now },
			{ id: 2, user_id: USER, asset: 'BTC', free: '0.5', locked: '0', created_at: now, updated_at: now },
		],
		positions: [
			{
				position_id: 'p1', user_id: USER, symbol: 'BTC-PERP', side: 'LONG',
				quantity: '0.25000000', entry_price: '60000.00000000', mark_price: '61000.00000000',
				liquidation_price: '48000.00000000', leverage: 10, margin: '1525.00000000',
				unrealized_pnl: '250.00000000', realized_pnl: '0.00000000', margin_mode: 'CROSS',
				created_at: now, updated_at: now,
			},
		],
	})

	const app = createApp()
	await new Promise<void>((resolve) => {
		server = app.listen(0, '127.0.0.1', () => resolve())
	})
	const addr = server.address()
	const port = typeof addr === 'object' && addr ? addr.port : 0
	base = `http://127.0.0.1:${port}`

	// log in to obtain a session token
	const challenge = await fetch(`${base}/api/auth/challenge`).then((r) => r.json() as Promise<any>)
	const message = challenge.data.message as string
	const signature = await WALLET.signMessage(message)
	const loginRes = await fetch(`${base}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ walletAddress: WALLET.address, signature, message }),
	}).then((r) => r.json() as Promise<any>)
	token = loginRes.data.token.token as string
})

after(() => {
	server?.close()
})

const post = (p: string, body: any = {}, headers: Record<string, string> = {}) =>
	fetch(base + p, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	}).then(async (r) => ({ status: r.status, body: await r.json() }))

const authHeaders = () => ({ Authorization: `Bearer ${token}` })

/* ------------------------------- /info ---------------------------------- */

test('POST /info {type:"meta"} returns the perpetual universe with wire names', async () => {
	const res = await post('/info', { type: 'meta' })
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body.universe))
	// fake stubs universe as [{name:'BTC'},{name:'ETH'}] — wire names stay bare
	const names = res.body.universe.map((u: any) => u.name)
	assert.ok(names.includes('BTC'))
	assert.ok(names.includes('ETH'))
	assert.equal(typeof res.body.universe[0].szDecimals, 'number')
})

test('POST /info {type:"allMids"} returns a coin→price map', async () => {
	const res = await post('/info', { type: 'allMids' })
	assert.equal(res.status, 200)
	assert.equal(typeof res.body.BTC, 'string')
	assert.equal(typeof res.body.ETH, 'string')
})

test('POST /info {type:"spotMeta"} returns HIP-2 tokens and universe', async () => {
	const res = await post('/info', { type: 'spotMeta' })
	assert.equal(res.status, 200)
	assert.ok(Array.isArray(res.body.tokens))
	assert.ok(Array.isArray(res.body.universe))
	const usdc = res.body.tokens[0]
	assert.equal(usdc.name, 'USDC')
	assert.equal(usdc.index, 0)
	// HIP-2 asset ids start at 10000
	assert.ok(res.body.universe.every((u: any) => u._assetId >= 10000))
});

test('POST /info {type:"l2Book"} returns [px, sz, n] wire levels', async () => {
	const res = await post('/info', { type: 'l2Book', coin: 'BTC' })
	assert.equal(res.status, 200)
	assert.equal(res.body.coin, 'BTC')
	const [bids, asks] = res.body.levels
	assert.ok(bids.length > 0 && asks.length > 0)
	assert.equal(bids[0].length, 3) // [px, sz, n]
	assert.equal(typeof bids[0][0], 'string')
});

test('POST /info {type:"clearinghouseState"} returns HL-shaped positions', async () => {
	const res = await post('/info', { type: 'clearinghouseState', user: WALLET.address })
	assert.equal(res.status, 200)
	assert.ok(parseFloat(res.body.marginSummary.accountValue) > 0)
	const pos = res.body.assetPositions[0]
	assert.equal(pos.position.coin, 'BTC') // wire name, not "BTC-PERP"
	assert.equal(pos.position.szi, '0.25000000')
	assert.equal(pos.position.leverage.type, 'cross')
});

test('POST /info unknown type → 400', async () => {
	const res = await post('/info', { type: 'nope' })
	assert.equal(res.status, 400)
	assert.match(String(res.body.error), /Unknown info type/)
});

/* ------------------------------ /exchange -------------------------------- */

test('in-process round-trip: sign then verifyOrderActionSignature', async () => {
	const { verifyOrderActionSignature } = await import('../src/utils/signature')
	const nonce = 1792379103970
	const signature = await WALLET.signTypedData(
		HL_EXCHANGE_DOMAIN,
		ORDER_ACTION_TYPES,
		buildOrderActionValue({ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', price: 60000, quantity: 0.2, reduceOnly: false, postOnly: false, nonce })
	)
	const ok = await verifyOrderActionSignature(
		USER,
		{ symbol: 'BTC-PERP', side: 'BUY', type: 'LIMIT', price: 60000, quantity: 0.2, reduceOnly: false, postOnly: false, nonce },
		signature
	)
	assert.equal(ok, true, 'in-process EIP-712 round-trip must verify')
});

test('POST /exchange without a session → 401 (middleware error envelope)', async () => {
	const res = await post('/exchange', { action: { type: 'order' }, signature: '0xdead' })
	assert.equal(res.status, 401)
	// auth middleware rejects before the controller runs → standard error envelope
	assert.ok(res.body.error || res.body.status === 'err')
});

test('POST /exchange order: valid EIP-712 signature → ok + filled envelope', async () => {
	const nonce = Date.now()
	// MARKET fills immediately against the stubbed ticker (61000)
	const action = {
		type: 'order',
		symbol: 'BTC-PERP',
		side: 'BUY',
		orderType: 'MARKET',
		quantity: 0.2,
		reduceOnly: false,
		postOnly: false,
	}
	// Sign exactly what the controller verifies: the action's semantic fields,
	// with the order TYPE taken from action.orderType (not action.type).
	const signature = await WALLET.signTypedData(
		HL_EXCHANGE_DOMAIN,
		ORDER_ACTION_TYPES,
		buildOrderActionValue({
			symbol: action.symbol,
			side: action.side,
			type: action.orderType,
			price: undefined,
			quantity: action.quantity,
			reduceOnly: action.reduceOnly,
			postOnly: action.postOnly,
			nonce,
		})
	)
	const res = await post('/exchange', { action, signature, nonce }, authHeaders())
	assert.equal(res.status, 200)
	assert.equal(res.body.status, 'ok')
	assert.equal(res.body.response.type, 'order')
	const st = res.body.response.data.statuses[0]
	assert.ok(st.filled, 'expected a filled status envelope')
	assert.equal(st.filled.totalSz, '0.20000000') // engine stores 8-dp decimals
});

test('POST /exchange order: LIMIT away from market → resting envelope', async () => {
	const nonce = Date.now()
	const action = {
		type: 'order',
		symbol: 'BTC-PERP',
		side: 'BUY',
		orderType: 'LIMIT',
		price: 58000,
		quantity: 0.1,
		reduceOnly: false,
		postOnly: false,
	}
	const signature = await WALLET.signTypedData(
		HL_EXCHANGE_DOMAIN,
		ORDER_ACTION_TYPES,
		buildOrderActionValue({
			symbol: action.symbol,
			side: action.side,
			type: action.orderType,
			price: action.price,
			quantity: action.quantity,
			reduceOnly: action.reduceOnly,
			postOnly: action.postOnly,
			nonce,
		})
	)
	const res = await post('/exchange', { action, signature, nonce }, authHeaders())
	assert.equal(res.status, 200)
	const st = res.body.response.data.statuses[0]
	assert.ok(st.resting, 'a non-crossing limit must rest, not fill')
});

test('POST /exchange order: forged signature → 401 err', async () => {
	const res = await post(
		'/exchange',
		{
			action: { type: 'order', symbol: 'BTC-PERP', side: 'BUY', orderType: 'LIMIT', price: 60000, quantity: 0.2 },
			signature: '0xdeadbeef',
			nonce: Date.now(),
		},
		authHeaders()
	)
	assert.equal(res.status, 401)
	assert.equal(res.body.status, 'err')
});

test('POST /exchange unknown action type → 400 err', async () => {
	const nonce = Date.now()
	const action = { type: 'vaultTransfer', amount: '1' }
	const types = {
		Action: [
			{ name: 'type', type: 'string' },
			{ name: 'amount', type: 'string' },
			{ name: 'nonce', type: 'uint64' },
		],
	}
	const signature = await WALLET.signTypedData(
		HL_EXCHANGE_DOMAIN,
		types,
		{ type: action.type, amount: action.amount, nonce }
	)
	const res = await post('/exchange', { action, signature, nonce }, authHeaders())
	assert.equal(res.status, 400)
	assert.equal(res.body.status, 'err')
});
