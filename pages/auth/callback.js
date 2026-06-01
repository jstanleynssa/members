import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('Signing you in…')

  useEffect(() => {
    let subscription
    let timeout

    async function handleCallback() {
      // Check immediately — Supabase may have already processed the hash
      // fragment (#access_token=...) before our listener was set up
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.replace('/dashboard')
        return
      }

      // If no session yet, listen for it (covers slower connections)
      const { data } = supabase.auth.onAuthStateChange((event, sess) => {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && sess) {
          router.replace('/dashboard')
        }
      })
      subscription = data.subscription

      // Final fallback — check again after 6 seconds
      timeout = setTimeout(async () => {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (s) router.replace('/dashboard')
        else router.replace('/login?error=no_session')
      }, 6000)
    }

    handleCallback()

    return () => {
      if (subscription) subscription.unsubscribe()
      if (timeout) clearTimeout(timeout)
    }
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

// Handles PKCE flow (code= query param) — used by some auth methods
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
