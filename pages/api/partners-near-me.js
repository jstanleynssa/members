import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  // Auth gate
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Verify member is celp_certified
  const loginEmail = session.user.email?.toLowerCase()
  const { data: member } = await supabaseAdmin
    .from('members')
    .select('celp_certified, zip, state')
    .ilike('email', loginEmail)
    .maybeSingle()

  if (!member || !member.celp_certified) {
    return res.status(403).json({ error: 'CELP® certification required.' })
  }

  // Fetch all approved partners
  const { data: partners, error } = await supabaseAdmin
    .from('celp_partners')
    .select('id, role_id, role_label, first_name, last_name, email, phone, organization, website, city, state, zip, lat, lng, clients_per_year, referral_direction, about, linkedin, approved_at')
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })

  if (error) {
    console.error('partners-near-me error:', error)
    return res.status(500).json({ error: 'Could not load partners.' })
  }

  return res.status(200).json({
    ok: true,
    partners: partners || [],
    memberZip: member.zip || null,
    memberState: member.state || null,
  })
}
