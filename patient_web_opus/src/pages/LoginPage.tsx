import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { Loader2, Mail, Smartphone } from 'lucide-react'

type Channel = 'sms' | 'email'

const PHONE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOCIAL_LOGIN_MAX_WIDTH = 360

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
        }
      }
    }
  }
}

export default function LoginPage() {
  const [channel, setChannel] = useState<Channel>('sms')
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [showNickname, setShowNickname] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [socialButtonWidth, setSocialButtonWidth] = useState(320)
  const sendCode = useAuthStore((s) => s.sendCode)
  const loginByCode = useAuthStore((s) => s.loginByCode)
  const loginByGoogle = useAuthStore((s) => s.loginByGoogle)
  const nav = useNavigate()
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const socialButtonsRef = useRef<HTMLDivElement | null>(null)
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((prev) => Math.max(0, prev - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  useEffect(() => {
    if (!googleClientId) return
    const container = socialButtonsRef.current
    if (!container) return

    const updateWidth = () => {
      const measured = Math.floor(container.getBoundingClientRect().width)
      if (measured > 0) setSocialButtonWidth(measured)
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [googleClientId])

  useEffect(() => {
    if (!googleClientId) return
    let cancelled = false

    const renderGoogleButton = () => {
      if (cancelled) return
      const googleId = window.google?.accounts?.id
      const mount = googleButtonRef.current
      if (!googleId || !mount) return
      googleId.initialize({
        client_id: googleClientId,
        callback: (response: Record<string, unknown>) => {
          const credential = String(response?.credential || '').trim()
          if (!credential) {
            toast.error('Google 登录凭证为空，请重试')
            return
          }
          setGoogleBusy(true)
          void loginByGoogle(credential)
            .then(() => {
              toast.success('登录成功')
              nav('/doctors', { replace: true })
            })
            .catch((err) => {
              toast.error(toErrorMessage(err))
            })
            .finally(() => {
              if (!cancelled) setGoogleBusy(false)
            })
        },
        cancel_on_tap_outside: true,
      })
      mount.innerHTML = ''
      googleId.renderButton(mount, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        width: socialButtonWidth,
        locale: 'zh-CN',
      })
      setGoogleReady(true)
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-gsi="1"]')
    if (existing) {
      if (window.google?.accounts?.id) {
        renderGoogleButton()
      } else {
        existing.addEventListener('load', renderGoogleButton, { once: true })
      }
      return () => { cancelled = true }
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleGsi = '1'
    script.onload = renderGoogleButton
    script.onerror = () => {
      if (!cancelled) toast.error('Google 登录脚本加载失败')
    }
    document.head.appendChild(script)
    return () => { cancelled = true }
  }, [googleClientId, loginByGoogle, nav, socialButtonWidth])

  const targetLabel = useMemo(() => (channel === 'sms' ? '手机号' : '邮箱'), [channel])
  const normalizedTarget = useMemo(() => target.trim(), [target])
  const hasSocialLogin = Boolean(googleClientId)

  const validateTarget = () => {
    if (!normalizedTarget) {
      toast.warning(`请输入${targetLabel}`)
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

  const inputCls =
    'w-full h-11 rounded-xl border border-slate-200 px-4 text-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-frost-300 focus:border-transparent bg-white/80 transition-all'

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      {/* Channel tabs */}
      <div className="flex rounded-xl bg-slate-100/80 p-1 gap-1">
        {(['sms', 'email'] as const).map((ch) => (
          <button
            key={ch}
            type="button"
            onClick={() => setChannel(ch)}
            className={`flex-1 h-9 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
              channel === ch
                ? 'bg-white text-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-500'
            }`}
          >
            {ch === 'sms' ? <Smartphone className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
            {ch === 'sms' ? '手机号' : '邮箱'}
          </button>
        ))}
      </div>

      {/* Target input */}
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className={inputCls}
        placeholder={channel === 'sms' ? '请输入手机号' : '请输入邮箱'}
        autoComplete={channel === 'sms' ? 'tel' : 'email'}
        inputMode={channel === 'sms' ? 'tel' : 'email'}
      />

      {/* Code input + send button */}
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${inputCls} flex-1`}
          placeholder="验证码"
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <button
          type="button"
          onClick={() => void handleSendCode()}
          disabled={sendingCode || countdown > 0}
          className="shrink-0 h-11 px-4 rounded-xl text-sm font-medium transition-all disabled:opacity-40 bg-frost-50 text-frost-600 hover:bg-frost-100 active:scale-[0.97]"
        >
          {sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s` : '获取验证码'}
        </button>
      </div>

      {/* Optional nickname (collapsed by default) */}
      {!showNickname ? (
        <button
          type="button"
          onClick={() => setShowNickname(true)}
          className="text-xs text-slate-400 hover:text-slate-500 transition-colors"
        >
          设置昵称（可选）
        </button>
      ) : (
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className={inputCls}
          placeholder="昵称（可选，不填自动生成）"
          autoFocus
        />
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full h-12 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? '登录中…' : '登 录'}
      </button>

      {/* Google login */}
      {hasSocialLogin && (
        <div className="pt-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-slate-200/80" />
            <span className="text-[11px] text-slate-300">其他方式</span>
            <div className="flex-1 h-px bg-slate-200/80" />
          </div>
          <div
            ref={socialButtonsRef}
            className="w-full mx-auto"
            style={{ maxWidth: `${SOCIAL_LOGIN_MAX_WIDTH}px` }}
          >
            <div ref={googleButtonRef} className="w-full min-h-[40px]" />
          </div>
          {!googleReady && (
            <p className="text-center text-[11px] text-slate-300 mt-1">正在加载…</p>
          )}
          {googleBusy && (
            <p className="text-center text-[11px] text-frost-500 mt-1">处理中…</p>
          )}
        </div>
      )}
    </form>
  )
}
