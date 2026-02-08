<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChatDotRound,
  DocumentCopy,
  EditPen,
  Fold,
  SwitchButton,
  VideoPlay,
} from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const mobileOpen = ref(false)

const navItems = [
  {
    path: '/knowledge',
    title: '菜单1 · 知识库',
    icon: DocumentCopy,
  },
  {
    path: '/digital-human',
    title: '菜单2 · 数字人素材',
    icon: VideoPlay,
  },
  {
    path: '/narrative-kernel',
    title: '菜单3 · 叙事底座',
    icon: EditPen,
  },
  {
    path: '/rehearsal',
    title: '菜单5 · AI 问诊演练',
    icon: ChatDotRound,
  },
]

const activePath = computed(() => route.path)

const handleLogout = async () => {
  authStore.clearAuth()
  await router.push('/auth/login')
}
</script>

<template>
  <div class="main-shell">
    <aside class="main-sidebar" :class="{ open: mobileOpen }">
      <div class="brand-block">
        <p class="brand-kicker">Doctor Agent Console</p>
        <h2>北医三院医生端</h2>
      </div>

      <el-menu
        class="nav-menu"
        :default-active="activePath"
        router
        @select="mobileOpen = false"
      >
        <el-menu-item v-for="item in navItems" :key="item.path" :index="item.path">
          <el-icon>
            <component :is="item.icon" />
          </el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-footer">
        <p>登录账号</p>
        <strong>{{ authStore.username || '医生' }}</strong>
      </div>
    </aside>

    <div class="main-stage">
      <header class="main-topbar">
        <button class="mobile-menu-button" @click="mobileOpen = !mobileOpen">
          <el-icon><Fold /></el-icon>
        </button>

        <div class="topbar-text">
          <h3>医生智能体工作台</h3>
          <p>以业务状态驱动联调，避免接口成功但任务未完成</p>
        </div>

        <el-button class="logout-button" type="danger" plain @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          退出登录
        </el-button>
      </header>

      <main class="main-content">
        <router-view />
      </main>
    </div>

    <div v-if="mobileOpen" class="mobile-mask" @click="mobileOpen = false" />
  </div>
</template>
