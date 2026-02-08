import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/auth',
      component: () => import('../layouts/AuthLayout.vue'),
      children: [
        {
          path: 'login',
          name: 'login',
          component: () => import('../pages/auth/LoginPage.vue'),
          meta: { guestOnly: true },
        },
        {
          path: 'register',
          name: 'register',
          component: () => import('../pages/auth/RegisterPage.vue'),
          meta: { guestOnly: true },
        },
        {
          path: 'pending',
          name: 'pending',
          component: () => import('../pages/auth/PendingPage.vue'),
        },
      ],
    },
    {
      path: '/',
      component: () => import('../layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          redirect: '/knowledge',
        },
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('../pages/menus/KnowledgeCenterPage.vue'),
        },
        {
          path: 'digital-human',
          name: 'digital-human',
          component: () => import('../pages/menus/DigitalHumanCenterPage.vue'),
        },
        {
          path: 'narrative-kernel',
          name: 'narrative-kernel',
          component: () => import('../pages/menus/NarrativeKernelPage.vue'),
        },
        {
          path: 'rehearsal',
          name: 'rehearsal',
          component: () => import('../pages/menus/RehearsalArenaPage.vue'),
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  const authStore = useAuthStore()
  authStore.syncFromStorage()

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  const guestOnly = to.matched.some((record) => record.meta.guestOnly)

  if (requiresAuth && !authStore.isAuthenticated) {
    return {
      path: '/auth/login',
      query: { redirect: to.fullPath },
    }
  }

  if (guestOnly && authStore.isAuthenticated) {
    return '/knowledge'
  }

  return true
})

export default router
