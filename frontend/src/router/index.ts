import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/login',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresGuest: true },
  },
  {
    path: '/auth/callback',
    name: 'GoogleCallback',
    component: () => import('@/views/GoogleCallback.vue'),
  },
  {
    path: '/trade',
    name: 'Trade',
    component: () => import('@/views/Trade.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/portfolio',
    name: 'Portfolio',
    component: () => import('@/views/Portfolio.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/markets',
    name: 'Markets',
    component: () => import('@/views/Markets.vue'),
  },
  {
    path: '/vaults',
    name: 'Vaults',
    component: () => import('@/views/Vaults.vue'),
  },
  {
    path: '/vaults/:id',
    name: 'VaultDetail',
    component: () => import('@/views/VaultDetail.vue'),
  },
  {
    path: '/staking',
    name: 'Earn',
    component: () => import('@/views/Earn.vue'),
  },
  {
    path: '/staking/:id',
    name: 'EarnDetail',
    component: () => import('@/views/EarnDetail.vue'),
  },
  {
    path: '/leaderboard',
    name: 'Leaderboard',
    component: () => import('@/views/Leaderboard.vue'),
  },
  {
    path: '/referrals',
    name: 'Referrals',
    component: () => import('@/views/Referrals.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Navigation guard for authentication
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  // Initialize auth on first load
  if (!authStore.isAuthenticated && !authStore.user) {
    authStore.initAuth()
  }

  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)
  const requiresGuest = to.matched.some(record => record.meta.requiresGuest)

  if (requiresAuth && !authStore.isAuthenticated) {
    // Redirect to login, carrying the intended destination so we can return after auth.
    next({ path: '/login', query: { redirect: to.fullPath } })
  } else if (requiresGuest && authStore.isAuthenticated) {
    // Redirect to trade if route requires guest and user is authenticated
    next('/trade')
  } else {
    next()
  }
})

export default router
