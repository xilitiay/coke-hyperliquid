import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { setTickerPrice, resetTickerPrices } from './helpers/fake-hyperliquid'
import { FundingService } from '../src/services/FundingService'
import { PositionModel } from '../src/models/Position'
import { AssetModel } from '../src/models/Asset'

const USER = 1
const now = new Date()

function seedPositions() {
	resetTickerPrices()
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: USER, wallet_address: null, email: 'f@f.f', google_id: null, name: null, avatar: null, created_at: now, updated_at: now }],
		assets: [
			{ id: 1, user_id: USER, asset: 'USDC', free: '10000', locked: '0', created_at: now, updated_at: now },
		],
		positions: [
			{
				// 0.25 BTC @ mark 61000 → notional 15250; LONG pays funding
				position_id: 'p-long', user_id: USER, symbol: 'BTC-PERP', side: 'LONG',
				quantity: '0.25000000', entry_price: '60000.00000000', mark_price: '61000.00000000',
				liquidation_price: '48000.00000000', leverage: 10, margin: '1525.00000000',
				unrealized_pnl: '250.00000000', realized_pnl: '0.00000000', margin_mode: 'CROSS',
				created_at: now, updated_at: now,
			},
			{
				// 2 ETH @ mark 3100 → notional 6200; SHORT receives funding
				position_id: 'p-short', user_id: USER, symbol: 'ETH-PERP', side: 'SHORT',
				quantity: '2.00000000', entry_price: '3150.00000000', mark_price: '3100.00000000',
				liquidation_price: '3800.00000000', leverage: 5, margin: '1260.00000000',
				unrealized_pnl: '100.00000000', realized_pnl: '0.00000000', margin_mode: 'CROSS',
				created_at: now, updated_at: now,
			},
		],
	})
}

test('funding settlement: LONG pays, SHORT receives, funding_rates written', async () => {
	seedPositions()
	// the stubbed funding rate is 0.0001 (1bp) hourly
	const settlements = await FundingService.settleAll()
	assert.equal(settlements.length, 2)

	const btc = settlements.find((s) => s.symbol === 'BTC-PERP')!
	// 15250 notional × 0.0001 = 1.525 paid by the long
	assert.ok(Math.abs(btc.totalUsdc - -1.525) < 1e-6, `expected -1.525, got ${btc.totalUsdc}`)

	const eth = settlements.find((s) => s.symbol === 'ETH-PERP')!
	// 6200 notional × 0.0001 = 0.62 received by the short
	assert.ok(Math.abs(eth.totalUsdc - 0.62) < 1e-6, `expected 0.62, got ${eth.totalUsdc}`)

	// balances moved: -1.525 + 0.62 = -0.905 net
	const usdc = (await AssetModel.findByUserAndAsset(USER, 'USDC'))!
	assert.ok(Math.abs(parseFloat(usdc.free) - (10000 - 0.905)) < 1e-6, `free=${usdc.free}`)

	// realized PnL absorbed the funding
	const long = (await PositionModel.findById('p-long'))!
	assert.ok(Math.abs(parseFloat(long.realizedPnl) - -1.525) < 1e-6)
	const short = (await PositionModel.findById('p-short'))!
	assert.ok(Math.abs(parseFloat(short.realizedPnl) - 0.62) < 1e-6)

	// the funding_rates table finally has writers
	const rates = fakeDb.table('funding_rates')
	assert.equal(rates.length, 2)
	assert.equal(rates[0].symbol, 'BTC-PERP')
	assert.equal(rates[0].rate, '0.0001')
});

test('funding settlement: no open positions → no-op', async () => {
	seedPositions()
	// close both positions (quantity 0)
	await PositionModel.close('p-long')
	await PositionModel.close('p-short')
	const settlements = await FundingService.settleAll()
	assert.equal(settlements.length, 0)
	assert.equal(fakeDb.table('funding_rates').length, 0)
});
