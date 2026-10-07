import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'

const ARPI = {
  dark:   '#2a6b54',
  medium: '#139a4d',
  light:  '#d1f0de',
  xlight: '#f0faf4',
}

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [step, setStep]   = useState('email')
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
        emailRedirectTo: 'https://members.arpinstitute.com/auth/callback',
      },
    })
    if (error) { setError(error.message); setLoading(false) }
    else        { setStep('code');         setLoading(false) }
  }

  async function handleCodeSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error)            { setError(error.message);                                                      setLoading(false); return }
    if (!data?.session)   { setError('Sign in succeeded but no session was created. Please try again.'); setLoading(false); return }
    await new Promise(r => setTimeout(r, 300))
    router.replace('/dashboard')
  }

  function errorText(err) {
    if (!err) return null
    if (err === 'not_authorized') return 'Your account is not yet active. Please contact ARPI support if you believe this is an error.'
    if (err === 'link_failed')    return 'Sign-in link could not be verified. Please enter your email below to try again.'
    return err
  }

  const msg = errorText(error)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

        .login-page {
          min-height: 100vh;
          background: #111827;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding-top: 8vh;
          padding-bottom: 40px;
          padding-left: 16px;
          padding-right: 16px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased;
          box-sizing: border-box;
        }

        /* ARPI logo above the card */
        .login-logo {
          margin-bottom: 32px;
          text-align: center;
        }
        .login-logo img {
          height: 36px;
          width: auto;
        }

        /* Card */
        .login-card {
          background: #ffffff;
          border-radius: 14px;
          padding: 40px 40px 36px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
        }

        /* Heading block */
        .login-heading {
          text-align: center;
          margin-bottom: 28px;
        }
        .login-eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: ${ARPI.medium};
          margin-bottom: 8px;
        }
        .login-title {
          font-size: 1.35rem;
          font-weight: 600;
          color: #111827;
          margin: 0 0 6px;
          line-height: 1.3;
        }
        .login-subtitle {
          font-size: 13.5px;
          color: #6b7280;
          margin: 0;
          line-height: 1.5;
        }

        /* Inputs */
        .login-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: #374151;
          margin-bottom: 6px;
        }
        .login-input {
          width: 100%;
          padding: 11px 14px;
          font-size: 14px;
          font-family: inherit;
          border: 1.5px solid #d1d5db;
          border-radius: 8px;
          outline: none;
          box-sizing: border-box;
          color: #111827;
          transition: border-color 0.15s, box-shadow 0.15s;
          background: #fff;
        }
        .login-input:focus {
          border-color: ${ARPI.medium};
          box-shadow: 0 0 0 3px ${ARPI.light}55;
        }
        .login-input-code {
          font-size: 26px;
          letter-spacing: 0.55em;
          text-align: center;
          padding: 12px 14px;
        }

        /* Primary button */
        .login-btn-primary {
          width: 100%;
          padding: 12px;
          background: ${ARPI.dark};
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14.5px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          letter-spacing: 0.01em;
          transition: background 0.15s, opacity 0.15s;
        }
        .login-btn-primary:hover:not(:disabled) {
          background: ${ARPI.medium};
        }
        .login-btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Ghost button */
        .login-btn-ghost {
          width: 100%;
          padding: 10px;
          background: transparent;
          color: #6b7280;
          border: none;
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          margin-top: 8px;
          border-radius: 6px;
          transition: color 0.15s;
        }
        .login-btn-ghost:hover { color: #374151; }

        /* Error */
        .login-error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          font-size: 13px;
          border-radius: 6px;
          padding: 9px 12px;
          margin-bottom: 16px;
          line-height: 1.5;
        }

        /* Footer */
        .login-footer {
          margin-top: 28px;
          text-align: center;
        }
        .login-footer a {
          font-size: 12.5px;
          color: #6b7280;
          text-decoration: none;
          transition: color 0.15s;
        }
        .login-footer a:hover { color: #d1d5db; }

        @media (max-width: 480px) {
          .login-card { padding: 32px 24px 28px; }
        }
      `}</style>

      <div className="login-page">

        {/* Logo above card */}
        <div className="login-logo">
          <img
            src="https://kajabi-storefronts-production.kajabi-cdn.com/kajabi-storefronts-production/file-uploads/sites/2148380572/images/1403fd-42cd-47f2-e6dd-f1706004e211_arpi-logo-horizontal.png"
            alt="Advanced Retirement Planning Institute"
          />
        </div>

        <div className="login-card">
          <div className="login-heading">
            <p className="login-eyebrow">Member Portal</p>
            <h1 className="login-title">
              {step === 'email' ? 'Sign in to your account' : 'Check your email'}
            </h1>
            <p className="login-subtitle">
              {step === 'email'
                ? <>Enter your email and we’ll<br />send you a 6-digit login code.</>
                : <>Code sent to <strong>{email}</strong>. Enter it below.</>}
            </p>
          </div>

          {step === 'email' ? (
            <form onSubmit={handleEmailSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label className="login-label">Email address</label>
                <input
                  className="login-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  autoFocus
                />
              </div>
              {msg && <div className="login-error">{msg}</div>}
              <button className="login-btn-primary" type="submit" disabled={loading || !email}>
                {loading ? 'Sending…' : 'Send login code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label className="login-label">6-digit code</label>
                <input
                  className="login-input login-input-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={token}
                  onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
                  required
                  placeholder="000000"
                  autoFocus
                />
              </div>
              {msg && <div className="login-error">{msg}</div>}
              <button className="login-btn-primary" type="submit" disabled={loading || token.length !== 6}>
                {loading ? 'Verifying…' : 'Sign in'}
              </button>
              <button
                className="login-btn-ghost"
                type="button"
                onClick={() => { setStep('email'); setToken(''); setError(null) }}
              >
                ← Use a different email
              </button>
            </form>
          )}
        </div>

        <div className="login-footer">
          <a href="https://arpinstitute.com/">← Back to arpinstitute.com</a>
        </div>

      </div>
    </>
  )
}
