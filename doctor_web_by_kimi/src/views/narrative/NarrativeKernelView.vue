<template>
  <div class="kernel-page">
    <!-- Header -->
    <div class="page-header">
      <div class="header-info">
        <h1 class="page-title">人格底座</h1>
        <p class="page-desc">定义您的诊疗风格、表达方式和核心特征</p>
      </div>
      <div class="header-actions">
        <el-tag type="info" effect="plain">版本 v{{ kernel?.revision || 1 }}</el-tag>
        <el-button type="primary" :loading="saving" @click="saveKernel">
          <el-icon><Check /></el-icon>
          保存更改
        </el-button>
      </div>
    </div>
    
    <!-- Content -->
    <div class="kernel-content">
      <!-- Identity Section -->
      <div class="kernel-section">
        <div class="section-header">
          <div class="section-icon">
            <el-icon><User /></el-icon>
          </div>
          <div class="section-info">
            <h3>身份特征</h3>
            <p>您的基础身份信息和专业定位</p>
          </div>
        </div>
        <div class="section-body">
          <el-form label-position="top">
            <el-row :gutter="20">
              <el-col :span="12">
                <el-form-item label="医生姓名">
                  <el-input v-model="form.identity.name" placeholder="您的姓名" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="专业领域">
                  <el-input v-model="form.identity.profession" placeholder="如：运动康复科" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="20">
              <el-col :span="12">
                <el-form-item label="从医年限">
                  <el-input v-model="form.identity.experience" placeholder="如：15年" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="执业机构">
                  <el-input v-model="form.identity.institution" placeholder="如：北医三院崇礼院区" />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>
        </div>
      </div>
      
      <!-- Clinical Style Section -->
      <div class="kernel-section">
        <div class="section-header">
          <div class="section-icon style">
            <el-icon><MagicStick /></el-icon>
          </div>
          <div class="section-info">
            <h3>诊疗风格</h3>
            <p>定义您的问诊方式和沟通特点</p>
          </div>
        </div>
        <div class="section-body">
          <el-form label-position="top">
            <el-row :gutter="20">
              <el-col :span="12">
                <el-form-item label="沟通方式">
                  <el-select v-model="form.clinicalStyle.communication" class="w-full">
                    <el-option label="亲切温和" value="warm_friendly" />
                    <el-option label="专业严谨" value="professional_precise" />
                    <el-option label="幽默风趣" value="humorous_relaxed" />
                    <el-option label="耐心细致" value="patient_detailed" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="解释深度">
                  <el-select v-model="form.clinicalStyle.explanationDepth" class="w-full">
                    <el-option label="简明扼要" value="brief" />
                    <el-option label="适中平衡" value="balanced" />
                    <el-option label="详细深入" value="detailed" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="20">
              <el-col :span="12">
                <el-form-item label="共情程度">
                  <el-slider v-model="form.clinicalStyle.empathy" :max="10" show-stops />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="治疗倾向">
                  <el-select v-model="form.clinicalStyle.treatmentPreference" class="w-full">
                    <el-option label="保守治疗优先" value="conservative" />
                    <el-option label="平衡考量" value="balanced" />
                    <el-option label="积极干预" value="aggressive" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="口头禅/常用语">
              <el-input
                v-model="form.clinicalStyle.catchphrases"
                type="textarea"
                :rows="2"
                placeholder="您常说的一些特色语句，如：‘别担心，我们一起解决’"
              />
            </el-form-item>
          </el-form>
        </div>
      </div>
      
      <!-- Safety Rules Section -->
      <div class="kernel-section">
        <div class="section-header">
          <div class="section-icon safety">
            <el-icon><Warning /></el-icon>
          </div>
          <div class="section-info">
            <h3>安全边界</h3>
            <p>定义 AI 在回答时必须遵守的规则和限制</p>
          </div>
        </div>
        <div class="section-body">
          <div class="rules-list">
            <div v-for="(_rule, index) in form.safetyRules" :key="index" class="rule-item">
              <span class="rule-number">{{ index + 1 }}</span>
              <el-input v-model="form.safetyRules[index]" placeholder="输入规则内容...">
                <template #suffix>
                  <el-button type="danger" link @click="removeRule(index)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
              </el-input>
            </div>
          </div>
          <el-button type="primary" link @click="addRule">
            <el-icon><Plus /></el-icon>
            添加规则
          </el-button>
        </div>
      </div>
      
      <!-- Compiled Preview -->
      <div class="kernel-section preview">
        <div class="section-header">
          <div class="section-icon preview">
            <el-icon><View /></el-icon>
          </div>
          <div class="section-info">
            <h3>编译预览</h3>
            <p>实际注入 AI 的完整人格底座</p>
          </div>
        </div>
        <div class="section-body">
          <pre class="preview-code">{{ compiledPreview }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  User, MagicStick, Warning, Check,
  Delete, Plus, View
} from '@element-plus/icons-vue'
import { getNarrativeKernel, updateNarrativeKernel } from '@/api/narrative'
import type { NarrativeKernel } from '@/types'

const kernel = ref<NarrativeKernel | null>(null)
const loading = ref(false)
const saving = ref(false)

