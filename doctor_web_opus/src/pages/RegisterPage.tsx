import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { toast } from 'sonner'
import { Loader2, UserPlus } from 'lucide-react'

const inputClass =
  'w-full h-10 rounded-xl bg-white/[0.07] border border-white/[0.12] px-3.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ice-400/40 focus:border-ice-400/40 transition-all'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register, setPendingMessage } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    username: '', password: '', confirmPassword: '',
    email: '', phone: '', nickname: '',
    institution: '北医三院崇礼院区', profession: '运动医学',
  })

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.username || !form.password || !form.email || !form.phone || !form.nickname) {
      toast.warning('请完整填写注册信息'); return
    }
    if (form.password.length < 6) { toast.warning('密码长度至少 6 位'); return }
    if (form.password !== form.confirmPassword) { toast.warning('两次密码输入不一致'); return }

    setLoading(true)
    try {
      const msg = await register({
        username: form.username,
        password: form.password,
        email: form.email,
        phone: form.phone,
        nickname: form.nickname,
        institution: form.institution,
        profession: form.profession,
      })
      toast.success('申请已提交，等待审核')
      setPendingMessage(msg)
      navigate('/auth/pending')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-1">
        <h2 className="text-xl font-bold text-white">医生注册申请</h2>
        <p className="text-sm text-ice-200/50 mt-1">提交资质后进入审核队列</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">用户名</label>
          <input type="text" value={form.username} onChange={set('username')} className={inputClass} placeholder="登录用户名" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">昵称</label>
          <input type="text" value={form.nickname} onChange={set('nickname')} className={inputClass} placeholder="如：张医生" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">邮箱</label>
          <input type="email" value={form.email} onChange={set('email')} className={inputClass} placeholder="email@example.com" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">手机号</label>
          <input type="tel" value={form.phone} onChange={set('phone')} className={inputClass} placeholder="13800001111" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">机构</label>
          <input type="text" value={form.institution} onChange={set('institution')} className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">科室 / 专业</label>
          <input type="text" value={form.profession} onChange={set('profession')} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">密码</label>
          <input type="password" value={form.password} onChange={set('password')} className={inputClass} placeholder="至少 6 位" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">确认密码</label>
          <input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} className={inputClass} placeholder="再次输入" />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 rounded-xl bg-gradient-to-r from-ice-500 to-ice-600 text-white text-sm font-semibold shadow-lg shadow-ice-500/25 hover:shadow-ice-500/40 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        {loading ? '提交中...' : '提交医生申请'}
      </button>

      <p className="text-center text-sm text-ice-200/40">
        已有账号？{' '}
        <Link to="/auth/login" className="text-ice-300 hover:text-ice-200 font-medium transition-colors">
          返回登录
        </Link>
      </p>
    </form>
  )
}
