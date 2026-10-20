<template>
  <SectionShell title="Earn" subtitle="Stake HYPE and supply liquidity to earn protocol yield">
    <!-- HYPE staking panel -->
    <div class="card p-5 mb-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center text-accent-primary font-bold text-lg">H</div>
          <div>
            <div class="text-lg font-bold text-text-primary">Stake HYPE</div>
            <div class="text-xs text-text-tertiary">Secure the Hyperliquid L1 and earn protocol fees</div>
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs text-text-tertiary">Current APR</div>
          <div class="text-2xl font-bold mono-number price-up">{{ formatPercent(stakeProducts[0].apy, false) }}</div>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <StatCard label="Your Staked" :value="`${formatNumber(userStaked, 2, 2)} HYPE`" />
        <StatCard label="Staking Value" :value="formatUsdCompact(userStaked * hypePrice)" />
        <StatCard label="Rewards (30d)" :value="`${formatNumber(userStaked * 0.0284 / 12, 4, 4)} HYPE`" />
        <StatCard label="Unstaking" value="1 epoch" />
      </div>

      <div class="flex gap-2 mt-5">
        <button @click="stake('HYPE')" class="btn btn-primary px-6">Stake</button>
        <button @click="unstake" class="btn btn-secondary px-6">Unstake</button>
      </div>
      <p v-if="earnMsg" class="text-xs mt-2" :class="earnMsgOk ? 'price-up' : 'text-sell'">{{ earnMsg }}</p>
    </div>

    <!-- Earn products grid -->
    <h2 class="text-lg font-semibold text-text-primary mb-3">Earn Products</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="p in stakeProducts" :key="p.id" class="card p-4 cursor-pointer hover:border-accent-primary transition-colors" @click="goDetail(p.id)">
        <div class="flex items-start justify-between mb-2">
          <div>
            <div class="font-semibold text-text-primary">{{ p.name }}</div>
            <div class="text-xs text-text-tertiary">{{ p.symbol }}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-text-tertiary">APY</div>
            <div class="font-bold mono-number price-up">{{ formatPercent(p.apy, false) }}</div>
          </div>
        </div>
        <p class="text-xs text-text-secondary mb-3 leading-relaxed">{{ p.description }}</p>
        <div class="flex items-center justify-between text-sm mb-3">
          <span class="text-text-tertiary">TVL</span>
          <span class="mono-number text-text-primary">{{ formatUsdCompact(p.tvl) }}</span>
        </div>
        <div class="flex items-center justify-between text-sm mb-3">
          <span class="text-text-tertiary">Your Position</span>
          <span class="mono-number text-text-primary">{{ formatNumber(p.yourPosition, 2, 4) }} {{ p.symbol }}</span>
        </div>
        <button
          v-if="p.action === 'Stake'"
          @click.stop="stake(p.symbol)"
          class="w-full btn btn-primary py-2 text-sm"
        >Stake {{ p.symbol }}</button>
        <button
          v-else
          @click.stop="deposit(p.symbol)"
          class="w-full btn btn-primary py-2 text-sm"
        >Deposit {{ p.symbol }}</button>
      </div>
    </div>
  </SectionShell>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import SectionShell from '@/components/layout/SectionShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import { stakeProducts } from '@/data/demoData'
import { formatNumber, formatUsdCompact, formatPercent } from '@/utils/format'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const goDetail = (id: string) => router.push(`/staking/${id}`)

const hypePrice = 28.64
const userStaked = ref(0)
const earnMsg = ref('')
const earnMsgOk = ref(false)

const requireAuth = () => {
  if (!authStore.isAuthenticated) {
    router.push('/login')
    return false
  }
  return true
}

const stake = (sym: string) => {
  if (!requireAuth()) return
  userStaked.value += 100
  earnMsgOk.value = true
  earnMsg.value = `Staked 100 ${sym} (demo)`
}

const unstake = () => {
  if (!requireAuth()) return
  if (userStaked.value <= 0) {
    earnMsgOk.value = false
    earnMsg.value = 'No staked HYPE to unstake'
    return
  }
  userStaked.value = 0
  earnMsgOk.value = true
  earnMsg.value = 'Unstake initiated — unlocks after 1 epoch (demo)'
}

const deposit = (sym: string) => {
  if (!requireAuth()) return
  earnMsgOk.value = true
  earnMsg.value = `Deposit to ${sym} opened (demo)`
}
</script>
