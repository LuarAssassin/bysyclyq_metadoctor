<template>
  <div class="session-page">
    <!-- Header -->
    <header class="session-header">
      <div class="header-left">
        <el-button text @click="$router.push('/rehearsal')">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <div class="session-title">
          <h2>{{ session?.title || '问诊演练' }}</h2>
          <span class="session-status" :class="{ active: isStreaming }">
            <span class="status-dot"></span>
            {{ isStreaming ? 'AI 思考中...' : '就绪' }}
          </span>
        </div>
      </div>
      <div class="header-actions">
        <el-button text @click="showAssets = true">
          <el-icon><VideoCamera /></el-icon>
          播放资源
        </el-button>
      </div>
    </header>
    
    <!-- Messages Container -->
    <div ref="messagesContainer" class="messages-container">
      <div v-for="message in messages" :key="message.id" class="message-wrapper">
        <!-- User Message -->
        <div v-if="message.role === 'user'" class="message user">
          <div class="message-content">
            <div class="message-bubble">
              {{ message.content }}
            </div>
          </div>
        </div>
        
        <!-- AI Message -->
        <div v-else class="message assistant">
          <div class="message-avatar">
            <div class="avatar-icon">
              <el-icon><ChatDotRound /></el-icon>
            </div>
          </div>
          <div class="message-content">
            <!-- Sources -->
            <div v-if="message.selected_file_ids?.length" class="message-sources">
              <el-tag size="small" effect="light" type="info">
                <el-icon><Document /></el-icon>
                引用了 {{ message.selected_file_ids.length }} 个知识文件
              </el-tag>
            </div>
            
            <!-- Content -->
            <div class="message-bubble">
              <div class="markdown-body" v-html="renderMarkdown(message.content)"></div>
            </div>
            
            <!-- Search Sources -->
            <div v-if="message.search_sources?.length" class="search-sources">
              <div class="sources-header">
                <el-icon><Link /></el-icon>
                <span>参考来源</span>
              </div>
              <div class="sources-list">
                <a
                  v-for="(source, idx) in message.search_sources.slice(0, 3)"
                  :key="idx"
                  :href="source.url"
                  target="_blank"
                  class="source-link"
                >
                  {{ source.title }}
                </a>
              </div>
            </div>
            
            <!-- Message Actions -->
            <div class="message-actions">
              <el-button text size="small" @click="openFeedback(message)">
                <el-icon><EditPen /></el-icon>
                批注反馈
              </el-button>
              <el-button text size="small" @click="copyMessage(message.content)">
                <el-icon><CopyDocument /></el-icon>
                复制
              </el-button>
            </div>
            
            <!-- Token Usage -->
            <div v-if="message.output_tokens" class="token-usage">
              <span>输入: {{ message.input_tokens }} tokens</span>
              <span>输出: {{ message.output_tokens }} tokens</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Streaming Message -->
      <div v-if="streamingContent" class="message assistant streaming">
        <div class="message-avatar">
          <div class="avatar-icon pulsing">
            <el-icon><ChatDotRound /></el-icon>
          </div>
        </div>
        <div class="message-content">
          <div class="message-bubble">
            <div class="markdown-body" v-html="renderMarkdown(streamingContent)"></div>
          </div>
        </div>
      </div>
      
      <div ref="bottomAnchor"></div>
    </div>
    
    <!-- Input Area -->
    <div class="input-area">
      <div class="input-container">
        <el-input
          v-model="inputMessage"
          type="textarea"
          :rows="2"
          placeholder="输入您的问题，模拟患者问诊..."
          resize="none"
          :disabled="isStreaming"
          @keydown.enter.prevent="sendMessage"
        />
        <div class="input-actions">
          <el-checkbox v-model="forcedSearch">强制联网搜索</el-checkbox>
          <el-button
            type="primary"
            :loading="isStreaming"
            :disabled="!inputMessage.trim()"
            @click="sendMessage"
          >
            <el-icon><Promotion /></el-icon>
            发送
          </el-button>
        </div>
      </div>
    </div>
    
    <!-- Feedback Dialog -->
    <el-dialog
      v-model="showFeedback"
      title="批注反馈"
      width="700px"
      destroy-on-close
    >
      <div class="feedback-form">
        <div class="original-answer">
          <h4>原回答</h4>
          <div class="answer-content">{{ selectedMessage?.content }}</div>
        </div>
        
        <div class="editor-section">
          <h4>编辑优化（使用 Markdown）</h4>
          <md-editor
            v-model="editedMarkdown"
            language="zh-CN"
            :toolbars="toolbars"
            :footers="[]"
            preview-theme="github"
          />
        </div>
        
        <div class="comment-section">
          <h4>批注说明</h4>
          <el-input
            v-model="feedbackComment"
            type="textarea"
            :rows="3"
            placeholder="说明修改原因和期望的风格..."
          />
        </div>
        
        <el-checkbox v-model="applyToKernel">
          将此反馈应用到人格底座（AI 会学习您的风格）
        </el-checkbox>
      </div>
      <template #footer>
        <el-button @click="showFeedback = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitFeedback">
          提交反馈
        </el-button>
      </template>
    </el-dialog>
    
    <!-- Assets Dialog -->
    <el-dialog
      v-model="showAssets"
      title="播放资源"
      width="500px"
    >
      <div class="assets-content">
        <div class="asset-section">
          <h4>音色</h4>
          <p>{{ playbackAssets?.voice_id ? '使用您的专属音色' : '使用默认音色' }}</p>
        </div>
        <div class="asset-section">
          <h4>视频素材</h4>
          <div v-if="playbackAssets?.videos?.length" class="video-list">
            <div v-for="video in playbackAssets.videos" :key="video.video_id" class="video-item">
              <span>{{ video.scene_name }}</span>
              <el-tag size="small" type="success">可用</el-tag>
            </div>
          </div>
          <el-empty v-else description="暂无视频素材，请到数字人素材中心生成" />
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowLeft, ChatDotRound, VideoCamera, Document,
  Link, EditPen, CopyDocument, Promotion
} from '@element-plus/icons-vue'
import { marked } from 'marked'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import {
  getSessionMessages,
  askStream,
  getPlaybackAssets,
  updateMessageMarkdown,
  submitFeedback as submitFeedbackApi,
} from '@/api/rehearsal'
import type { RehearsalMessage, PlaybackAssets } from '@/types'

