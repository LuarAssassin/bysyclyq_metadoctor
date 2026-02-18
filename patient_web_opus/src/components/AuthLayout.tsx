import { Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Stethoscope } from 'lucide-react'

export default function AuthLayout() {
  return (
    <div className="auth-bg flex flex-col items-center justify-center px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center mb-8"
      >
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-frost-400 to-frost-600 flex items-center justify-center shadow-float mb-3">
          <Stethoscope className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 tracking-tight">智能问诊</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">北医三院 · 元宇宙医生</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.15 }}
        className="glass-strong w-full max-w-sm px-6 py-6"
      >
        <Outlet />
      </motion.div>

      <p className="mt-8 text-[10px] text-slate-300 text-center">
        © 2026 北京大学第三医院 · 崇礼院区
      </p>
    </div>
  )
}
