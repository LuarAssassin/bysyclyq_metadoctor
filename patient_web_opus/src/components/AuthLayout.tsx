import { Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Stethoscope } from 'lucide-react'
import Snowfall from './Snowfall'

export default function AuthLayout() {
  return (
    <div className="auth-bg relative flex flex-col items-center justify-center px-5 py-10 overflow-hidden">
      <Snowfall />

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center mb-8"
      >
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-frost-400 to-frost-600 flex items-center justify-center shadow-float mb-3">
          <Stethoscope className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 tracking-tight">元宇宙医生智能体</h1>
        <p className="text-xs text-slate-500/80 mt-1 font-medium tracking-wide">北医三院崇礼院区</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.15 }}
        className="relative z-10 glass-strong w-full max-w-sm px-6 py-6"
      >
        <Outlet />
      </motion.div>

      <p className="relative z-10 mt-8 text-[10px] text-slate-400 text-center">
        © 2026 北京大学第三医院 · 崇礼院区
      </p>
    </div>
  )
}
