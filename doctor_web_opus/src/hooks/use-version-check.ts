import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

const POLL_INTERVAL = 60_000

export function useVersionCheck() {
  const notified = useRef(false)

  useEffect(() => {
    if (import.meta.env.DEV) return

    const check = async () => {
      if (notified.current) return
      try {
        const base = import.meta.env.BASE_URL || '/'
        const res = await fetch(`${base}version.json?_t=${Date.now()}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const { version } = await res.json()
        if (version && version !== __APP_VERSION__) {
          notified.current = true
          toast.info('检测到新版本，请刷新页面以获取最新功能', {
            duration: Infinity,
            action: { label: '立即刷新', onClick: () => window.location.reload() },
          })
        }
      } catch {
        // network error — silently ignore
      }
    }

    const delay = setTimeout(check, 5_000)
    const timer = setInterval(check, POLL_INTERVAL)
    return () => {
      clearTimeout(delay)
      clearInterval(timer)
    }
  }, [])
}
