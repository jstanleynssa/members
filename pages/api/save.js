// pages/api/save.js
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { slugForMember, revalidateDirectorySlugs } from '../../lib/revalidateDirectory'
import { syncContactToKajabi } from '../../lib/kajabi-sync'

// Normalize a user-entered URL: accept bare domains ("www.site.com",
// "site.com") and prepend https:// so the stored value is a valid link.
// Empty/blank stays empty. Never throws — a value we can't parse is returned
// trimmed and untouched rather than blocking the save.
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
    directory_opt_out, profile_completed,
  } = req.body

  // A member can only edit their own row. An admin may target another
  // member explicitly via body.email; everyone else is pinned to their session.
  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  const targetEmail =
    isAdmin && req.body.email ? req.body.email : session.user.email

  // Capture the advisor's CURRENT slug before the update — if they changed
  // their name/city/state, the slug changes and the OLD page must also be
  // revalidated (otherwise the stale URL lingers).
  let oldSlug = ''
  try {
    const { data: prev } = await supabaseAdmin
      .from('members')
      .select('first_name, last_name, city, state')
      .eq('email', targetEmail)
      .single()
    if (prev) oldSlug = slugForMember(prev)
  } catch { /* non-fatal */ }

  const update = {
    first_name, last_name, job_title, company,
    address, city, state, zip,
    phone, mobile_phone,
    website:      normalizeUrl(website),
    linkedin_url: normalizeUrl(linkedin_url),
    bio, financial_disclosure,
  }
  // Persist these only when the client actually sent a boolean, so an edit
  // that omits them (Simple Edit, intermediate wizard steps) never clobbers a
  // previously-saved value. directory_opt_out is the member's directory
  // privacy toggle; profile_completed marks a finished build-out wizard.
  if (typeof directory_opt_out === 'boolean') update.directory_opt_out = directory_opt_out
  if (typeof profile_completed === 'boolean') update.profile_completed = profile_completed

  const { error } = await supabaseAdmin
    .from('members')
    .update(update)
    .eq('email', targetEmail)

  if (error) return res.status(500).json({ error: error.message })

  // Revalidate the directory page(s) on-demand so the public profile updates
  // within seconds. Best-effort — never blocks or fails the save.
  const newSlug = slugForMember({ first_name, last_name, city, state })
  await revalidateDirectorySlugs([oldSlug, newSlug])

  // ── Kajabi sync (best-effort) ──────────────────────────────────────────
  // Push the fields Kajabi cares about to the contact record. Runs after the
  // Supabase save so a Kajabi failure never prevents the member's data from
  // being saved. Awaited (rather than fire-and-forget) so it actually
  // completes on serverless — work left running after the response can be
  // frozen/killed. The helper swallows its own errors, so awaiting can't fail
  // the save; the try/catch is belt-and-suspenders. Fields not relevant to
  // Kajabi (bio, linkedin, disclosure) are intentionally omitted.
  try {
    await syncContactToKajabi(supabaseAdmin, targetEmail, {
      first_name, last_name, phone, city, state, zip,
    })
  } catch (err) {
    console.warn('[save] Kajabi sync threw:', err.message)
  }

  return res.status(200).json({ ok: true })
}
