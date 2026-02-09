import { useEffect, useRef } from 'react'

/**
 * 条件轮询 hook：当 enabled 为 true 时以 intervalMs 间隔调用 callback。
 */
export function usePolling(callback: () => void, intervalMs: number, enabled: boolean) {
  const savedCb = useRef(callback)
  useEffect(() => { savedCb.current = callback }, [callback])

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => savedCb.current(), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, enabled])
}
