import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/* ─── 3-D Shapes (same as home.jsx) ─────────────────────────────────── */
function Shape3D({ style, type = 'cube' }) {
  if (type === 'cube')
    return (
      <svg viewBox="0 0 120 120" style={style} fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="scTop" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9d6fff" stopOpacity=".92" />
            <stop offset="100%" stopColor="#5b21b6" stopOpacity=".75" />
          </linearGradient>
          <linearGradient id="scLeft" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4c1d95" stopOpacity=".95" />
            <stop offset="100%" stopColor="#2e1065" stopOpacity=".85" />
          </linearGradient>
          <linearGradient id="scRight" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6d28d9" stopOpacity=".75" />
            <stop offset="100%" stopColor="#3b0764" stopOpacity=".65" />
          </linearGradient>
        </defs>
        <g>
          <polygon points="60,8 102,31 60,54 18,31" fill="url(#scTop)" />
          <polygon points="18,31 60,54 60,102 18,79" fill="url(#scLeft)" />
          <polygon points="60,54 102,31 102,79 60,102" fill="url(#scRight)" />
          <polygon points="60,8 102,31 60,54 18,31" fill="none" stroke="#b794f4" strokeWidth="1" strokeOpacity=".7" />
        </g>
      </svg>
    )
  if (type === 'bolt')
    return (
      <svg viewBox="0 0 120 120" style={style} fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sbG" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c4b5fd" stopOpacity=".9" />
            <stop offset="100%" stopColor="#6d28d9" stopOpacity=".65" />
          </linearGradient>
        </defs>
        <polygon points="70,10 35,58 58,58 50,110 85,62 62,62" fill="url(#sbG)" />
      </svg>
    )
  if (type === 'ring')
    return (
      <svg viewBox="0 0 120 120" style={style} fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="srG" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9d6fff" stopOpacity=".95" />
            <stop offset="100%" stopColor="#4c1d95" stopOpacity=".5" />
          </linearGradient>
        </defs>
        <ellipse cx="60" cy="60" rx="50" ry="22" stroke="url(#srG)" strokeWidth="14" fill="none" />
      </svg>
    )
  return (
    <svg viewBox="0 0 120 120" style={style} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ssG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ddd6fe" stopOpacity=".9" />
          <stop offset="100%" stopColor="#6d28d9" stopOpacity=".55" />
        </linearGradient>
      </defs>
      {[0, 45, 90, 135].map(r => (
        <rect key={r} x="53" y="10" width="14" height="100" rx="7"
          fill="url(#ssG)" opacity=".8" transform={`rotate(${r} 60 60)`} />
      ))}
      <circle cx="60" cy="60" r="11" fill="#a78bfa" opacity=".95" />
    </svg>
  )
}


/* ─── Particle Field ─────────────────────────────────────────────────── */
function ParticleField() {
  const dots = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    left: `${(i * 41 + 5) % 100}%`,
    top: `${(i * 57 + 9) % 100}%`,
    size: 1 + (i % 3),
    delay: `${(i * 0.45) % 6}s`,
    dur: `${5 + (i % 4)}s`,
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

/* ─── Browser Card ───────────────────────────────────────────────────── */
function BrowserCard({ children, glowColor = '#7c3aed', style }) {
  return (
    <div style={{
      borderRadius: 18,
      border: '1px solid rgba(124,58,237,.38)',
      background: 'rgba(8,3,18,.92)',
      backdropFilter: 'blur(20px)',
      boxShadow: `0 0 44px ${glowColor}2e, 0 0 88px ${glowColor}14, inset 0 0 0 1px rgba(255,255,255,.035)`,
      overflow: 'hidden',
      ...style,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '9px 14px',
        background: 'rgba(0,0,0,.55)',
        borderBottom: '1px solid rgba(109,40,217,.22)',
      }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => (
          <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: .65 }} />
        ))}
        <div style={{
          flex: 1, height: 16, marginLeft: 8, borderRadius: 4,
          background: 'rgba(109,40,217,.14)', border: '1px solid rgba(109,40,217,.22)',
          display: 'flex', alignItems: 'center', paddingLeft: 8,
        }}>
          <span style={{ fontSize: 9, color: '#7c3aed', fontFamily: 'monospace', opacity: .75, letterSpacing: '.4px' }}>grahaksathi.ai/register</span>
        </div>
      </div>
      <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #7c3aed 40%, #a78bfa 70%, transparent)', animation: 'barPulse 3s ease-in-out infinite' }} />
      {children}
    </div>
  )
}


