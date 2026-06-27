import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import AdminLoginPage    from './admin-login.jsx'
import CustomerLoginPage from './customer-login.jsx'
import SignupPage        from './signup.jsx'
import HomePage          from './home.jsx'
import AdminDashboard    from './admin-dashboard.jsx'
import CheckoutPage      from './checkout.jsx'
import TransactionPage   from './transaction.jsx'
import ChatbotPage       from './chatbot.jsx'

function LoadingScreen() {
  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', gap: 16,
        background: '#000',
        fontFamily: 'monospace',
      }}>
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.2) 0%, transparent 70%)',
        }} />
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '2px solid rgba(109,40,217,.25)',
          borderTopColor: '#7c3aed',
          animation: 'spin .8s linear infinite',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, zIndex: 1 }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: '#a78bfa',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 11, color: '#4c1d95', letterSpacing: '2px', textTransform: 'uppercase' }}>
            Authenticating
          </span>
        </div>
      </div>
    </>
  )
}

// Auth guard: admin must be logged in
function AuthGuard({ user, children }) {
  if (user === undefined) return <LoadingScreen />
  if (!user) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)

    fetch('/api/me', { credentials: 'include', signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => setUser(d?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => clearTimeout(timeout))
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public: Admin login ── */}
        <Route path="/"       element={<AdminLoginPage setUser={setUser} />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/customer" element={<CustomerLoginPage setUser={setUser} />} />
        <Route path="/returns" element={<ChatbotPage />} />

        {/* ── Protected: Admin logged in → all pages accessible ── */}
        <Route path="/home"        element={<AuthGuard user={user}><HomePage        user={user} setUser={setUser} /></AuthGuard>} />
        <Route path="/admin"       element={<AuthGuard user={user}><AdminDashboard  user={user} setUser={setUser} /></AuthGuard>} />
        <Route path="/checkout"    element={<AuthGuard user={user}><CheckoutPage    user={user} setUser={setUser} /></AuthGuard>} />
        <Route path="/transaction" element={<AuthGuard user={user}><TransactionPage user={user} setUser={setUser} /></AuthGuard>} />

        {/* ── Catch-all ── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
