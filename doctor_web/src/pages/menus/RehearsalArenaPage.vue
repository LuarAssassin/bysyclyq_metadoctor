<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MdEditor, MdPreview } from 'md-editor-v3'
import { rehearsalApi } from '../../services/api'
import { askRehearsalStream } from '../../services/rehearsal-stream'
import type {
  RehearsalDoneEvent,
  RehearsalMessage,
  RehearsalPlaybackAssets,
  RehearsalSession,
  RehearsalStartEvent,
} from '../../types/api'
import { toErrorMessage } from '../../utils/http-error'
import { formatDateTime, formatRelativeSafe } from '../../utils/time'
import PageHeader from '../../components/PageHeader.vue'
import GlassCard from '../../components/GlassCard.vue'

const sessionLoading = ref(false)
const messageLoading = ref(false)
const sending = ref(false)
const sessions = ref<RehearsalSession[]>([])
const messages = ref<RehearsalMessage[]>([])
const currentSessionId = ref<number | null>(null)
const createSessionTitle = ref('')
const question = ref('')
const forcedSearch = ref(true)
const messageListRef = ref<HTMLElement>()

const playbackLoading = ref(false)
const playbackAssets = ref<RehearsalPlaybackAssets | null>(null)
const selectedPlaybackUrl = ref('')

const editorVisible = ref(false)
const editingMessageId = ref<number | null>(null)
const editingMarkdown = ref('')
const feedbackComment = ref('')
const applyToKernel = ref(true)

const currentSession = computed(() => {
  if (!currentSessionId.value) {
    return null
  }
  return sessions.value.find((item) => item.id === currentSessionId.value) || null
})

const assistantMessages = computed(() => {
  return messages.value.filter((item) => item.role === 'assistant')
})

const renderMarkdown = (message: RehearsalMessage): string => {
  return message.edited_markdown || message.content_markdown || message.content || ''
}

const scrollToBottom = async () => {
  await nextTick()
  if (!messageListRef.value) {
    return
  }
  messageListRef.value.scrollTop = messageListRef.value.scrollHeight
}

const loadSessions = async () => {
  sessionLoading.value = true
  try {
    sessions.value = await rehearsalApi.listSessions()
    if (!currentSessionId.value && sessions.value.length) {
      const firstSession = sessions.value[0]
      if (firstSession) {
        currentSessionId.value = firstSession.id
      }
    }
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    sessionLoading.value = false
  }
}

const loadMessages = async (sessionId?: number) => {
  const id = sessionId ?? currentSessionId.value
  if (!id) {
    messages.value = []
    return
  }

  messageLoading.value = true
  try {
    const data = await rehearsalApi.listMessages(id, 100)
    messages.value = data.messages
    await scrollToBottom()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    messageLoading.value = false
  }
}

const loadPlaybackAssets = async () => {
  playbackLoading.value = true
  try {
    playbackAssets.value = await rehearsalApi.getPlaybackAssets()
    chooseRandomPlaybackVideo()
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    playbackLoading.value = false
  }
}

const chooseRandomPlaybackVideo = () => {
  const candidates = playbackAssets.value?.video_urls || []
  if (!candidates.length) {
    selectedPlaybackUrl.value = ''
    return
  }
  const index = Math.floor(Math.random() * candidates.length)
  selectedPlaybackUrl.value = candidates[index] || ''
}

const refreshAll = async () => {
  await Promise.all([loadSessions(), loadPlaybackAssets()])
  await loadMessages()
}

