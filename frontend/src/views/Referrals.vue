<template>
  <SectionShell title="Referrals" subtitle="Invite traders and earn a share of their fees">
    <!-- Referral link -->
    <div class="card p-5 mb-6">
      <div class="text-xs text-text-tertiary mb-1">Your referral link</div>
      <div class="flex gap-2">
        <input :value="referralInfo.link" readonly class="input-field flex-1 mono-number text-sm" />
        <button @click="copyLink" class="btn btn-primary px-5 whitespace-nowrap">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>
      <div class="text-xs text-text-tertiary mt-2">
        Code <span class="text-text-primary font-medium">{{ referralInfo.code }}</span>
        · Your fee share <span class="text-accent-primary font-medium">{{ (referralInfo.yourShare * 100).toFixed(0) }}%</span>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <StatCard label="Total Referred" :value="String(referralInfo.totalReferred)" />
      <StatCard label="Commission Earned" :value="formatUsdCompact(referralInfo.commissionEarned)" sub="All-time" />
      <StatCard label="Your Tier" :value="referralInfo.yourTier" />
    </div>

    <!-- Tiers -->
    <h2 class="text-lg font-semibold text-text-primary mb-3">Commission Tiers</h2>
    <div class="card overflow-hidden mb-6">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-text-tertiary text-xs border-b border-border-primary">
            <th class="text-left font-medium px-4 py-3">Tier</th>
            <th class="text-left font-medium px-4 py-3">Referred Users</th>
            <th class="text-right font-medium px-4 py-3">Fee Share</th>
            <th class="text-left font-medium px-4 py-3">Requirement</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in referralTiers"
            :key="t.tier"
            class="border-b border-border-primary/50"
            :class="t.tier === referralInfo.yourTier ? 'bg-bg-secondary/50' : ''"
          >
            <td class="px-4 py-3 font-medium" :class="t.tier === referralInfo.yourTier ? 'text-accent-primary' : 'text-text-primary'">{{ t.tier }}</td>
            <td class="px-4 py-3 text-text-secondary">{{ t.referred }}</td>
            <td class="px-4 py-3 text-right mono-number text-text-primary">{{ t.share }}</td>
            <td class="px-4 py-3 text-text-tertiary">{{ t.requirement }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Recent referrals -->
    <h2 class="text-lg font-semibold text-text-primary mb-3">Recent Referrals</h2>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-text-tertiary text-xs border-b border-border-primary">
            <th class="text-left font-medium px-4 py-3">Trader</th>
            <th class="text-left font-medium px-4 py-3">Date</th>
            <th class="text-right font-medium px-4 py-3">Volume</th>
            <th class="text-right font-medium px-4 py-3">Commission</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in recentReferrals" :key="r.address" class="border-b border-border-primary/50">
            <td class="px-4 py-3 font-mono text-text-primary">{{ shortenAddress(r.address) }}</td>
            <td class="px-4 py-3 text-text-tertiary">{{ r.date }}</td>
            <td class="px-4 py-3 text-right mono-number text-text-secondary">{{ formatUsdCompact(r.volume) }}</td>
            <td class="px-4 py-3 text-right mono-number price-up">{{ formatUsdCompact(r.commission) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </SectionShell>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SectionShell from '@/components/layout/SectionShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import {
  referralInfo,
  referralTiers,
  recentReferrals,
} from '@/data/demoData'
import { formatUsdCompact, shortenAddress, copyToClipboard } from '@/utils/format'

const copied = ref(false)

const copyLink = async () => {
  const ok = await copyToClipboard(referralInfo.link)
  if (ok) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}
</script>
