import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function AuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('Signing you in…')

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setStatus('Signed in! Redirecting…')
        router.replace('/dashboard')
      }
    })
    const timeout = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) router.replace('/login?error=no_session')
    }, 5000)
    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [router])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#666' }}>
      <p>{status}</p>
    </div>
  )
}

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
