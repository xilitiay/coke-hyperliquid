<template>
  <SectionShell
    title="Markets"
    subtitle="Live market statistics across perpetual and spot markets"
  >
    <!-- Global stats bar -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <StatCard label="24h Volume" :value="formatUsdCompact(globalStats.volume24h)" />
      <StatCard label="Open Interest" :value="formatUsdCompact(globalStats.openInterest)" />
      <StatCard label="Coins" :value="String(globalStats.coins)" />
      <StatCard label="Perp / Spot" :value="`${globalStats.perpCount} / ${globalStats.spotCount}`" />
    </div>

    <!-- Controls -->
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <div class="flex gap-1 bg-bg-secondary rounded-lg p-1">
        <button
          v-for="t in tabs"
          :key="t"
          @click="activeTab = t"
          class="px-4 py-1.5 text-sm rounded-md font-medium transition-colors"
          :class="activeTab === t ? 'bg-bg-primary text-text-primary' : 'text-text-secondary hover:text-text-primary'"
        >
          {{ t }}
        </button>
      </div>
      <div class="relative">
        <input
          v-model="search"
          type="text"
          placeholder="Search markets"
          class="input-field w-56 py-1.5 text-sm"
        />
      </div>
    </div>

    <!-- Market table -->
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-text-tertiary text-xs border-b border-border-primary">
            <th class="text-left font-medium px-4 py-3">#</th>
            <th class="text-left font-medium px-4 py-3">Market</th>
            <th class="text-right font-medium px-4 py-3 cursor-pointer" @click="setSort('price')">
              Price <span class="ml-1 text-text-tertiary">{{ sortIcon('price') }}</span>
            </th>
            <th class="text-right font-medium px-4 py-3 cursor-pointer" @click="setSort('change24h')">
              24h Change <span class="ml-1">{{ sortIcon('change24h') }}</span>
            </th>
            <th class="text-right font-medium px-4 py-3 cursor-pointer" @click="setSort('volume24h')">
              24h Volume <span class="ml-1">{{ sortIcon('volume24h') }}</span>
            </th>
            <th v-if="activeTab === 'Perp'" class="text-right font-medium px-4 py-3 cursor-pointer" @click="setSort('openInterest')">
              OI <span class="ml-1">{{ sortIcon('openInterest') }}</span>
            </th>
            <th v-if="activeTab === 'Perp'" class="text-right font-medium px-4 py-3">Funding</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(m, i) in filtered"
            :key="m.symbol"
            @click="openMarket(m)"
            class="border-b border-border-primary/50 hover:bg-bg-secondary cursor-pointer transition-colors"
          >
            <td class="px-4 py-3 text-text-tertiary mono-number">{{ i + 1 }}</td>
            <td class="px-4 py-3">
              <div class="font-medium text-text-primary">{{ m.symbol }}</div>
              <div class="text-xs text-text-tertiary">{{ m.name }}</div>
            </td>
            <td class="px-4 py-3 text-right mono-number text-text-primary">
              ${{ m.price < 1 ? m.price.toPrecision(4) : formatNumber(m.price) }}
            </td>
            <td class="px-4 py-3 text-right mono-number" :class="changeClass(m.change24h)">
              {{ formatPercent(m.change24h) }}
            </td>
            <td class="px-4 py-3 text-right mono-number text-text-secondary">
              {{ formatUsdCompact(m.volume24h) }}
            </td>
            <td v-if="activeTab === 'Perp'" class="px-4 py-3 text-right mono-number text-text-secondary">
              {{ m.openInterest !== undefined ? formatUsdCompact(m.openInterest) : '—' }}
            </td>
            <td v-if="activeTab === 'Perp'" class="px-4 py-3 text-right mono-number text-text-secondary">
              {{ m.fundingRate !== undefined ? formatPercent(m.fundingRate, false) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </SectionShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import SectionShell from '@/components/layout/SectionShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import { perpMarkets, spotMarkets, globalStats, type MarketRow } from '@/data/demoData'
import { formatNumber, formatUsdCompact, formatPercent, changeClass } from '@/utils/format'

const router = useRouter()

const tabs = ['Perp', 'Spot']
const activeTab = ref<'Perp' | 'Spot'>('Perp')
const search = ref('')
const sortKey = ref<keyof MarketRow>('volume24h')
const sortDir = ref<1 | -1>(-1)

const source = computed<MarketRow[]>(() =>
  activeTab.value === 'Perp' ? perpMarkets : spotMarkets
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  let rows = source.value
  if (q) rows = rows.filter((m) => m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
  const key = sortKey.value
  return [...rows].sort((a, b) => {
    const av = (a[key] as number) ?? 0
    const bv = (b[key] as number) ?? 0
    return (av - bv) * sortDir.value
  })
})

const setSort = (key: keyof MarketRow) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 1 ? -1 : 1
  } else {
    sortKey.value = key
    sortDir.value = -1
  }
}

const sortIcon = (key: keyof MarketRow) => {
  if (sortKey.value !== key) return ''
  return sortDir.value === 1 ? '▲' : '▼'
}

const openMarket = (m: MarketRow) => {
  // Navigate to trade with the selected symbol
  const symbol = activeTab.value === 'Perp' ? m.symbol : m.symbol.split('/')[0]
  router.push({ path: '/trade', query: { symbol } })
}
</script>
