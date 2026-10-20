import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { Wallet } from 'ethers'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import createApp from '../src/app'
import { generateToken } from '../src/middleware/auth'
import {
	HL_EXCHANGE_DOMAIN,
	APPROVE_AGENT_TYPES,
	APPROVE_BUILDER_TYPES,
} from '../src/utils/signature'
import config from '../src/config'

const MAIN = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') // anvil #1
const AGENT = Wallet.createRandom()
const USER = 1
const now = new Date()

let server: Server
let base: string
let auth: Record<string, string>

before(async () => {
	seedDefaults()
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id: USER, wallet_address: MAIN.address, email: 'a@a.a', google_id: null, name: null, avatar: null, created_at: now, updated_at: now }],
		assets: [{ id: 1, user_id: USER, asset: 'USDC', free: '100000', locked: '0', created_at: now, updated_at: now }],
	})
	const app = createApp()
	await new Promise<void>((resolve) => {
		server = app.listen(0, '127.0.0.1', () => resolve())
	})
	const addr = server.address()
	const port = typeof addr === 'object' && addr ? addr.port : 0
	base = `http://127.0.0.1:${port}`
	auth = { Authorization: `Bearer ${generateToken(USER, 'a@a.a')}` }
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
const del = (p: string, headers: Record<string, string> = {}) =>
	fetch(base + p, { method: 'DELETE', headers }).then(async (r) => ({ status: r.status, body: await r.json() }))

/* ------------------------- route mounting regression ------------------------ */

test('agent routes are mounted: unauthenticated GET /api/auth/agents → 401 (not 404)', async () => {
	const res = await get('/api/auth/agents')
	// The route must EXIST — an unmounted router yields 404, a mounted one
	// behind `authenticate` yields 401. This is the regression guard for the
	// "routes silently never applied" bug found in the live smoke.
	assert.equal(res.status, 401)
})

test('builder routes are mounted: unauthenticated GET /api/auth/builder-approvals → 401', async () => {
	const res = await get('/api/auth/builder-approvals')
	assert.equal(res.status, 401)
})

/* ----------------------------- agent lifecycle ----------------------------- */

test('POST /api/auth/agent: valid EIP-712 approveAgent → 200 + registered', async () => {
	const nonce = Date.now()
	const signature = await MAIN.signTypedData(HL_EXCHANGE_DOMAIN, APPROVE_AGENT_TYPES, {
		type: 'approveAgent',
		agentAddress: AGENT.address,
		agentName: 'http-agent',
		nonce,
	})
	const res = await post('/api/auth/agent', { agentAddress: AGENT.address, agentName: 'http-agent', nonce, signature }, auth)
	assert.equal(res.status, 201) // CREATED — a new resource was registered
	assert.equal(res.body.success, true)
	assert.equal(res.body.data.agent.agentAddress.toLowerCase(), AGENT.address.toLowerCase())

	const list = await get('/api/auth/agents', auth)
	assert.equal(list.body.data.agents.length, 1)
})

test('POST /api/auth/agent: missing signature → 400; forged signature → 401', async () => {
	const missing = await post('/api/auth/agent', { agentAddress: AGENT.address }, auth)
	assert.equal(missing.status, 400)

	// a well-formed request signed by the WRONG key (not the main wallet)
	const nonce = Date.now()
	const forged = await AGENT.signTypedData(HL_EXCHANGE_DOMAIN, APPROVE_AGENT_TYPES, {
		type: 'approveAgent',
		agentAddress: AGENT.address,
		agentName: 'http-agent',
		nonce,
	})
	const res = await post('/api/auth/agent', { agentAddress: AGENT.address, agentName: 'http-agent', nonce, signature: forged }, auth)
	assert.equal(res.status, 401)
})

test('DELETE /api/auth/agent/:address → 200 + agent gone', async () => {
	const res = await del(`/api/auth/agent/${AGENT.address}`, auth)
	assert.equal(res.status, 200)
	const list = await get('/api/auth/agents', auth)
	assert.equal(list.body.data.agents.length, 0)
})

/* ----------------------------- builder approval ---------------------------- */

test('POST /api/auth/builder-fee: valid EIP-712 approveBuilderFee → 200 + stored', async () => {
	const nonce = Date.now()
	const signature = await MAIN.signTypedData(HL_EXCHANGE_DOMAIN, APPROVE_BUILDER_TYPES, {
		type: 'approveBuilderFee',
		builderAddress: config.builder.address,
		maxFee: 100,
		nonce,
	})
	const res = await post('/api/auth/builder-fee', { maxFee: 100, nonce, signature }, auth)
	assert.equal(res.status, 200)
	assert.equal(res.body.data.maxFee, 100)
	assert.equal(res.body.data.builderAddress.toLowerCase(), config.builder.address.toLowerCase())

	const apps = await get('/api/auth/builder-approvals', auth)
	assert.equal(apps.body.data.approvals.length, 1)
	assert.equal(apps.body.data.approvals[0].maxFee, 100)
})

test('POST /api/auth/builder-fee: maxFee out of range → 400', async () => {
	const res = await post('/api/auth/builder-fee', { maxFee: 99999 }, auth)
	assert.equal(res.status, 400)
})
