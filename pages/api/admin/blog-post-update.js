import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'jstanley@nssapros.com'
const VALID_TRIAGE = ['keep', 'fix', 'archive', 'retire', null]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session || session.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' })

  const { id, triage_bucket, review_status } = req.body
  if (!id) return res.status(400).json({ error: 'Missing id' })
  if (triage_bucket !== undefined && !VALID_TRIAGE.includes(triage_bucket)) {
    return res.status(400).json({ error: 'Invalid triage_bucket' })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const update = {}
  if (triage_bucket !== undefined) update.triage_bucket = triage_bucket
  if (review_status !== undefined) update.review_status = review_status

  const { error } = await sb.from('blog_posts').update(update).eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
