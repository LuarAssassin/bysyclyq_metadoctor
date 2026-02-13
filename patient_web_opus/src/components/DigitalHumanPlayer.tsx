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
}

/**
 * 数字人视频播放器
 *
 * 场景策略：
 *   - 默认锁定循环播放“待机轻动”场景
 *   - AI 回答中：随机播放所有视频，结束后自动切下一个
 *   - 回答结束：回到“待机轻动”循环
 *
 * 竖版视频：object-contain 保持完整显示
 */
export default function DigitalHumanPlayer({
  videos,
  doctorName,
  isResponding,
  muted,
  onToggleMute,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [localMuted, setLocalMuted] = useState(true)
  const [hasPlayed, setHasPlayed] = useState(false) // 是否播放过至少一次
  const prevRespondingRef = useRef(false)
  const currentUrlRef = useRef<string | null>(null) // 当前正在播放的 URL（避免对比 el.src）
  const effectiveMuted = muted ?? localMuted

  // 所有可播放视频（回答期随机池）
  const allUrls = useMemo(() => {
    return videos
      .map((v) => v.video_url || v.video_oss_url)
      .filter(Boolean) as string[]
  }, [videos])

  // 待机轻动场景（待机锁定）
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
    const el = videoRef.current
    if (!el) return
    // 避免重复设置同一个 src（闪烁根因）
    if (currentUrlRef.current === url && !el.paused) return
    currentUrlRef.current = url
    el.src = url
    el.loop = loop
    el.play().catch(() => {})
    setHasPlayed(true)
  }

  const playStandby = () => {
    if (!standbyUrl) return
    playUrl(standbyUrl, true)
  }

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = effectiveMuted
  }, [effectiveMuted])

  // 初始化/场景切换：非回答期始终锁定播放“待机轻动”
  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const wasResponding = prevRespondingRef.current
    prevRespondingRef.current = isResponding

    if (isResponding && !wasResponding) {
      // ── 开始回答 → 随机播放所有视频
      const url = pickRandom()
      if (url) {
        playUrl(url)
      } else {
        playStandby()
      }
      return
    }

    // 进入页面默认态 / 回答结束后：锁定循环播放“待机轻动”
    playStandby()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResponding, standbyUrl, allUrls.length])

  // 回答中视频自然结束 → 随机下一个；非回答中则靠 loop 自动循环
  const handleEnded = () => {
    if (!isResponding) return
    const url = pickRandom()
    if (url) {
      playUrl(url)
      return
    }
    playStandby()
  }

  return (
    <div className={cn('relative bg-slate-900 overflow-hidden', className)}>
      {/* 视频元素 —— 默认隐藏直到首次播放 */}
      <video
        ref={videoRef}
        playsInline
        muted={effectiveMuted}
        onEnded={handleEnded}
        className={cn(
          'w-full h-full object-contain transition-opacity duration-300',
          hasPlayed ? 'opacity-100' : 'opacity-0'
        )}
      />

      {/* 默认占位（无可用视频时显示） */}
      {!hasPlayed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-800 to-slate-900">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-frost-500/30 to-aurora-500/20 flex items-center justify-center mb-4 backdrop-blur-sm border border-white/10">
            <Stethoscope className="w-9 h-9 text-frost-300" />
          </div>
          <p className="text-white/80 text-sm font-medium">{doctorName}</p>
          <p className="text-white/30 text-xs mt-1">等待视频资源加载</p>
        </div>
      )}

      {/* 渐变遮罩（播放时） */}
      {hasPlayed && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10 pointer-events-none" />
      )}

      {/* 医生信息浮层 */}
      <div className="absolute bottom-3 left-3 right-12 pointer-events-none">
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

      {/* 视频静音按钮（播放过才显示） */}
      {hasPlayed && (
        <button
          onClick={() => {
            if (onToggleMute) onToggleMute()
            else setLocalMuted((prev) => !prev)
          }}
          className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm active:scale-90 transition-transform"
        >
          {effectiveMuted ? <VolumeX className="w-4 h-4 text-white/70" /> : <Volume2 className="w-4 h-4 text-white" />}
        </button>
      )}
    </div>
  )
}
