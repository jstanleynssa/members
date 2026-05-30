
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Disable Next.js body parsing — we need the raw body for Zoom signature verification
export const config = { api: { bodyParser: false } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MONTHLY_MEETING_ID = process.env.ZOOM_MONTHLY_MEETING_ID
const WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN
const MIN_DURATION_SECONDS = 2400 // 40 minutes

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function verifySignature(rawBody, timestamp, signature) {
  const message = `v0:${timestamp}:${rawBody}`
  const hash = crypto.createHmac('sha256', WEBHOOK_SECRET).update(message).digest('hex')
  return `v0=${hash}` === signature
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const rawBody = await getRawBody(req)
  let body
  try { body = JSON.parse(rawBody) } catch { return res.status(400).json({ error: 'Invalid JSON' }) }

  // Handle Zoom's URL validation challenge (required when first setting up webhook)
  if (body.event === 'endpoint.url_validation') {
    const hash = crypto.createHmac('sha256', WEBHOOK_SECRET)
      .update(body.payload.plainToken)
      .digest('hex')
    return res.status(200).json({ plainToken: body.payload.plainToken, encryptedToken: hash })
  }

  // Verify Zoom webhook signature
  const timestamp = req.headers['x-zm-request-timestamp']
  const signature = req.headers['x-zm-signature']
  if (!verifySignature(rawBody, timestamp, signature)) {
    console.error('[zoom-webhook] Invalid signature')
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // Only process participant_left events
  if (body.event !== 'meeting.participant_left') {
    return res.status(200).json({ ok: true, skipped: `event: ${body.event}` })
  }

  const meeting = body.payload?.object
  const participant = meeting?.participant

  // Only process our specific monthly meeting (filter by meeting ID)
  if (String(meeting?.id) !== String(MONTHLY_MEETING_ID)) {
    return res.status(200).json({ ok: true, skipped: 'not monthly meeting' })
  }

  const email = participant?.email
  if (!email) return res.status(200).json({ ok: true, skipped: 'no email' })

  const sessionDuration = participant?.duration || 0 // seconds for this session
  const meetingUuid = meeting?.uuid // unique per monthly occurrence (used for deduplication)
  const meetingDate = new Date(meeting?.start_time).toISOString().split('T')[0]
  const currentYear = new Date(meeting?.start_time).getFullYear()
  const monthYear = new Date(meeting?.start_time).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const courseTitle = `NSSA Monthly Member Call — ${monthYear}`

  console.log(`[zoom-webhook] ${email} left after ${sessionDuration}s (meeting: ${meetingUuid})`)

  // Look up member — must be certified to receive credit
  const { data: member } = await supabase
    .from('members')
    .select('email, first_name, last_name, nssa_certified, irmaa_certified')
    .eq('email', email)
    .single()

  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
    return res.status(200).json({ ok: true, skipped: 'not a certified member' })
  }

  // Determine designation: NSSA first, overflow to IRMAA for dual-cert holders
  let designation
  if (member.nssa_certified && !member.irmaa_certified) {
    designation = 'NSSA'
  } else if (!member.nssa_certified && member.irmaa_certified) {
    designation = 'IRMAA'
  } else {
    // Both certs — check current NSSA hours to decide where to apply
    const { data: nssaSubs } = await supabase
      .from('ce_submissions')
      .select('hours_earned')
      .eq('email', email)
      .eq('status', 'approved')
      .eq('year', currentYear)
      .or('designation.eq.NSSA,designation.eq.both')

    const nssaHours = (nssaSubs || []).reduce((sum, s) => sum + Number(s.hours_earned), 0)
    designation = nssaHours >= 4 ? 'IRMAA' : 'NSSA'
    console.log(`[zoom-webhook] Dual-cert: NSSA hours=${nssaHours}, applying to ${designation}`)
  }

  // Check for existing CE record for this person + this specific meeting occurrence
  const { data: existing } = await supabase
    .from('ce_submissions')
    .select('*')
    .eq('email', email)
    .eq('zoom_meeting_id', meetingUuid)
    .maybeSingle()

  const totalDuration = (existing?.zoom_duration_seconds || 0) + sessionDuration
  const qualifies = totalDuration >= MIN_DURATION_SECONDS

  console.log(`[zoom-webhook] ${email} total duration: ${totalDuration}s, qualifies: ${qualifies}`)

  if (existing) {
    // Update accumulated duration — approve once threshold is crossed
    const { error } = await supabase
      .from('ce_submissions')
      .update({
        zoom_duration_seconds: totalDuration,
        status: qualifies ? 'approved' : existing.status,
        designation // recalculate in case hours changed since last session
      })
      .eq('id', existing.id)

    if (error) console.error('[zoom-webhook] Update error:', error)
    return res.status(200).json({ ok: true, action: 'updated', email, totalDuration, qualifies })

  } else {
    // Create new record
    const { error } = await supabase.from('ce_submissions').insert({
      email,
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      course_title: courseTitle,
      completion_date: meetingDate,
      hours_earned: 1,
      ce_type: 'Monthly Member Call',
      designation,
      source: 'zoom_auto',
      status: qualifies ? 'approved' : 'pending',
      zoom_meeting_id: meetingUuid,
      zoom_duration_seconds: sessionDuration
    })

    if (error) console.error('[zoom-webhook] Insert error:', error)
    return res.status(200).json({ ok: true, action: 'created', email, totalDuration, qualifies })
  }
}
