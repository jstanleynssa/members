// lib/slug.js
// Deterministic slug construction for advisor directory pages.
// Slug shape: first-last-city-st  (e.g. joy-cheney-stoughton-ma)
//
// Job titles are intentionally NOT in the slug — not every cert holder is an
// "advisor" (some are CPAs, attorneys, agents), so a title token would be
// inaccurate. City/state localize the URL; collisions fall back to the id.
// This is deterministic and reproducible — the same input always yields the
// same slug, which is essential for stable SEO URLs across rebuilds.

// US state name → 2-letter abbreviation (covers full names and existing abbreviations)
const STATE_ABBR = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga',
  hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia',
  kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md',
  massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo',
  montana: 'mt', nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
  'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh',
  oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt',
  virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy',
  'district of columbia': 'dc',
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function stateToken(state) {
  if (!state) return ''
  const s = state.trim().toLowerCase()
  if (STATE_ABBR[s]) return STATE_ABBR[s]
  if (s.length === 2) return s // already an abbreviation
  return slugify(state)
}

// Build the base slug (without collision suffix).
export function buildBaseSlug(member) {
  const parts = [
    slugify(member.first_name),
    slugify(member.last_name),
    slugify(member.city),
    stateToken(member.state),
  ].filter(Boolean)
  return parts.join('-')
}

// Build slugs for the full member set, disambiguating collisions.
// First occurrence keeps the clean slug; subsequent collisions get the member
// id appended (stable, since ids don't change). Returns a Map of email -> slug
// and the reverse Map of slug -> member for getStaticPaths/Props.
export function buildSlugIndex(members) {
  const seen = new Map()       // baseSlug -> count
  const bySlug = new Map()     // finalSlug -> member
  const byEmail = new Map()    // email -> finalSlug

  for (const m of members) {
    const base = buildBaseSlug(m)
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    // First one keeps the clean slug; collisions append a stable id token.
    const finalSlug = count === 0 ? base : `${base}-${m.id}`
    bySlug.set(finalSlug, m)
    byEmail.set(m.email, finalSlug)
  }
  return { bySlug, byEmail }
}
