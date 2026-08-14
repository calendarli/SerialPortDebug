import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GlobalTooltip } from './components/GlobalTooltip'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <GlobalTooltip />
  </StrictMode>
)
