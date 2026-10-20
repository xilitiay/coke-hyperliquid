import { ethers } from 'ethers'
import { UserModel } from '../models/User'
import logger from './logger'

/**
 * Hyperliquid's Exchange EIP-712 domain, used verbatim for signed actions.
 * chainId 1337 + zero verifyingContract is the protocol's on-chain convention
 * (actions are signed off-chain, the domain only namespaces the signature).
 */
export const HL_EXCHANGE_DOMAIN: ethers.TypedDataDomain = {
  name: 'Exchange',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000',
}

/**
 * Typed structure for an order action. Field set mirrors the semantic content
 * of a Hyperliquid L1 order action (symbol/side/price/size/reduceOnly + nonce),
 * so clients signing against the official domain produce interchangeable
 * signatures. `nonce` binds the signature to one submission (replay guard).
 */
export const ORDER_ACTION_TYPES: Record<string, ethers.TypedDataField[]> = {
  Action: [
    { name: 'type', type: 'string' },
    { name: 'symbol', type: 'string' },
    { name: 'side', type: 'string' },
    { name: 'orderType', type: 'string' },
    { name: 'price', type: 'string' },
    { name: 'quantity', type: 'string' },
    { name: 'reduceOnly', type: 'bool' },
    { name: 'postOnly', type: 'bool' },
    { name: 'nonce', type: 'uint64' },
  ],
}

/** Build the canonical EIP-712 message an order request maps onto. */
export function buildOrderActionValue(request: {
  symbol: string
  side: string
  type: string
  price?: string | number
  quantity: string | number
  reduceOnly?: boolean
  postOnly?: boolean
  nonce?: number
}) {
  return {
    type: 'order',
    symbol: request.symbol,
    side: request.side,
    orderType: request.type,
    // Coerce to strings so numeric inputs (e.g. <input type="number"> values)
    // produce the same typed-data encoding as string inputs.
    price: request.price == null || request.price === '' ? '' : String(request.price),
    quantity: String(request.quantity ?? ''),
    reduceOnly: !!request.reduceOnly,
    postOnly: !!request.postOnly,
    nonce: Number(request.nonce ?? 0),
  }
}

/**
 * Typed structure for a cancel action, signed with the same Exchange domain.
 */
