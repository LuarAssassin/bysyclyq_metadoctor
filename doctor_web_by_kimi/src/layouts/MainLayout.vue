<template>
  <div class="main-layout" :class="{ 'dark': themeStore.isDark }">
    <!-- Sidebar -->
    <aside class="sidebar" :class="{ 'collapsed': sidebarCollapsed }">
      <!-- Logo -->
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span v-show="!sidebarCollapsed" class="logo-text">医生智能体</span>
        </div>
        <button class="collapse-btn" @click="toggleSidebar">
          <el-icon><Fold v-if="!sidebarCollapsed" /><Expand v-else /></el-icon>
        </button>
      </div>
      
      <!-- Navigation -->
      <nav class="sidebar-nav">
        <div class="nav-section">
          <div v-show="!sidebarCollapsed" class="nav-title">工作台</div>
          <router-link to="/" class="nav-item" exact>
            <el-icon><HomeFilled /></el-icon>
            <span v-show="!sidebarCollapsed">首页概览</span>
          </router-link>
        </div>
        
        <div class="nav-section">
          <div v-show="!sidebarCollapsed" class="nav-title">知识管理</div>
          <router-link to="/knowledge" class="nav-item">
            <el-icon><Collection /></el-icon>
            <span v-show="!sidebarCollapsed">知识库中心</span>
          </router-link>
        </div>
        
        <div class="nav-section">
          <div v-show="!sidebarCollapsed" class="nav-title">数字人</div>
          <router-link to="/digital-human/voice" class="nav-item">
            <el-icon><Microphone /></el-icon>
            <span v-show="!sidebarCollapsed">音色管理</span>
          </router-link>
          <router-link to="/digital-human/video" class="nav-item">
            <el-icon><VideoCamera /></el-icon>
            <span v-show="!sidebarCollapsed">视频素材</span>
          </router-link>
        </div>
        
        <div class="nav-section">
          <div v-show="!sidebarCollapsed" class="nav-title">叙事底座</div>
          <router-link to="/narrative/kernel" class="nav-item">
            <el-icon><Cpu /></el-icon>
            <span v-show="!sidebarCollapsed">人格底座</span>
          </router-link>
          <router-link to="/narrative/redlines" class="nav-item">
            <el-icon><WarningFilled /></el-icon>
            <span v-show="!sidebarCollapsed">红线规则</span>
          </router-link>
          <router-link to="/narrative/annotations" class="nav-item">
            <el-icon><EditPen /></el-icon>
            <span v-show="!sidebarCollapsed">批注历史</span>
          </router-link>
        </div>
        
        <div class="nav-section">
          <div v-show="!sidebarCollapsed" class="nav-title">AI 演练</div>
          <router-link to="/rehearsal" class="nav-item">
            <el-icon><ChatDotRound /></el-icon>
            <span v-show="!sidebarCollapsed">问诊演练场</span>
          </router-link>
        </div>
      </nav>
      
      <!-- Sidebar Footer -->
      <div class="sidebar-footer">
        <button class="footer-btn" @click="themeStore.toggleTheme">
          <el-icon><Sunny v-if="themeStore.isDark" /><Moon v-else /></el-icon>
          <span v-show="!sidebarCollapsed">{{ themeStore.isDark ? '亮色模式' : '暗黑模式' }}</span>
        </button>
        <button class="footer-btn logout" @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          <span v-show="!sidebarCollapsed">退出登录</span>
        </button>
      </div>
    </aside>
    
    <!-- Main Content -->
    <main class="main-content">
      <!-- Header -->
      <header class="header">
        <div class="header-left">
          <h1 class="page-title">{{ pageTitle }}</h1>
        </div>
        <div class="header-right">
          <div class="user-info">
            <el-avatar :size="36" class="user-avatar">
              {{ userInitials }}
            </el-avatar>
            <span class="user-name">{{ authStore.userInfo?.nickname || '医生' }}</span>
          </div>
        </div>
      </header>
      
      <!-- Page Content -->
      <div class="page-content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import {
  Fold, Expand, HomeFilled, Collection, Microphone,
  VideoCamera, Cpu, WarningFilled, EditPen, ChatDotRound,
  Sunny, Moon, SwitchButton
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const themeStore = useThemeStore()

const sidebarCollapsed = ref(false)

const pageTitle = computed(() => {
  const titles: Record<string, string> = {
    'Dashboard': '首页概览',
    'Knowledge': '知识库中心',
    'VoiceCenter': '音色管理',
    'VideoCenter': '视频素材',
    'NarrativeKernel': '人格底座',
    'RedlineRules': '红线规则',
    'Annotations': '批注历史',
    'Rehearsal': '问诊演练场',
    'RehearsalSession': '演练会话',
  }
  return titles[route.name as string] || '医生智能体'
})

