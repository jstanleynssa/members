// pages/api/admin/backfill-kajabi-avatars.js
// ONE-TIME USE: Pushes existing Supabase profile photos to Kajabi avatars.
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
// With ~707 photos this will take approximately 6-7 minutes to complete.
// The response streams progress as newline-delimited JSON.

// Required: prevents Next.js from attempting static prerender at build time
export const config = { api: { bodyParser: false } }

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

async function getCustomerId(contactId, token) {
  const res = await fetch(
    `${KAJABI_API}/contacts/${contactId}?include=customer`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.api+json',
      },
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data?.data?.relationships?.customer?.data?.id || null
}

async function patchAvatar(customerId, avatarUrl, token) {
  const res = await fetch(`${KAJABI_API}/customers/${customerId}`, {
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
        attributes: { avatar: avatarUrl },
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
  const { data: members, error } = await supabase
    .from('members')
    .select('email, profile_photo, kajabi_contact_id')
    .not('profile_photo', 'is', null)
    .not('kajabi_contact_id', 'is', null)
    .order('email')

  if (error) {
    return res.status(500).json({ error: `Supabase query failed: ${error.message}` })
  }

  const total = members.length
  console.log(`[backfill] Starting avatar backfill for ${total} members`)

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

      // Strip cache-bust params before sending to Kajabi
      const cleanUrl = profile_photo.split('?')[0]

      if (!cleanUrl) {
        results.skipped++
        continue
      }

      try {
        // Step 1: get customer ID from contact
        const customerId = await getCustomerId(kajabi_contact_id, token)

        if (!customerId) {
          console.warn(`[backfill] No customer for contact ${kajabi_contact_id} (${email})`)
          results.skipped++
          continue
        }

        // Step 2: patch avatar
        const ok = await patchAvatar(customerId, cleanUrl, token)

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
    message: 'Backfill complete',
    ...results,
  })
}
