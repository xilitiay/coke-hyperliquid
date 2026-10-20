import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decimalsOf, sigFigsOf, roundDownTo, checkSzDecimals, checkPrice } from '../src/utils/rounding'

test('decimalsOf counts decimal places', () => {
	assert.equal(decimalsOf('0.5'), 1)
	assert.equal(decimalsOf('0.00001'), 5)
	assert.equal(decimalsOf('61000'), 0)
	assert.equal(decimalsOf('61000.00'), 2)
})

test('sigFigsOf counts significant figures', () => {
	assert.equal(sigFigsOf('61000'), 5)
	assert.equal(sigFigsOf('61000.0'), 6) // trailing zero after the point counts
	assert.equal(sigFigsOf('0.00123'), 3)
	assert.equal(sigFigsOf('0'), 0)
})

test('roundDownTo truncates without float drift', () => {
	assert.equal(roundDownTo('0.123456', 4), '0.1234')
	assert.equal(roundDownTo('61000.999', 2), '61000.99')
	assert.equal(roundDownTo('0.5', 5), '0.50000')
	assert.equal(roundDownTo('123', 0), '123')
})

test('checkSzDecimals: aligned passes, over-precision is REJECTED (not fixed)', () => {
	// BTC szDecimals = 5
	assert.deepEqual(checkSzDecimals('0.5', 5), { ok: true, rounded: '0.50000' }) // zero-padded to szDecimals
	assert.equal(checkSzDecimals('0.00001', 5).ok, true)
	// ETH szDecimals = 4
	assert.equal(checkSzDecimals('0.12345', 4).ok, false)
	assert.match(checkSzDecimals('0.12345', 4).reason!, /allows 4/)
	assert.equal(checkSzDecimals('0.1234', 4).ok, true)
	// garbage
	assert.equal(checkSzDecimals('abc', 5).ok, false)
});

test('checkPrice: tick alignment + 5 sig figs + 8 decimals', () => {
	// NB: the 5-sig-fig cap means precision scales with magnitude — exactly how
	// Hyperliquid's ticks work. At ~100 with tick 0.01:
	assert.equal(checkPrice('100.00', 0.01).ok, true) // 5 sig figs
	assert.equal(checkPrice('100.01', 0.01).ok, true)
	assert.equal(checkPrice('1000.1', 0.01).ok, true)
	// 10.005: 5 sig figs (within cap) but NOT a tick multiple → tick rejection
	assert.equal(checkPrice('10.005', 0.01).ok, false)
	assert.match(checkPrice('10.005', 0.01).reason!, /tick size/)
	// sig figs: 61000.00 carries 7 digits → rejected even though tick-aligned
	assert.equal(checkPrice('61000.00', 0.01).ok, false)
	assert.match(checkPrice('61000.00', 0.01).reason!, /significant figures/)
	// decimals: 9 decimal places → rejected
	assert.equal(checkPrice('0.123456789', 0.000000001).ok, false)
	assert.match(checkPrice('0.123456789', 0.000000001).reason!, /decimal places/)
});
