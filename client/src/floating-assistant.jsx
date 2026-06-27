import { useNavigate, useLocation } from 'react-router-dom'

/**
 * Floating "Customer Assistant" button.
 * Rendered globally once the user is logged in, so the chatbot is reachable
 * from every screen (home, admin, checkout, transaction). Hides itself on the
 * chatbot page so it doesn't overlap the chat UI.
 */
export default function FloatingAssistant() {
  const navigate = useNavigate()
  const location = useLocation()

  // Don't show on the chatbot itself.
  if (location.pathname === '/chat' || location.pathname === '/returns') return null

  return (
    <>
      <style>{`
        @keyframes faPulse { 0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,.45)} 50%{box-shadow:0 0 0 10px rgba(124,58,237,0)} }
        .fa-btn:hover { transform: translateY(-2px) scale(1.04); }
        .fa-btn:hover .fa-label { opacity:1; transform: translateX(0); pointer-events:auto; }
      `}</style>

      <button
        className="fa-btn"
        onClick={() => navigate('/chat')}
        title="Open Customer Assistant"
        aria-label="Open Customer Assistant"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 900,
          display: 'flex', alignItems: 'center', gap: 10,
          height: 56, padding: '0 18px', borderRadius: 28,
          border: '1px solid rgba(167,139,250,.4)',
          background: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
          color: '#fff', cursor: 'pointer',
          fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700,
          boxShadow: '0 8px 30px rgba(124,58,237,.5)',
          animation: 'faPulse 2.6s ease-in-out infinite',
          transition: 'transform .2s ease',
        }}
      >
        <span style={{ fontSize: 22, lineHeight: 1 }}>💬</span>
        <span
          className="fa-label"
          style={{
            fontSize: 13, whiteSpace: 'nowrap',
            transition: 'opacity .2s ease, transform .2s ease',
          }}
        >
          Assistant
        </span>
      </button>
    </>
  )
}
