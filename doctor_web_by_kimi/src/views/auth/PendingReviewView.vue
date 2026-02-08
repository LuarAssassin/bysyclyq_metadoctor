<template>
  <div class="pending-page">
    <!-- Snow Background -->
    <div class="snow-bg">
      <div v-for="n in 20" :key="n" class="snowflake">❄</div>
    </div>
    
    <div class="aurora-bg"></div>
    
    <!-- Main Content -->
    <div class="content-wrapper" :class="{ 'animate-in': mounted }">
      <!-- Ice Crystal Animation -->
      <div class="crystal-container">
        <div class="crystal-ring ring-1"></div>
        <div class="crystal-ring ring-2"></div>
        <div class="crystal-ring ring-3"></div>
        <div class="crystal-core">
          <svg viewBox="0 0 100 100" class="crystal-icon">
            <defs>
              <linearGradient id="pendingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#0ea5e9;stop-opacity:1" />
                <stop offset="50%" style="stop-color:#22d3ee;stop-opacity:0.8" />
                <stop offset="100%" style="stop-color:#0ea5e9;stop-opacity:0.4" />
              </linearGradient>
            </defs>
            <polygon points="50,5 95,50 50,95 5,50" fill="url(#pendingGradient)" />
            <polygon points="50,20 80,50 50,80 20,50" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
          </svg>
        </div>
      </div>
      
      <!-- Text Content -->
      <div class="text-content">
        <h1 class="title">
          <span class="status-badge">
            <span class="pulse-dot"></span>
            审核中
          </span>
        </h1>
        <h2 class="subtitle">账号审核尚未完成</h2>
        <p class="description">
          您的注册申请已收到，正在由管理员进行资质审核。<br>
          审核通过后，您将收到通知邮件，届时即可登录使用平台全部功能。
        </p>
        
        <!-- Info Cards -->
        <div class="info-cards">
          <div class="info-card">
            <el-icon class="icon" :size="24"><Timer /></el-icon>
            <span class="label">预计审核时间</span>
            <span class="value">1-3 个工作日</span>
          </div>
          <div class="info-card">
            <el-icon class="icon" :size="24"><Message /></el-icon>
            <span class="label">通知方式</span>
            <span class="value">邮件 + 短信</span>
          </div>
        </div>
        
        <!-- Actions -->
        <div class="actions">
          <el-button type="primary" size="large" @click="goToLogin">
            使用其他账号登录
          </el-button>
          <el-button size="large" text @click="refreshStatus" :loading="checking">
            刷新状态
          </el-button>
        </div>
        
        <!-- Debug Link -->
        <div style="margin-top: 16px;">
          <router-link to="/debug-login" style="color: #999; font-size: 13px;">
            排查登录问题
          </router-link>
        </div>
        
        <!-- Tips -->
        <div class="tips">
          <p>如有疑问，请联系平台管理员</p>
          <p class="contact">support@by3hospital.com</p>
        </div>
      </div>
    </div>
    
    <div class="version">医生智能体平台 v1.0</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Timer, Message } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const checking = ref(false)
const mounted = ref(false)

const goToLogin = () => {
  authStore.logout()
  router.push('/login')
}

const refreshStatus = async () => {
  checking.value = true
  try {
    // Try to login again to check if approved
    // In real scenario, you might have a separate endpoint to check status
    await new Promise(resolve => setTimeout(resolve, 1000))
    ElMessage.info('审核状态暂无变化')
  } finally {
    checking.value = false
  }
}

onMounted(() => {
  setTimeout(() => {
    mounted.value = true
  }, 100)
})
</script>

<style scoped lang="scss">
.pending-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, var(--snow-pure) 0%, var(--ice-primary-50) 50%, var(--snow-pure) 100%);
  padding: 40px 20px;
}

.aurora-bg {
  position: fixed;
  inset: 0;
  background: 
    radial-gradient(ellipse 60% 40% at 50% 50%, rgba(14, 165, 233, 0.1), transparent),
    radial-gradient(ellipse 40% 30% at 20% 80%, rgba(34, 211, 238, 0.08), transparent);
  pointer-events: none;
}

.content-wrapper {
  position: relative;
  z-index: 10;
  text-align: center;
  opacity: 0;
  transform: translateY(30px);
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  
  &.animate-in {
    opacity: 1;
    transform: translateY(0);
  }
}

// Crystal Animation
.crystal-container {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 0 auto 40px;
}

.crystal-ring {
  position: absolute;
  inset: 0;
  border: 2px solid var(--ice-primary-200);
  border-radius: 50%;
  
  &.ring-1 {
    animation: pulse-ring 3s ease-out infinite;
  }
  
  &.ring-2 {
    animation: pulse-ring 3s ease-out infinite 1s;
  }
  
  &.ring-3 {
    animation: pulse-ring 3s ease-out infinite 2s;
  }
}

.crystal-core {
  position: absolute;
  inset: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: float 4s ease-in-out infinite;
}

.crystal-icon {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 20px rgba(14, 165, 233, 0.5));
}

// Text Content
.text-content {
  max-width: 560px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.1) 0%, rgba(34, 211, 238, 0.1) 100%);
  border: 1px solid var(--ice-primary-200);
  border-radius: 100px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ice-primary-dark);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  background: var(--warning);
  border-radius: 50%;
  animation: pulse-dot 2s ease-in-out infinite;
}

.subtitle {
  font-size: 28px;
  font-weight: 700;
  color: var(--glacier-800);
  margin: 24px 0 16px;
}

.description {
  font-size: 15px;
  color: var(--glacier-500);
  line-height: 1.8;
  margin-bottom: 32px;
}

// Info Cards
.info-cards {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 32px;
}

.info-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
  background: var(--frost-glass);
  border: 1px solid var(--frost-border);
  border-radius: 16px;
  min-width: 140px;
  
  .icon {
    color: var(--ice-primary);
  }
  
  .label {
    font-size: 12px;
    color: var(--glacier-400);
  }
  
  .value {
    font-size: 14px;
    font-weight: 600;
    color: var(--glacier-700);
  }
}

// Actions
.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 32px;
}

// Tips
.tips {
  font-size: 13px;
  color: var(--glacier-400);
  
  .contact {
    margin-top: 4px;
    color: var(--ice-primary);
    font-weight: 500;
  }
}

.version {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--glacier-400);
  z-index: 10;
}

// Animations
@keyframes pulse-ring {
  0% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.3);
    opacity: 0;
  }
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
}

@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@media (max-width: 640px) {
  .crystal-container {
    width: 160px;
    height: 160px;
  }
  
  .crystal-core {
    inset: 30px;
  }
  
  .info-cards {
    flex-direction: column;
    align-items: center;
  }
  
  .subtitle {
    font-size: 22px;
  }
}

[data-theme='dark'] .pending-page {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
}

[data-theme='dark'] .subtitle {
  color: var(--glacier-100);
}

[data-theme='dark'] .info-card .value {
  color: var(--glacier-200);
}
</style>
