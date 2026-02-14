import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { Loader2, LogIn, Mail, MessageSquareText } from 'lucide-react'

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
      if (measured > 0) {
        setSocialButtonWidth(measured)
      }
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => {
        window.removeEventListener('resize', updateWidth)
      }
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
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
              toast.success('Google 登录成功')
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
      return () => {
        cancelled = true
      }
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleGsi = '1'
    script.onload = renderGoogleButton
    script.onerror = () => {
      if (!cancelled) {
        toast.error('Google 登录脚本加载失败')
      }
    }
    document.head.appendChild(script)
    return () => {
      cancelled = true
    }
  }, [googleClientId, loginByGoogle, nav, socialButtonWidth])

  const targetLabel = useMemo(() => (channel === 'sms' ? '手机号' : '邮箱'), [channel])
  const targetPlaceholder = useMemo(
    () => (channel === 'sms' ? '请输入 11 位手机号' : '请输入邮箱地址'),
    [channel],
  )

  const normalizedTarget = useMemo(() => target.trim(), [target])
  const hasSocialLogin = Boolean(googleClientId)

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

      {hasSocialLogin && (
        <div className="pt-1">
          <div className="relative mb-3">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200/80" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white/70 px-2 text-[11px] text-slate-400">Google login</span>
            </div>
          </div>
          <div
            ref={socialButtonsRef}
            className="w-full mx-auto"
            style={{ maxWidth: `${SOCIAL_LOGIN_MAX_WIDTH}px` }}
          >
            <div ref={googleButtonRef} className="w-full min-h-[40px]" />
          </div>
          {!googleReady && (
            <p className="text-center text-[11px] text-slate-400 mt-1">
              正在加载 Google 登录…
            </p>
          )}
          {googleBusy && (
            <p className="text-center text-[11px] text-frost-500 mt-1">Google 登录处理中…</p>
          )}
        </div>
      )}
    </form>
  )
}
