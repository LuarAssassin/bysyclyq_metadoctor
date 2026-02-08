<template>
  <div class="auth-page">
    <!-- Snow Background -->
    <div class="snow-bg">
      <div v-for="n in 20" :key="n" class="snowflake">❄</div>
    </div>
    
    <!-- Aurora Gradient -->
    <div class="aurora-bg"></div>
    
    <!-- Login Card -->
    <div class="auth-card-wrapper" :class="{ 'animate-in': mounted }">
      <div class="auth-card glass">
        <!-- Header -->
        <div class="auth-header">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 class="title">
            <span class="gradient-text">{{ appTitle }}</span>
          </h1>
          <p class="subtitle">{{ appSubtitle }}</p>
        </div>
        
        <!-- Form -->
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          class="auth-form"
          @keyup.enter="handleLogin"
        >
          <el-form-item prop="username">
            <el-input
              v-model="form.username"
              placeholder="用户名"
              size="large"
              :prefix-icon="User"
              class="auth-input"
            />
          </el-form-item>
          
          <el-form-item prop="password">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="密码"
              size="large"
              :prefix-icon="Lock"
              show-password
              class="auth-input"
            />
          </el-form-item>
          
          <div class="form-options">
            <el-checkbox v-model="rememberMe">记住我</el-checkbox>
          </div>
          
          <el-button
            type="primary"
            size="large"
            class="auth-button"
            :loading="loading"
            @click="handleLogin"
          >
            <template #icon>
              <ArrowRight v-if="!loading" />
            </template>
            登录
          </el-button>
        </el-form>
        
        <!-- Debug Tools -->
        <div class="debug-tools">
          <el-divider>测试工具</el-divider>
          <el-button type="warning" plain size="small" @click="testDoctorLi">
            🧪 测试 doctor_li 账号
          </el-button>
          <el-button plain size="small" @click="showRawResponse = !showRawResponse">
            {{ showRawResponse ? '隐藏' : '显示' }}原始响应
          </el-button>
        </div>
        
        <div v-if="rawResponse" class="raw-response">
          <pre>{{ JSON.stringify(rawResponse, null, 2) }}</pre>
        </div>
        
        <!-- Footer -->
        <div class="auth-footer">
          <span>还没有账号？</span>
          <router-link to="/register" class="link">
            立即注册
            <ArrowRight class="link-icon" />
          </router-link>
        </div>
        
        <!-- Ice Crystal Decoration -->
        <div class="crystal-decoration">
          <svg viewBox="0 0 100 100" class="crystal">
            <polygon points="50,0 100,50 50,100 0,50" fill="url(#crystalGradient)" opacity="0.3"/>
            <defs>
              <linearGradient id="crystalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#0ea5e9;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#22d3ee;stop-opacity:0.5" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
    </div>
    
    <!-- Version -->
    <div class="version">医生智能体平台 v1.0</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock, ArrowRight } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()
const appTitle = (import.meta as any).env?.VITE_APP_TITLE || '医生智能体'
const appSubtitle = (import.meta as any).env?.VITE_APP_SUBTITLE || '运动康复元宇宙诊疗平台'

const formRef = ref<FormInstance>()
const loading = ref(false)
const rememberMe = ref(false)
const mounted = ref(false)
const showRawResponse = ref(false)
const rawResponse = ref<any>(null)

const form = reactive({
  username: '',
  password: '',
})

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '长度在 3 到 20 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 20, message: '长度在 6 到 20 个字符', trigger: 'blur' },
  ],
}

const handleLogin = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    
    loading.value = true
    try {
      console.log('[Login] Attempting login...', form.username)
      await authStore.login(form)
      console.log('[Login] Success, redirecting...')
      ElMessage.success('登录成功')
      router.push('/')
    } catch (error: any) {
      console.error('[Login] Error:', error)
      if (error.isPendingReview) {
        console.log('[Login] Redirecting to pending review')
        router.push('/pending-review')
      } else if (error.code === 401) {
        ElMessage.error(error.message || '用户名或密码错误')
      } else {
        ElMessage.error(error.message || '登录失败')
      }
    } finally {
      loading.value = false
    }
  })
}

