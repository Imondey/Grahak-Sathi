import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AdminLoginPage({ setUser }) {
  const [email, setEmail]       = useState('')
  const [code, setCode]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [toast, setToast]       = useState({ msg: '', type: '', show: false })
  const navigate = useNavigate()

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap'
    if (!document.querySelector(`link[href="${link.href}"]`)) document.head.appendChild(link)
  }, [])

  function showToast(msg, type = 'success') {
    setToast({ msg, type, show: true })
    setTimeout(() => setToast(t => ({ ...t, show: false })), 4000)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !code) { showToast('All fields required.', 'error'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, unique_code: code }),
      })
      const data = await res.json()
      if (res.ok) {
        setUser(data.user)
        navigate('/chat')
      } else {
        showToast(data.message || 'Login failed.', 'error')
      }
    } catch {
      showToast('Connection error.', 'error')
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
        @keyframes cardIn { from{opacity:0;transform:translateY(32px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes pulse { 0%,100%{opacity:1;box-shadow:0 0 6px #a78bfa} 50%{opacity:.3;box-shadow:0 0 2px #7c3aed} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes particlePulse { 0%,100%{opacity:0;transform:scale(1)} 50%{opacity:.5;transform:scale(1.6)} }
        input::placeholder { color: rgba(109,40,217,.45); }
        input { caret-color: #a78bfa; }
      `}</style>

      {/* Background */}
      <div style={{ position:'fixed', inset:0, background:'#000', zIndex:0 }} />
      <div style={{ position:'fixed', inset:0, background:'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.22) 0%, transparent 70%)', zIndex:0, pointerEvents:'none' }} />
      <div style={{ position:'fixed', inset:0, background:'radial-gradient(ellipse 90% 50% at 50% 120%, rgba(76,29,149,.14) 0%, transparent 60%)', zIndex:0, pointerEvents:'none' }} />

      {/* Page */}
      <div style={{ position:'relative', zIndex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', padding:'24px 16px', fontFamily:"'Sora', sans-serif" }}>

        {/* Brand */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:32 }}>
          <div style={{ width:44, height:44, borderRadius:13, fontSize:22, background:'linear-gradient(135deg, #7c3aed, #4c1d95)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 26px rgba(124,58,237,.6)' }}>🛡️</div>
          <div>
            <div style={{ fontSize:20, fontWeight:800, color:'#fff', letterSpacing:'-.5px' }}>Admin<span style={{ color:'#a78bfa' }}>Panel</span></div>
            <div style={{ fontSize:9, color:'#4c1d95', letterSpacing:'2px', textTransform:'uppercase' }}>Billing Counter Login</div>
          </div>
        </div>

        {/* Card */}
        <div style={{
          width:'100%', maxWidth:420, borderRadius:20,
          border:'1px solid rgba(124,58,237,.35)', background:'rgba(8,3,18,.94)',
          backdropFilter:'blur(20px)', overflow:'hidden',
          boxShadow:'0 0 60px rgba(124,58,237,.15)', animation:'cardIn .9s cubic-bezier(.22,1,.36,1) both',
        }}>
          {/* Title bar */}
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 16px', background:'rgba(0,0,0,.5)', borderBottom:'1px solid rgba(109,40,217,.2)' }}>
            {['#ff5f57','#febc2e','#28c840'].map((c,i) => <div key={i} style={{ width:9, height:9, borderRadius:'50%', background:c, opacity:.6 }} />)}
            <span style={{ marginLeft:10, fontSize:9, color:'#7c3aed', fontFamily:'monospace', letterSpacing:'.4px' }}>grahaksathi.ai/admin-login</span>
          </div>
          <div style={{ height:2, background:'linear-gradient(90deg, transparent, #7c3aed 40%, #a78bfa 70%, transparent)' }} />

          <div style={{ padding:'36px 32px 30px' }}>
            {/* Badge */}
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 13px', borderRadius:20, marginBottom:22, background:'rgba(220,38,38,.08)', border:'1px solid rgba(220,38,38,.25)', fontSize:9, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#fca5a5', fontFamily:'monospace' }}>
              <div style={{ width:5, height:5, borderRadius:'50%', background:'#fca5a5', animation:'pulse 2s ease-in-out infinite' }} />
              Authorized Personnel Only
            </div>

            <h1 style={{ fontSize:24, fontWeight:800, color:'#fff', letterSpacing:'-.5px', marginBottom:6 }}>Admin Sign In</h1>
            <p style={{ fontSize:13, color:'rgba(255,255,255,.25)', marginBottom:28, lineHeight:1.6 }}>Use your admin email and unique security code to access the billing counter.</p>

            <form onSubmit={handleSubmit}>
              {/* Email */}
              <div style={{ marginBottom:18 }}>
                <label style={{ fontSize:10, fontWeight:700, color:'#4c1d95', textTransform:'uppercase', letterSpacing:'1.5px', display:'block', marginBottom:7, fontFamily:'monospace' }}>Admin Email</label>
                <div style={{ position:'relative' }}>
                  <span style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', fontSize:15, pointerEvents:'none' }}>✉️</span>
                  <input type="email" placeholder="admin@store.com" value={email} onChange={e => setEmail(e.target.value)}
                    style={{ width:'100%', background:'rgba(109,40,217,.07)', border:'1px solid rgba(109,40,217,.3)', borderRadius:10, color:'#e9d5ff', fontFamily:"'Sora', sans-serif", fontSize:14, padding:'12px 14px 12px 40px', outline:'none', transition:'border-color .25s, box-shadow .25s' }}
                    onFocus={e => { e.target.style.borderColor='rgba(124,58,237,.7)'; e.target.style.boxShadow='0 0 0 3px rgba(109,40,217,.15)' }}
                    onBlur={e => { e.target.style.borderColor='rgba(109,40,217,.3)'; e.target.style.boxShadow='none' }}
                  />
                </div>
              </div>

              {/* Unique Code */}
              <div style={{ marginBottom:24 }}>
                <label style={{ fontSize:10, fontWeight:700, color:'#4c1d95', textTransform:'uppercase', letterSpacing:'1.5px', display:'block', marginBottom:7, fontFamily:'monospace' }}>Unique Security Code</label>
                <div style={{ position:'relative' }}>
                  <span style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', fontSize:15, pointerEvents:'none' }}>🔐</span>
                  <input type="password" placeholder="Enter your unique code" value={code} onChange={e => setCode(e.target.value)}
                    style={{ width:'100%', background:'rgba(109,40,217,.07)', border:'1px solid rgba(109,40,217,.3)', borderRadius:10, color:'#e9d5ff', fontFamily:"'Sora', sans-serif", fontSize:14, padding:'12px 14px 12px 40px', outline:'none', letterSpacing:'2px', transition:'border-color .25s, box-shadow .25s' }}
                    onFocus={e => { e.target.style.borderColor='rgba(124,58,237,.7)'; e.target.style.boxShadow='0 0 0 3px rgba(109,40,217,.15)' }}
                    onBlur={e => { e.target.style.borderColor='rgba(109,40,217,.3)'; e.target.style.boxShadow='none' }}
                  />
                </div>
              </div>

              {/* Submit */}
              <button type="submit" disabled={loading} style={{
                width:'100%', padding:'14px', border:'none', borderRadius:12, cursor:'pointer',
                fontFamily:"'Sora', sans-serif", fontSize:15, fontWeight:800,
                background:'linear-gradient(135deg, #7c3aed, #5b21b6)', color:'#fff',
                boxShadow:'0 4px 32px rgba(124,58,237,.4)', opacity:loading?.5:1,
                display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                transition:'transform .2s, box-shadow .3s',
              }}>
                {loading
                  ? <><span style={{ width:16, height:16, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite', display:'inline-block' }} /> Authenticating…</>
                  : '🔑 Unlock Admin Panel'}
              </button>
            </form>

            {/* Customer link */}
            {/* Registration link for new admins */}
            <div style={{ marginTop:20, textAlign:'center' }}>
              <p style={{ fontSize:12, color:'rgba(255,255,255,.2)' }}>
                Customer?{' '}
                <a href="/customer" onClick={e => { e.preventDefault(); navigate('/customer') }}
                  style={{ color:'#86efac', fontWeight:600, textDecoration:'none' }}>Enter session token →</a>
              </p>
              <p style={{ fontSize:12, color:'rgba(255,255,255,.2)', marginTop:8 }}>
                New admin?{' '}
                <a href="/signup" onClick={e => { e.preventDefault(); navigate('/signup') }}
                  style={{ color:'#a78bfa', fontWeight:600, textDecoration:'none' }}>Register account →</a>
              </p>
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding:'12px 32px', borderTop:'1px solid rgba(109,40,217,.14)', background:'rgba(0,0,0,.3)', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:'#fca5a5', boxShadow:'0 0 6px #fca5a5', animation:'pulse 2.5s ease-in-out infinite' }} />
            <span style={{ fontSize:10, color:'#4c1d95', fontFamily:'monospace', letterSpacing:'.8px' }}>Admin access only · Code required for logout</span>
          </div>
        </div>
      </div>

      {/* Toast */}
      <div style={{
        position:'fixed', bottom:28, right:28, zIndex:999,
        padding:'12px 20px', borderRadius:12, fontSize:13, fontWeight:500,
        display:'flex', alignItems:'center', gap:8, pointerEvents:'none',
        transform:toast.show?'translateY(0)':'translateY(84px)',
        opacity:toast.show?1:0, transition:'transform .42s ease, opacity .42s ease',
        maxWidth:320, fontFamily:"'Sora', sans-serif",
        background:toast.type==='success'?'rgba(22,163,74,.14)':'rgba(220,38,38,.14)',
        border:`1px solid ${toast.type==='success'?'rgba(134,239,172,.38)':'rgba(252,165,165,.38)'}`,
        color:toast.type==='success'?'#86efac':'#fca5a5',
        backdropFilter:'blur(14px)',
      }}>
        {toast.msg}
      </div>
    </>
  )
}
