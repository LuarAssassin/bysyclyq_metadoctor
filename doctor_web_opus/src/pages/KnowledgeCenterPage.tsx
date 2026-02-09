import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { knowledgeApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import { usePolling } from '@/hooks/use-polling'
import type { KnowledgeIndexItem, KnowledgeItem, KnowledgeTagSummary } from '@/types/api'
import PageHeader from '@/components/PageHeader'
import GlassCard from '@/components/GlassCard'
import StatusBadge from '@/components/StatusBadge'
import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Trash2,
  RotateCcw,
  Tag,
} from 'lucide-react'
import dayjs from 'dayjs'
import TagGraph from '@/components/TagGraph'

const PENDING = ['pending', 'queued', 'running']

const statusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  success: { label: '抽取成功', variant: 'success' },
  failed:  { label: '抽取失败', variant: 'danger' },
  running: { label: '抽取中', variant: 'warning' },
  queued:  { label: '排队中', variant: 'info' },
  pending: { label: '待处理', variant: 'neutral' },
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export default function KnowledgeCenterPage() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [indexes, setIndexes] = useState<KnowledgeIndexItem[]>([])
  const [tags, setTags] = useState<KnowledgeTagSummary[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [listLoading, setListLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [searchKey, setSearchKey] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [graphExpanded, setGraphExpanded] = useState(false)

  const hasPending = items.some((i) => PENDING.includes(i.extract_status))

  const filteredIndexes = useMemo(() => {
    const kw = searchKey.trim().toLowerCase()
    if (!kw) return indexes
    return indexes.filter((i) => [i.file_name, i.file_id, i.description, i.tags.join(' ')].some((f) => f.toLowerCase().includes(kw)))
  }, [indexes, searchKey])

  const loadList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await knowledgeApi.list({ page, page_size: pageSize })
      setItems(res.results)
      setTotal(res.count)
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setListLoading(false) }
  }, [page])

  const loadIndexes = async () => { try { setIndexes(await knowledgeApi.indexes()) } catch (e) { toast.error(toErrorMessage(e)) } }
  const loadTags = async () => { try { setTags(await knowledgeApi.tags()) } catch (e) { toast.error(toErrorMessage(e)) } }
  const loadAll = () => Promise.all([loadList(), loadIndexes(), loadTags()])

  useEffect(() => { loadAll() }, []) // eslint-disable-line
  useEffect(() => { loadList() }, [loadList])
  usePolling(loadList, 2500, hasPending)

  const handleUpload = async () => {
    if (!selectedFiles.length) { toast.warning('请先选择文件'); return }
    setUploading(true)
    try {
      const res = await knowledgeApi.upload(selectedFiles)
      toast.success(res.message)
      setSelectedFiles([])
      if (fileRef.current) fileRef.current.value = ''
      setPage(1)
      await loadAll()
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setUploading(false) }
  }

  const retryExtract = async (id: number) => { try { const r = await knowledgeApi.extract(id); toast.success(r.message); await loadList() } catch (e) { toast.error(toErrorMessage(e)) } }
  const removeItem = async (item: KnowledgeItem) => {
    if (!confirm(`确认删除「${item.file_name}」？`)) return
    try { const r = await knowledgeApi.remove(item.id); toast.success(r.message); await loadAll() } catch (e) { toast.error(toErrorMessage(e)) }
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      <PageHeader title="知识库与索引中心" subtitle="上传 → 入队 → 抽取 → 成功/失败，页面实时反馈状态">
        <button onClick={() => loadAll()} className="inline-flex items-center gap-1.5 text-xs font-medium text-ice-600 hover:text-ice-700 bg-ice-50 hover:bg-ice-100 px-3 py-2 rounded-lg transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 刷新
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upload */}
        <GlassCard title="知识文件上传" extra={<StatusBadge variant="info">单次最多 10 个</StatusBadge>}>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-alpine-200 hover:border-ice-300 rounded-xl p-6 text-center cursor-pointer transition-colors group"
          >
            <FileUp className="w-8 h-8 text-alpine-300 group-hover:text-ice-400 mx-auto mb-2 transition-colors" />
            <p className="text-sm text-alpine-500">点击选择文件，或拖拽到此处</p>
            <p className="text-xs text-alpine-400 mt-1">支持 pdf/doc/ppt/xls/图片等，单文件最大 150MB</p>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => setSelectedFiles(Array.from(e.target.files || []).slice(0, 10))}
            />
          </div>
          {selectedFiles.length > 0 && (
            <div className="mt-3 space-y-1">
              {selectedFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-ice-50 rounded-lg px-3 py-1.5">
                  <span className="truncate text-alpine-700">{f.name}</span>
                  <span className="text-alpine-400 flex-shrink-0 ml-2">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={handleUpload}
            disabled={uploading || !selectedFiles.length}
            className="mt-3 w-full h-10 rounded-xl bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            {uploading ? '上传中...' : '上传并触发抽取'}
          </button>
        </GlassCard>

        {/* Tags Graph */}
        <GlassCard
          title="标签关系图谱"
          bodyClassName="p-0"
          noPadding
          extra={
            <div className="flex items-center gap-2">
              <StatusBadge variant="success"><Tag className="w-3 h-3" />{tags.length} 标签</StatusBadge>
              <button
                onClick={() => setGraphExpanded(!graphExpanded)}
                className="p-1.5 rounded-lg hover:bg-alpine-50 text-alpine-400 hover:text-alpine-600 transition-colors"
                title={graphExpanded ? '收起' : '展开'}
              >
                {graphExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          }
        >
          <TagGraph
            tags={tags}
            indexes={indexes}
            className={graphExpanded ? 'h-[520px]' : 'h-[300px]'}
          />
        </GlassCard>
      </div>

      {/* Expanded full-width graph */}
      {graphExpanded && (
        <GlassCard
          title="标签关系图谱（全景）"
          bodyClassName="p-0"
          noPadding
          extra={
            <button
              onClick={() => setGraphExpanded(false)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-alpine-500 hover:text-alpine-700 bg-alpine-50 hover:bg-alpine-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Minimize2 className="w-3.5 h-3.5" /> 收起
            </button>
          }
        >
          <TagGraph
            tags={tags}
            indexes={indexes}
            className="h-[600px]"
          />
        </GlassCard>
      )}

      {/* File List */}
      <GlassCard
        title="知识文件状态列表"
        extra={<StatusBadge variant={hasPending ? 'warning' : 'success'} dot>{hasPending ? '轮询中 (2.5s)' : '状态稳定'}</StatusBadge>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-alpine-400 border-b border-alpine-100">
                <th className="pb-2 pr-3 font-medium">文件名</th>
                <th className="pb-2 pr-3 font-medium w-20">大小</th>
                <th className="pb-2 pr-3 font-medium w-24">抽取状态</th>
                <th className="pb-2 pr-3 font-medium">标签</th>
                <th className="pb-2 pr-3 font-medium">描述</th>
                <th className="pb-2 pr-3 font-medium w-32">更新时间</th>
                <th className="pb-2 font-medium w-28 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-alpine-50">
              {listLoading && !items.length ? (
                <tr><td colSpan={7} className="py-12 text-center text-alpine-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-alpine-400">暂无知识文件</td></tr>
              ) : items.map((item) => {
                const st = statusMap[item.extract_status] || statusMap.pending!
                return (
                  <tr key={item.id} className="hover:bg-ice-50/50 transition-colors">
                    <td className="py-2.5 pr-3 font-medium text-alpine-800 max-w-[200px] truncate">{item.file_name}</td>
                    <td className="py-2.5 pr-3 text-alpine-500 text-xs">{formatBytes(item.size_bytes)}</td>
                    <td className="py-2.5 pr-3"><StatusBadge variant={st.variant} dot>{st.label}</StatusBadge></td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((t) => <span key={t.id} className="text-[11px] bg-ice-50 text-ice-700 px-1.5 py-0.5 rounded">{t.name}</span>)}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-alpine-500 max-w-[240px]">
                      <p className="line-clamp-2">{item.knowledge_description || '-'}</p>
                      {item.extract_error && <p className="text-red-500 line-clamp-1 mt-0.5">{item.extract_error}</p>}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-alpine-400">{dayjs(item.updated_at).format('MM-DD HH:mm')}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => retryExtract(item.id)} className="p-1.5 rounded-lg hover:bg-ice-50 text-ice-600 transition-colors" title="重试抽取">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeItem(item)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="删除">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-alpine-50">
            <span className="text-xs text-alpine-400">共 {total} 条</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-alpine-50 disabled:opacity-30 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs text-alpine-600 px-2">{page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-alpine-50 disabled:opacity-30 transition-colors"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Index Search */}
      <GlassCard
        title="知识索引检索"
        extra={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-alpine-300" />
            <input
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              placeholder="搜索文件名/标签/file_id"
              className="h-8 w-52 pl-8 pr-3 rounded-lg border border-alpine-200 text-xs focus:outline-none focus:ring-2 focus:ring-ice-300 bg-white transition-all"
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-alpine-400 border-b border-alpine-100">
                <th className="pb-2 pr-3 font-medium">文件名</th>
                <th className="pb-2 pr-3 font-medium">file_id</th>
                <th className="pb-2 pr-3 font-medium">标签</th>
                <th className="pb-2 font-medium">描述</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-alpine-50">
              {filteredIndexes.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-alpine-400 text-xs">暂无索引</td></tr>
              ) : filteredIndexes.map((item) => (
                <tr key={item.file_id} className="hover:bg-ice-50/50 transition-colors">
                  <td className="py-2 pr-3 font-medium text-alpine-800 max-w-[200px] truncate">{item.file_name}</td>
                  <td className="py-2 pr-3 text-xs text-alpine-400 font-mono max-w-[200px] truncate">{item.file_id}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((t) => <span key={t} className="text-[11px] bg-ice-50 text-ice-700 px-1.5 py-0.5 rounded">{t}</span>)}
                    </div>
                  </td>
                  <td className="py-2 text-xs text-alpine-500 max-w-[300px] line-clamp-2">{item.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
