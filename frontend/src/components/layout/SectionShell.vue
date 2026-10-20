<template>
  <div class="h-full flex flex-col bg-bg-tertiary">
    <Navbar />
    <div class="flex-1 overflow-auto p-4">
      <div class="max-w-7xl mx-auto">
        <!-- Page header -->
        <div class="flex items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 class="text-2xl font-bold text-text-primary">{{ title }}</h1>
            <p v-if="subtitle" class="text-sm text-text-secondary mt-1">{{ subtitle }}</p>
          </div>
          <div class="flex items-center gap-2">
            <slot name="actions" />
          </div>
        </div>

        <!-- Page body -->
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Navbar from '@/components/layout/Navbar.vue'

defineProps<{
  title: string
  subtitle?: string
}>()
</script>
