import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Clock, MoveLeft, ShieldAlert, Snowflake } from 'lucide-react'
import { motion } from 'framer-motion'

export default function PendingPage() {
  const pendingMessage = useAuthStore((s) => s.pendingMessage)

  return (
    <div className="text-center space-y-5">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-500/10 border border-amber-400/20 flex items-center justify-center"
      >
        <Clock className="w-7 h-7 text-amber-400" />
      </motion.div>

      <div>
        <h2 className="text-xl font-bold text-white">账号审核处理中</h2>
        <p className="text-sm text-ice-200/50 mt-2 max-w-xs mx-auto leading-relaxed">
          {pendingMessage || '医生账号审核中，审核通过后才能登录。'}
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-4 text-left space-y-2.5">
        <div className="flex items-start gap-2.5">
          <Snowflake className="w-4 h-4 text-ice-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-ice-200/60">审核通过后可直接登录医生端工作台。</p>
        </div>
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-ice-200/60">若长时间未通过，请联系平台管理员。</p>
        </div>
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-ice-200/60">该机制用于拦截未经许可的账号接入。</p>
        </div>
      </div>

      <Link
        to="/auth/login"
        className="inline-flex items-center gap-2 text-sm text-ice-300 hover:text-ice-200 font-medium transition-colors"
      >
        <MoveLeft className="w-4 h-4" />
        返回登录页
      </Link>
    </div>
  )
}
