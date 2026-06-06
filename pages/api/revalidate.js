// pages/api/revalidate.js  (DIRECTORY app)
//
// On-demand ISR revalidation. The members app calls this right after an
// advisor saves their profile, so the public directory page reflects the
// change within a second or two instead of waiting for the daily revalidate.
//
// Cross-app by design: the save happens in the members app (members.nssapros.com),
// but the profile page lives here in the directory app (directory.nssapros.com),
// and Next.js res.revalidate() can only revalidate pages in THIS app. So the
// members app makes an authenticated HTTP call to this route.
//
// Security: a shared secret (REVALIDATE_SECRET) gates the route so the public
// can't trigger arbitrary rebuilds. Same secret value must be set in BOTH apps.
//
// Slug changes: when an advisor edits city/state/name their slug changes. The
// caller should pass BOTH the old and the new slug (comma-separated or repeated)
// so the stale page is revalidated (it will 404 or redirect) and the new page
// is built. This route accepts one or many slugs.

export default async function handler(req, res) {
  // Accept GET or POST; secret may come from query or body.
  const secret = req.query.secret || (req.body && req.body.secret)
  if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing secret' })
  }

  // Collect slugs from query (?slug=a&slug=b or ?slug=a,b) or body ({ slugs: [] } / { slug: '' }).
  let slugs = []
  const q = req.query.slug
  if (Array.isArray(q)) slugs.push(...q)
  else if (typeof q === 'string') slugs.push(...q.split(','))
  if (req.body) {
    if (Array.isArray(req.body.slugs)) slugs.push(...req.body.slugs)
    if (typeof req.body.slug === 'string') slugs.push(...req.body.slug.split(','))
  }

  // Normalize: trim, strip any leading slash, dedupe, drop empties.
  slugs = [...new Set(
    slugs.map(s => String(s || '').trim().replace(/^\/+/, '')).filter(Boolean)
  )]

  if (slugs.length === 0) {
    return res.status(400).json({ ok: false, error: 'No slug(s) provided' })
  }

  const results = []
  for (const slug of slugs) {
    try {
      await res.revalidate('/' + slug)
      results.push({ slug, revalidated: true })
    } catch (err) {
      // A revalidate failure for one slug shouldn't fail the whole call.
      results.push({ slug, revalidated: false, error: err.message })
    }
  }

  const anyOk = results.some(r => r.revalidated)
  return res.status(anyOk ? 200 : 500).json({ ok: anyOk, results })
}
