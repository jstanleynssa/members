/**
 * GET /api/tool-access
 * Returns the authenticated member's AXIOM and CALCULUS access status.
 * Uses the service role key so RLS doesn't block the lookup.
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  // Get session from cookie
  const supabase = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.email) return res.status(401).json({ axiom: false, calculus: false })

  const email = session.user.email.toLowerCase()

  const [{ data: axiomRow }, { data: calcRow }] = await Promise.all([
    serviceClient.from('axiom_subscribers').select('status').ilike('email', email).maybeSingle(),
    serviceClient.from('calculus_subscribers').select('active').ilike('email', email).maybeSingle(),
  ])

  res.status(200).json({
    axiom:    axiomRow?.status === 'active',
    calculus: calcRow?.active === true,
  })
}
