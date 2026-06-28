import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/* ─── Particle Field ─────────────────────────────────────────────────── */
function ParticleField() {
  const dots = Array.from({ length: 28 }, (_, i) => ({
    id: i,
    left: `${(i * 37 + 7) % 100}%`,
    top:  `${(i * 53 + 11) % 100}%`,
    size: 1 + (i % 3),
    delay: `${(i * 0.4) % 6}s`,
    dur:   `${5 + (i % 4)}s`,
  }))
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {dots.map(d => (
        <div key={d.id} style={{
          position: 'absolute', left: d.left, top: d.top,
          width: d.size, height: d.size, borderRadius: '50%',
          background: '#7c3aed', opacity: 0,
          animation: `particlePulse ${d.dur} ease-in-out ${d.delay} infinite`,
        }} />
      ))}
    </div>
  )
}

/* ─── Stats Ticker ───────────────────────────────────────────────────── */
function StatsTicker() {
  const stats = [
    { icon: '🛒', label: 'Items Verified',   value: '1.2M+' },
    { icon: '⚡', label: 'Avg Scan Time',    value: '0.8s'  },
    { icon: '✓',  label: 'Match Accuracy',   value: '98.4%' },
    { icon: '📦', label: 'SKUs Tracked',     value: '240K'  },
    { icon: '🏪', label: 'Retail Stores',    value: '3,800+'},
  ]
  return (
    <div style={{ overflow: 'hidden', position: 'relative', marginBottom: 48 }}>
      <div style={{ display: 'flex', gap: 0, animation: 'tickerScroll 22s linear infinite', width: 'max-content' }}>
        {[...stats, ...stats].map((s, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 28px', whiteSpace: 'nowrap',
            borderRight: '1px solid rgba(109,40,217,.18)',
          }}>
            <span style={{ fontSize: 16 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 9, color: '#4c1d95', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'monospace' }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#a78bfa', fontFamily: "'Sora', sans-serif", letterSpacing: '-.3px' }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 80, background: 'linear-gradient(to right, #000, transparent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, background: 'linear-gradient(to left, #000, transparent)', pointerEvents: 'none' }} />
    </div>
  )
}

/* ─── Feature Card ───────────────────────────────────────────────────── */
function FeatureCard({ icon, title, description, delay = '0s' }) {
  return (
    <div style={{
      background: 'rgba(8,3,18,.88)',
      border: '1px solid rgba(109,40,217,.22)',
      borderRadius: 18,
      padding: '28px 24px',
      backdropFilter: 'blur(14px)',
      animation: `cardIn .6s ${delay} cubic-bezier(.22,1,.36,1) both`,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,#7c3aed,transparent)', animation: 'shimmer 3s ease-in-out infinite' }} />
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: 'rgba(109,40,217,.12)', border: '1px solid rgba(109,40,217,.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, marginBottom: 16,
        boxShadow: '0 0 18px rgba(124,58,237,.25)',
      }}>{icon}</div>
      <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 16, fontWeight: 700, color: '#e9d5ff', marginBottom: 8, letterSpacing: '-.3px' }}>{title}</h3>
      <p style={{ fontFamily: "'Sora', sans-serif", fontSize: 13, color: 'rgba(255,255,255,.3)', lineHeight: 1.7 }}>{description}</p>
    </div>
  )
}

