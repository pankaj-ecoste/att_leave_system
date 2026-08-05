import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { HealthCheck } from './features/health/HealthCheck.jsx'
import './index.css'

// Decided outside React, once, at load time — not as a conditional hook branch inside
// App (that would violate the Rules of Hooks the moment App's own hooks run after it).
const showHealthCheck = new URLSearchParams(window.location.search).has('health')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {showHealthCheck ? <HealthCheck /> : <App />}
  </React.StrictMode>,
)
