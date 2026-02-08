<template>
  <div class="annotations-page">
    <!-- Header -->
    <div class="page-header">
      <div class="header-info">
        <h1 class="page-title">批注历史</h1>
        <p class="page-desc">您在演练中提交的反馈和学习记录</p>
      </div>
    </div>
    
    <!-- Annotations List -->
    <div class="annotations-list">
      <div v-for="annotation in annotations" :key="annotation.id" class="annotation-card">
        <div class="annotation-header">
          <div class="annotation-meta">
            <el-tag size="small" effect="light">{{ annotation.source }}</el-tag>
            <span class="annotation-date">{{ formatDate(annotation.created_at) }}</span>
          </div>
        </div>
        
        <div class="annotation-body">
          <div class="qa-pair">
            <div class="qa-item">
              <span class="qa-label">Q:</span>
              <p class="qa-text">{{ annotation.question }}</p>
            </div>
            <div class="qa-item">
              <span class="qa-label">A:</span>
              <p class="qa-text">{{ annotation.answer }}</p>
            </div>
          </div>
          
          <div class="comment-section">
            <div class="comment-header">
              <el-icon><EditPen /></el-icon>
              <span>医生批注</span>
            </div>
            <p class="comment-text">{{ annotation.comment }}</p>
          </div>
          
          <div v-if="annotation.negative_rules?.length" class="rules-section">
            <div class="rules-header">
              <el-icon><Warning /></el-icon>
              <span>提取的红线规则</span>
            </div>
            <div class="rules-tags">
              <el-tag
                v-for="rule in annotation.negative_rules"
                :key="rule"
                type="warning"
                effect="light"
                size="small"
              >
                {{ rule }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
      
      <el-empty v-if="annotations.length === 0" description="暂无批注记录" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { EditPen, Warning } from '@element-plus/icons-vue'
import { getAnnotations } from '@/api/narrative'
import type { Annotation } from '@/types'

const annotations = ref<Annotation[]>([])
const loading = ref(false)

const fetchAnnotations = async () => {
  loading.value = true
  try {
    annotations.value = await getAnnotations({ limit: 50 })
  } finally {
    loading.value = false
  }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}

onMounted(() => {
  fetchAnnotations()
})
</script>

<style scoped lang="scss">
.annotations-page {
  max-width: 900px;
}

.page-header {
  margin-bottom: 24px;
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

// Annotations List
.annotations-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.annotation-card {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 16px;
  overflow: hidden;
}

.annotation-header {
  padding: 16px 20px;
  background: var(--glacier-50);
  border-bottom: 1px solid var(--glacier-200);
}

.annotation-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.annotation-date {
  font-size: 13px;
  color: var(--glacier-400);
}

.annotation-body {
  padding: 20px;
}

.qa-pair {
  margin-bottom: 20px;
}

.qa-item {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.qa-label {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ice-primary-100);
  color: var(--ice-primary);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.qa-text {
  flex: 1;
  font-size: 14px;
  color: var(--glacier-700);
  line-height: 1.6;
  padding: 10px 14px;
  background: var(--glacier-50);
  border-radius: 8px;
}

.comment-section {
  padding: 16px;
  background: linear-gradient(135deg, var(--aurora-purple) 0%, #8b5cf6 100%);
  border-radius: 12px;
  color: white;
  margin-bottom: 16px;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
  opacity: 0.9;
}

.comment-text {
  font-size: 14px;
  line-height: 1.6;
}

.rules-section {
  padding: 16px;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 12px;
}

.rules-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #f59e0b;
  margin-bottom: 12px;
}

.rules-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

[data-theme='dark'] {
  .page-title {
    color: var(--glacier-100);
  }
  
  .annotation-card {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .annotation-header,
  .qa-text {
    background: var(--glacier-800);
  }
}
</style>