const userInitials = computed(() => {
  const name = authStore.userInfo?.nickname || ''
  return name.slice(0, 1) || '医'
})

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

const handleLogout = () => {
  ElMessageBox.confirm('确定要退出登录吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    authStore.logout()
    ElMessage.success('已退出登录')
    router.push('/login')
  }).catch(() => {})
}
</script>

<style scoped lang="scss">
.main-layout {
  display: flex;
  min-height: 100vh;
  background: var(--snow-pure);
}

// Sidebar
.sidebar {
  width: 260px;
  background: var(--snow-white);
  border-right: 1px solid var(--glacier-200);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 100;
  
  &.collapsed {
    width: 72px;
    
    .sidebar-header {
      padding: 16px 12px;
      
      .logo {
        justify-content: center;
      }
    }
    
    .nav-item {
      justify-content: center;
      padding: 12px;
      
      :deep(.el-icon) {
        margin: 0;
      }
    }
    
    .footer-btn {
      justify-content: center;
      padding: 10px;
      
      :deep(.el-icon) {
        margin: 0;
      }
    }
  }
}

.sidebar-header {
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--glacier-100);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--ice-primary) 0%, var(--aurora-cyan) 100%);
  border-radius: 10px;
  color: white;
  flex-shrink: 0;
  
  svg {
    width: 22px;
    height: 22px;
  }
}

.logo-text {
  font-weight: 700;
  font-size: 16px;
  color: var(--glacier-800);
  white-space: nowrap;
}

.collapse-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--glacier-100);
  border-radius: 8px;
  cursor: pointer;
  color: var(--glacier-500);
  transition: all 0.2s;
  
  &:hover {
    background: var(--glacier-200);
    color: var(--glacier-700);
  }
}

.sidebar-nav {
  flex: 1;
  padding: 16px 12px;
  overflow-y: auto;
}

.nav-section {
  margin-bottom: 8px;
}

.nav-title {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--glacier-400);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--glacier-600);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
  margin-bottom: 2px;
  
  :deep(.el-icon) {
    font-size: 18px;
  }
  
  &:hover {
    background: var(--glacier-100);
    color: var(--glacier-800);
  }
  
  &.router-link-active {
    background: linear-gradient(135deg, var(--ice-primary-100) 0%, rgba(34, 211, 238, 0.1) 100%);
    color: var(--ice-primary-dark);
    
    &::before {
      content: '';
      position: absolute;
      left: 0;
      width: 3px;
      height: 20px;
      background: var(--ice-primary);
      border-radius: 0 3px 3px 0;
    }
  }
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--glacier-100);
}

.footer-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--glacier-500);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
  
  &:hover {
    background: var(--glacier-100);
    color: var(--glacier-700);
  }
  
  &.logout:hover {
    background: rgba(239, 68, 68, 0.1);
    color: var(--error);
  }
}

// Main Content
.main-content {
  flex: 1;
  margin-left: 260px;
  display: flex;
  flex-direction: column;
  transition: margin-left 0.3s ease;
  
  .sidebar.collapsed + & {
    margin-left: 72px;
  }
}

.header {
  height: 64px;
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--snow-white);
  border-bottom: 1px solid var(--glacier-200);
  position: sticky;
  top: 0;
  z-index: 50;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--glacier-800);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-avatar {
  background: linear-gradient(135deg, var(--ice-primary) 0%, var(--aurora-cyan) 100%);
  color: white;
  font-weight: 600;
}

.user-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--glacier-700);
}

.page-content {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
}

// Dark mode
[data-theme='dark'] {
  .main-layout {
    background: var(--glacier-950);
  }
  
  .sidebar {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .sidebar-header,
  .sidebar-footer {
    border-color: var(--glacier-800);
  }
  
  .collapse-btn {
    background: var(--glacier-800);
    color: var(--glacier-400);
    
    &:hover {
      background: var(--glacier-700);
      color: var(--glacier-200);
    }
  }
  
  .nav-item {
    color: var(--glacier-400);
    
    &:hover {
      background: var(--glacier-800);
      color: var(--glacier-200);
    }
    
    &.router-link-active {
      background: rgba(14, 165, 233, 0.15);
    }
  }
  
  .footer-btn:hover {
    background: var(--glacier-800);
  }
  
  .header {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .page-title,
  .user-name {
    color: var(--glacier-100);
  }
}

// Page transition
.page-enter-active,
.page-leave-active {
  transition: all 0.2s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
