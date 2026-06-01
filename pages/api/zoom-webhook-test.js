import { createClient } from '@supabase/supabase-js'

const MIN_DURATION_SECONDS = 2400 // 40 minutes

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // DELETE — clean up test records
  if (req.method === 'DELETE') {
    const { submissionId } = req.body
    if (!submissionId) return res.status(400).json({ error: 'Missing submissionId' })
    const { error } = await supabase
      .from('ce_submissions')
      .delete()
      .eq('id', submissionId)
      .eq('source', 'zoom_auto')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, deleted: submissionId })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { email, durationSeconds, meetingDate } = req.body

  if (!email || !durationSeconds || !meetingDate) {
    return res.status(400).json({ error: 'Missing required fields: email, durationSeconds, meetingDate' })
  }

  // Diagnostic — log env var availability (values hidden)
  console.log('[zoom-test] SUPABASE_URL set:', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log('[zoom-test] SERVICE_ROLE_KEY set:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.log('[zoom-test] Looking for email:', email)

  const currentYear = new Date(meetingDate).getFullYear()
  const monthYear = new Date(meetingDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const courseTitle = `NSSA Monthly Member Call — ${monthYear}`
  const meetingUuid = `TEST-${meetingDate}`

  // Look up member — surface the actual Supabase error if it fails
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('email, first_name, last_name, nssa_certified, irmaa_certified')
    .eq('email', email)
    .maybeSingle()

  console.log('[zoom-test] member:', JSON.stringify(member))
  console.log('[zoom-test] memberError:', JSON.stringify(memberError))

  if (memberError) {
    return res.status(500).json({
      error: `Database error: ${memberError.message}`,
      code: memberError.code,
      details: memberError.details
    })
  }

  if (!member) {
    return res.status(404).json({ error: `No member found for ${email}` })
  }

  if (!member.nssa_certified && !member.irmaa_certified) {
    return res.status(400).json({ error: `${email} has no active certifications` })
  }

  // Designation waterfall
  let designation
  if (member.nssa_certified && !member.irmaa_certified) {
    designation = 'NSSA'
  } else if (!member.nssa_certified && member.irmaa_certified) {
    designation = 'IRMAA'
  } else {
    const { data: nssaSubs } = await supabase
      .from('ce_submissions')
      .select('hours_earned')
      .eq('email', email)
      .eq('status', 'approved')
      .eq('year', currentYear)
      .or('designation.eq.NSSA,designation.eq.both')

    const nssaHours = (nssaSubs || []).reduce((sum, s) => sum + Number(s.hours_earned), 0)
    designation = nssaHours >= 4 ? 'IRMAA' : 'NSSA'
  }

  const qualifies = durationSeconds >= MIN_DURATION_SECONDS

  const { data: existing } = await supabase
    .from('ce_submissions')
    .select('*')
    .eq('email', email)
    .eq('zoom_meeting_id', meetingUuid)
    .maybeSingle()

  const totalDuration = (existing?.zoom_duration_seconds || 0) + durationSeconds
  let action, submissionId

  if (existing) {
    const { data: updated, error } = await supabase
      .from('ce_submissions')
      .update({
        zoom_duration_seconds: totalDuration,
        status: totalDuration >= MIN_DURATION_SECONDS ? 'approved' : existing.status,
        designation
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    action = 'updated'
    submissionId = existing.id
  } else {
    const { data: inserted, error } = await supabase
      .from('ce_submissions')
      .insert({
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
        zoom_duration_seconds: durationSeconds
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    action = 'created'
    submissionId = inserted.id
  }

  return res.status(200).json({
    ok: true, action, submissionId, email, designation,
    durationSeconds, totalDuration, qualifies,
    status: totalDuration >= MIN_DURATION_SECONDS ? 'approved' : 'pending',
    courseTitle
  })
}
