import { useEffect } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import SubjectsDashboard from './pages/SubjectsDashboard'
import Workspace from './pages/Workspace'
import VersionHistory from './pages/VersionHistory'
import EvalDashboard from './pages/EvalDashboard'

export default function App() {
  useEffect(() => {
    const splash = document.getElementById('app-splash')
    if (splash) {
      setTimeout(() => {
        splash.style.opacity = '0'
        splash.style.pointerEvents = 'none'
        setTimeout(() => splash.remove(), 350)
      }, 250)
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" style={{ textDecoration: 'none' }}>
          <div className="topbar-logo">
            <img src="/logo-icon.png" alt="ProFAQ" className="topbar-logo-img" />
            <span className="topbar-brand-title">
              <span className="brand-pro">Pro</span>
              <span className="brand-faq">FAQ</span>
            </span>
          </div>
        </NavLink>
        <nav className="topbar-nav">
          <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''} end>
            Subjects
          </NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<SubjectsDashboard />} />
        <Route path="/subjects/:id" element={<Workspace />} />
        <Route path="/subjects/:id/history" element={<VersionHistory />} />
        <Route path="/eval" element={<EvalDashboard />} />
      </Routes>
    </div>
  )
}
