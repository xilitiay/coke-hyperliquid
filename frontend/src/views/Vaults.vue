<template>
  <SectionShell title="Vaults" subtitle="Copy-trade top performers — deposit and earn their returns">
    <template #actions>
      <button class="btn btn-primary text-sm" @click="showCreate = true">Create Vault</button>
    </template>

    <!-- Controls -->
    <div class="flex items-center justify-between mb-4 gap-3 flex-wrap">
      <div class="relative w-full md:w-72">
        <input v-model="search" type="text" placeholder="Search vaults" class="input-field py-1.5 text-sm" />
      </div>
      <select v-model="sortBy" class="input-field w-44 py-1.5 text-sm">
        <option value="return30d">30d Return</option>
        <option value="aom">AUM</option>
        <option value="depositors">Depositors</option>
        <option value="leaderboardRank">Leaderboard Rank</option>
      </select>
    </div>

    <!-- Vault grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div
        v-for="v in sorted"
        :key="v.id"
        @click="goDetail(v.id)"
        class="card p-4 cursor-pointer hover:border-accent-primary transition-colors"
      >
        <!-- Header -->
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="w-9 h-9 rounded-full bg-bg-secondary flex items-center justify-center text-accent-primary font-bold">
              {{ v.name.charAt(0) }}
            </div>
            <div>
              <div class="flex items-center gap-1">
                <span class="font-semibold text-text-primary">{{ v.name }}</span>
                <svg v-if="v.verified" class="w-4 h-4 text-accent-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="text-xs text-text-tertiary">{{ v.managerName }}</div>
            </div>
          </div>
          <span class="text-xs px-2 py-0.5 rounded bg-bg-secondary text-text-secondary">#{{ v.leaderboardRank }}</span>
        </div>

        <!-- Sparkline -->
        <div class="mb-3">
          <Sparkline :data="v.spark" :width="240" :height="40" />
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-3 gap-2 text-center">
          <div>
            <div class="text-xs text-text-tertiary">30d Return</div>
            <div class="font-bold mono-number" :class="changeClass(v.return30d)">{{ formatPercent(v.return30d) }}</div>
          </div>
          <div>
            <div class="text-xs text-text-tertiary">AUM</div>
            <div class="font-bold mono-number text-text-primary">{{ formatUsdCompact(v.aum) }}</div>
          </div>
          <div>
            <div class="text-xs text-text-tertiary">Depositors</div>
            <div class="font-bold mono-number text-text-primary">{{ formatCompact(v.depositors) }}</div>
          </div>
        </div>

        <button
          @click.stop="deposit(v)"
          class="w-full mt-3 btn btn-primary py-2 text-sm"
        >
          Deposit
        </button>
      </div>
    </div>

    <!-- Vault detail modal -->
    <div
      v-if="selected"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="selected = null"
    >
      <div class="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-bold text-text-primary">{{ selected.name }}</h2>
              <svg v-if="selected.verified" class="w-5 h-5 text-accent-primary" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="text-xs text-text-tertiary mt-0.5">{{ shortenAddress(selected.manager) }}</div>
          </div>
          <button @click="selected = null" class="text-text-tertiary hover:text-text-primary text-2xl leading-none">×</button>
        </div>

        <Sparkline :data="selected.spark" :width="460" :height="80" class="mb-4" />

        <div class="grid grid-cols-2 gap-3 mb-4">
          <StatCard label="30d Return" :value="formatPercent(selected.return30d)" :sub="`All-time ${formatPercent(selected.returnAllTime)}`" :sub-positive="selected.returnAllTime >= 0" />
          <StatCard label="AUM" :value="formatUsdCompact(selected.aum)" />
          <StatCard label="Depositors" :value="formatCompact(selected.depositors)" />
          <StatCard label="Max Drawdown" :value="formatPercent(selected.maxDrawdown)" :sub-positive="false" />
        </div>

        <!-- Deposit form -->
        <div class="border-t border-border-primary pt-4">
          <label class="text-xs text-text-tertiary">Deposit Amount (USDC)</label>
          <div class="flex gap-2 mt-1">
            <input v-model="depositAmount" type="number" min="0" class="input-field" placeholder="0.00" />
            <button @click="confirmDeposit" class="btn btn-primary px-6 whitespace-nowrap">Deposit</button>
          </div>
          <p v-if="depositMsg" class="text-xs mt-2" :class="depositMsgOk ? 'price-up' : 'text-sell'">{{ depositMsg }}</p>
        </div>
      </div>
    </div>

    <!-- Create Vault modal -->
    <div
      v-if="showCreate"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="showCreate = false"
    >
      <div class="card w-full max-w-md p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-text-primary">Create Vault</h3>
          <button @click="showCreate = false" class="text-text-tertiary hover:text-text-primary text-2xl leading-none">×</button>
        </div>

        <label class="text-xs text-text-tertiary">Vault Name</label>
        <input v-model="newName" type="text" class="input-field mt-1" placeholder="My Strategy" />

        <p class="text-xs text-text-tertiary mt-3">Deploy a trading strategy and let others deposit to copy your performance. Vaults charge a 10% performance fee on profits.</p>

        <button class="btn btn-primary w-full mt-4 py-2" @click="createVault">Create</button>
        <p v-if="createMsg" class="text-xs mt-2" :class="createMsgOk ? 'price-up' : 'text-sell'">{{ createMsg }}</p>
      </div>
    </div>
  </SectionShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import SectionShell from '@/components/layout/SectionShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import Sparkline from '@/components/common/Sparkline.vue'
import { vaults, type Vault } from '@/data/demoData'
import { formatPercent, formatUsdCompact, formatCompact, shortenAddress, changeClass } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const search = ref('')
const sortBy = ref<'return30d' | 'aom' | 'depositors' | 'leaderboardRank'>('return30d')
const selected = ref<Vault | null>(null)
const depositAmount = ref('')
const depositMsg = ref('')
const depositMsgOk = ref(false)
const showCreate = ref(false)

// create-vault form
const newName = ref('')
const createMsg = ref('')
const createMsgOk = ref(false)

const sorted = computed(() => {
  const q = search.value.trim().toLowerCase()
  let rows = vaults
  if (q) rows = rows.filter((v) => v.name.toLowerCase().includes(q) || v.managerName.toLowerCase().includes(q))
  const key = sortBy.value
  return [...rows].sort((a, b) => (b[key] as number) - (a[key] as number))
})

const goDetail = (id: string) => router.push(`/vaults/${id}`)

const deposit = (v: Vault) => {
  if (!authStore.isAuthenticated) {
    router.push('/login')
    return
  }
  selected.value = v
  depositMsg.value = ''
}

const confirmDeposit = () => {
  const amt = parseFloat(depositAmount.value)
  if (!amt || amt <= 0) {
    depositMsgOk.value = false
    depositMsg.value = 'Enter a valid amount'
    return
  }
  depositMsgOk.value = true
  depositMsg.value = `Deposited $${amt.toLocaleString('en-US')} into ${selected.value?.name} (demo)`
  depositAmount.value = ''
}

const createVault = () => {
  if (!authStore.isAuthenticated) {
    router.push('/login')
    return
  }
  if (!newName.value.trim()) {
    createMsgOk.value = false
    createMsg.value = 'Enter a vault name'
    return
  }
  createMsgOk.value = true
  createMsg.value = `Vault "${newName.value.trim()}" created (demo). Deploy the strategy to start accepting deposits.`
  newName.value = ''
  setTimeout(() => (showCreate.value = false), 1500)
}
</script>
