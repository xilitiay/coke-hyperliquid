import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { resetTickerPrices } from './helpers/fake-hyperliquid'
import { resetBooks } from '../src/services/MatchingEngine'
import { TradingService } from '../src/services/TradingService'
import { UserSettingsModel } from '../src/models/UserSettings'
import { PositionModel } from '../src/models/Position'

const USER = 1

function demoSignature(data: any): string {
	const { signature: _drop, ...rest } = data
	return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

function seedTrader() {
	resetTickerPrices()
	resetBooks()
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: USER, wallet_address: null, email: 's@s.s', google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
		assets: [{ id: 1, user_id: USER, asset: 'USDC', free: '100000', locked: '0', created_at: new Date(), updated_at: new Date() }],
	})
}

test('defaults: 10x CROSS when nothing is persisted', async () => {
	seedTrader()
	const s = await UserSettingsModel.get(USER)
	assert.equal(s.leverage, 10)
	assert.equal(s.marginMode, 'CROSS')
});

test('setLeverage persists and enforces the LIVE max (BTC 40x)', async () => {
	seedTrader()
	const ok = await TradingService.setLeverage(USER, 'BTC-PERP', 25)
	assert.equal(ok.leverage, 25)
	assert.equal(ok.maxLeverage, 40)
	assert.equal((await UserSettingsModel.get(USER)).leverage, 25)
	// above the live max → rejected
	await assert.rejects(
		() => TradingService.setLeverage(USER, 'BTC-PERP', 50),
		(err: any) => err.statusCode === 400 && /between 1 and 40/.test(err.message)
	)
	// spot rejected
	await assert.rejects(() => TradingService.setLeverage(USER, 'BTC/USDC', 5), (err: any) => err.statusCode === 400)
});

test('setMarginMode persists and validates', async () => {
	seedTrader()
	const r = await TradingService.setMarginMode(USER, 'BTC-PERP', 'ISOLATED')
	assert.equal(r.marginMode, 'ISOLATED')
	assert.equal((await UserSettingsModel.get(USER)).marginMode, 'ISOLATED')
	await assert.rejects(
		() => TradingService.setMarginMode(USER, 'BTC-PERP', 'WEIRD' as any),
		(err: any) => err.statusCode === 400
	)
});

test('order execution uses the persisted leverage for margin', async () => {
	seedTrader()
	await TradingService.setLeverage(USER, 'BTC-PERP', 20)
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	assert.equal(order.status, 'FILLED')
	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.leverage, 20)
	assert.equal(pos.marginMode, 'CROSS')
	// margin = 0.5 * 61000 / 20 = 1525
	assert.equal(pos.margin, '1525.00000000')
});

test('leverage is blocked while a position is open', async () => {
	seedTrader()
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	await TradingService.createOrder(USER, { ...req, signature: demoSignature(req) })
	await assert.rejects(
		() => TradingService.setLeverage(USER, 'BTC-PERP', 20),
		(err: any) => err.statusCode === 400 && /open positions/.test(err.message)
	)
});
