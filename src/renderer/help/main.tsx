import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Manual from './Manual'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Manual />
  </StrictMode>
)
