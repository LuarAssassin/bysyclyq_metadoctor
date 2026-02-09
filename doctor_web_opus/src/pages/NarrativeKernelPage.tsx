import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { narrativeApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import type { NarrativeAnnotation, NarrativeKernel, NarrativeRedlines } from '@/types/api'
import PageHeader from '@/components/PageHeader'
import GlassCard from '@/components/GlassCard'
import StatusBadge from '@/components/StatusBadge'
import {
  BookOpenCheck,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import dayjs from 'dayjs'

const safeJsonParse = (s: string): Record<string, unknown> | null => {
  try { const p = JSON.parse(s); return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : null } catch { return null }
}

export default function NarrativeKernelPage() {
  const [kernel, setKernel] = useState<NarrativeKernel | null>(null)
  const [annotations, setAnnotations] = useState<NarrativeAnnotation[]>([])
  const [redlines, setRedlines] = useState<NarrativeRedlines | null>(null)
  const [kernelLoading, setKernelLoading] = useState(false)

  // Annotation form
  const [annForm, setAnnForm] = useState({ source: 'rehearsal', question: '', answer: '', comment: '', negRules: '', delta: '{}' })

  // Redline
  const [newRules, setNewRules] = useState('')

  const loadKernel = async () => {
    setKernelLoading(true)
    try {
      const r = await narrativeApi.getKernel()
      setKernel(r.data)
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setKernelLoading(false) }
  }
  const loadAnnotations = async () => { try { setAnnotations(await narrativeApi.listAnnotations(20)) } catch (e) { toast.error(toErrorMessage(e)) } }
  const loadRedlines = async () => { try { setRedlines(await narrativeApi.getRedlines()) } catch (e) { toast.error(toErrorMessage(e)) } }
  const loadAll = () => Promise.all([loadKernel(), loadAnnotations(), loadRedlines()])
  useEffect(() => { loadAll() }, []) // eslint-disable-line

  const handleAnnotation = async () => {
    if (!annForm.comment.trim()) { toast.warning('comment 为必填项'); return }
    const delta = safeJsonParse(annForm.delta)
    if (!delta) { toast.warning('delta JSON 格式不正确'); return }
    const negRules = annForm.negRules.split('\n').map((l) => l.trim()).filter(Boolean)
    try {
      const r = await narrativeApi.createAnnotation({
        source: annForm.source, question: annForm.question, answer: annForm.answer,
        comment: annForm.comment, negative_rules: negRules, delta,
      })
      toast.success(r.message)
      setKernel(r.data.kernel)
      setAnnForm((p) => ({ ...p, comment: '', question: '', answer: '', negRules: '', delta: '{}' }))
      await Promise.all([loadAnnotations(), loadRedlines()])
    } catch (e) { toast.error(toErrorMessage(e)) }
  }

  const handleAddRedlines = async () => {
    const rules = newRules.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!rules.length) { toast.warning('请至少输入一条规则'); return }
    try {
      const r = await narrativeApi.addRedlines(rules, '前端手工新增')
      toast.success(r.message); setNewRules('')
      await Promise.all([loadKernel(), loadAnnotations(), loadRedlines()])
    } catch (e) { toast.error(toErrorMessage(e)) }
  }

  const handleRemoveRule = async (rule: string) => {
    if (!confirm(`确认删除：${rule}？`)) return
    try {
      const r = await narrativeApi.removeRedlines([rule])
      toast.success(r.message); await Promise.all([loadKernel(), loadAnnotations(), loadRedlines()])
    } catch (e) { toast.error(toErrorMessage(e)) }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="医生叙事底座中心" subtitle="底座学习依赖大模型抽取，不做规则兜底；失败信息直接暴露">
        <button onClick={() => loadAll()} className="inline-flex items-center gap-1.5 text-xs font-medium text-ice-600 hover:text-ice-700 bg-ice-50 hover:bg-ice-100 px-3 py-2 rounded-lg transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 刷新底座
        </button>
      </PageHeader>

      {/* 底座概览（只读） */}
      <GlassCard
        title="编译后的 DSL Prompt（只读）"
        extra={
          <div className="flex items-center gap-2">
            <StatusBadge variant="success">rev {kernel?.revision ?? '-'}</StatusBadge>
            <StatusBadge variant="info"><Eye className="w-3 h-3" />底座由批注自动学习</StatusBadge>
          </div>
        }
      >
        {kernelLoading ? (
          <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-alpine-300" /></div>
        ) : (
          <pre className="max-h-72 overflow-auto rounded-xl border border-alpine-100 bg-alpine-50/60 p-4 text-xs text-alpine-600 whitespace-pre-wrap leading-relaxed">
            {kernel?.compiled_prompt || '底座尚未初始化'}
          </pre>
        )}
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Annotation */}
        <GlassCard title="批注学习写回" extra={<StatusBadge variant="warning">必须走大模型抽取</StatusBadge>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">source</label>
                <select value={annForm.source} onChange={(e) => setAnnForm((p) => ({ ...p, source: e.target.value }))} className="w-full h-9 rounded-lg border border-alpine-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300">
                  <option value="rehearsal">rehearsal</option>
                  <option value="manual">manual</option>
                  <option value="import">import</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">question</label>
              <textarea value={annForm.question} onChange={(e) => setAnnForm((p) => ({ ...p, question: e.target.value }))} rows={2} className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y" />
            </div>
            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">answer</label>
              <textarea value={annForm.answer} onChange={(e) => setAnnForm((p) => ({ ...p, answer: e.target.value }))} rows={2} className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y" />
            </div>
            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">comment（必填）</label>
              <textarea value={annForm.comment} onChange={(e) => setAnnForm((p) => ({ ...p, comment: e.target.value }))} rows={3} className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y" />
            </div>
            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">negative_rules（每行一条）</label>
              <textarea value={annForm.negRules} onChange={(e) => setAnnForm((p) => ({ ...p, negRules: e.target.value }))} rows={2} className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y" />
            </div>
            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">delta JSON</label>
              <textarea value={annForm.delta} onChange={(e) => setAnnForm((p) => ({ ...p, delta: e.target.value }))} rows={4} className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y" />
            </div>
            <button onClick={handleAnnotation} className="h-9 px-4 rounded-lg bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium flex items-center gap-2 transition-colors">
              <BookOpenCheck className="w-3.5 h-3.5" /> 提交批注并写回底座
            </button>
          </div>
        </GlassCard>

        {/* Redlines */}
        <GlassCard title="红线规则管理" extra={<StatusBadge variant="danger"><ShieldAlert className="w-3 h-3" />rev {redlines?.revision ?? '-'}</StatusBadge>}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">新增规则（每行一条）</label>
              <textarea value={newRules} onChange={(e) => setNewRules(e.target.value)} rows={3} className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y" />
            </div>
            <button onClick={handleAddRedlines} className="h-9 px-4 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium flex items-center gap-2 transition-colors">
              <Plus className="w-3.5 h-3.5" /> 新增红线规则
            </button>

            <div className="border-t border-alpine-100 pt-3">
              <h4 className="text-xs font-semibold text-alpine-600 mb-2">当前 negative_rules</h4>
              <div className="space-y-1.5">
                {(redlines?.negative_rules || []).length > 0 ? redlines!.negative_rules.map((rule, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-alpine-100 bg-snow-50 px-3 py-2">
                    <span className="text-sm text-alpine-700 min-w-0 truncate">{rule}</span>
                    <button onClick={() => handleRemoveRule(rule)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )) : <p className="text-xs text-alpine-400 text-center py-4">暂无规则</p>}
              </div>
            </div>

            <div className="border-t border-alpine-100 pt-3">
              <h4 className="text-xs font-semibold text-alpine-600 mb-2">bad_response_examples</h4>
              <pre className="max-h-40 overflow-auto rounded-lg border border-alpine-100 bg-alpine-50 p-3 text-xs text-alpine-600 whitespace-pre-wrap">
                {JSON.stringify(redlines?.bad_response_examples || [], null, 2)}
              </pre>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Annotation History */}
      <GlassCard title="批注历史（最近 20 条）" extra={<StatusBadge variant="info">版本回看</StatusBadge>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-alpine-400 border-b border-alpine-100">
                <th className="pb-2 pr-3 font-medium w-20">来源</th>
                <th className="pb-2 pr-3 font-medium">批注</th>
                <th className="pb-2 pr-3 font-medium w-20">rev_after</th>
                <th className="pb-2 pr-3 font-medium w-20">LLM</th>
                <th className="pb-2 font-medium w-32">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-alpine-50">
              {annotations.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-alpine-400 text-xs">暂无批注</td></tr>
              ) : annotations.map((a) => (
                <tr key={a.id} className="hover:bg-ice-50/50 transition-colors">
                  <td className="py-2 pr-3"><StatusBadge variant="neutral">{a.source}</StatusBadge></td>
                  <td className="py-2 pr-3 text-alpine-700 max-w-[300px] line-clamp-2">{a.comment}</td>
                  <td className="py-2 pr-3 text-alpine-600 font-mono text-xs">{a.revision_after}</td>
                  <td className="py-2 pr-3"><StatusBadge variant={a.llm_applied ? 'success' : 'neutral'}>{a.llm_applied ? '是' : '否'}</StatusBadge></td>
                  <td className="py-2 text-xs text-alpine-400">{dayjs(a.created_at).format('MM-DD HH:mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
