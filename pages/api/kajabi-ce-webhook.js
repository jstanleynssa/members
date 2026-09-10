import { createClient } from '@supabase/supabase-js'

// Kajabi sends standard JSON — no raw body needed
export const config = { api: { bodyParser: true } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WEBHOOK_SECRET = process.env.KAJABI_CE_WEBHOOK_SECRET

// Expected tag format: ce-recording-MMYYYY (e.g. ce-recording-082026)
// Returns { month: 8, year: 2026, monthYear: 'August 2026', completionDate: '2026-08-01' }
// or null if the tag doesn't match the pattern
function parseRecordingTag(tag) {
  const match = tag?.match(/^ce-recording-(\d{2})(\d{4})$/)
  if (!match) return null

  const month = parseInt(match[1], 10) // 1-12
  const year = parseInt(match[2], 10)

  if (month < 1 || month > 12) return null

  const date = new Date(year, month - 1, 1)
  const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const completionDate = `${year}-${String(month).padStart(2, '0')}-01`

  return { month, year, monthYear, completionDate }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify secret — Kajabi sends it as a header or query param
  const providedSecret =
    req.headers['x-kajabi-token'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.secret

  if (!WEBHOOK_SECRET || providedSecret !== WEBHOOK_SECRET) {
    console.error('[kajabi-ce-webhook] Unauthorized — bad or missing secret')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = req.body

  // Kajabi tag-added webhook payload (adjust field paths if Kajabi's format differs)
  // Expected shape: { member: { email, first_name, last_name }, tag: 'ce-recording-082026' }
  // Fallback: { email, first_name, last_name, tag }
  const email = (body.member?.email || body.email || '').toLowerCase().trim()
  const firstName = body.member?.first_name || body.first_name || ''
  const lastName = body.member?.last_name || body.last_name || ''
  const tag = body.member?.tag || body.tag || body.tag_name || ''

  console.log(`[kajabi-ce-webhook] Received tag="${tag}" for email="${email}"`)

  if (!email) return res.status(200).json({ ok: true, skipped: 'no email in payload' })

  // Only process ce-recording-* tags
  const parsed = parseRecordingTag(tag)
  if (!parsed) {
    return res.status(200).json({ ok: true, skipped: `tag "${tag}" is not a CE recording tag` })
  }

  const { year, monthYear, completionDate } = parsed
  const courseTitle = `NSSA Monthly Member Call — ${monthYear} (Recording)`

  // Look up member — must be certified
  const { data: member } = await supabase
    .from('members')
    .select('email, first_name, last_name, nssa_certified, irmaa_certified')
    .eq('email', email)
    .single()

  if (!member) {
    console.warn(`[kajabi-ce-webhook] No member found for ${email}`)
    return res.status(200).json({ ok: true, skipped: 'member not found' })
  }

  if (!member.nssa_certified && !member.irmaa_certified) {
    console.warn(`[kajabi-ce-webhook] ${email} is not certified`)
    return res.status(200).json({ ok: true, skipped: 'not a certified member' })
  }

  // Designation waterfall — same logic as zoom-webhook
  let designation
  if (member.nssa_certified && !member.irmaa_certified) {
    designation = 'NSSA'
  } else if (!member.nssa_certified && member.irmaa_certified) {
    designation = 'IRMAA'
  } else {
    // Dual-cert: apply to NSSA until 4 hours are met, then overflow to IRMAA
    const { data: nssaSubs } = await supabase
      .from('ce_submissions')
      .select('hours_earned')
      .eq('email', email)
      .eq('status', 'approved')
      .eq('year', year)
      .or('designation.eq.NSSA,designation.eq.both')

    const nssaHours = (nssaSubs || []).reduce((sum, s) => sum + Number(s.hours_earned), 0)
    designation = nssaHours >= 4 ? 'IRMAA' : 'NSSA'
    console.log(`[kajabi-ce-webhook] Dual-cert: NSSA hours=${nssaHours}, applying to ${designation}`)
  }

  // Check for an existing kajabi_recording submission for this email + month.
  // This guards against duplicate webhook deliveries from Kajabi.
  const { data: existing } = await supabase
    .from('ce_submissions')
    .select('id')
    .eq('email', email)
    .eq('source', 'kajabi_recording')
    .eq('completion_date', completionDate)
    .maybeSingle()

  if (existing) {
    console.log(`[kajabi-ce-webhook] Duplicate — already credited ${email} for ${monthYear} recording`)
    return res.status(200).json({ ok: true, skipped: 'already credited for this recording' })
  }

  // Insert CE credit — immediately approved (quiz pass = proof of engagement)
  // The DB unique constraint ce_monthly_call_one_per_month (email:YYYYMM) will
  // reject this insert if they already received live-call credit this month.
  const { data: inserted, error } = await supabase
    .from('ce_submissions')
    .insert({
      email,
      first_name: member.first_name || firstName || '',
      last_name: member.last_name || lastName || '',
      course_title: courseTitle,
      completion_date: completionDate,
      hours_earned: 1,
      ce_type: 'Monthly Member Call',
      designation,
      source: 'kajabi_recording',
      status: 'approved',
    })
    .select()
    .single()

  if (error) {
    // Unique constraint violation = already has live-call credit this month
    if (error.code === '23505') {
      console.log(`[kajabi-ce-webhook] ${email} already has live-call CE credit for ${monthYear} — no double-dip`)
      return res.status(200).json({ ok: true, skipped: 'live-call credit already exists for this month' })
    }
    console.error('[kajabi-ce-webhook] Insert error:', error)
    return res.status(500).json({ error: error.message })
  }

  console.log(`[kajabi-ce-webhook] Credited ${email} (${designation}) for ${courseTitle}`)
  return res.status(200).json({
    ok: true,
    action: 'credited',
    email,
    designation,
    courseTitle,
    submissionId: inserted.id,
  })
}
