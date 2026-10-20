<template>
  <div class="card h-full flex flex-col">
    <!-- Buy/Sell Tabs -->
    <div class="grid grid-cols-2 border-b border-border-primary">
      <button
        @click="side = 'BUY'"
        class="py-3 text-sm font-medium transition-colors"
        :class="side === 'BUY'
          ? 'text-buy border-b-2 border-buy bg-buy/5'
          : 'text-text-secondary hover:text-text-primary'"
      >
        Buy
      </button>
      <button
        @click="side = 'SELL'"
        class="py-3 text-sm font-medium transition-colors"
        :class="side === 'SELL'
          ? 'text-sell border-b-2 border-sell bg-sell/5'
          : 'text-text-secondary hover:text-text-primary'"
      >
        Sell
      </button>
    </div>

    <!-- Form Content -->
    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <!-- Order Type -->
      <div>
        <label class="text-xs text-text-tertiary mb-1.5 block">Order Type</label>
        <div class="flex gap-2">
          <button
            v-for="type in orderTypes"
            :key="type"
            @click="orderType = type"
            class="flex-1 px-3 py-1.5 text-sm rounded transition-colors"
            :class="orderType === type
              ? 'bg-accent-primary text-bg-primary font-medium'
              : 'bg-bg-secondary text-text-secondary hover:text-text-primary'"
          >
            {{ type }}
          </button>
        </div>
      </div>

      <!-- Price (for limit orders) -->
      <div v-if="orderType === 'Limit'">
        <label class="text-xs text-text-tertiary mb-1.5 block">Price</label>
        <div class="relative">
          <input
            v-model="price"
            type="number"
            step="0.01"
            class="input-field pr-16"
            placeholder="0.00"
          />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
            USDC
          </span>
        </div>
      </div>

      <!-- Amount -->
      <div>
        <label class="text-xs text-text-tertiary mb-1.5 block">Amount</label>
        <div class="relative">
          <input
            v-model="amount"
            type="number"
            step="0.001"
            class="input-field pr-16"
            placeholder="0.000"
          />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
            {{ baseAsset }}
          </span>
        </div>
      </div>

      <!-- Percentage Selector -->
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="pct in [25, 50, 75, 100]"
          :key="pct"
          @click="setPercentage(pct)"
          class="py-1.5 text-xs rounded bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors"
        >
          {{ pct }}%
        </button>
      </div>

      <!-- Leverage (for perpetuals) -->
      <div v-if="isPerpetual">
        <label class="text-xs text-text-tertiary mb-1.5 block">Leverage</label>
        <div class="flex items-center gap-3">
          <input
            v-model="leverage"
            type="range"
            min="1"
            max="50"
            class="flex-1"
          />
          <span class="text-sm font-medium text-text-primary min-w-[40px]">{{ leverage }}x</span>
        </div>
      </div>

      <!-- Total -->
      <div>
        <label class="text-xs text-text-tertiary mb-1.5 block">Total</label>
        <div class="relative">
          <input
            :value="total"
            type="text"
            class="input-field pr-16"
            placeholder="0.00"
            readonly
          />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
            USDC
          </span>
        </div>
      </div>

      <!-- Advanced Options -->
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="reduceOnly" type="checkbox" class="rounded" />
          <span class="text-xs text-text-secondary">Reduce Only</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="postOnly" type="checkbox" class="rounded" />
          <span class="text-xs text-text-secondary">Post Only</span>
        </label>
      </div>
    </div>

    <!-- Submit Button -->
    <div class="shrink-0 p-4 border-t border-border-primary">
      <!-- Error Message -->
      <div v-if="errorMessage" class="mb-3 p-2 bg-sell/10 border border-sell/30 rounded text-xs text-sell">
        {{ errorMessage }}
      </div>

      <!-- Success Message -->
      <div v-if="successMessage" class="mb-3 p-2 bg-buy/10 border border-buy/30 rounded text-xs text-buy">
        {{ successMessage }}
      </div>

      <button
        @click="submitOrder"
        class="w-full py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :class="side === 'BUY' ? 'btn-buy' : 'btn-sell'"
        :disabled="!canSubmit"
      >
        <span v-if="!isSubmitting">{{ side === 'BUY' ? 'Buy' : 'Sell' }} {{ symbol }}</span>
        <span v-else>Submitting...</span>
      </button>

      <!-- Balance Info -->
      <div class="mt-3 flex items-center justify-between text-xs text-text-tertiary">
        <span>Available</span>
        <span class="text-text-primary">{{ availableBalance }} USDC</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { BrowserProvider, type JsonRpcSigner } from 'ethers'
