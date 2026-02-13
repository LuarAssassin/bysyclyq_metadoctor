import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import AuthLayout from '@/components/AuthLayout'
import MainLayout from '@/components/MainLayout'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import PendingPage from '@/pages/PendingPage'
import KnowledgeCenterPage from '@/pages/KnowledgeCenterPage'
import DigitalHumanPage from '@/pages/DigitalHumanPage'
import NarrativeKernelPage from '@/pages/NarrativeKernelPage'
import RehearsalArenaPage from '@/pages/RehearsalArenaPage'
import PatientConsultReviewPage from '@/pages/PatientConsultReviewPage'

// 从 Vite base 配置派生 basename（生产构建用 --base=/doctor/ 则值为 "/doctor"）
// 本地开发时 BASE_URL === "/" 则不设置 basename，行为不变
const _base = import.meta.env.BASE_URL?.replace(/\/+$/, '')
const basename = _base && _base !== '' ? _base : undefined

const router = createBrowserRouter([
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'pending', element: <PendingPage /> },
    ],
  },
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <Navigate to="/knowledge" replace /> },
      { path: 'knowledge', element: <KnowledgeCenterPage /> },
      { path: 'digital-human', element: <DigitalHumanPage /> },
      { path: 'narrative-kernel', element: <NarrativeKernelPage /> },
      { path: 'rehearsal', element: <RehearsalArenaPage /> },
      { path: 'consult-review', element: <PatientConsultReviewPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
], { basename })

export default function App() {
  return <RouterProvider router={router} />
}
