import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { Loader2, UserPlus } from 'lucide-react'

export default function RegisterPage() {
  const [form, setForm] = useState({ username: '', password: '', confirm: '', nickname: '', phone: '' })
  const [loading, setLoading] = useState(false)
  const register = useAuthStore((s) => s.register)
  const login = useAuthStore((s) => s.login)
  const nav = useNavigate()

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.username.trim() || !form.password) { toast.warning('请填写必填项'); return }
    if (form.password.length < 6) { toast.warning('密码至少 6 位'); return }
    if (form.password !== form.confirm) { toast.warning('两次密码不一致'); return }
    setLoading(true)
    try {
      await register({
        username: form.username.trim(),
        password: form.password,
        nickname: form.nickname.trim() || undefined,
        phone: form.phone.trim() || undefined,
      })
      toast.success('注册成功，正在自动登录…')
      await login(form.username.trim(), form.password)
      nav('/doctors', { replace: true })
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally { setLoading(false) }
  }

  const inputCls = 'w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white/80 transition-all'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-1">
        <h2 className="text-lg font-bold text-slate-800">患者注册</h2>
        <p className="text-xs text-slate-400 mt-1">注册后直接可用，无需审核</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">用户名 <span className="text-petal-400">*</span></label>
        <input value={form.username} onChange={set('username')} className={inputCls} placeholder="用于登录" autoComplete="username" />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">密码 <span className="text-petal-400">*</span></label>
        <input type="password" value={form.password} onChange={set('password')} className={inputCls} placeholder="至少 6 位" autoComplete="new-password" />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">确认密码 <span className="text-petal-400">*</span></label>
        <input type="password" value={form.confirm} onChange={set('confirm')} className={inputCls} placeholder="再次输入密码" autoComplete="new-password" />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">昵称</label>
        <input value={form.nickname} onChange={set('nickname')} className={inputCls} placeholder="可选，方便称呼" />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">手机号</label>
        <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="可选" inputMode="tel" />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full h-12 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        {loading ? '注册中…' : '注册并登录'}
      </button>

      <p className="text-center text-xs text-slate-400">
        已有账号？
        <Link to="/auth/login" className="text-frost-600 font-medium ml-1 hover:underline">去登录</Link>
      </p>
    </form>
  )
}
