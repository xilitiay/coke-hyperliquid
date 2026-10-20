<template>
  <SectionShell :title="vault ? vault.name : 'Vault'" subtitle="Vault performance, holdings and deposits">
    <template #actions>
      <RouterLink to="/vaults" class="btn text-sm">← All Vaults</RouterLink>
    </template>

    <div v-if="!vault" class="card p-6 text-center text-text-tertiary">
      Vault not found. <RouterLink to="/vaults" class="text-accent-primary">Back to vaults</RouterLink>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="card p-5 mb-4">
        <div class="flex items-start justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center text-accent-primary text-xl font-bold">
              {{ vault.name.charAt(0) }}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-2xl font-bold text-text-primary">{{ vault.name }}</h2>
                <svg v-if="vault.verified" class="w-5 h-5 text-accent-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="text-xs text-text-tertiary mt-0.5 flex items-center gap-2">
                <span>Manager {{ shortenAddress(vault.manager) }}</span>
                <span class="px-1.5 py-0.5 rounded bg-bg-secondary text-text-secondary">#{{ vault.leaderboardRank }} Leaderboard</span>
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary px-5" @click="openDeposit('deposit')">Deposit</button>
            <button class="btn px-5" @click="openDeposit('withdraw')">Withdraw</button>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="30d Return" :value="formatPercent(vault.return30d)" :sub="`All-time ${formatPercent(vault.returnAllTime)}`" :sub-positive="vault.returnAllTime >= 0" />
        <StatCard label="AUM" :value="formatUsdCompact(vault.aum)" />
        <StatCard label="Depositors" :value="formatCompact(vault.depositors)" />
        <StatCard label="Max Drawdown" :value="formatPercent(vault.maxDrawdown)" :sub-positive="false" />
        <StatCard label="Your Deposit" :value="formatUsdCompact(yourDeposit)" :sub="yourDeposit > 0 ? 'Active' : 'None'" :sub-positive="yourDeposit > 0" />
      </div>

      <!-- Performance chart -->
      <div class="card p-5 mb-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-text-primary">Return (30d cumulative)</h3>
          <span class="text-xs mono-number" :class="changeClass(vault.history[vault.history.length - 1])">30d {{ formatPercent(vault.history[vault.history.length - 1]) }}</span>
        </div>
        <LineChart :data="vault.history" :labels="rangeLabels(30)" :format-value="(v) => formatPercent(v)" />
      </div>

      <!-- Holdings -->
      <div class="card p-5">
        <h3 class="font-semibold text-text-primary mb-3">Current Holdings</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-text-tertiary text-xs border-b border-border-primary">
                <th class="text-left py-2 px-2">Asset</th>
                <th class="text-right py-2 px-2">Size</th>
                <th class="text-right py-2 px-2">Value</th>
                <th class="text-right py-2 px-2">Open PnL</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in vault.holdings" :key="h.symbol" class="border-b border-border-primary/50">
                <td class="py-2 px-2 font-medium text-text-primary">{{ h.symbol }}</td>
                <td class="py-2 px-2 text-right mono-number text-text-secondary">{{ formatNumber(h.size) }}</td>
                <td class="py-2 px-2 text-right mono-number text-text-primary">{{ formatUsdCompact(h.valueUsd) }}</td>
                <td class="py-2 px-2 text-right mono-number" :class="changeClass(h.pnlPct)">{{ formatPercent(h.pnlPct) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- Deposit / Withdraw modal -->
    <div
      v-if="modal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="modal = null"
    >
      <div class="card w-full max-w-md p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-text-primary capitalize">{{ modal }} — {{ vault?.name }}</h3>
          <button @click="modal = null" class="text-text-tertiary hover:text-text-primary text-2xl leading-none">×</button>
        </div>

        <label class="text-xs text-text-tertiary">Amount (USDC)</label>
        <input v-model="amount" type="number" min="0" class="input-field mt-1" placeholder="0.00" />

        <div class="flex justify-between text-xs text-text-tertiary mt-2">
          <span>Vault balance</span>
          <span class="mono-number text-text-secondary">{{ formatUsdCompact(yourDeposit) }}</span>
        </div>

        <button class="btn btn-primary w-full mt-4 py-2" @click="confirm">{{ modal === 'deposit' ? 'Deposit' : 'Withdraw' }}</button>
        <p v-if="msg" class="text-xs mt-2" :class="msgOk ? 'price-up' : 'text-sell'">{{ msg }}</p>
      </div>
    </div>
  </SectionShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import SectionShell from '@/components/layout/SectionShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import LineChart from '@/components/common/LineChart.vue'
import { vaults, type Vault } from '@/data/demoData'
import { formatPercent, formatUsdCompact, formatCompact, formatNumber, shortenAddress, changeClass } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const vault = computed<Vault | undefined>(() => vaults.find((v) => v.id === route.params.id))

// demo-local deposit balance keyed by vault id
const deposits = ref<Record<string, number>>({})
const yourDeposit = computed(() => (vault.value ? deposits.value[vault.value.id] ?? 0 : 0))

const modal = ref<'deposit' | 'withdraw' | null>(null)
const amount = ref('')
const msg = ref('')
const msgOk = ref(false)

function rangeLabels(n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(i === 0 ? 'Today' : `-${i}d`)
  return out
}

function openDeposit(kind: 'deposit' | 'withdraw') {
  if (!authStore.isAuthenticated) {
    router.push({ path: '/login', query: { redirect: route.fullPath } })
    return
  }
  modal.value = kind
  amount.value = ''
  msg.value = ''
}

function confirm() {
  if (!vault.value) return
  const amt = parseFloat(amount.value)
  if (!amt || amt <= 0) {
    msgOk.value = false
    msg.value = 'Enter a valid amount'
    return
  }
  const id = vault.value.id
  if (modal.value === 'deposit') {
    deposits.value[id] = (deposits.value[id] ?? 0) + amt
  } else {
    const cur = deposits.value[id] ?? 0
    if (amt > cur) {
      msgOk.value = false
      msg.value = 'Insufficient vault balance'
      return
    }
    deposits.value[id] = cur - amt
  }
  msgOk.value = true
  msg.value = `${modal.value === 'deposit' ? 'Deposited' : 'Withdrew'} $${amt.toLocaleString('en-US')} ${modal.value === 'deposit' ? 'into' : 'from'} ${vault.value.name} (demo)`
  amount.value = ''
}
</script>
