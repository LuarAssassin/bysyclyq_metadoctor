import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import DigitalHumanPage from '../src/pages/DigitalHumanPage'
import '../src/index.css'
createRoot(document.getElementById('root')!).render(<><Toaster/><DigitalHumanPage/></>)
