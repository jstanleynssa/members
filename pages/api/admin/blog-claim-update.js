import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'jstanley@nssapros.com'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session || session.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' })

  const { id, verdict, sme_note } = req.body
  if (!id || !verdict) return res.status(400).json({ error: 'Missing id or verdict' })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { error } = await sb
    .from('blog_post_claims')
    .update({
      verdict,
      sme_note: sme_note || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
