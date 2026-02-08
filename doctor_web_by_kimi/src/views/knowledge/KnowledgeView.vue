<template>
  <div class="knowledge-page">
    <!-- Upload Section -->
    <div class="upload-section" :class="{ 'drag-over': isDragOver }"
      @dragenter.prevent="isDragOver = true"
      @dragleave.prevent="isDragOver = false"
      @dragover.prevent
      @drop.prevent="handleDrop"
    >
      <input
        ref="fileInput"
        type="file"
        multiple
        accept=".txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.epub,.mobi,.jpg,.jpeg,.png,.gif"
        class="hidden"
        @change="handleFileSelect"
      />
      
      <div class="upload-area" @click="fileInput?.click()">
        <div class="upload-icon" :class="{ 'animate-pulse': uploading }">
          <el-icon :size="48" v-if="!uploading"><Upload /></el-icon>
          <el-icon :size="48" v-else class="animate-spin"><Loading /></el-icon>
        </div>
        <h3 class="upload-title">
          {{ uploading ? '正在上传...' : '拖拽文件到此处或点击上传' }}
        </h3>
        <p class="upload-desc">
          支持 PDF、Word、Excel、PPT、图片等格式，单个文件最大 150MB
        </p>
        <el-button type="primary" :loading="uploading">
          选择文件
        </el-button>
      </div>
      
      <!-- Upload Progress -->
      <div v-if="uploadProgress.length > 0" class="upload-progress">
        <div v-for="(item, index) in uploadProgress" :key="index" class="progress-item">
          <div class="progress-info">
            <span class="file-name">{{ item.name }}</span>
            <span class="progress-text">{{ item.status }}</span>
          </div>
          <el-progress :percentage="item.percentage" :status="item.status === 'error' ? 'exception' : undefined" />
        </div>
      </div>
    </div>
    
    <!-- Content Grid -->
    <div class="content-grid">
      <!-- File List -->
      <div class="content-main">
        <div class="section-header">
          <h2 class="section-title">知识文件</h2>
          <div class="section-actions">
            <el-input
              v-model="searchQuery"
              placeholder="搜索文件..."
              clearable
              class="search-input"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-button @click="refreshList" :loading="loading">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </div>
        </div>
        
        <div class="file-list">
          <div v-for="file in filteredFiles" :key="file.id" class="file-card">
            <div class="file-icon" :class="getFileTypeClass(file.file_type)">
              <el-icon :size="24">
                <component :is="getFileIcon(file.file_type)" />
              </el-icon>
            </div>
            <div class="file-info">
              <h4 class="file-name" :title="file.file_name">{{ file.file_name }}</h4>
              <div class="file-meta">
                <span class="file-size">{{ formatFileSize(file.file_size) }}</span>
                <span class="file-date">{{ formatDate(file.created_at) }}</span>
              </div>
              <div class="file-tags" v-if="file.tags?.length">
                <el-tag v-for="tag in file.tags.slice(0, 3)" :key="tag" size="small" effect="light">
                  {{ tag }}
                </el-tag>
              </div>
            </div>
            <div class="file-status">
              <div class="status-badge" :class="file.extract_status">
                <span class="status-dot"></span>
                {{ getStatusText(file.extract_status) }}
              </div>
              <div v-if="file.extract_error" class="error-tooltip" :title="file.extract_error">
                <el-icon><Warning /></el-icon>
              </div>
            </div>
            <div class="file-actions">
              <el-button
                v-if="file.extract_status === 'failed'"
                type="warning"
                link
                @click="reExtract(file.id)"
              >
                重试
              </el-button>
              <el-button type="danger" link @click="deleteFile(file.id)">
                删除
              </el-button>
            </div>
          </div>
          
          <el-empty v-if="filteredFiles.length === 0" description="暂无知识文件" />
        </div>
        
        <el-pagination
          v-if="total > pageSize"
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          class="pagination"
        />
      </div>
      
      <!-- Sidebar -->
      <div class="content-sidebar">
        <!-- Tags Cloud -->
        <div class="sidebar-section">
          <h3 class="sidebar-title">
            <el-icon><CollectionTag /></el-icon>
            标签云
          </h3>
          <div class="tag-cloud">
            <el-tag
              v-for="tag in tags"
              :key="tag.id"
              :type="selectedTag === tag.name ? 'primary' : 'info'"
              effect="light"
              class="tag-item"
              @click="selectedTag = selectedTag === tag.name ? '' : tag.name"
            >
              {{ tag.name }}
              <span class="tag-count">({{ tag.file_count }})</span>
            </el-tag>
          </div>
        </div>
        
        <!-- Knowledge Index -->
        <div class="sidebar-section">
          <h3 class="sidebar-title">
            <el-icon><Files /></el-icon>
            知识索引
          </h3>
          <div class="index-list">
            <div v-for="item in indexes" :key="item.file_id" class="index-item">
              <p class="index-name">{{ item.file_name }}</p>
              <p class="index-desc">{{ item.description || '暂无描述' }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Upload, Loading, Search, Refresh, Document,
  DocumentCopy, Picture, Files, CollectionTag, Warning,
  Memo, DataLine
} from '@element-plus/icons-vue'
import type { Component } from 'vue'
import {
  uploadKnowledge,
  getKnowledgeList,
  getKnowledgeTags,
  getKnowledgeIndexes,
  reExtractKnowledge,
  deleteKnowledge,
} from '@/api/knowledge'
import type { KnowledgeFile, TagStat, KnowledgeIndex } from '@/types'

