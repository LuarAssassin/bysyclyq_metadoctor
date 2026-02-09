import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Mountain, Snowflake } from 'lucide-react'
import { motion } from 'framer-motion'

export default function AuthLayout() {
  const isAuth = useAuthStore((s) => s.isAuthenticated)
  if (isAuth) return <Navigate to="/knowledge" replace />

  return (
    <div className="auth-bg flex items-center justify-center p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[480px]"
      >
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-ice-400 to-ice-600 flex items-center justify-center shadow-lg shadow-ice-500/20">
              <Mountain className="w-5 h-5 text-white" />
            </div>
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
              <Snowflake className="w-5 h-5 text-ice-300" />
            </div>
          </div>
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-ice-300/70 mb-1">
            Peking University Third Hospital · Chongli
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            医生元宇宙智能体
          </h1>
          <p className="text-sm text-ice-200/60 mt-2 max-w-sm mx-auto">
            知识沉淀 · 数字人素材 · 叙事底座 · AI 问诊演练
          </p>
        </div>

        {/* Glass Form Card */}
        <div className="rounded-3xl border border-white/15 bg-white/[0.08] backdrop-blur-xl shadow-2xl shadow-black/20 p-6 sm:p-8">
          <Outlet />
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-ice-300/40 mt-5">
          北医三院崇礼院区 · 冰雪运动医学中心
        </p>
      </motion.div>
    </div>
  )
}
