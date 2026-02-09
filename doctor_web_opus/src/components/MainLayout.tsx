import { useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/cn'
import {
  BookOpen,
  BrainCircuit,
  LogOut,
  Menu,
  MessageSquareText,
  Mountain,
  Snowflake,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

const navItems = [
  { path: '/knowledge', label: '知识库与索引', icon: BookOpen },
  { path: '/digital-human', label: '数字人素材', icon: Video },
  { path: '/narrative-kernel', label: '叙事底座', icon: BrainCircuit },
  { path: '/rehearsal', label: 'AI 问诊演练', icon: MessageSquareText },
]

const routeTitles: Record<string, string> = {
  '/knowledge': '知识库与索引中心',
  '/digital-human': '数字人素材中心',
  '/narrative-kernel': '医生叙事底座中心',
  '/rehearsal': 'AI 问诊演练场',
}

export default function MainLayout() {
  const isAuth = useAuthStore((s) => s.isAuthenticated)
  const username = useAuthStore((s) => s.username)
  const logout = useAuthStore((s) => s.logout)
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!isAuth) return <Navigate to="/auth/login" replace />

  const pageTitle = routeTitles[location.pathname] || '工作台'

  return (
    <div className="app-bg flex min-h-screen">
      {/* ── Sidebar ─────────────────────── */}
      <aside className={cn(
        'sidebar-gradient fixed inset-y-0 left-0 z-40 w-[260px] flex flex-col transition-transform duration-300 ease-out',
        'lg:translate-x-0 lg:static lg:z-auto',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        {/* Brand */}
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ice-400 to-ice-600 flex items-center justify-center">
              <Mountain className="w-4 h-4 text-white" />
            </div>
            <Snowflake className="w-4 h-4 text-ice-400/50" />
          </div>
          <p className="text-[10px] tracking-[0.15em] uppercase text-ice-400/40 mt-2 font-medium">
            Doctor Agent Console
          </p>
          <h2 className="text-lg font-bold text-white mt-0.5 tracking-tight">北医三院崇礼</h2>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-1 mt-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'sidebar-item-active text-white'
                  : 'text-alpine-300 hover:text-white hover:bg-white/[0.06]',
              )}
            >
              <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 pb-5">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-ice-500/20 flex items-center justify-center">
                <UserRound className="w-4 h-4 text-ice-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-alpine-400 truncate">当前账号</p>
                <p className="text-sm font-semibold text-white truncate">{username || '医生'}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-red-400/80 hover:text-red-300 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              退出登录
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Main ────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex items-center gap-3 px-4 lg:px-6 h-[60px] border-b border-alpine-900/[0.06] bg-white/60 backdrop-blur-lg">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-alpine-100 transition-colors"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-alpine-900 truncate">{pageTitle}</h3>
            <p className="text-[11px] text-alpine-400 truncate hidden sm:block">
              医生智能体工作台 · 状态驱动联调
            </p>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