/* ─── Input Field ────────────────────────────────────────────────────── */
function InputField({ icon, label, type = 'text', placeholder, value, onChange, onBlur, error, success, suffix, multiline }) {
  const sharedStyle = {
    width: '100%', background: 'rgba(109,40,217,.07)',
    border: `1px solid ${error ? 'rgba(252,165,165,.6)' : success ? 'rgba(134,239,172,.5)' : 'rgba(109,40,217,.3)'}`,
    borderRadius: 10, color: '#e9d5ff',
    fontFamily: "'Sora', sans-serif", fontSize: 14,
    padding: multiline ? '11px 14px 11px 40px' : '12px 14px 12px 40px',
    paddingRight: suffix ? 44 : 14,
    outline: 'none', transition: 'border-color .25s, background .25s, box-shadow .25s',
    boxSizing: 'border-box',
  }
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        fontSize: 10, fontWeight: 700, color: '#4c1d95',
        textTransform: 'uppercase', letterSpacing: '1.5px',
        display: 'block', marginBottom: 6, fontFamily: 'monospace',
      }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 13, top: multiline ? 12 : '50%',
          transform: multiline ? 'none' : 'translateY(-50%)',
          fontSize: 15, pointerEvents: 'none', zIndex: 1,
        }}>{icon}</span>
        <Tag
          type={!multiline ? type : undefined}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          style={{ ...sharedStyle, ...(multiline ? { resize: 'vertical', minHeight: 72 } : {}) }}
          onFocus={e => {
            e.target.style.borderColor = 'rgba(124,58,237,.7)'
            e.target.style.background = 'rgba(109,40,217,.12)'
            e.target.style.boxShadow = '0 0 0 3px rgba(109,40,217,.15)'
          }}
          onBlurCapture={e => {
            if (!error && !success) {
              e.target.style.borderColor = 'rgba(109,40,217,.3)'
              e.target.style.background = 'rgba(109,40,217,.07)'
              e.target.style.boxShadow = 'none'
            }
          }}
        />
        {suffix && (
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
            {suffix}
          </div>
        )}
      </div>
      {error && <p style={{ fontSize: 11, color: '#fca5a5', marginTop: 5, fontFamily: 'monospace', letterSpacing: '.3px' }}>⚠ {error}</p>}
    </div>
  )
}


const validators = {
  ownerName: v => v.trim().length >= 2 ? '' : 'Enter a valid owner name.',
  shopName:  v => v.trim().length >= 2 ? '' : 'Enter a valid shop name.',
  email:     v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter a valid email address.',
  uniqueCode: v => v.length >= 6 ? '' : 'Unique code must be at least 6 characters.',
  confirmCode: v => ''
}