const route = useRoute()
const sessionId = computed(() => Number(route.params.sessionId))

const messages = ref<RehearsalMessage[]>([])
const inputMessage = ref('')
const streamingContent = ref('')
const isStreaming = ref(false)
const forcedSearch = ref(false)
const loading = ref(false)
const showFeedback = ref(false)
const showAssets = ref(false)
const selectedMessage = ref<RehearsalMessage | null>(null)
const editedMarkdown = ref('')
const feedbackComment = ref('')
const applyToKernel = ref(true)
const submitting = ref(false)
const playbackAssets = ref<PlaybackAssets | null>(null)

const bottomAnchor = ref<HTMLElement>()

const session = ref<any>(null)

const toolbars: any = [
  'bold', 'underline', 'italic', '-',
  'title', 'strikeThrough', 'sub', 'sup', 'quote', 'unorderedList', 'orderedList',
  '-', 'codeRow', 'code', 'link', 'image', 'table',
  '-', 'revoke', 'next', 'save'
]

const renderMarkdown = (content: string) => {
  return marked.parse(content || '', { async: false }) as string
}

const fetchMessages = async () => {
  loading.value = true
  try {
    messages.value = await getSessionMessages(sessionId.value, { limit: 100 })
    scrollToBottom()
  } finally {
    loading.value = false
  }
}

const fetchAssets = async () => {
  try {
    playbackAssets.value = await getPlaybackAssets()
  } catch {}
}

