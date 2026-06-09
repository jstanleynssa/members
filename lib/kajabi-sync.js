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

const KAJABI_API   = 'https://kajabi.com/api/v1'
const KAJABI_TOKEN = 'https://kajabi.com/oauth/token'

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

  const res = await fetch(KAJABI_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
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

// ── Sync avatar → Kajabi customer record ──────────────────────────────────
// Kajabi stores the avatar on the *customer* resource, not the contact.
// The customer link is available via GET /v1/contacts/{id}?include=customer,
// but we can also PATCH the customer directly via the customer URL returned
// in the contact's links.customer field.
// photoUrl: full public URL of the saved photo (strip cache-bust params first)
export async function syncAvatarToKajabi(supabaseAdmin, email, photoUrl) {
  try {
    const contactId = await getKajabiContactId(supabaseAdmin, email)
    if (!contactId) {
      console.warn(`[kajabi-sync] No kajabi_contact_id for ${email} — skipping avatar sync`)
      return
    }

    const token = await getBearerToken()

    // Step 1: fetch contact to get the customer ID from the relationships
    const contactRes = await fetch(
      `${KAJABI_API}/contacts/${contactId}?include=customer`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept':        'application/vnd.api+json',
        },
      }
    )

    if (!contactRes.ok) {
      console.warn(`[kajabi-sync] Could not fetch contact ${contactId} for avatar sync`)
      return
    }

    const contactData = await contactRes.json()

    // Extract customer ID from relationships
    const customerId = contactData?.data?.relationships?.customer?.data?.id
    if (!customerId) {
      console.warn(`[kajabi-sync] No customer linked to contact ${contactId} — skipping avatar`)
      return
    }

    // Step 2: PATCH the customer avatar
    // Strip any cache-bust query params before sending to Kajabi
    const cleanUrl = photoUrl.split('?')[0]

    const avatarRes = await fetch(`${KAJABI_API}/customers/${customerId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/vnd.api+json',
        'Accept':        'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          id:         String(customerId),
          type:       'customers',
          attributes: { avatar: cleanUrl },
        }
      }),
    })

    if (!avatarRes.ok) {
      const text = await avatarRes.text()
      console.warn(`[kajabi-sync] Avatar update failed for ${email} (${avatarRes.status}): ${text}`)
      return
    }

    console.log(`[kajabi-sync] ✓ Avatar synced for ${email}`)
  } catch (err) {
    console.warn(`[kajabi-sync] Avatar sync error for ${email}: ${err.message}`)
  }
}
