import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/* ── Purchase History page ───────────────────────────────────
 * Lists past transactions (receipts) for the logged-in shop, most
 * recent first. Each row shows the transaction number, date/time,
 * channel, item count and total; clicking one opens the Order Status
 * page for that transaction id.
 *
 * Backed by GET /api/purchases → { found, count, orders:[{ transaction_id,
 * transaction_time, channel, units, line_count, subtotal, gst, total }] }
 * ──────────────────────────────────────────────────────────── */
export default function PurchasesPage({ user, setUser }) {
  const navigate = useNavigate()

  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch('/api/purchases', { credentials: 'include' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.message || `Server error ${r.status}`)
        return d
      })
      .then(d => { if (alive) { setOrders(Array.isArray(d.orders) ? d.orders : []); setError(null) } })
      .catch(e => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  function openOrder(o) {
    navigate('/order-status', { state: { transactionId: o.transaction_id } })
  }

  return (
    <>
      <style>{purchasesCSS}</style>

      {/* Background */}
      <div style={{ position:'fixed',inset:0,zIndex:0,background:'#000' }} />
      <div style={{ position:'fixed',inset:0,zIndex:0,background:'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.18) 0%, transparent 70%)',pointerEvents:'none' }} />
      <div style={{ position:'fixed',inset:0,zIndex:0,background:'radial-gradient(ellipse 90% 50% at 50% 120%, rgba(76,29,149,.1) 0%, transparent 60%)',pointerEvents:'none' }} />

      {/* Topbar */}
      <header style={{ position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',height:60,background:'rgba(0,0,0,.72)',borderBottom:'1px solid rgba(109,40,217,.2)',backdropFilter:'blur(22px)' }}>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ width:34,height:34,borderRadius:9,background:'linear-gradient(135deg,#7c3aed,#4c1d95)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,boxShadow:'0 0 18px rgba(124,58,237,.5)' }}>🧾</div>
          <div>
            <span style={{ fontFamily:"'Sora',sans-serif",fontSize:16,fontWeight:800,letterSpacing:'-.3px',color:'#fff' }}>Grahak<span style={{ color:'#a78bfa' }}>Sathi</span></span>
            <span style={{ fontFamily:'monospace',fontSize:9,color:'#4c1d95',letterSpacing:'1.5px',textTransform:'uppercase',marginLeft:8 }}>/ Purchase History</span>
          </div>
        </div>
        <button onClick={() => navigate('/home')} style={{ padding:'6px 16px',borderRadius:20,fontSize:12,fontWeight:700,fontFamily:"'Sora',sans-serif",background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff',border:'none',cursor:'pointer',boxShadow:'0 0 16px rgba(124,58,237,.35)' }}>← Home</button>
      </header>

      {/* Body */}
      <div style={{ position:'relative',zIndex:1,minHeight:'calc(100vh - 60px)',maxWidth:920,margin:'0 auto',padding:'28px 20px 60px' }}>

        <div style={{ display:'flex',alignItems:'center',gap:8,fontFamily:'monospace',fontSize:10,fontWeight:600,letterSpacing:'2px',textTransform:'uppercase',color:'#4c1d95',marginBottom:18 }}>
          Past Transactions <div style={{ flex:1,height:1,background:'rgba(109,40,217,.15)' }} />
          {!loading && !error && <span style={{ padding:'2px 8px',borderRadius:6,background:'rgba(109,40,217,.08)',border:'1px solid rgba(109,40,217,.2)',color:'#a78bfa',fontSize:10 }}>{orders.length} receipt{orders.length!==1?'s':''}</span>}
        </div>

        {loading && (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:16,marginTop:70 }}>
            <div style={{ width:40,height:40,borderRadius:'50%',border:'2px solid rgba(124,58,237,.25)',borderTopColor:'#7c3aed',animation:'phSpin .8s linear infinite' }} />
            <span style={{ fontFamily:'monospace',fontSize:11,color:'#4c1d95',letterSpacing:'2px',textTransform:'uppercase' }}>Loading purchases…</span>
          </div>
        )}

        {!loading && error && (
          <div style={{ maxWidth:460,margin:'50px auto 0',textAlign:'center',padding:'32px 24px',borderRadius:16,border:'1px solid rgba(252,165,165,.28)',background:'rgba(8,3,18,.92)' }}>
            <div style={{ fontSize:44,marginBottom:12 }}>⚠️</div>
            <div style={{ fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:800,color:'#fca5a5',marginBottom:8 }}>Couldn’t load history</div>
            <p style={{ fontFamily:'monospace',fontSize:12,color:'#a78bfa',lineHeight:1.6 }}>{error}</p>
          </div>
        )}

        {!loading && !error && orders.length === 0 && (
          <div style={{ maxWidth:460,margin:'50px auto 0',textAlign:'center',padding:'36px 24px',borderRadius:16,border:'1px solid rgba(109,40,217,.28)',background:'rgba(8,3,18,.92)' }}>
            <div style={{ fontSize:44,marginBottom:12,opacity:.5 }}>🧾</div>
            <div style={{ fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:800,color:'#e9d5ff',marginBottom:8 }}>No purchases yet</div>
            <p style={{ fontFamily:'monospace',fontSize:12,color:'#4c1d95',lineHeight:1.6 }}>Completed transactions will appear here once a checkout is paid.</p>
            <button onClick={() => navigate('/transaction')} style={{ marginTop:20,padding:'12px 28px',borderRadius:12,border:'none',cursor:'pointer',fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff' }}>🛒 Start a Transaction</button>
          </div>
        )}

        {!loading && !error && orders.length > 0 && (
          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {orders.map((o, i) => {
              const d       = o.transaction_time ? new Date(o.transaction_time) : null
              const dateStr = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
              const timeStr = d && !isNaN(d) ? d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '—'
              const online  = (o.channel || 'offline') === 'online'
              return (
                <button
                  key={o.transaction_id || i}
                  onClick={() => openOrder(o)}
                  className="ph-row"
                  style={{
                    display:'grid',gridTemplateColumns:'auto 1fr auto',gap:16,alignItems:'center',
                    textAlign:'left',width:'100%',cursor:'pointer',
                    padding:'16px 18px',borderRadius:14,
                    border:'1px solid rgba(109,40,217,.22)',background:'rgba(8,3,18,.88)',
                    backdropFilter:'blur(14px)',
                    animation:`phIn .45s ${i*.03}s cubic-bezier(.22,1,.36,1) both`,
                    transition:'transform .15s, border-color .2s, box-shadow .2s',
                  }}
                >
                  {/* Icon */}
                  <div style={{ width:44,height:44,borderRadius:11,background:'rgba(109,40,217,.12)',border:'1px solid rgba(109,40,217,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0 }}>🧾</div>

                  {/* Middle: txn number + meta */}
                  <div style={{ minWidth:0 }}>
                    <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
                      <span style={{ fontFamily:'monospace',fontSize:15,fontWeight:800,letterSpacing:'1px',color:'#e9d5ff' }}>{o.transaction_id}</span>
                      <span style={{ fontFamily:'monospace',fontSize:9,letterSpacing:'.6px',textTransform:'uppercase',padding:'2px 7px',borderRadius:6,color:online?'#93c5fd':'#86efac',background:online?'rgba(147,197,253,.1)':'rgba(134,239,172,.1)',border:`1px solid ${online?'rgba(147,197,253,.28)':'rgba(134,239,172,.28)'}` }}>{online?'Online':'In-store'}</span>
                    </div>
                    <div style={{ fontFamily:'monospace',fontSize:11,color:'#4c1d95',marginTop:4,letterSpacing:'.4px' }}>
                      {dateStr} · {timeStr} · {o.units || o.line_count || 0} item{(o.units || o.line_count) !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Right: total + chevron */}
                  <div style={{ display:'flex',alignItems:'center',gap:14,flexShrink:0 }}>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontFamily:'monospace',fontSize:9,letterSpacing:'1px',textTransform:'uppercase',color:'#4c1d95',marginBottom:2 }}>Total</div>
                      <div style={{ fontFamily:"'Sora',sans-serif",fontSize:17,fontWeight:800,color:'#86efac' }}>₹{Number(o.total ?? 0).toFixed(2)}</div>
                    </div>
                    <span style={{ fontSize:16,color:'#6d28d9' }}>›</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

const purchasesCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #000; }
  @keyframes phSpin { to { transform: rotate(360deg) } }
  @keyframes phIn   { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform:none } }
  .ph-row:hover { transform: translateY(-1px); border-color: rgba(124,58,237,.5) !important; box-shadow: 0 6px 28px rgba(124,58,237,.2); }
`
