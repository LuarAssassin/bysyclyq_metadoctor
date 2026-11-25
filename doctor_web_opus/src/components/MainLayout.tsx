import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { BookOpen, CheckCheck, ChevronRight, CircleHelp, Home, LogOut, Menu, MessageSquareText, SlidersHorizontal, UserRound, Video, X } from 'lucide-react'
import '@/shell.css'

const groups = [
  { title: '日常工作', items: [
    { path: '/workspace', label: '医生工作台', icon: Home, chapter: '' },
    { path: '/consult-review', label: '服务记录复核', icon: CheckCheck, chapter: 'review' },
  ] },
  { title: '我的数字医生', items: [
    { path: '/narrative-kernel', label: '专业与表达', icon: SlidersHorizontal, chapter: 'expression' },
    { path: '/knowledge', label: '专业知识库', icon: BookOpen, chapter: 'knowledge' },
    { path: '/digital-human', label: '形象与声音', icon: Video, chapter: 'avatar' },
    { path: '/rehearsal', label: '试聊与校准', icon: MessageSquareText, chapter: 'rehearsal' },
  ] },
  { title: '学习与设置', items: [
    { path: '/guide', label: '使用指南', icon: CircleHelp, chapter: '' },
    { path: '/profile', label: '个人资料', icon: UserRound, chapter: 'profile' },
  ] },
]

export default function MainLayout({ demo = false }: { demo?: boolean }) {
  const isAuth = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setMobileOpen(false) }, [location.pathname, location.search])
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])
  if (!demo && !isAuth) return <Navigate to={`/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />

  const routeTitle = location.pathname.includes('guide') ? '使用指南' : demo ? '医生工作台' : groups.flatMap(g => g.items).find(i => i.path === location.pathname)?.label || '医生工作台'
  const home = demo ? '/preview' : '/workspace'
  return (
    <div className="cl-shell">
      <a className="cl-skip" href="#main-content">跳到主要内容</a>
      <header className="cl-topbar">
        <button ref={menuRef} className="cl-menu-toggle" aria-label={mobileOpen ? '关闭功能导航' : '打开功能导航'} aria-controls="workspace-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={21} /> : <Menu size={21} />}</button>
        <Link className="cl-brand" to={home} aria-label="崇礼院区医生工作台"><img src={`${import.meta.env.BASE_URL}brand/chongli-logo.png`} alt="北京大学第三医院崇礼院区" width="373" height="64" /></Link>
        <div className="cl-platform-name"><strong>崇礼AI元医院</strong><span>智能化平台</span></div>
        <div className="cl-topbar-actions">
          {demo ? <><span className="cl-demo-badge">交互演示</span><Link className="cl-login-link" to="/auth/login">医生登录 <ChevronRight size={15} /></Link></> : <><Link className="cl-top-help" to="/guide"><CircleHelp size={17} />使用指南</Link><Link className="cl-account" to="/profile" aria-label="打开个人资料"><UserRound size={18} /><span>我的账号</span></Link></>}
        </div>
      </header>
      <div className="cl-workspace-body">
        {mobileOpen && <button className="cl-nav-backdrop" aria-label="关闭功能导航遮罩" onClick={() => { setMobileOpen(false); menuRef.current?.focus() }} />}
        <aside id="workspace-navigation" className={`cl-sidebar ${mobileOpen ? 'is-open' : ''}`}>
          <div className="cl-space-title"><span className="cl-campus-dot" />崇礼院区<span>医生工作空间</span></div>
          <nav aria-label="医生工作台功能导航">
            {groups.map(group => <div className="cl-nav-group" key={group.title}>
              <p>{group.title}</p>
              {group.items.map(item => {
                const target = demo ? item.path === '/workspace' ? '/preview' : item.path === '/guide' ? '/preview/guide' : `/preview/guide?chapter=${item.chapter}` : item.path
                // Demo configuration links teach the workflow without exposing authenticated pages.
                const active = demo ? item.path === '/workspace' && location.pathname === '/preview' || item.path === '/guide' && location.pathname === '/preview/guide' : location.pathname === item.path
                return <Link key={item.path} to={target} className={`cl-nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{active && <span className="cl-nav-indicator" />}</Link>
              })}
            </div>)}
          </nav>
          <div className="cl-sidebar-footer"><p>北京大学第三医院</p><span>崇礼院区 · 医生端</span>{!demo && <button onClick={logout}><LogOut size={15} />退出登录</button>}</div>
        </aside>
        <div className="cl-main-column">
          <div className="cl-breadcrumb"><span>我的工作空间</span><ChevronRight size={14} /><span>{routeTitle}</span>{demo && <span className="cl-preview-notice">仅合成数据 · 不连接患者服务</span>}</div>
          <main id="main-content" className="cl-main" tabIndex={-1}><Outlet /></main>
          <footer className="cl-main-footer"><span>崇礼AI元医院智能化平台</span><span>Chongli AI Meta-Hospital</span></footer>
        </div>
      </div>
    </div>
  )
}
