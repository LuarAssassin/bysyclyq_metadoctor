<template>
  <div class="redlines-page">
    <!-- Header -->
    <div class="page-header">
      <div class="header-info">
        <h1 class="page-title">红线规则</h1>
        <p class="page-desc">定义 AI 绝对不能触碰的底线和禁区</p>
      </div>
      <el-button type="primary" @click="showAddDialog = true">
        <el-icon><Plus /></el-icon>
        添加规则
      </el-button>
    </div>
    
    <!-- Rules List -->
    <div class="rules-container">
      <div class="rule-category">
        <div class="category-header">
          <div class="category-icon">
            <el-icon><WarningFilled /></el-icon>
          </div>
          <h3>禁止性规则</h3>
          <span class="category-count">{{ rules.length }} 条</span>
        </div>
        
        <div class="rules-list">
          <div v-for="(rule, index) in rules" :key="index" class="rule-card">
            <div class="rule-number">{{ index + 1 }}</div>
            <div class="rule-content">
              <p class="rule-text">{{ rule }}</p>
            </div>
            <div class="rule-actions">
              <el-button type="danger" link @click="deleteRule(index)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
          
          <el-empty v-if="rules.length === 0" description="暂无红线规则" />
        </div>
      </div>
      
      <div class="rule-category">
        <div class="category-header">
          <div class="category-icon bad-example">
            <el-icon><CircleCloseFilled /></el-icon>
          </div>
          <h3>不好回答示例</h3>
          <span class="category-count">{{ badExamples.length }} 条</span>
        </div>
        
        <div class="examples-list">
          <div v-for="(example, index) in badExamples" :key="index" class="example-card">
            <div class="example-header">
              <span class="example-label">问题</span>
            </div>
            <p class="example-question">{{ example.question }}</p>
            <div class="example-header">
              <span class="example-label bad">不当回答</span>
            </div>
            <p class="example-answer bad">{{ example.bad_answer }}</p>
            <p class="example-reason">{{ example.reason }}</p>
          </div>
          
          <el-empty v-if="badExamples.length === 0" description="暂无示例" />
        </div>
      </div>
    </div>
    
    <!-- Add Rule Dialog -->
    <el-dialog
      v-model="showAddDialog"
      title="添加红线规则"
      width="500px"
    >
      <el-form>
        <el-form-item label="规则内容">
          <el-input
            v-model="newRule"
            type="textarea"
            :rows="3"
            placeholder="描述一条 AI 必须遵守的禁止性规则..."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" :loading="adding" @click="addRule">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete, WarningFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { getRedlineRules, addRedlineRules, deleteRedlineRules } from '@/api/narrative'
import type { BadResponseExample } from '@/types'

const rules = ref<string[]>([])
const badExamples = ref<BadResponseExample[]>([])
const loading = ref(false)
const showAddDialog = ref(false)
const newRule = ref('')
const adding = ref(false)

const fetchRules = async () => {
  loading.value = true
  try {
    const res = await getRedlineRules()
    rules.value = res.negative_rules || []
    badExamples.value = res.bad_response_examples || []
  } finally {
    loading.value = false
  }
}

const addRule = async () => {
  if (!newRule.value.trim()) {
    ElMessage.warning('请输入规则内容')
    return
  }
  
  adding.value = true
  try {
    await addRedlineRules({
      rules: [newRule.value.trim()],
      comment: '前端手动添加',
    })
    ElMessage.success('规则已添加')
    newRule.value = ''
    showAddDialog.value = false
    fetchRules()
  } catch {
    ElMessage.error('添加失败')
  } finally {
    adding.value = false
  }
}

const deleteRule = async (index: number) => {
  try {
    await ElMessageBox.confirm('确定要删除这条规则吗？', '提示', { type: 'warning' })
    const ruleToDelete = rules.value[index]
    await deleteRedlineRules({ rules: [ruleToDelete] })
    ElMessage.success('已删除')
    fetchRules()
  } catch {}
}

onMounted(() => {
  fetchRules()
})
</script>

<style scoped lang="scss">
.redlines-page {
  max-width: 1000px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
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

// Rules Container
.rules-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.rule-category {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 20px;
  overflow: hidden;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
  background: var(--glacier-50);
  border-bottom: 1px solid var(--glacier-200);
  
  h3 {
    flex: 1;
    font-size: 16px;
    font-weight: 600;
    color: var(--glacier-800);
  }
}

.category-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
  border-radius: 10px;
  color: white;
  
  &.bad-example {
    background: linear-gradient(135deg, #ef4444 0%, #f87171 100%);
  }
  
  :deep(.el-icon) {
    font-size: 20px;
  }
}

.category-count {
  font-size: 13px;
  color: var(--glacier-500);
  background: white;
  padding: 4px 10px;
  border-radius: 20px;
}

// Rules List
.rules-list {
  padding: 16px;
}

.rule-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: var(--glacier-50);
  border-radius: 12px;
  margin-bottom: 12px;
  transition: all 0.2s;
  
  &:hover {
    background: var(--ice-primary-50);
    transform: translateX(4px);
  }
}

.rule-number {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
  color: white;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.rule-content {
  flex: 1;
}

.rule-text {
  font-size: 14px;
  color: var(--glacier-700);
  line-height: 1.6;
}

.rule-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.rule-card:hover .rule-actions {
  opacity: 1;
}

// Examples List
.examples-list {
  padding: 16px;
}

.example-card {
  padding: 16px;
  background: var(--glacier-50);
  border-radius: 12px;
  margin-bottom: 12px;
  border-left: 3px solid #ef4444;
}

.example-header {
  margin-bottom: 8px;
}

.example-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--glacier-500);
  
  &.bad {
    color: #ef4444;
  }
}

.example-question {
  font-size: 14px;
  color: var(--glacier-800);
  margin-bottom: 12px;
  padding: 10px;
  background: white;
  border-radius: 8px;
}

.example-answer {
  font-size: 13px;
  color: var(--glacier-600);
  margin-bottom: 8px;
  padding: 10px;
  background: rgba(239, 68, 68, 0.05);
  border-radius: 8px;
  
  &.bad {
    color: #ef4444;
  }
}

.example-reason {
  font-size: 12px;
  color: var(--glacier-400);
  font-style: italic;
}

@media (max-width: 1024px) {
  .rules-container {
    grid-template-columns: 1fr;
  }
}

[data-theme='dark'] {
  .page-title {
    color: var(--glacier-100);
  }
  
  .rule-category {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .category-header,
  .rule-card,
  .example-card {
    background: var(--glacier-800);
  }
  
  .example-question {
    background: var(--glacier-900);
  }
}
</style>