const testDoctorLi = async () => {
  loading.value = true
  rawResponse.value = null
  
  const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api'
  
  try {
    console.log('[Test Doctor Li] Starting test...', baseUrl)
    
    // 添加时间戳避免缓存
    const response = await fetch(`${baseUrl}/auth/login/?_t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'doctor_li',
        password: '12345678'
      })
    })
    
    const data = await response.json()
    
    rawResponse.value = {
      httpStatus: response.status,
      httpStatusText: response.statusText,
      body: data,
      analysis: {
        isBusinessCode200: data.code === 200,
        isPendingReview: data.code === 401 && data.message?.includes('审核'),
        hasToken: !!(data.data?.access && data.data?.refresh),
        canLogin: data.code === 200 && data.data?.access
      }
    }
    
    console.log('[Test Doctor Li] Response:', rawResponse.value)
    
    if (data.code === 200 && data.data?.access) {
      ElMessage.success('✅ 后端返回正常，可以登录！')
    } else if (data.code === 401 && data.message?.includes('审核')) {
      ElMessage.error('❌ 后端认为账号在审核中')
    } else {
      ElMessage.warning(`⚠️ 异常响应: ${data.message || '未知错误'}`)
    }
  } catch (error: any) {
    rawResponse.value = { error: error.message }
    ElMessage.error(`请求失败: ${error.message}`)
  } finally {
    loading.value = false
    showRawResponse.value = true
  }
}

onMounted(() => {
  setTimeout(() => {
    mounted.value = true
  }, 100)
})
</script>

<style scoped lang="scss">
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, var(--snow-pure) 0%, var(--ice-primary-50) 50%, var(--snow-pure) 100%);
}

.aurora-bg {
  position: fixed;
  inset: 0;
  background: 
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14, 165, 233, 0.15), transparent),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(34, 211, 238, 0.1), transparent);
  pointer-events: none;
}

.auth-card-wrapper {
  position: relative;
  z-index: 10;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  
  &.animate-in {
    opacity: 1;
    transform: translateY(0);
  }
}

.auth-card {
  width: 420px;
  padding: 48px;
  border-radius: 24px;
  position: relative;
  overflow: hidden;
}

.auth-header {
  text-align: center;
  margin-bottom: 40px;
}

.logo-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--ice-primary) 0%, var(--aurora-cyan) 100%);
  border-radius: 16px;
  color: white;
  box-shadow: 0 8px 24px rgba(14, 165, 233, 0.3);
  
  svg {
    width: 32px;
    height: 32px;
  }
}

.title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 8px;
}

.subtitle {
  color: var(--glacier-500);
  font-size: 14px;
}

.auth-form {
  :deep(.el-input__wrapper) {
    padding: 12px 16px;
    box-shadow: 0 0 0 1px var(--glacier-200);
    
    &:hover, &:focus, &.is-focus {
      box-shadow: 0 0 0 2px var(--ice-primary-light);
    }
  }
}

.form-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: -8px 0 24px;
  font-size: 14px;
}

.auth-button {
  width: 100%;
  height: 48px;
  font-size: 16px;
  border-radius: 12px;
}

.auth-footer {
  margin-top: 32px;
  text-align: center;
  font-size: 14px;
  color: var(--glacier-500);
  
  .link {
    margin-left: 8px;
    color: var(--ice-primary);
    text-decoration: none;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
    
    &:hover {
      color: var(--ice-primary-dark);
      
      .link-icon {
        transform: translateX(4px);
      }
    }
  }
  
  .link-icon {
    width: 14px;
    height: 14px;
    transition: transform 0.2s;
  }
}

.crystal-decoration {
  position: absolute;
  bottom: -60px;
  right: -60px;
  width: 200px;
  height: 200px;
  pointer-events: none;
  animation: float 8s ease-in-out infinite;
}

.debug-tools {
  margin: 16px 0;
  text-align: center;
  
  .el-divider {
    margin: 16px 0;
  }
}

.raw-response {
  margin: 16px 0;
  background: #1e1e1e;
  border-radius: 8px;
  overflow: hidden;
  
  pre {
    padding: 12px;
    margin: 0;
    color: #d4d4d4;
    font-size: 11px;
    line-height: 1.5;
    max-height: 300px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
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

/* Dark mode adjustments */
[data-theme='dark'] .auth-page {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
}

[data-theme='dark'] .aurora-bg {
  background: 
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14, 165, 233, 0.2), transparent),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(34, 211, 238, 0.15), transparent);
}
</style>
