<template>
  <div class="line-chart" :class="{ 'cursor-pointer': !!onHover }">
    <svg
      ref="svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      class="w-full"
      :style="{ height: height + 'px' }"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.28" />
          <stop offset="100%" :stop-color="color" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- horizontal grid lines -->
      <line
        v-for="(g, i) in gridYs"
        :key="'g' + i"
        :x1="0" :x2="W" :y1="g" :y2="g"
        stroke="#2a3439" stroke-width="1" stroke-dasharray="3 4"
      />

      <!-- area fill -->
      <path v-if="showArea" :d="areaPath" :fill="`url(#${gid})`" />

      <!-- line -->
      <path :d="linePath" fill="none" :stroke="color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

      <!-- hover marker -->
      <template v-if="hover !== null">
        <line :x1="hoverX" :x2="hoverX" :y1="0" :y2="H" stroke="#50d2c1" stroke-width="1" stroke-dasharray="3 3" />
        <circle :cx="hoverX" :cy="hoverY" r="3.5" :fill="color" stroke="#0f1a1f" stroke-width="1.5" />
      </template>
    </svg>

    <!-- axis labels -->
    <div v-if="labels && labels.length" class="flex justify-between mt-1 text-[10px] text-text-tertiary">
      <span>{{ labels[0] }}</span>
      <span v-if="labels.length > 2">{{ labels[Math.floor((labels.length - 1) / 2)] }}</span>
      <span>{{ labels[labels.length - 1] }}</span>
    </div>

    <!-- hover readout -->
    <div v-if="hover !== null && labels" class="mt-1 text-xs text-text-secondary">
      <span class="text-text-tertiary">{{ labels[hover] }}</span>
      <span class="ml-2 mono-number" :class="changeClass(valueAt(hover))">{{ formatValue ? formatValue(valueAt(hover)) : valueAt(hover) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { changeClass } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    data: number[]
    height?: number
    color?: string
    showArea?: boolean
    labels?: string[]
    formatValue?: (v: number) => string
    onHover?: (index: number | null) => void
  }>(),
  { height: 200, showArea: true },
)

const W = 600
const H = 200
const padY = 12

const gid = `lg-${Math.random().toString(36).slice(2, 9)}`
const hover = ref<number | null>(null)
const svg = ref<SVGSVGElement | null>(null)

const color = computed(() => {
  if (props.color) return props.color
  const first = props.data[0] ?? 0
  const last = props.data[props.data.length - 1] ?? 0
  return last >= first ? '#1fa67d' : '#f24a67'
})

const min = computed(() => (props.data.length ? Math.min(...props.data) : 0))
const max = computed(() => (props.data.length ? Math.max(...props.data) : 1))
const range = computed(() => max.value - min.value || 1)

const xFor = (i: number) => (props.data.length <= 1 ? W / 2 : (i / (props.data.length - 1)) * W)
const yFor = (v: number) => H - padY - ((v - min.value) / range.value) * (H - padY * 2)

const linePath = computed(() => {
  if (!props.data.length) return ''
  return props.data
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`)
    .join(' ')
})

const areaPath = computed(() => {
  if (!props.data.length) return ''
  const top = props.data.map((v, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ')
  return `${top} L${W},${H} L0,${H} Z`
})

const gridYs = computed(() => {
  const n = 3
  return Array.from({ length: n + 1 }, (_, i) => (padY + (i / n) * (H - padY * 2)).toFixed(1))
})

const hoverX = computed(() => (hover.value === null ? 0 : xFor(hover.value)))
const hoverY = computed(() => (hover.value === null ? 0 : yFor(valueAt(hover.value))))

function valueAt(i: number) {
  return props.data[i]
}

function onMove(e: MouseEvent) {
  if (!svg.value || props.data.length === 0) return
  const rect = svg.value.getBoundingClientRect()
  const rel = (e.clientX - rect.left) / rect.width
  const idx = Math.round(rel * (props.data.length - 1))
  const clamped = Math.max(0, Math.min(props.data.length - 1, idx))
  hover.value = clamped
  props.onHover?.(clamped)
}

onMounted(() => {
  // ensure gradient id uniqueness if reused
})
</script>

<style scoped>
.line-chart {
  width: 100%;
}
.line-chart svg {
  display: block;
}
</style>
