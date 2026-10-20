import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { resetTickerPrices } from './helpers/fake-hyperliquid'
import { TradingService } from '../src/services/TradingService'
import { PositionModel } from '../src/models/Position'
import {
	HL_EXCHANGE_DOMAIN,
	ORDER_ACTION_TYPES,
	buildOrderActionValue,
} from '../src/utils/signature'

const USER = 1

/** A deterministic test wallet acting as the account's own signing key. */
const WALLET = new Wallet('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba')

function seedWalletTrader() {
	resetTickerPrices()
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [
			{
				id: USER,
				wallet_address: WALLET.address,
				email: 'w@w.w',
				google_id: null,
				name: null,
				avatar: null,
				created_at: new Date(),
				updated_at: new Date(),
			},
		],
		assets: [
			{ id: 1, user_id: USER, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() },
			{ id: 2, user_id: USER, asset: 'BTC', free: '0', locked: '0', created_at: new Date(), updated_at: new Date() },
		],
	})
}

/** Sign an order request exactly like the frontend TradeForm does. */
async function signEip712(req: any, signer: Wallet = WALLET, nonce = Date.now()) {
	const value = buildOrderActionValue({ ...req, nonce })
	const signature = await signer.signTypedData(HL_EXCHANGE_DOMAIN, ORDER_ACTION_TYPES, value)
	return { ...req, signature, signatureScheme: 'eip712' as const, nonce }
}

test('EIP-712: valid order-action signature from the account wallet fills the order', async () => {
	seedWalletTrader()
	// MARKET fills immediately against the stubbed ticker (61000); LIMIT would rest
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, await signEip712(req))

	assert.equal(order.status, 'FILLED')
	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.quantity, '0.50000000')
	assert.equal(pos.entryPrice, '61000.00000000')
})

test('EIP-712: signature from a different wallet → 401 INVALID_SIGNATURE', async () => {
	seedWalletTrader()
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.5', price: '61000' }
	const impostor = Wallet.createRandom()
	await assert.rejects(
		async () => TradingService.createOrder(USER, await signEip712(req, impostor)),
		(err: any) => err.statusCode === 401 && err.code === 'INVALID_SIGNATURE'
	)
	assert.equal(fakeDb.table('orders').length, 0)
})

test('EIP-712: tampering with the signed fields invalidates the signature', async () => {
	seedWalletTrader()
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.5', price: '61000' }
	const signed = await signEip712(req)
	// attacker inflates the quantity after signing
	await assert.rejects(
		() => TradingService.createOrder(USER, { ...signed, quantity: '100' }),
		(err: any) => err.statusCode === 401 && err.code === 'INVALID_SIGNATURE'
	)
})

test('EIP-712: a wallet-less session cannot use the eip712 scheme', async () => {
	resetTickerPrices()
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [
			{
				id: USER,
				wallet_address: null, // Google-login style session
				email: 'g@g.g',
				google_id: null,
				name: null,
				avatar: null,
				created_at: new Date(),
				updated_at: new Date(),
			},
		],
		assets: [
			{ id: 1, user_id: USER, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() },
			{ id: 2, user_id: USER, asset: 'BTC', free: '0', locked: '0', created_at: new Date(), updated_at: new Date() },
		],
	})
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'LIMIT' as const, quantity: '0.5', price: '61000' }
	await assert.rejects(
		async () => TradingService.createOrder(USER, await signEip712(req)),
		(err: any) => err.statusCode === 401 && err.code === 'INVALID_SIGNATURE'
	)
})

test('demo-sha256: wallet-less sessions keep the demo marker path working', async () => {
	resetTickerPrices()
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [
			{
				id: USER,
				wallet_address: null,
				email: 'g@g.g',
				google_id: null,
				name: null,
				avatar: null,
				created_at: new Date(),
				updated_at: new Date(),
			},
		],
		assets: [
			{ id: 1, user_id: USER, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() },
			{ id: 2, user_id: USER, asset: 'BTC', free: '0', locked: '0', created_at: new Date(), updated_at: new Date() },
		],
	})
	const crypto = await import('node:crypto')
	const req = {
		symbol: 'BTC-PERP',
		side: 'BUY' as const,
		type: 'MARKET' as const,
		quantity: '0.5',
		nonce: Date.now(),
		signatureScheme: 'demo-sha256' as const,
	}
	const { signature: _drop, ...rest } = req
	const signature = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
	const order = await TradingService.createOrder(USER, { ...req, signature })
	assert.equal(order.status, 'FILLED')
})