/* ─── Main Signup Page ───────────────────────────────────────────────── */
export default function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ ownerName:'', shopName:'', email:'', uniqueCode:'', confirmCode:'' })
  const [errors, setErrors] = useState({})
  const [showCode, setShowCode] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState({ msg:'', type:'', show:false })

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap'
    if (!document.querySelector(`link[href="${link.href}"]`)) document.head.appendChild(link)
  }, [])

  function showToastMsg(msg, type='success') {
    setToast({ msg, type, show:true })
    setTimeout(() => setToast(t=>({...t,show:false})), 4000)
  }

  function validate(field, value) {
    if (field === 'confirmCode') return value === form.uniqueCode ? '' : 'Codes do not match.'
    return validators[field](value)
  }

  function setField(field, value) {
    setForm(f => ({...f, [field]: value}))
    if (errors[field]) setErrors(e => ({...e, [field]: validate(field, value)}))
  }

  function onBlur(field) {
    setErrors(e => ({...e, [field]: validate(field, form[field])}))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const newErrors = {}
    Object.keys(form).forEach(k => { newErrors[k] = validate(k, form[k]) })
    setErrors(newErrors)
    if (Object.values(newErrors).some(Boolean)) return

    setLoading(true)
    try {
      const res = await fetch('/api/admin/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_name:  form.ownerName.trim(),
          shop_name:   form.shopName.trim(),
          email:       form.email.trim(),
          unique_code: form.uniqueCode,
          shop_id:     1
        })
      })
      const data = await res.json()
      if (res.ok) {
        showToastMsg('Admin registered successfully! You can now login.', 'success')
        setTimeout(() => navigate('/'), 1800)
      } else {
        showToastMsg(data.message || 'Registration failed. Please try again.', 'error')
      }
    } catch {
      showToastMsg('Server error. Please check your connection.', 'error')
    } finally {
      setLoading(false)
    }
  }


  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #000; }

        @keyframes floatA { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-22px) rotate(8deg)} }
        @keyframes floatB { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(18px) rotate(-7deg)} }
        @keyframes floatC { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-14px) rotate(12deg)} }
        @keyframes floatD { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(20px) rotate(-10deg)} }

        @keyframes particlePulse { 0%,100%{opacity:0;transform:scale(1)} 50%{opacity:.5;transform:scale(1.6)} }
        @keyframes cardIn { from{opacity:0;transform:translateY(32px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes barPulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:1;box-shadow:0 0 6px #a78bfa} 50%{opacity:.3;box-shadow:0 0 2px #7c3aed} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes badgeShimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes dotBlink { 0%,100%{opacity:1} 50%{opacity:.3} }

        input::placeholder, textarea::placeholder { color: rgba(109,40,217,.5); }
        input, textarea { caret-color: #a78bfa; }

        @media(max-width:900px) {
          .su-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* Background */}
      <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.2) 0%, transparent 70%)', zIndex: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 90% 50% at 50% 120%, rgba(76,29,149,.12) 0%, transparent 60%)', zIndex: 0, pointerEvents: 'none' }} />

      <ParticleField />

      {/* Floating 3D shapes */}
      <Shape3D type="cube" style={{ position:'fixed', top:24, left:-12, width:160, height:160, opacity:.88, animation:'floatA 8s ease-in-out infinite', zIndex:0, filter:'drop-shadow(0 0 26px rgba(124,58,237,.55))' }} />
      <Shape3D type="bolt" style={{ position:'fixed', top:8, right:20, width:140, height:140, opacity:.72, animation:'floatB 10s ease-in-out infinite', zIndex:0, filter:'drop-shadow(0 0 20px rgba(167,139,250,.45))' }} />
      <Shape3D type="cube" style={{ position:'fixed', bottom:44, left:26, width:130, height:130, opacity:.65, animation:'floatC 12s ease-in-out infinite', zIndex:0, filter:'drop-shadow(0 0 18px rgba(109,40,217,.5))', transform:'rotate(28deg)' }} />
      <Shape3D type="ring" style={{ position:'fixed', bottom:60, right:12, width:150, height:150, opacity:.58, animation:'floatD 9s ease-in-out infinite', zIndex:0, filter:'drop-shadow(0 0 22px rgba(124,58,237,.4))' }} />
      <Shape3D type="star" style={{ position:'fixed', top:'42%', right:8, width:75, height:75, opacity:.38, animation:'floatA 11s ease-in-out 2s infinite', zIndex:0, filter:'drop-shadow(0 0 12px rgba(167,139,250,.3))' }} />


      {/* Page */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '32px 16px', fontFamily: "'Sora', sans-serif" }}>

        {/* Brand lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, animation: 'fadeUp .7s ease both' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, fontSize: 20,
            background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 22px rgba(124,58,237,.55)',
          }}>🛒</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-.4px', lineHeight: 1.1 }}>
              Grahak<span style={{ color: '#a78bfa' }}>Sathi</span>
            </div>
            <div style={{ fontSize: 9, color: '#4c1d95', letterSpacing: '2px', textTransform: 'uppercase' }}>Retail Intelligence</div>
          </div>
        </div>

        {/* Card */}
        <BrowserCard style={{ width: '100%', maxWidth: 560, animation: 'cardIn .9s cubic-bezier(.22,1,.36,1) both' }}>
          <div style={{ padding: '32px 32px 28px' }}>

            {/* Badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 13px', borderRadius: 20, marginBottom: 22,
              background: 'rgba(109,40,217,.12)', border: '1px solid rgba(109,40,217,.28)',
              fontSize: 9, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase',
              color: '#a78bfa', fontFamily: 'monospace',
              backgroundImage: 'linear-gradient(90deg, rgba(109,40,217,0) 0%, rgba(167,139,250,.1) 50%, rgba(109,40,217,0) 100%)',
              backgroundSize: '200% auto', animation: 'badgeShimmer 3.5s linear infinite',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#a78bfa', animation: 'pulse 2s ease-in-out infinite' }} />
              Admin Registration
            </div>

            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-.6px', marginBottom: 5, lineHeight: 1.1 }}>
              Register Admin Account
            </h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.28)', marginBottom: 28, lineHeight: 1.6 }}>
              Create your admin billing counter account
            </p>

            <form onSubmit={handleSubmit} autoComplete="off">
              <div className="su-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <InputField icon="👤" label="Owner Name" placeholder="John Doe"
                  value={form.ownerName} error={errors.ownerName} success={!errors.ownerName && form.ownerName}
                  onChange={e => setField('ownerName', e.target.value)} onBlur={() => onBlur('ownerName')} />
                <InputField icon="🏪" label="Shop Name" placeholder="My Retail Store"
                  value={form.shopName} error={errors.shopName} success={!errors.shopName && form.shopName}
                  onChange={e => setField('shopName', e.target.value)} onBlur={() => onBlur('shopName')} />
              </div>

              <InputField icon="✉️" label="Admin Email" type="email" placeholder="admin@store.com"
                value={form.email} error={errors.email} success={!errors.email && form.email}
                onChange={e => setField('email', e.target.value)} onBlur={() => onBlur('email')} />

              <div className="su-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <InputField icon="🔐" label="Unique Security Code" type={showCode ? 'text' : 'password'} placeholder="Min 6 characters"
                  value={form.uniqueCode} error={errors.uniqueCode} success={!errors.uniqueCode && form.uniqueCode}
                  onChange={e => setField('uniqueCode', e.target.value)} onBlur={() => onBlur('uniqueCode')}
                  suffix={<button type="button" onClick={() => setShowCode(v=>!v)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#5b21b6', padding:2 }}>{showCode ? '🙈' : '👁️'}</button>} />
                <InputField icon="🔒" label="Confirm Code" type={showConfirm ? 'text' : 'password'} placeholder="Re-enter code"
                  value={form.confirmCode} error={errors.confirmCode} success={!errors.confirmCode && form.confirmCode}
                  onChange={e => setField('confirmCode', e.target.value)} onBlur={() => onBlur('confirmCode')}
                  suffix={<button type="button" onClick={() => setShowConfirm(v=>!v)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#5b21b6', padding:2 }}>{showConfirm ? '🙈' : '👁️'}</button>} />
              </div>

              <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(109,40,217,.06)', border:'1px solid rgba(109,40,217,.18)', marginBottom:16, fontFamily:'monospace', fontSize:10, color:'#4c1d95', lineHeight:1.6 }}>
                ℹ️ This unique code will be used to login and logout. Keep it safe — you cannot recover it.
              </div>


              {/* Submit */}
              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '14px', border: 'none', borderRadius: 11, cursor: 'pointer',
                fontFamily: "'Sora', sans-serif", fontSize: 15, fontWeight: 800, letterSpacing: '.2px',
                background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                color: '#fff', transition: 'transform .2s, box-shadow .3s',
                boxShadow: '0 4px 32px rgba(124,58,237,.38)',
                opacity: loading ? .5 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                marginTop: 8, marginBottom: 20,
              }}
                onMouseEnter={e => { if (!loading) { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 10px 44px rgba(124,58,237,.55)' } }}
                onMouseLeave={e => { e.target.style.transform = 'none'; e.target.style.boxShadow = '0 4px 32px rgba(124,58,237,.38)' }}
              >
                {loading
                  ? <><span style={{ display:'inline-block', width:16, height:16, border:'2px solid rgba(255,255,255,.28)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} /> Creating account…</>
                  : 'Register Admin Account →'}
              </button>

              {/* Sign in link */}
              <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,.25)' }}>
                Already have an account?{' '}
                <a href="/" onClick={e => { e.preventDefault(); navigate('/') }} style={{
                  color: '#a78bfa', fontWeight: 700, textDecoration: 'none',
                }}>Sign in →</a>
              </p>
            </form>
          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 32px', borderTop: '1px solid rgba(109,40,217,.14)',
            background: 'rgba(0,0,0,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#86efac', boxShadow: '0 0 6px #86efac', animation: 'dotBlink 2.5s ease-in-out infinite' }} />
            <span style={{ fontSize: 10, color: '#2d5a3d', fontFamily: 'monospace', letterSpacing: '.8px' }}>256-bit SSL · SOC 2 compliant · End-to-end encrypted</span>
          </div>
        </BrowserCard>

        <p style={{ marginTop: 20, fontSize: 11, color: '#2e1065', fontFamily: 'monospace', letterSpacing: '.5px', animation: 'fadeUp .7s .6s both' }}>
          Trusted by 3,800+ retail stores worldwide
        </p>
      </div>

      {/* Toast */}
      <div style={{
        position: 'fixed', bottom: 28, right: 28, zIndex: 999,
        padding: '12px 20px', borderRadius: 12, fontSize: 13, fontWeight: 500,
        display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none',
        transform: toast.show ? 'translateY(0)' : 'translateY(84px)',
        opacity: toast.show ? 1 : 0, transition: 'transform .42s ease, opacity .42s ease',
        maxWidth: 320, fontFamily: "'Sora', sans-serif",
        background: toast.type === 'success' ? 'rgba(22,163,74,.14)' : 'rgba(220,38,38,.14)',
        border: `1px solid ${toast.type === 'success' ? 'rgba(134,239,172,.38)' : 'rgba(252,165,165,.38)'}`,
        color: toast.type === 'success' ? '#86efac' : '#fca5a5',
        backdropFilter: 'blur(14px)',
      }}>
        {toast.msg}
      </div>
    </>
  )
}
