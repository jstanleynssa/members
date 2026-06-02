import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Authenticate via the session — never trust an email from the body.
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const {
    first_name, last_name, job_title, company,
    address, city, state, zip,
    phone, mobile_phone, website, linkedin_url,
    bio, financial_disclosure,
  } = req.body

  // A member can only edit their own row. An admin may target another
  // member explicitly via body.email; everyone else is pinned to their session.
  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  const targetEmail =
    isAdmin && req.body.email ? req.body.email : session.user.email

  const { error } = await supabaseAdmin
    .from('members')
    .update({
      first_name, last_name, job_title, company,
      address, city, state, zip,
      phone, mobile_phone, website, linkedin_url,
      bio, financial_disclosure,
    })
    .eq('email', targetEmail)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
