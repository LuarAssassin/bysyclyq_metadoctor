<template>
  <div class="video-page">
    <!-- Upload Section -->
    <div class="upload-section">
      <div class="upload-card">
        <div class="upload-header">
          <div class="upload-icon">
            <el-icon :size="32"><VideoCamera /></el-icon>
          </div>
          <div class="upload-info">
            <h3>图生视频</h3>
            <p>上传您的正面照片，AI 自动生成多场景数字人视频</p>
          </div>
        </div>
        
        <div class="upload-form">
          <el-form :model="form" label-position="top">
            <el-form-item label="上传照片">
              <el-upload
                class="image-uploader"
                drag
                action="#"
                :auto-upload="false"
                :on-change="handleImageChange"
                :show-file-list="false"
                accept="image/*"
              >
                <img v-if="previewImage" :src="previewImage" class="preview-image" />
                <div v-else class="upload-placeholder">
                  <el-icon :size="32"><Plus /></el-icon>
                  <span>点击或拖拽上传照片</span>
                </div>
              </el-upload>
            </el-form-item>
            
            <el-form-item label="补充描述（可选）">
              <el-input
                v-model="form.prompt"
                type="textarea"
                :rows="2"
                placeholder="描述您希望视频呈现的效果，如：专业、亲和、专注..."
              />
            </el-form-item>
            
            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="generating"
                :disabled="!selectedImage"
                @click="generateVideos"
                class="generate-btn"
              >
                <el-icon><MagicStick /></el-icon>
                生成视频（默认5个场景）
              </el-button>
            </el-form-item>
          </el-form>
        </div>
      </div>
    </div>
    
    <!-- Video Grid -->
    <div class="video-grid-section">
      <div class="section-header">
        <h2 class="section-title">视频素材</h2>
        <div class="section-actions">
          <el-radio-group v-model="filterStatus" size="small">
            <el-radio-button label="">全部</el-radio-button>
            <el-radio-button label="succeeded">已完成</el-radio-button>
            <el-radio-button label="running">处理中</el-radio-button>
          </el-radio-group>
          <el-button @click="refreshVideos" :loading="loading">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>
      </div>
      
      <div class="video-grid">
        <div v-for="video in filteredVideos" :key="video.id" class="video-card">
          <div class="video-player">
            <video
              v-if="video.video_play_url && video.status === 'succeeded'"
              :src="video.video_play_url"
              controls
              class="video-element"
            />
            <div v-else class="video-placeholder" :class="video.status">
              <el-icon :size="48" v-if="video.status === 'running'" class="animate-spin"><Loading /></el-icon>
              <el-icon :size="48" v-else-if="video.status === 'failed'" class="error"><CircleClose /></el-icon>
              <el-icon :size="48" v-else><VideoCamera /></el-icon>
              <span class="status-text">{{ getStatusText(video.status) }}</span>
            </div>
          </div>
          <div class="video-info">
            <h4 class="video-name">{{ video.scene_name }}</h4>
            <p class="video-meta">{{ video.resolution }} · {{ video.duration }}秒</p>
            <p class="video-date">{{ formatDate(video.created_at) }}</p>
          </div>
          <div class="video-actions">
            <el-button
              v-if="video.status === 'running' || video.status === 'submitted'"
              type="primary"
              link
              :loading="refreshing === video.id"
              @click="refreshVideoStatus(video.id)"
            >
              刷新状态
            </el-button>
            <el-button
              v-else-if="video.video_play_url"
              type="primary"
              link
              @click="copyUrl(video.video_play_url)"
            >
              复制链接
            </el-button>
          </div>
        </div>
        
        <el-empty v-if="filteredVideos.length === 0" description="暂无视频素材" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  VideoCamera, Plus, MagicStick, Refresh,
  Loading, CircleClose
} from '@element-plus/icons-vue'
import { createVideos, getVideos, refreshVideo } from '@/api/digitalHuman'
import type { VideoAsset, UploadFile } from '@/types'

const videos = ref<VideoAsset[]>([])
const loading = ref(false)
const generating = ref(false)
const refreshing = ref<number | null>(null)
const filterStatus = ref('')
const selectedImage = ref<File | null>(null)
const previewImage = ref('')
const pollInterval = ref<NodeJS.Timeout | null>(null)

const form = ref({
  prompt: '',
})

const filteredVideos = computed(() => {
  if (!filterStatus.value) return videos.value
  return videos.value.filter(v => v.status === filterStatus.value)
})

