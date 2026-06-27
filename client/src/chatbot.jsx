import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// ── Stable per-visitor budget session id (kept in localStorage) ────────────────
function getBudgetSession() {
  let id = null
  try { id = localStorage.getItem('sr_budget_session') } catch {}
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'bs-' + Date.now() + '-' + Math.random().toString(16).slice(2))
    try { localStorage.setItem('sr_budget_session', id) } catch {}
  }
  return id
}

const TIER_COLORS = { light: '#34d399', medium: '#fbbf24', high: '#a78bfa' }
const PHASE_COLORS = { NORMAL: '#34d399', WARNING: '#fbbf24', CRITICAL: '#fb923c', EXHAUSTED: '#f87171' }
const DECISION_STYLE = {
  APPROVED:          { color: '#34d399', label: '✅ Refund Eligible' },
  DENIED:            { color: '#f87171', label: '⛔ Claim Denied' },
  NEEDS_REVIEW:      { color: '#fbbf24', label: '🔎 Sent for Review' },
  INFO:              { color: '#a78bfa', label: 'ℹ️ Policy Info' },
  BLOCKED_INJECTION: { color: '#fb923c', label: '🛡️ Blocked' },
}

// Where each answer came from — proves the bot is NOT just an LLM wrapper.
const SOURCE_STYLE = {
  knowledge_base: { color: '#38bdf8', label: '📚 Knowledge Base' },
  policy:         { color: '#38bdf8', label: '📄 Store Policy' },
  live_inventory: { color: '#34d399', label: '📦 Live Inventory' },
  order_lookup:   { color: '#22d3ee', label: '🧾 Order Lookup' },
  visual_audit:   { color: '#a78bfa', label: '🔬 Visual Audit' },
  ai_generated:   { color: '#fbbf24', label: '✨ AI (grounded)' },
  human_handoff:  { color: '#fb923c', label: '🙋 Connect an Agent' },
  security:       { color: '#fb923c', label: '🛡️ Security' },
}

const QUICK_REPLIES = [
  'What is your return policy?',
  'What are your store hours?',
  'Which payment methods do you accept?',
  'Track my order status',
  'My item arrived damaged, I want a refund',
]

