import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Auth routes
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { public: true, guestOnly: true },
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/auth/RegisterView.vue'),
      meta: { public: true, guestOnly: true },
    },
    {
      path: '/pending-review',
      name: 'PendingReview',
      component: () => import('@/views/auth/PendingReviewView.vue'),
      meta: { public: true },
    },
    {
      path: '/debug-login',
      name: 'DebugLogin',
      component: () => import('@/views/auth/DebugLoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/api-test',
      name: 'ApiTest',
      component: () => import('@/views/auth/ApiTestView.vue'),
      meta: { public: true },
    },
    // Main layout routes
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'Dashboard',
          component: () => import('@/views/dashboard/DashboardView.vue'),
        },
        // Knowledge
        {
          path: 'knowledge',
          name: 'Knowledge',
          component: () => import('@/views/knowledge/KnowledgeView.vue'),
        },
        // Digital Human
        {
          path: 'digital-human/voice',
          name: 'VoiceCenter',
          component: () => import('@/views/digitalHuman/VoiceCenterView.vue'),
        },
        {
          path: 'digital-human/video',
          name: 'VideoCenter',
          component: () => import('@/views/digitalHuman/VideoCenterView.vue'),
        },
        // Narrative
        {
          path: 'narrative/kernel',
          name: 'NarrativeKernel',
          component: () => import('@/views/narrative/NarrativeKernelView.vue'),
        },
        {
          path: 'narrative/redlines',
          name: 'RedlineRules',
          component: () => import('@/views/narrative/RedlineRulesView.vue'),
        },
        {
          path: 'narrative/annotations',
          name: 'Annotations',
          component: () => import('@/views/narrative/AnnotationsView.vue'),
        },
        // Rehearsal
        {
          path: 'rehearsal',
          name: 'Rehearsal',
          component: () => import('@/views/rehearsal/RehearsalView.vue'),
        },
        {
          path: 'rehearsal/:sessionId',
          name: 'RehearsalSession',
          component: () => import('@/views/rehearsal/RehearsalSessionView.vue'),
          props: true,
        },
      ],
    },
    // 404
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

// Navigation guards
router.beforeEach((to, _from, next) => {
  const authStore = useAuthStore()
  
  // Initialize auth state
  authStore.init()
  
  // Check if route requires authentication
  if (to.meta.requiresAuth && !authStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    next('/login')
    return
  }
  
  // Check if route is guest only (login/register pages)
  if (to.meta.guestOnly && authStore.isLoggedIn) {
    next('/')
    return
  }
  
  // Check pending review status
  if (to.meta.requiresAuth && authStore.isLoggedIn && !authStore.isApproved) {
    // Allow access to pending review page
    if (to.path === '/pending-review') {
      next()
      return
    }
    // Redirect to pending review
    next('/pending-review')
    return
  }
  
  next()
})

export default router
