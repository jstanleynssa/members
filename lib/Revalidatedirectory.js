// lib/revalidateDirectory.js  (MEMBERS app)
//
// After an advisor's profile is saved, ping the DIRECTORY app's on-demand
// revalidation route so their public page (directory.nssapros.com/<slug>)
// reflects the change within a second or two — instead of waiting for the
// directory's daily (revalidate: 86400) rebuild.
//
// Cross-app: the page lives in the directory app, so we call its HTTP route
// rather than revalidating locally (Next.js res.revalidate only affects the
// current app). Gated by a shared secret set in BOTH apps as REVALIDATE_SECRET.
//
// Best-effort: this NEVER throws. A revalidation failure must not fail the
// save — the data is already persisted, and the page will still self-heal on
// the daily revalidate. We log and move on.

import { buildBaseSlug } from './slug'

// Compute an advisor's directory slug from a member-shaped object.
// NOTE: this is the BASE slug (first-last-city-st). The directory's
// buildSlugIndex appends "-{id}" only on collisions; for revalidation we
// revalidate the base slug, and if a collision suffix exists the daily
// rebuild still covers it. (Collisions are rare — 0 at last count.)
export function slugForMember(member) {
  try {
    return buildBaseSlug(member)
  } catch {
    return ''
  }
}

// Fire revalidation for one or more slugs. Returns nothing; swallows all errors.
export async function revalidateDirectorySlugs(slugs) {
  const secret = process.env.REVALIDATE_SECRET
  const base = process.env.DIRECTORY_URL || 'https://directory.nssapros.com'
  const list = [...new Set((slugs || []).filter(Boolean))]
  if (!secret || list.length === 0) return

  try {
    await fetch(`${base}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, slugs: list }),
    })
  } catch (err) {
    // Non-fatal: the save already succeeded; the page self-heals on the daily
    // revalidate even if this call failed.
    console.error('[revalidateDirectory] non-fatal:', err.message)
  }
}
