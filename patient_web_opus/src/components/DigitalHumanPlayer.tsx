import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { DoctorVideo } from '@/types/api'
import { Stethoscope, Volume2, VolumeX } from 'lucide-react'

interface Props {
  videos: DoctorVideo[]
  doctorName: string
  isResponding: boolean
  muted?: boolean
  onToggleMute?: () => void
  className?: string
  fill?: boolean
  showCaption?: boolean
}

/**
 * 数字人视频播放器
 *
 * 场景策略：
 *   - 默认锁定循环播放“待机轻动”场景
 *   - AI 回答中：随机播放所有视频，结束后自动切下一个
 *   - 回答结束：回到“待机轻动”循环
 *
 * 双缓冲：下一片在隐藏层预加载，就绪后再切可见层，避免 src 替换时黑屏。
 */
export default function DigitalHumanPlayer({
  videos,
  doctorName,
  isResponding,
  muted,
  onToggleMute,
  className,
  fill = false,
  showCaption = true,
}: Props) {
  const videoRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  const [activeIndex, setActiveIndex] = useState(0)
  const [localMuted, setLocalMuted] = useState(true)
  const [hasPlayed, setHasPlayed] = useState(false)
  const prevRespondingRef = useRef(false)
  const currentUrlRef = useRef<string | null>(null)
  const activeIndexRef = useRef(0)
  const swapTokenRef = useRef(0)
  const isRespondingRef = useRef(isResponding)
  const effectiveMuted = muted ?? localMuted

  isRespondingRef.current = isResponding
  activeIndexRef.current = activeIndex

  const allUrls = useMemo(() => {
    return videos
      .map((v) => v.video_url || v.video_oss_url)
      .filter(Boolean) as string[]
  }, [videos])

  const standbyUrl = useMemo(() => {
    const idle = videos.find((v) => v.scene_key === 'idle_standby')
    if (idle) return idle.video_url || idle.video_oss_url

    const listening = videos.find((v) => (
      v.scene_key === 'listening_pause'
      || (typeof v.scene_name === 'string' && v.scene_name.includes('倾听停顿'))
    ))
    if (listening) return listening.video_url || listening.video_oss_url

    return videos.length ? (videos[0]!.video_url || videos[0]!.video_oss_url) : null
  }, [videos])

  const pickRandom = (): string | null => {
    if (!allUrls.length) return standbyUrl
    return allUrls[Math.floor(Math.random() * allUrls.length)]!
  }

  const playUrl = (url: string, loop = false) => {
    const current = videoRefs[activeIndexRef.current].current
    if (currentUrlRef.current === url && current && !current.paused) {
      current.loop = false
      return
    }

    const token = ++swapTokenRef.current
    const fromIndex = activeIndexRef.current
    const toIndex = currentUrlRef.current ? 1 - fromIndex : fromIndex
    const incoming = videoRefs[toIndex].current
    const outgoing = videoRefs[fromIndex].current
    if (!incoming) return

    incoming.loop = false
    incoming.muted = effectiveMuted

    const reveal = () => {
      if (swapTokenRef.current !== token) return
      incoming.play().catch(() => {})
      currentUrlRef.current = url
      activeIndexRef.current = toIndex
      setActiveIndex(toIndex)
      setHasPlayed(true)
      if (outgoing && outgoing !== incoming) {
        window.setTimeout(() => {
          if (swapTokenRef.current !== token) return
          outgoing.pause()
          const warmUrl = loop ? url : (isRespondingRef.current ? pickRandom() : standbyUrl)
          if (!warmUrl) return
          if (outgoing.getAttribute('src') !== warmUrl) {
            outgoing.src = warmUrl
            outgoing.load()
          } else {
            outgoing.currentTime = 0
          }
        }, 180)
      }
    }

    const attach = () => {
      if (incoming.readyState >= 2) {
        incoming.currentTime = 0
        reveal()
        return
      }
      const onReady = () => {
        incoming.removeEventListener('loadeddata', onReady)
        reveal()
      }
      incoming.addEventListener('loadeddata', onReady)
    }

    const incomingSrc = incoming.getAttribute('src')
    if (incomingSrc === url && incoming.readyState >= 2) {
      incoming.currentTime = 0
      reveal()
      return
    }

    incoming.src = url
    incoming.load()
    attach()
  }

  const playStandby = () => {
    if (!standbyUrl) return
    playUrl(standbyUrl, true)
  }

  useEffect(() => {
    videoRefs.forEach((ref) => {
      if (ref.current) ref.current.muted = effectiveMuted
    })
  }, [effectiveMuted])

  useEffect(() => {
    const wasResponding = prevRespondingRef.current
    prevRespondingRef.current = isResponding

    if (isResponding && !wasResponding) {
      const url = pickRandom()
      if (url) playUrl(url)
      else playStandby()
      return
    }

    if (!isResponding) playStandby()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResponding, standbyUrl, allUrls.length])

  const handleEnded = (index: number) => {
    if (index !== activeIndexRef.current) return
    if (isRespondingRef.current) {
      const url = pickRandom()
      if (url) {
        playUrl(url)
        return
      }
    }
    playStandby()
  }

  return (
    <div className={cn('relative bg-slate-900 overflow-hidden', className)}>
      {[0, 1].map((index) => (
        <video
          key={index}
          ref={videoRefs[index]}
          playsInline
          preload="auto"
          muted={effectiveMuted}
          onEnded={() => handleEnded(index)}
          className={cn(
            'absolute inset-0 z-10 w-full h-full object-cover transition-opacity duration-150',
            fill ? 'object-top' : '',
            hasPlayed && activeIndex === index ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}

      {!hasPlayed && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-b from-slate-800 to-slate-900">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-frost-500/30 to-aurora-500/20 flex items-center justify-center mb-4 backdrop-blur-sm border border-white/10">
            <Stethoscope className="w-9 h-9 text-frost-300" />
          </div>
          <p className="text-white/80 text-sm font-medium">{doctorName}</p>
          <p className="text-white/30 text-xs mt-1">等待视频资源加载</p>
        </div>
      )}

      {hasPlayed && !fill && (
        <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/50 via-transparent to-black/10 pointer-events-none" />
      )}

      {showCaption && (
        <div className="absolute bottom-3 left-3 right-12 z-30 pointer-events-none">
          <p className="text-white text-sm font-semibold drop-shadow-md">{doctorName}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {isResponding ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-frost-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-frost-500" />
                </span>
                <span className="text-[11px] text-frost-200 font-medium">正在回答…</span>
              </>
            ) : hasPlayed ? (
              <span className="text-[11px] text-white/50">待机中</span>
            ) : (
              <span className="text-[11px] text-white/40">等待资源</span>
            )}
          </div>
        </div>
      )}

      {hasPlayed && (
        <button
          onClick={() => {
            if (onToggleMute) onToggleMute()
            else setLocalMuted((prev) => !prev)
          }}
          className={cn(
            'pointer-events-auto absolute z-40 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm active:scale-90 transition-transform',
            fill ? 'top-3 right-3' : 'bottom-3 right-3',
          )}
        >
          {effectiveMuted ? <VolumeX className="w-4 h-4 text-white/70" /> : <Volume2 className="w-4 h-4 text-white" />}
        </button>
      )}
    </div>
  )
}
