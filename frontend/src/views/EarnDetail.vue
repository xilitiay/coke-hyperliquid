<template>
  <SectionShell :title="product ? product.name : 'Earn'" subtitle="Product yield, history and your position">
    <template #actions>
      <RouterLink to="/staking" class="btn text-sm">← All Products</RouterLink>
    </template>

    <div v-if="!product" class="card p-6 text-center text-text-tertiary">
      Product not found. <RouterLink to="/staking" class="text-accent-primary">Back to Earn</RouterLink>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="card p-5 mb-4">
        <div class="flex items-start justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center text-accent-primary font-bold text-lg">
              {{ product.symbol.charAt(0) }}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-2xl font-bold text-text-primary">{{ product.name }}</h2>
                <span class="text-xs px-2 py-0.5 rounded bg-bg-secondary text-text-secondary">{{ product.symbol }}</span>
              </div>
              <p class="text-xs text-text-tertiary mt-0.5 max-w-md">{{ product.description }}</p>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs text-text-tertiary">APY</div>
            <div class="text-2xl font-bold mono-number price-up">{{ formatPercent(product.apy, false) }}</div>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="APY" :value="formatPercent(product.apy, false)" :sub-positive="true" />
        <StatCard label="TVL" :value="formatUsdCompact(product.tvl)" />
        <StatCard label="Your Position" :value="`${formatNumber(product.yourPosition, 2, 4)} ${product.symbol}`" :sub="formatUsdCompact(product.yourPositionUsd)" />
        <StatCard label="Est. Rewards (30d)" :value="`${formatNumber(product.yourPositionUsd * product.apy / 100 / 12, 2, 4)} USDC`" />
      </div>

      <!-- History charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div class="card p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-text-primary">APY (30d)</h3>
            <span class="text-xs mono-number price-up">{{ formatPercent(product.apy, false) }}</span>
          </div>
          <LineChart :data="product.apyHistory" :labels="rangeLabels(30)" :color="'#50d2c1'" :format-value="(v) => formatPercent(v, false)" />
        </div>
        <div class="card p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-text-primary">TVL (30d, $M)</h3>
            <span class="text-xs mono-number text-text-primary">{{ formatUsdCompact(product.tvl) }}</span>
          </div>
          <LineChart :data="product.tvlHistory" :labels="rangeLabels(30)" :color="'#1fa67d'" :format-value="(v) => `$${v}M`" />
        </div>
      </div>

      <!-- Deposit / Withdraw -->
      <div class="card p-5">
        <h3 class="font-semibold text-text-primary mb-3">{{ product.action }} {{ product.symbol }}</h3>
        <div class="flex gap-2">
          <input v-model="amount" type="number" min="0" class="input-field" placeholder="0.00" />
          <button class="btn btn-primary px-6 whitespace-nowrap" @click="submit(product.action)">{{ product.action }}</button>
        </div>
        <p v-if="msg" class="text-xs mt-2" :class="msgOk ? 'price-up' : 'text-sell'">{{ msg }}</p>
      </div>
    </template>
  </SectionShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import SectionShell from '@/components/layout/SectionShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import LineChart from '@/components/common/LineChart.vue'
import { stakeProducts, type StakeProduct } from '@/data/demoData'
import { formatPercent, formatUsdCompact, formatNumber } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const product = computed<StakeProduct | undefined>(() => stakeProducts.find((p) => p.id === route.params.id))

const amount = ref('')
const msg = ref('')
const msgOk = ref(false)

function rangeLabels(n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(i === 0 ? 'Today' : `-${i}d`)
  return out
}

function submit(action: string) {
  if (!authStore.isAuthenticated) {
    router.push({ path: '/login', query: { redirect: route.fullPath } })
    return
  }
  const amt = parseFloat(amount.value)
  if (!amt || amt <= 0) {
    msgOk.value = false
    msg.value = 'Enter a valid amount'
    return
  }
  msgOk.value = true
  msg.value = `${action}ed ${amt} ${product.value?.symbol} (demo)`
  amount.value = ''
}
</script>