const form = reactive({
  identity: {
    name: '',
    profession: '',
    experience: '',
    institution: '',
  },
  clinicalStyle: {
    communication: 'warm_friendly',
    explanationDepth: 'balanced',
    empathy: 7,
    treatmentPreference: 'balanced',
    catchphrases: '',
  },
  safetyRules: [
    '不提供未经专业验证的医疗建议',
    '遇到紧急情况建议患者立即就医',
    '不透露其他患者的隐私信息',
  ],
})

const compiledPreview = computed(() => {
  const payload = {
    KERNEL: {
      IDENTITY: form.identity,
      CLINICAL_STYLE: {
        COMMUNICATION_STYLE: form.clinicalStyle.communication,
        EXPLANATION_DEPTH: form.clinicalStyle.explanationDepth,
        EMPATHY_INTENSITY: `${form.clinicalStyle.empathy}/10`,
        TREATMENT_PREFERENCE: form.clinicalStyle.treatmentPreference,
        CATCHPHRASES: form.clinicalStyle.catchphrases,
      },
      SAFETY_RULES: {
        NEGATIVE_RULES: form.safetyRules,
      },
    },
  }
  return JSON.stringify(payload, null, 2)
})

const fetchKernel = async () => {
  loading.value = true
  try {
    kernel.value = await getNarrativeKernel()
    // Parse payload into form
    const payload = kernel.value.payload
    if (payload.KERNEL?.IDENTITY) {
      Object.assign(form.identity, payload.KERNEL.IDENTITY)
    }
    if (payload.KERNEL?.CLINICAL_STYLE) {
      const style = payload.KERNEL.CLINICAL_STYLE
      form.clinicalStyle.communication = style.COMMUNICATION_STYLE || 'warm_friendly'
      form.clinicalStyle.explanationDepth = style.EXPLANATION_DEPTH || 'balanced'
      form.clinicalStyle.empathy = parseInt(style.EMPATHY_INTENSITY) || 7
      form.clinicalStyle.treatmentPreference = style.TREATMENT_PREFERENCE || 'balanced'
      form.clinicalStyle.catchphrases = style.CATCHPHRASES || ''
    }
    if (payload.KERNEL?.SAFETY_RULES?.NEGATIVE_RULES) {
      form.safetyRules = [...payload.KERNEL.SAFETY_RULES.NEGATIVE_RULES]
    }
  } finally {
    loading.value = false
  }
}

const saveKernel = async () => {
  saving.value = true
  try {
    const payload = {
      payload: {
        KERNEL: {
          IDENTITY: form.identity,
          CLINICAL_STYLE: {
            COMMUNICATION_STYLE: form.clinicalStyle.communication,
            EXPLANATION_DEPTH: form.clinicalStyle.explanationDepth,
            EMPATHY_INTENSITY: `${form.clinicalStyle.empathy}/10`,
            TREATMENT_PREFERENCE: form.clinicalStyle.treatmentPreference,
            CATCHPHRASES: form.clinicalStyle.catchphrases,
          },
          SAFETY_RULES: {
            NEGATIVE_RULES: form.safetyRules.filter(r => r.trim()),
          },
        },
      },
      note: '前端手动更新底座',
    }
    await updateNarrativeKernel(payload)
    ElMessage.success('底座已更新')
    fetchKernel()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

const addRule = () => {
  form.safetyRules.push('')
}

const removeRule = (index: number) => {
  form.safetyRules.splice(index, 1)
}

onMounted(() => {
  fetchKernel()
})
</script>

<style scoped lang="scss">
.kernel-page {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

// Kernel Sections
.kernel-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.kernel-section {
  background: var(--snow-white);
  border: 1px solid var(--glacier-200);
  border-radius: 20px;
  overflow: hidden;
  
  &.preview {
    background: var(--glacier-900);
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--glacier-50);
  border-bottom: 1px solid var(--glacier-200);
}

.section-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  
  &:not(.style):not(.safety):not(.preview) {
    background: linear-gradient(135deg, var(--ice-primary) 0%, var(--aurora-cyan) 100%);
    color: white;
  }
  
  &.style {
    background: linear-gradient(135deg, var(--aurora-purple) 0%, #8b5cf6 100%);
    color: white;
  }
  
  &.safety {
    background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
    color: white;
  }
  
  &.preview {
    background: linear-gradient(135deg, var(--glacier-600) 0%, var(--glacier-400) 100%);
    color: white;
  }
  
  :deep(.el-icon) {
    font-size: 24px;
  }
}

.section-info {
  h3 {
    font-size: 16px;
    font-weight: 600;
    color: var(--glacier-800);
    margin-bottom: 2px;
  }
  
  p {
    font-size: 13px;
    color: var(--glacier-500);
  }
}

.section-body {
  padding: 24px;
}

// Rules
.rules-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.rule-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rule-number {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ice-primary-100);
  color: var(--ice-primary);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

// Preview
.preview-code {
  background: var(--glacier-950);
  color: var(--aurora-cyan);
  padding: 20px;
  border-radius: 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.w-full {
  width: 100%;
}

[data-theme='dark'] {
  .page-title,
  .section-info h3 {
    color: var(--glacier-100);
  }
  
  .kernel-section:not(.preview) {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .section-header {
    background: var(--glacier-800);
    border-color: var(--glacier-700);
  }
  
  .preview-code {
    background: #000;
  }
}
</style>
