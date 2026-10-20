import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import jwt from 'jsonwebtoken'
import './helpers/fake-db'
import './helpers/fake-hyperliquid'
import { fakeDb, seedDefaults } from './helpers/fake-db'
import { authenticate, optionalAuth, generateToken } from '../src/middleware/auth'
import { AuthService } from '../src/services/AuthService'

const WALLET = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') // anvil #1
const CHALLENGE = 'Sign this message to authenticate with Hyperliquid Clone.\n\nTimestamp: 1700000000000'

function mockReqRes(authorization?: string) {
	const req: any = { headers: authorization ? { authorization } : {} }
	const res: any = { statusCode: 0, status(c: number) { res.statusCode = c; return res }, json(b: any) { res.body = b; return res } }
	return { req, res }
}

/**
 * The middleware is wrapped in asyncHandler, which does NOT return the inner
 * promise — awaiting it resolves before the async work finishes. next() is
 * invoked on both the success and error paths, so resolve on next().
 */
function runMw(mw: any, req: any, res: any): Promise<{ err?: any }> {
	return new Promise((resolve) => {
		mw(req, res, (e?: any) => resolve({ err: e }))
	})
}

function seedUser(id = 1, walletAddress: string | null = WALLET.address) {
	fakeDb.reset({
		trading_pairs: fakeDb.table('trading_pairs'),
		users: [{ id, wallet_address: walletAddress, email: null, google_id: null, name: null, avatar: null, created_at: new Date(), updated_at: new Date() }],
	})
}

/* ------------------------------ generateToken ------------------------------ */

test('generateToken produces a verifiable JWT carrying userId + walletAddress', () => {
	seedDefaults()
	const token = generateToken(42, '0xabc')
	const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_change_me') as any
	assert.equal(decoded.userId, 42)
	assert.equal(decoded.walletAddress, '0xabc')
	assert.ok(typeof decoded.exp === 'number') // 7d expiry
})

/* ------------------------------ authenticate ------------------------------- */

test('authenticate: valid token attaches req.user and calls next', async () => {
	seedUser()
	const token = generateToken(1, WALLET.address)
	const { req, res } = mockReqRes(`Bearer ${token}`)
	const { err } = await runMw(authenticate, req, res)
	assert.equal(err, undefined)
	assert.equal(req.user?.id, 1)
	assert.equal(req.user?.walletAddress, WALLET.address)
})

test('authenticate: missing / malformed header → 401 unauthorized', async () => {
	seedUser()
	const { req, res } = mockReqRes()
	let err: any = (await runMw(authenticate, req, res)).err
	assert.equal(err.statusCode, 401)
	assert.equal(err.code, 'UNAUTHORIZED')

	const { req: req2, res: res2 } = mockReqRes('Token abc') // wrong scheme
	let err2: any = (await runMw(authenticate, req2, res2)).err
	assert.equal(err2.statusCode, 401)
})

test('authenticate: invalid token → 401 "Invalid token"', async () => {
	seedUser()
	const { req, res } = mockReqRes('Bearer not.a.jwt')
	const { err } = await runMw(authenticate, req, res)
	assert.equal(err.statusCode, 401)
	assert.match(err.message, /Invalid token/)
})

test('authenticate: expired token → 401 "Token expired"', async () => {
	seedUser()
	const token = generateToken(1, WALLET.address)
	// forge an expired token with the same secret
	const expired = jwt.sign({ userId: 1, walletAddress: WALLET.address }, process.env.JWT_SECRET || 'your_jwt_secret_change_me', { expiresIn: '-1s' })
	const { req, res } = mockReqRes(`Bearer ${expired}`)
	const { err } = await runMw(authenticate, req, res)
	assert.equal(err.statusCode, 401)
	assert.match(err.message, /expired/i)
	assert.ok(token.length > 0)
})

