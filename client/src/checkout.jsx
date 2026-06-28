import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/* ── Particle Field ─────────────────────────────────────────── */
function ParticleField() {
  const dots = Array.from({ length: 22 }, (_, i) => ({
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


export default function CheckoutPage({ user, setUser }) {
  const navigate = useNavigate()
  const [mode, setMode]           = useState('hardware')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [gateLocked, setGateLocked] = useState(false)
  const [verdict, setVerdict]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [transactions, setTransactions] = useState([])
  const [alerts, setAlerts]       = useState([])
  const [stats, setStats]         = useState({ total:0, approved:0, blocked:0 })
  const [logFilter, setLogFilter] = useState('all')
  const [fraudFlags, setFraudFlags] = useState(0)
  const [redisStatus, setRedisStatus] = useState('checking')
  const [toast, setToast]         = useState({ msg:'', type:'', show:false })
  const [flash, setFlash]         = useState('')
  const scanBufferRef = useRef('')
  const scanTimerRef  = useRef(null)
  const inputRef      = useRef(null)
  const wsRef         = useRef(null)
  const activeBarcode = useRef('')

  useEffect(() => {
    fetch('/api/health', { credentials:'include' })
      .then(r=>r.json())
      .then(d=>setRedisStatus(d.redis==='connected'?'connected':'offline'))
      .catch(()=>setRedisStatus('offline'))
    showToast('Checkout Terminal active — HID scanner listening', 'info')
  }, [])

  useEffect(() => {
    if (!user?.id) return
    const proto = location.protocol==='https:'?'wss':'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ shopId: user.id }))
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'TXN_RESULT') setVerdict(msg.result)
      } catch {}
    }
    ws.onerror = () => {}
    return () => ws.close()
  }, [user?.id])

  useEffect(() => {
    if (mode !== 'hardware') return
    function onKey(e) {
      if (loading) return
      if (e.key === 'Enter') {
        const code = scanBufferRef.current.trim()
        scanBufferRef.current = ''
        clearTimeout(scanTimerRef.current)
        setBarcodeInput('')
        if (code.length >= 4) handleScan(code)
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        scanBufferRef.current += e.key
        setBarcodeInput(scanBufferRef.current)
        clearTimeout(scanTimerRef.current)
        scanTimerRef.current = setTimeout(() => {
          if (scanBufferRef.current.length >= 6) handleScan(scanBufferRef.current.trim())
          scanBufferRef.current = ''
          setBarcodeInput('')
        }, 120)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(scanTimerRef.current) }
  }, [mode, loading])

  function showToast(msg, type='info') {
    setToast({ msg, type, show:true })
    setTimeout(() => setToast(t=>({...t,show:false})), 4500)
  }

  function flashScreen(color) {
    setFlash(color); setTimeout(() => setFlash(''), 300)
  }

  async function logout() {
    await fetch('/api/logout', { credentials:'include' })
    setUser(null); navigate('/')
  }


  const handleScan = useCallback(async (barcode) => {
    if (!barcode || barcode.length < 4 || loading) return
    activeBarcode.current = barcode
    setLoading(true)
    setGateLocked(true)
    setBarcodeInput(barcode)
    setVerdict({ _processing: true, barcode })

    try {
      const res = await fetch('/api/checkout/verify', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        credentials:'include',
        body: JSON.stringify({ barcode })
      })
      if (res.status === 429) {
        showToast('Duplicate scan blocked by Redis gate', 'warn')
        setVerdict(null); return
      }
      if (res.status === 409) {
        const dupData = await res.json().catch(()=>({}))
        showToast(dupData.message || 'This product was already scanned in this session', 'warn')
        setVerdict({ status:'duplicate_uid', barcode, message: dupData.message || 'Duplicate UID — already scanned in this session' })
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(()=>({}))
        throw new Error(err.message || `Server error ${res.status}`)
      }
      const data = await res.json()

      setVerdict({ ...data, barcode })
      setTransactions(prev => [{
        id:Date.now(), barcode,
        time: new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
        product: data.product_name||'(not found)',
        status: data.status,
        method: data.barcode_format||'HID',
      }, ...prev])
      setStats(s => ({
        total: s.total+1,
        approved: s.approved + (data.status==='approved'?1:0),
        blocked:  s.blocked  + (data.status==='blocked' ?1:0),
      }))
      flashScreen(data.status==='approved'?'green':'red')

      if (data.status==='blocked' && data.fraud_risk>0.6) {
        setFraudFlags(f=>f+1)
        try {
          await fetch('/api/alerts/fraud', {
            method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
            body: JSON.stringify({ barcode, product_name:data.product_name||'Unknown', risk_score:data.fraud_risk, timestamp:new Date().toISOString(), action:'TRANSACTION_BLOCKED' })
          })
          addAlert('FRAUD REPORT', `SendGrid alert sent for barcode ${barcode}`, 'fraud')
          showToast('Fraud alert dispatched via SendGrid', 'error')
        } catch {
          addAlert('ALERT FAILED', `Could not dispatch alert for ${barcode}`, 'warn')
        }
      }
      setTimeout(() => setBarcodeInput(''), 2500)
    } catch (err) {
      showToast('Verification failed: '+err.message, 'error')
      setVerdict(null)
    } finally {
      setLoading(false)
      setGateLocked(false)
      activeBarcode.current = ''
    }
  }, [loading])

  function addAlert(type, detail, cls='fraud') {
    setAlerts(prev => [{ type, detail, time:new Date().toLocaleTimeString(), cls }, ...prev])
  }

  function switchMode(m) {
    setMode(m)
    scanBufferRef.current = ''
    setBarcodeInput('')
    if (m==='manual') setTimeout(()=>inputRef.current?.focus(), 50)
  }

  function clearInput() {
    setBarcodeInput(''); setVerdict(null); setGateLocked(false)
    if (mode==='manual') inputRef.current?.focus()
  }

  function triggerVerify() {
    const val = barcodeInput.trim()
    if (val.length >= 4) handleScan(val)
  }

  const filteredLog = transactions.filter(t => logFilter==='all' || t.status===logFilter)
  const statusColor = { approved:'#86efac', blocked:'#fca5a5', partial:'#fcd34d' }
  const verdictIcon  = { approved:'✅', blocked:'❌', partial:'⚠️', _processing:'⏳' }
  const verdictTitle = { approved:'Transaction Approved', blocked:'Transaction Blocked', partial:'Partial Match — Hold', _processing:'Processing…' }


  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #000; }

        @keyframes particlePulse { 0%,100%{opacity:0;transform:scale(1)} 50%{opacity:.5;transform:scale(1.6)} }
        @keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:1} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes cardIn { from{opacity:0;transform:translateY(18px) scale(.98)} to{opacity:1;transform:none} }
        @keyframes logIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:none} }
        @keyframes vdin { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:none} }

        .hid-input {
          width:100%; background:rgba(109,40,217,.05);
          border:2px solid rgba(109,40,217,.3); border-radius:14px;
          color:#e9d5ff; font-family:'Sora',sans-serif;
          font-size:26px; font-weight:500; letter-spacing:4px;
          text-align:center; padding:20px 60px; outline:none;
          transition:border-color .3s,box-shadow .3s; caret-color:#a78bfa;
        }
        .hid-input:focus { border-color:#7c3aed; box-shadow:0 0 0 4px rgba(124,58,237,.12) }
        .hid-input.locked { border-color:#fcd34d; box-shadow:0 0 0 4px rgba(252,211,77,.1) }
        .hid-input.approved { border-color:#86efac; box-shadow:0 0 0 4px rgba(134,239,172,.12) }
        .hid-input.blocked { border-color:#fca5a5; box-shadow:0 0 0 4px rgba(252,165,165,.12) }
        .log-row:hover { background:rgba(109,40,217,.04) }
        input::placeholder { color: rgba(109,40,217,.4); }
      `}</style>

      {/* Flash overlay */}
      <div style={{position:'fixed',inset:0,zIndex:500,pointerEvents:'none',opacity:flash?1:0,background:flash==='green'?'rgba(134,239,172,.06)':flash==='red'?'rgba(252,165,165,.06)':'transparent',transition:'opacity .1s'}} />

      {/* Background */}
      <div style={{position:'fixed',inset:0,zIndex:0,background:'#000'}} />
      <div style={{position:'fixed',inset:0,zIndex:0,background:'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.18) 0%, transparent 70%)',pointerEvents:'none'}} />
      <div style={{position:'fixed',inset:0,zIndex:0,background:'radial-gradient(ellipse 90% 50% at 50% 120%, rgba(76,29,149,.1) 0%, transparent 60%)',pointerEvents:'none'}} />
      <div style={{position:'fixed',top:60,left:0,right:0,height:1,background:'linear-gradient(to right, transparent, rgba(109,40,217,.25), transparent)',zIndex:1,pointerEvents:'none'}} />
      <ParticleField />


      {/* Topbar */}
      <header style={{position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',height:60,background:'rgba(0,0,0,.72)',borderBottom:'1px solid rgba(109,40,217,.2)',backdropFilter:'blur(22px)'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:34,height:34,borderRadius:9,background:'linear-gradient(135deg,#7c3aed,#4c1d95)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,boxShadow:'0 0 18px rgba(124,58,237,.5)'}}>🛒</div>
          <div>
            <span style={{fontFamily:"'Sora',sans-serif",fontSize:16,fontWeight:800,letterSpacing:'-.3px',color:'#fff'}}>Grahak<span style={{color:'#a78bfa'}}>Sathi</span></span>
            <span style={{fontFamily:'monospace',fontSize:9,color:'#4c1d95',letterSpacing:'1.5px',textTransform:'uppercase',marginLeft:8}}>/ Checkout Terminal</span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:'#86efac',boxShadow:'0 0 8px #86efac',animation:'blink 2s ease-in-out infinite'}} />
          <span style={{fontFamily:'monospace',fontSize:10,color:'#4c1d95',letterSpacing:'1px',textTransform:'uppercase'}}>Terminal Active</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>navigate('/home')} style={{padding:'5px 14px',borderRadius:20,fontSize:11,fontFamily:"'Sora',sans-serif",background:'transparent',border:'1px solid rgba(109,40,217,.3)',color:'#6d28d9',cursor:'pointer',transition:'all .2s'}}>🔍 Verify</button>
          <button onClick={logout} style={{padding:'6px 16px',borderRadius:20,fontSize:12,fontWeight:700,fontFamily:"'Sora',sans-serif",background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff',border:'none',cursor:'pointer',boxShadow:'0 0 16px rgba(124,58,237,.35)'}}>Sign Out</button>
        </div>
      </header>

      {/* Main grid */}
      <div style={{position:'relative',zIndex:1,display:'grid',gridTemplateColumns:'1fr 380px',gap:20,padding:'20px 24px',maxWidth:1400,margin:'0 auto',minHeight:'calc(100vh - 60px)'}}>

        {/* Left column */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>

          <div style={{display:'flex',alignItems:'center',gap:8,fontFamily:'monospace',fontSize:10,fontWeight:600,letterSpacing:'2px',textTransform:'uppercase',color:'#4c1d95'}}>
            Barcode Input <div style={{flex:1,height:1,background:'rgba(109,40,217,.15)'}} />
          </div>

          {/* Scanner card */}
          <div style={{background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:20,padding:24,position:'relative',overflow:'hidden',backdropFilter:'blur(14px)',animation:'cardIn .7s cubic-bezier(.22,1,.36,1) both'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,#7c3aed,transparent)',animation:'shimmer 3s ease-in-out infinite'}} />

            {/* HID Status */}
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderRadius:10,background:'rgba(0,0,0,.3)',border:'1px solid rgba(109,40,217,.15)',marginBottom:18,fontFamily:'monospace',fontSize:11}}>
              <div style={{width:8,height:8,borderRadius:'50%',flexShrink:0,background:mode==='hardware'?'#86efac':'#fcd34d',boxShadow:`0 0 8px ${mode==='hardware'?'#86efac':'#fcd34d'}`,animation:'blink 1.5s ease-in-out infinite'}} />
              <span style={{color:'#c4b5fd'}}>{mode==='hardware'?'HID Barcode Scanner — Listening for input…':'Manual Entry Mode — hardware scanner paused'}</span>
              <span style={{marginLeft:'auto',padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,letterSpacing:'.5px',background:mode==='hardware'?'rgba(134,239,172,.08)':'rgba(252,211,77,.08)',border:`1px solid ${mode==='hardware'?'rgba(134,239,172,.3)':'rgba(252,211,77,.3)'}`,color:mode==='hardware'?'#86efac':'#fcd34d'}}>{mode.toUpperCase()}</span>
            </div>

            {/* Mode toggle */}
            <div style={{display:'flex',gap:10,marginBottom:14}}>
              {[{id:'hardware',label:'📡 Hardware Scanner'},{id:'manual',label:'⌨️ Manual Entry'}].map(m=>(
                <button key={m.id} onClick={()=>switchMode(m.id)} style={{flex:1,padding:10,borderRadius:10,cursor:'pointer',fontFamily:'monospace',fontSize:12,fontWeight:600,letterSpacing:'.5px',border:`1px solid ${mode===m.id?(m.id==='hardware'?'rgba(134,239,172,.35)':'rgba(167,139,250,.4)'):'rgba(109,40,217,.2)'}`,background:mode===m.id?(m.id==='hardware'?'rgba(134,239,172,.06)':'rgba(124,58,237,.08)'):'rgba(255,255,255,.02)',color:mode===m.id?(m.id==='hardware'?'#86efac':'#a78bfa'):'#4c1d95',transition:'all .25s'}}>
                  {m.label}
                </button>
              ))}
            </div>

            {/* Barcode input */}
            <div style={{position:'relative',marginBottom:16}}>
              <span style={{position:'absolute',left:18,top:'50%',transform:'translateY(-50%)',fontSize:22,opacity:.5,pointerEvents:'none'}}>🔲</span>
              <input ref={inputRef} className={`hid-input${loading?' locked':verdict&&verdict.status?' '+verdict.status:''}`}
                type="text" placeholder="Scan barcode or type manually…"
                value={barcodeInput}
                readOnly={mode==='hardware'}
                onChange={e=>{ if(mode==='manual') setBarcodeInput(e.target.value) }}
                onKeyDown={e=>{ if(mode==='manual'&&e.key==='Enter'&&barcodeInput.trim().length>=4) triggerVerify() }}
              />
              <button onClick={clearInput} style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#4c1d95',transition:'color .2s',padding:4}}>✕</button>
            </div>

            {/* Redis gate */}
            <div style={{margin:'0 0 14px',padding:'8px 12px',borderRadius:8,background:'rgba(0,0,0,.3)',border:`1px solid ${gateLocked?'rgba(252,211,77,.25)':'rgba(134,239,172,.2)'}`,fontFamily:'monospace',fontSize:10,letterSpacing:'.5px',display:'flex',alignItems:'center',gap:8,color:gateLocked?'#fcd34d':'#86efac'}}>
              <div style={{width:5,height:5,borderRadius:'50%',background:gateLocked?'#fcd34d':'#86efac',boxShadow:`0 0 6px ${gateLocked?'#fcd34d':'#86efac'}`}} />
              {gateLocked?`REDIS GATE: LOCKED — Processing ${activeBarcode.current}`:'REDIS GATE: UNLOCKED — Ready for next scan'}
            </div>

            {/* Verify button (manual mode) */}
            {mode==='manual' && (
              <button onClick={triggerVerify} disabled={loading||barcodeInput.trim().length<4}
                style={{width:'100%',padding:14,border:'none',borderRadius:12,cursor:'pointer',fontFamily:"'Sora',sans-serif",fontSize:15,fontWeight:800,letterSpacing:'.5px',background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff',transition:'transform .2s,box-shadow .3s',boxShadow:'0 4px 28px rgba(124,58,237,.35)',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(loading||barcodeInput.trim().length<4)?.35:1}}>
                {loading ? <span style={{width:18,height:18,border:'2.5px solid rgba(255,255,255,.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .7s linear infinite',display:'inline-block'}} /> : '⚡ Verify Transaction'}
              </button>
            )}
          </div>


          {/* Verdict card */}
          {verdict && (
            <div style={{borderRadius:18,border:`1px solid ${verdict._processing?'rgba(124,58,237,.3)':verdict.status==='approved'?'rgba(134,239,172,.3)':'rgba(252,165,165,.3)'}`,background:verdict._processing?'rgba(109,40,217,.04)':verdict.status==='approved'?'rgba(134,239,172,.04)':'rgba(252,165,165,.04)',overflow:'hidden',position:'relative',backdropFilter:'blur(14px)',animation:'vdin .5s cubic-bezier(.22,1,.36,1) both'}}>
              <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${verdict._processing?'#7c3aed':verdict.status==='approved'?'#86efac':'#fca5a5'},transparent)`,animation:verdict._processing?'shimmer 1s linear infinite':undefined}} />
              <div style={{padding:'20px 22px 16px',display:'flex',alignItems:'center',gap:14}}>
                <div style={{fontSize:36}}>{verdict._processing?'⏳':verdictIcon[verdict.status]||'❓'}</div>
                <div>
                  <div style={{fontFamily:"'Sora',sans-serif",fontSize:20,fontWeight:800,letterSpacing:'-.3px',color:verdict._processing?'#a78bfa':statusColor[verdict.status]||'#e9d5ff'}}>
                    {verdict._processing?'Processing…':verdictTitle[verdict.status]||'Unknown'}
                  </div>
                  <div style={{fontSize:13,color:'#c4b5fd',marginTop:3,lineHeight:1.5}}>
                    {verdict._processing?`Checking barcode ${verdict.barcode} against inventory…`:verdict.message||`Barcode: ${verdict.barcode}`}
                  </div>
                </div>
              </div>
              {!verdict._processing && (
                <>
                  <div style={{margin:'0 22px 16px',padding:'10px 14px',borderRadius:10,fontFamily:'monospace',fontSize:12,fontWeight:700,letterSpacing:'.5px',display:'flex',alignItems:'center',gap:8,border:`1px solid ${verdict.status==='approved'?'rgba(134,239,172,.3)':'rgba(252,165,165,.3)'}`,background:verdict.status==='approved'?'rgba(134,239,172,.06)':'rgba(252,165,165,.06)',color:statusColor[verdict.status]}}>
                    {verdict.status==='approved'?'✅ APPROVED — Product verified. Proceed to checkout.':verdict.status==='blocked'?'🔒 BLOCKED — Mismatch or fraud detected. Do not process.':'⏸ ON HOLD — Manual supervisor review required.'}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderTop:'1px solid rgba(109,40,217,.1)'}}>
                    {[
                      ['Barcode', verdict.barcode, 'mono-big'],
                      ['Format', verdict.barcode_format||'EAN-13', verdict.status==='approved'?'green':''],
                      ['Product', verdict.product_name||'— Not found', verdict.status==='approved'?'green':verdict.status==='blocked'?'red':'amber'],
                      ['Price', verdict.price?`₹${verdict.price.toFixed(2)}`:'—', verdict.status==='approved'?'green':''],
                      ['Stock', verdict.quantity!==undefined?`${verdict.quantity} units`:'—', verdict.quantity>0?'green':'red'],
                      ['Risk Score', verdict.fraud_risk!==undefined?`${(verdict.fraud_risk*100).toFixed(0)}%`:'—', verdict.fraud_risk>0.6?'red':verdict.fraud_risk>0.3?'amber':'green'],
                    ].map(([k,v,cls],i)=>(
                      <div key={i} style={{padding:'14px 22px',borderRight:i%2===0?'1px solid rgba(109,40,217,.08)':'none',borderTop:i>=2?'1px solid rgba(109,40,217,.08)':'none'}}>
                        <div style={{fontSize:10,color:'#4c1d95',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:4,fontFamily:'monospace'}}>{k}</div>
                        <div style={{fontSize:cls==='mono-big'?18:14,color:cls==='green'?'#86efac':cls==='red'?'#fca5a5':cls==='amber'?'#fcd34d':'#e9d5ff',fontFamily:'monospace',fontWeight:cls==='mono-big'||cls==='green'||cls==='red'||cls==='amber'?600:400,letterSpacing:cls==='mono-big'?2:0,wordBreak:'break-all'}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Transaction log */}
          <div style={{display:'flex',alignItems:'center',gap:8,fontFamily:'monospace',fontSize:10,fontWeight:600,letterSpacing:'2px',textTransform:'uppercase',color:'#4c1d95'}}>
            Transaction Log <div style={{flex:1,height:1,background:'rgba(109,40,217,.15)'}} />
          </div>
          <div style={{background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:18,overflow:'hidden',backdropFilter:'blur(14px)',animation:'cardIn .7s .2s cubic-bezier(.22,1,.36,1) both'}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid rgba(109,40,217,.15)',display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(0,0,0,.3)'}}>
              <span style={{fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:700,color:'#e9d5ff',letterSpacing:'.3px'}}>Session Transactions</span>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{display:'flex',gap:6}}>
                  {['all','approved','blocked'].map(f=>(
                    <button key={f} onClick={()=>setLogFilter(f)} style={{padding:'3px 10px',borderRadius:8,fontSize:10,fontWeight:600,letterSpacing:'.5px',border:`1px solid ${logFilter===f?'rgba(124,58,237,.4)':'rgba(109,40,217,.15)'}`,background:logFilter===f?'rgba(109,40,217,.1)':'transparent',color:logFilter===f?'#a78bfa':'#4c1d95',cursor:'pointer',fontFamily:'monospace',transition:'all .2s'}}>
                      {f==='all'?'All':f==='approved'?'✓':'✗'}
                    </button>
                  ))}
                </div>
                <span style={{fontFamily:'monospace',fontSize:11,color:'#4c1d95',padding:'2px 8px',background:'rgba(109,40,217,.06)',borderRadius:6}}>{transactions.length} scan{transactions.length!==1?'s':''}</span>
              </div>
            </div>
            <div style={{maxHeight:340,overflowY:'auto'}}>
              {filteredLog.length===0
                ? <div style={{padding:32,textAlign:'center',color:'#4c1d95',fontFamily:'monospace',fontSize:12}}>No transactions yet — scan a barcode to begin</div>
                : filteredLog.map((t,i)=>(
                  <div key={t.id} className="log-row" style={{display:'grid',gridTemplateColumns:'20px 90px 1fr 80px 80px',gap:12,alignItems:'center',padding:'11px 20px',borderBottom:'1px solid rgba(109,40,217,.06)',fontFamily:'monospace',fontSize:12,animation:`logIn .3s ${Math.min(i,5)*.04}s ease both`,transition:'background .2s'}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:statusColor[t.status]||'#c4b5fd',boxShadow:`0 0 6px ${statusColor[t.status]||'#c4b5fd'}`}} />
                    <div style={{color:'#4c1d95',fontSize:11}}>{t.time}</div>
                    <div style={{color:'#e9d5ff',letterSpacing:1}}>{t.barcode}</div>
                    <div style={{color:'#c4b5fd',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.product}</div>
                    <div style={{fontSize:10,fontWeight:700,letterSpacing:'.5px',textAlign:'right',color:statusColor[t.status]}}>{t.status.toUpperCase()}</div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>


        {/* Sidebar */}
        <div style={{display:'flex',flexDirection:'column',gap:14,position:'sticky',top:80}}>
          {[
            {label:'Total Scans',   value:stats.total,    color:'#a78bfa', icon:'🔲', sub:'This session'},
            {label:'Approved',      value:stats.approved, color:'#86efac', icon:'✅', sub:'Transactions cleared'},
            {label:'Blocked',       value:stats.blocked,  color:'#fca5a5', icon:'🚫', sub:'Fraud / mismatch'},
          ].map((s,i)=>(
            <div key={i} style={{background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:16,padding:'18px 20px',position:'relative',overflow:'hidden',backdropFilter:'blur(14px)',animation:`cardIn .6s ${.1+i*.08}s cubic-bezier(.22,1,.36,1) both`}}>
              <div style={{fontSize:10,color:'#4c1d95',letterSpacing:'1.5px',textTransform:'uppercase',fontFamily:'monospace',marginBottom:8}}>{s.label}</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:28,fontWeight:800,lineHeight:1,marginBottom:4,color:s.color}}>{s.value}</div>
              <div style={{fontSize:11,color:'#4c1d95',fontFamily:'monospace'}}>{s.sub}</div>
              <div style={{position:'absolute',top:14,right:14,width:36,height:36,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,background:'rgba(109,40,217,.08)',border:'1px solid rgba(109,40,217,.15)'}}>{s.icon}</div>
            </div>
          ))}

          {/* Alerts */}
          <div style={{background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:16,overflow:'hidden',backdropFilter:'blur(14px)',animation:'cardIn .7s .3s cubic-bezier(.22,1,.36,1) both'}}>
            <div style={{padding:'12px 18px',borderBottom:'1px solid rgba(109,40,217,.15)',background:'rgba(0,0,0,.3)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:700,color:'#e9d5ff'}}>Alerts Fired</span>
              <div style={{width:20,height:20,borderRadius:'50%',background:'rgba(252,165,165,.15)',border:'1px solid rgba(252,165,165,.3)',color:'#fca5a5',fontSize:10,fontWeight:800,fontFamily:'monospace',display:'flex',alignItems:'center',justifyContent:'center'}}>{alerts.length}</div>
            </div>
            <div style={{maxHeight:220,overflowY:'auto'}}>
              {alerts.length===0
                ? <div style={{padding:20,textAlign:'center',color:'#4c1d95',fontFamily:'monospace',fontSize:11}}>No alerts yet</div>
                : alerts.map((a,i)=>(
                  <div key={i} style={{padding:'10px 18px',borderBottom:'1px solid rgba(109,40,217,.06)',fontFamily:'monospace',fontSize:11,animation:'logIn .3s ease both'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                      <span style={{fontWeight:700,fontSize:10,letterSpacing:'.5px',color:a.cls==='fraud'?'#fca5a5':a.cls==='warn'?'#fcd34d':'#86efac'}}>{a.type}</span>
                      <span style={{color:'#4c1d95',marginLeft:'auto',fontSize:10}}>{a.time}</span>
                    </div>
                    <div style={{color:'#c4b5fd',fontSize:10,lineHeight:1.5}}>{a.detail}</div>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Redis widget */}
          <div style={{background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:16,padding:'16px 18px',backdropFilter:'blur(14px)',animation:'cardIn .7s .38s cubic-bezier(.22,1,.36,1) both'}}>
            <div style={{fontFamily:"'Sora',sans-serif",fontSize:12,fontWeight:700,color:'#e9d5ff',marginBottom:12,display:'flex',alignItems:'center',gap:7}}>⚡ Redis Gate Status</div>
            {[
              ['Connection',    redisStatus==='connected'?'CONNECTED':'OFFLINE', redisStatus==='connected'?'#86efac':'#fcd34d'],
              ['Active Locks',  gateLocked?'1':'0',                              gateLocked?'#fcd34d':'#e9d5ff'],
              ['Session Store', 'REDIS',                                          '#86efac'],
              ['Gate Strategy', 'SET NX EX 5',                                   '#a78bfa'],
              ['Fraud Flags',   String(fraudFlags),                              fraudFlags>0?'#fca5a5':'#fcd34d'],
            ].map(([k,v,c])=>(
              <div key={k} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid rgba(109,40,217,.06)',fontFamily:'monospace',fontSize:11}}>
                <span style={{color:'#4c1d95'}}>{k}</span>
                <span style={{color:c,fontWeight:500}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toast */}
      <div style={{position:'fixed',bottom:22,right:22,zIndex:999,padding:'12px 18px',borderRadius:12,fontSize:13,fontWeight:500,display:'flex',alignItems:'center',gap:8,pointerEvents:'none',transform:toast.show?'translateY(0)':'translateY(80px)',opacity:toast.show?1:0,transition:'transform .4s cubic-bezier(.22,1,.36,1),opacity .4s',maxWidth:340,lineHeight:1.4,fontFamily:"'Sora',sans-serif",background:toast.type==='success'?'rgba(22,163,74,.14)':toast.type==='error'?'rgba(220,38,38,.14)':toast.type==='warn'?'rgba(217,119,6,.14)':'rgba(109,40,217,.14)',border:`1px solid ${toast.type==='success'?'rgba(134,239,172,.38)':toast.type==='error'?'rgba(252,165,165,.38)':toast.type==='warn'?'rgba(252,211,77,.38)':'rgba(167,139,250,.38)'}`,color:toast.type==='success'?'#86efac':toast.type==='error'?'#fca5a5':toast.type==='warn'?'#fcd34d':'#a78bfa',backdropFilter:'blur(14px)'}}>
        {toast.msg}
      </div>
    </>
  )
}
