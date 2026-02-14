import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { toast } from 'sonner'
import { Loader2, Mail, MessageSquareText, UserPlus } from 'lucide-react'

type Channel = 'sms' | 'email'

const PHONE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const inputClass =
  'w-full h-10 rounded-xl bg-white/[0.07] border border-white/[0.12] px-3.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ice-400/40 focus:border-ice-400/40 transition-all'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { sendCode, registerByCode, setPendingMessage } = useAuthStore()
  const [channel, setChannel] = useState<Channel>('sms')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [form, setForm] = useState({
    target: '',
    code: '',
    nickname: '',
    institution: '北医三院崇礼院区',
    profession: '运动医学',
  })

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((prev) => Math.max(0, prev - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  const targetLabel = useMemo(() => (channel === 'sms' ? '手机号' : '邮箱'), [channel])
  const targetPlaceholder = useMemo(
    () => (channel === 'sms' ? '用于注册与登录的手机号' : '用于注册与登录的邮箱'),
    [channel],
  )
  const normalizedTarget = useMemo(() => form.target.trim(), [form.target])

  const validateTarget = () => {
    if (!normalizedTarget) {
      toast.warning(`请填写${targetLabel}`)
      return false
    }
    if (channel === 'sms' && !PHONE_RE.test(normalizedTarget)) {
      toast.warning('手机号格式不正确')
      return false
    }
    if (channel === 'email' && !EMAIL_RE.test(normalizedTarget)) {
      toast.warning('邮箱格式不正确')
      return false
    }
    return true
  }

  const handleSendCode = async () => {
    if (!validateTarget()) return
    if (countdown > 0) return
    setSendingCode(true)
    try {
      const result = await sendCode(channel, normalizedTarget)
      setForm((prev) => ({ ...prev, target: result.target }))
      setCountdown(60)
      toast.success('验证码已发送')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateTarget()) return
    if (!form.nickname.trim()) {
      toast.warning('请填写医生昵称')
      return
    }
    if (!form.code.trim() || form.code.trim().length < 4) {
      toast.warning('请输入正确验证码')
      return
    }

    setLoading(true)
    try {
      const msg = await registerByCode({
        channel,
        target: normalizedTarget,
        code: form.code.trim(),
        nickname: form.nickname.trim(),
        institution: form.institution.trim() || undefined,
        profession: form.profession.trim() || undefined,
      })
      toast.success(msg)
      setPendingMessage(msg)
      navigate('/auth/pending')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const tabClass = (active: boolean) => (
    `h-10 rounded-xl text-sm font-medium transition-all ${
      active
        ? 'bg-gradient-to-r from-ice-500 to-ice-600 text-white shadow-lg shadow-ice-500/20'
        : 'bg-white/[0.06] border border-white/[0.12] text-ice-200/70 hover:text-ice-200'
    }`
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-1">
        <h2 className="text-xl font-bold text-white">医生注册申请</h2>
        <p className="text-sm text-ice-200/50 mt-1">验证码校验后进入审核队列</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setChannel('sms')} className={tabClass(channel === 'sms')}>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareText className="w-4 h-4" />
            短信
          </span>
        </button>
        <button type="button" onClick={() => setChannel('email')} className={tabClass(channel === 'email')}>
          <span className="inline-flex items-center gap-1.5">
            <Mail className="w-4 h-4" />
            邮件
          </span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">{targetLabel}</label>
          <input
            type="text"
            value={form.target}
            onChange={set('target')}
            className={inputClass}
            placeholder={targetPlaceholder}
            autoComplete={channel === 'sms' ? 'tel' : 'email'}
            inputMode={channel === 'sms' ? 'tel' : 'email'}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">验证码</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={form.code}
              onChange={set('code')}
              className={`${inputClass} flex-1`}
              placeholder="请输入验证码"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <button
              type="button"
              onClick={() => void handleSendCode()}
              disabled={sendingCode || countdown > 0}
              className="h-10 px-3 rounded-xl border border-white/[0.12] bg-white/[0.06] text-xs font-medium text-ice-200/80 hover:bg-white/[0.1] disabled:opacity-50"
            >
              {sendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '发送验证码'}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">昵称</label>
          <input type="text" value={form.nickname} onChange={set('nickname')} className={inputClass} placeholder="如：张医生" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">机构</label>
          <input type="text" value={form.institution} onChange={set('institution')} className={inputClass} placeholder="所属机构" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-ice-200/60 mb-1">科室 / 专业</label>
          <input type="text" value={form.profession} onChange={set('profession')} className={inputClass} placeholder="如：运动医学" />
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
