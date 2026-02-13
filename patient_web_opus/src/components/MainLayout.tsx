import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { Stethoscope, MessageSquare, UserCircle } from 'lucide-react'

const tabs = [
  { to: '/doctors', icon: Stethoscope, label: '找医生' },
  { to: '/sessions', icon: MessageSquare, label: '问诊记录' },
  { to: '/profile', icon: UserCircle, label: '我的' },
]

export default function MainLayout() {
  const location = useLocation()
  // 聊天页隐藏底部 tab
  const hideTab = location.pathname.startsWith('/chat/')

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* 内容区 */}
      <main className={cn('flex-1 min-h-0', !hideTab && 'pb-[72px]')}>
        <Outlet />
      </main>

      {/* 底部 Tab Bar */}
      {!hideTab && (
        <nav className="tab-bar fixed bottom-0 inset-x-0 z-40 flex items-center justify-around h-[60px] safe-bottom">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => cn(
                'flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors',
                isActive ? 'text-frost-600' : 'text-slate-400'
              )}
            >
              {({ isActive }) => (
                <>
                  <t.icon className={cn('w-5 h-5 transition-transform', isActive && 'scale-110')} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="text-[10px] font-medium">{t.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
