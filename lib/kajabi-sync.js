// lib/kajabi-sync.js
// Shared Kajabi API sync utility for the members portal.
//
// Handles OAuth2 client-credentials token fetch (with in-memory caching so we
// don't request a new token on every save), and exposes two functions:
//
//   syncContactToKajabi(supabaseAdmin, email, fields)
//     Push profile field changes (name, phone, state, city, zip) to the
//     Kajabi contact record matched by kajabi_contact_id.
//
//   syncAvatarToKajabi(supabaseAdmin, email, photoUrl)
//     Push a new profile photo URL to the Kajabi customer avatar field.
//
// Both functions are best-effort and non-blocking — they log warnings on
// failure but never throw or cause the parent API route to fail.
//
// Required env vars (set in Vercel):
//   KAJABI_CLIENT_ID      — OAuth2 client ID from Kajabi API settings
//   KAJABI_CLIENT_SECRET  — OAuth2 client secret from Kajabi API settings
//   KAJABI_SITE_ID        — Kajabi site ID (from admin URL)

const KAJABI_API   = 'https://api.kajabi.com/v1'
const KAJABI_TOKEN = 'https://api.kajabi.com/v1/oauth/token'

// ── In-memory token cache ─────────────────────────────────────────────────
// Token lives for 2 hours per Kajabi docs; we refresh 5 minutes early.
let _cachedToken    = null
let _tokenExpiresAt = 0

async function getBearerToken() {
  const now = Date.now()
  if (_cachedToken && now < _tokenExpiresAt) return _cachedToken

  const clientId     = process.env.KAJABI_CLIENT_ID
  const clientSecret = process.env.KAJABI_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('KAJABI_CLIENT_ID or KAJABI_CLIENT_SECRET env vars not set')
  }

  const params = new URLSearchParams()
  params.append('grant_type',    'client_credentials')
  params.append('client_id',     clientId)
  params.append('client_secret', clientSecret)

  const res = await fetch(KAJABI_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kajabi token fetch failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  _cachedToken    = data.access_token
  // expires_in is in seconds; cache for that duration minus 5 min buffer
  _tokenExpiresAt = now + ((data.expires_in || 7200) - 300) * 1000
  return _cachedToken
}

// ── Look up kajabi_contact_id for an email ────────────────────────────────
async function getKajabiContactId(supabaseAdmin, email) {
  const { data, error } = await supabaseAdmin
    .from('members')
    .select('kajabi_contact_id')
    .eq('email', email)
    .single()

  if (error || !data?.kajabi_contact_id) return null
  return data.kajabi_contact_id
}

// ── Sync contact fields → Kajabi ──────────────────────────────────────────
// fields: object with any subset of:
//   { first_name, last_name, phone, city, state, zip }
// Maps to Kajabi contact attributes:
//   name (full name), phone_number, address_city, address_state, address_zip
export async function syncContactToKajabi(supabaseAdmin, email, fields) {
  try {
    const contactId = await getKajabiContactId(supabaseAdmin, email)
    if (!contactId) {
      console.warn(`[kajabi-sync] No kajabi_contact_id for ${email} — skipping contact sync`)
      return
    }

    // Build the Kajabi attributes payload from whichever fields were provided
    const attributes = {}

    // Kajabi stores the full name as a single 'name' field
    if (fields.first_name !== undefined || fields.last_name !== undefined) {
      // Fetch current name from Supabase if only one half was provided
      let first = fields.first_name
      let last  = fields.last_name
      if (first === undefined || last === undefined) {
        const { data: m } = await supabaseAdmin
          .from('members')
          .select('first_name, last_name')
          .eq('email', email)
          .single()
        if (m) {
          first = first ?? m.first_name
          last  = last  ?? m.last_name
        }
      }
      const fullName = [first, last].filter(Boolean).join(' ')
      if (fullName) attributes.name = fullName
    }

    if (fields.phone     !== undefined) attributes.phone_number  = fields.phone     || null
    if (fields.city      !== undefined) attributes.address_city  = fields.city      || null
    if (fields.state     !== undefined) attributes.address_state = fields.state     || null
    if (fields.zip       !== undefined) attributes.address_zip   = fields.zip       || null

    if (Object.keys(attributes).length === 0) {
      console.log(`[kajabi-sync] No syncable fields for ${email} — skipping`)
      return
    }

    const token = await getBearerToken()
    const res = await fetch(`${KAJABI_API}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Content-Type':   'application/vnd.api+json',
        'Accept':         'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          id:         String(contactId),
          type:       'contacts',
          attributes,
        }
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.warn(`[kajabi-sync] Contact update failed for ${email} (${res.status}): ${text}`)
      return
    }

    console.log(`[kajabi-sync] ✓ Contact synced for ${email}`)
  } catch (err) {
    // Never block the parent save — log and move on
    console.warn(`[kajabi-sync] Contact sync error for ${email}: ${err.message}`)
  }
}

// ── Avatar sync ───────────────────────────────────────────────────────────
// NOTE: Kajabi's public API does not expose a write endpoint for the customer
// avatar field. The avatar attribute is readable via GET /v1/customers/{id}
// but there is no PATCH /v1/customers endpoint in the public API.
// This function is a no-op placeholder in case Kajabi adds support later.
export async function syncAvatarToKajabi(supabaseAdmin, email, photoUrl) {
  console.log(`[kajabi-sync] Avatar sync skipped for ${email} — Kajabi API does not support avatar updates`)
}