const fetchVideos = async () => {
  loading.value = true
  try {
    videos.value = await getVideos()
  } finally {
    loading.value = false
  }
}

const handleImageChange = (uploadFile: UploadFile) => {
  const file = uploadFile.raw
  if (!file) return
  
  selectedImage.value = file
  previewImage.value = URL.createObjectURL(file)
}

const generateVideos = async () => {
  if (!selectedImage.value) return
  
  generating.value = true
  try {
    await createVideos(selectedImage.value, {
      prompt: form.value.prompt,
      generate_count: 5,
    })
    ElMessage.success('视频生成任务已提交，请稍后查看')
    form.value.prompt = ''
    selectedImage.value = null
    previewImage.value = ''
    fetchVideos()
    startPolling()
  } catch (error: any) {
    ElMessage.error(error.message || '生成失败')
  } finally {
    generating.value = false
  }
}

const refreshVideoStatus = async (id: number) => {
  refreshing.value = id
  try {
    await refreshVideo(id)
    ElMessage.success('状态已刷新')
    fetchVideos()
  } catch {
    ElMessage.error('刷新失败')
  } finally {
    refreshing.value = null
  }
}

const copyUrl = (url: string) => {
  navigator.clipboard.writeText(url)
  ElMessage.success('链接已复制')
}

const startPolling = () => {
  if (pollInterval.value) clearInterval(pollInterval.value)
  pollInterval.value = setInterval(() => {
    const hasRunning = videos.value.some(v => ['submitted', 'running'].includes(v.status))
    if (hasRunning) {
      fetchVideos()
    } else {
      if (pollInterval.value) clearInterval(pollInterval.value)
    }
  }, 5000)
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    'submitted': '已提交',
    'running': '生成中...',
    'succeeded': '已完成',
    'failed': '生成失败',
  }
  return map[status] || status
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('zh-CN')
}

const refreshVideos = () => {
  fetchVideos()
}

onMounted(() => {
  fetchVideos()
  startPolling()
})

onUnmounted(() => {
  if (pollInterval.value) clearInterval(pollInterval.value)
})
</script>

<style scoped lang="scss">
.video-page {
  max-width: 1400px;
}

// Upload Section
.upload-section {
  margin-bottom: 32px;
}

.upload-card {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 20px;
  padding: 32px;
}

.upload-header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 24px;
}

.upload-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--aurora-teal) 0%, #2dd4bf 100%);
  border-radius: 16px;
  color: white;
}

.upload-info {
  h3 {
    font-size: 20px;
    font-weight: 600;
    color: var(--glacier-800);
    margin-bottom: 4px;
  }
  
  p {
    color: var(--glacier-500);
    font-size: 14px;
  }
}

.upload-form {
  max-width: 600px;
}

.image-uploader {
  :deep(.el-upload) {
    width: 100%;
  }
  
  :deep(.el-upload-dragger) {
    width: 100%;
    height: 200px;
    background: var(--glacier-50);
    border: 2px dashed var(--glacier-300);
    border-radius: 16px;
    overflow: hidden;
    
    &:hover {
      border-color: var(--ice-primary);
    }
  }
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--glacier-400);
  gap: 8px;
}

.generate-btn {
  width: 100%;
}

// Video Grid Section
.video-grid-section {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 20px;
  padding: 24px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--glacier-800);
}

.section-actions {
  display: flex;
  gap: 12px;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.video-card {
  background: var(--glacier-50);
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.2s;
  
  &:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
  }
}

.video-player {
  aspect-ratio: 16/9;
  background: var(--glacier-900);
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--glacier-400);
  gap: 12px;
  
  &.running {
    color: var(--ice-primary);
  }
  
  &.failed {
    color: var(--error);
  }
  
  .status-text {
    font-size: 13px;
  }
}

.video-info {
  padding: 16px;
}

.video-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 4px;
}

.video-meta {
  font-size: 12px;
  color: var(--glacier-400);
  margin-bottom: 4px;
}

.video-date {
  font-size: 12px;
  color: var(--glacier-400);
}

.video-actions {
  padding: 0 16px 16px;
}

[data-theme='dark'] {
  .upload-card,
  .video-grid-section {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .image-uploader :deep(.el-upload-dragger) {
    background: var(--glacier-800);
    border-color: var(--glacier-700);
  }
  
  .video-card {
    background: var(--glacier-800);
  }
  
  .upload-info h3,
  .section-title,
  .video-name {
    color: var(--glacier-100);
  }
}
</style>
