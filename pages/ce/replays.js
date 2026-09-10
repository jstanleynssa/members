import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const NSSA_BG  = '#eef6fc'
const IRMAA_BG = '#fceeef'

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const email = session.user.email.toLowerCase()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Must be a certified member
  const { data: member } = await supabase
    .from('members')
    .select('first_name, last_name, nssa_certified, irmaa_certified')
    .ilike('email', email)
    .maybeSingle()

  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
    return { redirect: { destination: '/login?error=not_authorized', permanent: false } }
  }

  // Fetch all quizzes — active ones are playable; inactive ones show as placeholders
  const { data: quizzes } = await supabase
    .from('replay_quizzes')
    .select('id, title, call_date, description, pass_threshold, designation, active')
    .order('call_date', { ascending: false })

  // Find which quizzes this member has CE credit for
  const { data: creditedSubs } = await supabase
    .from('ce_submissions')
    .select('quiz_id')
    .ilike('email', email)
    .eq('status', 'approved')
    .not('quiz_id', 'is', null)

  const creditedQuizIds = new Set((creditedSubs || []).map(s => s.quiz_id))

  // Best attempt per quiz
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
      if (!attemptsByQuiz[a.quiz_id]) attemptsByQuiz[a.quiz_id] = a
    }
  }

  const enrichedQuizzes = (quizzes || []).map(q => ({
    ...q,
    credited: creditedQuizIds.has(q.id),
    best_attempt: attemptsByQuiz[q.id] || null
  }))

  // Sort: active first (newest→oldest), then inactive (newest→oldest)
  enrichedQuizzes.sort((a, b) => {
    if (a.active && !b.active) return -1
    if (!a.active && b.active) return 1
    return new Date(b.call_date) - new Date(a.call_date)
  })

  return {
    props: {
      quizzes: JSON.parse(JSON.stringify(enrichedQuizzes)),
      userEmail: email
    }
  }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  })
}

export default function Replays({ quizzes, userEmail }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `1px solid ${GRAY.border}` }}>
          <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>
            ← Back to Dashboard
          </Link>
          <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '44px', width: 'auto' }} />
        </div>

        {/* Title */}
        <div style={{ marginBottom: '1.75rem' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111', marginBottom: '6px' }}>
            Recorded Session Replays
          </h1>
          <p style={{ fontSize: '14px', color: GRAY.text, margin: 0 }}>
            Watch a recorded member call, answer 5 questions, and earn 1 CE hour — same credit as attending live.
          </p>
        </div>

        {/* Quiz list */}
        {quizzes.length === 0 ? (
          <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '3rem', textAlign: 'center' }}>
            <p style={{ color: GRAY.text, fontSize: '14px' }}>No replay quizzes available yet. Check back soon.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {quizzes.map(quiz => (
              quiz.active
                ? <QuizCard key={quiz.id} quiz={quiz} />
                : <PlaceholderCard key={quiz.id} quiz={quiz} />
            ))}
          </div>
        )}

        {/* Footer note */}
        <p style={{ fontSize: '12px', color: GRAY.text, marginTop: '2rem', textAlign: 'center' }}>
          Need to earn more CE hours?{' '}
          <Link href="/ce/submit" style={{ color: NSSA.medium, textDecoration: 'none' }}>Submit external CE →</Link>
        </p>
      </div>
    </div>
  )
}

function PlaceholderCard({ quiz }) {
  return (
    <div style={{
      background: '#fafafa',
      borderRadius: '10px',
      border: `1px solid ${GRAY.border}`,
      padding: '1.5rem',
      display: 'flex', alignItems: 'flex-start',
      gap: '1.25rem', justifyContent: 'space-between', flexWrap: 'wrap',
      opacity: 0.65
    }}>
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: GRAY.text, margin: 0 }}>
            {quiz.title}
          </h2>
          <span style={{
            fontSize: '12px', padding: '3px 10px', borderRadius: '99px',
            background: GRAY.bg, color: GRAY.text, border: `1px solid ${GRAY.border}`,
            fontWeight: 500
          }}>
            Not available
          </span>
        </div>
        <p style={{ fontSize: '12px', color: GRAY.text, margin: '0 0 8px' }}>
          {formatDate(quiz.call_date)}
        </p>
        {quiz.description && (
          <p style={{ fontSize: '13px', color: GRAY.text, margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>
            {quiz.description}
          </p>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>
        <span style={{
          display: 'inline-block', padding: '10px 20px',
          background: GRAY.bg, color: GRAY.text,
          borderRadius: '7px', fontSize: '13px', fontWeight: 600,
          border: `1px solid ${GRAY.border}`, cursor: 'not-allowed'
        }}>
          Not available
        </span>
      </div>
    </div>
  )
}

function QuizCard({ quiz }) {
  const credited = quiz.credited
  const attempt = quiz.best_attempt

  let statusBadge = null
  if (credited) {
    statusBadge = (
      <span style={{
        fontSize: '12px', padding: '4px 12px', borderRadius: '99px',
        background: NSSA_BG, color: NSSA.medium, border: `1px solid ${NSSA.light}`,
        fontWeight: 600, whiteSpace: 'nowrap'
      }}>
        ✓ 1 hr credited
      </span>
    )
  } else if (attempt && !attempt.passed) {
    statusBadge = (
      <span style={{
        fontSize: '12px', padding: '4px 12px', borderRadius: '99px',
        background: IRMAA_BG, color: IRMAA.medium, border: `1px solid ${IRMAA.light}`,
        fontWeight: 500, whiteSpace: 'nowrap'
      }}>
        Last score: {attempt.score}% — Retake available
      </span>
    )
  }

  return (
    <div style={{
      background: 'white', borderRadius: '10px',
      border: `1px solid ${credited ? NSSA.light : GRAY.border}`,
      padding: '1.5rem', display: 'flex', alignItems: 'flex-start',
      gap: '1.25rem', justifyContent: 'space-between', flexWrap: 'wrap'
    }}>
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111', margin: 0 }}>
            {quiz.title}
          </h2>
          {statusBadge}
        </div>
        <p style={{ fontSize: '12px', color: GRAY.text, margin: '0 0 8px' }}>
          {formatDate(quiz.call_date)}
        </p>
        {quiz.description && (
          <p style={{ fontSize: '13px', color: '#374151', margin: 0, lineHeight: 1.6 }}>
            {quiz.description}
          </p>
        )}
        <p style={{ fontSize: '12px', color: GRAY.text, marginTop: '8px', marginBottom: 0 }}>
          5 questions · Pass {quiz.pass_threshold}% · 1 CE hour
        </p>
      </div>

      <div style={{ flexShrink: 0 }}>
        <Link href={`/ce/replay/${quiz.id}`} style={{
          display: 'inline-block', padding: '10px 20px',
          background: credited ? GRAY.bg : NSSA.dark, color: credited ? GRAY.text : 'white',
          borderRadius: '7px', fontSize: '13px', fontWeight: 600, textDecoration: 'none',
          whiteSpace: 'nowrap', border: credited ? `1px solid ${GRAY.border}` : 'none'
        }}>
          {credited ? 'Review Session' : attempt ? 'Retake Quiz' : 'Watch & Earn CE'}
        </Link>
      </div>
    </div>
  )
}
