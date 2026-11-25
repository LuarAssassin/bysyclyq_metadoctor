import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, CheckCheck, ChevronRight, Circle, CircleAlert, Clock3, Loader2, MessageSquareText, RefreshCw, ShieldCheck, Users, X } from 'lucide-react'
import { toErrorMessage } from '@/lib/http'
import { DEMO_WORKSPACE, formatWorkspaceTime, getReadinessItems, getWorkspace, type WorkspaceData, type WorkspaceSession } from '@/lib/workspace'
import '@/workspace.css'

interface Props { demo?: boolean; supportsSessionLink?: boolean }
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)

function DemoReview({ session, close }: { session: WorkspaceSession; close: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')
        if (!focusable?.length) return
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; active?.focus() }
  }, [close])
  return <div className="cw-dialog-backdrop" onClick={close}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="demo-review-title" className="cw-dialog" onClick={(event) => event.stopPropagation()}>
      <header><div><span className="cw-eyebrow">只读演示</span><h2 id="demo-review-title">服务记录复核</h2></div><button ref={closeRef} onClick={close} className="cw-icon-button" aria-label="关闭演示详情"><X size={20} /></button></header>
      <div className="cw-dialog-body">
        <p className="cw-demo-patient">{session.patient.display_name}<span>会话 #{session.session_id} · 合成示例</span></p>
        <div className="cw-message"><span>患者提问示例</span><p>复诊时，我需要提前整理哪些资料？</p></div>
        <div className="cw-message cw-message-ai"><span><MessageSquareText size={15} /> AI 回复示例 · 待复核</span><p>您可以先整理近期就诊记录、检查报告，以及希望与医生沟通的问题。具体需要携带哪些资料，请以接诊科室的通知为准。</p></div>
        <div className="cw-review-explanation"><ShieldCheck size={18} /><p>真实服务中，医生可核对原始上下文、修订回复并记录复核意见。本页仅展示操作位置，不保存复核结果。</p></div>
      </div>
      <footer><Link className="cw-text-link" to="/preview/guide?chapter=review">了解复核步骤 <ArrowRight size={15} /></Link><button className="cw-button cw-button-primary" onClick={close}>返回工作台</button></footer>
    </div>
  </div>
}