test('authenticate: valid token but user deleted → 401 "User not found"', async () => {
	seedDefaults() // no users
	const token = generateToken(777, '0xabc')
	const { req, res } = mockReqRes(`Bearer ${token}`)
	const { err } = await runMw(authenticate, req, res)
	assert.equal(err.statusCode, 401)
	assert.match(err.message, /User not found/)
})

/* ------------------------------ optionalAuth ------------------------------- */

test('optionalAuth: no header → next() without user; bad token → silently ignored', async () => {
	seedUser()
	const { req, res } = mockReqRes()
	await runMw(optionalAuth, req, res)
	assert.equal(req.user, undefined)

	const { req: req2, res: res2 } = mockReqRes('Bearer garbage')
	await runMw(optionalAuth, req2, res2)
	assert.equal(req2.user, undefined) // silent fail, no throw
})

test('optionalAuth: valid token → attaches user', async () => {
	seedUser()
	const token = generateToken(1, WALLET.address)
	const { req, res } = mockReqRes(`Bearer ${token}`)
	await runMw(optionalAuth, req, res)
	assert.equal(req.user?.id, 1)
})

/* --------------------------- AuthService: wallet --------------------------- */

test('loginWithWallet: valid signature creates the user and returns a JWT', async () => {
	seedDefaults()
	const signature = await WALLET.signMessage(CHALLENGE)
	const result = await AuthService.loginWithWallet(WALLET.address, signature, CHALLENGE)
	// UserModel lowercases the wallet address on create
	assert.equal(result.user.walletAddress, WALLET.address.toLowerCase())
	assert.ok(result.token.token.includes('.'))
	assert.equal(result.token.expiresIn, '7d')
	// user persisted (lowercased) and findable
	const user = fakeDb.table('users').find((u) => u.id === result.user.id)
	assert.equal(user.wallet_address, WALLET.address.toLowerCase())
	// second login reuses the same user (no duplicate)
	const again = await AuthService.loginWithWallet(WALLET.address, signature, CHALLENGE)
	assert.equal(again.user.id, result.user.id)
	assert.equal(fakeDb.table('users').length, 1)
})

test('loginWithWallet: invalid signature → 401 invalidSignature', async () => {
	seedDefaults()
	const other = new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a') // anvil #2
	const signature = await other.signMessage(CHALLENGE)
	await assert.rejects(
		() => AuthService.loginWithWallet(WALLET.address, signature, CHALLENGE),
		(err: any) => err.statusCode === 401 && err.code === 'INVALID_SIGNATURE'
	)
	// no user was created
	assert.equal(fakeDb.table('users').length, 0)
})

test('verifyWalletSignature: case-insensitive address match (args: address, message, signature)', async () => {
	const signature = await WALLET.signMessage(CHALLENGE)
	assert.equal(
		await AuthService.verifyWalletSignature(WALLET.address.toUpperCase().replace('0X', '0x'), CHALLENGE, signature),
		true
	)
	assert.equal(
		await AuthService.verifyWalletSignature('0x0000000000000000000000000000000000000001', CHALLENGE, signature),
		false
	)
	// malformed signature → false (no throw)
	assert.equal(await AuthService.verifyWalletSignature(WALLET.address, CHALLENGE, '0xdead'), false)
})

/* ---------------------------- AuthService: profile -------------------------- */

test('getProfile: returns the profile; unknown user → 404', async () => {
	seedUser()
	const profile = await AuthService.getProfile(1)
	assert.equal(profile.id, 1)
	assert.equal(profile.walletAddress, WALLET.address)
	await assert.rejects(() => AuthService.getProfile(999), (err: any) => err.statusCode === 404)
})

test('updateEmail: validates format then persists', async () => {
	seedUser()
	await assert.rejects(() => AuthService.updateEmail(1, 'not-an-email'), (err: any) => err.statusCode === 400)
	await AuthService.updateEmail(1, 'trader@example.com')
	assert.equal(fakeDb.table('users')[0].email, 'trader@example.com')
})
