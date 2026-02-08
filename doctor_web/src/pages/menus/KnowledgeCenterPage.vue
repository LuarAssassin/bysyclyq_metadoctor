<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadProps, UploadRawFile, UploadUserFile } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { knowledgeApi } from '../../services/api'
import type { KnowledgeIndexItem, KnowledgeItem, KnowledgeTagSummary, PageResult } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/time'
import { toErrorMessage } from '../../utils/http-error'
import PageHeader from '../../components/PageHeader.vue'
import GlassCard from '../../components/GlassCard.vue'

const listLoading = ref(false)
const uploadLoading = ref(false)
const tableData = ref<KnowledgeItem[]>([])
const indexData = ref<KnowledgeIndexItem[]>([])
const tagData = ref<KnowledgeTagSummary[]>([])
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const fileList = ref<UploadUserFile[]>([])
const pollTimer = ref<number>()
const indexKeyword = ref('')

const pendingStatuses = ['pending', 'queued', 'running']

const hasPendingTasks = computed(() => {
  return tableData.value.some((item) => pendingStatuses.includes(item.extract_status))
})

const filteredIndexes = computed(() => {
  const keyword = indexKeyword.value.trim().toLowerCase()
  if (!keyword) {
    return indexData.value
  }

  return indexData.value.filter((item) => {
    const fields = [item.file_name, item.file_id, item.description, item.tags.join(' ')]
    return fields.some((value) => String(value).toLowerCase().includes(keyword))
  })
})

const statusTagType = (status: KnowledgeItem['extract_status']) => {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'warning'
  return 'info'
}

const statusLabel = (status: KnowledgeItem['extract_status']) => {
  if (status === 'success') return '抽取成功'
  if (status === 'failed') return '抽取失败'
  if (status === 'running') return '抽取中'
  if (status === 'queued') return '排队中'
  return '待处理'
}

const uploadChange: UploadProps['onChange'] = (_file, files) => {
  fileList.value = files.slice(-10)
}

const uploadRemove: UploadProps['onRemove'] = (_file, files) => {
  fileList.value = files
}

const collectRawFiles = (): File[] => {
  return fileList.value
    .map((item) => item.raw as UploadRawFile | undefined)
    .filter((item): item is UploadRawFile => Boolean(item))
}

const loadKnowledgeList = async () => {
  listLoading.value = true
  try {
    const result: PageResult<KnowledgeItem> = await knowledgeApi.list({
      page: currentPage.value,
      page_size: pageSize.value,
    })
    tableData.value = result.results
    total.value = result.count
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    listLoading.value = false
  }
}

