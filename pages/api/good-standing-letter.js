/**
 * /api/good-standing-letter
 *
 * On-demand Good Standing Letter PDF generator using a Google Doc template.
 *
 * Flow — Drive API only (no Docs API required):
 *   1. Auth check — must be an active, certified member
 *   2. Export the template Doc as HTML via Drive
 *   3. String-replace {{full_name}} and {{date}} in the HTML
 *   4. Upload modified HTML back to Drive as a new Google Doc (auto-converts)
 *   5. Export the new Doc as PDF via Drive
 *   6. Delete the temp Doc
 *   7. Stream PDF to client
 *
 * Template placeholders (must exist in the Google Doc as plain text):
 *   {{full_name}}  — member's full name, e.g. "Chad Mueller"
 *   {{date}}       — today's date, e.g. "August 21, 2026"
 *
 * Good-standing check:
 *   - member.is_active !== false
 *   - member.nssa_certified || member.irmaa_certified (at least one)
 *   - cert number exists (designation was formally issued)
 *
 * No caching — generated fresh on every request so the date is always current.
 */

import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { google } from 'googleapis'
import { Readable } from 'stream'

const TEMPLATE_ID = process.env.GOOGLE_GOOD_STANDING_TEMPLATE_ID

function getOAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return auth
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  const email = session.user.email

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // ── 2. Fetch member ───────────────────────────────────────────────────────
  const { data: member, error } = await supabase
    .from('members')
    .select('first_name, last_name, nssa_certified, irmaa_certified, nssa_number, irmaa_number, is_active')
    .ilike('email', email)
    .single()

  if (error || !member)           return res.status(404).json({ error: 'Member not found' })
  if (member.is_active === false) return res.status(403).json({ error: 'Membership is not active' })

  const nssaOk  = !!(member.nssa_certified  && member.nssa_number)
  const irmaaOk = !!(member.irmaa_certified && member.irmaa_number)
  if (!nssaOk && !irmaaOk) {
    return res.status(403).json({ error: 'No active certification on file' })
  }

  const fullName = `${(member.first_name || '').trim()} ${(member.last_name || '').trim()}`.trim()
  const today    = formatDate(new Date())
  const lastName = (member.last_name || 'Member').replace(/[^a-zA-Z0-9]/g, '_')

  const auth  = getOAuthClient()
  const drive = google.drive({ version: 'v3', auth })

  let tmpId
  try {
    // ── 3. Export template as HTML ──────────────────────────────────────────
    const htmlResp = await drive.files.export(
      { fileId: TEMPLATE_ID, mimeType: 'text/html' },
      { responseType: 'text' }
    )
    let html = htmlResp.data

    // ── 4. Replace placeholders ─────────────────────────────────────────────
    html = html.replace(/\{\{full_name\}\}/g, fullName)
    html = html.replace(/\{\{date\}\}/g,      today)

    // ── 5. Upload modified HTML → new Google Doc (Drive auto-converts) ──────
    const bodyStream = Readable.from([html])
    const createResp = await drive.files.create({
      requestBody: {
        name:     `gsl_tmp_${Date.now()}`,
        mimeType: 'application/vnd.google-apps.document',
      },
      media: {
        mimeType: 'text/html',
        body:     bodyStream,
      },
    })
    tmpId = createResp.data.id

    // ── 6. Export the new Doc as PDF ─────────────────────────────────────────
    const pdfResp = await drive.files.export(
      { fileId: tmpId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    )
    const pdfBuffer = Buffer.from(pdfResp.data)

    // ── 7. Stream to client ───────────────────────────────────────────────────
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="NSSA_Good_Standing_${lastName}.pdf"`)
    res.send(pdfBuffer)

  } catch (err) {
    console.error('Good standing letter error:', err.message)
    res.status(500).json({ error: 'Failed to generate letter' })
  } finally {
    // Always clean up the temp Drive Doc
    if (tmpId) {
      await drive.files.delete({ fileId: tmpId }).catch(() => {})
    }
  }
}
