import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

// POST /api/replay-quiz/[id]/submit
// Body: { answers: { q1: "b", q2: "a", ... } }
// 1. Grade: compare to correct answers stored in replay_quizzes
// 2. Record attempt in replay_quiz_attempts
// 3. If passed AND no prior ce_submission for this quiz_id:
//    a. Look up member name + designation from members table
//    b. Insert into ce_submissions (approved, source: quiz_replay, quiz_id)
//    c. Mark attempt.ce_credited = true
// 4. Return { score, passed, correct_answers, ce_credited }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { id: quizId } = req.query

  // Auth check
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  const email = session.user.email.toLowerCase()

  const { answers } = req.body || {}
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'answers object required' })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Fetch quiz with correct answers
  const { data: quiz, error: quizError } = await supabase
    .from('replay_quizzes')
    .select('*')
    .eq('id', quizId)
    .eq('active', true)
    .single()

  if (quizError || !quiz) return res.status(404).json({ error: 'Quiz not found' })

  // Grade the submission
  const questions = quiz.questions || []
  let correct = 0
  const correct_answers = {}

  for (const q of questions) {
    correct_answers[q.id] = q.correct
    if (answers[q.id] === q.correct) correct++
  }

  const total = questions.length
  const score = total > 0 ? Math.round((correct / total) * 100) : 0
  const passed = score >= quiz.pass_threshold

  // Record the attempt
  const { data: attempt, error: attemptError } = await supabase
    .from('replay_quiz_attempts')
    .insert({
      quiz_id: quizId,
      member_email: email,
      score,
      passed,
      answers,
      ce_credited: false
    })
    .select()
    .single()

  if (attemptError) {
    console.error('[replay-quiz/submit] Attempt insert error:', attemptError)
    return res.status(500).json({ error: 'Failed to record attempt' })
  }

  // If not passed, return early
  if (!passed) {
    return res.status(200).json({ score, passed, correct_answers, ce_credited: false })
  }

  // Check if CE already credited for this quiz
  const { data: existingCredit } = await supabase
    .from('ce_submissions')
    .select('id')
    .ilike('email', email)
    .eq('quiz_id', quizId)
    .eq('status', 'approved')
    .maybeSingle()

  if (existingCredit) {
    // Already credited — just return pass, no double-credit
    return res.status(200).json({ score, passed, correct_answers, ce_credited: false, already_credited: true })
  }

  // Look up member for name + designation
  const { data: member } = await supabase
    .from('members')
    .select('first_name, last_name, nssa_certified, irmaa_certified')
    .ilike('email', email)
    .maybeSingle()

  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
    // Not a certified member — pass the quiz but no CE credit
    return res.status(200).json({ score, passed, correct_answers, ce_credited: false, reason: 'not_certified' })
  }

  // Determine designation — same logic as zoom-webhook.js
  let designation
  if (member.nssa_certified && !member.irmaa_certified) {
    designation = 'NSSA'
  } else if (!member.nssa_certified && member.irmaa_certified) {
    designation = 'IRMAA'
  } else {
    // Both certs — apply to whichever still needs hours
    const currentYear = new Date().getFullYear()
    const { data: nssaSubs } = await supabase
      .from('ce_submissions')
      .select('hours_earned')
      .ilike('email', email)
      .eq('status', 'approved')
      .eq('year', currentYear)
      .or('designation.eq.NSSA,designation.eq.both')
    const nssaHours = (nssaSubs || []).reduce((sum, s) => sum + Number(s.hours_earned), 0)
    designation = nssaHours >= 4 ? 'IRMAA' : 'NSSA'
  }

  const completionDate = new Date().toISOString().split('T')[0]
  const courseTitle = `Replay: ${quiz.title}`

  // Insert CE submission
  const { error: ceError } = await supabase.from('ce_submissions').insert({
    email,
    first_name: member.first_name || '',
    last_name: member.last_name || '',
    course_title: courseTitle,
    completion_date: completionDate,
    hours_earned: 1,
    ce_type: 'Monthly Member Call',
    designation,
    source: 'quiz_replay',
    status: 'approved',
    quiz_id: quizId
  })

  if (ceError) {
    // Unique constraint violation = already credited (race condition) — treat as success
    if (ceError.code === '23505') {
      return res.status(200).json({ score, passed, correct_answers, ce_credited: false, already_credited: true })
    }
    console.error('[replay-quiz/submit] CE insert error:', ceError)
    return res.status(500).json({ error: 'Quiz passed but CE credit failed to record. Please contact support.' })
  }

  // Mark attempt as credited
  await supabase
    .from('replay_quiz_attempts')
    .update({ ce_credited: true })
    .eq('id', attempt.id)

  return res.status(200).json({ score, passed, correct_answers, ce_credited: true })
}
