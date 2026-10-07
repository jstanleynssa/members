import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const email = (req.query.email || '').trim().toLowerCase()
  if (!email) return res.redirect('/login')

  // Optional deep-link target — must be an internal path (starts with /)
  const rawNext = (req.query.next || '').trim()
  const next = rawNext.startsWith('/') ? rawNext : null

  // Verify they're a certified member
  const { data: member } = await supabase
    .from('members')
    .select('email')
    .eq('email', email)
    .single()

  if (!member) return res.redirect('/login?error=not_found')

  // Generate magic link — creates auth user if needed, logs them in instantly
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      // Pass ?next= through so the callback can deep-link after auth.
      // next is sanitized to only allow internal paths (starts with /).
      redirectTo: 'https://members.arpinstitute.com/auth/callback' +
        (next ? '?next=' + encodeURIComponent(next) : '')
    }
  })

  if (error || !data?.properties?.action_link) {
    console.error('[kajabi-sso] generateLink error:', error?.message)
    return res.redirect('/login?error=link_failed')
  }

  res.redirect(data.properties.action_link)
}
