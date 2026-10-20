import type { TypedDataDomain, TypedDataField } from 'ethers'

/**
 * EIP-712 order-action signing — mirrors `backend/src/utils/signature.ts`.
 *
 * The domain is Hyperliquid's Exchange domain verbatim (chainId 1337, zero
 * verifyingContract), so signatures produced here are structurally identical
 * to the ones the official protocol expects. Keep the two definitions in sync:
 * if either side changes a field name/type, verification fails closed.
 */
export const HL_EXCHANGE_DOMAIN: TypedDataDomain = {
  name: 'Exchange',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000',
}

export const ORDER_ACTION_TYPES: Record<string, TypedDataField[]> = {
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

/** Canonical message an order request maps onto (must match the backend). */
export function buildOrderActionValue(request: {
  symbol: string
  side: string
  type: string
  price?: string | number
  quantity: string | number
  reduceOnly?: boolean
  postOnly?: boolean
  nonce: number
}) {
  return {
    type: 'order',
    symbol: request.symbol,
    side: request.side,
    orderType: request.type,
    // Coerce to strings: <input type="number"> + v-model yields numbers, and
    // ethers' typed-data encoder rejects non-strings for string fields.
    price: request.price == null || request.price === '' ? '' : String(request.price),
    quantity: String(request.quantity ?? ''),
    reduceOnly: !!request.reduceOnly,
    postOnly: !!request.postOnly,
    nonce: Number(request.nonce),
  }
}
