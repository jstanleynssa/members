/**
 * POST /api/admin/kb-update
 * Saves edited fields for a reference_page. Optionally approves in the same call.
 * Body: { id, fields: { title, seo_title, meta_description, ... }, approve: bool }
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_FIELDS = [
  'title', 'seo_title', 'meta_description', 'eyebrow',
  'quick_answer', 'body_sections', 'worked_example',
  'faq', 'primary_sources', 'reviewer', 'deprecation_note',
]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })
  if (session.user.email !== 'jstanley@nssapros.com') return res.status(403).json({ error: 'Not authorized' })

  const { id, fields, approve } = req.body
  if (!id || !fields) return res.status(400).json({ error: 'id and fields required' })

  // Whitelist fields
  const update = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in fields) update[key] = fields[key]
  }

  const today = new Date().toISOString().split('T')[0]
  update.date_modified = today

  if (approve) {
    update.status = 'approved'
    update.source_last_verified = today
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { error } = await supabaseAdmin
    .from('reference_pages')
    .update(update)
    .eq('id', id)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true, approved: !!approve })
}
