import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { sessionApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import type { PatientSession } from '@/types/api'
import {
  ChevronRight,
  Loader2,
  MessageSquare,
  Pin,
  RefreshCw,
  Stethoscope,
  Trash2,
  UserCircle,
} from 'lucide-react'
import dayjs from 'dayjs'
import { AnimatePresence, motion } from 'framer-motion'

function statusDotClass(status: string) {
  if (status === 'active') return 'bg-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]'
  if (status === 'archived') return 'bg-slate-300 shadow-[0_0_0_3px_rgba(148,163,184,0.14)]'
  return 'bg-slate-300'
}

function sortSessions(items: PatientSession[]) {
  const toMillis = (value?: string | null) => (value ? dayjs(value).valueOf() : 0)
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
    const pinnedDiff = toMillis(b.pinned_at) - toMillis(a.pinned_at)
    if (pinnedDiff !== 0) return pinnedDiff
    const messageDiff = toMillis(b.last_message_at || b.updated_at || b.created_at) - toMillis(a.last_message_at || a.updated_at || a.created_at)
    if (messageDiff !== 0) return messageDiff
    return b.id - a.id
  })
}

export default function SessionListPage() {
  const [sessions, setSessions] = useState<PatientSession[]>([])
  const [loading, setLoading] = useState(true)
  const [pinningId, setPinningId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [pendingDeleteSession, setPendingDeleteSession] = useState<PatientSession | null>(null)
  const nav = useNavigate()

  const load = async () => {
    setLoading(true)
    try { setSessions(sortSessions(await sessionApi.list())) }
    catch (e) { toast.error(toErrorMessage(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const togglePinned = async (event: MouseEvent<HTMLButtonElement>, session: PatientSession) => {
    event.stopPropagation()
    if (pinningId || deletingId) return
    setPinningId(session.id)
    try {
      const res = await sessionApi.setPinned(session.id, !session.is_pinned)
      setSessions((prev) =>
        sortSessions(prev.map((item) => (item.id === session.id ? res.data : item)))
      )
      toast.success(res.message)
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      setPinningId(null)
    }
  }

  const removeSession = async (event: MouseEvent<HTMLButtonElement>, session: PatientSession) => {
    event.stopPropagation()
    if (pinningId || deletingId) return
    setPendingDeleteSession(session)
  }

  const confirmRemoveSession = async () => {
    if (!pendingDeleteSession) return
    setDeletingId(pendingDeleteSession.id)
    try {
      const res = await sessionApi.remove(pendingDeleteSession.id)
      setSessions((prev) => prev.filter((item) => item.id !== pendingDeleteSession.id))
      toast.success(res.message || '会话已删除')
      setPendingDeleteSession(null)
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 pt-6 pb-[calc(var(--safe-bottom)+16px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">问诊记录</h1>
          <p className="text-xs text-slate-400 mt-0.5">点击继续对话</p>
        </div>
        <button onClick={load} className="w-9 h-9 rounded-xl bg-frost-50 flex items-center justify-center text-frost-500 active:scale-95 transition-transform">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-frost-400" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-20 text-center">
          <MessageSquare className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">暂无问诊记录</p>
          <p className="text-xs text-slate-300 mt-1">去"找医生"页面开始第一次问诊</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => nav(`/chat/${s.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  nav(`/chat/${s.id}`)
                }
              }}
              role="button"
              tabIndex={0}
              className="glass w-full text-left p-4 flex items-center gap-3.5 active:scale-[0.98] transition-transform cursor-pointer"
            >
              {/* 医生头像 */}
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-frost-100 to-aurora-50 flex items-center justify-center flex-shrink-0">
                {s.doctor.avatar ? (
                  <img src={s.doctor.avatar} alt="" className="w-full h-full rounded-xl object-cover" />
                ) : (
                  <UserCircle className="w-5.5 h-5.5 text-frost-400" />
                )}
              </div>

              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <h3 className="text-sm font-semibold text-slate-800 truncate">{s.title || `问诊 #${s.id}`}</h3>
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusDotClass(s.status)}`}
                    title={s.status === 'active' ? '会话进行中' : s.status === 'archived' ? '会话已归档' : s.status}
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Stethoscope className="w-3 h-3 text-slate-300" />
                  <span className="text-[11px] text-slate-400 truncate">
                    {s.doctor.nickname || s.doctor.username}
                    {s.doctor.profession ? ` · ${s.doctor.profession}` : ''}
                  </span>
                </div>
                <p className="text-[10px] text-slate-300 mt-0.5">
                  {s.last_message_at ? dayjs(s.last_message_at).format('MM-DD HH:mm') : dayjs(s.created_at).format('MM-DD HH:mm')}
                </p>
              </div>

              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    onClick={(event) => togglePinned(event, s)}
                    disabled={pinningId === s.id || deletingId === s.id}
                    className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-50 ${
                      s.is_pinned
                        ? 'border-frost-200 bg-frost-50 text-frost-600'
                        : 'border-slate-200 text-slate-400 hover:text-frost-500 hover:border-frost-200'
                    }`}
                    title={s.is_pinned ? '取消置顶' : '置顶会话'}
                  >
                    {pinningId === s.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : s.is_pinned ? (
                      <Pin className="w-3.5 h-3.5" />
                    ) : (
                      <Pin className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={(event) => removeSession(event, s)}
                    disabled={deletingId === s.id || pinningId === s.id}
                    className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 flex items-center justify-center transition-colors disabled:opacity-50"
                    title="删除会话"
                  >
                    {deletingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300" />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {pendingDeleteSession && (
          <motion.div
            className="fixed inset-0 z-50 bg-slate-900/28 backdrop-blur-[1px] px-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (deletingId !== pendingDeleteSession.id) setPendingDeleteSession(null)
            }}
          >
            <motion.div
              className="w-full max-w-sm glass-strong rounded-2xl p-4 shadow-[0_20px_50px_rgba(15,23,42,0.2)]"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="text-[15px] font-semibold text-slate-800">删除会话</h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                确认删除“{pendingDeleteSession.title || `问诊 #${pendingDeleteSession.id}`}”吗？删除后将不再显示在问诊记录中。
              </p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => setPendingDeleteSession(null)}
                  disabled={deletingId === pendingDeleteSession.id}
                  className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-500 text-sm font-medium disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={confirmRemoveSession}
                  disabled={deletingId === pendingDeleteSession.id}
                  className="flex-1 h-10 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {deletingId === pendingDeleteSession.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
