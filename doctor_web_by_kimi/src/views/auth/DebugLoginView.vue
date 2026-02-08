<template>
  <div class="debug-page">
    <div class="debug-card">
      <h1>登录调试工具</h1>
      <p>用于排查登录/审核状态问题</p>
      
      <el-form :model="form" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="form.username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="testLogin">
          测试登录
        </el-button>
      </el-form>
      
      <div v-if="result" class="result-section">
        <h3>原始响应：</h3>
        <pre class="code-block">{{ JSON.stringify(result, null, 2) }}</pre>
        
        <div v-if="result.data" class="analysis">
          <h3>分析结果：</h3>
          <el-alert
            v-if="result.data.code === 200"
            title="登录成功"
            type="success"
            description="后端返回正常，会跳转到首页"
          />
          <el-alert
            v-else-if="result.data.code === 401 && result.data.message?.includes('审核')"
            title="审核中状态"
            type="warning"
            description="医生账号正在审核中，需要等待管理员审批"
          />
          <el-alert
            v-else-if="result.data.code === 401"
            title="认证失败"
            type="error"
            :description="result.data.message || '用户名或密码错误'"
          />
          <el-alert
            v-else
            title="其他错误"
            type="error"
            :description="`Code: ${result.data.code}, Message: ${result.data.message}`"
          />
        </div>
        
        <div v-if="result.error" class="analysis">
          <h3>请求错误：</h3>
          <el-alert
            :title="result.error"
            type="error"
          />
        </div>
      </div>
      
      <div class="actions">
        <el-button @click="$router.push('/login')">返回登录页</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'

const form = reactive({
  username: '',
  password: ''
})

const loading = ref(false)
const result = ref<any>(null)

const testLogin = async () => {
  loading.value = true
  result.value = null
  
  try {
    const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || '/api'
    const response = await fetch(`${baseUrl}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    
    const data = await response.json()
    result.value = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data
    }
  } catch (error: any) {
    result.value = { error: error.message }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.debug-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  padding: 40px 20px;
}

.debug-card {
  width: 600px;
  max-width: 90vw;
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}

h1 {
  margin-bottom: 8px;
  font-size: 24px;
}

p {
  color: #666;
  margin-bottom: 24px;
}

.result-section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #eee;
}

.code-block {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}

.analysis {
  margin-top: 16px;
}

.actions {
  margin-top: 24px;
  text-align: center;
}
</style>
