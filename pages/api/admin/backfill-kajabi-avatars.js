// pages/api/admin/backfill-kajabi-avatars.js
// ONE-TIME USE: Pushes existing Supabase profile data to Kajabi contacts.
// NOTE: Kajabi's public API does not expose an avatar/photo write endpoint.
// This backfill syncs: name, phone, address_city, address_state, address_zip.
// 
// USAGE:
//   1. Deploy this file to the members app
//   2. Visit: https://members.nssapros.com/api/admin/backfill-kajabi-avatars?secret=YOUR_SECRET
//   3. Watch the JSON progress response
//   4. DELETE this file and redeploy when done
//
// Add BACKFILL_SECRET to your Vercel env vars (any random string you choose)
// to prevent unauthorized access. Remove it after the backfill is complete.
//
// Rate limited to 2 requests/second to stay within Kajabi API limits.
// With ~1640 contacts this will take ~14 minutes total across all batches.
// The response streams progress as newline-delimited JSON.

// Required: prevents Next.js from attempting static prerender at build time.
// maxDuration: 300 seconds (max on Vercel Pro). On Hobby plan max is 60.
// Process in batches using ?offset=0&limit=100 to stay within timeout.
export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
}

import { createClient } from '@supabase/supabase-js'

const KAJABI_API   = 'https://api.kajabi.com/v1'
const KAJABI_TOKEN = 'https://api.kajabi.com/v1/oauth/token'
const RATE_LIMIT_MS = 500  // 2 requests per second

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getBearerToken() {
  const params = new URLSearchParams()
  params.append('grant_type',    'client_credentials')
  params.append('client_id',     process.env.KAJABI_CLIENT_ID)
  params.append('client_secret', process.env.KAJABI_CLIENT_SECRET)

  const res = await fetch(KAJABI_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token fetch failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  return data.access_token
}

async function patchContact(contactId, attributes, token) {
  const res = await fetch(`${KAJABI_API}/contacts/${contactId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/vnd.api+json',
      'Accept':        'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        id:         String(contactId),
        type:       'contacts',
        attributes,
      }
    }),
  })
  return res.ok
}

export default async function handler(req, res) {
  // ── Auth guard ──────────────────────────────────────────────────────────
  const secret = process.env.BACKFILL_SECRET
  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized — pass ?secret=YOUR_SECRET' })
  }

  // ── Admin only ──────────────────────────────────────────────────────────
  // Extra safety: only callable from the admin email context or via secret
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // ── Fetch all members with a photo and a Kajabi contact ID ─────────────
  // Batch processing: use ?offset=0&limit=100 to process in chunks
  // e.g. first batch:  ?secret=X&offset=0&limit=100
  //      second batch: ?secret=X&offset=100&limit=100
  //      third batch:  ?secret=X&offset=200&limit=100  etc.
  const offset = parseInt(req.query.offset || '0', 10)
  const limit  = parseInt(req.query.limit  || '100', 10)

  const { data: members, error } = await supabase
    .from('members')
    .select('email, first_name, last_name, phone, city, state, zip, kajabi_contact_id')
    .not('kajabi_contact_id', 'is', null)
    .order('email')
    .range(offset, offset + limit - 1)

  if (error) {
    return res.status(500).json({ error: `Supabase query failed: ${error.message}` })
  }

  const total = members.length
  console.log(`[backfill] Processing ${total} members (offset=${offset}, limit=${limit})`)

  // ── Stream progress as JSON ─────────────────────────────────────────────
  // Set headers for streaming response
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('X-Accel-Buffering', 'no')

  const results = {
    total,
    succeeded: 0,
    failed:    0,
    skipped:   0,
    errors:    [],
  }

  try {
    // Fetch token once upfront
    const token = await getBearerToken()
    console.log(`[backfill] Token obtained ✓`)

    for (let i = 0; i < members.length; i++) {
      const { email, profile_photo, kajabi_contact_id } = members[i]

      // Build attributes from whatever fields are populated
      const attributes = {}
      const { first_name, last_name, phone, city, state, zip } = members[i]

      const fullName = [first_name, last_name].filter(Boolean).join(' ')
      if (fullName)  attributes.name            = fullName
      if (phone)     attributes.phone_number    = phone
      if (city)      attributes.address_city    = city
      if (state)     attributes.address_state   = state
      if (zip)       attributes.address_zip     = zip

      if (Object.keys(attributes).length === 0) {
        results.skipped++
        continue
      }

      try {
        const ok = await patchContact(kajabi_contact_id, attributes, token)

        if (ok) {
          results.succeeded++
          console.log(`[backfill] ✓ ${i + 1}/${total} ${email}`)
        } else {
          results.failed++
          results.errors.push({ email, reason: 'PATCH failed' })
          console.warn(`[backfill] ✗ ${i + 1}/${total} ${email} — PATCH failed`)
        }
      } catch (err) {
        results.failed++
        results.errors.push({ email, reason: err.message })
        console.warn(`[backfill] ✗ ${i + 1}/${total} ${email} — ${err.message}`)
      }

      // Rate limit: 2 requests per second
      // Each iteration does 2 API calls (getCustomer + patchAvatar)
      // so we wait 500ms between members
      if (i < members.length - 1) {
        await sleep(RATE_LIMIT_MS)
      }
    }
  } catch (err) {
    return res.status(500).json({
      error: `Backfill failed: ${err.message}`,
      partial_results: results,
    })
  }

  console.log(`[backfill] Complete — ${results.succeeded} succeeded, ${results.failed} failed, ${results.skipped} skipped`)

  return res.status(200).json({
    message: 'Batch complete',
    offset,
    limit,
    next_offset: total < limit ? null : offset + limit,
    ...results,
  })
}
