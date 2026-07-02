import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

/* ── Order Status page ───────────────────────────────────────
 * Shown when a barcode that was already scanned/checked-out in the
 * current session is re-scanned. It displays the order status for
 * that already-purchased item together with its transaction number.
 *
 * The order can arrive two ways:
 *   1) location.state.order  — passed straight from the duplicate-scan
 *      response on the Transaction page (no extra round-trip).
 *   2) fetched from /api/checkout/order-status?barcode=… | ?transaction_id=…
 *      when the page is opened directly / refreshed.
 * ──────────────────────────────────────────────────────────── */
export default function OrderStatusPage({ user, setUser }) {
  const navigate = useNavigate()
  const location = useLocation()

  const stateOrder   = location.state?.order || null
  const stateBarcode = location.state?.barcode || null
  const stateTxnId   = location.state?.transactionId || stateOrder?.transaction_id || null

  const [order, setOrder]     = useState(stateOrder)
  const [loading, setLoading] = useState(!stateOrder)
  const [error, setError]     = useState(null)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    if (stateOrder) return   // already have everything we need
    let alive = true

    const params = new URLSearchParams(window.location.search)
    const qBarcode = stateBarcode || params.get('barcode') || ''
    const qTxn     = stateTxnId   || params.get('transaction_id') || ''

    const qs = qTxn ? `transaction_id=${encodeURIComponent(qTxn)}`
             : qBarcode ? `barcode=${encodeURIComponent(qBarcode)}`
             : ''

    setLoading(true)
    fetch(`/api/checkout/order-status${qs ? `?${qs}` : ''}`, { credentials: 'include' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d.found) throw new Error(d.message || 'No order found for this item in your session.')
        return d
      })
      .then(d => { if (alive) { setOrder(d); setError(null) } })
      .catch(e => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [])

  function copyTxn() {
    if (!order?.transaction_id) return
    try {
      navigator.clipboard.writeText(order.transaction_id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  const d       = order?.transaction_time ? new Date(order.transaction_time) : null
  const dateStr = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
  const timeStr = d && !isNaN(d) ? d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'
  const items   = order?.items || []
  const total   = order?.total ?? items.reduce((s, it) => s + (it.price || 0) * (it.quantity || 1) * 1.18, 0)

  return (
    <>
      <style>{orderCSS}</style>

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
            <span style={{ fontFamily:'monospace',fontSize:9,color:'#4c1d95',letterSpacing:'1.5px',textTransform:'uppercase',marginLeft:8 }}>/ Order Status</span>
          </div>
        </div>
        <button onClick={() => navigate('/transaction')} style={{ padding:'6px 16px',borderRadius:20,fontSize:12,fontWeight:700,fontFamily:"'Sora',sans-serif",background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff',border:'none',cursor:'pointer',boxShadow:'0 0 16px rgba(124,58,237,.35)' }}>← Back to Cart</button>
      </header>

      {/* Body */}
      <div style={{ position:'relative',zIndex:1,minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'32px 20px' }}>

        {loading && (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:16,marginTop:80 }}>
            <div style={{ width:40,height:40,borderRadius:'50%',border:'2px solid rgba(124,58,237,.25)',borderTopColor:'#7c3aed',animation:'osSpin .8s linear infinite' }} />
            <span style={{ fontFamily:'monospace',fontSize:11,color:'#4c1d95',letterSpacing:'2px',textTransform:'uppercase' }}>Loading order…</span>
          </div>
        )}

        {!loading && error && (
          <div style={{ maxWidth:460,width:'100%',marginTop:60,textAlign:'center',padding:'32px 24px',borderRadius:16,border:'1px solid rgba(252,211,77,.28)',background:'rgba(8,3,18,.92)' }}>
            <div style={{ fontSize:44,marginBottom:12 }}>🔎</div>
            <div style={{ fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:800,color:'#fcd34d',marginBottom:8 }}>No order found yet</div>
            <p style={{ fontFamily:'monospace',fontSize:12,color:'#a78bfa',lineHeight:1.6 }}>{error}</p>
            <button onClick={() => navigate('/transaction')} style={{ marginTop:20,padding:'12px 28px',borderRadius:12,border:'none',cursor:'pointer',fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff' }}>← Back to Cart</button>
          </div>
        )}

        {!loading && !error && order && (
          <div style={{ width:'min(94vw, 520px)',borderRadius:18,overflow:'hidden',border:'1px solid rgba(109,40,217,.28)',background:'rgba(8,3,18,.92)',backdropFilter:'blur(14px)',animation:'osIn .5s cubic-bezier(.22,1,.36,1) both',boxShadow:'0 8px 48px rgba(124,58,237,.18)' }}>

            {/* Header */}
            <div style={{ padding:'16px 20px',borderBottom:'1px solid rgba(109,40,217,.18)',background:'rgba(0,0,0,.35)',display:'flex',alignItems:'center',gap:10 }}>
              <span style={{ fontSize:18 }}>🧾</span>
              <div>
                <div style={{ fontFamily:"'Sora',sans-serif",fontSize:15,fontWeight:800,color:'#e9d5ff' }}>Order Status</div>
                <div style={{ fontFamily:'monospace',fontSize:10,color:'#4c1d95',letterSpacing:'.6px',marginTop:2 }}>Already purchased in this session</div>
              </div>
              <span style={{ marginLeft:'auto',fontFamily:'monospace',fontSize:9,letterSpacing:'.8px',textTransform:'uppercase',padding:'4px 10px',borderRadius:6,color:'#86efac',background:'rgba(134,239,172,.1)',border:'1px solid rgba(134,239,172,.28)' }}>✓ Confirmed</span>
            </div>

            {/* Transaction number — hero */}
            <div style={{ padding:'20px',borderBottom:'1px solid rgba(109,40,217,.14)',textAlign:'center' }}>
              <div style={{ fontFamily:'monospace',fontSize:10,color:'#4c1d95',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:8 }}>Transaction Number — keep for refunds</div>
              <div style={{ display:'inline-flex',alignItems:'center',gap:12,padding:'12px 20px',borderRadius:12,background:'rgba(124,58,237,.1)',border:'1px solid rgba(124,58,237,.35)' }}>
                <span style={{ fontFamily:'monospace',fontSize:24,fontWeight:800,letterSpacing:'2px',color:'#e9d5ff' }}>{order.transaction_id || '—'}</span>
                {order.transaction_id && (
                  <button onClick={copyTxn} title="Copy transaction number" style={{ padding:'7px 13px',borderRadius:8,border:'1px solid rgba(109,40,217,.35)',background:'transparent',color:copied?'#86efac':'#a78bfa',cursor:'pointer',fontSize:12,transition:'color .2s' }}>
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                )}
              </div>
            </div>

            {/* Meta grid: date / time / channel */}
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:1,background:'rgba(109,40,217,.12)' }}>
              {[
                ['Date', dateStr],
                ['Time', timeStr],
                ['Channel', (order.channel || 'offline') === 'online' ? 'Online' : 'In-store'],
              ].map(([k,v],i)=>(
                <div key={i} style={{ background:'rgba(8,3,18,.92)',padding:'12px 14px' }}>
                  <div style={{ fontFamily:'monospace',fontSize:9,letterSpacing:'1.2px',textTransform:'uppercase',color:'#4c1d95',marginBottom:4 }}>{k}</div>
                  <div style={{ fontFamily:'monospace',fontSize:12,color:'#e9d5ff',fontWeight:600,wordBreak:'break-word' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Items */}
            <div style={{ padding:'6px 0' }}>
              <div style={{ padding:'10px 20px 6px',fontFamily:'monospace',fontSize:9,letterSpacing:'1.2px',textTransform:'uppercase',color:'#4c1d95' }}>Items ({items.length})</div>
              {items.map((it, i) => (
                <div key={i} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 20px',borderTop:'1px solid rgba(109,40,217,.08)' }}>
                  <div style={{ width:34,height:34,borderRadius:8,background:'rgba(109,40,217,.1)',border:'1px solid rgba(109,40,217,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,flexShrink:0 }}>📦</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontFamily:"'Sora',sans-serif",fontSize:13,color:'#e9d5ff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{it.product_name || 'Item'}</div>
                    <div style={{ fontFamily:'monospace',fontSize:10,color:'#4c1d95',marginTop:2,letterSpacing:'.4px' }}>
                      {it.barcode || '—'} · qty {it.quantity || 1}{it.mk_id ? ` · MK ${it.mk_id}` : ''}
                    </div>
                  </div>
                  <div style={{ fontFamily:'monospace',fontSize:13,fontWeight:600,color:'#c4b5fd',flexShrink:0 }}>
                    {it.price != null ? `₹${(it.price * (it.quantity || 1)).toFixed(2)}` : '—'}
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            {(order.subtotal != null || order.gst != null) && (
              <div style={{ padding:'8px 20px 0' }}>
                {order.subtotal != null && (
                  <div style={{ display:'flex',justifyContent:'space-between',padding:'5px 0',fontFamily:'monospace',fontSize:12 }}>
                    <span style={{ color:'#4c1d95' }}>Subtotal</span><span style={{ color:'#c4b5fd' }}>₹{Number(order.subtotal).toFixed(2)}</span>
                  </div>
                )}
                {order.gst != null && (
                  <div style={{ display:'flex',justifyContent:'space-between',padding:'5px 0',fontFamily:'monospace',fontSize:12 }}>
                    <span style={{ color:'#4c1d95' }}>GST (18%)</span><span style={{ color:'#c4b5fd' }}>₹{Number(order.gst).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',marginTop:6,borderTop:'1px solid rgba(109,40,217,.18)',background:'rgba(0,0,0,.35)' }}>
              <span style={{ fontFamily:'monospace',fontSize:10,letterSpacing:'1px',textTransform:'uppercase',color:'#a78bfa' }}>Total Paid</span>
              <span style={{ fontFamily:"'Sora',sans-serif",fontSize:20,fontWeight:800,color:'#86efac' }}>₹{Number(total).toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

const orderCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #000; }
  @keyframes osSpin { to { transform: rotate(360deg) } }
  @keyframes osIn   { from { opacity:0; transform: translateY(18px) scale(.98) } to { opacity:1; transform:none } }
`
