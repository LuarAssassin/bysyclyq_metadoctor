<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getLastUsername } from '../../utils/storage'
import { toErrorMessage } from '../../utils/http-error'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)

const form = reactive({
  username: getLastUsername(),
  password: '',
})

const submit = async () => {
  loading.value = true
  try {
    await authStore.login(form)
    ElMessage.success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/knowledge'
    await router.push(redirect)
  } catch (error) {
    const message = toErrorMessage(error)
    if (message.includes('审核中') || message.includes('未审核通过') || message.includes('审核未通过')) {
      authStore.pendingLoginMessage = message
      await router.push('/auth/pending')
      return
    }
    ElMessage.error(message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-form-wrap">
    <h2>医生登录</h2>
    <p>仅审核通过的医生账号可进入系统。</p>

    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="用户名">
        <el-input v-model.trim="form.username" placeholder="请输入用户名" />
      </el-form-item>

      <el-form-item label="密码">
        <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" />
      </el-form-item>

      <el-button class="full-width" type="primary" :loading="loading" @click="submit">
        登录并进入工作台
      </el-button>
    </el-form>

    <div class="auth-form-footer">
      <span>还没有医生账号？</span>
      <router-link to="/auth/register">提交注册申请</router-link>
    </div>
  </div>
</template>