import { tradingApi, accountApi } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import { getDemoSigner } from '@/utils/demoSigner'
import { HL_EXCHANGE_DOMAIN, ORDER_ACTION_TYPES, buildOrderActionValue } from '@/utils/eip712'

const props = defineProps<{
  symbol?: string
  isPerpetual?: boolean
}>()

// Base asset derived from the trading pair, e.g. "BTC/USDC" -> "BTC".
const baseAsset = computed(() => (props.symbol || 'BTC/USDC').split('/')[0])

const authStore = useAuthStore()

const side = ref<'BUY' | 'SELL'>('BUY')
const orderType = ref<'Limit' | 'Market'>('Limit')
const price = ref('')
const amount = ref('')
const leverage = ref(10)
const reduceOnly = ref(false)
const postOnly = ref(false)
const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const orderTypes = ['Limit', 'Market']
const availableBalance = ref('0.00')

// Load available balance
const loadBalance = async () => {
  try {
    const response = await accountApi.getBalance()
    // Backend returns: { totalEquity, availableBalance, usedMargin, unrealizedPnl, assets }
    const balanceData = response.data

    if (balanceData.assets && Array.isArray(balanceData.assets)) {
      // Find USDC balance from assets array
      const usdcAsset = balanceData.assets.find((asset: any) => asset.asset === 'USDC')
      if (usdcAsset) {
        availableBalance.value = parseFloat(usdcAsset.free || '0').toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      } else {
        // No USDC balance, show 0
        availableBalance.value = '0.00'
      }
    } else if (balanceData.availableBalance) {
      // Fallback: use total available balance
      availableBalance.value = parseFloat(balanceData.availableBalance || '0').toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    }
  } catch (error) {
    console.error('Failed to load balance:', error)
    availableBalance.value = '0.00'
  }
}

const total = computed(() => {
  if (!price.value || !amount.value) return '0.00'
  const totalValue = parseFloat(price.value) * parseFloat(amount.value)
  return totalValue.toFixed(2)
})

const canSubmit = computed(() => {
  if (orderType.value === 'Market') {
    return amount.value && parseFloat(amount.value) > 0 && !isSubmitting.value
  }
  return price.value && amount.value && parseFloat(price.value) > 0 && parseFloat(amount.value) > 0 && !isSubmitting.value
})

const setPercentage = (pct: number) => {
  // Calculate amount based on percentage of available balance
  const balance = parseFloat(availableBalance.value.replace(/,/g, ''))
  if (balance > 0) {
    if (orderType.value === 'Market' || !price.value) {
      // For market orders or when no price is set, use a conservative estimate
      const estimatedPrice = 50000 // TODO: Get current market price
      const maxAmount = (balance * pct / 100) / estimatedPrice
      amount.value = maxAmount.toFixed(3)
    } else {
      const maxAmount = (balance * pct / 100) / parseFloat(price.value)
      amount.value = maxAmount.toFixed(3)
    }
  }
}

/**
 * Sign an order action with the same EIP-712 scheme Hyperliquid uses.
 *
 * Priority:
 *   1. Injected wallet (MetaMask) — but only when its selected account is the
 *      one this session is authenticated as (no prompts for other accounts).
 *   2. The in-memory demo session signer (seeded test key, see demoSigner.ts).
 *   3. Wallet-less sessions fall back to a SHA-256 demo marker — it proves
 *      nothing and the UI must label it as demo.
 *
 * Returns the signature plus the scheme tag and nonce the backend needs to
 * verify (and to bind the signature to this submission).
 */
