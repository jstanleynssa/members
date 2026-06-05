import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

// Normalize a user-entered URL: accept bare domains and prepend https://.
// Empty stays empty; unparseable values pass through untouched.
function normalizeUrl(value) {
  if (value == null) return value
  const v = String(value).trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|\?)/i.test(v)) return 'https://' + v
  return v
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session || session.user.email !== 'jstanley@nssapros.com') {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const {
    email, first_name, last_name, job_title, company,
    address, city, state, zip, phone, website,
    bio, financial_disclosure
  } = req.body

  if (!email) return res.status(400).json({ error: 'Missing email' })

  const { error } = await supabaseAdmin
    .from('members')
    .update({
      first_name, last_name, job_title, company,
      address, city, state, zip, phone,
      website: normalizeUrl(website),
      bio, financial_disclosure
    })
    .eq('email', email)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true })
}
