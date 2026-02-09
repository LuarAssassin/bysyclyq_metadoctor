import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { sessionApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import type { PatientSession } from '@/types/api'
import {
  ChevronRight,
  Loader2,
  MessageSquare,
  RefreshCw,
  Stethoscope,
  UserCircle,
} from 'lucide-react'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'

export default function SessionListPage() {
  const [sessions, setSessions] = useState<PatientSession[]>([])
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  const load = async () => {
    setLoading(true)
    try { setSessions(await sessionApi.list()) }
    catch (e) { toast.error(toErrorMessage(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="px-4 pt-6 pb-4">
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
        <div className="space-y-2.5">
          {sessions.map((s, i) => (
            <motion.button
              key={s.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => nav(`/chat/${s.id}`)}
              className="glass w-full text-left p-4 flex items-center gap-3 active:scale-[0.98] transition-transform"
            >
              {/* 医生头像 */}
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-frost-100 to-aurora-50 flex items-center justify-center flex-shrink-0">
                <UserCircle className="w-5.5 h-5.5 text-frost-400" />
              </div>

              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800 truncate">{s.title || `问诊 #${s.id}`}</h3>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${s.status === 'active' ? 'bg-aurora-50 text-aurora-600' : 'bg-slate-100 text-slate-400'}`}>
                    {s.status === 'active' ? '进行中' : s.status}
                  </span>
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

              <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </motion.button>
          ))}
        </div>
      )}
    </div>
  )
}
