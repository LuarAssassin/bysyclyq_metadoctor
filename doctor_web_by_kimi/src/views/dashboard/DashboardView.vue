<template>
  <div class="dashboard">
    <!-- Welcome Section -->
    <div class="welcome-section">
      <div class="welcome-content">
        <h1 class="welcome-title">
          欢迎回来，<span class="gradient-text">{{ authStore.userInfo?.nickname || '医生' }}</span>
        </h1>
        <p class="welcome-subtitle">今天也是充满能量的一天，开始您的智能诊疗之旅吧</p>
      </div>
      <div class="welcome-stats">
        <div class="stat-card">
          <div class="stat-icon knowledge">
            <el-icon><Document /></el-icon>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.knowledgeCount }}</span>
            <span class="stat-label">知识文件</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon rehearsal">
            <el-icon><ChatDotRound /></el-icon>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.sessionCount }}</span>
            <span class="stat-label">演练会话</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon video">
            <el-icon><VideoCamera /></el-icon>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.videoCount }}</span>
            <span class="stat-label">视频素材</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Quick Actions -->
    <div class="section">
      <h2 class="section-title">快速入口</h2>
      <div class="quick-actions">
        <router-link to="/knowledge" class="action-card">
          <div class="action-icon knowledge">
            <el-icon><Upload /></el-icon>
          </div>
          <span class="action-title">上传知识</span>
          <span class="action-desc">补充专业资料</span>
        </router-link>
        <router-link to="/digital-human/voice" class="action-card">
          <div class="action-icon voice">
            <el-icon><Microphone /></el-icon>
          </div>
          <span class="action-title">复刻音色</span>
          <span class="action-desc">生成专属声音</span>
        </router-link>
        <router-link to="/rehearsal" class="action-card">
          <div class="action-icon rehearsal">
            <el-icon><ChatLineRound /></el-icon>
          </div>
          <span class="action-title">开始演练</span>
          <span class="action-desc">AI 问诊对话</span>
        </router-link>
        <router-link to="/narrative/kernel" class="action-card">
          <div class="action-icon narrative">
            <el-icon><Setting /></el-icon>
          </div>
          <span class="action-title">调优底座</span>
          <span class="action-desc">人格风格设定</span>
        </router-link>
      </div>
    </div>
    
    <!-- Recent Activity -->
    <div class="section">
      <h2 class="section-title">最近动态</h2>
      <div class="activity-list">
        <div v-for="(activity, index) in recentActivities" :key="index" class="activity-item">
          <div class="activity-icon" :class="activity.type">
            <el-icon>
              <component :is="activity.icon" />
            </el-icon>
          </div>
          <div class="activity-content">
            <span class="activity-text">{{ activity.text }}</span>
            <span class="activity-time">{{ activity.time }}</span>
          </div>
        </div>
        <div v-if="recentActivities.length === 0" class="empty-state">
          <el-icon :size="48" class="empty-icon"><InfoFilled /></el-icon>
          <p>暂无最近动态</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  Document, ChatDotRound, VideoCamera, Upload,
  Microphone, ChatLineRound, Setting, InfoFilled
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { getKnowledgeList } from '@/api/knowledge'
import { getSessions } from '@/api/rehearsal'
import { getVideos } from '@/api/digitalHuman'

const authStore = useAuthStore()

const stats = ref({
  knowledgeCount: 0,
  sessionCount: 0,
  videoCount: 0,
})

const recentActivities = ref([
  { type: 'knowledge', icon: 'Plus', text: '上传了新的知识文件《运动损伤康复指南》', time: '2小时前' },
  { type: 'rehearsal', icon: 'ChatLineRound', text: '完成了问诊演练会话', time: '昨天' },
  { type: 'voice', icon: 'Check', text: '音色克隆成功', time: '3天前' },
])

