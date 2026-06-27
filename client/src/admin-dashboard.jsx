import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AdminDashboard({ user, setUser }) {
  const navigate = useNavigate()
  const [sessions, setSessions]       = useState([])
  const [loading, setLoading]         = useState(false)
  const [newName, setNewName]         = useState('')
  const [creating, setCreating]       = useState(false)
  const [logoutCode, setLogoutCode]   = useState('')
  const [logoutOpen, setLogoutOpen]   = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [toast, setToast]             = useState({ msg: '', type: '', show: false })
  const [copiedToken, setCopiedToken] = useState(null)
  const [usage, setUsage]             = useState(null)

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap'
    if (!document.querySelector(`link[href="${link.href}"]`)) document.head.appendChild(link)
    fetchSessions()
    fetchUsage()
    const interval = setInterval(() => { fetchSessions(); fetchUsage() }, 10000)
    return () => clearInterval(interval)
  }, [])

  async function fetchUsage() {
    try {
      const res = await fetch('/api/admin/usage-transparency', { credentials: 'include' })
      if (res.ok) setUsage(await res.json())
    } catch {}
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type, show: true })
    setTimeout(() => setToast(t => ({ ...t, show: false })), 4000)
  }

  async function fetchSessions() {
    try {
      const res = await fetch('/api/admin/active-sessions', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch {}
  }

  async function createSession() {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/create-customer-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ customer_name: newName || 'Customer' }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(`Session created for ${data.session.customer_name}`, 'success')
        setNewName('')
        fetchSessions()
      } else {
        showToast(data.message || 'Failed to create session.', 'error')
      }
    } catch {
      showToast('Connection error.', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function expireSession(token) {
    try {
      const res = await fetch('/api/admin/expire-customer-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, payment_total: 0 }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(`Session expired: ${data.customer_name}`, 'success')
        fetchSessions()
      } else {
        showToast(data.message || 'Failed.', 'error')
      }
    } catch {
      showToast('Error expiring session.', 'error')
    }
  }

  async function handleAdminLogout() {
    if (!logoutCode) { showToast('Enter your unique code to logout.', 'error'); return }
    setLogoutLoading(true)
    try {
      const res = await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ unique_code: logoutCode }),
      })
      const data = await res.json()
      if (res.ok) {
        setUser(null)
        navigate('/')
      } else {
        showToast(data.message || 'Logout failed.', 'error')
      }
    } catch {
      showToast('Error.', 'error')
    } finally {
      setLogoutLoading(false)
    }
  }

  function copyToken(token) {
    navigator.clipboard.writeText(token).then(() => {
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 2000)
    }).catch(() => {})
  }

  const activeSessions = sessions.filter(s => s.status === 'active')
  const completedSessions = sessions.filter(s => s.status !== 'active')

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #000; }
        @keyframes cardIn { from{opacity:0;transform:translateY(18px) scale(.98)} to{opacity:1;transform:none} }
        @keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.25} }
        input::placeholder { color: rgba(109,40,217,.4); }
      `}</style>

      {/* Background */}
      <div style={{ position:'fixed', inset:0, background:'#000', zIndex:0 }} />
      <div style={{ position:'fixed', inset:0, background:'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.18) 0%, transparent 70%)', zIndex:0, pointerEvents:'none' }} />

      <div style={{ position:'relative', zIndex:1, minHeight:'100vh', fontFamily:"'Sora', sans-serif" }}>

        {/* Navbar */}
        <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 28px', height:60, background:'rgba(0,0,0,.72)', borderBottom:'1px solid rgba(109,40,217,.2)', backdropFilter:'blur(22px)', position:'sticky', top:0, zIndex:50 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, fontSize:18, background:'linear-gradient(135deg, #7c3aed, #4c1d95)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 20px rgba(124,58,237,.5)' }}>🛡️</div>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:'#fff', letterSpacing:'-.3px' }}>Admin<span style={{ color:'#a78bfa' }}>Panel</span></div>
              <div style={{ fontSize:9, color:'#4c1d95', letterSpacing:'2px', textTransform:'uppercase' }}>{user?.shop_name || 'Store'}</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'#86efac', boxShadow:'0 0 8px #86efac', animation:'blink 2s ease-in-out infinite' }} />
              <span style={{ fontFamily:'monospace', fontSize:10, color:'#4c1d95', letterSpacing:'1px' }}>ONLINE</span>
            </div>
            <button onClick={() => navigate('/home')} style={{ padding:'5px 14px', borderRadius:20, fontSize:11, background:'transparent', border:'1px solid rgba(109,40,217,.3)', color:'#6d28d9', cursor:'pointer' }}>🏪 Store View</button>
            <button onClick={() => setLogoutOpen(true)} style={{ padding:'6px 16px', borderRadius:20, fontSize:12, fontWeight:700, background:'rgba(220,38,38,.12)', border:'1px solid rgba(220,38,38,.3)', color:'#fca5a5', cursor:'pointer' }}>🔒 End Shift</button>
          </div>
        </header>

        <div style={{ maxWidth:1200, margin:'0 auto', padding:'24px' }}>

          {/* Stats row */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:14, marginBottom:24 }}>
            {[
              { label:'Active Sessions', value:activeSessions.length, color:'#86efac', icon:'👤' },
              { label:'Completed Today', value:completedSessions.length, color:'#a78bfa', icon:'✅' },
              { label:'Admin', value:user?.name || 'Admin', color:'#c4b5fd', icon:'🛡️' },
            ].map((s,i) => (
              <div key={i} style={{ background:'rgba(8,3,18,.88)', border:'1px solid rgba(109,40,217,.22)', borderRadius:16, padding:'18px 20px', backdropFilter:'blur(14px)', animation:`cardIn .5s ${i*.08}s cubic-bezier(.22,1,.36,1) both` }}>
                <div style={{ fontSize:9, color:'#4c1d95', letterSpacing:'1.5px', textTransform:'uppercase', fontFamily:'monospace', marginBottom:6 }}>{s.label}</div>
                <div style={{ fontSize:28, fontWeight:800, color:s.color, lineHeight:1 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* ── AI Cost & Usage Transparency (Otari) ── */}
          {usage && (
            <div style={{ background:'rgba(8,3,18,.88)', border:'1px solid rgba(109,40,217,.22)', borderRadius:18, padding:'22px 24px', marginBottom:20, animation:'cardIn .6s .15s cubic-bezier(.22,1,.36,1) both' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, fontFamily:'monospace', fontSize:10, fontWeight:600, letterSpacing:'2px', textTransform:'uppercase', color:'#4c1d95', marginBottom:16 }}>
                AI Cost & Usage Transparency · Today <div style={{ flex:1, height:1, background:'rgba(109,40,217,.15)' }} />
                <span style={{ color:'#a78bfa' }}>{usage.totalCalls || 0} calls</span>
              </div>

              {/* top metrics */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:18 }}>
                {[
                  { label:'AI Spend Today', value:`$${(usage.totalSpend||0).toFixed(3)}`, sub:`of $${(usage.budgetLimit||2).toFixed(2)}/session`, color:'#34d399' },
                  { label:'Avg Latency', value: usage.avgLatencyMs != null ? `${usage.avgLatencyMs}ms` : '—', sub:'across tiers', color:'#a78bfa' },
                  { label:'Injections Blocked', value: usage.injectionCount || 0, sub:`${(usage.injectionByStage||[]).map(s=>`S${s.stage}:${s.count}`).join(' ')||'none'}`, color:'#fb923c' },
                  { label:'Return Claims', value:(usage.claims?.approved||0)+(usage.claims?.denied||0)+(usage.claims?.review||0), sub:`✅${usage.claims?.approved||0} ⛔${usage.claims?.denied||0} 🔎${usage.claims?.review||0}`, color:'#c4b5fd' },
                ].map((m,i)=>(
                  <div key={i} style={{ background:'rgba(0,0,0,.3)', border:'1px solid rgba(109,40,217,.15)', borderRadius:12, padding:'14px 16px' }}>
                    <div style={{ fontSize:9, color:'#4c1d95', letterSpacing:'1.2px', textTransform:'uppercase', fontFamily:'monospace', marginBottom:6 }}>{m.label}</div>
                    <div style={{ fontSize:22, fontWeight:800, color:m.color, lineHeight:1 }}>{m.value}</div>
                    <div style={{ fontSize:9.5, color:'#64748b', marginTop:5, fontFamily:'monospace' }}>{m.sub}</div>
                  </div>
                ))}
              </div>

              {/* spend by tier */}
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:10, color:'#64748b', fontFamily:'monospace', letterSpacing:'1px', marginBottom:10 }}>SPEND BY ROUTING TIER</div>
                {['light','medium','high'].map(tier => {
                  const row = (usage.spendByTier||[]).find(r => r.tier === tier) || { calls:0, spend:0, avg_latency:null }
                  const tierColor = { light:'#34d399', medium:'#fbbf24', high:'#a78bfa' }[tier]
                  const maxSpend = Math.max(0.0001, ...(usage.spendByTier||[]).map(r=>r.spend||0))
                  const w = Math.min(100, ((row.spend||0)/maxSpend)*100)
                  const meta = usage.tiers?.[tier]
                  return (
                    <div key={tier} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
                      <div style={{ width:140, flexShrink:0 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:tierColor, textTransform:'capitalize' }}>{tier}</span>
                        <span style={{ fontSize:9, color:'#64748b', fontFamily:'monospace', marginLeft:6 }}>≤{meta?.latencyMs||'?'}ms</span>
                      </div>
                      <div style={{ flex:1, height:18, borderRadius:5, background:'rgba(124,58,237,.08)', overflow:'hidden', position:'relative' }}>
                        <div style={{ height:'100%', width:`${w}%`, background:`${tierColor}55`, borderLeft:`2px solid ${tierColor}`, transition:'width .5s ease' }} />
                      </div>
                      <div style={{ width:150, flexShrink:0, textAlign:'right', fontFamily:'monospace', fontSize:10, color:'#94a3b8' }}>
                        {row.calls||0} calls · ${(row.spend||0).toFixed(3)}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* recent injection attempts */}
              {(usage.recentInjections||[]).length > 0 && (
                <div style={{ marginTop:16, borderTop:'1px solid rgba(109,40,217,.12)', paddingTop:14 }}>
                  <div style={{ fontSize:10, color:'#fb923c', fontFamily:'monospace', letterSpacing:'1px', marginBottom:8 }}>🛡️ RECENT INJECTION ATTEMPTS</div>
                  {usage.recentInjections.slice(0,5).map((inj,i)=>(
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'5px 0', fontSize:11 }}>
                      <span style={{ fontFamily:'monospace', fontSize:9, padding:'2px 7px', borderRadius:6, color:'#fb923c', background:'rgba(251,146,60,.1)', border:'1px solid rgba(251,146,60,.25)', flexShrink:0 }}>STAGE {inj.stage} · {inj.pattern}</span>
                      <span style={{ color:'#64748b', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inj.snippet}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Create session */}
          <div style={{ background:'rgba(8,3,18,.88)', border:'1px solid rgba(109,40,217,.22)', borderRadius:18, padding:'22px 24px', marginBottom:20, animation:'cardIn .6s .2s cubic-bezier(.22,1,.36,1) both' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontFamily:'monospace', fontSize:10, fontWeight:600, letterSpacing:'2px', textTransform:'uppercase', color:'#4c1d95', marginBottom:14 }}>
              New Customer Session <div style={{ flex:1, height:1, background:'rgba(109,40,217,.15)' }} />
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <input type="text" placeholder="Customer name (optional)" value={newName} onChange={e => setNewName(e.target.value)}
                style={{ flex:1, background:'rgba(109,40,217,.06)', border:'1px solid rgba(109,40,217,.25)', borderRadius:10, color:'#e9d5ff', fontFamily:"'Sora', sans-serif", fontSize:13, padding:'12px 16px', outline:'none' }}
                onKeyDown={e => { if (e.key === 'Enter') createSession() }}
              />
              <button onClick={createSession} disabled={creating} style={{
                padding:'12px 24px', borderRadius:10, border:'none', cursor:'pointer',
                fontFamily:"'Sora', sans-serif", fontSize:13, fontWeight:700,
                background:'linear-gradient(135deg, #059669, #065f46)', color:'#fff',
                boxShadow:'0 4px 20px rgba(34,197,94,.3)', opacity:creating?.5:1,
              }}>
                {creating ? '…' : '+ Create Session'}
              </button>
            </div>
          </div>

          {/* Active sessions list */}
          <div style={{ background:'rgba(8,3,18,.88)', border:'1px solid rgba(109,40,217,.22)', borderRadius:18, overflow:'hidden', animation:'cardIn .6s .3s cubic-bezier(.22,1,.36,1) both' }}>
            <div style={{ padding:'14px 22px', borderBottom:'1px solid rgba(109,40,217,.15)', background:'rgba(0,0,0,.3)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#e9d5ff' }}>Customer Sessions</span>
              <span style={{ fontFamily:'monospace', fontSize:11, color:'#86efac' }}>{activeSessions.length} active</span>
            </div>

            {sessions.length === 0 ? (
              <div style={{ padding:'40px 20px', textAlign:'center', color:'#4c1d95', fontFamily:'monospace', fontSize:12 }}>
                No sessions yet — create one for the next customer.
              </div>
            ) : (
              <div style={{ maxHeight:400, overflowY:'auto' }}>
                {sessions.map((s, i) => (
                  <div key={s.id} style={{
                    display:'flex', alignItems:'center', gap:12, padding:'14px 22px',
                    borderBottom:'1px solid rgba(109,40,217,.08)',
                    opacity: s.status !== 'active' ? .5 : 1,
                  }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background: s.status === 'active' ? '#86efac' : '#fca5a5', boxShadow:`0 0 6px ${s.status === 'active' ? '#86efac' : '#fca5a5'}` }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#e9d5ff' }}>{s.customer_name}</div>
                      <div style={{ fontFamily:'monospace', fontSize:10, color:'#4c1d95', marginTop:2 }}>
                        {s.session_token.slice(0,8)}… · {new Date(s.created_at).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}
                        {s.status !== 'active' && ` · ${s.status.toUpperCase()}`}
                      </div>
                    </div>

                    {s.status === 'active' && (
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={() => copyToken(s.session_token)} style={{
                          padding:'6px 12px', borderRadius:8, fontSize:10, fontWeight:600,
                          border:'1px solid rgba(34,197,94,.3)', background:'rgba(34,197,94,.06)',
                          color:'#86efac', cursor:'pointer', fontFamily:'monospace',
                        }}>
                          {copiedToken === s.session_token ? '✓ Copied' : '📋 Copy Token'}
                        </button>
                        <button onClick={() => window.open(`/customer?token=${s.session_token}`, '_blank')} style={{
                          padding:'6px 12px', borderRadius:8, fontSize:10, fontWeight:600,
                          border:'1px solid rgba(124,58,237,.3)', background:'rgba(124,58,237,.06)',
                          color:'#a78bfa', cursor:'pointer', fontFamily:'monospace',
                        }}>
                          🛒 Open Customer Page
                        </button>
                        <button onClick={() => expireSession(s.session_token)} style={{
                          padding:'6px 12px', borderRadius:8, fontSize:10, fontWeight:600,
                          border:'1px solid rgba(220,38,38,.3)', background:'rgba(220,38,38,.06)',
                          color:'#fca5a5', cursor:'pointer', fontFamily:'monospace',
                        }}>
                          ✕ End Session
                        </button>
                      </div>
                    )}

                    {s.status !== 'active' && (
                      <span style={{ fontFamily:'monospace', fontSize:10, color:'#4c1d95', padding:'3px 8px', borderRadius:6, background:'rgba(109,40,217,.06)' }}>
                        {s.status === 'paid' ? `₹${s.payment_total || 0}` : 'EXPIRED'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Logout modal */}
      {logoutOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,.85)', backdropFilter:'blur(12px)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={e => { if (e.target === e.currentTarget) setLogoutOpen(false) }}>
          <div style={{ width:'100%', maxWidth:380, background:'rgba(8,3,18,.97)', border:'1px solid rgba(220,38,38,.3)', borderRadius:20, padding:'28px 28px 24px', animation:'cardIn .4s cubic-bezier(.22,1,.36,1) both' }}>
            <h2 style={{ fontSize:20, fontWeight:800, color:'#fca5a5', marginBottom:6 }}>🔒 End Shift</h2>
            <p style={{ fontSize:13, color:'rgba(255,255,255,.25)', marginBottom:20, lineHeight:1.6 }}>
              Enter your unique code to close the billing counter. All active customer sessions will be expired.
            </p>
            <input type="password" placeholder="Unique code" value={logoutCode} onChange={e => setLogoutCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdminLogout() }}
              style={{ width:'100%', background:'rgba(220,38,38,.05)', border:'1px solid rgba(220,38,38,.3)', borderRadius:10, color:'#fca5a5', fontFamily:'monospace', fontSize:16, padding:'12px 16px', outline:'none', letterSpacing:'2px', marginBottom:16 }}
            />
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setLogoutOpen(false)} style={{ flex:1, padding:'12px', borderRadius:10, border:'1px solid rgba(109,40,217,.3)', background:'transparent', color:'#6d28d9', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:"'Sora', sans-serif" }}>Cancel</button>
              <button onClick={handleAdminLogout} disabled={logoutLoading} style={{ flex:1, padding:'12px', borderRadius:10, border:'none', background:'rgba(220,38,38,.2)', color:'#fca5a5', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:"'Sora', sans-serif", opacity:logoutLoading?.5:1 }}>
                {logoutLoading ? 'Closing…' : 'Confirm Logout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div style={{
        position:'fixed', bottom:28, right:28, zIndex:999,
        padding:'12px 20px', borderRadius:12, fontSize:13, fontWeight:500,
        display:'flex', alignItems:'center', gap:8, pointerEvents:'none',
        transform:toast.show?'translateY(0)':'translateY(84px)',
        opacity:toast.show?1:0, transition:'transform .42s ease, opacity .42s ease',
        maxWidth:340, fontFamily:"'Sora', sans-serif",
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
