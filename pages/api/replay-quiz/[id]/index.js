import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

// GET /api/replay-quiz/[id]
// Returns a single active quiz with recording_url and sanitized questions (no correct answers).
// Also returns: member's best prior attempt (passed, score) and whether CE has been credited.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { id } = req.query

  // Auth check
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  const email = session.user.email.toLowerCase()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Fetch quiz
  const { data: quiz, error } = await supabase
    .from('replay_quizzes')
    .select('*')
    .eq('id', id)
    .eq('active', true)
    .single()

  if (error || !quiz) return res.status(404).json({ error: 'Quiz not found' })

  // Strip correct answers from questions before sending to client
  const sanitizedQuestions = (quiz.questions || []).map(q => ({
    id: q.id,
    question: q.question,
    options: q.options
  }))

  // Check if CE already credited
  const { data: existingCredit } = await supabase
    .from('ce_submissions')
    .select('id')
    .ilike('email', email)
    .eq('quiz_id', id)
    .eq('status', 'approved')
    .maybeSingle()

  // Get member's best prior attempt (highest score)
  const { data: attempts } = await supabase
    .from('replay_quiz_attempts')
    .select('score, passed, ce_credited, attempted_at')
    .ilike('member_email', email)
    .eq('quiz_id', id)
    .order('score', { ascending: false })
    .limit(1)

  const bestAttempt = (attempts && attempts.length > 0) ? attempts[0] : null

  return res.status(200).json({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      call_date: quiz.call_date,
      recording_url: quiz.recording_url,
      description: quiz.description,
      pass_threshold: quiz.pass_threshold,
      designation: quiz.designation,
      questions: sanitizedQuestions
    },
    already_credited: !!existingCredit,
    best_attempt: bestAttempt
  })
}
