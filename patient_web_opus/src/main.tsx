import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Toaster } from 'sonner'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster
      position="top-center"
      richColors
      toastOptions={{
        style: {
          borderRadius: '1rem',
          fontSize: '13px',
        },
      }}
    />
    <App />
  </StrictMode>,
)
