/**
 * requireMember — shared getServerSideProps auth helper.
 *
 * Validates the Supabase session and looks up the member record.
 * Admins bypass the certification guard entirely.
 *
 * Returns one of:
 *   { redirect }  — caller should return this directly
 *   { session, member, isAdmin }  — auth passed; use these values
 *
 * Usage:
 *   import { requireMember } from '../../lib/requireMember'
 *
 *   export async function getServerSideProps(context) {
 *     const auth = await requireMember(context)
 *     if (auth.redirect) return auth
 *     const { session, member, isAdmin } = auth
 *     // ... rest of your handler
 *   }
 */

import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'jstanley@arpinstitute.com'

export async function requireMember(context, { select = 'email, first_name, last_name, nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date, nssa_number, irmaa_number, is_active, profile_completed' } = {}) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()

  if (!session) {
    return { redirect: { destination: '/login', permanent: false } }
  }

  const userEmail = session.user.email
  const isAdmin = userEmail === ADMIN_EMAIL

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: member } = await supabaseAdmin
    .from('members')
    .select(select)
    .ilike('email', userEmail)
    .maybeSingle()

  // Admins always get through; everyone else must be a certified member
  if (!isAdmin && (!member || (!member.nssa_certified && !member.irmaa_certified))) {
    await supabaseServer.auth.signOut()
    return { redirect: { destination: '/login?error=not_authorized', permanent: false } }
  }

  // Provide a minimal placeholder member record for admin when no row exists
  const effectiveMember = member || {
    email: userEmail,
    first_name: 'Jason',
    last_name: 'Stanley',
    nssa_certified: true,
    irmaa_certified: true,
    is_active: true,
    profile_completed: true,
    nssa_number: null,
    irmaa_number: null,
    nssa_cert_date: null,
    irmaa_cert_date: null,
  }

  return { session, member: effectiveMember, isAdmin, supabaseAdmin, supabaseServer }
}
