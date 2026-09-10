import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

// GET /api/replay-quizzes
// Returns all active quizzes with sanitized questions (correct answers stripped).
// Also returns whether the authenticated member has already passed each quiz.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Auth check
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  const email = session.user.email.toLowerCase()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Fetch all active quizzes
  const { data: quizzes, error } = await supabase
    .from('replay_quizzes')
    .select('id, title, call_date, description, pass_threshold, designation, created_at')
    .eq('active', true)
    .order('call_date', { ascending: false })

  if (error) {
    console.error('[replay-quizzes] DB error:', error)
    return res.status(500).json({ error: 'Failed to load quizzes' })
  }

  // Find which quizzes this member has already earned CE credit for
  const { data: creditedSubs } = await supabase
    .from('ce_submissions')
    .select('quiz_id')
    .ilike('email', email)
    .eq('status', 'approved')
    .not('quiz_id', 'is', null)

  const creditedQuizIds = new Set((creditedSubs || []).map(s => s.quiz_id))

  // Find best attempt per quiz (highest score)
  const quizIds = (quizzes || []).map(q => q.id)
  let attemptsByQuiz = {}
  if (quizIds.length > 0) {
    const { data: attempts } = await supabase
      .from('replay_quiz_attempts')
      .select('quiz_id, score, passed')
      .ilike('member_email', email)
      .in('quiz_id', quizIds)
      .order('score', { ascending: false })

    for (const a of (attempts || [])) {
      if (!attemptsByQuiz[a.quiz_id]) {
        attemptsByQuiz[a.quiz_id] = a
      }
    }
  }

  const result = (quizzes || []).map(q => ({
    ...q,
    credited: creditedQuizIds.has(q.id),
    best_attempt: attemptsByQuiz[q.id] || null
  }))

  return res.status(200).json({ quizzes: result })
}
