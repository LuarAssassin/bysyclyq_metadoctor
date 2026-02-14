import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { toast } from 'sonner'
import { Loader2, LogIn, Mail, MessageSquareText } from 'lucide-react'
import { getLastUsername } from '@/lib/storage'

type Channel = 'sms' | 'email'

const PHONE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { sendCode, loginByCode, setPendingMessage } = useAuthStore()
  const [channel, setChannel] = useState<Channel>('sms')
  const [target, setTarget] = useState(getLastUsername())
  const [code, setCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((prev) => Math.max(0, prev - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const targetLabel = useMemo(() => (channel === 'sms' ? '手机号' : '邮箱'), [channel])
  const targetPlaceholder = useMemo(
    () => (channel === 'sms' ? '请输入 11 位手机号' : '请输入邮箱地址'),
    [channel],
  )
  const normalizedTarget = useMemo(() => target.trim(), [target])

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
      setTarget(result.target)
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
    if (!code.trim() || code.trim().length < 4) {
      toast.warning('请输入正确验证码')
      return
    }

    setLoading(true)
    try {
      await loginByCode({
        channel,
        target: normalizedTarget,
        code: code.trim(),
      })
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

  const inputClass =
    'w-full h-11 rounded-xl bg-white/[0.07] border border-white/[0.12] px-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ice-400/40 focus:border-ice-400/40 transition-all'

  const tabClass = (active: boolean) => (
    `h-10 rounded-xl text-sm font-medium transition-all ${
      active
        ? 'bg-gradient-to-r from-ice-500 to-ice-600 text-white shadow-lg shadow-ice-500/20'
        : 'bg-white/[0.06] border border-white/[0.12] text-ice-200/70 hover:text-ice-200'
    }`
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-white">医生接码登录</h2>
        <p className="text-sm text-ice-200/50 mt-1">审核通过的医生账号可进入系统</p>
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

      <div className="space-y-3.5">
        <div>
          <label className="block text-xs font-medium text-ice-200/60 mb-1.5">{targetLabel}</label>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
            placeholder={targetPlaceholder}
            autoComplete={channel === 'sms' ? 'tel' : 'email'}
            inputMode={channel === 'sms' ? 'tel' : 'email'}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ice-200/60 mb-1.5">验证码</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} flex-1`}
              placeholder="请输入验证码"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <button
              type="button"
              onClick={() => void handleSendCode()}
              disabled={sendingCode || countdown > 0}
              className="h-11 px-3 rounded-xl border border-white/[0.12] bg-white/[0.06] text-xs font-medium text-ice-200/80 hover:bg-white/[0.1] disabled:opacity-50"
            >
              {sendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '发送验证码'}
            </button>
          </div>
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
