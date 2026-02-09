import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { LogOut, Snowflake, UserCircle } from 'lucide-react'

export default function ProfilePage() {
  const { username, logout } = useAuthStore()
  const nav = useNavigate()

  const handleLogout = () => {
    logout()
    nav('/auth/login', { replace: true })
  }

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-slate-800 mb-5">我的</h1>

      {/* Profile Card */}
      <div className="glass p-5 flex items-center gap-4 mb-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-frost-400 to-aurora-400 flex items-center justify-center">
          <UserCircle className="w-7 h-7 text-white" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800">{username || '患者用户'}</h2>
          <p className="text-xs text-slate-400 mt-0.5">智能问诊患者端</p>
        </div>
      </div>

      {/* Info */}
      <div className="glass p-4 space-y-3 mb-4">
        <div className="flex items-center gap-3">
          <Snowflake className="w-4 h-4 text-frost-400" />
          <div>
            <p className="text-xs font-medium text-slate-600">关于</p>
            <p className="text-[11px] text-slate-400">北医三院元宇宙智能体 · 患者端 v1.0</p>
          </div>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full h-12 rounded-2xl border border-petal-200 text-petal-500 font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-all hover:bg-petal-50"
      >
        <LogOut className="w-4 h-4" /> 退出登录
      </button>
    </div>
  )
}