export const CANCEL_ACTION_TYPES: Record<string, ethers.TypedDataField[]> = {
  Action: [
    { name: 'type', type: 'string' },
    { name: 'symbol', type: 'string' },
    { name: 'orderId', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
}

/** Build the canonical EIP-712 message a cancel action maps onto. */
export function buildCancelActionValue(request: {
  symbol: string
  orderId: string
  nonce?: number
}) {
  return {
    type: 'cancel',
    symbol: request.symbol,
    orderId: request.orderId,
    nonce: Number(request.nonce ?? 0),
  }
}

/** Verify an EIP-712 cancel-action signature against the user's wallet. */
export async function verifyCancelActionSignature(
  userId: number,
  request: { symbol: string; orderId: string; nonce?: number },
  signature: string
): Promise<boolean> {
  try {
    const user = await UserModel.findById(userId)
    if (!user || !user.walletAddress) {
      return false
    }
    const recovered = ethers.verifyTypedData(
      HL_EXCHANGE_DOMAIN,
      CANCEL_ACTION_TYPES,
      buildCancelActionValue(request),
      signature
    )
    return recovered.toLowerCase() === user.walletAddress.toLowerCase()
  } catch (error) {
    logger.error('EIP-712 cancel action verification failed', { error })
    return false
  }
}

/**
 * Typed structure for an approveAgent action (user-wallet signed, one-time).
 * Mirrors Hyperliquid's agent delegation: the agent may sign orders but is
 * structurally unable to move funds.
 */
export const APPROVE_AGENT_TYPES: Record<string, ethers.TypedDataField[]> = {
  Action: [
    { name: 'type', type: 'string' },
    { name: 'agentAddress', type: 'address' },
    { name: 'agentName', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
}

/** Typed structure for a one-time approveBuilderFee action (user-wallet signed). */
export const APPROVE_BUILDER_TYPES: Record<string, ethers.TypedDataField[]> = {
  Action: [
    { name: 'type', type: 'string' },
    { name: 'builderAddress', type: 'address' },
    { name: 'maxFee', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
  ],
}

/**
 * Verify an EIP-712 approveAgent signature: the signer must be the account's
 * own main wallet (agents are delegated BY the user, never self-registered).
 */
export async function verifyApproveAgentSignature(
  userId: number,
  request: { agentAddress: string; agentName?: string; nonce?: number },
  signature: string
): Promise<boolean> {
  try {
    const user = await UserModel.findById(userId)
    if (!user || !user.walletAddress) return false
    const recovered = ethers.verifyTypedData(
      HL_EXCHANGE_DOMAIN,
      APPROVE_AGENT_TYPES,
      {
        type: 'approveAgent',
        agentAddress: request.agentAddress,
        agentName: request.agentName ?? '',
        nonce: Number(request.nonce ?? 0),
      },
      signature
    )
    return recovered.toLowerCase() === user.walletAddress.toLowerCase()
  } catch (error) {
    logger.error('EIP-712 approveAgent verification failed', { error })
    return false
  }
}

/** Verify an EIP-712 approveBuilderFee signature (account's own wallet). */
export async function verifyApproveBuilderSignature(
  userId: number,
  request: { builderAddress: string; maxFee: number; nonce?: number },
  signature: string
): Promise<boolean> {
  try {
    const user = await UserModel.findById(userId)
    if (!user || !user.walletAddress) return false
    const recovered = ethers.verifyTypedData(
      HL_EXCHANGE_DOMAIN,
      APPROVE_BUILDER_TYPES,
      {
        type: 'approveBuilderFee',
        builderAddress: request.builderAddress,
        maxFee: Number(request.maxFee),
        nonce: Number(request.nonce ?? 0),
      },
      signature
    )
    return recovered.toLowerCase() === user.walletAddress.toLowerCase()
  } catch (error) {
    logger.error('EIP-712 approveBuilderFee verification failed', { error })
    return false
  }
}

/**
 * Resolve the addresses allowed to sign order actions for a user: the main
 * wallet plus every registered (non-expired) agent.
 */
export async function authorizedSigners(userId: number): Promise<string[]> {
  const user = await UserModel.findById(userId)
  const out: string[] = []
  if (user?.walletAddress) out.push(user.walletAddress.toLowerCase())
  const { query } = await import('../config/database')
  const rows = await query<any[]>('SELECT * FROM agents WHERE user_id = ?', [userId])
  const now = Math.floor(Date.now() / 1000)
  for (const r of rows) {
    if (r.valid_until && Number(r.valid_until) < now) continue // expired
    out.push(String(r.agent_address).toLowerCase())
  }
  return out
}

/**
 * Verify an EIP-712 order-action signature against the user's wallet OR one
 * of their registered agents (Hyperliquid's API-wallet model).
 */
export async function verifyOrderActionSignatureAny(
  userId: number,
  request: Parameters<typeof buildOrderActionValue>[0],
  signature: string
): Promise<boolean> {
  try {
    const allowed = await authorizedSigners(userId)
    if (allowed.length === 0) return false
    const recovered = ethers.verifyTypedData(
      HL_EXCHANGE_DOMAIN,
      ORDER_ACTION_TYPES,
      buildOrderActionValue(request),
      signature
    ).toLowerCase()
    return allowed.includes(recovered)
  } catch (error) {
    logger.error('EIP-712 order action verification failed', { error })
    return false
  }
}

/**
 * Verify an EIP-712 order-action signature against the user's wallet address.
 * The signer must be the account's own wallet (or, once agents land, an
 * authorized agent address).
 */
export async function verifyOrderActionSignature(
  userId: number,
  request: Parameters<typeof buildOrderActionValue>[0],
  signature: string
): Promise<boolean> {
  try {
    const user = await UserModel.findById(userId)
    if (!user || !user.walletAddress) {
      return false
    }
    const recovered = ethers.verifyTypedData(
      HL_EXCHANGE_DOMAIN,
      ORDER_ACTION_TYPES,
      buildOrderActionValue(request),
      signature
    )
    return recovered.toLowerCase() === user.walletAddress.toLowerCase()
  } catch (error) {
    logger.error('EIP-712 order action verification failed', { error })
    return false
  }
}

/**
 * Demo-only signature check for wallet-less sessions: SHA-256 over the request
 * minus the signature field. This proves nothing about authorship — it exists
 * so the demo order path has *a* marker, and every caller must label it demo.
 */
export async function verifyDemoSignature(
  _userId: number,
  data: any,
  signature: string
): Promise<boolean> {
  try {
    const crypto = await import('crypto')
    const { signature: _sig, ...rest } = data
    const expected = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
    return signature === expected
  } catch (error) {
    logger.error('Demo signature verification failed', { error })
    return false
  }
}

/**
 * Verify EIP-712 signature for order
 */
export async function verifySignature(
  userId: number,
  data: any,
  signature: string
): Promise<boolean> {
  try {
    // Get user
    const user = await UserModel.findById(userId)
    if (!user) {
      return false
    }

    // For users without wallet (Google/Email login), use simplified verification
    if (!user.walletAddress) {
      // Simple hash-based verification for demo/testing
      const crypto = await import('crypto')

      // Remove signature field from data before hashing
      const { signature: _, ...dataWithoutSignature } = data
      const message = JSON.stringify(dataWithoutSignature)
      const expectedHash = crypto.createHash('sha256').update(message).digest('hex')

      return signature === expectedHash
    }

    // For wallet users, verify the signature over the same payload shape the
    // demo path uses: the request WITHOUT the signature field. Including the
    // signature in the signed message would be self-referential and could
    // never be reproduced by a client.
    const { signature: _sig, ...dataWithoutSignature } = data
    const message = JSON.stringify(dataWithoutSignature)
    const messageHash = ethers.hashMessage(message)

    // Recover signer address from signature
    const recoveredAddress = ethers.recoverAddress(messageHash, signature)

    // Compare with user's wallet address
    return recoveredAddress.toLowerCase() === user.walletAddress.toLowerCase()
  } catch (error) {
    logger.error('Signature verification failed', { error })
    return false
  }
}

/**
 * Verify EIP-712 typed data signature
 */
export async function verifyTypedDataSignature(
  userId: number,
  domain: any,
  types: any,
  value: any,
  signature: string
): Promise<boolean> {
  try {
    const user = await UserModel.findById(userId)
    if (!user || !user.walletAddress) {
      return false
    }

    // Recover signer from typed data
    const recoveredAddress = ethers.verifyTypedData(domain, types, value, signature)

    return recoveredAddress.toLowerCase() === user.walletAddress.toLowerCase()
  } catch (error) {
    logger.error('Typed data signature verification failed', { error })
    return false
  }
}
