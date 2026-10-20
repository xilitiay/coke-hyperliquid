<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="sparkline">
    <polyline
      :points="points"
      fill="none"
      :stroke="color"
      stroke-width="2"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: number[]
  width?: number
  height?: number
  color?: string
}>()

const width = props.width ?? 120
const height = props.height ?? 36

const color = computed(() => {
  if (props.color) return props.color
  const first = props.data[0] ?? 0
  const last = props.data[props.data.length - 1] ?? 0
  return last >= first ? '#1fa67d' : '#f24a67'
})

const points = computed(() => {
  const d = props.data
  if (d.length === 0) return ''
  const min = Math.min(...d)
  const max = Math.max(...d)
  const range = max - min || 1
  const stepX = width / (d.length - 1 || 1)
  return d
    .map((v, i) => {
      const x = i * stepX
      const y = height - ((v - min) / range) * (height - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})
</script>