const fileInput = ref<HTMLInputElement>()
const isDragOver = ref(false)
const uploading = ref(false)
const loading = ref(false)
const files = ref<KnowledgeFile[]>([])
const tags = ref<TagStat[]>([])
const indexes = ref<KnowledgeIndex[]>([])
const searchQuery = ref('')
const selectedTag = ref('')
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const uploadProgress = ref<{ name: string; percentage: number; status: string }[]>([])
let pollInterval: NodeJS.Timeout | null = null

const filteredFiles = computed(() => {
  let result = files.value
  
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(f => f.file_name.toLowerCase().includes(query))
  }
  
  if (selectedTag.value) {
    result = result.filter(f => f.tags?.includes(selectedTag.value))
  }
  
  return result
})

const fetchFiles = async () => {
  loading.value = true
  try {
    const res = await getKnowledgeList({ page: currentPage.value, page_size: pageSize.value })
    files.value = res.results
    total.value = res.count
  } finally {
    loading.value = false
  }
}

const fetchTags = async () => {
  try {
    tags.value = await getKnowledgeTags()
  } catch {}
}

const fetchIndexes = async () => {
  try {
    indexes.value = await getKnowledgeIndexes()
  } catch {}
}

const refreshList = () => {
  fetchFiles()
  fetchTags()
  fetchIndexes()
}

const handleFileSelect = async (e: Event) => {
  const target = e.target as HTMLInputElement
  if (target.files?.length) {
    await uploadFiles(Array.from(target.files))
    target.value = ''
  }
}

const handleDrop = async (e: DragEvent) => {
  isDragOver.value = false
  const droppedFiles = e.dataTransfer?.files
  if (droppedFiles?.length) {
    await uploadFiles(Array.from(droppedFiles))
  }
}

const uploadFiles = async (uploadFiles: File[]) => {
  uploading.value = true
  uploadProgress.value = uploadFiles.map(f => ({
    name: f.name,
    percentage: 0,
    status: '上传中'
  }))
  
  try {
    await uploadKnowledge(uploadFiles)
    ElMessage.success(`成功上传 ${uploadFiles.length} 个文件`)
    uploadProgress.value = []
    refreshList()
    startPolling()
  } catch (error: any) {
    uploadProgress.value.forEach(p => p.status = 'error')
    ElMessage.error(error.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

const startPolling = () => {
  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(() => {
    const hasPending = files.value.some(f => 
      ['pending', 'queued', 'running'].includes(f.extract_status)
    )
    if (hasPending) {
      fetchFiles()
    } else {
      if (pollInterval) clearInterval(pollInterval)
    }
  }, 3000)
}

const reExtract = async (id: number) => {
  try {
    await reExtractKnowledge(id)
    ElMessage.success('已重新加入抽取队列')
    fetchFiles()
    startPolling()
  } catch {
    ElMessage.error('重试失败')
  }
}

const deleteFile = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除这个文件吗？', '提示', { type: 'warning' })
    await deleteKnowledge(id)
    ElMessage.success('删除成功')
    fetchFiles()
  } catch {}
}

const getFileIcon = (type: string): Component => {
  const map: Record<string, Component> = {
    'pdf': DocumentCopy,
    'doc': Document,
    'docx': Document,
    'xls': DataLine,
    'xlsx': DataLine,
    'ppt': Memo,
    'pptx': Memo,
    'jpg': Picture,
    'jpeg': Picture,
    'png': Picture,
    'gif': Picture,
  }
  return map[type.toLowerCase()] || Document
}

const getFileTypeClass = (type: string) => {
  const map: Record<string, string> = {
    'pdf': 'pdf',
    'doc': 'doc',
    'docx': 'doc',
    'xls': 'sheet',
    'xlsx': 'sheet',
    'jpg': 'image',
    'jpeg': 'image',
    'png': 'image',
  }
  return map[type.toLowerCase()] || 'default'
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    'pending': '待处理',
    'queued': '排队中',
    'running': '抽取中',
    'success': '已完成',
    'failed': '失败',
  }
  return map[status] || status
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('zh-CN')
}

