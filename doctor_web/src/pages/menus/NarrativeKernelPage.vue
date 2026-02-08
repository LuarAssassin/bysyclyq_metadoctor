<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { narrativeApi } from '../../services/api'
import type {
  NarrativeAnnotation,
  NarrativeKernel,
  NarrativeRedlines,
} from '../../types/api'
import { toErrorMessage } from '../../utils/http-error'
import { formatDateTime } from '../../utils/time'
import PageHeader from '../../components/PageHeader.vue'
import GlassCard from '../../components/GlassCard.vue'

const kernelLoading = ref(false)
const annotationLoading = ref(false)
const redlineLoading = ref(false)
const kernel = ref<NarrativeKernel | null>(null)
const annotations = ref<NarrativeAnnotation[]>([])
const redlines = ref<NarrativeRedlines | null>(null)

const payloadEditor = ref('{}')
const patchEditor = ref('{\n  "KERNEL": {}\n}')
const kernelNote = ref('')
const patchNote = ref('')
const addRulesText = ref('')

const annotationForm = reactive({
  source: 'rehearsal',
  question: '',
  answer: '',
  comment: '',
  negativeRulesText: '',
  deltaText: '{}',
})

const safeJsonParse = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

const splitLines = (raw: string): string[] => {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const loadKernel = async () => {
  kernelLoading.value = true
  try {
    const result = await narrativeApi.getKernel()
    kernel.value = result.data
    payloadEditor.value = JSON.stringify(result.data.payload, null, 2)
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    kernelLoading.value = false
  }
}

const loadAnnotations = async () => {
  annotationLoading.value = true
  try {
    annotations.value = await narrativeApi.listAnnotations(20)
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    annotationLoading.value = false
  }
}

const loadRedlines = async () => {
  redlineLoading.value = true
  try {
    redlines.value = await narrativeApi.getRedlines()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    redlineLoading.value = false
  }
}

const loadAll = async () => {
  await Promise.all([loadKernel(), loadAnnotations(), loadRedlines()])
}

const replaceKernel = async () => {
  const parsed = safeJsonParse(payloadEditor.value)
  if (!parsed) {
    ElMessage.warning('payload JSON 格式不正确')
    return
  }

  try {
    const result = await narrativeApi.replaceKernel(parsed, kernelNote.value)
    kernel.value = result.data
    payloadEditor.value = JSON.stringify(result.data.payload, null, 2)
    ElMessage.success(result.message)
    await Promise.all([loadAnnotations(), loadRedlines()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const patchKernel = async () => {
  const parsed = safeJsonParse(patchEditor.value)
  if (!parsed) {
    ElMessage.warning('changes JSON 格式不正确')
    return
  }

  try {
    const result = await narrativeApi.patchKernel(parsed, patchNote.value)
    kernel.value = result.data
    payloadEditor.value = JSON.stringify(result.data.payload, null, 2)
    ElMessage.success(result.message)
    await Promise.all([loadAnnotations(), loadRedlines()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const submitAnnotation = async () => {
  if (!annotationForm.comment.trim()) {
    ElMessage.warning('comment 为必填项')
    return
  }

  const delta = safeJsonParse(annotationForm.deltaText)
  if (!delta) {
    ElMessage.warning('delta JSON 格式不正确')
    return
  }

  const negativeRules = splitLines(annotationForm.negativeRulesText)

  try {
    const result = await narrativeApi.createAnnotation({
      source: annotationForm.source,
      question: annotationForm.question,
      answer: annotationForm.answer,
      comment: annotationForm.comment,
      negative_rules: negativeRules,
      delta,
    })
    ElMessage.success(result.message)
    kernel.value = result.data.kernel
    payloadEditor.value = JSON.stringify(result.data.kernel.payload, null, 2)
    annotationForm.comment = ''
    annotationForm.question = ''
    annotationForm.answer = ''
    annotationForm.negativeRulesText = ''
    annotationForm.deltaText = '{}'
    await Promise.all([loadAnnotations(), loadRedlines()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const addRedlines = async () => {
  const rules = splitLines(addRulesText.value)
  if (!rules.length) {
    ElMessage.warning('请至少输入一条规则')
    return
  }

  try {
    const result = await narrativeApi.addRedlines(rules, '前端手工新增红线规则')
    ElMessage.success(result.message)
    addRulesText.value = ''
    await Promise.all([loadKernel(), loadAnnotations(), loadRedlines()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const removeRule = async (rule: string) => {
  try {
    await ElMessageBox.confirm(`确认删除红线规则：${rule}？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  try {
    const result = await narrativeApi.removeRedlines([rule])
    ElMessage.success(result.message)
    await Promise.all([loadKernel(), loadAnnotations(), loadRedlines()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div class="menu-page">
    <PageHeader
      title="菜单3 · 医生叙事底座中心"
      subtitle="底座学习依赖大模型抽取，不做规则兜底；失败信息会在前端直接暴露。"
    >
      <el-button type="primary" plain @click="loadAll">刷新底座</el-button>
    </PageHeader>

    <div class="menu-grid two-col">
      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>当前底座（PUT 覆盖）</h3>
            <el-tag type="success">revision {{ kernel?.revision || '-' }}</el-tag>
          </div>
        </template>

        <el-form label-position="top" v-loading="kernelLoading">
          <el-form-item label="更新说明 note">
            <el-input v-model="kernelNote" placeholder="可选" />
          </el-form-item>
          <el-form-item label="payload JSON">
            <el-input v-model="payloadEditor" type="textarea" :rows="16" class="mono-text" />
          </el-form-item>
          <el-button type="primary" @click="replaceKernel">整份覆盖保存（PUT）</el-button>
        </el-form>
      </GlassCard>

      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>局部更新（PATCH）</h3>
            <el-tag type="info">deep merge</el-tag>
          </div>
        </template>

        <el-form label-position="top" v-loading="kernelLoading">
          <el-form-item label="更新说明 note">
            <el-input v-model="patchNote" placeholder="可选" />
          </el-form-item>
          <el-form-item label="changes JSON">
            <el-input v-model="patchEditor" type="textarea" :rows="8" class="mono-text" />
          </el-form-item>
          <el-button type="warning" @click="patchKernel">应用局部更新（PATCH）</el-button>
        </el-form>

        <el-divider />

        <h4 class="section-title">编译后的 DSL Prompt</h4>
        <pre class="kernel-prompt">{{ kernel?.compiled_prompt || '-' }}</pre>
      </GlassCard>
    </div>

    <div class="menu-grid two-col">
      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>批注学习写回（POST annotations）</h3>
            <el-tag type="warning">必须走大模型抽取</el-tag>
          </div>
        </template>

        <el-form label-position="top" @submit.prevent="submitAnnotation">
          <el-form-item label="source">
            <el-select v-model="annotationForm.source" style="width: 180px">
              <el-option label="rehearsal" value="rehearsal" />
              <el-option label="manual" value="manual" />
              <el-option label="import" value="import" />
            </el-select>
          </el-form-item>

          <el-form-item label="question">
            <el-input v-model="annotationForm.question" type="textarea" :rows="2" />
          </el-form-item>

          <el-form-item label="answer">
            <el-input v-model="annotationForm.answer" type="textarea" :rows="2" />
          </el-form-item>

          <el-form-item label="comment（必填）">
            <el-input v-model="annotationForm.comment" type="textarea" :rows="3" />
          </el-form-item>

          <el-form-item label="negative_rules（每行一条）">
            <el-input v-model="annotationForm.negativeRulesText" type="textarea" :rows="3" />
          </el-form-item>

          <el-form-item label="delta JSON">
            <el-input v-model="annotationForm.deltaText" type="textarea" :rows="6" class="mono-text" />
          </el-form-item>

          <el-button type="primary" @click="submitAnnotation">提交批注并写回底座</el-button>
        </el-form>
      </GlassCard>

      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>红线规则管理</h3>
            <el-tag type="danger">revision {{ redlines?.revision || '-' }}</el-tag>
          </div>
        </template>

        <el-form label-position="top" v-loading="redlineLoading">
          <el-form-item label="新增规则（每行一条）">
            <el-input v-model="addRulesText" type="textarea" :rows="4" />
          </el-form-item>
          <el-button type="danger" plain @click="addRedlines">新增红线规则</el-button>
        </el-form>

        <el-divider />

        <h4 class="section-title">当前 negative_rules</h4>
        <div class="rule-list">
          <div v-for="rule in redlines?.negative_rules || []" :key="rule" class="rule-item">
            <span>{{ rule }}</span>
            <el-button size="small" type="danger" text @click="removeRule(rule)">删除</el-button>
          </div>
          <el-empty v-if="!(redlines?.negative_rules || []).length" description="暂无规则" :image-size="80" />
        </div>

        <h4 class="section-title">bad_response_examples</h4>
        <pre class="kernel-prompt">{{ JSON.stringify(redlines?.bad_response_examples || [], null, 2) }}</pre>
      </GlassCard>
    </div>

    <GlassCard>
      <template #header>
        <div class="card-title-row">
          <h3>批注历史（最近 20 条）</h3>
          <el-tag type="info">用于版本回看</el-tag>
        </div>
      </template>

      <el-table :data="annotations" v-loading="annotationLoading" stripe>
        <el-table-column prop="source" label="来源" width="110" />
        <el-table-column prop="comment" label="批注" min-width="260" />
        <el-table-column label="revision_after" width="120">
          <template #default="scope">
            {{ scope.row.revision_after }}
          </template>
        </el-table-column>
        <el-table-column label="LLM应用" width="120">
          <template #default="scope">
            <el-tag :type="scope.row.llm_applied ? 'success' : 'info'">{{ scope.row.llm_applied ? '是' : '否' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="scope">
            {{ formatDateTime(scope.row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
    </GlassCard>
  </div>
</template>
