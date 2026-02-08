<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const notice = computed(() => {
  return authStore.pendingLoginMessage || '医生账号审核中，审核通过后才能登录。'
})

const goLogin = async () => {
  await router.push('/auth/login')
}
</script>

<template>
  <div class="pending-wrap panel-enter">
    <h2>账号审核处理中</h2>
    <p>{{ notice }}</p>
    <ul>
      <li>审核通过后可直接登录医生端。</li>
      <li>若长时间未通过，请联系平台管理员。</li>
      <li>该机制用于拦截未经许可的账号接入。</li>
    </ul>
    <el-button type="primary" @click="goLogin">返回登录页</el-button>
  </div>
</template>
