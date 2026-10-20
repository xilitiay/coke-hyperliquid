import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Wallet } from 'ethers'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { verifySignature, verifyTypedDataSignature } from '../src/utils/signature'
import { sendSuccess, sendError, createError } from '../src/utils/response'
import { ApiError, ErrorCode } from '../src/types'

const WALLET = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') // anvil #1, public test key

function demoSignature(data: any): string {
	const { signature: _drop, ...rest } = data
	return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

function mockRes() {
	const captured: { status?: number; body?: any } = {}
	const res: any = {
		status(code: number) {
			captured.status = code
			return res
		},
		json(body: any) {
			captured.body = body
			return res
		},
	}
	return { res, captured }
}

/* ------------------------------ signature.ts ------------------------------ */

test('verifySignature: unknown user → false', async () => {
	seedDefaults()
	assert.equal(await verifySignature(999, { a: 1 }, 'x'), false)
})

test('verifySignature: no-wallet user uses the SHA-256 demo path', async () => {
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 1, wallet_address: null, email: 'a@b.c', google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
	})
	const data = { symbol: 'BTC-PERP', side: 'BUY', quantity: '0.01' }
	assert.equal(await verifySignature(1, data, demoSignature(data)), true)
	assert.equal(await verifySignature(1, data, 'deadbeef'), false)
})

test('verifySignature: wallet user signs the payload WITHOUT the signature field', async () => {
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 1, wallet_address: WALLET.address, email: null, google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
	})
	const data = { symbol: 'BTC-PERP', side: 'BUY', quantity: '0.01' }
	// the client signs the request minus the signature field — this verifies
	const sig = await WALLET.signMessage(JSON.stringify(data))
	assert.equal(await verifySignature(1, { ...data, signature: sig }, sig), true)
	// a self-referential signature (over the payload INCLUDING the signature) no longer passes
	const selfRef = await WALLET.signMessage(JSON.stringify({ ...data, signature: sig }))
	assert.equal(await verifySignature(1, { ...data, signature: selfRef }, selfRef), false)
	// a different signer is rejected
	const other = new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a') // anvil #2
	const wrong = await other.signMessage(JSON.stringify(data))
	assert.equal(await verifySignature(1, { ...data, signature: wrong }, wrong), false)
})

test('verifyTypedDataSignature: recovers a matching signer', async () => {
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 1, wallet_address: WALLET.address, email: null, google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
	})
	const domain = { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' }
	const types = { Order: [{ name: 'symbol', type: 'string' }, { name: 'qty', type: 'string' }] }
	const value = { symbol: 'BTC-PERP', qty: '0.01' }
	const sig = await WALLET.signTypedData(domain, types, value)
	assert.equal(await verifyTypedDataSignature(1, domain, types, value, sig), true)
	// wrong user (no wallet) → false
	fakeDb.table('users')[0].wallet_address = null
	assert.equal(await verifyTypedDataSignature(1, domain, types, value, sig), false)
})

/* ------------------------------- response.ts ------------------------------ */

test('sendSuccess wraps payload in the standard envelope', () => {
	const { res, captured } = mockRes()
	sendSuccess(res, { hello: 'world' })
	assert.equal(captured.status, 200)
	assert.equal(captured.body.success, true)
	assert.deepEqual(captured.body.data, { hello: 'world' })
	assert.ok(typeof captured.body.timestamp === 'number')
	// custom status code
	sendSuccess(res, { x: 1 }, 201)
	assert.equal(captured.status, 201)
})

test('sendError: ApiError uses its own code/status; generic errors map to 500', () => {
	const { res, captured } = mockRes()
	sendError(res, createError.notFound('Order not found'))
	assert.equal(captured.status, 404)
	assert.equal(captured.body.success, false)
	assert.equal(captured.body.error.code, ErrorCode.NOT_FOUND)
	assert.equal(captured.body.error.message, 'Order not found')

	sendError(res, new Error('boom'))
	assert.equal(captured.status, 500)
	assert.equal(captured.body.error.code, ErrorCode.INTERNAL_ERROR)
	assert.equal(captured.body.error.message, 'boom')

	sendError(res, new Error('boom'), 503)
	assert.equal(captured.status, 503)
})

test('createError shortcuts carry the documented codes and statuses', () => {
	const cases: [ApiError, number, string][] = [
		[createError.badRequest('bad'), 400, ErrorCode.INVALID_REQUEST],
		[createError.unauthorized(), 401, ErrorCode.UNAUTHORIZED],
		[createError.forbidden(), 403, ErrorCode.FORBIDDEN],
		[createError.notFound(), 404, ErrorCode.NOT_FOUND],
		[createError.invalidSignature(), 401, ErrorCode.INVALID_SIGNATURE],
		[createError.insufficientBalance(), 400, ErrorCode.INSUFFICIENT_BALANCE],
		[createError.invalidOrder('x'), 400, ErrorCode.INVALID_ORDER],
		[createError.marketNotFound('BTC-PERP'), 404, ErrorCode.MARKET_NOT_FOUND],
		[createError.rateLimitExceeded(), 429, ErrorCode.RATE_LIMIT_EXCEEDED],
		[createError.internal(), 500, ErrorCode.INTERNAL_ERROR],
	]
	for (const [err, status, code] of cases) {
		assert.equal(err.statusCode, status)
		assert.equal(err.code, code)
		assert.ok(err.message.length > 0)
	}
	// marketNotFound interpolates the symbol
	assert.match(createError.marketNotFound('ETH-PERP').message, /ETH-PERP/)
})