export default function ChatbotPage({ user }) {
  const navigate = useNavigate()
  const budgetSession = useRef(getBudgetSession())
  const scrollRef = useRef(null)

  const [messages, setMessages] = useState([{
    role: 'bot',
    text: 'Hi! I\'m the SmartRetail customer assistant. I can help with our return & refund policy, ' +
          'product availability and prices, order status, store hours, payments, delivery, and warranty. ' +
          'Ask me anything — and if your item has a problem, I can start a verified refund claim (add your ' +
          'transaction ID below for that).',
  }])
  const [input, setInput]   = useState('')
  const [txnId, setTxnId]   = useState('')
  const [sending, setSending] = useState(false)
  const [budget, setBudget] = useState(null)

  const refreshBudget = useCallback(async () => {
    try {
      const r = await fetch(`/api/chatbot/budget?budget_session=${budgetSession.current}`, { credentials: 'include' })
      if (r.ok) setBudget(await r.json())
    } catch {}
  }, [])

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap'
    if (!document.querySelector(`link[href="${link.href}"]`)) document.head.appendChild(link)
    refreshBudget()
  }, [refreshBudget])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, sending])

  async function send(override) {
    const text = (typeof override === 'string' ? override : input).trim()
    if (!text || sending) return
    setMessages(m => [...m, { role: 'user', text }])
    setInput('')
    setSending(true)
    try {
      const r = await fetch('/api/chatbot/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          transaction_id: txnId.trim() || null,
          budget_session: budgetSession.current,
        }),
      })
      const data = await r.json()
      if (r.ok) {
        setMessages(m => [...m, {
          role: 'bot',
          text: data.reply,
          source: data.source,
          decision: data.decision,
          verification: data.verification,
          routing: data.routing,
          injection: data.injection,
        }])
        if (data.budget) setBudget(b => ({ ...(b || {}), ...data.budget }))
      } else {
        setMessages(m => [...m, { role: 'bot', text: data.message || 'Something went wrong. Please try again.' }])
      }
    } catch {
      setMessages(m => [...m, { role: 'bot', text: 'Connection error. Please try again.' }])
    } finally {
      setSending(false)
      refreshBudget()
    }
  }

  async function resetBudget() {
    try {
      await fetch('/api/chatbot/reset-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ budget_session: budgetSession.current }),
      })
    } catch {}
    refreshBudget()
  }

  const pct   = budget ? Math.max(0, Math.min(100, budget.remainingPct ?? 0)) : 100
  const phase = budget?.phase || 'NORMAL'
  const phaseColor = PHASE_COLORS[phase] || '#34d399'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:#000}
        @keyframes cardIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes dots{0%,20%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
        input::placeholder,textarea::placeholder{color:rgba(109,40,217,.45)}
        .sr-scroll::-webkit-scrollbar{width:6px}
        .sr-scroll::-webkit-scrollbar-thumb{background:rgba(109,40,217,.3);border-radius:3px}
      `}</style>

      <div style={{ position:'fixed', inset:0, background:'#000', zIndex:0 }} />
      <div style={{ position:'fixed', inset:0, background:'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(109,40,217,.18) 0%, transparent 70%)', zIndex:0, pointerEvents:'none' }} />

      <div style={{ position:'relative', zIndex:1, minHeight:'100vh', fontFamily:"'Sora',sans-serif", display:'flex', flexDirection:'column', maxWidth:760, margin:'0 auto', padding:'0 16px' }}>

        {/* Header */}
        <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 4px 14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:38, height:38, borderRadius:11, fontSize:19, background:'linear-gradient(135deg,#7c3aed,#4c1d95)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 20px rgba(124,58,237,.5)' }}>🤖</div>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:'#fff' }}>Customer <span style={{ color:'#a78bfa' }}>Assistant</span></div>
              <div style={{ fontSize:9, color:'#4c1d95', letterSpacing:'2px', textTransform:'uppercase' }}>Hybrid AI · Grounded Answers</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {user ? (
              <>
                <button onClick={() => navigate('/checkout')} title="Hardware-store checkout with fraud detection" style={{ padding:'7px 16px', borderRadius:20, fontSize:12, fontWeight:700, background:'linear-gradient(135deg,#7c3aed,#5b21b6)', color:'#fff', border:'none', cursor:'pointer', boxShadow:'0 0 16px rgba(124,58,237,.4)' }}>🛒 Checkout</button>
                <button onClick={() => navigate('/home')} style={{ padding:'6px 14px', borderRadius:20, fontSize:11, background:'transparent', border:'1px solid rgba(109,40,217,.3)', color:'#6d28d9', cursor:'pointer' }}>🏪 Home</button>
              </>
            ) : (
              <button onClick={() => navigate('/')} style={{ padding:'6px 14px', borderRadius:20, fontSize:11, background:'transparent', border:'1px solid rgba(109,40,217,.3)', color:'#6d28d9', cursor:'pointer' }}>← Exit</button>
            )}
          </div>
        </header>

        {/* Budget meter */}
        <div style={{ background:'rgba(8,3,18,.88)', border:'1px solid rgba(109,40,217,.22)', borderRadius:14, padding:'12px 16px', marginBottom:12, backdropFilter:'blur(14px)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <span style={{ fontSize:10, fontFamily:'monospace', letterSpacing:'1.5px', textTransform:'uppercase', color:'#4c1d95' }}>Session AI Budget</span>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontFamily:'monospace', fontSize:11, color:'#cbd5e1' }}>
                ${budget ? (budget.spent ?? 0).toFixed(3) : '0.000'} / ${budget ? (budget.limit ?? 2).toFixed(2) : '2.00'}
              </span>
              <span style={{ fontSize:9, fontWeight:700, letterSpacing:'1px', padding:'2px 8px', borderRadius:20, color:phaseColor, border:`1px solid ${phaseColor}55`, background:`${phaseColor}14` }}>{phase}</span>
            </div>
          </div>
          <div style={{ height:7, borderRadius:5, background:'rgba(124,58,237,.12)', overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,${phaseColor},${phaseColor}aa)`, borderRadius:5, transition:'width .5s ease' }} />
          </div>
          {phase === 'CRITICAL' && (
            <div style={{ marginTop:8, fontSize:10, color:'#fdba74', lineHeight:1.5 }}>
              ⚠️ Critical budget — image auditing is paused; conversational replies use the Light tier and claims route to manual review. High-tier compute is reserved for live fraud detection.
            </div>
          )}
        </div>

        {/* Chat window */}
        <div ref={scrollRef} className="sr-scroll" style={{ flex:1, minHeight:340, maxHeight:'calc(100vh - 320px)', overflowY:'auto', display:'flex', flexDirection:'column', gap:12, padding:'4px 2px 12px' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth:'85%', animation:'cardIn .35s ease both' }}>
              <div style={{
                padding:'12px 15px', borderRadius:14, fontSize:13.5, lineHeight:1.6,
                color: m.role === 'user' ? '#fff' : '#e9d5ff',
                background: m.role === 'user' ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : 'rgba(8,3,18,.9)',
                border: m.role === 'user' ? 'none' : '1px solid rgba(109,40,217,.22)',
                borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                borderBottomLeftRadius:  m.role === 'user' ? 14 : 4,
              }}>
                {m.text}
              </div>

              {/* Source badge — shows WHERE the answer came from */}
              {m.role === 'bot' && m.source && SOURCE_STYLE[m.source] && (
                <div style={{ marginTop:6 }}>
                  <span style={{ fontSize:9.5, fontWeight:700, padding:'2px 9px', borderRadius:20, color:SOURCE_STYLE[m.source].color, border:`1px solid ${SOURCE_STYLE[m.source].color}55`, background:`${SOURCE_STYLE[m.source].color}14` }}>
                    {SOURCE_STYLE[m.source].label}
                  </span>
                </div>
              )}

              {/* Decision badge + verification + routing transparency */}
              {m.role === 'bot' && m.decision && DECISION_STYLE[m.decision] && (
                <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20, color:DECISION_STYLE[m.decision].color, border:`1px solid ${DECISION_STYLE[m.decision].color}55`, background:`${DECISION_STYLE[m.decision].color}14` }}>
                    {DECISION_STYLE[m.decision].label}
                  </span>
                  {m.verification && m.verification.confidence != null && (
                    <span style={{ fontSize:9, fontFamily:'monospace', color:'#64748b' }}>
                      vision confidence {Math.round(m.verification.confidence * 100)}%{m.verification.latencyMs ? ` · ${m.verification.latencyMs}ms` : ''}
                    </span>
                  )}
                </div>
              )}
              {m.role === 'bot' && Array.isArray(m.routing) && m.routing.length > 0 && (
                <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:5 }}>
                  {m.routing.map((r, j) => (
                    <span key={j} title={r.reason} style={{ fontSize:8.5, fontFamily:'monospace', letterSpacing:'.5px', padding:'2px 7px', borderRadius:6, textTransform:'uppercase', color:TIER_COLORS[r.tier] || '#94a3b8', border:`1px solid ${(TIER_COLORS[r.tier]||'#94a3b8')}44`, background:`${(TIER_COLORS[r.tier]||'#94a3b8')}11` }}>
                      {r.tier}{r.degraded ? ' ↓' : ''} · {r.taskType}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div style={{ alignSelf:'flex-start', padding:'12px 16px', borderRadius:14, background:'rgba(8,3,18,.9)', border:'1px solid rgba(109,40,217,.22)' }}>
              <span style={{ display:'inline-flex', gap:3 }}>
                {[0,1,2].map(d => <span key={d} style={{ width:6, height:6, borderRadius:'50%', background:'#a78bfa', animation:`dots 1.2s ${d*.2}s infinite` }} />)}
              </span>
            </div>
          )}
        </div>

        {/* Quick replies */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:7, padding:'2px 2px 10px' }}>
          {QUICK_REPLIES.map((q, i) => (
            <button key={i} onClick={() => send(q)} disabled={sending} style={{
              padding:'6px 12px', borderRadius:18, fontSize:11, fontFamily:"'Sora',sans-serif",
              border:'1px solid rgba(109,40,217,.3)', background:'rgba(109,40,217,.07)', color:'#c4b5fd',
              cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? .5 : 1,
            }}>{q}</button>
          ))}
        </div>

        {/* Composer */}
        <div style={{ paddingBottom:18 }}>
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <input value={txnId} onChange={e => setTxnId(e.target.value)} placeholder="Transaction ID (optional, for claim verification)"
              style={{ flex:1, background:'rgba(109,40,217,.06)', border:'1px solid rgba(109,40,217,.25)', borderRadius:10, color:'#e9d5ff', fontFamily:'monospace', fontSize:11.5, padding:'9px 13px', outline:'none' }} />
            <button onClick={resetBudget} title="Start a fresh session budget" style={{ padding:'9px 14px', borderRadius:10, fontSize:11, border:'1px solid rgba(109,40,217,.3)', background:'transparent', color:'#6d28d9', cursor:'pointer', whiteSpace:'nowrap' }}>↺ New session</button>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder="Ask a question, or describe an issue with your order…" disabled={sending}
              style={{ flex:1, background:'rgba(109,40,217,.06)', border:'1px solid rgba(109,40,217,.25)', borderRadius:12, color:'#e9d5ff', fontFamily:"'Sora',sans-serif", fontSize:13.5, padding:'13px 16px', outline:'none' }} />
            <button onClick={send} disabled={sending || !input.trim()} style={{
              padding:'13px 22px', borderRadius:12, border:'none', cursor: sending||!input.trim()?'not-allowed':'pointer',
              fontFamily:"'Sora',sans-serif", fontSize:13.5, fontWeight:700, color:'#fff',
              background:'linear-gradient(135deg,#7c3aed,#5b21b6)', boxShadow:'0 4px 20px rgba(124,58,237,.3)',
              opacity: sending||!input.trim()?.5:1,
            }}>Send</button>
          </div>
        </div>
      </div>
    </>
  )
}
