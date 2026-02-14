import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { Loader2, LogIn, Mail, MessageSquareText } from 'lucide-react'

type Channel = 'sms' | 'email'

const PHONE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const [channel, setChannel] = useState<Channel>('sms')
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const sendCode = useAuthStore((s) => s.sendCode)
  const loginByCode = useAuthStore((s) => s.loginByCode)
  const nav = useNavigate()

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
        nickname: nickname.trim() || undefined,
      })
      toast.success('登录成功')
      nav('/doctors', { replace: true })
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white/80 transition-all'
  const tabCls = (active: boolean) => (
    `h-10 rounded-xl text-sm font-medium transition-all ${
      active
        ? 'bg-frost-500 text-white shadow-sm'
        : 'bg-white/70 text-slate-500 border border-slate-200 hover:bg-white'
    }`
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-1">
        <h2 className="text-lg font-bold text-slate-800">患者接码登录</h2>
        <p className="text-xs text-slate-400 mt-1">支持短信或邮件验证码登录</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setChannel('sms')}
          className={tabCls(channel === 'sms')}
        >
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareText className="w-4 h-4" />
            短信
          </span>
        </button>
        <button
          type="button"
          onClick={() => setChannel('email')}
          className={tabCls(channel === 'email')}
        >
          <span className="inline-flex items-center gap-1.5">
            <Mail className="w-4 h-4" />
            邮件
          </span>
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">{targetLabel}</label>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={inputCls}
          placeholder={targetPlaceholder}
          autoComplete={channel === 'sms' ? 'tel' : 'email'}
          inputMode={channel === 'sms' ? 'tel' : 'email'}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">验证码</label>
        <div className="flex items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputCls} flex-1`}
            placeholder="请输入验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <button
            type="button"
            onClick={() => void handleSendCode()}
            disabled={sendingCode || countdown > 0}
            className="h-11 px-3 rounded-xl border border-slate-200 bg-white/80 text-xs font-medium text-slate-600 hover:bg-white disabled:opacity-50"
          >
            {sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s` : '发送验证码'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">昵称（首次登录可选）</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className={inputCls}
          placeholder="不填将自动生成"
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
    </form>
  )
}
