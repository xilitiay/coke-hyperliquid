<template>
  <div class="card p-4">
    <div class="text-xs text-text-tertiary mb-2">{{ label }}</div>
    <div class="text-xl font-bold mono-number text-text-primary">{{ value }}</div>
    <div v-if="sub" class="text-xs mt-1" :class="subClass">{{ sub }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { changeClass } from '@/utils/format'

const props = defineProps<{
  label: string
  value: string
  sub?: string
  subPositive?: boolean
}>()

const subClass = computed(() => {
  if (props.subPositive === undefined) return 'text-text-tertiary'
  return props.subPositive ? 'price-up' : 'price-down'
})
</script>
