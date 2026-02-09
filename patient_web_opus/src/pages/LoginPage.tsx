import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { Loader2, LogIn } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)
  const nav = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) { toast.warning('请填写账号和密码'); return }
    setLoading(true)
    try {
      await login(username.trim(), password)
      toast.success('登录成功')
      nav('/doctors', { replace: true })
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="text-center mb-2">
        <h2 className="text-lg font-bold text-slate-800">患者登录</h2>
        <p className="text-xs text-slate-400 mt-1">登录后即可与 AI 医生问诊</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">账号</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white/80 transition-all"
          placeholder="用户名"
          autoComplete="username"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white/80 transition-all"
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full h-12 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
        {loading ? '登录中…' : '登 录'}
      </button>

      <p className="text-center text-xs text-slate-400">
        还没有账号？
        <Link to="/auth/register" className="text-frost-600 font-medium ml-1 hover:underline">立即注册</Link>
      </p>
    </form>
  )
}
