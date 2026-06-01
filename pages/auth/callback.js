import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('Signing you in…')

  useEffect(() => {
    async function handleCallback() {
      // ── Strategy 1: Hash fragment (#access_token=...) from magic link ──────
      const hash = window.location.hash.substring(1)
      if (hash) {
        const params = new URLSearchParams(hash)
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')

        if (accessToken && refreshToken) {
          setStatus('Verifying your link…')
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })
          if (!error && data?.session) {
            // Clear the tokens from the URL bar for security
            window.history.replaceState(null, '', window.location.pathname)
            router.replace('/dashboard')
            return
          }
          console.error('[callback] setSession error:', error?.message)
        }
      }

      // ── Strategy 2: Already has a session ───────────────────────────────────
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.replace('/dashboard')
        return
      }

      // ── Strategy 3: Listen for auth state change (covers slower paths) ──────
      const { data } = supabase.auth.onAuthStateChange((event, sess) => {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && sess) {
          router.replace('/dashboard')
        }
      })

      // ── Fallback after 6 seconds ─────────────────────────────────────────────
      setTimeout(async () => {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (s) router.replace('/dashboard')
        else {
          setStatus('Sign-in failed. Redirecting…')
          router.replace('/login?error=no_session')
        }
      }, 6000)
    }

    handleCallback()
  }, [router])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#666'
    }}>
      <p style={{ fontSize: '1.25rem' }}>{status}</p>
    </div>
  )
}

// Handles PKCE flow (code= query param)
export async function getServerSideProps(context) {
  const { query } = context
  if (query.code) {
    const { createServerSupabaseClient } = await import('@supabase/auth-helpers-nextjs')
    const supabase = createServerSupabaseClient(context)
    const { error } = await supabase.auth.exchangeCodeForSession(query.code)
    if (!error) return { redirect: { destination: '/dashboard', permanent: false } }
  }
  return { props: {} }
}
