<template>
  <div class="auth-page">
    <!-- Snow Background -->
    <div class="snow-bg">
      <div v-for="n in 20" :key="n" class="snowflake">❄</div>
    </div>
    
    <div class="aurora-bg"></div>
    
    <!-- Register Card -->
    <div class="auth-card-wrapper" :class="{ 'animate-in': mounted }">
      <div class="auth-card glass">
        <!-- Header -->
        <div class="auth-header">
          <div class="logo-icon">
            <Plus class="icon" />
          </div>
          <h1 class="title">医生注册</h1>
          <p class="subtitle">加入我们，共建智能诊疗新生态</p>
        </div>
        
        <!-- Form -->
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          class="auth-form"
          label-position="top"
        >
          <div class="form-grid">
            <el-form-item prop="username" label="用户名">
              <el-input
                v-model="form.username"
                placeholder="设置登录用户名"
                :prefix-icon="User"
              />
            </el-form-item>
            
            <el-form-item prop="nickname" label="医生姓名">
              <el-input
                v-model="form.nickname"
                placeholder="您的真实姓名"
                :prefix-icon="UserFilled"
              />
            </el-form-item>
          </div>
          
          <el-form-item prop="password" label="密码">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="设置登录密码"
              :prefix-icon="Lock"
              show-password
            />
          </el-form-item>
          
          <div class="form-grid">
            <el-form-item prop="email" label="电子邮箱">
              <el-input
                v-model="form.email"
                placeholder="工作邮箱"
                :prefix-icon="Message"
              />
            </el-form-item>
            
            <el-form-item prop="phone" label="联系电话">
              <el-input
                v-model="form.phone"
                placeholder="手机号码"
                :prefix-icon="Phone"
              />
            </el-form-item>
          </div>
          
          <div class="form-grid">
            <el-form-item prop="institution" label="所属机构">
              <el-input
                v-model="form.institution"
                placeholder="如：北医三院崇礼院区"
                :prefix-icon="OfficeBuilding"
              />
            </el-form-item>
            
            <el-form-item prop="profession" label="专业领域">
              <el-select
                v-model="form.profession"
                placeholder="请选择专业"
                class="w-full"
              >
                <el-option label="运动康复科" value="运动康复科" />
                <el-option label="骨科" value="骨科" />
                <el-option label="运动医学" value="运动医学" />
                <el-option label="康复医学" value="康复医学" />
                <el-option label="神经外科" value="神经外科" />
                <el-option label="其他" value="其他" />
              </el-select>
            </el-form-item>
          </div>
          
          <el-form-item prop="agreement">
            <el-checkbox v-model="form.agreement">
              我已阅读并同意
              <a href="#" class="link">《服务协议》</a>
              和
              <a href="#" class="link">《隐私政策》</a>
            </el-checkbox>
          </el-form-item>
          
          <el-button
            type="primary"
            size="large"
            class="auth-button"
            :loading="loading"
            @click="handleRegister"
          >
            提交注册申请
          </el-button>
        </el-form>
        
        <!-- Footer -->
        <div class="auth-footer">
          <span>已有账号？</span>
          <router-link to="/login" class="link">
            立即登录
            <ArrowRight class="link-icon" />
          </router-link>
        </div>
      </div>
    </div>
    
    <!-- Registration Success Modal -->
    <el-dialog
      v-model="showSuccessModal"
      :show-close="false"
      :close-on-click-modal="false"
      width="400px"
      class="success-modal"
    >
      <div class="success-content">
        <div class="success-icon">
          <CircleCheck class="icon" />
        </div>
        <h3 class="success-title">注册申请已提交</h3>
        <p class="success-desc">
          您的注册申请已进入审核队列，审核通过后即可登录使用。<br>
          我们会尽快处理您的申请。
        </p>
        <el-button type="primary" @click="goToLogin" class="w-full">
          我知道了
        </el-button>
      </div>
    </el-dialog>
    
    <div class="version">医生智能体平台 v1.0</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  User, UserFilled, Lock, Message, Phone,
  OfficeBuilding, Plus, CircleCheck, ArrowRight
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const showSuccessModal = ref(false)
const mounted = ref(false)