onMounted(() => {
  refreshList()
  startPolling()
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})
</script>

<style scoped lang="scss">
.knowledge-page {
  max-width: 1400px;
}

// Upload Section
.upload-section {
  background: linear-gradient(135deg, var(--ice-primary-50) 0%, var(--snow-white) 100%);
  border: 2px dashed var(--ice-primary-200);
  border-radius: 20px;
  padding: 40px;
  margin-bottom: 24px;
  transition: all 0.3s;
  
  &.drag-over {
    border-color: var(--ice-primary);
    background: var(--ice-primary-50);
    transform: scale(1.01);
  }
}

.upload-area {
  text-align: center;
  cursor: pointer;
}

.upload-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 20px;
  color: var(--ice-primary);
  box-shadow: var(--shadow-md);
}

.upload-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 8px;
}

.upload-desc {
  color: var(--glacier-500);
  font-size: 14px;
  margin-bottom: 20px;
}

.upload-progress {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--glacier-200);
}

.progress-item {
  margin-bottom: 12px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 13px;
}

// Content Grid
.content-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 24px;
}

.content-main {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 16px;
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

.search-input {
  width: 240px;
}

// File List
.file-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--glacier-50);
  border-radius: 12px;
  transition: all 0.2s;
  
  &:hover {
    background: var(--ice-primary-50);
    transform: translateX(4px);
  }
}

.file-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  flex-shrink: 0;
  
  &.pdf {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
  
  &.doc {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }
  
  &.sheet {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }
  
  &.image {
    background: rgba(139, 92, 246, 0.1);
    color: #8b5cf6;
  }
  
  &.default {
    background: var(--glacier-200);
    color: var(--glacier-500);
  }
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--glacier-800);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--glacier-400);
  margin-bottom: 6px;
}

.file-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.file-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  
  &.pending, &.queued {
    background: var(--glacier-100);
    color: var(--glacier-500);
    
    .status-dot {
      background: var(--glacier-400);
      animation: pulse 2s infinite;
    }
  }
  
  &.running {
    background: var(--ice-primary-100);
    color: var(--ice-primary);
    
    .status-dot {
      background: var(--ice-primary);
      animation: pulse 1s infinite;
    }
  }
  
  &.success {
    background: rgba(16, 185, 129, 0.1);
    color: var(--success);
    
    .status-dot {
      background: var(--success);
    }
  }
  
  &.failed {
    background: rgba(239, 68, 68, 0.1);
    color: var(--error);
    
    .status-dot {
      background: var(--error);
    }
  }
}

.error-tooltip {
  color: var(--error);
  cursor: help;
}

.file-actions {
  display: flex;
  gap: 8px;
}

.pagination {
  margin-top: 20px;
  justify-content: flex-end;
}

// Sidebar
.content-sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sidebar-section {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 16px;
  padding: 20px;
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 16px;
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-item {
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    transform: scale(1.05);
  }
  
  .tag-count {
    opacity: 0.7;
    margin-left: 2px;
  }
}

.index-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.index-item {
  padding: 12px;
  background: var(--glacier-50);
  border-radius: 10px;
}

.index-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--glacier-700);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.index-desc {
  font-size: 12px;
  color: var(--glacier-400);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 1024px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
  
  .content-sidebar {
    order: -1;
  }
}

[data-theme='dark'] {
  .upload-section {
    background: linear-gradient(135deg, rgba(14, 165, 233, 0.1) 0%, var(--glacier-900) 100%);
  }
  
  .content-main,
  .sidebar-section {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .file-card,
  .index-item {
    background: var(--glacier-800);
  }
  
  .section-title,
  .file-name,
  .sidebar-title,
  .upload-title {
    color: var(--glacier-100);
  }
}
</style>
