<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { UploadProps, UploadRawFile, UploadUserFile } from 'element-plus'
import { ElMessage } from 'element-plus'
import { digitalHumanApi } from '../../services/api'
import type { AvatarVideo, VoiceProfile } from '../../types/api'
import { toErrorMessage } from '../../utils/http-error'
import { formatDateTime } from '../../utils/time'
import PageHeader from '../../components/PageHeader.vue'
import GlassCard from '../../components/GlassCard.vue'

const loadingVoice = ref(false)
const loadingVideo = ref(false)
const creatingVoice = ref(false)
const creatingVideo = ref(false)
const voiceProfiles = ref<VoiceProfile[]>([])
const videos = ref<AvatarVideo[]>([])
const voiceFiles = ref<UploadUserFile[]>([])
const imageFiles = ref<UploadUserFile[]>([])
const videoPollTimer = ref<number>()

const voiceForm = reactive({
  name: '',
  preferred_name: '',
  target_model: 'qwen3-tts-vc-realtime-2026-01-15',
  set_active: true,
})

const videoForm = reactive({
  prompt: '',
  negative_prompt: '',
  duration: 5,
  resolution: '720P',
  model: 'wan2.6-i2v-flash',
  generate_count: 5,
  prompt_extend: true,
  watermark: true,
  seed: undefined as number | undefined,
})

const runningVideoStatuses = ['submitted', 'running']

const hasRunningVideos = computed(() => {
  return videos.value.some((item) => runningVideoStatuses.includes(item.task_status))
})

const statusType = (status: AvatarVideo['task_status']) => {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'warning'
  return 'info'
}

const statusLabel = (status: AvatarVideo['task_status']) => {
  if (status === 'submitted') return '已提交'
  if (status === 'running') return '生成中'
  if (status === 'succeeded') return '已完成'
  if (status === 'failed') return '失败'
  return status
}

const voiceUploadChange: UploadProps['onChange'] = (_file, files) => {
  voiceFiles.value = files.slice(-1)
}

const imageUploadChange: UploadProps['onChange'] = (_file, files) => {
  imageFiles.value = files.slice(-1)
}

const getVoiceRawFile = (): UploadRawFile | null => {
  return (voiceFiles.value[0]?.raw as UploadRawFile | undefined) || null
}

const getImageRawFile = (): UploadRawFile | null => {
  return (imageFiles.value[0]?.raw as UploadRawFile | undefined) || null
}

const loadVoiceProfiles = async () => {
  loadingVoice.value = true
  try {
    voiceProfiles.value = await digitalHumanApi.listVoice()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    loadingVoice.value = false
  }
}

const loadVideos = async () => {
  loadingVideo.value = true
  try {
    videos.value = await digitalHumanApi.listVideos()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    loadingVideo.value = false
  }
}

const refreshAll = async () => {
  await Promise.all([loadVoiceProfiles(), loadVideos()])
}

const submitVoice = async () => {
  const raw = getVoiceRawFile()
  if (!raw) {
    ElMessage.warning('请先上传音频样本')
    return
  }

  creatingVoice.value = true
  try {
    const result = await digitalHumanApi.createVoice({
      audio: raw,
      ...voiceForm,
    })
    ElMessage.success(result.message)
    voiceFiles.value = []
    await loadVoiceProfiles()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    creatingVoice.value = false
  }
}

const submitVideo = async () => {
  const raw = getImageRawFile()
  if (!raw) {
    ElMessage.warning('请先上传医生正面图片')
    return
  }

  creatingVideo.value = true
  try {
    const result = await digitalHumanApi.createVideos({
      image: raw,
      prompt: videoForm.prompt,
      negative_prompt: videoForm.negative_prompt,
      duration: videoForm.duration,
      resolution: videoForm.resolution,
      model: videoForm.model,
      generate_count: videoForm.generate_count,
      prompt_extend: videoForm.prompt_extend,
      watermark: videoForm.watermark,
      seed: videoForm.seed,
    })
    ElMessage.success(result.message)
    if (result.data.failed_count > 0) {
      ElMessage.warning(`有 ${result.data.failed_count} 条任务提交失败，请检查失败列表`) 
    }
    await loadVideos()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    creatingVideo.value = false
  }
}

