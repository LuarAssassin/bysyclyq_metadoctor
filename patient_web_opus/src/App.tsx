import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import AuthLayout from '@/components/AuthLayout'
import MainLayout from '@/components/MainLayout'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import DoctorListPage from '@/pages/DoctorListPage'
import SessionListPage from '@/pages/SessionListPage'
import ProfilePage from '@/pages/ProfilePage'
import ChatPage from '@/pages/ChatPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated)
  if (!isAuth) return <Navigate to="/auth/login" replace />
  return <>{children}</>
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated)
  if (isAuth) return <Navigate to="/doctors" replace />
  return <>{children}</>
}

const router = createBrowserRouter([
  {
    path: '/auth',
    element: <GuestRoute><AuthLayout /></GuestRoute>,
    children: [
      { index: true, element: <Navigate to="login" replace /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
    ],
  },
  {
    path: '/',
    element: <ProtectedRoute><MainLayout /></ProtectedRoute>,
    children: [
      { index: true, element: <Navigate to="/doctors" replace /> },
      { path: 'doctors', element: <DoctorListPage /> },
      { path: 'sessions', element: <SessionListPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'chat/:sessionId', element: <ChatPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
