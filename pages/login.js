import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

const NSSA = { dark: '#13405E', medium: '#1C80BC' }

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [step, setStep] = useState('email')
  const [error, setError] = useState(router.query.error || null)
  const [loading, setLoading] = useState(false)

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    shouldCreateUser: true,
    emailRedirectTo: 'https://members.nssapros.com/auth/callback'
  }
})
    if (error) { setError(error.message); setLoading(false) }
    else { setStep('code'); setLoading(false) }
  }

  async function handleCodeSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) { setError(error.message); setLoading(false); return }
    if (!data?.session) { setError('Sign in succeeded but no session was created. Please try again.'); setLoading(false); return }
    await new Promise(r => setTimeout(r, 300))
    router.replace('/dashboard')
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: '14px',
    border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', boxSizing: 'border-box'
  }
  const btnStyle = (disabled) => ({
    width: '100%', padding: '10px', background: disabled ? '#93c5fd' : NSSA.dark,
    color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px',
    fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer'
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '2.5rem', width: '100%', maxWidth: '400px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '1.5rem' }}>
            <div style={{ background: NSSA.dark, color: 'white', padding: '6px 14px', borderRadius: '6px', fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em' }}>NSSA</div>
            <span style={{ color: '#6b7280', fontSize: '13px' }}>Member Portal</span>
          </div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '6px', color: '#111' }}>
            {step === 'email' ? 'Sign in to your account' : 'Enter your login code'}
          </h1>
          <p style={{ color: '#666', fontSize: '14px' }}>
            {step === 'email' ? 'Enter your email to receive a 6-digit code' : `Code sent to ${email}`}
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={handleEmailSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: '#374151' }}>Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" style={inputStyle} />
            </div>
            {error && <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '1rem' }}>{error}</p>}
            <button type="submit" disabled={loading || !email} style={btnStyle(loading || !email)}>
              {loading ? 'Sending…' : 'Send login code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: '#374151' }}>6-digit code</label>
              <input
                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={token} onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
                required placeholder="123456" autoFocus
                style={{ ...inputStyle, fontSize: '24px', letterSpacing: '0.5em', textAlign: 'center' }}
              />
            </div>
        {error && (
  <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '1rem' }}>
    {error === 'not_authorized'
      ? 'Your account is not yet active. Please contact NSSA if you believe this is an error.'
      : error === 'link_failed'
      ? 'Sign-in link could not be generated. Please enter your email below to log in.'
      : error}
  </p>
)}
            <button type="submit" disabled={loading || token.length !== 6} style={btnStyle(loading || token.length !== 6)}>
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
            <button type="button" onClick={() => { setStep('email'); setToken(''); setError(null) }}
              style={{ width: '100%', padding: '10px', background: 'transparent', color: '#6b7280', border: 'none', fontSize: '13px', cursor: 'pointer', marginTop: '8px' }}>
              ← Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
