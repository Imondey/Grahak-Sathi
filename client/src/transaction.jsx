import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

/* ── Tiny uid ──────────────────────────────────────────────── */
let _uid = 0
const uid = () => ++_uid

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


/* ── Scan input card (product image + typed barcode + MK ID) ─────────── */
function ScanCapture({ onVerified, scanning, setScanning }) {
  const [productB64, setProductB64]   = useState(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [mkIdInput, setMkIdInput]     = useState('')
  const [step, setStep]               = useState('idle')
  const [camOpen, setCamOpen]         = useState(false)
  const [camTarget, setCamTarget]     = useState(null)
  const [flash, setFlash]             = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const productRef      = useRef(null)
  const barcodeFieldRef = useRef(null)
  const mkIdFieldRef    = useRef(null)
  const videoRef        = useRef(null)
  const streamRef       = useRef(null)

  useEffect(() => {
    const src = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.2/tesseract.min.js'
    if (!document.querySelector(`script[src="${src}"]`)) {
      const s = document.createElement('script'); s.src = src; document.head.appendChild(s)
    }
  }, [])

  useEffect(() => {
    if (step === 'barcode') {
      const t = setTimeout(() => barcodeFieldRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
    if (step === 'mkid') {
      const t = setTimeout(() => mkIdFieldRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
  }, [step])

  function readFile(file, setter, type) {
    const r = new FileReader()
    r.onload = e => { setter(e.target.result); setStep(type === 'product' ? 'barcode' : 'ready') }
    r.readAsDataURL(file)
  }

  async function openCamera(target) {
    setCamTarget(target); setCamOpen(true)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = s
      if (videoRef.current) videoRef.current.srcObject = s
    } catch { closeCamera() }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOpen(false); setCamTarget(null)
  }

  function captureFromCamera() {
    const v = videoRef.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    const b64 = c.toDataURL('image/jpeg', .9)
    closeCamera()
    setProductB64(b64); setStep('barcode')
  }

  function submitBarcode() {
    const v = barcodeInput.trim()
    if (v.length < 4 || !productB64 || scanning) return
    setStep('mkid')
  }

  function submitMkId() {
    if (!productB64 || barcodeInput.trim().length < 4 || scanning) return
    // MK ID is optional but recommended — proceed to verify
    setStep('ready')
  }


  async function runVerify() {
    const barcodeValue = barcodeInput.trim()
    const mkIdValue = mkIdInput.trim()
    if (!productB64 || !barcodeValue) return
    setStep('verifying'); setScanning(true)
    setFlash(true); setTimeout(() => setFlash(false), 350)

    let productOcrText = ''
    try {
      if (window.Tesseract) {
        const w = await window.Tesseract.createWorker('eng')
        const { data: { text } } = await w.recognize(productB64)
        await w.terminate()
        productOcrText = text.trim().replace(/\s+/g, ' ')
      }
    } catch {}

    try {
      const res = await fetch('/api/checkout/match-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          barcode:     barcodeValue,
          mk_id:       mkIdValue || undefined,
          product_ocr: productOcrText || '',
          barcode_ocr: barcodeValue,
          yolo_label:  '',
          image_b64:   productB64?.split(',')[1] || null,
        }),
      })
      if (res.status === 409) {
        // Duplicate UID — already scanned in this session
        const dupData = await res.json().catch(() => ({}))
        await onVerified(dupData, barcodeValue, productB64, null, mkIdValue)
      } else if (!res.ok) {
        throw new Error(`${res.status}`)
      } else {
        const data = await res.json()
        await onVerified(data, barcodeValue, productB64, null, mkIdValue)
      }
    } catch (err) {
      await onVerified(null, barcodeValue, productB64, err.message, mkIdValue)
    } finally {
      setProductB64(null); setBarcodeInput(''); setMkIdInput('')
      setStep('idle'); setScanning(false)
    }
  }

  useEffect(() => {
    if (step === 'ready') runVerify()
  }, [step])

  const stepMeta = {
    idle:      { label: 'Step 1 — Product image',   color: '#a78bfa', icon: '📦' },
    product:   { label: 'Step 1 — Product image',   color: '#a78bfa', icon: '📦' },
    barcode:   { label: 'Step 2 — Enter barcode #', color: '#c4b5fd', icon: '⌨️' },
    mkid:      { label: 'Step 3 — MK ID (Serial #)', color: '#fcd34d', icon: '🏭' },
    ready:     { label: 'Sending to AI…',           color: '#e9d5ff', icon: '⚡' },
    verifying: { label: 'AI Verifying…',            color: '#e9d5ff', icon: '⚡' },
  }
  const sm = stepMeta[step]


  return (
    <>
      {/* camera modal */}
      {camOpen && (
        <div onClick={e => e.target === e.currentTarget && closeCamera()}
          style={{ position:'fixed',inset:0,zIndex:300,background:'rgba(0,0,0,.92)',backdropFilter:'blur(16px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ width:'100%',maxWidth:480,borderRadius:20,overflow:'hidden',border:'1px solid rgba(124,58,237,.38)',background:'rgba(8,3,18,.95)' }}>
            <div style={{ padding:'12px 18px',borderBottom:'1px solid rgba(109,40,217,.22)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
              <span style={{ fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,color:'#e9d5ff' }}>
                📦 Capture Product
              </span>
              <button onClick={closeCamera} style={{ width:26,height:26,borderRadius:'50%',background:'rgba(239,68,68,.14)',border:'none',color:'#f87171',fontSize:13,cursor:'pointer' }}>✕</button>
            </div>
            <div style={{ position:'relative',aspectRatio:'4/3',background:'#000',overflow:'hidden' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width:'100%',height:'100%',objectFit:'cover' }} />
              <div style={{ position:'absolute',left:'10%',right:'10%',height:2,background:'linear-gradient(90deg,transparent,#a78bfa,transparent)',boxShadow:'0 0 14px #7c3aed',animation:'scanLine 1.8s ease-in-out infinite' }} />
            </div>
            <div style={{ padding:14,display:'flex',gap:10 }}>
              <button onClick={captureFromCamera} style={{ flex:1,padding:12,border:'none',borderRadius:10,cursor:'pointer',fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff' }}>📸 Capture</button>
              <button onClick={closeCamera} style={{ padding:'12px 16px',borderRadius:10,cursor:'pointer',background:'transparent',border:'1px solid rgba(109,40,217,.3)',color:'#5b21b6',fontSize:13 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{
        background: flash ? 'rgba(124,58,237,.07)' : 'rgba(8,3,18,.88)',
        border: `1px solid ${sm.color}38`,
        borderRadius: 20, overflow: 'hidden', position: 'relative',
        transition: 'background .2s',
        backdropFilter: 'blur(14px)',
        boxShadow: `0 0 44px ${sm.color}1a`,
      }}>
        <div style={{ position:'absolute',top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${sm.color},transparent)`,animation:'shimmer 2.5s ease-in-out infinite' }} />

        {/* Header */}
        <div style={{ padding:'16px 20px',borderBottom:'1px solid rgba(109,40,217,.18)',display:'flex',alignItems:'center',gap:12 }}>
          <div style={{ width:38,height:38,borderRadius:10,background:`rgba(109,40,217,.15)`,border:`1px solid ${sm.color}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:`0 0 14px ${sm.color}30` }}>{sm.icon}</div>
          <div>
            <div style={{ fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,color:'#e9d5ff' }}>{sm.label}</div>
            <div style={{ fontSize:10,color:'#4c1d95',fontFamily:'monospace',letterSpacing:'1px',marginTop:2 }}>
              {step==='verifying' ? 'YOLOv8 + EasyOCR running…' : 'Upload or capture image'}
            </div>
          </div>
          {step==='verifying' && (
            <div style={{ marginLeft:'auto',width:20,height:20,border:'2px solid rgba(167,139,250,.25)',borderTopColor:'#a78bfa',borderRadius:'50%',animation:'spin .7s linear infinite' }} />
          )}
        </div>

        {/* Progress dots */}
        <div style={{ padding:'12px 20px',display:'flex',alignItems:'center',gap:8 }}>
          {['product','barcode','mkid'].map((s,i) => {
            const done = (s==='product' && (productB64||step==='barcode'||step==='mkid'||step==='ready'||step==='verifying'))
                      || (s==='barcode' && (barcodeInput.trim().length>=4 && (step==='mkid'||step==='ready'||step==='verifying')))
                      || (s==='mkid' && (step==='ready'||step==='verifying'))
            const active = (s==='product' && (step==='idle'||step==='product'))
                        || (s==='barcode' && step==='barcode')
                        || (s==='mkid' && step==='mkid')
            return (
              <div key={s} style={{ display:'flex',alignItems:'center',gap:8 }}>
                <div style={{ width:28,height:28,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,fontFamily:'monospace',background:done?'rgba(134,239,172,.1)':active?'rgba(124,58,237,.12)':'rgba(255,255,255,.03)',border:`1px solid ${done?'rgba(134,239,172,.4)':active?'rgba(124,58,237,.4)':'rgba(109,40,217,.2)'}`,color:done?'#86efac':active?'#a78bfa':'#4c1d95',transition:'all .3s' }}>
                  {done ? '✓' : i+1}
                </div>
                <span style={{ fontSize:11,color:done?'#86efac':active?'#a78bfa':'#4c1d95',fontFamily:'monospace',letterSpacing:'.5px',transition:'color .3s' }}>
                  {s==='product'?'Image':s==='barcode'?'Barcode':'MK ID'}
                </span>
                {i<2 && <div style={{ width:20,height:1,background:done?'rgba(134,239,172,.4)':'rgba(109,40,217,.2)',transition:'background .3s' }} />}
              </div>
            )
          })}
        </div>


        {/* Upload area — product */}
        {(step==='idle' || step==='product') && !productB64 && (
          <div style={{ padding:'0 20px 20px' }}>
            <div onClick={() => productRef.current?.click()}
              style={{ borderRadius:14,border:'1.5px dashed rgba(124,58,237,.3)',padding:'28px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:10,cursor:'pointer',background:'rgba(109,40,217,.04)',transition:'border-color .2s,background .2s' }}
              onMouseOver={e => e.currentTarget.style.borderColor='rgba(124,58,237,.6)'}
              onMouseOut={e => e.currentTarget.style.borderColor='rgba(124,58,237,.3)'}
            >
              <span style={{ fontSize:28 }}>🖼️</span>
              <span style={{ fontSize:13,color:'#a78bfa',fontFamily:"'Sora',sans-serif" }}>Upload product image</span>
              <span style={{ fontSize:10,color:'#4c1d95',fontFamily:'monospace',letterSpacing:'.8px' }}>JPG · PNG · WEBP</span>
            </div>
            <div style={{ display:'flex',gap:8,marginTop:10 }}>
              <button onClick={() => productRef.current?.click()} style={{ flex:1,padding:10,borderRadius:10,cursor:'pointer',fontSize:12,fontWeight:600,fontFamily:'monospace',border:'1px solid rgba(124,58,237,.3)',background:'rgba(109,40,217,.08)',color:'#a78bfa' }}>↑ Upload</button>
              <button onClick={() => openCamera('product')} style={{ padding:'10px 14px',borderRadius:10,cursor:'pointer',fontSize:14,border:'1px solid rgba(109,40,217,.2)',background:'rgba(255,255,255,.02)',color:'#5b21b6' }}>📷</button>
            </div>
            <input ref={productRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e => { if(e.target.files[0]) readFile(e.target.files[0], setProductB64, 'product'); e.target.value='' }} />
          </div>
        )}

        {/* Barcode # input */}
        {step==='barcode' && (
          <div style={{ padding:'4px 20px 20px' }}>
            {productB64 && (
              <div style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 10px',marginBottom:12,borderRadius:10,background:'rgba(134,239,172,.06)',border:'1px solid rgba(134,239,172,.2)',fontFamily:'monospace',fontSize:11,color:'#86efac' }}>
                <img src={productB64} alt="" style={{ width:32,height:32,borderRadius:6,objectFit:'cover',border:'1px solid rgba(134,239,172,.25)' }} />
                <span>✓ Product image captured</span>
                <span style={{ marginLeft:'auto',color:'#4c1d95' }}>now type the barcode #</span>
              </div>
            )}

            <div
              onClick={() => barcodeFieldRef.current?.focus()}
              style={{
                position:'relative', borderRadius:14, padding:2, cursor:'text',
                background: inputFocused
                  ? 'conic-gradient(from var(--ang,0deg),#a78bfa,#7c3aed,#c4b5fd,#5b21b6,#a78bfa)'
                  : 'linear-gradient(135deg,rgba(167,139,250,.35),rgba(124,58,237,.18))',
                animation: inputFocused ? 'rotateGrad 3s linear infinite' : 'none',
                transition:'background .3s',
                boxShadow: inputFocused
                  ? '0 0 0 4px rgba(124,58,237,.12), 0 0 32px rgba(124,58,237,.25)'
                  : '0 0 0 0 rgba(124,58,237,0)',
              }}
            >
              <div style={{ position:'relative', overflow:'hidden', borderRadius:12, background:'rgba(8,3,18,.95)', padding:'18px 18px 14px' }}>
                <div style={{
                  position:'absolute', left:0, right:0, height:2, top:0,
                  background:'linear-gradient(90deg,transparent,#a78bfa,#c4b5fd,#a78bfa,transparent)',
                  boxShadow:'0 0 14px #7c3aed',
                  animation:'barcodeScan 2.4s ease-in-out infinite',
                  opacity: inputFocused ? .9 : .35, transition:'opacity .3s',
                }} />
                <div aria-hidden style={{ position:'absolute', inset:0, opacity:.05, pointerEvents:'none', background:'repeating-linear-gradient(90deg,#a78bfa 0,#a78bfa 2px,transparent 2px,transparent 6px)' }} />

                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, fontFamily:'monospace', fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:'#5b21b6' }}>
                  <span style={{ fontSize:14 }}>⌨️</span>
                  Barcode Number · must match product ID
                  <span style={{ marginLeft:'auto', padding:'2px 7px', borderRadius:6, background:'rgba(124,58,237,.12)', border:'1px solid rgba(124,58,237,.25)', color:'#a78bfa', fontSize:9, letterSpacing:'.6px' }}>
                    {barcodeInput.length}/13
                  </span>
                </div>

                <input
                  ref={barcodeFieldRef} type="text" inputMode="numeric"
                  autoComplete="off" spellCheck={false} maxLength={20}
                  value={barcodeInput}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onChange={e => setBarcodeInput(e.target.value.replace(/\s+/g,''))}
                  onKeyDown={e => { if (e.key === 'Enter') submitBarcode() }}
                  placeholder="0000000000000"
                  style={{
                    width:'100%', background:'transparent', border:'none', outline:'none',
                    color:'#e9d5ff', fontFamily:'monospace',
                    fontSize:30, fontWeight:600, letterSpacing:'8px',
                    textAlign:'center', padding:'10px 0 14px',
                    caretColor:'#a78bfa',
                    textShadow: inputFocused ? '0 0 18px rgba(167,139,250,.45)' : 'none',
                    transition:'text-shadow .3s',
                  }}
                />

                <div style={{ display:'flex', justifyContent:'center', gap:6, marginTop:4, flexWrap:'wrap' }}>
                  {Array.from({ length: Math.max(13, barcodeInput.length) }).map((_, i) => {
                    const ch = barcodeInput[i]
                    const filled = ch !== undefined
                    const isCaret = i === barcodeInput.length && inputFocused
                    return (
                      <div key={i} style={{
                        width:18, height:24, borderRadius:5,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontFamily:'monospace', fontSize:13, fontWeight:700,
                        color: filled ? '#e9d5ff' : '#3b1f6a',
                        background: filled ? 'rgba(124,58,237,.16)' : 'rgba(255,255,255,.02)',
                        border:`1px solid ${filled ? 'rgba(124,58,237,.4)' : isCaret ? 'rgba(167,139,250,.55)' : 'rgba(109,40,217,.15)'}`,
                        boxShadow: isCaret ? '0 0 10px rgba(167,139,250,.4)' : 'none',
                        animation: filled ? `cellPop .25s cubic-bezier(.34,1.56,.64,1) both` : isCaret ? 'caretBlink 1s ease-in-out infinite' : 'none',
                        transition:'background .2s,border-color .2s',
                      }}>
                        {ch || ''}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:12 }}>
              <span style={{ flex:1, fontFamily:'monospace', fontSize:10, color:'#4c1d95', letterSpacing:'.6px' }}>
                ⏎ press <span style={{ color:'#a78bfa' }}>Enter</span> or click verify · {barcodeInput.trim().length<4?'min 4 chars':'ready'}
              </span>
              <button onClick={submitBarcode} disabled={barcodeInput.trim().length<4 || scanning}
                style={{
                  padding:'10px 16px', borderRadius:10, cursor: barcodeInput.trim().length<4||scanning?'not-allowed':'pointer',
                  fontSize:12, fontWeight:700, fontFamily:'monospace', letterSpacing:'.6px',
                  border:'1px solid rgba(124,58,237,.4)',
                  background: barcodeInput.trim().length<4||scanning ? 'rgba(124,58,237,.05)' : 'linear-gradient(135deg,#7c3aed,#5b21b6)',
                  color: barcodeInput.trim().length<4||scanning ? '#5b21b6' : '#fff',
                  opacity: barcodeInput.trim().length<4||scanning ? .5 : 1,
                  transition:'transform .15s, box-shadow .25s',
                  boxShadow: barcodeInput.trim().length>=4 && !scanning ? '0 4px 22px rgba(124,58,237,.4)' : 'none',
                }}
                onMouseOver={e => { if(barcodeInput.trim().length>=4 && !scanning) e.currentTarget.style.transform='translateY(-1px)' }}
                onMouseOut={e => e.currentTarget.style.transform='none'}
              >
                ⚡ Verify
              </button>
            </div>
          </div>
        )}

        {/* MK ID input */}
        {step==='mkid' && (
          <div style={{ padding:'4px 20px 20px' }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 10px',marginBottom:12,borderRadius:10,background:'rgba(134,239,172,.06)',border:'1px solid rgba(134,239,172,.2)',fontFamily:'monospace',fontSize:11,color:'#86efac' }}>
              <span>✓ Barcode: <strong>{barcodeInput}</strong></span>
            </div>

            <div style={{ position:'relative', borderRadius:12, background:'rgba(8,3,18,.95)', border:'1px solid rgba(252,211,77,.3)', padding:'18px 18px 14px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, fontFamily:'monospace', fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:'#92400e' }}>
                <span style={{ fontSize:14 }}>🏭</span>
                MK ID — Product Serial Number (on packaging)
              </div>

              <input
                ref={mkIdFieldRef} type="text"
                autoComplete="off" spellCheck={false} maxLength={30}
                value={mkIdInput}
                onChange={e => setMkIdInput(e.target.value.replace(/\s+/g,''))}
                onKeyDown={e => { if (e.key === 'Enter') submitMkId() }}
                placeholder="e.g. MFG-2024-ABX-0912"
                style={{
                  width:'100%', background:'rgba(252,211,77,.05)', border:'1px solid rgba(252,211,77,.3)', borderRadius:10,
                  color:'#fcd34d', fontFamily:'monospace',
                  fontSize:18, fontWeight:600, letterSpacing:'3px',
                  textAlign:'center', padding:'14px 14px',
                  outline:'none', caretColor:'#fcd34d',
                  transition:'border-color .25s, box-shadow .25s',
                }}
                onFocus={e => { e.target.style.borderColor='rgba(252,211,77,.7)'; e.target.style.boxShadow='0 0 0 3px rgba(252,211,77,.12)' }}
                onBlur={e => { e.target.style.borderColor='rgba(252,211,77,.3)'; e.target.style.boxShadow='none' }}
              />

              <p style={{ marginTop:10, fontSize:10, color:'#92400e', fontFamily:'monospace', lineHeight:1.5 }}>
                Enter the manufacturer serial number printed on the product packaging. This ensures each physical unit is unique.
              </p>
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:12 }}>
              <span style={{ flex:1, fontFamily:'monospace', fontSize:10, color:'#4c1d95', letterSpacing:'.6px' }}>
                ⏎ press <span style={{ color:'#fcd34d' }}>Enter</span> to verify · MK ID helps prevent duplicates
              </span>
              <button onClick={() => setStep('barcode')} style={{
                padding:'10px 14px', borderRadius:10, cursor:'pointer',
                fontSize:11, fontWeight:600, fontFamily:'monospace',
                border:'1px solid rgba(109,40,217,.3)', background:'transparent', color:'#4c1d95',
              }}>
                ← Back
              </button>
              <button onClick={submitMkId} disabled={scanning}
                style={{
                  padding:'10px 16px', borderRadius:10, cursor:scanning?'not-allowed':'pointer',
                  fontSize:12, fontWeight:700, fontFamily:'monospace', letterSpacing:'.6px',
                  border:'none',
                  background:'linear-gradient(135deg,#d97706,#92400e)',
                  color:'#fff',
                  opacity:scanning ? .5 : 1,
                  boxShadow:'0 4px 22px rgba(217,119,6,.4)',
                }}
              >
                ⚡ Verify Product
              </button>
            </div>
          </div>
        )}

        {/* Verifying state */}
        {step==='verifying' && (
          <div style={{ padding:'24px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:12 }}>
            <div style={{ display:'flex',gap:4 }}>
              {[0,.15,.3].map(d => <div key={d} style={{ width:7,height:7,borderRadius:'50%',background:'#a78bfa',animation:`bounce .9s ease-in-out ${d}s infinite` }} />)}
            </div>
            <span style={{ fontFamily:'monospace',fontSize:11,color:'#a78bfa',letterSpacing:'.8px' }}>YOLO + OCR running…</span>
          </div>
        )}
      </div>
    </>
  )
}


/* ── Cart item row ─────────────────────────────────────────── */
function CartRow({ item, onRemove, onQtyChange, index }) {
  const statusColor = { match: '#86efac', mismatch: '#fca5a5', partial: '#fcd34d' }
  const sc = statusColor[item.type] || '#c4b5fd'

  return (
    <div style={{ display:'flex',alignItems:'center',gap:12,padding:'14px 20px',borderBottom:'1px solid rgba(109,40,217,.1)',animation:'rowIn .35s ease both',animationDelay:`${index*.04}s`,opacity:item.type==='mismatch'?.55:1 }}>
      <div style={{ width:8,height:8,borderRadius:'50%',background:sc,boxShadow:`0 0 8px ${sc}`,flexShrink:0 }} />
      <div style={{ width:40,height:40,borderRadius:9,overflow:'hidden',background:'rgba(8,3,18,.6)',border:'1px solid rgba(109,40,217,.2)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18 }}>
        {item.productThumb
          ? <img src={item.productThumb} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} />
          : '📦'}
      </div>
      <div style={{ flex:1,minWidth:0 }}>
        <div style={{ fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:700,color:item.type==='mismatch'?'#fca5a5':'#e9d5ff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
          {item.productName || item.barcode || 'Unknown item'}
        </div>
        <div style={{ fontFamily:'monospace',fontSize:10,color:'#4c1d95',marginTop:2,letterSpacing:'.5px' }}>
          {item.barcode || '—'} · {item.type==='match'?'Verified ✓':item.type==='mismatch'?'⚠ Fraud flag':'Partial ⚠'}
        </div>
      </div>
      <div style={{ display:'flex',alignItems:'center',gap:6,flexShrink:0 }}>
        <button onClick={() => onQtyChange(item.id, -1)} style={{ width:22,height:22,borderRadius:6,border:'1px solid rgba(109,40,217,.25)',background:'rgba(109,40,217,.06)',color:'#a78bfa',fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700 }}>−</button>
        <span style={{ fontFamily:'monospace',fontSize:13,color:'#e9d5ff',minWidth:18,textAlign:'center' }}>{item.qty}</span>
        <button onClick={() => onQtyChange(item.id, +1)} style={{ width:22,height:22,borderRadius:6,border:'1px solid rgba(109,40,217,.25)',background:'rgba(109,40,217,.06)',color:'#a78bfa',fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700 }}>+</button>
      </div>
      <div style={{ fontFamily:'monospace',fontSize:14,fontWeight:600,color:sc,flexShrink:0,minWidth:68,textAlign:'right' }}>
        {item.price ? `₹${(item.price * item.qty).toFixed(2)}` : '—'}
      </div>
      <button onClick={() => onRemove(item.id)} style={{ width:22,height:22,borderRadius:6,border:'none',background:'rgba(252,165,165,.1)',color:'#fca5a5',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>✕</button>
    </div>
  )
}


/* ── Main Transaction Page ───────────────────────────────── */
export default function TransactionPage({ user, setUser }) {
  const navigate  = useNavigate()
  const location  = useLocation()

  const initialMatch = location.state?.matchResult || null
  const initialBarcode = location.state?.barcode   || null
  const initialProduct = location.state?.product   || null

  const [cart, setCart]           = useState([])
  const [scanning, setScanning]   = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [toast, setToast]         = useState({ msg:'', type:'', show:false })
  const [paid, setPaid]           = useState(false)
  const [receiptId, setReceiptId] = useState(null)
  const [orderInfo, setOrderInfo] = useState(null)
  const [fraudCount, setFraudCount] = useState(0)

  useEffect(() => {
    if (initialMatch && initialMatch.match !== false) {
      const type = !initialMatch.found ? 'mismatch'
                 : initialMatch.match  ? 'match'
                 : initialMatch.fraud_type === 'LOW_CONFIDENCE' ? 'partial'
                 : 'mismatch'
      addToCart({
        productName:   initialMatch.product_name  || 'Unknown',
        price:         initialMatch.price          || null,
        barcode:       initialBarcode?.barcodeValue || '',
        confidence:    initialMatch.confidence     || 0,
        fraudRisk:     initialMatch.fraud_risk     || 0,
        type,
        productThumb:  initialProduct?.base64      || null,
      })
    }
  }, [])

  // No session polling needed — admin stays logged in, controls flow via UI

  function showToast(msg, type = 'info') {
    setToast({ msg, type, show: true })
    setTimeout(() => setToast(t => ({ ...t, show: false })), 4000)
  }

  function addToCart(item) {
    // Each scanned item is a unique physical unit (UID enforced by backend)
    // So we always add as a new row — no quantity increment for same barcode
    setCart(prev => [{ ...item, id: uid(), qty: 1 }, ...prev])
  }

  // Open the dedicated Order Status page for an already-scanned barcode. Uses the
  // order supplied inline by the duplicate-scan response when available, otherwise
  // looks it up from the current session. Returns true if it navigated away.
  async function openOrderStatusFor(barcodeValue, inlineOrder = null, txnId = null) {
    if (inlineOrder || txnId) {
      navigate('/order-status', { state: { order: inlineOrder || null, transactionId: txnId || null, barcode: barcodeValue } })
      return true
    }
    try {
      const r = await fetch(`/api/checkout/order-status?barcode=${encodeURIComponent(barcodeValue)}`, { credentials: 'include' })
      if (r.ok) {
        const od = await r.json().catch(() => ({}))
        if (od.found) {
          navigate('/order-status', { state: { order: od, transactionId: od.transaction_id, barcode: barcodeValue } })
          return true
        }
      }
    } catch {}
    return false
  }

  const handleVerified = useCallback(async (data, barcodeValue, productB64, errMsg, mkIdValue) => {
    if (errMsg || !data) {
      // Check if the error is a duplicate UID (409)
      if (errMsg && errMsg.includes('409')) {
        setScannerOpen(false)
        // If it maps to an existing order in this session, show its status page.
        if (await openOrderStatusFor(barcodeValue)) return
        showToast(`This product was already scanned in this session. Use a different unit or provide its MK ID.`, 'warn')
        return
      }
      showToast(`Verification failed${errMsg ? ': ' + errMsg : ''}`, 'error')
      return
    }

    // Handle duplicate_uid response from backend — already scanned this session.
    if (data.status === 'duplicate_uid') {
      setScannerOpen(false)
      // If this item already belongs to a completed transaction in this session,
      // open the Order Status page showing its transaction number + order details.
      if (await openOrderStatusFor(barcodeValue, data.order, data.transaction_id)) return
      showToast(data.message || 'This product was already scanned in this session.', 'warn')
      return
    }

    const type = !data.found                             ? 'mismatch'
               : data.match                              ? 'match'
               : data.fraud_type === 'LOW_CONFIDENCE'   ? 'partial'
               : 'mismatch'

    const item = {
      productName:  data.product_name  || 'Unknown',
      price:        data.price         || null,
      barcode:      barcodeValue       || '',
      mkId:         (mkIdValue || '').trim() || null,
      confidence:   data.confidence    || 0,
      fraudRisk:    data.fraud_risk    || 0,
      fraudType:    data.fraud_type    || null,
      type,
      productThumb: productB64         || null,
    }

    if (type === 'mismatch') {
      setFraudCount(f => f + 1)
      showToast(`Fraud detected — ${data.fraud_type || 'mismatch'} · Item rejected`, 'error')
      setScannerOpen(false)
      return
    } else if (type === 'partial') {
      showToast(`Partial match — ${data.product_name} · Item NOT added (barcode/image mismatch)`, 'warn')
      setScannerOpen(false)
      return
    } else {
      showToast(`${data.product_name} verified · Added to cart`, 'success')
    }

    addToCart(item)
    setScannerOpen(false)
  }, [])

  function handleQtyChange(id, delta) {
    setCart(prev => prev.map(c => c.id === id ? { ...c, qty: Math.max(1, c.qty + delta) } : c))
  }

  function handleRemove(id) {
    setCart(prev => prev.filter(c => c.id !== id))
  }

  const verifiedItems = cart.filter(c => c.type === 'match')
  const flaggedItems  = cart.filter(c => c.type === 'mismatch' || c.type === 'partial')
  const subtotal      = verifiedItems.reduce((s, c) => s + (c.price || 0) * c.qty, 0)
  const gst           = subtotal * 0.18
  const total         = subtotal + gst


  async function handlePay() {
    if (cart.length === 0) return
    if (verifiedItems.length === 0) {
      showToast('Cannot pay — no verified items in cart.', 'error')
      return
    }
    setScanning(true)
    try {
      const payload = {
        channel: 'offline',
        items: verifiedItems
          .filter(c => c.barcode)
          .map(c => ({ barcode: c.barcode, qty: c.qty, mk_id: c.mkId || null,
                       product_name: c.productName || null, price: c.price ?? null,
                       image_b64: c.productThumb || null })),
      }
      const res = await fetch('/api/checkout/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        const reason =
          data?.notFound?.length      ? `${data.notFound.length} item(s) missing from inventory`
        : data?.insufficient?.length  ? `${data.insufficient.length} item(s) had insufficient stock`
        :                                (data?.message || `Server error ${res.status}`)
        showToast(`Payment failed — ${reason}`, 'error')
        setScanning(false)
        return
      }
      if (Array.isArray(data.lowStock) && data.lowStock.length > 0) {
        const names = data.lowStock.map(p => p.product_name).join(', ')
        showToast(`Low stock — email sent · ${names}`, 'warn')
      } else {
        showToast('Transaction complete — receipt generated', 'success')
      }
      if (data.transaction_id) setReceiptId(data.transaction_id)
      // Capture the order status details for the post-checkout confirmation.
      setOrderInfo({
        transactionId: data.transaction_id || null,
        time:  data.transaction_time || new Date().toISOString(),
        channel: data.channel || 'offline',
        total,
        items: (Array.isArray(data.items) && data.items.length)
          ? data.items
          : verifiedItems.map(c => ({ product_name: c.productName, quantity: c.qty, price: c.price, barcode: c.barcode })),
      })
      setScanning(false)
      setPaid(true)

      // Auto-end session after 5 seconds if server signals it
      if (data.sessionAutoEnd) {
        setTimeout(() => {
          fetch('/api/logout', { credentials: 'include' }).catch(() => {})
          setUser(null)
          navigate('/')
        }, data.sessionAutoEnd * 1000)
      }
    } catch (err) {
      showToast(`Payment error: ${err.message}`, 'error')
      setScanning(false)
    }
  }

  async function logout() {
    await fetch('/api/logout', { credentials: 'include' })
    setUser(null)
    navigate('/')
  }

  /* ── Paid screen — show End Session button ── */
  if (paid) return (
    <>
      <style>{globalCSS}</style>
      <div style={{ minHeight:'100vh',background:'#000',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:20 }}>
        <div style={{ position:'fixed',inset:0,background:'radial-gradient(ellipse 75% 55% at 50% 50%, rgba(109,40,217,.15) 0%, transparent 70%)',pointerEvents:'none' }} />
        <div style={{ fontSize:64,animation:'popIn .5s cubic-bezier(.34,1.56,.64,1) both' }}>✅</div>
        <div style={{ fontFamily:"'Sora',sans-serif",fontSize:28,fontWeight:800,color:'#86efac',animation:'popIn .5s .1s cubic-bezier(.34,1.56,.64,1) both' }}>Payment Complete</div>
        <div style={{ fontSize:13,color:'#4c1d95',animation:'popIn .5s .2s cubic-bezier(.34,1.56,.64,1) both' }}>₹{total.toFixed(2)} · {verifiedItems.length} item{verifiedItems.length!==1?'s':''}</div>
        {receiptId && (
          <div style={{ animation:'popIn .5s .22s cubic-bezier(.34,1.56,.64,1) both', textAlign:'center', marginTop:6 }}>
            <div style={{ fontSize:10, color:'#4c1d95', fontFamily:'monospace', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:6 }}>Transaction ID — keep for refunds</div>
            <div style={{ display:'inline-flex', alignItems:'center', gap:10, padding:'10px 18px', borderRadius:12, background:'rgba(124,58,237,.1)', border:'1px solid rgba(124,58,237,.35)' }}>
              <span style={{ fontFamily:'monospace', fontSize:20, fontWeight:800, letterSpacing:'2px', color:'#e9d5ff' }}>{receiptId}</span>
              <button
                onClick={() => { try { navigator.clipboard.writeText(receiptId); showToast('Transaction ID copied', 'success') } catch {} }}
                title="Copy transaction ID"
                style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(109,40,217,.35)', background:'transparent', color:'#a78bfa', cursor:'pointer', fontSize:12 }}
              >📋 Copy</button>
            </div>
          </div>
        )}

        {/* ── Order Status — date, time, items, transaction number ── */}
        {orderInfo && (() => {
          const d = new Date(orderInfo.time)
          const dateStr = isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
          const timeStr = isNaN(d) ? '—' : d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
          return (
            <div style={{ width:'min(92vw, 460px)', marginTop:8, borderRadius:16, overflow:'hidden', border:'1px solid rgba(109,40,217,.28)', background:'rgba(8,3,18,.92)', backdropFilter:'blur(14px)', animation:'popIn .5s .3s cubic-bezier(.34,1.56,.64,1) both' }}>
              <div style={{ padding:'12px 18px', borderBottom:'1px solid rgba(109,40,217,.18)', background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:15 }}>🧾</span>
                <span style={{ fontFamily:"'Sora',sans-serif", fontSize:13, fontWeight:700, color:'#e9d5ff' }}>Order Status</span>
                <span style={{ marginLeft:'auto', fontFamily:'monospace', fontSize:9, letterSpacing:'.8px', textTransform:'uppercase', padding:'3px 8px', borderRadius:6, color:'#86efac', background:'rgba(134,239,172,.1)', border:'1px solid rgba(134,239,172,.28)' }}>Confirmed</span>
              </div>

              {/* meta: date / time / txn number */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:1, background:'rgba(109,40,217,.12)' }}>
                {[
                  ['Date', dateStr],
                  ['Time', timeStr],
                  ['Transaction #', orderInfo.transactionId || '—'],
                  ['Channel', (orderInfo.channel || 'offline') === 'online' ? 'Online' : 'In-store'],
                ].map(([k,v],i)=>(
                  <div key={i} style={{ background:'rgba(8,3,18,.92)', padding:'11px 16px' }}>
                    <div style={{ fontFamily:'monospace', fontSize:9, letterSpacing:'1.2px', textTransform:'uppercase', color:'#4c1d95', marginBottom:4 }}>{k}</div>
                    <div style={{ fontFamily:'monospace', fontSize:13, color:'#e9d5ff', fontWeight:600, wordBreak:'break-all' }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* itemised lines */}
              <div style={{ padding:'6px 0' }}>
                <div style={{ padding:'8px 18px 6px', fontFamily:'monospace', fontSize:9, letterSpacing:'1.2px', textTransform:'uppercase', color:'#4c1d95' }}>Items ({(orderInfo.items||[]).length})</div>
                {(orderInfo.items || []).map((it, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 18px', borderTop:'1px solid rgba(109,40,217,.08)' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:"'Sora',sans-serif", fontSize:13, color:'#e9d5ff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.product_name || 'Item'}</div>
                      <div style={{ fontFamily:'monospace', fontSize:10, color:'#4c1d95', marginTop:2, letterSpacing:'.4px' }}>{it.barcode || '—'} · qty {it.quantity || 1}</div>
                    </div>
                    <div style={{ fontFamily:'monospace', fontSize:13, fontWeight:600, color:'#c4b5fd', flexShrink:0 }}>
                      {it.price != null ? `₹${(it.price * (it.quantity || 1)).toFixed(2)}` : '—'}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', borderTop:'1px solid rgba(109,40,217,.18)', background:'rgba(0,0,0,.35)' }}>
                <span style={{ fontFamily:'monospace', fontSize:10, letterSpacing:'1px', textTransform:'uppercase', color:'#a78bfa' }}>Total Paid</span>
                <span style={{ fontFamily:"'Sora',sans-serif", fontSize:18, fontWeight:800, color:'#86efac' }}>₹{(orderInfo.total ?? total).toFixed(2)}</span>
              </div>
            </div>
          )
        })()}
        <div style={{ fontSize:11,color:'#a78bfa',fontFamily:'monospace',animation:'popIn .5s .25s cubic-bezier(.34,1.56,.64,1) both',letterSpacing:'.8px' }}>
          Session will auto-end in 5 seconds…
        </div>
        <button
          onClick={() => { fetch('/api/logout', { credentials: 'include' }).catch(() => {}); setUser(null); navigate('/') }}
          style={{
            marginTop:20, padding:'16px 44px', borderRadius:14, border:'none', cursor:'pointer',
            fontFamily:"'Sora',sans-serif", fontSize:16, fontWeight:800, letterSpacing:'.3px',
            background:'linear-gradient(135deg, #7c3aed, #5b21b6)', color:'#fff',
            boxShadow:'0 6px 36px rgba(124,58,237,.45)',
            transition:'transform .25s, box-shadow .3s',
            display:'inline-flex', alignItems:'center', gap:10,
            animation:'popIn .5s .35s cubic-bezier(.34,1.56,.64,1) both',
          }}
          onMouseOver={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 10px 44px rgba(124,58,237,.6)' }}
          onMouseOut={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 6px 36px rgba(124,58,237,.45)' }}
        >
          ✕ End Session Now
        </button>
        <p style={{ fontSize:11, color:'#4c1d95', fontFamily:'monospace', letterSpacing:'.8px', animation:'popIn .5s .45s cubic-bezier(.34,1.56,.64,1) both' }}>
          Auto-ending session… thank you for shopping!
        </p>
      </div>
    </>
  )


  return (
    <>
      <style>{globalCSS}</style>

      {/* Background */}
      <div style={{ position:'fixed',inset:0,zIndex:0,background:'#000' }} />
      <div style={{ position:'fixed',inset:0,zIndex:0,background:'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.18) 0%, transparent 70%)',pointerEvents:'none' }} />
      <div style={{ position:'fixed',inset:0,zIndex:0,background:'radial-gradient(ellipse 90% 50% at 50% 120%, rgba(76,29,149,.1) 0%, transparent 60%)',pointerEvents:'none' }} />
      <div style={{ position:'fixed',top:60,left:0,right:0,height:1,background:'linear-gradient(to right, transparent, rgba(109,40,217,.25), transparent)',zIndex:1,pointerEvents:'none' }} />
      <ParticleField />

      {/* Topbar */}
      <header style={{ position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',height:60,background:'rgba(0,0,0,.72)',borderBottom:'1px solid rgba(109,40,217,.2)',backdropFilter:'blur(22px)' }}>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ width:34,height:34,borderRadius:9,background:'linear-gradient(135deg,#7c3aed,#4c1d95)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,boxShadow:'0 0 18px rgba(124,58,237,.5)' }}>🛒</div>
          <div>
            <span style={{ fontFamily:"'Sora',sans-serif",fontSize:16,fontWeight:800,letterSpacing:'-.3px',color:'#fff' }}>Grahak<span style={{ color:'#a78bfa' }}>Sathi</span></span>
            <span style={{ fontFamily:'monospace',fontSize:9,color:'#4c1d95',letterSpacing:'1.5px',textTransform:'uppercase',marginLeft:8 }}>/ Transaction</span>
          </div>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <div style={{ width:6,height:6,borderRadius:'50%',background:'#86efac',boxShadow:'0 0 8px #86efac',animation:'blink 2s ease-in-out infinite' }} />
          <span style={{ fontFamily:'monospace',fontSize:10,color:'#4c1d95',letterSpacing:'1px',textTransform:'uppercase' }}>Live Session</span>
        </div>
        <div style={{ display:'flex',gap:8 }}>
          <button onClick={() => navigate('/home')} style={{ padding:'5px 14px',borderRadius:20,fontSize:11,fontFamily:"'Sora',sans-serif",background:'transparent',border:'1px solid rgba(109,40,217,.3)',color:'#6d28d9',cursor:'pointer',transition:'all .2s' }}>← Home</button>
          <button onClick={logout} style={{ padding:'6px 16px',borderRadius:20,fontSize:12,fontWeight:700,fontFamily:"'Sora',sans-serif",background:'linear-gradient(135deg,#7c3aed,#5b21b6)',color:'#fff',border:'none',cursor:'pointer',boxShadow:'0 0 16px rgba(124,58,237,.35)' }}>Sign Out</button>
        </div>
      </header>


      {/* Main layout */}
      <div style={{ position:'relative',zIndex:1,display:'grid',gridTemplateColumns:'1fr 380px',gap:20,padding:'20px 24px',maxWidth:1380,margin:'0 auto',minHeight:'calc(100vh - 60px)',alignItems:'start' }}>

        {/* Left: Cart */}
        <div style={{ display:'flex',flexDirection:'column',gap:16 }}>

          <div style={{ display:'flex',alignItems:'center',gap:8,fontFamily:'monospace',fontSize:10,fontWeight:600,letterSpacing:'2px',textTransform:'uppercase',color:'#4c1d95' }}>
            Cart <div style={{ flex:1,height:1,background:'rgba(109,40,217,.15)' }} />
            <span style={{ padding:'2px 8px',borderRadius:6,background:'rgba(109,40,217,.08)',border:'1px solid rgba(109,40,217,.2)',color:'#a78bfa',fontSize:10 }}>{cart.length} item{cart.length!==1?'s':''}</span>
          </div>

          {/* Cart card */}
          <div style={{ background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:20,overflow:'hidden',position:'relative',backdropFilter:'blur(14px)',animation:'cardIn .6s cubic-bezier(.22,1,.36,1) both' }}>
            <div style={{ position:'absolute',top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,#7c3aed,transparent)',animation:'shimmer 3s ease-in-out infinite' }} />
            <div style={{ padding:'14px 20px',borderBottom:'1px solid rgba(109,40,217,.15)',display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(0,0,0,.3)' }}>
              <span style={{ fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,color:'#e9d5ff' }}>Session Cart</span>
              <div style={{ display:'flex',gap:16,fontFamily:'monospace',fontSize:11 }}>
                <span style={{ color:'#86efac' }}>✓ {verifiedItems.length} verified</span>
                {flaggedItems.length > 0 && <span style={{ color:'#fca5a5' }}>⚠ {flaggedItems.length} flagged</span>}
              </div>
            </div>
            <div style={{ minHeight:120,maxHeight:420,overflowY:'auto' }}>
              {cart.length === 0
                ? (
                  <div style={{ padding:'40px 20px',textAlign:'center',color:'#4c1d95',fontFamily:'monospace',fontSize:12 }}>
                    <div style={{ fontSize:32,marginBottom:10,opacity:.3 }}>🛒</div>
                    No items yet — scan a product below
                  </div>
                )
                : cart.map((item, i) => (
                  <CartRow key={item.id} item={item} index={i} onRemove={handleRemove} onQtyChange={handleQtyChange} />
                ))
              }
            </div>
            {flaggedItems.length > 0 && (
              <div style={{ margin:'0 16px 16px',padding:'10px 14px',borderRadius:10,background:'rgba(252,165,165,.06)',border:'1px solid rgba(252,165,165,.22)',fontFamily:'monospace',fontSize:11,color:'#fca5a5',lineHeight:1.6 }}>
                ⚠️ {flaggedItems.length} item{flaggedItems.length!==1?'s':''} flagged for fraud. Review before payment.
              </div>
            )}
          </div>

          {/* Scan section */}
          <div style={{ display:'flex',alignItems:'center',gap:8,fontFamily:'monospace',fontSize:10,fontWeight:600,letterSpacing:'2px',textTransform:'uppercase',color:'#4c1d95',marginTop:4 }}>
            Next Item Scan <div style={{ flex:1,height:1,background:'rgba(109,40,217,.15)' }} />
            {scanning && <span style={{ color:'#a78bfa',fontSize:10,animation:'blink 1s ease-in-out infinite' }}>● PROCESSING</span>}
          </div>

          {scannerOpen ? (
            <>
              <ScanCapture onVerified={handleVerified} scanning={scanning} setScanning={setScanning} />
              <button onClick={() => { if (!scanning) setScannerOpen(false) }} disabled={scanning}
                style={{ padding:'10px 18px',borderRadius:12,cursor:scanning?'not-allowed':'pointer',fontFamily:'monospace',fontSize:11,letterSpacing:'.8px',border:'1px solid rgba(109,40,217,.25)',background:'transparent',color:'#4c1d95',alignSelf:'center',opacity:scanning?.5:1,transition:'color .2s,border-color .2s' }}
                onMouseOver={e => { if (!scanning) { e.currentTarget.style.color='#e9d5ff'; e.currentTarget.style.borderColor='rgba(124,58,237,.5)' } }}
                onMouseOut={e => { e.currentTarget.style.color='#4c1d95'; e.currentTarget.style.borderColor='rgba(109,40,217,.25)' }}
              >
                ✕ Cancel scan
              </button>
            </>
          ) : (
            <button onClick={() => setScannerOpen(true)} disabled={scanning || paid}
              style={{
                padding:'18px 22px',borderRadius:14,border:'1.5px dashed rgba(124,58,237,.35)',
                cursor:scanning||paid?'not-allowed':'pointer',
                fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:700,letterSpacing:'.3px',
                background:'rgba(109,40,217,.05)',color:'#a78bfa',
                display:'flex',alignItems:'center',justifyContent:'center',gap:10,
                transition:'background .2s, border-color .2s, transform .15s',
                opacity:scanning||paid?.4:1,
              }}
              onMouseOver={e => { if(!scanning&&!paid) { e.currentTarget.style.background='rgba(109,40,217,.1)'; e.currentTarget.style.borderColor='rgba(124,58,237,.6)'; e.currentTarget.style.transform='translateY(-1px)' } }}
              onMouseOut={e => { e.currentTarget.style.background='rgba(109,40,217,.05)'; e.currentTarget.style.borderColor='rgba(124,58,237,.35)'; e.currentTarget.style.transform='none' }}
            >
              <span style={{ fontSize:18 }}>＋</span>
              {cart.length === 0 ? 'Scan First Item' : 'Add Another Item'}
              <span style={{ fontFamily:'monospace',fontSize:10,color:'#4c1d95',letterSpacing:'1px',marginLeft:6 }}>· re-runs YOLO + OCR</span>
            </button>
          )}
        </div>


        {/* Right: Summary */}
        <div style={{ display:'flex',flexDirection:'column',gap:14,position:'sticky',top:80 }}>

          {/* Stats pills */}
          {[
            { label:'Items in Cart',   value:cart.length,          color:'#a78bfa', icon:'📦' },
            { label:'Verified',        value:verifiedItems.length, color:'#86efac', icon:'✅' },
            { label:'Fraud Flagged',   value:flaggedItems.length,  color:'#fca5a5', icon:'🚨' },
          ].map((s,i) => (
            <div key={i} style={{ background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:14,padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',backdropFilter:'blur(14px)',animation:`cardIn .5s ${.1+i*.08}s cubic-bezier(.22,1,.36,1) both` }}>
              <div>
                <div style={{ fontFamily:'monospace',fontSize:9,letterSpacing:'1.5px',textTransform:'uppercase',color:'#4c1d95',marginBottom:4 }}>{s.label}</div>
                <div style={{ fontFamily:"'Sora',sans-serif",fontSize:24,fontWeight:800,color:s.color,lineHeight:1 }}>{s.value}</div>
              </div>
              <div style={{ width:34,height:34,borderRadius:9,background:'rgba(109,40,217,.1)',border:'1px solid rgba(109,40,217,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17 }}>{s.icon}</div>
            </div>
          ))}

          {/* Bill summary */}
          <div style={{ background:'rgba(8,3,18,.88)',border:'1px solid rgba(109,40,217,.22)',borderRadius:16,overflow:'hidden',backdropFilter:'blur(14px)',animation:'cardIn .6s .3s cubic-bezier(.22,1,.36,1) both' }}>
            <div style={{ padding:'12px 18px',borderBottom:'1px solid rgba(109,40,217,.15)',background:'rgba(0,0,0,.3)' }}>
              <span style={{ fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:700,color:'#e9d5ff' }}>Bill Summary</span>
            </div>
            <div style={{ padding:'14px 18px' }}>
              {[
                ['Subtotal', `₹${subtotal.toFixed(2)}`, '#c4b5fd'],
                ['GST (18%)', `₹${gst.toFixed(2)}`, '#c4b5fd'],
              ].map(([k,v,c]) => (
                <div key={k} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid rgba(109,40,217,.08)',fontFamily:'monospace',fontSize:12 }}>
                  <span style={{ color:'#4c1d95' }}>{k}</span>
                  <span style={{ color:c }}>{v}</span>
                </div>
              ))}
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 0 4px',fontFamily:'monospace' }}>
                <span style={{ fontSize:11,color:'#a78bfa',letterSpacing:'1px',textTransform:'uppercase' }}>Total</span>
                <span style={{ fontFamily:"'Sora',sans-serif",fontSize:22,fontWeight:800,color:'#86efac' }}>₹{total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Pay button */}
          <button onClick={handlePay} disabled={cart.length === 0 || scanning}
            style={{
              padding:'16px 20px',border:'none',borderRadius:14,cursor:cart.length===0||scanning?'not-allowed':'pointer',
              fontFamily:"'Sora',sans-serif",fontSize:16,fontWeight:800,letterSpacing:'.2px',
              background:cart.length===0||scanning?'rgba(134,239,172,.08)':'linear-gradient(135deg,#7c3aed,#5b21b6)',
              color:cart.length===0||scanning?'#4c1d95':'#fff',
              opacity:cart.length===0||scanning?.4:1,
              transition:'opacity .2s,transform .2s,box-shadow .2s',
              boxShadow:cart.length>0&&!scanning?'0 4px 32px rgba(124,58,237,.4)':'none',
              display:'flex',alignItems:'center',justifyContent:'center',gap:10,
            }}
            onMouseOver={e => { if(cart.length>0&&!scanning) e.currentTarget.style.transform='translateY(-2px)' }}
            onMouseOut={e => e.currentTarget.style.transform='none'}
          >
            {scanning
              ? <><span style={{ width:16,height:16,border:'2px solid rgba(255,255,255,.25)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .7s linear infinite',display:'inline-block' }} />Processing…</>
              : '✅ Done & Pay'}
          </button>

          {/* Discard */}
          <button onClick={() => navigate('/home')}
            style={{ padding:'10px 20px',border:'1px solid rgba(109,40,217,.2)',borderRadius:14,cursor:'pointer',fontFamily:'monospace',fontSize:12,background:'transparent',color:'#4c1d95',transition:'color .2s,border-color .2s' }}
            onMouseOver={e => { e.currentTarget.style.color='#fca5a5'; e.currentTarget.style.borderColor='rgba(252,165,165,.3)' }}
            onMouseOut={e => { e.currentTarget.style.color='#4c1d95'; e.currentTarget.style.borderColor='rgba(109,40,217,.2)' }}
          >
            ✕ Discard & Exit
          </button>
        </div>
      </div>

      {/* Toast */}
      <div style={{
        position:'fixed',bottom:22,right:22,zIndex:999,padding:'12px 18px',borderRadius:12,fontSize:13,fontWeight:500,
        display:'flex',alignItems:'center',gap:8,pointerEvents:'none',
        transform:toast.show?'translateY(0)':'translateY(80px)',
        opacity:toast.show?1:0,transition:'transform .4s cubic-bezier(.22,1,.36,1),opacity .4s',
        maxWidth:340,lineHeight:1.4,fontFamily:"'Sora',sans-serif",
        background:toast.type==='success'?'rgba(22,163,74,.14)':toast.type==='error'?'rgba(220,38,38,.14)':toast.type==='warn'?'rgba(217,119,6,.14)':'rgba(109,40,217,.14)',
        border:`1px solid ${toast.type==='success'?'rgba(134,239,172,.38)':toast.type==='error'?'rgba(252,165,165,.38)':toast.type==='warn'?'rgba(252,211,77,.38)':'rgba(167,139,250,.38)'}`,
        color:toast.type==='success'?'#86efac':toast.type==='error'?'#fca5a5':toast.type==='warn'?'#fcd34d':'#a78bfa',
        backdropFilter:'blur(14px)',
      }}>
        {toast.msg}
      </div>
    </>
  )
}


/* ── Global CSS ──────────────────────────────────────────── */
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #000; }

  @keyframes shimmer       { 0%,100%{opacity:.4} 50%{opacity:1} }
  @keyframes blink         { 0%,100%{opacity:1}  50%{opacity:.25} }
  @keyframes spin          { to{transform:rotate(360deg)} }
  @keyframes scanLine      { 0%{top:5%;opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{top:95%;opacity:0} }
  @keyframes bounce        { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
  @keyframes cardIn        { from{opacity:0;transform:translateY(18px) scale(.98)} to{opacity:1;transform:none} }
  @keyframes rowIn         { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:none} }
  @keyframes popIn         { from{opacity:0;transform:scale(.7)} to{opacity:1;transform:scale(1)} }
  @keyframes particlePulse { 0%,100%{opacity:0;transform:scale(1)} 50%{opacity:.5;transform:scale(1.6)} }

  @keyframes barcodeScan { 0%{top:0;opacity:0} 10%{opacity:1} 50%{top:calc(100% - 2px);opacity:1} 60%{opacity:0} 100%{top:0;opacity:0} }
  @keyframes cellPop     { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.12)} 100%{transform:scale(1);opacity:1} }
  @keyframes caretBlink  { 0%,49%{border-color:rgba(167,139,250,.55);box-shadow:0 0 10px rgba(167,139,250,.4)} 50%,100%{border-color:rgba(167,139,250,.15);box-shadow:none} }
  @property --ang { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
  @keyframes rotateGrad { to { --ang: 360deg } }
`