const fetchStats = async () => {
  try {
    const [knowledgeRes, sessionsRes, videosRes] = await Promise.all([
      getKnowledgeList({ page_size: 1 }),
      getSessions(),
      getVideos(),
    ])
    stats.value.knowledgeCount = knowledgeRes.count
    stats.value.sessionCount = sessionsRes.length
    stats.value.videoCount = videosRes.length
  } catch {
    // Silent fail
  }
}

onMounted(() => {
  fetchStats()
})
</script>

<style scoped lang="scss">
.dashboard {
  max-width: 1200px;
}

// Welcome Section
.welcome-section {
  margin-bottom: 32px;
}

.welcome-content {
  margin-bottom: 24px;
}

.welcome-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--glacier-800);
  margin-bottom: 8px;
}

.welcome-subtitle {
  color: var(--glacier-500);
  font-size: 15px;
}

.welcome-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
}

.stat-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  
  &.knowledge {
    background: linear-gradient(135deg, rgba(14, 165, 233, 0.1) 0%, rgba(34, 211, 238, 0.1) 100%);
    color: var(--ice-primary);
  }
  
  &.rehearsal {
    background: linear-gradient(135deg, rgba(167, 139, 250, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
    color: var(--aurora-purple);
  }
  
  &.video {
    background: linear-gradient(135deg, rgba(20, 184, 166, 0.1) 0%, rgba(45, 212, 191, 0.1) 100%);
    color: var(--aurora-teal);
  }
  
  :deep(.el-icon) {
    font-size: 24px;
  }
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--glacier-800);
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: var(--glacier-500);
  margin-top: 4px;
}

// Section
.section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 16px;
}

// Quick Actions
.quick-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 20px;
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 16px;
  text-decoration: none;
  transition: all 0.2s;
  box-shadow: var(--shadow-sm);
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: var(--ice-primary-200);
  }
}

.action-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  
  &.knowledge {
    background: linear-gradient(135deg, var(--ice-primary) 0%, var(--aurora-cyan) 100%);
  }
  
  &.voice {
    background: linear-gradient(135deg, var(--aurora-purple) 0%, #8b5cf6 100%);
  }
  
  &.rehearsal {
    background: linear-gradient(135deg, var(--aurora-teal) 0%, #2dd4bf 100%);
  }
  
  &.narrative {
    background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
  }
  
  :deep(.el-icon) {
    font-size: 28px;
    color: white;
  }
}

.action-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--glacier-800);
}

.action-desc {
  font-size: 13px;
  color: var(--glacier-500);
}

// Activity List
.activity-list {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 16px;
  padding: 8px;
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border-radius: 12px;
  transition: background 0.2s;
  
  &:hover {
    background: var(--glacier-50);
  }
  
  & + .activity-item {
    border-top: 1px solid var(--glacier-100);
  }
}

.activity-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  
  &.knowledge {
    background: var(--ice-primary-100);
    color: var(--ice-primary);
  }
  
  &.rehearsal {
    background: rgba(167, 139, 250, 0.1);
    color: var(--aurora-purple);
  }
  
  &.voice {
    background: rgba(20, 184, 166, 0.1);
    color: var(--aurora-teal);
  }
}

.activity-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.activity-text {
  font-size: 14px;
  color: var(--glacier-700);
}

.activity-time {
  font-size: 12px;
  color: var(--glacier-400);
}

.empty-state {
  padding: 48px;
  text-align: center;
  color: var(--glacier-400);
  
  .empty-icon {
    margin-bottom: 12px;
    opacity: 0.5;
  }
}

@media (max-width: 1024px) {
  .welcome-stats {
    grid-template-columns: 1fr;
  }
  
  .quick-actions {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .quick-actions {
    grid-template-columns: 1fr;
  }
}

[data-theme='dark'] {
  .welcome-title,
  .section-title,
  .stat-value,
  .action-title {
    color: var(--glacier-100);
  }
  
  .stat-card,
  .action-card,
  .activity-list {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .activity-item:hover {
    background: var(--glacier-800);
  }
  
  .activity-item + .activity-item {
    border-color: var(--glacier-800);
  }
}
</style>