const sendMessage = async () => {
  const content = inputMessage.value.trim()
  if (!content || isStreaming.value) return
  
  // Add user message to list immediately
  const userMessage: RehearsalMessage = {
    id: Date.now(),
    role: 'user',
    content,
    markdown_content: null,
    search_sources: null,
    selected_file_ids: null,
    input_tokens: 0,
    output_tokens: 0,
    created_at: new Date().toISOString(),
  }
  messages.value.push(userMessage)
  inputMessage.value = ''
  isStreaming.value = true
  streamingContent.value = ''
  scrollToBottom()
  
  try {
    const response = await askStream(sessionId.value, {
      question: content,
      forced_search: forcedSearch.value,
    })
    
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    
    if (!reader) {
      throw new Error('无法读取响应')
    }
    
    let answerMessageId: number | null = null
    let selectedFiles: string[] = []
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')
      
      for (const line of lines) {
        if (!line.trim()) continue
        
        try {
          const data = JSON.parse(line.replace(/^data: /, ''))
          
          if (data.event === 'start') {
            answerMessageId = data.answer_message_id
            selectedFiles = data.selected_file_ids || []
          } else if (data.event === 'delta') {
            streamingContent.value += data.delta
            scrollToBottom()
          } else if (data.event === 'done') {
            // Add final message
            messages.value.push({
              id: answerMessageId || Date.now(),
              role: 'assistant',
              content: streamingContent.value,
              markdown_content: null,
              search_sources: data.search_sources,
              selected_file_ids: selectedFiles,
              input_tokens: data.usage?.input_tokens || 0,
              output_tokens: data.usage?.output_tokens || 0,
              created_at: new Date().toISOString(),
            })
            streamingContent.value = ''
          } else if (data.event === 'error') {
            ElMessage.error(data.message || '生成回答时出错')
          }
        } catch {
          // Ignore parse errors for non-JSON lines
        }
      }
    }
  } catch (error: any) {
    ElMessage.error(error.message || '发送失败')
  } finally {
    isStreaming.value = false
    streamingContent.value = ''
    scrollToBottom()
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    bottomAnchor.value?.scrollIntoView({ behavior: 'smooth' })
  })
}

const openFeedback = (message: RehearsalMessage) => {
  selectedMessage.value = message
  editedMarkdown.value = message.markdown_content || message.content
  feedbackComment.value = ''
  applyToKernel.value = true
  showFeedback.value = true
}

const submitFeedback = async () => {
  if (!selectedMessage.value) return
  
  submitting.value = true
  try {
    // First save markdown
    await updateMessageMarkdown(selectedMessage.value.id, editedMarkdown.value)
    
    // Then submit feedback
    await submitFeedbackApi(selectedMessage.value.id, {
      comment: feedbackComment.value,
      edited_markdown: editedMarkdown.value,
      apply_to_kernel: applyToKernel.value,
    })
    
    ElMessage.success('反馈已提交')
    showFeedback.value = false
    fetchMessages()
  } catch {
    ElMessage.error('提交失败')
  } finally {
    submitting.value = false
  }
}

const copyMessage = (content: string) => {
  navigator.clipboard.writeText(content)
  ElMessage.success('已复制到剪贴板')
}

onMounted(() => {
  fetchMessages()
  fetchAssets()
})

watch(() => route.params.sessionId, () => {
  fetchMessages()
})
</script>

<style scoped lang="scss">
.session-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 64px);
  background: var(--snow-pure);
}

// Header
.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--snow-white);
  border-bottom: 1px solid var(--glacier-200);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.session-title {
  h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--glacier-800);
  }
}

.session-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--glacier-400);
  
  &.active {
    color: var(--ice-primary);
  }
  
  .status-dot {
    width: 6px;
    height: 6px;
    background: currentColor;
    border-radius: 50%;
    
    .active & {
      animation: pulse 1.5s infinite;
    }
  }
}

// Messages Container
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.message-wrapper {
  margin-bottom: 24px;
}

