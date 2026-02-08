<template>
  <div class="voice-page">
    <!-- Upload Section -->
    <div class="upload-section">
      <div class="upload-card">
        <div class="upload-header">
          <div class="upload-icon">
            <el-icon :size="32"><Microphone /></el-icon>
          </div>
          <div class="upload-info">
            <h3>音色复刻</h3>
            <p>上传您的录音样本，生成专属数字人音色</p>
          </div>
        </div>
        
        <el-upload
          class="voice-uploader"
          drag
          action="#"
          :auto-upload="false"
          :on-change="handleFileChange"
          :show-file-list="false"
          accept=".mp3,.wav,.m4a,.aac,.flac,.ogg"
        >
          <el-icon class="el-icon--upload" :size="48"><Upload /></el-icon>
          <div class="el-upload__text">
            拖拽音频文件到此处或 <em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">
              支持 MP3、WAV、M4A、AAC、FLAC、OGG 格式，最大 20MB
            </div>
          </template>
        </el-upload>
        
        <div v-if="uploading" class="upload-progress">
          <el-progress :percentage="uploadProgress" :status="uploadStatus" />
          <p class="progress-text">{{ uploadText }}</p>
        </div>
      </div>
    </div>
    
    <!-- Voice List -->
    <div class="voice-list-section">
      <div class="section-header">
        <h2 class="section-title">我的音色</h2>
        <el-button @click="refreshVoices" :loading="loading">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
      
      <div class="voice-grid">
        <div v-for="voice in voices" :key="voice.id" class="voice-card" :class="{ active: voice.is_active }">
          <div class="voice-visual">
            <div class="wave-container">
              <div v-for="i in 5" :key="i" class="wave-bar" :style="{ animationDelay: `${i * 0.1}s` }"></div>
            </div>
          </div>
          <div class="voice-info">
            <h4 class="voice-name">{{ voice.name || '未命名音色' }}</h4>
            <p class="voice-id">ID: {{ voice.voice_id.slice(0, 16) }}...</p>
            <p class="voice-date">创建于 {{ formatDate(voice.created_at) }}</p>
          </div>
          <div class="voice-actions">
            <el-tag v-if="voice.is_active" type="success" effect="dark">当前启用</el-tag>
            <el-button v-else type="primary" link @click="activateVoice(voice.id)">
              启用
            </el-button>
          </div>
        </div>
        
        <el-empty v-if="voices.length === 0" description="暂无音色，请上传音频创建" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Microphone, Upload, Refresh } from '@element-plus/icons-vue'
import { uploadVoice, getVoices } from '@/api/digitalHuman'
import type { VoiceAsset, UploadFile } from '@/types'

const voices = ref<VoiceAsset[]>([])
const loading = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const uploadStatus = ref('')
const uploadText = ref('准备上传...')

const fetchVoices = async () => {
  loading.value = true
  try {
    voices.value = await getVoices()
  } finally {
    loading.value = false
  }
}

const handleFileChange = async (uploadFile: UploadFile) => {
  const file = uploadFile.raw
  if (!file) return
  
  // Validate file size (20MB)
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.error('文件大小不能超过 20MB')
    return
  }
  
  uploading.value = true
  uploadProgress.value = 0
  uploadStatus.value = ''
  uploadText.value = '正在上传...'
  
  // Simulate progress
  const progressInterval = setInterval(() => {
    if (uploadProgress.value < 90) {
      uploadProgress.value += 10
    }
  }, 300)
  
  try {
    await uploadVoice(file, { name: file.name, set_active: true })
    uploadProgress.value = 100
    uploadStatus.value = 'success'
    uploadText.value = '音色复刻成功！'
    ElMessage.success('音色复刻成功')
    fetchVoices()
  } catch (error: any) {
    uploadStatus.value = 'exception'
    uploadText.value = '上传失败'
    ElMessage.error(error.message || '上传失败')
  } finally {
    clearInterval(progressInterval)
    setTimeout(() => {
      uploading.value = false
    }, 1500)
  }
}

const activateVoice = async (_id: number) => {
  // API call to activate voice
  ElMessage.success('已启用该音色')
  fetchVoices()
}

const refreshVoices = () => {
  fetchVoices()
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('zh-CN')
}

onMounted(() => {
  fetchVoices()
})
</script>

<style scoped lang="scss">
.voice-page {
  max-width: 1200px;
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
  background: linear-gradient(135deg, var(--aurora-purple) 0%, #8b5cf6 100%);
  border-radius: 16px;
  color: white;
  
  :deep(.el-icon) {
    font-size: 32px;
  }
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

.voice-uploader {
  :deep(.el-upload) {
    width: 100%;
  }
  
  :deep(.el-upload-dragger) {
    width: 100%;
    height: 200px;
    background: var(--glacier-50);
    border: 2px dashed var(--glacier-300);
    border-radius: 16px;
    
    &:hover {
      border-color: var(--ice-primary);
      background: var(--ice-primary-50);
    }
  }
}

.upload-progress {
  margin-top: 24px;
  text-align: center;
}

.progress-text {
  margin-top: 12px;
  color: var(--glacier-500);
  font-size: 14px;
}

// Voice List Section
.voice-list-section {
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

.voice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.voice-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--glacier-50);
  border: 2px solid transparent;
  border-radius: 16px;
  transition: all 0.2s;
  
  &:hover {
    border-color: var(--ice-primary-200);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  
  &.active {
    border-color: var(--success);
    background: rgba(16, 185, 129, 0.05);
  }
}

.voice-visual {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--aurora-purple) 0%, #8b5cf6 100%);
  border-radius: 14px;
}

.wave-container {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 24px;
}

.wave-bar {
  width: 3px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 2px;
  animation: wave 1.2s ease-in-out infinite;
  
  &:nth-child(1) { height: 8px; }
  &:nth-child(2) { height: 16px; }
  &:nth-child(3) { height: 24px; }
  &:nth-child(4) { height: 16px; }
  &:nth-child(5) { height: 8px; }
}

.voice-info {
  flex: 1;
  min-width: 0;
}

.voice-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 4px;
}

.voice-id {
  font-size: 12px;
  color: var(--glacier-400);
  margin-bottom: 4px;
}

.voice-date {
  font-size: 12px;
  color: var(--glacier-400);
}

.voice-actions {
  flex-shrink: 0;
}

@keyframes wave {
  0%, 100% { transform: scaleY(0.5); }
  50% { transform: scaleY(1); }
}

[data-theme='dark'] {
  .upload-card,
  .voice-list-section {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .voice-uploader :deep(.el-upload-dragger) {
    background: var(--glacier-800);
    border-color: var(--glacier-700);
  }
  
  .voice-card {
    background: var(--glacier-800);
  }
  
  .upload-info h3,
  .section-title,
  .voice-name {
    color: var(--glacier-100);
  }
}
</style>
