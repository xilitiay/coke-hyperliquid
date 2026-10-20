<template>
  <div class="h-full flex flex-col bg-bg-tertiary">
    <!-- Navbar -->
    <Navbar />

    <!-- Market Info -->
    <div class="px-2 py-2">
      <MarketInfo :symbol="symbol" @symbol-change="onSymbolChange" />
    </div>

    <!-- Main Trading Grid - Desktop -->
    <div class="hidden lg:grid flex-1 gap-2 px-2 pb-2 overflow-hidden trading-grid-desktop">
      <!-- Chart Area -->
      <div class="overflow-hidden" style="grid-area: chart;">
        <TradingChart :symbol="symbol" />
      </div>

      <!-- Order Book -->
      <div class="overflow-hidden" style="grid-area: orderbook;">
        <OrderBook :symbol="symbol" />
      </div>

      <!-- Recent Trades -->
      <div class="overflow-hidden" style="grid-area: trades;">
        <RecentTrades :symbol="symbol" />
      </div>

      <!-- Trade Form -->
      <div class="overflow-hidden" style="grid-area: tradeform;">
        <TradeForm :symbol="symbol" :is-perpetual="false" />
      </div>

      <!-- Account Equity -->
      <div class="overflow-hidden" style="grid-area: account;">
        <AccountEquity />
      </div>

      <!-- Positions Panel -->
      <div class="overflow-hidden" style="grid-area: positions;">
        <PositionsPanel />
      </div>
    </div>

    <!-- Main Trading Layout - Tablet -->
    <div class="hidden md:grid lg:hidden flex-1 gap-2 px-2 pb-2 overflow-hidden trading-grid-tablet">
      <!-- Chart Area -->
      <div class="overflow-hidden" style="grid-area: chart;">
        <TradingChart />
      </div>

      <!-- Order Book -->
      <div class="overflow-hidden" style="grid-area: orderbook;">
        <OrderBook />
      </div>

      <!-- Trade Form -->
      <div class="overflow-hidden" style="grid-area: tradeform;">
        <TradeForm :symbol="symbol" :is-perpetual="false" />
      </div>

      <!-- Positions Panel -->
      <div class="overflow-hidden" style="grid-area: positions;">
        <PositionsPanel />
      </div>
    </div>

    <!-- Main Trading Layout - Mobile -->
    <div class="md:hidden flex-1 overflow-y-auto px-2 pb-2">
      <!-- Mobile Tabs -->
      <div class="sticky top-0 z-10 bg-bg-tertiary pb-2">
        <div class="flex gap-2 overflow-x-auto no-scrollbar">
          <button
            v-for="tab in mobileTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
            :class="activeTab === tab.id
              ? 'bg-accent-primary text-bg-primary'
              : 'bg-bg-secondary text-text-secondary'"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- Mobile Content -->
      <div class="space-y-2">
        <!-- Chart Tab -->
        <div v-show="activeTab === 'chart'" class="h-[400px]">
          <TradingChart />
        </div>

        <!-- Trade Tab -->
        <div v-show="activeTab === 'trade'">
          <TradeForm :symbol="symbol" :is-perpetual="false" />
        </div>

        <!-- Orderbook Tab -->
        <div v-show="activeTab === 'orderbook'" class="h-[500px]">
          <OrderBook />
        </div>

        <!-- Trades Tab -->
        <div v-show="activeTab === 'trades'" class="h-[500px]">
          <RecentTrades />
        </div>

        <!-- Account Tab -->
        <div v-show="activeTab === 'account'" class="h-[600px]">
          <AccountEquity />
        </div>

        <!-- Positions Tab -->
        <div v-show="activeTab === 'positions'">
          <PositionsPanel />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Navbar from '@/components/layout/Navbar.vue'
import MarketInfo from '@/components/trading/MarketInfo.vue'
import TradingChart from '@/components/trading/TradingChart.vue'
import OrderBook from '@/components/trading/OrderBook.vue'
import TradeForm from '@/components/trading/TradeForm.vue'
import PositionsPanel from '@/components/trading/PositionsPanel.vue'
import RecentTrades from '@/components/trading/RecentTrades.vue'
import AccountEquity from '@/components/trading/AccountEquity.vue'
import { useMarketStore } from '@/stores/market'

const route = useRoute()
const router = useRouter()
const marketStore = useMarketStore()

// Active trading pair, driven by the route query (?symbol=) and shared via the market store.
const symbol = ref(marketStore.currentSymbol || 'BTC/USDC')

// Markets/spot symbols arrive as a base asset (e.g. "BTC", "HYPE"); normalize to "BTC/USDC" form.
const normalizeSymbol = (s: string): string =>
  s && s.includes('/') ? s : `${s}/USDC`

const applySymbolFromRoute = () => {
  const raw = (route.query.symbol as string) || marketStore.currentSymbol || 'BTC/USDC'
  const s = normalizeSymbol(raw)
  symbol.value = s
  if (marketStore.currentSymbol !== s) marketStore.setCurrentSymbol(s)
}

// When the in-page pair dropdown changes, reflect it back into the URL.
const onSymbolChange = (s: string) => {
  router.replace({ query: { ...route.query, symbol: normalizeSymbol(s) } })
}

onMounted(applySymbolFromRoute)
watch(() => route.query.symbol, applySymbolFromRoute)

const activeTab = ref('chart')

const mobileTabs = [
  { id: 'chart', label: 'Chart' },
  { id: 'trade', label: 'Trade' },
  { id: 'orderbook', label: 'Book' },
  { id: 'trades', label: 'Trades' },
  { id: 'account', label: 'Account' },
  { id: 'positions', label: 'Positions' },
]
</script>

<style scoped>
/* Desktop Layout */
.trading-grid-desktop {
  grid-template-areas:
    "chart chart orderbook tradeform"
    "chart chart trades account"
    "positions positions positions positions";
  grid-template-columns: 1fr 1fr 300px 340px;
  /* minmax floors keep the trade form's submit button reachable on short
     viewports (without them the 1fr rows collapse and clip the button). */
  grid-template-rows: minmax(210px, 1fr) minmax(160px, 1fr) 240px;
}

/* Tablet Layout */
.trading-grid-tablet {
  grid-template-areas:
    "chart chart"
    "orderbook tradeform"
    "positions positions";
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 400px auto auto;
}
</style>
