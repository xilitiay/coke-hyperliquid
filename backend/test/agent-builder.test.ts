import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { resetTickerPrices } from './helpers/fake-hyperliquid'
import { resetBooks } from '../src/services/MatchingEngine'
import { TradingService } from '../src/services/TradingService'
import { AuthService } from '../src/services/AuthService'
import { AgentModel } from '../src/models/AgentModel'
import { PositionModel } from '../src/models/Position'
import {
	HL_EXCHANGE_DOMAIN,
	ORDER_ACTION_TYPES,
	APPROVE_AGENT_TYPES,
	APPROVE_BUILDER_TYPES,
	buildOrderActionValue,
} from '../src/utils/signature'
import config from '../src/config'

const USER = 1
const now = new Date()

/** The account's main wallet (anvil #1). */
const MAIN = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
/** A separate key acting as the delegated API wallet (agent). */
const AGENT = Wallet.createRandom()

function seed() {
	resetTickerPrices()
	resetBooks()
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: USER, wallet_address: MAIN.address, email: 'a@a.a', google_id: null, name: null, avatar: null, created_at: now, updated_at: now }],
		assets: [{ id: 1, user_id: USER, asset: 'USDC', free: '100000', locked: '0', created_at: now, updated_at: now }],
	})
}

/** Sign an order action with the given signer (main wallet or agent). */
async function signOrder(req: any, signer: Wallet, nonce = Date.now()) {
	const value = buildOrderActionValue({ ...req, nonce })
	const signature = await signer.signTypedData(HL_EXCHANGE_DOMAIN, ORDER_ACTION_TYPES, value)
	return { ...req, signature, signatureScheme: 'eip712' as const, nonce }
}

/** The user's main wallet signs the approveAgent action. */
async function signApproveAgent(agentAddress: string, agentName = 'Test agent', nonce = Date.now()) {
	const signature = await MAIN.signTypedData(HL_EXCHANGE_DOMAIN, APPROVE_AGENT_TYPES, {
		type: 'approveAgent',
		agentAddress,
		agentName,
		nonce,
	})
	return { signature, nonce }
}

/** The user's main wallet signs the approveBuilderFee action. */
async function signApproveBuilder(maxFee: number, nonce = Date.now()) {
	const signature = await MAIN.signTypedData(HL_EXCHANGE_DOMAIN, APPROVE_BUILDER_TYPES, {
		type: 'approveBuilderFee',
		builderAddress: config.builder.address,
		maxFee,
		nonce,
	})
	return { signature, nonce }
}

/* ------------------------------ agents ------------------------------ */

test('agent lifecycle: register (main-wallet signed) → agent can sign orders → revoke blocks', async () => {
	seed()

	// 1) register the agent — signed by the MAIN wallet
	const approve = await signApproveAgent(AGENT.address)
	const agent = await AuthService.registerAgent(USER, { agentAddress: AGENT.address, agentName: 'Test agent', ...approve })
	assert.equal(agent.agentAddress.toLowerCase(), AGENT.address.toLowerCase())
	assert.equal((await AuthService.listAgents(USER)).length, 1)

	// 2) an order signed by the AGENT key is accepted
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, await signOrder(req, AGENT))
	assert.equal(order.status, 'FILLED')
	const pos = (await PositionModel.findByUserId(USER, 'BTC-PERP'))[0]
	assert.equal(pos.quantity, '0.50000000')

	// 3) an order signed by a RANDOM key is rejected
	await assert.rejects(
		async () => TradingService.createOrder(USER, await signOrder(req, Wallet.createRandom())),
		(err: any) => err.statusCode === 401 && err.code === 'INVALID_SIGNATURE'
	)

	// 4) revoke → the agent key no longer works
	await AuthService.revokeAgent(USER, AGENT.address)
	assert.equal((await AuthService.listAgents(USER)).length, 0)
	await assert.rejects(
		async () => TradingService.createOrder(USER, await signOrder(req, AGENT)),
		(err: any) => err.statusCode === 401
	)
});

test('agent registration requires the MAIN wallet signature (agent cannot self-register)', async () => {
	seed()
	const approve = await signApproveAgent(AGENT.address)
	// same action, but signed by the agent itself → must fail
	const forged = {
		signature: await AGENT.signTypedData(HL_EXCHANGE_DOMAIN, APPROVE_AGENT_TYPES, {
			type: 'approveAgent',
			agentAddress: AGENT.address,
			agentName: 'Test agent',
			nonce: approve.nonce,
		}),
		nonce: approve.nonce,
	}
	await assert.rejects(
		() => AuthService.registerAgent(USER, { agentAddress: AGENT.address, agentName: 'Test agent', ...forged }),
		(err: any) => err.statusCode === 401
	)
});

test('expired agent (validUntil in the past) cannot sign', async () => {
	seed()
	const past = Math.floor(Date.now() / 1000) - 60
	const approve = await signApproveAgent(AGENT.address)
	await AuthService.registerAgent(USER, { agentAddress: AGENT.address, agentName: 'Test agent', validUntil: past, ...approve })
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	await assert.rejects(
		async () => TradingService.createOrder(USER, await signOrder(req, AGENT)),
		(err: any) => err.statusCode === 401
	)
});

/* ---------------------------- builder fees ---------------------------- */

test('builder fee: approval → order injection recorded, capped per market', async () => {
	seed()
	// approve with the perp cap (100 = 10bp)
	const approve = await signApproveBuilder(100)
	const r = await AuthService.approveBuilderFee(USER, { maxFee: 100, ...approve })
	assert.equal(r.builderAddress.toLowerCase(), config.builder.address.toLowerCase())

	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const signed = await signOrder(req, MAIN)
	const order = await TradingService.createOrder(USER, { ...signed, builderFee: 50 })

	// the injected fee is min(requested 50, approved 100, perp cap 100) = 50
	const fees = await AgentModel.builderFeesForOrder(order.orderId)
	assert.equal(fees.length, 1)
	assert.equal(fees[0].fee, 50)
	assert.equal(fees[0].builderAddress.toLowerCase(), config.builder.address.toLowerCase())
});

test('builder fee: request above the approved max is capped', async () => {
	seed()
	const approve = await signApproveBuilder(20) // approve only 2bp
	await AuthService.approveBuilderFee(USER, { maxFee: 20, ...approve })
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, { ...(await signOrder(req, MAIN)), builderFee: 90 })
	const fees = await AgentModel.builderFeesForOrder(order.orderId)
	assert.equal(fees[0].fee, 20) // capped at the approved max
});

test('builder fee: without approval nothing is injected', async () => {
	seed()
	const req = { symbol: 'BTC-PERP', side: 'BUY' as const, type: 'MARKET' as const, quantity: '0.5' }
	const order = await TradingService.createOrder(USER, await signOrder(req, MAIN))
	assert.equal((await AgentModel.builderFeesForOrder(order.orderId)).length, 0)
	assert.equal(fakeDb.table('builder_fees').length, 0)
});
