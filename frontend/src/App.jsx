import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import SubjectsDashboard from './pages/SubjectsDashboard'
import Workspace from './pages/Workspace'
import VersionHistory from './pages/VersionHistory'
import EvalDashboard from './pages/EvalDashboard'

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" style={{ textDecoration: 'none' }}>
          <div className="topbar-logo">
            <span className="logo-dot" />
            ProFAQ
          </div>
        </NavLink>
        <nav className="topbar-nav">
          <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''} end>
            Subjects
          </NavLink>
          <NavLink to="/eval" className={({ isActive }) => isActive ? 'active' : ''}>
            Eval
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
