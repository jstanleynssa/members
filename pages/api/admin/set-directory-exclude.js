import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { slugForMember, revalidateDirectorySlugs } from '../../../lib/revalidateDirectory'

// POST /api/admin/set-directory-exclude
// Body: { email, exclude: true|false }
// Admin-only. Sets admin_directory_exclude on a member and triggers directory revalidation.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session || session.user.email !== 'jstanley@nssapros.com') {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const { email, exclude } = req.body
  if (!email || typeof exclude !== 'boolean') {
    return res.status(400).json({ error: 'Missing email or exclude flag' })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { error } = await supabaseAdmin
    .from('members')
    .update({ admin_directory_exclude: exclude })
    .eq('email', email)

  if (error) return res.status(500).json({ error: error.message })

  // Revalidate directory so exclusion takes effect immediately.
  // Best-effort — never fails the save.
  try {
    const { data: member } = await supabaseAdmin
      .from('members')
      .select('first_name, last_name, city, state')
      .eq('email', email)
      .single()
    if (member) {
      const slug = slugForMember(member)
      await revalidateDirectorySlugs([slug])
    }
  } catch { /* non-fatal */ }

  return res.status(200).json({ ok: true })
}
