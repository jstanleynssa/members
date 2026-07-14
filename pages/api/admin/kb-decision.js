/**
 * POST /api/admin/kb-decision
 * Body: { id: uuid, action: 'approve' | 'changes', notes?: string }
 *
 * approve  → status = 'approved', source_last_verified = today
 * changes  → status = 'draft', appends notes to body_sections (as a review note)
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth check
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })
  if (session.user.email !== 'jstanley@nssapros.com') return res.status(403).json({ error: 'Not authorized' })

  const { id, action, notes } = req.body
  if (!id || !action) return res.status(400).json({ error: 'id and action required' })
  if (!['approve', 'changes'].includes(action)) return res.status(400).json({ error: 'action must be approve or changes' })

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const today = new Date().toISOString().split('T')[0]

  if (action === 'approve') {
    const { error } = await supabaseAdmin
      .from('reference_pages')
      .update({
        status: 'approved',
        source_last_verified: today,
        date_modified: today,
      })
      .eq('id', id)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, status: 'approved' })
  }

  if (action === 'changes') {
    // Fetch current body_sections to append review note
    const { data: page, error: fetchError } = await supabaseAdmin
      .from('reference_pages')
      .select('body_sections')
      .eq('id', id)
      .single()

    if (fetchError) return res.status(500).json({ error: fetchError.message })

    const reviewNote = notes?.trim()
      ? {
          heading: `Review note — ${today}`,
          prose: notes.trim(),
          citation_ref: null,
          _review_note: true,
        }
      : null

    const updatedSections = reviewNote
      ? [...(page.body_sections || []), reviewNote]
      : page.body_sections

    const { error } = await supabaseAdmin
      .from('reference_pages')
      .update({
        status: 'draft',
        body_sections: updatedSections,
        date_modified: today,
      })
      .eq('id', id)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, status: 'draft' })
  }
}
