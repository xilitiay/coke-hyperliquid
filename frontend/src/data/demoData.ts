/**
 * Demo fixtures for the new section pages (Markets / Vaults / Earn / Leaderboard / Referrals).
 * Static, deterministic data so the UI clone renders without a backend.
 */

export interface MarketRow {
  symbol: string
  name: string
  type: 'PERP' | 'SPOT'
  price: number
  change24h: number // percent
  volume24h: number // USD
  openInterest?: number // USD (perp only)
  fundingRate?: number // percent (perp only)
  marketCap?: number // USD
}

export const perpMarkets: MarketRow[] = [
  { symbol: 'BTC', name: 'Bitcoin', type: 'PERP', price: 98250, change24h: 2.41, volume24h: 4_213_500_000, openInterest: 2_104_800_000, fundingRate: 0.0089 },
  { symbol: 'ETH', name: 'Ethereum', type: 'PERP', price: 3412.5, change24h: 1.12, volume24h: 1_876_200_000, openInterest: 842_300_000, fundingRate: 0.0061 },
  { symbol: 'SOL', name: 'Solana', type: 'PERP', price: 214.8, change24h: -3.18, volume24h: 982_400_000, openInterest: 401_900_000, fundingRate: 0.0112 },
  { symbol: 'HYPE', name: 'Hyperliquid', type: 'PERP', price: 28.64, change24h: 5.92, volume24h: 654_100_000, openInterest: 312_700_000, fundingRate: 0.0145 },
  { symbol: 'AVAX', name: 'Avalanche', type: 'PERP', price: 41.7, change24h: -1.04, volume24h: 312_800_000, openInterest: 98_400_000, fundingRate: 0.0073 },
  { symbol: 'DOGE', name: 'Dogecoin', type: 'PERP', price: 0.3821, change24h: 4.27, volume24h: 488_600_000, openInterest: 156_200_000, fundingRate: 0.0098 },
  { symbol: 'LINK', name: 'Chainlink', type: 'PERP', price: 22.13, change24h: 0.86, volume24h: 176_300_000, openInterest: 64_100_000, fundingRate: 0.0052 },
  { symbol: 'ARB', name: 'Arbitrum', type: 'PERP', price: 1.084, change24h: -2.55, volume24h: 142_900_000, openInterest: 51_700_000, fundingRate: 0.0041 },
  { symbol: 'SUI', name: 'Sui', type: 'PERP', price: 4.62, change24h: 7.34, volume24h: 388_100_000, openInterest: 121_400_000, fundingRate: 0.0128 },
  { symbol: 'XRP', name: 'XRP', type: 'PERP', price: 2.341, change24h: -0.72, volume24h: 521_700_000, openInterest: 187_300_000, fundingRate: 0.0033 },
  { symbol: 'WIF', name: 'dogwifhat', type: 'PERP', price: 2.91, change24h: 9.12, volume24h: 198_400_000, openInterest: 47_200_000, fundingRate: 0.0211 },
  { symbol: 'PEPE', name: 'Pepe', type: 'PERP', price: 0.0000178, change24h: -4.61, volume24h: 233_500_000, openInterest: 58_900_000, fundingRate: 0.0186 },
]

export const spotMarkets: MarketRow[] = [
  { symbol: 'HYPE/USDC', name: 'Hyperliquid', type: 'SPOT', price: 28.71, change24h: 5.74, volume24h: 142_300_000, marketCap: 9_600_000_000 },
  { symbol: 'BTC/USDC', name: 'Bitcoin', type: 'SPOT', price: 98280, change24h: 2.38, volume24h: 312_800_000, marketCap: 1_940_000_000_000 },
  { symbol: 'ETH/USDC', name: 'Ethereum', type: 'SPOT', price: 3415.2, change24h: 1.08, volume24h: 198_400_000, marketCap: 411_000_000_000 },
  { symbol: 'SOL/USDC', name: 'Solana', type: 'SPOT', price: 215.1, change24h: -3.22, volume24h: 88_700_000, marketCap: 103_000_000_000 },
  { symbol: 'PURR/USDC', name: 'Purr', type: 'SPOT', price: 0.421, change24h: 3.41, volume24h: 12_400_000 },
  { symbol: 'USDC/USDC', name: 'USDC', type: 'SPOT', price: 1.0, change24h: 0.01, volume24h: 540_200_000, marketCap: 42_000_000_000 },
]