type SignResult = {
  signature: string
  signatureScheme: 'eip712' | 'demo-sha256'
  nonce: number
}

async function getInjectedSigner(): Promise<JsonRpcSigner | null> {
  if (typeof window.ethereum === 'undefined' || !authStore.walletAddress) return null
  try {
    // eth_accounts never prompts; bail unless the session wallet is selected.
    const accounts: string[] = await window.ethereum.request({ method: 'eth_accounts' })
    if (!accounts.length || accounts[0].toLowerCase() !== authStore.walletAddress.toLowerCase()) {
      return null
    }
    const provider = new BrowserProvider(window.ethereum)
    return await provider.getSigner()
  } catch {
    return null
  }
}

const generateSignature = async (orderData: any): Promise<SignResult> => {
  const nonce = Date.now()
  const actionValue = buildOrderActionValue({ ...orderData, nonce })

  // 1) Injected wallet
  const injected = await getInjectedSigner()
  if (injected) {
    const signature = await injected.signTypedData(HL_EXCHANGE_DOMAIN, ORDER_ACTION_TYPES, actionValue)
    return { signature, signatureScheme: 'eip712', nonce }
  }

  // 2) Demo session signer (memory-only test wallet)
  const demo = getDemoSigner()
  if (demo) {
    const signature = await demo.signTypedData(HL_EXCHANGE_DOMAIN, ORDER_ACTION_TYPES, actionValue)
    return { signature, signatureScheme: 'eip712', nonce }
  }

  // 3) Wallet-less demo fallback: SHA-256 over everything that will be sent
  //    except the signature itself (mirrors backend verifyDemoSignature).
  //    Build the payload first and hash THAT object, so key order matches the
  //    wire order the backend re-serializes.
  const payload: Record<string, unknown> = {
    ...orderData,
    signatureScheme: 'demo-sha256' as const,
    nonce,
  }
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(payload)))
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { signature: hashHex, signatureScheme: 'demo-sha256', nonce }
}

const submitOrder = async () => {
  if (!canSubmit.value) return

  // Clear messages
  errorMessage.value = ''
  successMessage.value = ''
  isSubmitting.value = true

  try {
    const orderData = {
      symbol: props.symbol || 'BTC/USDC',
      side: side.value,
      type: orderType.value.toUpperCase() as 'LIMIT' | 'MARKET',
      price: orderType.value === 'Limit' ? price.value : undefined,
      quantity: amount.value,
      leverage: props.isPerpetual ? leverage.value : undefined,
      reduceOnly: reduceOnly.value,
      postOnly: postOnly.value,
    }

    // Sign the order action (EIP-712 when a signer is available)
    const { signature, signatureScheme, nonce } = await generateSignature(orderData)

    // Submit order
    const response = await tradingApi.createOrder({
      ...orderData,
      signature,
      signatureScheme,
      nonce,
    })

    // Success — surface the real per-item status when the API provides one
    const orderStatus = response.data?.data?.status
    successMessage.value =
      orderStatus && orderStatus !== 'FILLED'
        ? `Order accepted — status: ${orderStatus}`
        : 'Order submitted successfully!'

    // Reset form
    price.value = ''
    amount.value = ''

    // Reload balance
    await loadBalance()

    // Emit event to refresh account data globally
    window.dispatchEvent(new CustomEvent('order-created'))

    // Clear success message after 3 seconds
    setTimeout(() => {
      successMessage.value = ''
    }, 3000)

  } catch (error: any) {
    console.error('Failed to submit order:', error)

    // Get error message from response
    const errorData = error.response?.data
    errorMessage.value =
      errorData?.error?.message ||  // API error format
      errorData?.message ||          // Alternative format
      error.message ||               // Axios error
      'Failed to submit order'

    // Clear error message after 5 seconds
    setTimeout(() => {
      errorMessage.value = ''
    }, 5000)
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => {
  // Load balance when component mounts
  if (authStore.isAuthenticated) {
    loadBalance()
  }
})
</script>
