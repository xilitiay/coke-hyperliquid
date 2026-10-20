import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { UserModel } from '../src/models/User'
import { TradingPairModel } from '../src/models/TradingPair'
import { AssetModel } from '../src/models/Asset'

test('smoke: seeded pairs are queryable', async () => {
	seedDefaults()
	const pairs = await TradingPairModel.findAll()
	assert.equal(pairs.length, 4)
	const btc = await TradingPairModel.findBySymbol('BTC-PERP')
	assert.equal(btc?.type, 'PERPETUAL')
	assert.equal(await TradingPairModel.existsBySymbol('BTC-PERP'), true)
	assert.equal(await TradingPairModel.existsBySymbol('DOGE-PERP'), false)
})

test('smoke: user create/find round-trip through the fake db', async () => {
	seedDefaults()
	const user = await UserModel.create('0xABCDEF')
	assert.ok(user.id > 0)
	const found = await UserModel.findById(user.id)
	assert.equal(found?.walletAddress, '0xabcdef')
	const byWallet = await UserModel.findByWalletAddress('0xABCDEF')
	assert.equal(byWallet?.id, user.id)
})

test('smoke: asset lock/unlock transactions', async () => {
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: 1, wallet_address: '0xabc', email: null, google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
		assets: [{ id: 1, user_id: 1, asset: 'USDC', free: '1000', locked: '0', created_at: new Date(), updated_at: new Date() }],
	})
	await AssetModel.lock(1, 'USDC', '400')
	let a = await AssetModel.findByUserAndAsset(1, 'USDC')
	assert.equal(a?.free, '600.00000000')
	assert.equal(a?.locked, '400.00000000')
	await AssetModel.unlock(1, 'USDC', '100')
	a = await AssetModel.findByUserAndAsset(1, 'USDC')
	assert.equal(a?.free, '700.00000000')
	assert.equal(a?.locked, '300.00000000')
	await assert.rejects(() => AssetModel.lock(1, 'USDC', '999999'), /Insufficient balance/)
})