/* ─── Main Home Page ─────────────────────────────────────────────────── */
export default function HomePage({ user, setUser }) {
  const navigate = useNavigate()

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap'
    if (!document.querySelector(`link[href="${link.href}"]`)) document.head.appendChild(link)
  }, [])

  async function logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
    navigate('/')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { background: #000; }

        @keyframes shimmer       { 0%,100%{opacity:.4} 50%{opacity:1} }
        @keyframes blink         { 0%,100%{opacity:1}  50%{opacity:.25} }
        @keyframes spin          { to{transform:rotate(360deg)} }
        @keyframes cardIn        { from{opacity:0;transform:translateY(18px) scale(.98)} to{opacity:1;transform:none} }
        @keyframes particlePulse { 0%,100%{opacity:0;transform:scale(1)} 50%{opacity:.55;transform:scale(1.6)} }
        @keyframes tickerScroll  { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes heroIn        { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:none} }
        @keyframes pulse         { 0%,100%{opacity:1;box-shadow:0 0 6px #a78bfa} 50%{opacity:.35;box-shadow:0 0 2px #7c3aed} }
        @keyframes floatA        { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }

        .nav-btn:hover { color:#a78bfa !important; border-color:rgba(167,139,250,.38) !important; }
        .checkout-btn:hover { transform: translateY(-3px) !important; box-shadow: 0 12px 48px rgba(124,58,237,.6) !important; }
      `}</style>

      {/* Background */}
      <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.2) 0%, transparent 70%)', zIndex: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 90% 50% at 50% 120%, rgba(76,29,149,.12) 0%, transparent 60%)', zIndex: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: 60, left: 0, right: 0, height: 1, background: 'linear-gradient(to right, transparent, rgba(109,40,217,.25), transparent)', zIndex: 1, pointerEvents: 'none' }} />

      <ParticleField />

      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', fontFamily: "'Sora', sans-serif" }}>

        {/* Navbar */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 32px', height: 60,
          background: 'rgba(0,0,0,.72)', borderBottom: '1px solid rgba(109,40,217,.2)',
          backdropFilter: 'blur(22px)', position: 'sticky', top: 0, zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, fontSize: 19, background: 'linear-gradient(135deg, #7c3aed, #4c1d95)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 22px rgba(124,58,237,.55)' }}>🛒</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-.4px' }}>Grahak<span style={{ color: '#a78bfa' }}>Sathi</span></div>
              <div style={{ fontSize: 9, color: '#4c1d95', letterSpacing: '2.2px', textTransform: 'uppercase' }}>Retail Intelligence</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4c1d95', letterSpacing: '.5px' }}>
              {user?.shop_name || 'Store'}
            </span>
            <button onClick={() => navigate('/chat')} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'transparent', border: '1px solid rgba(109,40,217,.3)', color: '#6d28d9', cursor: 'pointer' }}>💬 Assistant</button>
            <button onClick={() => navigate('/admin')} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'transparent', border: '1px solid rgba(109,40,217,.3)', color: '#6d28d9', cursor: 'pointer' }}>🛡️ Admin Panel</button>
            <button onClick={logout} style={{ padding: '6px 18px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 0 20px rgba(124,58,237,.38)' }}>Sign Out</button>
          </div>
        </header>

        {/* Hero Section */}
        <div style={{ textAlign: 'center', padding: '64px 24px 40px', animation: 'heroIn .85s ease both' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '5px 16px', borderRadius: 22, marginBottom: 24,
            background: 'rgba(109,40,217,.14)', border: '1px solid rgba(109,40,217,.32)',
            fontSize: 10, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase',
            color: '#a78bfa', fontFamily: 'monospace',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#86efac', boxShadow: '0 0 8px #86efac', animation: 'pulse 2s ease-in-out infinite' }} />
            Welcome, {user?.name || 'Retailer'}
          </div>

          <h1 style={{ fontSize: 'clamp(36px,5vw,60px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-2px', color: '#fff', marginBottom: 16, marginTop: 20 }}>
            Grahak Sathi <span style={{ color: '#a78bfa' }}>Verification</span>
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.3)', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.7, fontWeight: 400 }}>
            AI-powered product verification using YOLOv8 + OCR. Scan barcodes, capture product images via webcam, and verify against your inventory database in real-time.
          </p>

          {/* Big Start Transaction Button */}
          <button
            className="checkout-btn"
            onClick={() => navigate('/transaction')}
            style={{
              padding: '20px 56px',
              borderRadius: 16,
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'Sora', sans-serif",
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: '.3px',
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              color: '#fff',
              boxShadow: '0 6px 36px rgba(124,58,237,.45)',
              transition: 'transform .25s, box-shadow .3s',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 24 }}>🛒</span>
            Start Transaction
            <span style={{ fontSize: 14, opacity: .7 }}>→</span>
          </button>

          <p style={{ marginTop: 16, fontSize: 11, color: '#4c1d95', fontFamily: 'monospace', letterSpacing: '.8px' }}>
            Next customer → Barcode + Webcam + AI verification + Cart + Pay → End Session
          </p>
        </div>

        {/* Stats Ticker */}
        <StatsTicker />

        {/* How It Works */}
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: '#4c1d95', marginBottom: 20 }}>
            How It Works <div style={{ flex: 1, height: 1, background: 'rgba(109,40,217,.15)' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            <FeatureCard
              icon="📷"
              title="1. Capture Product Image"
              description="Use your webcam or upload a photo of the product. Our YOLOv8 model identifies the product visually."
              delay="0s"
            />
            <FeatureCard
              icon="⌨️"
              title="2. Enter Barcode"
              description="Type the barcode number from the product. This is cross-referenced against your inventory database."
              delay=".1s"
            />
            <FeatureCard
              icon="🤖"
              title="3. AI Verification"
              description="YOLO + OCR engine compares the product image against the barcode's inventory entry. Mismatches are flagged as potential fraud."
              delay=".2s"
            />
            <FeatureCard
              icon="🛒"
              title="4. Add to Cart"
              description="Verified items are added to your cart. You can scan more items — each triggers a fresh AI verification pass."
              delay=".3s"
            />
          </div>
        </div>

        {/* Prototype Details */}
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 64px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: '#4c1d95', marginBottom: 20 }}>
            Prototype Details <div style={{ flex: 1, height: 1, background: 'rgba(109,40,217,.15)' }} />
          </div>

          <div style={{
            background: 'rgba(8,3,18,.88)',
            border: '1px solid rgba(109,40,217,.22)',
            borderRadius: 18,
            padding: '28px 28px',
            backdropFilter: 'blur(14px)',
            animation: 'cardIn .6s .4s cubic-bezier(.22,1,.36,1) both',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px 32px' }}>
              {[
                { label: 'AI Model', value: 'YOLOv8 (Custom Trained)', color: '#a78bfa' },
                { label: 'OCR Engine', value: 'Tesseract.js + EasyOCR', color: '#86efac' },
                { label: 'Backend', value: 'Node.js + FastAPI', color: '#c4b5fd' },
                { label: 'Database', value: 'PostgreSQL + Redis', color: '#a78bfa' },
                { label: 'Fraud Detection', value: 'Fuzzy Match + Frequency Analysis', color: '#fcd34d' },
                { label: 'Notifications', value: 'SendGrid + Nodemailer', color: '#86efac' },
                { label: 'Auth', value: 'Redis Sessions + bcrypt', color: '#c4b5fd' },
                { label: 'Real-time', value: 'WebSocket (ws)', color: '#a78bfa' },
              ].map((item, i) => (
                <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid rgba(109,40,217,.1)' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#4c1d95', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 600, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Second CTA */}
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <button
              className="checkout-btn"
              onClick={() => navigate('/transaction')}
              style={{
                padding: '14px 36px',
                borderRadius: 14,
                border: 'none',
                cursor: 'pointer',
                fontFamily: "'Sora', sans-serif",
                fontSize: 15,
                fontWeight: 700,
                background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                color: '#fff',
                boxShadow: '0 4px 28px rgba(124,58,237,.4)',
                transition: 'transform .25s, box-shadow .3s',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              Start Next Transaction →
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid rgba(109,40,217,.15)',
          padding: '20px 32px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#86efac', boxShadow: '0 0 8px #86efac', animation: 'blink 2.5s ease-in-out infinite' }} />
          <span style={{ fontSize: 10, color: '#4c1d95', fontFamily: 'monospace', letterSpacing: '1px' }}>
            Grahak Sathi · Team Schrodinger · Grahak Sathi Intelligence Platform
          </span>
        </div>
      </div>
    </>
  )
}
