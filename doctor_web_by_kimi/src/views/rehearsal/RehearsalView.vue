<template>
  <div class="rehearsal-page">
    <!-- Header -->
    <div class="page-header">
      <div class="header-info">
        <h1 class="page-title">AI 问诊演练场</h1>
        <p class="page-desc">与您的数字人智能体进行问诊对话演练</p>
      </div>
      <el-button type="primary" size="large" @click="createNewSession">
        <el-icon><Plus /></el-icon>
        新建演练
      </el-button>
    </div>
    
    <!-- Sessions Grid -->
    <div class="sessions-grid">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-card"
        @click="goToSession(session.id)"
      >
        <div class="session-icon">
          <el-icon :size="24"><ChatDotRound /></el-icon>
        </div>
        <div class="session-info">
          <h3 class="session-title">{{ session.title || '未命名演练' }}</h3>
          <p class="session-meta">
            {{ formatDate(session.updated_at) }} · {{ session.message_count || 0 }} 条消息
          </p>
        </div>
        <el-icon class="session-arrow"><ArrowRight /></el-icon>
      </div>
      
      <!-- Create New Card -->
      <div class="session-card create" @click="createNewSession">
        <div class="create-icon">
          <el-icon :size="32"><Plus /></el-icon>
        </div>
        <span class="create-text">开始新演练</span>
      </div>
    </div>
    
    <el-empty v-if="sessions.length === 0 && !loading" description="暂无演练会话，开始创建第一个吧" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus, ChatDotRound, ArrowRight } from '@element-plus/icons-vue'
import { getSessions, createSession } from '@/api/rehearsal'
import type { RehearsalSession } from '@/types'

const router = useRouter()
const sessions = ref<RehearsalSession[]>([])
const loading = ref(false)

const fetchSessions = async () => {
  loading.value = true
  try {
    sessions.value = await getSessions()
  } finally {
    loading.value = false
  }
}

const createNewSession = async () => {
  try {
    const session = await createSession({ title: `演练 ${new Date().toLocaleString('zh-CN')}` })
    router.push(`/rehearsal/${session.id}`)
  } catch {
    ElMessage.error('创建失败')
  }
}

const goToSession = (id: number) => {
  router.push(`/rehearsal/${id}`)
}

const formatDate = (date: string) => {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  
  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (24 * 60 * 60 * 1000))}天前`
  }
  return d.toLocaleDateString('zh-CN')
}

onMounted(() => {
  fetchSessions()
})
</script>

<style scoped lang="scss">
.rehearsal-page {
  max-width: 1200px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--glacier-800);
  margin-bottom: 4px;
}

.page-desc {
  color: var(--glacier-500);
  font-size: 14px;
}

// Sessions Grid
.sessions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.session-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    border-color: var(--ice-primary);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    
    .session-arrow {
      transform: translateX(4px);
      opacity: 1;
    }
  }
  
  &.create {
    flex-direction: column;
    justify-content: center;
    min-height: 100px;
    border-style: dashed;
    background: var(--glacier-50);
    
    &:hover {
      background: var(--ice-primary-50);
    }
  }
}

.session-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--aurora-teal) 0%, #2dd4bf 100%);
  border-radius: 12px;
  color: white;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  font-size: 13px;
  color: var(--glacier-400);
}

.session-arrow {
  color: var(--glacier-400);
  opacity: 0;
  transition: all 0.2s;
}

.create-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glacier-200);
  border-radius: 14px;
  color: var(--glacier-500);
  margin-bottom: 8px;
}

.create-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--glacier-500);
}

[data-theme='dark'] {
  .page-title {
    color: var(--glacier-100);
  }
  
  .session-card {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
    
    &.create {
      background: var(--glacier-800);
    }
  }
  
  .session-title {
    color: var(--glacier-100);
  }
  
  .create-icon {
    background: var(--glacier-700);
    color: var(--glacier-400);
  }
}
</style>
