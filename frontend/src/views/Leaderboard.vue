<template>
  <SectionShell title="Leaderboard" subtitle="Top traders and vaults ranked by performance">
    <!-- Metric tabs -->
    <div class="flex gap-1 bg-bg-secondary rounded-lg p-1 mb-3 w-fit">
      <button
        v-for="m in metrics"
        :key="m.key"
        @click="activeMetric = m.key"
        class="px-4 py-1.5 text-sm rounded-md font-medium transition-colors"
        :class="activeMetric === m.key ? 'bg-bg-primary text-text-primary' : 'text-text-secondary hover:text-text-primary'"
      >
        {{ m.label }}
      </button>
    </div>

    <!-- Timeframe tabs (traders only) -->
    <div v-if="activeMetric !== 'vaults'" class="flex gap-1 bg-bg-secondary rounded-lg p-1 mb-4 w-fit">
      <button
        v-for="tf in timeframes"
        :key="tf"
        @click="activeTf = tf"
        class="px-4 py-1.5 text-sm rounded-md font-medium transition-colors"
        :class="activeTf === tf ? 'bg-bg-primary text-text-primary' : 'text-text-secondary hover:text-text-primary'"
      >
        {{ tf }}
      </button>
    </div>

    <!-- Trader table -->
    <div v-if="activeMetric !== 'vaults'" class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-text-tertiary text-xs border-b border-border-primary">
            <th class="text-left font-medium px-4 py-3 w-16">Rank</th>
            <th class="text-left font-medium px-4 py-3">Trader</th>
            <th class="text-right font-medium px-4 py-3">{{ activeMetric === 'pnl' ? 'PnL' : 'Volume' }}</th>
            <th class="text-right font-medium px-4 py-3">{{ activeMetric === 'pnl' ? 'Volume' : 'PnL' }}</th>
            <th class="text-right font-medium px-4 py-3">ROI</th>
            <th class="text-right font-medium px-4 py-3">Win Rate</th>
            <th class="text-right font-medium px-4 py-3">Trades</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in traderRows"
            :key="row.rank"
            @click="openTrader(row)"
            class="border-b border-border-primary/50 hover:bg-bg-secondary transition-colors cursor-pointer"
            :class="row.rank <= 3 ? 'bg-bg-secondary/40' : ''"
          >
            <td class="px-4 py-3">
              <span
                class="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
                :class="rankClass(row.rank)"
              >{{ row.rank }}</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <span class="font-mono text-text-primary">{{ shortenAddress(row.address) }}</span>
                <button @click.stop="copy(row.address)" class="text-text-tertiary hover:text-accent-primary" title="Copy">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </td>
            <td class="px-4 py-3 text-right mono-number font-medium" :class="activeMetric === 'pnl' ? 'price-up' : 'text-text-primary'">{{ formatUsdCompact(activeMetric === 'pnl' ? row.pnl : row.volume) }}</td>
            <td class="px-4 py-3 text-right mono-number text-text-secondary">{{ formatUsdCompact(activeMetric === 'pnl' ? row.volume : row.pnl) }}</td>
            <td class="px-4 py-3 text-right mono-number" :class="changeClass(row.roi)">{{ formatPercent(row.roi) }}</td>
            <td class="px-4 py-3 text-right mono-number text-text-primary">{{ row.winRate.toFixed(1) }}%</td>
            <td class="px-4 py-3 text-right mono-number text-text-secondary">{{ row.trades }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Vault table -->
    <div v-else class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-text-tertiary text-xs border-b border-border-primary">
            <th class="text-left font-medium px-4 py-3 w-16">Rank</th>
            <th class="text-left font-medium px-4 py-3">Vault</th>
            <th class="text-right font-medium px-4 py-3">30d Return</th>
            <th class="text-right font-medium px-4 py-3">AUM</th>
            <th class="text-right font-medium px-4 py-3">Depositors</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(v, i) in vaultRows"
            :key="v.id"
            @click="router.push(`/vaults/${v.id}`)"
            class="border-b border-border-primary/50 hover:bg-bg-secondary transition-colors cursor-pointer"
            :class="i < 3 ? 'bg-bg-secondary/40' : ''"
          >
            <td class="px-4 py-3">
              <span class="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" :class="rankClass(i + 1)">{{ i + 1 }}</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-text-primary">{{ v.name }}</span>
                <span class="text-xs text-text-tertiary">{{ v.managerName }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-right mono-number font-medium" :class="changeClass(v.return30d)">{{ formatPercent(v.return30d) }}</td>
            <td class="px-4 py-3 text-right mono-number text-text-primary">{{ formatUsdCompact(v.aum) }}</td>
            <td class="px-4 py-3 text-right mono-number text-text-secondary">{{ formatCompact(v.depositors) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-text-tertiary mt-3">Figures are illustrative demo data scaled by the selected timeframe.</p>

    <!-- Trader detail modal -->
    <div
      v-if="selected"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="selected = null"
    >
      <div class="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-bold text-text-primary font-mono">{{ shortenAddress(selected.address) }}</h2>
            <button @click="copy(selected.address)" class="text-text-tertiary hover:text-accent-primary" title="Copy">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          <button @click="selected = null" class="text-text-tertiary hover:text-text-primary text-2xl leading-none">×</button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="PnL" :value="formatUsdCompact(selected.pnl)" :sub-positive="true" />
          <StatCard label="Volume" :value="formatUsdCompact(selected.volume)" />
          <StatCard label="ROI" :value="formatPercent(selected.roi)" :sub-positive="selected.roi >= 0" />
          <StatCard label="Win Rate" :value="`${selected.winRate.toFixed(1)}%`" />
        </div>

        <div class="card p-4 mb-4">
          <h3 class="font-semibold text-text-primary mb-2">Cumulative PnL (30d)</h3>
          <LineChart :data="selected.pnlHistory" :labels="rangeLabels(30)" :format-value="(v) => formatUsdCompact(v)" />
        </div>

        <h3 class="font-semibold text-text-primary mb-2">Open Positions</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-text-tertiary text-xs border-b border-border-primary">
                <th class="text-left py-2 px-2">Asset</th>
                <th class="text-right py-2 px-2">Size</th>
                <th class="text-right py-2 px-2">Value</th>
                <th class="text-right py-2 px-2">PnL</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in selected.holdings" :key="h.symbol" class="border-b border-border-primary/50">
                <td class="py-2 px-2 font-medium text-text-primary">{{ h.symbol }}</td>
                <td class="py-2 px-2 text-right mono-number text-text-secondary">{{ formatNumber(h.size) }}</td>
                <td class="py-2 px-2 text-right mono-number text-text-primary">{{ formatUsdCompact(h.valueUsd) }}</td>
                <td class="py-2 px-2 text-right mono-number" :class="changeClass(h.pnlPct)">{{ formatPercent(h.pnlPct) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </SectionShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import SectionShell from '@/components/layout/SectionShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import LineChart from '@/components/common/LineChart.vue'
import { leaderboard, vaults, type LeaderRow } from '@/data/demoData'
import { formatUsdCompact, formatPercent, formatCompact, formatNumber, shortenAddress, changeClass, copyToClipboard } from '@/utils/format'

const router = useRouter()

const metrics = [
  { key: 'pnl', label: 'PnL' },
  { key: 'volume', label: 'Volume' },
  { key: 'vaults', label: 'Vaults' },
]
const timeframes = ['24h', '7d', '30d', 'All']
const activeMetric = ref<'pnl' | 'volume' | 'vaults'>('pnl')
const activeTf = ref('All')

const scaleFor: Record<string, number> = { '24h': 0.04, '7d': 0.18, '30d': 0.62, 'All': 1 }

const traderRows = computed<LeaderRow[]>(() => {
  const s = scaleFor[activeTf.value]
  const rows = leaderboard.map((r) => ({
    ...r,
    pnl: Math.round(r.pnl * s),
    volume: Math.round(r.volume * s),
    trades: Math.round(r.trades * s),
    pnlHistory: r.pnlHistory.map((v) => Math.round(v * s)),
  }))
  const key: 'pnl' | 'volume' = activeMetric.value === 'volume' ? 'volume' : 'pnl'
  return [...rows].sort((a, b) => b[key] - a[key]).map((r, i) => ({ ...r, rank: i + 1 }))
})

const vaultRows = computed(() => [...vaults].sort((a, b) => b.aum - a.aum))

const selected = ref<LeaderRow | null>(null)
const openTrader = (row: LeaderRow) => (selected.value = row)

const rankClass = (rank: number) => {
  if (rank === 1) return 'bg-yellow-500/20 text-yellow-400'
  if (rank === 2) return 'bg-gray-400/20 text-gray-300'
  if (rank === 3) return 'bg-amber-700/30 text-amber-500'
  return 'bg-bg-primary text-text-secondary'
}

function rangeLabels(n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(i === 0 ? 'Today' : `-${i}d`)
  return out
}

const copy = async (addr: string) => {
  await copyToClipboard(addr)
}
</script>
