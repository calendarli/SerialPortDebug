import { DataWindow } from './components/DataWindow'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GlobalTooltip } from './components/GlobalTooltip'

const dataWindowId = new URLSearchParams(window.location.search).get('dataWindow')
if (dataWindowId) document.body.classList.add('data-window-body')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {dataWindowId ? <DataWindow id={dataWindowId} /> : <App />}
    <GlobalTooltip />
  </StrictMode>
)