const loadIndexes = async () => {
  try {
    indexData.value = await knowledgeApi.indexes()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const loadTags = async () => {
  try {
    tagData.value = await knowledgeApi.tags()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const loadAll = async () => {
  await Promise.all([loadKnowledgeList(), loadIndexes(), loadTags()])
}

const submitUpload = async () => {
  const files = collectRawFiles()
  if (!files.length) {
    ElMessage.warning('请先选择文件')
    return
  }

  uploadLoading.value = true
  try {
    const result = await knowledgeApi.upload(files)
    ElMessage.success(result.message)
    fileList.value = []
    currentPage.value = 1
    await loadAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    uploadLoading.value = false
  }
}

const retryExtract = async (row: KnowledgeItem) => {
  try {
    const result = await knowledgeApi.extract(row.id)
    ElMessage.success(result.message)
    await loadKnowledgeList()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const removeKnowledge = async (row: KnowledgeItem) => {
  try {
    await ElMessageBox.confirm(`确认删除文件「${row.file_name}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  try {
    const result = await knowledgeApi.remove(row.id)
    ElMessage.success(result.message)
    await loadAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const handlePageChange = async (page: number) => {
  currentPage.value = page
  await loadKnowledgeList()
}

const stopPolling = () => {
  if (pollTimer.value) {
    window.clearInterval(pollTimer.value)
    pollTimer.value = undefined
  }
}

const startPolling = () => {
  if (pollTimer.value) {
    return
  }
  pollTimer.value = window.setInterval(() => {
    void loadKnowledgeList()
  }, 2500)
}

watch(hasPendingTasks, (value) => {
  if (value) {
    startPolling()
  } else {
    stopPolling()
  }
})

onMounted(() => {
  void loadAll()
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<template>
  <div class="menu-page">
    <PageHeader title="菜单1 · 知识库与索引中心" subtitle="上传中 -> 已入队 -> 抽取中 -> 成功/失败，页面按状态机实时反馈。">
      <el-button type="primary" plain @click="loadAll">手动刷新</el-button>
    </PageHeader>

    <div class="menu-grid two-col">
      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>知识文件上传</h3>
            <el-tag type="info">单次最多 10 个</el-tag>
          </div>
        </template>

        <el-upload
          drag
          multiple
          :auto-upload="false"
          :file-list="fileList"
          :limit="10"
          :on-change="uploadChange"
          :on-remove="uploadRemove"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件到这里，或点击上传</div>
          <template #tip>
            <div class="el-upload__tip">支持 pdf/doc/docx/ppt/xls/图片等，单文件最大 150MB</div>
          </template>
        </el-upload>

        <div class="card-actions">
          <el-button type="primary" :loading="uploadLoading" @click="submitUpload">上传并触发抽取</el-button>
        </div>
      </GlassCard>

      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>标签聚合统计</h3>
            <el-tag type="success">{{ tagData.length }} 标签</el-tag>
          </div>
        </template>

        <div class="tag-cloud">
          <div v-for="tag in tagData" :key="tag.id" class="tag-cloud-item">
            <span>{{ tag.name }}</span>
            <strong>{{ tag.file_count }}</strong>
          </div>
          <el-empty v-if="!tagData.length" description="暂无标签" :image-size="90" />
        </div>
      </GlassCard>
    </div>

    <GlassCard>
      <template #header>
        <div class="card-title-row">
          <h3>知识文件状态列表</h3>
          <el-tag :type="hasPendingTasks ? 'warning' : 'success'">
            {{ hasPendingTasks ? '轮询中（2.5s）' : '状态稳定' }}
          </el-tag>
        </div>
      </template>

      <el-table :data="tableData" v-loading="listLoading" stripe>
        <el-table-column prop="file_name" label="文件名" min-width="200" />
        <el-table-column label="大小" width="120">
          <template #default="scope">
            {{ formatBytes(scope.row.size_bytes) }}
          </template>
        </el-table-column>
        <el-table-column label="抽取状态" width="120">
          <template #default="scope">
            <el-tag :type="statusTagType(scope.row.extract_status)">{{ statusLabel(scope.row.extract_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="knowledge_status" label="知识库状态" width="120" />
        <el-table-column label="标签" min-width="180">
          <template #default="scope">
            <el-space wrap>
              <el-tag v-for="tag in scope.row.tags" :key="tag.id" size="small">{{ tag.name }}</el-tag>
            </el-space>
          </template>
        </el-table-column>
        <el-table-column label="抽取描述" min-width="260">
          <template #default="scope">
            <span class="line-clamp-2">{{ scope.row.knowledge_description || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="失败原因" min-width="220">
          <template #default="scope">
            <span class="line-clamp-2 text-danger">{{ scope.row.extract_error || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="scope">
            {{ formatDateTime(scope.row.updated_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="scope">
            <el-space>
              <el-button size="small" @click="retryExtract(scope.row)">重试抽取</el-button>
              <el-button size="small" type="danger" plain @click="removeKnowledge(scope.row)">删除</el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-pagination">
        <el-pagination
          background
          layout="prev, pager, next, total"
          :total="total"
          :page-size="pageSize"
          :current-page="currentPage"
          @current-change="handlePageChange"
        />
      </div>
    </GlassCard>

    <GlassCard>
      <template #header>
        <div class="card-title-row">
          <h3>知识索引检索（轻量接口）</h3>
          <el-input v-model="indexKeyword" placeholder="搜索文件名/标签/file_id" clearable style="max-width: 280px" />
        </div>
      </template>

      <el-table :data="filteredIndexes" stripe>
        <el-table-column prop="file_name" label="文件名" min-width="220" />
        <el-table-column prop="file_id" label="file_id" min-width="220" />
        <el-table-column label="标签" min-width="180">
          <template #default="scope">
            <el-space wrap>
              <el-tag v-for="tag in scope.row.tags" :key="tag" size="small" type="info">{{ tag }}</el-tag>
            </el-space>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="320" />
      </el-table>
    </GlassCard>
  </div>
</template>
