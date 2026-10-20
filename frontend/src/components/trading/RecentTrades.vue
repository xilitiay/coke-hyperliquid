<template>
  <div class="card h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-border-primary">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-text-primary">Recent Trades</span>
        <div v-if="wsConnected" class="w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Live"></div>
      </div>
    </div>

    <!-- Column Headers -->
    <div class="grid grid-cols-3 px-4 py-2 text-xs text-text-tertiary border-b border-border-primary">
      <span>Price</span>
      <span class="text-right">Amount</span>
      <span class="text-right">Time</span>
    </div>

    <!-- Trades List -->
    <div class="flex-1 overflow-y-auto px-4">
      <div
        v-for="(trade, index) in displayTrades"
        :key="trade.tradeId || index"
        class="grid grid-cols-3 py-1 text-sm hover:bg-bg-secondary transition-colors"
      >
        <span
          class="mono-number font-medium"
          :class="trade.side === 'BUY' ? 'text-buy' : 'text-sell'"
        >
          {{ formatPrice(trade.price) }}
        </span>
        <span class="text-right mono-number text-text-primary">
          {{ formatAmount(trade.quantity) }}
        </span>
        <span class="text-right text-text-tertiary text-xs">
          {{ formatTime(trade.timestamp) }}
        </span>
      </div>

      <!-- Empty State -->
      <div v-if="displayTrades.length === 0" class="py-8 text-center text-text-tertiary text-sm">
        No recent trades
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import websocketService, { subscribeToTrades } from '@/services/websocket'
import { getMarketMeta } from '@/data/demoData'

const props = defineProps<{
  symbol?: string
}>()

interface Trade {
  tradeId: string
  symbol: string
  price: string
  quantity: string
  side: 'BUY' | 'SELL'
  timestamp: number
}

const trades = ref<Trade[]>([])
const wsConnected = ref(false)
const maxTrades = 50 // Keep last 50 trades

// Seed plausible mock trades centered on the symbol's price, used when the
// WebSocket delivers nothing (e.g. symbols the demo backend doesn't stream).
const seedMockTrades = () => {
  const symbol = props.symbol || 'BTC/USDC'
  const price = getMarketMeta(symbol).price
  const decimals = price < 1 ? 5 : 2
  const now = Date.now()
  trades.value = Array.from({ length: 18 }, (_, i) => {
    const side: 'BUY' | 'SELL' = Math.random() > 0.5 ? 'BUY' : 'SELL'
    const p = price * (1 + (Math.random() - 0.5) * 0.002)
    return {
      tradeId: `mock-${now}-${i}`,
      symbol,
      price: p.toFixed(decimals),
      quantity: (Math.random() * 2 + 0.01).toFixed(4),
      side,
      timestamp: now - i * (3000 + Math.floor(Math.random() * 4000)),
    }
  })
}

// If the WS hasn't delivered any trades shortly after load, fall back to mock.
const scheduleSeed = () => {
  setTimeout(() => {
    if (trades.value.length === 0) seedMockTrades()
  }, 1200)
}

// WebSocket message handler
const handleTradeUpdate = (data: any) => {
  if (data.data) {
    const newTrade = data.data

    // Add new trade to the beginning of the array
    trades.value.unshift(newTrade)

    // Keep only the most recent trades
    if (trades.value.length > maxTrades) {
      trades.value = trades.value.slice(0, maxTrades)
    }

    wsConnected.value = true
  }
}

// Subscribe to WebSocket updates
const subscribeToUpdates = () => {
  const symbol = props.symbol || 'BTC/USDC'
  subscribeToTrades(symbol, handleTradeUpdate)
  console.log(`Subscribed to trades:${symbol}`)
}

// Unsubscribe from WebSocket updates
const unsubscribeFromUpdates = () => {
  const symbol = props.symbol || 'BTC/USDC'
  websocketService.unsubscribe(`trades:${symbol}`, handleTradeUpdate)
  console.log(`Unsubscribed from trades:${symbol}`)
}

// Display trades (limit to 20 for UI)
const displayTrades = computed(() => {
  return trades.value.slice(0, 20)
})

// Format price with commas
const formatPrice = (price: string) => {
  return parseFloat(price).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Format amount
const formatAmount = (amount: string) => {
  return parseFloat(amount).toFixed(4)
}

// Format timestamp to HH:MM:SS
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

onMounted(async () => {
  // Connect to WebSocket
  try {
    await websocketService.connect()
    subscribeToUpdates()
    console.log('WebSocket connected for RecentTrades')
  } catch (error) {
    console.error('Failed to connect WebSocket:', error)
  }
  scheduleSeed()
})

onUnmounted(() => {
  unsubscribeFromUpdates()
})

// Watch for symbol changes
watch(() => props.symbol, (newSymbol, oldSymbol) => {
  if (newSymbol && oldSymbol && newSymbol !== oldSymbol) {
    // Clear trades for new symbol
    trades.value = []
    // Unsubscribe from old symbol
    websocketService.unsubscribe(`trades:${oldSymbol}`, handleTradeUpdate)
    // Subscribe to new symbol
    subscribeToUpdates()
    // Seed mock trades if the new symbol has no live data
    scheduleSeed()
  }
})
</script>
