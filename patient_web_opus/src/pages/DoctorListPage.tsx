import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { doctorApi, sessionApi } from '@/lib/api'
import { toErrorMessage } from '@/lib/http'
import type { DoctorInfo } from '@/types/api'
import { cn } from '@/lib/cn'
import {
  Building2,
  ChevronRight,
  Loader2,
  MessageCirclePlus,
  RefreshCw,
  Stethoscope,
  UserCircle,
} from 'lucide-react'
import { motion } from 'framer-motion'

export default function DoctorListPage() {
  const [doctors, setDoctors] = useState<DoctorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<number | null>(null)
  const nav = useNavigate()

  const load = async () => {
    setLoading(true)
    try { setDoctors(await doctorApi.list()) }
    catch (e) { toast.error(toErrorMessage(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const startConsult = async (doc: DoctorInfo) => {
    setCreating(doc.id)
    try {
      const res = await sessionApi.create(doc.id)
      toast.success(res.message)
      nav(`/chat/${res.data.id}`)
    } catch (e) { toast.error(toErrorMessage(e)) }
    finally { setCreating(null) }
  }

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">找医生</h1>
          <p className="text-xs text-slate-400 mt-0.5">选择医生开始 AI 问诊</p>
        </div>
        <button onClick={load} className="w-9 h-9 rounded-xl bg-frost-50 flex items-center justify-center text-frost-500 active:scale-95 transition-transform">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Doctor Cards */}
      {loading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-frost-400" />
          <p className="text-xs text-slate-400 mt-3">加载中…</p>
        </div>
      ) : doctors.length === 0 ? (
        <div className="py-20 text-center">
          <Stethoscope className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">暂无可用医生</p>
          <p className="text-xs text-slate-300 mt-1">请稍后再试</p>
        </div>
      ) : (
        <div className="space-y-3">
          {doctors.map((doc, i) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="glass p-4"
            >
              <div className="flex items-start gap-3.5">
                {/* 头像 */}
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-frost-100 to-aurora-50 flex items-center justify-center flex-shrink-0">
                  {doc.avatar ? (
                    <img src={doc.avatar} alt="" className="w-full h-full rounded-2xl object-cover" />
                  ) : (
                    <UserCircle className="w-7 h-7 text-frost-400" />
                  )}
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-slate-800">{doc.nickname || doc.username}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {doc.profession && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-frost-600 bg-frost-50 px-2 py-0.5 rounded-lg">
                        <Stethoscope className="w-3 h-3" /> {doc.profession}
                      </span>
                    )}
                    {doc.institution && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <Building2 className="w-3 h-3" /> {doc.institution}
                      </span>
                    )}
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />
              </div>

              {/* 操作 */}
              <button
                onClick={() => startConsult(doc)}
                disabled={creating === doc.id}
                className={cn(
                  'btn-primary w-full h-11 mt-3.5 text-sm flex items-center justify-center gap-2',
                  creating === doc.id && 'opacity-60'
                )}
              >
                {creating === doc.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MessageCirclePlus className="w-4 h-4" />
                )}
                {creating === doc.id ? '创建会话中…' : '开始问诊'}
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
