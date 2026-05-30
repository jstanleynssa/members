import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const { email } = req.query
  if (!email) return res.redirect('/login')

  const { data: member } = await supabase
    .from('members')
    .select('email')
    .eq('email', email)
    .single()

  if (!member) return res.redirect('/login?error=not_found')

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: 'https://members.nssapros.com/auth/callback' }
  })

  if (error || !data?.properties?.action_link) {
    return res.redirect('/login?error=link_failed')
  }

  res.redirect(data.properties.action_link)
}
