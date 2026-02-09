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
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
