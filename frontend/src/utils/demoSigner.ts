import type { Wallet } from 'ethers'

/**
 * In-memory signer for demo sessions.
 *
 * The demo login authenticates as a well-known Hardhat/Anvil test account.
 * To let that session produce real EIP-712 order-action signatures (so the
 * demo exercises the same signing path as a wallet user), the Wallet instance
 * is held in a module-level variable for the tab's lifetime.
 *
 * SECURITY: this is memory-only by design — never write the key to
 * localStorage/sessionStorage or send it anywhere. It is a test key with no
 * real funds; the module is demo scaffolding, not a pattern for production.
 */
let demoWallet: Wallet | null = null

export function setDemoSigner(wallet: Wallet | null): void {
  demoWallet = wallet
}

export function getDemoSigner(): Wallet | null {
  return demoWallet
}

export function hasDemoSigner(): boolean {
  return demoWallet !== null
}