export const globalStats = {
  volume24h: perpMarkets.reduce((s, m) => s + m.volume24h, 0) + spotMarkets.reduce((s, m) => s + m.volume24h, 0),
  openInterest: perpMarkets.reduce((s, m) => s + (m.openInterest ?? 0), 0),
  coins: perpMarkets.length + spotMarkets.length,
  perpCount: perpMarkets.length,
  spotCount: spotMarkets.length,
}

export interface VaultHolding {
  symbol: string
  size: number
  valueUsd: number
  pnlPct: number // open pnl percent
}

export interface Vault {
  id: string
  name: string
  manager: string
  managerName: string
  verified: boolean
  return30d: number // percent
  returnAllTime: number // percent
  aum: number // USD
  depositors: number
  maxDrawdown: number // percent (negative)
  leaderboardRank: number
  spark: number[] // recent performance series (indexed to 100)
  history: number[] // cumulative return % series (for detail chart)
  holdings: VaultHolding[] // current open positions
}

export const vaults: Vault[] = [
  { id: 'v1', name: 'Hyperliquid Official', manager: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', managerName: 'Hyperliquid', verified: true, return30d: 12.4, returnAllTime: 184.2, aum: 42_300_000, depositors: 3120, maxDrawdown: -8.4, leaderboardRank: 1, spark: [100, 102, 101, 105, 108, 106, 110, 112, 111, 115, 118, 122] },
  { id: 'v2', name: 'Quant Alpha', manager: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', managerName: '0x3C44…93BC', verified: true, return30d: 9.8, returnAllTime: 96.5, aum: 18_900_000, depositors: 1342, maxDrawdown: -12.1, leaderboardRank: 2, spark: [100, 99, 103, 104, 102, 106, 109, 108, 112, 115, 114, 119] },
  { id: 'v3', name: 'Delta Neutral', manager: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', managerName: '0x90F7…b906', verified: false, return30d: 5.2, returnAllTime: 41.3, aum: 9_400_000, depositors: 684, maxDrawdown: -3.2, leaderboardRank: 4, spark: [100, 101, 102, 101, 103, 104, 103, 105, 106, 105, 107, 108] },
  { id: 'v4', name: 'Momentum Maxi', manager: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', managerName: '0x15d3…A65', verified: true, return30d: 18.6, returnAllTime: 240.1, aum: 27_100_000, depositors: 2011, maxDrawdown: -22.7, leaderboardRank: 3, spark: [100, 104, 108, 103, 112, 118, 115, 124, 121, 130, 128, 139] },
  { id: 'v5', name: 'BTC Yield', manager: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', managerName: '0x9965…A4dc', verified: false, return30d: 3.9, returnAllTime: 28.7, aum: 6_200_000, depositors: 412, maxDrawdown: -5.5, leaderboardRank: 7, spark: [100, 100, 101, 102, 102, 103, 104, 103, 105, 104, 106, 107] },
  { id: 'v6', name: 'Hyperliquid Whales', manager: '0x976EA74026E726554dB657fA54763abd0C3a0aa9', managerName: '0x976E…aa9', verified: true, return30d: 7.1, returnAllTime: 73.4, aum: 13_800_000, depositors: 998, maxDrawdown: -15.3, leaderboardRank: 5, spark: [100, 102, 101, 104, 106, 105, 109, 111, 110, 113, 116, 118] },
]

const VAULT_POOL = ['BTC', 'ETH', 'SOL', 'HYPE', 'AVAX', 'ARB', 'LINK']

// Plausible per-asset prices (USD) so holding sizes read realistically.
const ASSET_PRICE: Record<string, number> = {
  BTC: 95_000,
  ETH: 3_200,
  SOL: 180,
  HYPE: 28,
  AVAX: 35,
  ARB: 0.9,
  LINK: 15,
}

function expandSpark(spark: number[], n: number): number[] {
  // resample the 12-point spark into n cumulative-return % points
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (spark.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(spark.length - 1, lo + 1)
    const f = t - lo
    const v = spark[lo] + (spark[hi] - spark[lo]) * f
    out.push(Number((((v - spark[0]) / spark[0]) * 100).toFixed(2)))
  }
  return out
}

function buildHoldings(seed: number, aum: number): VaultHolding[] {
  let h = seed >>> 0
  const rnd = () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    return h / 0x7fffffff
  }
  const count = 3 + Math.floor(rnd() * 3)
  const picks = [...VAULT_POOL].sort(() => rnd() - 0.5).slice(0, count)
  return picks.map((symbol, i) => {
    const weight = (i === 0 ? 0.45 : 0.55 / count) * (0.7 + rnd() * 0.6)
    const valueUsd = Math.max(50_000, Math.round(aum * weight))
    const pnlPct = Number((rnd() * 60 - 20).toFixed(1))
    const price = ASSET_PRICE[symbol] ?? 10
    const size = Number((valueUsd / price).toFixed(price < 1 ? 2 : 3))
    return { symbol, size, valueUsd, pnlPct }
  })
}

vaults.forEach((v, i) => {
  v.history = expandSpark(v.spark, 30)
  v.holdings = buildHoldings((v.id.charCodeAt(1) * 7919 + i * 131) >>> 0, v.aum)
})

export interface LeaderHolding {
  symbol: string
  size: number
  valueUsd: number
  pnlPct: number
}

export interface LeaderRow {
  rank: number
  address: string
  pnl: number // USD
  volume: number // USD
  roi: number // percent
  winRate: number // percent
  trades: number
  pnlHistory: number[] // cumulative PnL series for detail chart
  holdings: LeaderHolding[] // current open positions
}

export const leaderboard: LeaderRow[] = [
  { rank: 1, address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', pnl: 4_812_300, volume: 182_400_000, roi: 312.4, winRate: 68.2, trades: 1240 },
  { rank: 2, address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', pnl: 3_204_900, volume: 141_200_000, roi: 248.1, winRate: 64.5, trades: 980 },
  { rank: 3, address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', pnl: 2_518_700, volume: 98_700_000, roi: 201.3, winRate: 61.8, trades: 743 },
  { rank: 4, address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', pnl: 1_932_400, volume: 76_300_000, roi: 176.9, winRate: 59.2, trades: 612 },
  { rank: 5, address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', pnl: 1_204_800, volume: 54_100_000, roi: 142.7, winRate: 57.4, trades: 521 },
  { rank: 6, address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9', pnl: 876_300, volume: 41_900_000, roi: 118.3, winRate: 55.1, trades: 433 },
  { rank: 7, address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955', pnl: 642_100, volume: 33_200_000, roi: 98.6, winRate: 53.7, trades: 388 },
  { rank: 8, address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f', pnl: 488_900, volume: 27_800_000, roi: 84.2, winRate: 52.3, trades: 311 },
  { rank: 9, address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', pnl: 351_400, volume: 21_400_000, roi: 71.5, winRate: 51.0, trades: 276 },
  { rank: 10, address: '0xBcd4042DE499D14e55001CcbB24a551F3b954E45', pnl: 244_700, volume: 17_900_000, roi: 63.1, winRate: 49.8, trades: 244 },
  { rank: 11, address: '0x71bE63f3384f5fb98995898A86B02Fb1cFbE8c1b', pnl: 182_300, volume: 14_200_000, roi: 54.8, winRate: 48.6, trades: 209 },
  { rank: 12, address: '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a', pnl: 121_900, volume: 11_800_000, roi: 47.3, winRate: 47.2, trades: 187 },
]

function buildPnlHistory(seed: number, finalPnl: number, n = 30): number[] {
  let h = seed >>> 0
  const rnd = () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    return h / 0x7fffffff
  }
  const out: number[] = []
  let v = 0
  for (let i = 0; i < n; i++) {
    const target = (finalPnl * (i / (n - 1)))
    v = target + (rnd() - 0.5) * Math.max(20_000, finalPnl * 0.04)
    out.push(Math.round(v))
  }
  // anchor endpoints
  out[0] = 0
  out[n - 1] = finalPnl
  return out
}

leaderboard.forEach((r, i) => {
  r.pnlHistory = buildPnlHistory((r.address.charCodeAt(2) * 104729 + i * 977) >>> 0, r.pnl)
  r.holdings = buildHoldings((r.address.charCodeAt(4) * 524287 + i * 311) >>> 0, Math.max(200_000, r.volume * 0.01))
})

export interface StakeProduct {
  id: string
  name: string
  symbol: string
  apy: number // percent
  tvl: number // USD
  yourPosition: number // tokens
  yourPositionUsd: number // derived USD value of your position
  description: string
  action: 'Stake' | 'Deposit'
  apyHistory: number[] // APY over time (percent)
  tvlHistory: number[] // TVL over time (USD, millions)
}

export const stakeProducts: StakeProduct[] = [
  { id: 'hype', name: 'Staked HYPE', symbol: 'HYPE', apy: 2.84, tvl: 312_400_000, yourPosition: 0, description: 'Stake HYPE to secure the Hyperliquid L1 and earn protocol fees. Unstakes over 1 epoch (~a few hours).', action: 'Stake' },
  { id: 'sthype', name: 'Liquid Staked HYPE', symbol: 'stHYPE', apy: 3.12, tvl: 156_800_000, yourPosition: 0, description: 'Liquid staking token — keep liquidity while earning HYPE staking rewards.', action: 'Stake' },
  { id: 'hlp', name: 'Hyperliquidity Provider', symbol: 'HLP', apy: 14.6, tvl: 221_900_000, yourPosition: 0, description: 'Provide liquidity to the HLP vault; earns trading fees and is the counterparty to traders.', action: 'Deposit' },
  { id: 'ustb', name: 'USTB', symbol: 'USTB', apy: 4.51, tvl: 88_300_000, yourPosition: 0, description: 'Tokenized Treasury fund backed by short-term US Treasuries.', action: 'Deposit' },
]

function buildEarnHistory(seed: number, apy: number, tvlUsd: number, n = 30): { apyHistory: number[]; tvlHistory: number[] } {
  let h = seed >>> 0
  const rnd = () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    return h / 0x7fffffff
  }
  const apyHistory: number[] = []
  const tvlHistory: number[] = []
  let tvl = tvlUsd * (0.7 + rnd() * 0.1) // start lower, grows toward current
  for (let i = 0; i < n; i++) {
    apyHistory.push(Number((apy + (rnd() - 0.5) * apy * 0.4).toFixed(2)))
    tvl += (tvlUsd - tvl) / (n - i) + (rnd() - 0.5) * tvlUsd * 0.02
    tvlHistory.push(Number((tvl / 1_000_000).toFixed(1)))
  }
  apyHistory[n - 1] = apy
  tvlHistory[n - 1] = Number((tvlUsd / 1_000_000).toFixed(1))
  return { apyHistory, tvlHistory }
}

stakeProducts.forEach((p, i) => {
  const { apyHistory, tvlHistory } = buildEarnHistory((p.id.charCodeAt(0) * 6151 + i * 271) >>> 0, p.apy, p.tvl)
  p.apyHistory = apyHistory
  p.tvlHistory = tvlHistory
  // HYPE price ~22 for converting token position to USD
  const px = p.symbol === 'HYPE' ? 22 : p.symbol === 'stHYPE' ? 22.4 : p.symbol === 'HLP' ? 1.0 : 1.0
  p.yourPositionUsd = Number((p.yourPosition * px).toFixed(2))
})

export const referralInfo = {
  code: 'COKE420',
  link: 'https://hyperliquid.xyz/ref/COKE420',
  totalReferred: 47,
  commissionEarned: 18_240.5,
  yourTier: 'Tier 3',
  yourShare: 0.12, // 12%
}

export const referralTiers = [
  { tier: 'Tier 1', referred: '1-10', share: '10%', requirement: '1+ referred user' },
  { tier: 'Tier 2', referred: '11-25', share: '11%', requirement: '11+ referred users' },
  { tier: 'Tier 3', referred: '26-50', share: '12%', requirement: '26+ referred users' },
  { tier: 'Tier 4', referred: '51-100', share: '14%', requirement: '51+ referred users' },
  { tier: 'Tier 5', referred: '100+', share: '16%', requirement: '100+ referred users' },
]

export const recentReferrals = [
  { address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', date: '2026-10-15', volume: 84_200, commission: 210.5 },
  { address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', date: '2026-10-12', volume: 51_900, commission: 129.8 },
  { address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9', date: '2026-10-09', volume: 38_400, commission: 96.0 },
  { address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955', date: '2026-10-05', volume: 22_100, commission: 55.3 },
  { address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f', date: '2026-10-01', volume: 15_700, commission: 39.3 },
]

/**
 * Resolve market metadata (price / 24h change / volume) for any symbol.
 * Accepts "BTC", "BTC/USDC" or "BTC-PERP" forms and matches by base asset
 * against the Markets-page fixtures so the trade page stays consistent with
 * the market table. Falls back to a deterministic value for unknown symbols.
 */
export function getMarketMeta(
  symbol: string
): { price: number; change24h: number; volume24h: number } {
  const base = symbol.replace(/\/(USDC|PERP)$/i, '').toUpperCase()
  const all = [...perpMarkets, ...spotMarkets]
  const m = all.find((x) => x.symbol.replace(/\/(USDC|PERP)$/i, '').toUpperCase() === base)
  if (m) return { price: m.price, change24h: m.change24h, volume24h: m.volume24h }

  // Deterministic fallback for symbols not in the fixtures (stable per symbol).
  let h = 0
  for (const c of base) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const price = 5 + (h % 500)
  const change24h = ((h >> 3) % 200) / 10 - 10 // roughly -10%..+10%
  return { price, change24h, volume24h: 1_000_000 + (h % 50) * 100_000 }
}
