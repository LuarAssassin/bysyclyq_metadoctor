<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { toErrorMessage } from '../../utils/http-error'

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)

const form = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  email: '',
  phone: '',
  nickname: '',
  institution: '北医三院',
  profession: '骨科',
})

const submit = async () => {
  if (!form.username || !form.password || !form.email || !form.phone || !form.nickname) {
    ElMessage.warning('请完整填写注册信息')
    return
  }

  if (form.password.length < 6) {
    ElMessage.warning('密码长度至少 6 位')
    return
  }

  if (form.password !== form.confirmPassword) {
    ElMessage.warning('两次密码输入不一致')
    return
  }

  loading.value = true
  try {
    const result = await authStore.register({
      username: form.username,
      password: form.password,
      email: form.email,
      phone: form.phone,
      nickname: form.nickname,
      institution: form.institution,
      profession: form.profession,
    })
    authStore.pendingLoginMessage = result.message
    ElMessage.success('申请已提交，等待审核')
    await router.push('/auth/pending')
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-form-wrap">
    <h2>医生注册申请</h2>
    <p>提交资质后进入审核队列，审核通过后可登录。</p>

    <el-form label-position="top" @submit.prevent="submit">
      <el-row :gutter="14">
        <el-col :span="12">
          <el-form-item label="用户名">
            <el-input v-model.trim="form.username" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="昵称">
            <el-input v-model.trim="form.nickname" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="14">
        <el-col :span="12">
          <el-form-item label="邮箱">
            <el-input v-model.trim="form.email" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="手机号">
            <el-input v-model.trim="form.phone" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="14">
        <el-col :span="12">
          <el-form-item label="机构">
            <el-input v-model.trim="form.institution" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="科室/专业">
            <el-input v-model.trim="form.profession" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="14">
        <el-col :span="12">
          <el-form-item label="密码">
            <el-input v-model="form.password" type="password" show-password />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="确认密码">
            <el-input v-model="form.confirmPassword" type="password" show-password />
          </el-form-item>
        </el-col>
      </el-row>

      <el-button class="full-width" type="primary" :loading="loading" @click="submit">
        提交医生申请
      </el-button>
    </el-form>

    <div class="auth-form-footer">
      <span>已有账号？</span>
      <router-link to="/auth/login">返回登录</router-link>
    </div>
  </div>
</template>