const createSession = async () => {
  try {
    const result = await rehearsalApi.createSession(createSessionTitle.value)
    ElMessage.success(result.message)
    createSessionTitle.value = ''
    await loadSessions()
    currentSessionId.value = result.data.id
    await loadMessages(result.data.id)
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const selectSession = async (sessionId: number) => {
  currentSessionId.value = sessionId
  await loadMessages(sessionId)
}

const getMessageById = (messageId: number): RehearsalMessage | undefined => {
  return messages.value.find((item) => item.id === messageId)
}

const upsertMessage = (message: RehearsalMessage) => {
  const index = messages.value.findIndex((item) => item.id === message.id)
  if (index < 0) {
    messages.value.push(message)
  } else {
    messages.value[index] = message
  }
}

const createTempMessage = (
  params: Partial<RehearsalMessage> & { id: number; role: string; content: string },
): RehearsalMessage => {
  const now = new Date().toISOString()
  return {
    id: params.id,
    session: currentSessionId.value || 0,
    role: params.role,
    turn_index: params.turn_index || 0,
    generation_status: params.generation_status || 'generating',
    reply_to: params.reply_to || null,
    content: params.content,
    content_markdown: params.content,
    edited_markdown: null,
    edited_at: null,
    model_name: params.model_name || null,
    selected_file_ids: [],
    selected_file_meta: [],
    grounding_answer: null,
    grounding_sources: [],
    search_sources: [],
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    error_message: null,
    meta: null,
    created_at: now,
    updated_at: now,
  }
}

const sendQuestion = async () => {
  const text = question.value.trim()
  if (!text) {
    ElMessage.warning('请输入问诊问题')
    return
  }

  if (!currentSessionId.value) {
    ElMessage.warning('请先创建或选择会话')
    return
  }

  sending.value = true
  const localQuestion = text
  question.value = ''

  const optimisticUser = createTempMessage({
    id: -Date.now(),
    role: 'user',
    content: localQuestion,
    generation_status: 'succeeded',
    turn_index: Math.ceil((messages.value.length + 1) / 2),
  })
  messages.value.push(optimisticUser)
  await scrollToBottom()

  let startPayload: RehearsalStartEvent | null = null

  try {
    await askRehearsalStream(
      currentSessionId.value,
      {
        question: localQuestion,
        forced_search: forcedSearch.value,
      },
      {
        onStart: async (data) => {
          startPayload = data
          const userServerMessage = createTempMessage({
            id: data.question_message_id,
            role: 'user',
            content: localQuestion,
            generation_status: 'succeeded',
          })
          upsertMessage(userServerMessage)

          const assistantMessage = createTempMessage({
            id: data.answer_message_id,
            role: 'assistant',
            content: '',
            generation_status: 'generating',
            reply_to: data.question_message_id,
          })
          assistantMessage.selected_file_ids = data.selected_file_ids || []
          assistantMessage.selected_file_meta = data.selected_file_meta || []
          assistantMessage.grounding_sources = data.grounding_sources || []
          upsertMessage(assistantMessage)
          await scrollToBottom()
        },
        onDelta: async (data) => {
          const current = getMessageById(data.message_id)
          if (!current) {
            return
          }
          current.content += data.delta
          current.content_markdown = current.content
          current.updated_at = new Date().toISOString()
          await scrollToBottom()
        },
        onDone: (data: RehearsalDoneEvent) => {
          const current = getMessageById(data.message_id)
          if (!current) {
            return
          }
          current.generation_status = 'succeeded'
          current.search_sources = data.search_sources || []
          current.selected_file_ids = data.selected_file_ids || current.selected_file_ids
          current.input_tokens = data.usage?.input_tokens || null
          current.output_tokens = data.usage?.output_tokens || null
          current.total_tokens = data.usage?.total_tokens || null
          current.updated_at = new Date().toISOString()
        },
        onError: (data) => {
          const targetId = data.message_id || startPayload?.answer_message_id
          if (!targetId) {
            ElMessage.error(data.message || '流式问答出错')
            return
          }

          const current = getMessageById(targetId)
          if (!current) {
            return
          }
          current.generation_status = 'failed'
          current.error_message = data.message
          current.updated_at = new Date().toISOString()
          ElMessage.error(data.message || '流式问答出错')
        },
      },
    )

    await Promise.all([loadMessages(currentSessionId.value), loadSessions()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
    await loadMessages(currentSessionId.value)
  } finally {
    sending.value = false
  }
}

const openEditor = (message: RehearsalMessage) => {
  editingMessageId.value = message.id
  editingMarkdown.value = renderMarkdown(message)
  feedbackComment.value = ''
  applyToKernel.value = true
  editorVisible.value = true
}

const saveMarkdown = async () => {
  if (!editingMessageId.value) {
    return
  }

  if (!editingMarkdown.value.trim()) {
    ElMessage.warning('Markdown 不能为空')
    return
  }

  try {
    const result = await rehearsalApi.saveMarkdown(editingMessageId.value, editingMarkdown.value)
    ElMessage.success(result.message)
    await loadMessages(currentSessionId.value || undefined)
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

const submitFeedback = async () => {
  if (!editingMessageId.value) {
    return
  }

  if (!feedbackComment.value.trim()) {
    ElMessage.warning('请填写批改意见 comment')
    return
  }

  try {
    const result = await rehearsalApi.submitFeedback(editingMessageId.value, {
      comment: feedbackComment.value,
      edited_markdown: editingMarkdown.value,
      apply_to_kernel: applyToKernel.value,
    })
    ElMessage.success(result.message)
    await Promise.all([loadMessages(currentSessionId.value || undefined), loadPlaybackAssets()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <div class="menu-page">
    <PageHeader
      title="菜单5 · AI 问诊演练场"
      subtitle="会话管理 + 流式回答 + 来源/Token + Markdown 批改 + 反馈学习闭环。"
    >
      <el-button type="primary" plain @click="refreshAll">刷新全部</el-button>
    </PageHeader>

    <div class="rehearsal-layout">
      <aside class="rehearsal-sidebar">
        <GlassCard>
          <template #header>
            <div class="card-title-row">
              <h3>演练会话</h3>
              <el-tag type="info">{{ sessions.length }} 个</el-tag>
            </div>
          </template>

          <div class="create-session-row">
            <el-input v-model="createSessionTitle" placeholder="新会话标题（可选）" />
            <el-button type="primary" @click="createSession">新建</el-button>
          </div>

          <div class="session-list" v-loading="sessionLoading">
            <button
              v-for="item in sessions"
              :key="item.id"
              class="session-item"
              :class="{ active: item.id === currentSessionId }"
              @click="selectSession(item.id)"
            >
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ formatRelativeSafe(item.last_message_at || item.updated_at) }}</p>
              </div>
              <el-tag size="small" :type="item.status === 'active' ? 'success' : 'info'">{{ item.status }}</el-tag>
            </button>

            <el-empty v-if="!sessions.length" description="暂无会话" :image-size="80" />
          </div>
        </GlassCard>

        <GlassCard>
          <template #header>
            <div class="card-title-row">
              <h3>问诊回放资产</h3>
              <el-button text @click="loadPlaybackAssets">刷新地址</el-button>
            </div>
          </template>

          <div v-loading="playbackLoading" class="playback-box">
            <p><strong>voice_id:</strong> {{ playbackAssets?.voice_id || '-' }}</p>
            <p><strong>voice_name:</strong> {{ playbackAssets?.voice_name || '-' }}</p>
            <p><strong>tts_model:</strong> {{ playbackAssets?.tts_model || '-' }}</p>

            <el-button size="small" @click="chooseRandomPlaybackVideo">随机切换视频</el-button>

            <video
              v-if="selectedPlaybackUrl"
              class="playback-video"
              controls
              :src="selectedPlaybackUrl"
              @error="loadPlaybackAssets"
            />
            <el-empty v-else description="暂无可播放视频" :image-size="80" />
          </div>
        </GlassCard>
      </aside>

      <section class="rehearsal-main">
        <GlassCard>
          <template #header>
            <div class="card-title-row">
              <h3>{{ currentSession?.title || '请先创建会话' }}</h3>
              <el-tag type="success">assistant 消息 {{ assistantMessages.length }} 条</el-tag>
            </div>
          </template>

          <div ref="messageListRef" class="message-list" v-loading="messageLoading">
            <div
              v-for="item in messages"
              :key="item.id"
              class="message-row"
              :class="`role-${item.role}`"
            >
              <article class="message-card">
                <header>
                  <strong>{{ item.role === 'assistant' ? 'AI 医生' : '医生' }}</strong>
                  <span>{{ formatDateTime(item.created_at) }}</span>
                </header>

                <div v-if="item.role === 'assistant'" class="message-markdown">
                  <MdPreview :editor-id="`preview-${item.id}`" :model-value="renderMarkdown(item)" />
                </div>
                <pre v-else class="message-text">{{ item.content }}</pre>

                <div v-if="item.role === 'assistant'" class="message-meta">
                  <el-tag :type="item.generation_status === 'failed' ? 'danger' : item.generation_status === 'succeeded' ? 'success' : 'warning'">
                    {{ item.generation_status }}
                  </el-tag>
                  <el-tag v-if="item.total_tokens" type="info">tokens: {{ item.total_tokens }}</el-tag>
                  <el-tag v-if="item.selected_file_ids?.length" type="warning">selected_file_ids: {{ item.selected_file_ids.length }}</el-tag>
                  <el-tag v-if="item.search_sources?.length" type="success">联网来源: {{ item.search_sources.length }}</el-tag>
                </div>

                <p v-if="item.error_message" class="text-danger">{{ item.error_message }}</p>

                <div v-if="item.role === 'assistant'" class="card-actions">
                  <el-button size="small" @click="openEditor(item)">Markdown 批改</el-button>
                </div>
              </article>
            </div>

            <el-empty v-if="!messages.length" description="暂无消息，输入一个问题开始演练" :image-size="100" />
          </div>

          <div class="ask-box">
            <el-input
              v-model="question"
              type="textarea"
              :rows="3"
              resize="none"
              placeholder="输入医生问诊问题，例如：血压偏高并伴头痛，应该怎么处理？"
            />

            <div class="ask-actions">
              <el-switch v-model="forcedSearch" active-text="forced_search=true" inactive-text="forced_search=false" />
              <el-button type="primary" :loading="sending" @click="sendQuestion">发送流式问答</el-button>
            </div>
          </div>
        </GlassCard>
      </section>
    </div>

    <el-drawer v-model="editorVisible" title="回答 Markdown 批改" size="65%">
      <div class="editor-drawer-content">
        <MdEditor v-model="editingMarkdown" :preview="true" />

        <el-form label-position="top">
          <el-form-item label="批改意见 comment（用于反馈学习）">
            <el-input v-model="feedbackComment" type="textarea" :rows="4" />
          </el-form-item>
          <el-form-item>
            <el-switch
              v-model="applyToKernel"
              active-text="提交后写入叙事底座"
              inactive-text="仅保存反馈不写底座"
            />
          </el-form-item>
          <div class="card-actions">
            <el-button @click="saveMarkdown">先保存 Markdown</el-button>
            <el-button type="primary" @click="submitFeedback">提交反馈学习</el-button>
          </div>
        </el-form>
      </div>
    </el-drawer>
  </div>
</template>
