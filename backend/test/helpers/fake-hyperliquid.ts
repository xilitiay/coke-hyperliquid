/**
 * Stubs for HyperliquidService so tests never touch the network.
 *
 * Patches the static methods of the real class. getTicker returns a
 * deterministic price that individual tests can override via
 * `setTickerPrice('BTC', 61000)`.
 *
 * Usage: import './helpers/fake-hyperliquid' BEFORE importing services.
 */

import { createRequire } from 'node:module'

// NB: __filename (not import.meta.url) — CJS-compiled by ts-node.
const require_ = createRequire(__filename)

const tickerPrices: Record<string, string> = {
	BTC: '61000',
	ETH: '3100',
}

let failTicker = false

export function setTickerPrice(coin: string, price: string) {
	tickerPrices[coin] = price
}

export function resetTickerPrices() {
	tickerPrices.BTC = '61000'
	tickerPrices.ETH = '3100'
	failTicker = false
}

/** Force getTicker to throw, exercising the engine's fallback-price path. */
export function setTickerFailing(failing: boolean) {
	failTicker = failing
}

export function tickerPrice(coin: string): string {
	const key = coin.replace(/-PERP$/, '')
	return tickerPrices[key] ?? '100'
}

const mod = require_('../../src/services/HyperliquidService')
const HyperliquidService = mod.HyperliquidService

HyperliquidService.initialize = () => {}
// NB: must match the REAL service's contract ({ meta, assetCtxs }) — not the
// raw SDK tuple — because consumers destructure these fields. Universe names
// carry the SDK's "-PERP" suffix, like mainnet.
HyperliquidService.getMetaAndAssetCtxs = async () => ({
	meta: {
		universe: [
			{ name: 'BTC-PERP', szDecimals: 5, maxLeverage: 40 },
			{ name: 'ETH-PERP', szDecimals: 4, maxLeverage: 25 },
		],
	},
	assetCtxs: [
		{ markPx: tickerPrices.BTC, midPx: tickerPrices.BTC, prevDayPx: tickerPrices.BTC, funding: '0.0001', dayNtlVlm: '1000', dayBaseVlm: '10', openInterest: '100', oraclePx: tickerPrices.BTC },
		{ markPx: tickerPrices.ETH, midPx: tickerPrices.ETH, prevDayPx: tickerPrices.ETH, funding: '0.0001', dayNtlVlm: '1000', dayBaseVlm: '10', openInterest: '100', oraclePx: tickerPrices.ETH },
	],
})
HyperliquidService.getL2Book = async (coin: string) => ({
	coin,
	levels: [
		[{ px: tickerPrice(coin), sz: '1.5', n: 1 }],
		[{ px: tickerPrice(coin), sz: '1.5', n: 1 }],
	],
	time: Date.now(),
})
HyperliquidService.getCandles = async () => []
HyperliquidService.getTrades = async () => []
HyperliquidService.getAllMarkets = async () => []
HyperliquidService.getTicker = async (coin: string) => {
	if (failTicker) throw new Error('simulated Hyperliquid outage')
	const px = tickerPrice(coin)
	return {
		coin,
		symbol: `${coin}-PERP`,
		lastPrice: px,
		markPrice: px,
		indexPrice: px,
		priceChange24h: '0.00',
		priceChangePercent24h: '0.00',
		high24h: px,
		low24h: px,
		volume24h: '1000',
		fundingRate: '0.0001',
		openInterest: '100',
		maxLeverage: 40,
	}
}
HyperliquidService.getFundingRate = async (coin: string) => ({ coin, fundingRate: '0.0001', premium: '0.0001', time: Date.now() })
HyperliquidService.coinToSymbol = (coin: string, type: 'SPOT' | 'PERPETUAL' = 'SPOT') =>
	type === 'PERPETUAL' ? `${coin}-PERP` : `${coin}/USDC`
// mirrors the REAL service: /USDC and -PERP forms both map to the SDK
// universe name ("BTC-PERP"), which is what the fake's universe contains.
HyperliquidService.symbolToCoin = (symbol: string) =>
	symbol.includes('/USDC') ? symbol.replace('/USDC', '') + '-PERP' : symbol
