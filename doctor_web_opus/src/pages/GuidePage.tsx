import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, Film, Info } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import {
  availableChapterIds,
  getGuideChapter,
  guideChapters,
  guideProgressKey,
  hasGuideVideo,
  nextGuideChapter,
  parseGuideProgress,
  toggleGuideProgress,
} from '@/lib/guide-content'
import './guides.css'

export default function GuidePage({ demo = false }: { demo?: boolean }) {
  const username = useAuthStore((state) => state.username)
  const [params, setParams] = useSearchParams()
  const [progress, setProgress] = useState<{ key: string | null; ids: string[]; loaded: boolean }>({ key: null, ids: [], loaded: false })
  const [storageError, setStorageError] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const currentId = params.get('chapter')
  const chapter = getGuideChapter(currentId)
  const index = guideChapters.findIndex((item) => item.id === chapter.id)
  const isComplete = progress.ids.includes(chapter.id)
  const playable = hasGuideVideo(chapter.video) && !videoError
  const workspacePath = demo ? '/preview' : '/workspace'

  useEffect(() => {
    let cancelled = false
    setProgress({ key: null, ids: [], loaded: false })
    setStorageError(false)
    void (async () => {
      try {
        const key = await guideProgressKey(username, demo)
        let ids: string[] = []
        let unavailable = !key
        if (key) {
          try { ids = parseGuideProgress(localStorage.getItem(key)) } catch { unavailable = true }
        }
        if (!cancelled) {
          setProgress({ key: unavailable ? null : key, ids, loaded: true })
          setStorageError(unavailable)
        }
      } catch {
        if (!cancelled) {
          setProgress({ key: null, ids: [], loaded: true })
          setStorageError(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [demo, username])

  useEffect(() => {
    if (!progress.loaded) return
    if (!currentId || !guideChapters.some((item) => item.id === currentId)) {
      setParams((previous) => {
        const next = new URLSearchParams(previous)
        next.set('chapter', nextGuideChapter(progress.ids))
        return next
      }, { replace: true })
    }
  }, [progress.loaded, progress.ids, currentId, setParams])

  useEffect(() => { setVideoError(false) }, [chapter.id])

  useEffect(() => {
    if (!progress.key) return
    const onStorage = (event: StorageEvent) => {
      if (event.key === progress.key || event.key === null) {
        setProgress((previous) => ({ ...previous, ids: parseGuideProgress(event.newValue) }))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [progress.key])

  function selectChapter(id: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('chapter', id)
      return next
    })
  }

  function markRead() {
    if (!progress.loaded) return
    const ids = toggleGuideProgress(progress.ids, chapter.id)
    if (progress.key) {
      try { localStorage.setItem(progress.key, JSON.stringify(ids)) } catch { setStorageError(true) }
    }
    setProgress((previous) => ({ ...previous, ids }))
  }

  return (
    <div className="cl-guide">
      <header className="cl-guide-heading">
        <div>
          <p className="cl-guide-eyebrow">GETTING STARTED</p>
          <h1>使用指南</h1>
          <p>按步骤准备你的 AI 数字医生，也可以直接查看需要的章节。</p>
        </div>
        <Link className="cl-guide-back" to={workspacePath}><ArrowLeft size={16} />返回工作台</Link>
      </header>

      <div className="cl-guide-layout">
        <aside className="cl-guide-nav" aria-label="教程目录">
          <div className="cl-guide-progress">
            <div><strong>我的学习进度</strong><span>{progress.ids.length} / {availableChapterIds.length}</span></div>
            <progress aria-label="已阅读章节" value={progress.ids.length} max={availableChapterIds.length} />
            <small>仅记录本浏览器阅读进度，不代表配置完成。</small>
          </div>
          <nav aria-label="选择教程章节">
            {guideChapters.map((item, chapterIndex) => (
              <button type="button" key={item.id} onClick={() => selectChapter(item.id)} aria-current={item.id === chapter.id ? 'step' : undefined} className={`cl-guide-chapter ${item.id === chapter.id ? 'is-current' : ''}`}>
                <span className={`cl-guide-step-number ${progress.ids.includes(item.id) ? 'is-done' : ''}`}>
                  {progress.ids.includes(item.id) ? <Check size={14} aria-label="已阅读" /> : String(chapterIndex + 1).padStart(2, '0')}
                </span>
                <span>{item.title}{item.status === 'planned' && <small>规划中</small>}</span>
                {item.id === chapter.id && <ChevronRight size={15} />}
              </button>
            ))}
          </nav>
          <div className="cl-guide-nav-foot"><BookOpen size={17} /><span>文字步骤现在可用<br />视频上传后在对应章节播放</span></div>
        </aside>

        <article className="cl-guide-lesson" aria-labelledby="cl-guide-lesson-title">
          <header className="cl-guide-lesson-head">
            <span className="cl-guide-lesson-kicker">步骤 {String(index + 1).padStart(2, '0')}{chapter.status === 'planned' ? ' · 建设方向' : ' · 操作指南'}</span>
            <h2 id="cl-guide-lesson-title">{chapter.title}</h2>
            <p>{chapter.summary}</p>
          </header>

          {playable && chapter.video ? (
            <div className="cl-guide-video">
              <video key={chapter.id} controls preload="metadata" playsInline crossOrigin="anonymous" onError={() => setVideoError(true)} aria-label={`${chapter.title}教学视频`}>
                <source src={chapter.video.src} />
                <track default kind="captions" label="中文字幕" srcLang="zh" src={chapter.video.captionsSrc} />
              </video>
              <details><summary>查看文字讲解</summary><p>{chapter.video.transcript}</p></details>
            </div>
          ) : (
            <div className="cl-guide-video-empty">
              <span className="cl-guide-video-symbol"><Film size={27} strokeWidth={1.5} /></span>
              <div><strong>{videoError ? '视频暂时无法播放' : '教学视频待上传'}</strong><p>{videoError ? '可以先阅读下方步骤，稍后再尝试播放。' : '先按下方文字步骤操作。视频素材就绪后会在此提供章节讲解。'}</p></div>
              <span className="cl-guide-format">文字指南</span>
            </div>
          )}

          <ol className="cl-guide-instructions">
            {chapter.steps.map((step, stepIndex) => (
              <li key={step.title}><span>{stepIndex + 1}</span><div><h3>{step.title}</h3><p>{step.detail}</p></div></li>
            ))}
          </ol>

          <div className="cl-guide-outcome"><CheckCircle2 size={19} /><div><strong>{chapter.status === 'planned' ? '当前状态' : '完成后检查'}</strong><p>{chapter.outcome}</p></div></div>
          {chapter.note && <p className="cl-guide-note"><Info size={16} /><span>{chapter.note}</span></p>}

          <footer className="cl-guide-lesson-actions">
            {chapter.status === 'available' ? <label className="cl-guide-read-toggle"><input type="checkbox" checked={isComplete} disabled={!progress.loaded} onChange={markRead} /><span>我已阅读这一节</span></label> : <span className="cl-guide-planned">发布流程尚未开放</span>}
            {chapter.route && !demo && <Link className="cl-guide-primary" to={chapter.route}>{chapter.action}<ArrowRight size={17} /></Link>}
            {chapter.route && demo && <Link className="cl-guide-primary" to={workspacePath}>返回演示工作台<ArrowRight size={17} /></Link>}
          </footer>
          {demo && <p className="cl-guide-local-note">当前为演示导览。实际资料、配置与服务记录需使用医生账号登录后操作。</p>}
          {storageError && <p className="cl-guide-local-note" role="status">本次阅读仍可继续，进度暂不保存。</p>}
        </article>
      </div>

      <div className="cl-guide-pagination">
        <button type="button" onClick={() => selectChapter(guideChapters[index - 1]!.id)} disabled={index === 0}><ArrowLeft size={16} />上一节</button>
        <span>{index + 1} / {guideChapters.length}</span>
        <button type="button" onClick={() => selectChapter(guideChapters[index + 1]!.id)} disabled={index === guideChapters.length - 1}>下一节<ArrowRight size={16} /></button>
      </div>
    </div>
  )
}
