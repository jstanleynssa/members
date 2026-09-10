/**
 * /api/cert?type=nssa|irmaa
 *
 * On-demand certificate PDF generator.
 * Flow:
 *   1. Auth check — must be a certified member
 *   2. Check Supabase Storage cache — serve if exists
 *   3. Copy Google Slides template → fill placeholders → export PDF
 *   4. Store in Supabase Storage → delete Drive copy → stream PDF to client
 */

import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { google } from 'googleapis'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const NSSA_TEMPLATE_ID  = process.env.GOOGLE_NSSA_TEMPLATE_ID
const IRMAA_TEMPLATE_ID = process.env.GOOGLE_IRMAA_TEMPLATE_ID

function getOAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return auth
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { type } = req.query
  if (!['nssa', 'irmaa'].includes(type)) {
    return res.status(400).json({ error: 'type must be nssa or irmaa' })
  }

  // 1. Auth — derive email from session (same pattern as /api/save)
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  const email = session.user.email

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // 2. Look up member
  const { data: member, error: memberErr } = await supabase
    .from('members')
    .select('first_name, last_name, nssa_certified, irmaa_certified, nssa_number, irmaa_number, nssa_cert_date, irmaa_cert_date')
    .ilike('email', email)
    .single()

  if (memberErr || !member) return res.status(404).json({ error: 'Member not found' })

  // Verify they actually hold this cert
  const isNssa  = type === 'nssa'  && member.nssa_certified  && member.nssa_number
  const isIrmaa = type === 'irmaa' && member.irmaa_certified && member.irmaa_number
  if (!isNssa && !isIrmaa) {
    return res.status(403).json({ error: `No ${type.toUpperCase()} certification on record` })
  }

  const certNumber  = type === 'nssa' ? member.nssa_number  : member.irmaa_number
  const certDate    = type === 'nssa' ? member.nssa_cert_date : member.irmaa_cert_date
  const storagePath = `${type}/${certNumber}.pdf`
  const fullName    = `${member.first_name} ${member.last_name}`
  const fileName    = `${fullName.replace(/\s+/g, '_')}_${type.toUpperCase()}_Certificate.pdf`

  // 3. Check cache in Supabase Storage
  const { data: existing } = await supabase.storage
    .from('certificates')
    .download(storagePath)

  if (existing) {
    const buf = Buffer.from(await existing.arrayBuffer())
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    return res.send(buf)
  }

  // 4. Generate via Google Slides
  const auth      = getOAuthClient()
  const drive     = google.drive({ version: 'v3', auth })
  const slides    = google.slides({ version: 'v1', auth })
  const templateId = type === 'nssa' ? NSSA_TEMPLATE_ID : IRMAA_TEMPLATE_ID

  let copyId
  try {
    // 4a. Copy the template
    const copy = await drive.files.copy({
      fileId: templateId,
      requestBody: { name: `cert_tmp_${certNumber}` }
    })
    copyId = copy.data.id

    // 4b. Replace all three placeholders via Slides batchUpdate
    const replacements = {
      '{{full_name}}':         fullName,
      '{{date_awarded}}':      formatDate(certDate),
      '{{certificate_number}}': certNumber,
    }

    await slides.presentations.batchUpdate({
      presentationId: copyId,
      requestBody: {
        requests: Object.entries(replacements).map(([find, replace]) => ({
          replaceAllText: {
            containsText: { text: find, matchCase: true },
            replaceText: replace,
          }
        }))
      }
    })

    // 4c. Export as PDF
    const pdfResp = await drive.files.export(
      { fileId: copyId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    )
    const pdfBuffer = Buffer.from(pdfResp.data)

    // 4d. Store in Supabase Storage
    await supabase.storage
      .from('certificates')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      })

    // 4e. Stream to client
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(pdfBuffer)

  } catch (err) {
    console.error('Cert generation error:', err.message)
    res.status(500).json({ error: 'Failed to generate certificate' })
  } finally {
    // Always clean up the temp Drive copy
    if (copyId) {
      await drive.files.delete({ fileId: copyId }).catch(() => {})
    }
  }
}