const form = reactive({
  username: '',
  password: '',
  email: '',
  phone: '',
  nickname: '',
  institution: '北医三院崇礼院区',
  profession: '',
  agreement: false,
})

const validateAgreement = (_rule: any, value: boolean, callback: Function) => {
  if (!value) {
    callback(new Error('请阅读并同意服务协议'))
  } else {
    callback()
  }
}

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '长度在 3 到 20 个字符', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '只能包含字母、数字和下划线', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 20, message: '长度在 8 到 20 个字符', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱地址', trigger: 'blur' },
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码', trigger: 'blur' },
  ],
  nickname: [
    { required: true, message: '请输入真实姓名', trigger: 'blur' },
  ],
  institution: [
    { required: true, message: '请输入所属机构', trigger: 'blur' },
  ],
  profession: [
    { required: true, message: '请选择专业领域', trigger: 'change' },
  ],
  agreement: [
    { validator: validateAgreement, trigger: 'change' },
  ],
}

const handleRegister = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    
    loading.value = true
    try {
      const { agreement: _, ...registerData } = form
      await authStore.register(registerData)
      showSuccessModal.value = true
    } catch (error: any) {
      ElMessage.error(error.message || '注册失败')
    } finally {
      loading.value = false
    }
  })
}

const goToLogin = () => {
  showSuccessModal.value = false
  router.push('/login')
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
  padding: 40px 20px;
}

.aurora-bg {
  position: fixed;
  inset: 0;
  background: 
    radial-gradient(ellipse 80% 50% at 30% 100%, rgba(34, 211, 238, 0.12), transparent),
    radial-gradient(ellipse 60% 40% at 70% 0%, rgba(14, 165, 233, 0.1), transparent);
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
  width: 520px;
  max-width: 90vw;
  padding: 40px 48px;
  border-radius: 24px;
}

.auth-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--aurora-teal) 0%, var(--ice-primary) 100%);
  border-radius: 16px;
  color: white;
  box-shadow: 0 8px 24px rgba(14, 165, 233, 0.3);
  
  .icon {
    width: 28px;
    height: 28px;
  }
}

.title {
  font-size: 22px;
  font-weight: 700;
  color: var(--glacier-800);
  margin-bottom: 8px;
}

.subtitle {
  color: var(--glacier-500);
  font-size: 14px;
}

.auth-form {
  :deep(.el-form-item__label) {
    font-weight: 500;
    color: var(--glacier-700);
    padding-bottom: 4px;
  }
  
  :deep(.el-input__wrapper) {
    padding: 8px 12px;
  }
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.link {
  color: var(--ice-primary);
  text-decoration: none;
  
  &:hover {
    text-decoration: underline;
  }
}

.auth-button {
  width: 100%;
  height: 44px;
  font-size: 15px;
  border-radius: 10px;
  margin-top: 8px;
}

.auth-footer {
  margin-top: 24px;
  text-align: center;
  font-size: 14px;
  color: var(--glacier-500);
  
  .link {
    margin-left: 4px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
    
    &:hover {
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

// Success Modal
.success-modal :deep(.el-dialog) {
  border-radius: 20px;
  overflow: hidden;
}

.success-content {
  text-align: center;
  padding: 16px;
}

.success-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--success) 0%, #34d399 100%);
  border-radius: 50%;
  color: white;
  animation: scale-in 0.3s ease-out;
  
  .icon {
    width: 36px;
    height: 36px;
  }
}

.success-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 12px;
}

.success-desc {
  color: var(--glacier-500);
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 24px;
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

@keyframes scale-in {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  
  .auth-card {
    padding: 32px 24px;
  }
}

[data-theme='dark'] .auth-page {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
}

[data-theme='dark'] .title {
  color: var(--glacier-100);
}
</style>
