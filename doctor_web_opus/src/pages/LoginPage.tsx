import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { toast } from 'sonner'
import { Loader2, LogIn } from 'lucide-react'
import { getLastUsername } from '@/lib/storage'

export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { login, setPendingMessage } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ username: getLastUsername(), password: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.username || !form.password) { toast.warning('请输入用户名和密码'); return }

    setLoading(true)
    try {
      await login(form.username, form.password)
      toast.success('登录成功，欢迎回来')
      const redirect = params.get('redirect') || '/knowledge'
      navigate(redirect, { replace: true })
    } catch (err) {
      const msg = toErrorMessage(err)
      if (msg.includes('审核') || msg.includes('未通过')) {
        setPendingMessage(msg)
        navigate('/auth/pending')
        return
      }
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-white">医生登录</h2>
        <p className="text-sm text-ice-200/50 mt-1">审核通过的医生账号可进入系统</p>
      </div>

      <div className="space-y-3.5">
        <div>
          <label className="block text-xs font-medium text-ice-200/60 mb-1.5">用户名</label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
            className="w-full h-11 rounded-xl bg-white/[0.07] border border-white/[0.12] px-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ice-400/40 focus:border-ice-400/40 transition-all"
            placeholder="请输入用户名"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ice-200/60 mb-1.5">密码</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            className="w-full h-11 rounded-xl bg-white/[0.07] border border-white/[0.12] px-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ice-400/40 focus:border-ice-400/40 transition-all"
            placeholder="请输入密码"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 rounded-xl bg-gradient-to-r from-ice-500 to-ice-600 text-white text-sm font-semibold shadow-lg shadow-ice-500/25 hover:shadow-ice-500/40 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
        {loading ? '登录中...' : '登录并进入工作台'}
      </button>

      <p className="text-center text-sm text-ice-200/40">
        还没有账号？{' '}
        <Link to="/auth/register" className="text-ice-300 hover:text-ice-200 font-medium transition-colors">
          提交注册申请
        </Link>
      </p>
    </form>
  )
}
