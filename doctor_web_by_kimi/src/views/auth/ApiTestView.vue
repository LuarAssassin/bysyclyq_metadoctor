<template>
  <div class="test-page">
    <div class="test-card">
      <h1>🧪 API 直接测试</h1>
      <p>测试 doctor_li / 12345678 登录</p>
      
      <div class="test-actions">
        <el-button type="primary" :loading="loading" @click="testDirectFetch">
          使用 fetch 直接测试
        </el-button>
        <el-button type="warning" :loading="loading" @click="testAxios">
          使用 axios 测试
        </el-button>
        <el-button :loading="loading" @click="testBackendDirectly">
          尝试后端详细输出
        </el-button>
      </div>
      
      <div v-if="results.length > 0" class="results">
        <div v-for="(result, idx) in results" :key="idx" class="result-item">
          <div class="result-header">
            <span class="method">{{ result.method }}</span>
            <el-tag :type="result.success ? 'success' : 'danger'">
              {{ result.success ? '成功' : '失败' }}
            </el-tag>
          </div>
          <pre class="result-body">{{ JSON.stringify(result.data, null, 2) }}</pre>
        </div>
      </div>
      
      <div class="actions">
        <router-link to="/login">
          <el-button>返回登录</el-button>
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import axios from 'axios'

const loading = ref(false)
const results = ref<any[]>([])

const testAccount = {
  username: 'doctor_li',
  password: '12345678'
}

const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api'

const testDirectFetch = async () => {
  loading.value = true
  const result = {
    method: 'fetch() 直接请求',
    success: false,
    data: null as any
  }
  
  try {
    const response = await fetch(`${baseUrl}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testAccount)
    })
    
    result.data = {
      status: response.status,
      statusText: response.statusText,
      body: await response.json()
    }
    result.success = response.ok
  } catch (error: any) {
    result.data = { error: error.message }
  }
  
  results.value.unshift(result)
  loading.value = false
}

const testAxios = async () => {
  loading.value = true
  const result = {
    method: 'axios 请求',
    success: false,
    data: null as any
  }
  
  try {
    const response = await axios.post(`${baseUrl}/auth/login/`, testAccount, {
      headers: { 'Content-Type': 'application/json' }
    })
    result.data = {
      status: response.status,
      headers: response.headers,
      data: response.data
    }
    result.success = true
  } catch (error: any) {
    result.data = {
      error: error.message,
      response: {
        status: error.response?.status,
        data: error.response?.data
      }
    }
  }
  
  results.value.unshift(result)
  loading.value = false
}

const testBackendDirectly = async () => {
  loading.value = true
  const result = {
    method: '后端调试接口',
    success: false,
    data: null as any
  }
  
  try {
    // 尝试添加 debug 参数
    const response = await fetch(`${baseUrl}/auth/login/?debug=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...testAccount,
        _debug: true
      })
    })
    
    result.data = await response.json()
    result.success = response.ok
  } catch (error: any) {
    result.data = { error: error.message }
  }
  
  results.value.unshift(result)
  loading.value = false
}
</script>

<style scoped>
.test-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  padding: 40px 20px;
}

.test-card {
  width: 700px;
  max-width: 95vw;
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}

h1 {
  margin-bottom: 8px;
}

p {
  color: #666;
  margin-bottom: 24px;
}

.test-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.results {
  margin: 24px 0;
}

.result-item {
  background: #1e1e1e;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #333;
  color: white;
}

.method {
  font-weight: 600;
}

.result-body {
  padding: 16px;
  margin: 0;
  color: #d4d4d4;
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}

.actions {
  margin-top: 24px;
  text-align: center;
}
</style>