export default function WorkspacePage({ demo = false, supportsSessionLink = false }: Props) {
  const [data, setData] = useState<WorkspaceData | null>(demo ? DEMO_WORKSPACE : null)
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [demoSession, setDemoSession] = useState<WorkspaceSession | null>(null)
  const [showAllPreparation, setShowAllPreparation] = useState(false)

  useEffect(() => {
    if (demo) { setData(DEMO_WORKSPACE); setLoading(false); setError(''); return }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    getWorkspace(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setData(value) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(toErrorMessage(reason)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [demo, refreshKey])

  const guide = (chapter?: string) => `${demo ? '/preview/guide' : '/guide'}${chapter ? `?chapter=${chapter}` : ''}`
  const configLink = (route: string, chapter: string) => demo ? guide(chapter) : route
  const closeDemo = useRef(() => setDemoSession(null)).current
  const readDate = (value: string | null, includeDate = true) => formatWorkspaceTime(value, data?.period.time_zone || 'Asia/Shanghai', includeDate)
  const firstPending = data?.pending_sessions[0]
  const readiness = data ? getReadinessItems(data) : []
  const readyCount = readiness.filter((item) => item.ready).length
  const weekTotal = data?.trend.reduce((sum, day) => sum + day.ai_replies, 0) ?? 0
  const chartMax = data ? Math.max(1, ...data.trend.flatMap((day) => [day.ai_replies, day.patient_messages])) : 1

  return <div className="cw-workspace">
    {demo && <div className="cw-demo-strip"><span>交互演示</span>以下为合成数据，仅用于体验界面，不连接真实患者服务。</div>}
    <header className="cw-page-heading">
      <div><span className="cw-eyebrow">DOCTOR WORKSPACE</span><h1>医生工作台</h1><p>{data ? `${data.profile.display_name || '医生'}，欢迎回来。` : '欢迎回来。'}把需要您判断的事情，集中在这里。</p></div>
      <div className="cw-heading-meta">
        {data && <span>{data.period.end_date.replace(/-/g, '.')}<small>{demo ? '演示日期' : '数据日期'}</small></span>}
        {!demo && <button onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} className="cw-icon-button" aria-label="刷新工作台"><RefreshCw size={18} className={loading ? 'cw-spinning' : ''} /></button>}
      </div>
    </header>

    {error && <div className="cw-error" role="alert"><CircleAlert size={20} /><div><strong>{data ? '刷新未完成，以下仍为上次数据' : '暂时无法读取工作台'}</strong><p>{error}</p></div><button className="cw-button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}>重试</button></div>}
    {!data && loading && <section className="cw-loading" role="status"><Loader2 size={24} className="cw-spinning" /><p>正在整理您的工作台…</p></section>}
    {data && <>
      <section className="cw-stats" aria-label="累计服务统计">
        <div><span><Users size={16} />服务患者</span><strong>{number(data.counts.patients)}<small>人</small></strong><p>累计 {number(data.counts.sessions)} 次会话</p></div>
        <div><span><MessageSquareText size={16} />AI 已回复</span><strong>{number(data.counts.ai_replies)}<small>条</small></strong><p>成功生成的回复</p></div>
        <div className="cw-stat-pending"><span><Clock3 size={16} />待您复核</span><strong>{number(data.counts.pending_reviews)}<small>条</small></strong><p>已复核 {number(data.counts.reviewed_replies)} 条</p></div>
        <div><span><BookOpen size={16} />知识资料</span><strong>{number(data.knowledge.total)}<small>份</small></strong><p>{number(data.knowledge.ready)} 份已就绪</p></div>
      </section>

      <div className="cw-main-grid">
        <div className="cw-main-column">
          <section className="cw-panel cw-review-panel" aria-labelledby="cw-review-title">
            <header className="cw-panel-heading"><div><h2 id="cw-review-title">待复核服务记录 <span>{number(data.counts.pending_reviews)}</span></h2><p>查看原始对话，确认或修订 AI 回复。</p></div>
              {firstPending && (demo ? <button className="cw-button cw-button-primary" onClick={() => setDemoSession(firstPending)}>处理下一条 <ArrowRight size={16} /></button> :
                <Link className="cw-button cw-button-primary" to={supportsSessionLink ? `/consult-review?session=${firstPending.session_id}` : '/consult-review'}>
                  {supportsSessionLink ? '处理下一条' : '打开复核列表'} <ArrowRight size={16} />
                </Link>)}
            </header>
            {data.pending_sessions.length ? <div className="cw-review-list">
              {data.pending_sessions.map((session, index) => {
                const contents = <><span className="cw-patient-avatar" aria-hidden="true">{demo ? String.fromCharCode(65 + index) : (session.patient.display_name || '患').slice(0, 1)}</span><span className="cw-session-person"><strong>{session.patient.display_name || '患者'}</strong><small>会话 #{session.session_id} · {readDate(session.last_message_at)}</small></span><span className="cw-session-state">{session.pending_count} 条待复核</span>{(demo || supportsSessionLink) && <ChevronRight size={17} className="cw-session-arrow" />}</>
                if (!demo && !supportsSessionLink) return <div className="cw-review-row" key={session.session_id}>{contents}</div>
                return demo ? <button className="cw-review-row" key={session.session_id} onClick={() => setDemoSession(session)} aria-label={`查看${session.patient.display_name}的复核示例`}>{contents}</button> : <Link className="cw-review-row" key={session.session_id} to={`/consult-review?session=${session.session_id}`} aria-label={`复核${session.patient.display_name}的会话，${session.pending_count}条待复核`}>{contents}</Link>
              })}
            </div> : <div className="cw-empty"><span><CheckCheck size={27} /></span><h3>当前没有待复核回复</h3><p>新的待复核记录会出现在这里，您可以继续完善数字医生。</p></div>}
            <footer className="cw-review-footer"><p><ShieldCheck size={15} />这里是生成后的内容复核，不是发布前拦截。</p>{!demo && <Link className="cw-text-link" to="/consult-review">全部服务记录 <ArrowRight size={14} /></Link>}</footer>
          </section>

          <section className="cw-panel cw-trend-panel" aria-labelledby="cw-trend-title">
            <header className="cw-panel-heading"><div><h2 id="cw-trend-title">近 7 天服务</h2><p>{data.period.start_date} — {data.period.end_date} · {data.period.time_zone}</p></div><div className="cw-week-total"><strong>{number(weekTotal)}</strong><span>条 AI 回复</span></div></header>
            <div className="cw-chart-legend" aria-hidden="true"><span><i />AI 回复</span><span><i />患者消息</span></div>
            <div className="cw-trend-chart" role="img" aria-label={`近7天共有${weekTotal}条AI回复，详细每日数据可在下方展开查看。`}>
              {data.trend.map((day) => <div className="cw-chart-day" key={day.date}><div className="cw-chart-columns"><div className="cw-chart-bar cw-chart-bar-ai" style={{ height: `${day.ai_replies / chartMax * 100}%`, minHeight: day.ai_replies ? 3 : 0 }} title={`AI 回复 ${day.ai_replies} 条`} /><div className="cw-chart-bar cw-chart-bar-patient" style={{ height: `${day.patient_messages / chartMax * 100}%`, minHeight: day.patient_messages ? 3 : 0 }} title={`患者消息 ${day.patient_messages} 条`} /></div><span>{day.date.slice(5).replace('-', '.')}</span></div>)}
            </div>
            <details className="cw-trend-details"><summary>查看每日数据</summary><div className="cw-table-scroll"><table><caption className="cw-sr-only">近7天服务数据，按{data.period.time_zone}统计</caption><thead><tr><th scope="col">日期</th><th scope="col">AI 回复</th><th scope="col">患者消息</th></tr></thead><tbody>{data.trend.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{number(day.ai_replies)}</td><td>{number(day.patient_messages)}</td></tr>)}</tbody></table></div></details>
          </section>
        </div>

        <aside className="cw-side-column" aria-label="数字医生维护">
          <section className="cw-panel cw-preparation-panel" aria-labelledby="cw-preparation-title">
            <header className="cw-doctor-heading"><div className="cw-doctor-mark" aria-hidden="true">{(data.profile.display_name || '医').slice(0, 1)}</div><div><span>我的数字医生</span><h2 id="cw-preparation-title">{data.profile.display_name || '医生'}的 AI 助手</h2><p>{[data.profile.institution, data.profile.profession].filter(Boolean).join(' · ') || '完善资料后展示专业信息'}</p></div></header>
            <div className="cw-preparation-summary"><strong>准备情况</strong><span><b>{readyCount}</b> / {readiness.length} 项就绪</span></div>
            <div className="cw-preparation-progress" aria-hidden="true">{readiness.map((item) => <i key={item.key} className={item.ready ? 'is-ready' : ''} />)}</div>
            <div className="cw-preparation-list">
              {(showAllPreparation ? readiness : readiness.slice(0, 4)).map((item) => <Link className="cw-preparation-row" key={item.key} to={configLink(item.route, item.chapter)}>
                <span className={item.ready ? 'cw-ready-icon' : 'cw-not-ready-icon'}>{item.ready ? <Check size={15} /> : <Circle size={13} />}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="cw-preparation-status">{item.ready ? '已准备' : '去完善'}</span><ChevronRight size={14} />
              </Link>)}
            </div>
            <button className="cw-expand-preparation" onClick={() => setShowAllPreparation((value) => !value)} aria-expanded={showAllPreparation}>{showAllPreparation ? '收起配置项' : '展开声音、视频与试聊'}</button>
            <p className="cw-preparation-note">准备情况不代表发布审核或服务授权。</p>
          </section>

          <section className="cw-panel cw-knowledge-panel" aria-labelledby="cw-knowledge-title"><header><h2 id="cw-knowledge-title">资料处理</h2><Link className="cw-text-link" to={configLink('/knowledge', 'knowledge')}>管理 <ArrowRight size={14} /></Link></header><div className="cw-knowledge-counts"><span><b>{data.knowledge.processing}</b>处理中</span><span className={data.knowledge.failed ? 'has-issues' : ''}><b>{data.knowledge.failed}</b>需检查</span><span><b>{data.knowledge.ready}</b>已就绪</span></div><p>{data.knowledge.failed ? '有资料未处理完成，请查看原因后重试。' : data.knowledge.processing ? '资料处理中，可稍后刷新查看结果。' : data.knowledge.total ? '已完成的资料可在知识库中核对。' : '添加第一份资料，逐步建立专业知识库。'}</p></section>
        </aside>
      </div>

      <section className="cw-guide-entry"><span className="cw-guide-icon"><BookOpen size={23} /></span><div><h2>从第一份资料，到自己的数字医生</h2><p>按步骤完成设置，随时回来学习。</p></div><Link to={guide()} className="cw-text-link">使用指南 <span lang="en">Quick guide</span><ArrowRight size={16} /></Link></section>
      <footer className="cw-data-note"><span>{demo ? '合成示例' : '仅当前医生'} · 累计统计已排除软删除记录 · 更新于 {readDate(data.generated_at)}</span>{data.counts.failed_replies > 0 && <span>另有 {number(data.counts.failed_replies)} 条生成失败记录，未计入成功回复。</span>}</footer>
    </>}
    {demoSession && <DemoReview session={demoSession} close={closeDemo} />}
  </div>
}