.message {
  display: flex;
  gap: 16px;
  
  &.user {
    justify-content: flex-end;
    
    .message-content {
      max-width: 80%;
    }
    
    .message-bubble {
      background: linear-gradient(135deg, var(--ice-primary) 0%, var(--ice-primary-dark) 100%);
      color: white;
      border-radius: 18px 18px 4px 18px;
    }
  }
  
  &.assistant {
    .message-avatar {
      flex-shrink: 0;
    }
    
    .message-content {
      max-width: 80%;
    }
    
    .message-bubble {
      background: var(--snow-white);
      border: 1px solid var(--glacier-200);
      border-radius: 4px 18px 18px 18px;
    }
  }
}

.avatar-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--aurora-teal) 0%, #2dd4bf 100%);
  border-radius: 10px;
  color: white;
  
  &.pulsing {
    animation: pulse-glow 2s infinite;
  }
}

.message-bubble {
  padding: 16px 20px;
  font-size: 15px;
  line-height: 1.7;
}

// Sources
.message-sources {
  margin-bottom: 8px;
}

.search-sources {
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--glacier-50);
  border-radius: 10px;
}

.sources-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--glacier-500);
  margin-bottom: 8px;
}

.sources-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.source-link {
  font-size: 13px;
  color: var(--ice-primary);
  text-decoration: none;
  
  &:hover {
    text-decoration: underline;
  }
}

// Message Actions
.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}

.message:hover .message-actions {
  opacity: 1;
}

.token-usage {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--glacier-400);
}

// Input Area
.input-area {
  padding: 16px 24px;
  background: var(--snow-white);
  border-top: 1px solid var(--glacier-200);
  flex-shrink: 0;
}

.input-container {
  max-width: 900px;
  margin: 0 auto;
}

.input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

// Feedback Dialog
.feedback-form {
  h4 {
    font-size: 14px;
    font-weight: 600;
    color: var(--glacier-700);
    margin-bottom: 12px;
  }
}

.original-answer {
  margin-bottom: 20px;
  
  .answer-content {
    padding: 16px;
    background: var(--glacier-50);
    border-radius: 10px;
    font-size: 14px;
    color: var(--glacier-600);
    max-height: 200px;
    overflow-y: auto;
  }
}

.editor-section {
  margin-bottom: 20px;
  
  :deep(.md-editor) {
    border-radius: 10px;
  }
}

.comment-section {
  margin-bottom: 16px;
}

// Assets Dialog
.assets-content {
  .asset-section {
    margin-bottom: 20px;
    
    h4 {
      font-size: 14px;
      font-weight: 600;
      color: var(--glacier-700);
      margin-bottom: 8px;
    }
    
    p {
      font-size: 14px;
      color: var(--glacier-500);
    }
  }
}

.video-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.video-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: var(--glacier-50);
  border-radius: 8px;
  font-size: 14px;
  color: var(--glacier-700);
}

// Animations
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(20, 184, 166, 0.4); }
  50% { box-shadow: 0 0 0 10px rgba(20, 184, 166, 0); }
}

// Markdown Styles
.markdown-body {
  :deep(p) { margin: 0 0 12px; }
  :deep(p:last-child) { margin-bottom: 0; }
  :deep(ul, ol) { margin: 0 0 12px; padding-left: 24px; }
  :deep(li) { margin-bottom: 4px; }
  :deep(code) {
    background: rgba(0,0,0,0.05);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  :deep(pre) {
    background: var(--glacier-900);
    color: var(--glacier-100);
    padding: 16px;
    border-radius: 10px;
    overflow-x: auto;
    margin: 12px 0;
  }
  :deep(pre code) {
    background: none;
    padding: 0;
  }
  :deep(blockquote) {
    border-left: 4px solid var(--ice-primary);
    margin: 12px 0;
    padding-left: 16px;
    color: var(--glacier-500);
  }
}

[data-theme='dark'] {
  .session-page {
    background: var(--glacier-950);
  }
  
  .session-header,
  .input-area {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
  
  .session-title h2 {
    color: var(--glacier-100);
  }
  
  .message.assistant .message-bubble {
    background: var(--glacier-900);
    border-color: var(--glacier-800);
  }
}
</style>