const refreshVideo = async (videoId: number) => {
  try {
    const result = await digitalHumanApi.refreshVideo(videoId)
    ElMessage.success(result.message)
    await loadVideos()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const onVideoPlayError = async () => {
  ElMessage.warning('视频链接可能已过期，正在刷新播放地址')
  await loadVideos()
}

const stopVideoPolling = () => {
  if (videoPollTimer.value) {
    window.clearInterval(videoPollTimer.value)
    videoPollTimer.value = undefined
  }
}

const startVideoPolling = () => {
  if (videoPollTimer.value) {
    return
  }
  videoPollTimer.value = window.setInterval(() => {
    void loadVideos()
  }, 4000)
}

watch(hasRunningVideos, (value) => {
  if (value) {
    startVideoPolling()
  } else {
    stopVideoPolling()
  }
})

onMounted(() => {
  void refreshAll()
})

onBeforeUnmount(() => {
  stopVideoPolling()
})
</script>

<template>
  <div class="menu-page">
    <PageHeader
      title="菜单2 · 数字人素材中心"
      subtitle="音色创建后可直接用于演练场；视频任务异步生成并返回签名播放地址。"
    >
      <el-button type="primary" plain @click="refreshAll">刷新素材</el-button>
    </PageHeader>

    <div class="menu-grid two-col">
      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>医生音色复刻</h3>
            <el-tag type="info">最多 20MB</el-tag>
          </div>
        </template>

        <el-form label-position="top" @submit.prevent="submitVoice">
          <el-form-item label="音频样本">
            <el-upload
              :auto-upload="false"
              :limit="1"
              :file-list="voiceFiles"
              :on-change="voiceUploadChange"
              accept=".mp3,.wav,.m4a,.aac,.flac,.ogg"
            >
              <el-button>选择音频文件</el-button>
            </el-upload>
          </el-form-item>

          <el-form-item label="音色名称">
            <el-input v-model="voiceForm.name" placeholder="可选，默认自动生成" />
          </el-form-item>

          <el-form-item label="偏好名称">
            <el-input v-model="voiceForm.preferred_name" placeholder="可选" />
          </el-form-item>

          <el-form-item label="目标模型">
            <el-input v-model="voiceForm.target_model" />
          </el-form-item>

          <el-form-item>
            <el-switch
              v-model="voiceForm.set_active"
              active-text="设为当前生效音色"
              inactive-text="仅创建不激活"
            />
          </el-form-item>

          <el-button type="primary" :loading="creatingVoice" @click="submitVoice">创建音色</el-button>
        </el-form>
      </GlassCard>

      <GlassCard>
        <template #header>
          <div class="card-title-row">
            <h3>音色档案列表</h3>
            <el-tag type="success">{{ voiceProfiles.length }} 条</el-tag>
          </div>
        </template>

        <el-table :data="voiceProfiles" v-loading="loadingVoice" stripe>
          <el-table-column prop="name" label="名称" min-width="150" />
          <el-table-column prop="qwen_voice_id" label="voice_id" min-width="200" />
          <el-table-column label="状态" width="120">
            <template #default="scope">
              <el-tag :type="scope.row.status === 'ready' ? 'success' : 'danger'">
                {{ scope.row.status === 'ready' ? '可用' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="当前生效" width="120">
            <template #default="scope">
              <el-tag :type="scope.row.is_active ? 'success' : 'info'">{{ scope.row.is_active ? '是' : '否' }}</el-tag>
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

    <GlassCard>
      <template #header>
        <div class="card-title-row">
          <h3>医生数字人视频生成</h3>
          <el-tag :type="hasRunningVideos ? 'warning' : 'success'">
            {{ hasRunningVideos ? '任务轮询中（4s）' : '任务稳定' }}
          </el-tag>
        </div>
      </template>

      <el-form label-position="top" class="video-form" @submit.prevent="submitVideo">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="首帧图片">
              <el-upload
                :auto-upload="false"
                :limit="1"
                :file-list="imageFiles"
                :on-change="imageUploadChange"
                accept="image/*"
              >
                <el-button>上传图片</el-button>
              </el-upload>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="正向提示词">
              <el-input v-model="videoForm.prompt" placeholder="可选补充要求" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="负向提示词">
              <el-input v-model="videoForm.negative_prompt" placeholder="可选" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="时长（2-15s)">
              <el-input-number v-model="videoForm.duration" :min="2" :max="15" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="任务数量">
              <el-input-number v-model="videoForm.generate_count" :min="1" :max="5" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="分辨率">
              <el-select v-model="videoForm.resolution" style="width: 100%">
                <el-option label="720P" value="720P" />
                <el-option label="1080P" value="1080P" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="模型">
              <el-input v-model="videoForm.model" />
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="seed">
              <el-input-number v-model="videoForm.seed" :min="0" :max="999999999" />
            </el-form-item>
          </el-col>
          <el-col :span="3">
            <el-form-item label="提示词扩展">
              <el-switch v-model="videoForm.prompt_extend" />
            </el-form-item>
          </el-col>
          <el-col :span="3">
            <el-form-item label="水印">
              <el-switch v-model="videoForm.watermark" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-button type="primary" :loading="creatingVideo" @click="submitVideo">提交批量任务</el-button>
      </el-form>
    </GlassCard>

    <div class="video-card-grid" v-loading="loadingVideo">
      <article v-for="item in videos" :key="item.id" class="video-card panel-enter">
        <header>
          <h4>{{ item.scene_name || item.scene_key || `视频#${item.id}` }}</h4>
          <el-tag :type="statusType(item.task_status)">{{ statusLabel(item.task_status) }}</el-tag>
        </header>

        <video
          v-if="item.video_play_url || item.video_oss_url"
          controls
          :src="item.video_play_url || item.video_oss_url || undefined"
          @error="onVideoPlayError"
        />
        <div v-else class="video-placeholder">视频还未就绪，请刷新状态</div>

        <p class="video-meta">task_id: {{ item.task_id }}</p>
        <p class="video-meta">更新时间：{{ formatDateTime(item.updated_at) }}</p>
        <p v-if="item.error_message" class="text-danger line-clamp-2">{{ item.error_message }}</p>

        <div class="card-actions">
          <el-button size="small" @click="refreshVideo(item.id)">刷新状态/播放地址</el-button>
        </div>
      </article>
    </div>
  </div>
</template>
