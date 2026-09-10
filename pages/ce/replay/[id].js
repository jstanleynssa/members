import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import Link from 'next/link'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const NSSA_BG  = '#eef6fc'
const IRMAA_BG = '#fceeef'
const GREEN_BG = '#f0fdf4'
const GREEN    = '#16a34a'
const GREEN_BORDER = '#bbf7d0'
const ORANGE_BG    = '#fff7ed'
const ORANGE       = '#c2410c'
const ORANGE_BORDER = '#fed7aa'
const BLUE_BG      = '#eff6ff'
const BLUE         = '#1d4ed8'
const BLUE_BORDER  = '#bfdbfe'

export async function getServerSideProps(context) {
  const { id } = context.params
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

  // Fetch quiz (with correct answers — these stay server-side only)
  const { data: quiz, error } = await supabase
    .from('replay_quizzes')
    .select('*')
    .eq('id', id)
    .eq('active', true)
    .single()

  // Fetch adjacent quizzes for prev/next navigation (ordered newest first)
  const { data: allQuizzes } = await supabase
    .from('replay_quizzes')
    .select('id, title, call_date')
    .eq('active', true)
    .order('call_date', { ascending: false })

  const currentIndex = (allQuizzes || []).findIndex(q => q.id === id)
  const prevQuiz = currentIndex > 0 ? allQuizzes[currentIndex - 1] : null
  const nextQuiz = currentIndex < (allQuizzes?.length ?? 0) - 1 ? allQuizzes[currentIndex + 1] : null

  if (error || !quiz) return { notFound: true }

  // Sanitize questions — strip correct answers before sending to client
  const sanitizedQuestions = (quiz.questions || []).map(q => ({
    id: q.id,
    question: q.question,
    options: q.options
  }))

  // Check if CE already credited
  const { data: existingCredit } = await supabase
    .from('ce_submissions')
    .select('id, completion_date')
    .ilike('email', email)
    .eq('quiz_id', id)
    .eq('status', 'approved')
    .maybeSingle()

  return {
    props: {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        call_date: quiz.call_date,
        recording_url: quiz.recording_url,
        description: quiz.description,
        pass_threshold: quiz.pass_threshold,
        questions: sanitizedQuestions
      },
      already_credited: !!existingCredit,
      userEmail: email,
      prevQuiz: prevQuiz ? { id: prevQuiz.id, title: prevQuiz.title } : null,
      nextQuiz: nextQuiz ? { id: nextQuiz.id, title: nextQuiz.title } : null,
    }
  }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  })
}

export default function ReplayQuiz({ quiz, already_credited, userEmail, prevQuiz, nextQuiz }) {
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)  // { score, passed, correct_answers, ce_credited, already_credited }
  const [error, setError] = useState(null)

  const allAnswered = quiz.questions.every(q => answers[q.id])
  const isAlreadyCredited = already_credited || result?.already_credited

  function handleAnswer(questionId, optionId) {
    if (result?.passed) return  // Lock after pass
    setAnswers(prev => ({ ...prev, [questionId]: optionId }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!allAnswered || loading) return
    setLoading(true)
    setError(null)

    try {
      const resp = await fetch(`/api/replay-quiz/${quiz.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Submission failed')
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleRetake() {
    setAnswers({})
    setResult(null)
    setError(null)
  }

  // Determine question coloring after submit
  function questionBorderColor(q) {
    if (!result) return GRAY.border
    const memberAnswer = answers[q.id]
    const correctAnswer = result.correct_answers?.[q.id]
    if (memberAnswer === correctAnswer) return GREEN
    return ORANGE
  }

  function optionStyle(q, opt) {
    const base = {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 14px', borderRadius: '7px',
      border: `1px solid ${GRAY.border}`, marginBottom: '8px',
      cursor: result?.passed ? 'default' : 'pointer',
      fontSize: '14px', color: '#374151',
      transition: 'border-color 0.15s, background 0.15s',
      background: 'white'
    }

    if (answers[q.id] === opt.id && !result) {
      return { ...base, border: `2px solid ${NSSA.medium}`, background: NSSA_BG }
    }

    if (result) {
      const correctAnswer = result.correct_answers?.[q.id]
      const memberAnswer = answers[q.id]
      if (opt.id === correctAnswer) {
        return { ...base, border: `2px solid ${GREEN}`, background: GREEN_BG, fontWeight: 600 }
      }
      if (opt.id === memberAnswer && memberAnswer !== correctAnswer) {
        return { ...base, border: `2px solid ${ORANGE}`, background: ORANGE_BG, color: ORANGE }
      }
    }

    if (answers[q.id] === opt.id) {
      return { ...base, border: `2px solid ${NSSA.medium}`, background: NSSA_BG }
    }

    return base
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `1px solid ${GRAY.border}` }}>
          <Link href="/ce/replays" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>
            ← Back to Replays
          </Link>
          <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '44px', width: 'auto' }} />
        </div>

        {/* Prev / Next navigation */}
        {(prevQuiz || nextQuiz) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              {nextQuiz && (
                <Link href={`/ce/replay/${nextQuiz.id}`} style={{ textDecoration: 'none' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 14px', borderRadius: '8px',
                    border: `1px solid ${GRAY.border}`, background: 'white',
                    color: GRAY.text, fontSize: '13px', cursor: 'pointer'
                  }}>
                    <span style={{ fontSize: '16px' }}>←</span>
                    <div>
                      <div style={{ fontSize: '11px', color: GRAY.text, opacity: 0.7, marginBottom: '1px' }}>Older session</div>
                      <div style={{ fontWeight: 600, color: '#374151', lineHeight: 1.3 }}>{nextQuiz.title}</div>
                    </div>
                  </div>
                </Link>
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
              {prevQuiz && (
                <Link href={`/ce/replay/${prevQuiz.id}`} style={{ textDecoration: 'none', width: '100%' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
                    padding: '10px 14px', borderRadius: '8px',
                    border: `1px solid ${GRAY.border}`, background: 'white',
                    color: GRAY.text, fontSize: '13px', cursor: 'pointer'
                  }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: GRAY.text, opacity: 0.7, marginBottom: '1px' }}>Newer session</div>
                      <div style={{ fontWeight: 600, color: '#374151', lineHeight: 1.3 }}>{prevQuiz.title}</div>
                    </div>
                    <span style={{ fontSize: '16px' }}>→</span>
                  </div>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Title */}
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#111', marginBottom: '4px' }}>
          {quiz.title}
        </h1>
        <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1.5rem' }}>
          {formatDate(quiz.call_date)}
          {quiz.description && <> · {quiz.description}</>}
        </p>

        {/* Already credited banner — shown before video if already done */}
        {isAlreadyCredited && !result && (
          <div style={{
            background: BLUE_BG, border: `1px solid ${BLUE_BORDER}`, borderRadius: '8px',
            padding: '14px 18px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px'
          }}>
            <span style={{ fontSize: '20px' }}>🎓</span>
            <div>
              <p style={{ fontWeight: 600, color: BLUE, margin: 0, fontSize: '14px' }}>
                You already earned CE credit for this session.
              </p>
              <p style={{ fontSize: '13px', color: BLUE, margin: '2px 0 0', opacity: 0.85 }}>
                1 CE hour has been applied to your account. You can still watch the recording below.
              </p>
            </div>
          </div>
        )}

        {/* Recording — YouTube embed or external link */}
        {(() => {
          const url = quiz.recording_url || ''
          const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/)
          const embedUrl = ytMatch ? `https://www.youtube.com/embed/${ytMatch[1]}` : null

          if (embedUrl) {
            return (
              <div style={{
                position: 'relative', width: '100%', paddingBottom: '56.25%',
                marginBottom: '2rem', background: '#000', borderRadius: '10px', overflow: 'hidden'
              }}>
                <iframe
                  src={embedUrl}
                  title={quiz.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                />
              </div>
            )
          }

          return (
            <div style={{
              marginBottom: '2rem', background: '#13405E', borderRadius: '10px',
              padding: '2.5rem 2rem', textAlign: 'center'
            }}>
              <p style={{ fontSize: '14px', color: '#8ECAEE', margin: '0 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Session Recording
              </p>
              <p style={{ fontSize: '16px', fontWeight: 700, color: 'white', margin: '0 0 20px' }}>
                {quiz.title}
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block', padding: '11px 28px',
                  background: '#1C80BC', color: 'white', borderRadius: '8px',
                  fontSize: '14px', fontWeight: 600, textDecoration: 'none'
                }}
              >
                ▶ Watch Recording →
              </a>
              <p style={{ fontSize: '12px', color: '#8ECAEE', margin: '14px 0 0', opacity: 0.8 }}>
                Opens in a new tab — then return here to take the quiz.
              </p>
            </div>
          )
        })()}

        {/* Quiz section */}
        <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '2rem' }}>
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `1px solid ${GRAY.bg}` }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>
              Session Quiz
            </h2>
            <p style={{ fontSize: '13px', color: GRAY.text, margin: 0 }}>
              Answer {quiz.questions.length} questions about this session to earn 1 CE hour.
              You need {quiz.pass_threshold}% to pass.
            </p>
          </div>

          {/* Result banners */}
          {result && result.passed && !result.already_credited && (
            <div style={{
              background: GREEN_BG, border: `1px solid ${GREEN_BORDER}`, borderRadius: '8px',
              padding: '14px 18px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px'
            }}>
              <span style={{ fontSize: '22px' }}>🎉</span>
              <div>
                <p style={{ fontWeight: 700, color: GREEN, margin: 0, fontSize: '15px' }}>
                  You passed! 1 CE hour has been credited to your account.
                </p>
                <p style={{ fontSize: '13px', color: GREEN, margin: '3px 0 0', opacity: 0.9 }}>
                  Score: {result.score}% · Credit will appear in your CE history on the dashboard.
                </p>
              </div>
            </div>
          )}

          {result && result.already_credited && (
            <div style={{
              background: BLUE_BG, border: `1px solid ${BLUE_BORDER}`, borderRadius: '8px',
              padding: '14px 18px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px'
            }}>
              <span style={{ fontSize: '20px' }}>🎓</span>
              <p style={{ fontWeight: 600, color: BLUE, margin: 0, fontSize: '14px' }}>
                You already earned CE credit for this session — no double-dipping!
              </p>
            </div>
          )}

          {result && !result.passed && (
            <div style={{
              background: ORANGE_BG, border: `1px solid ${ORANGE_BORDER}`, borderRadius: '8px',
              padding: '14px 18px', marginBottom: '1.5rem'
            }}>
              <p style={{ fontWeight: 700, color: ORANGE, margin: '0 0 4px', fontSize: '15px' }}>
                You scored {result.score}% — you need {quiz.pass_threshold}% to pass.
              </p>
              <p style={{ fontSize: '13px', color: ORANGE, margin: '0 0 10px', opacity: 0.9 }}>
                Incorrect answers are highlighted below. You can retake the quiz.
              </p>
              <button onClick={handleRetake} style={{
                padding: '8px 18px', fontSize: '13px', fontWeight: 600,
                background: ORANGE, color: 'white', border: 'none',
                borderRadius: '6px', cursor: 'pointer'
              }}>
                Retake Quiz
              </button>
            </div>
          )}

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px',
              padding: '12px 16px', marginBottom: '1.25rem', fontSize: '13px', color: '#dc2626'
            }}>
              {error}
            </div>
          )}

          {/* Questions */}
          <form onSubmit={handleSubmit}>
            {quiz.questions.map((q, idx) => (
              <div key={q.id} style={{
                marginBottom: '1.75rem',
                paddingBottom: '1.5rem',
                borderBottom: idx < quiz.questions.length - 1 ? `1px solid ${GRAY.bg}` : 'none'
              }}>
                <p style={{
                  fontSize: '14px', fontWeight: 600, color: '#111',
                  margin: '0 0 12px',
                  paddingLeft: '4px',
                  borderLeft: result ? `3px solid ${questionBorderColor(q)}` : '3px solid transparent'
                }}>
                  {idx + 1}. {q.question}
                </p>
                {q.options.map(opt => (
                  <div
                    key={opt.id}
                    onClick={() => handleAnswer(q.id, opt.id)}
                    style={optionStyle(q, opt)}
                  >
                    <span style={{
                      width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${answers[q.id] === opt.id ? NSSA.medium : GRAY.border}`,
                      background: answers[q.id] === opt.id ? NSSA.medium : 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {answers[q.id] === opt.id && (
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'white' }} />
                      )}
                    </span>
                    <span>{opt.text}</span>
                    {result && result.correct_answers?.[q.id] === opt.id && (
                      <span style={{ marginLeft: 'auto', fontSize: '12px', color: GREEN, fontWeight: 600 }}>✓ Correct</span>
                    )}
                    {result && answers[q.id] === opt.id && answers[q.id] !== result.correct_answers?.[q.id] && (
                      <span style={{ marginLeft: 'auto', fontSize: '12px', color: ORANGE, fontWeight: 600 }}>✗ Your answer</span>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* Submit button — only show if not yet passed */}
            {(!result || !result.passed) && !isAlreadyCredited && (
              <button
                type="submit"
                disabled={!allAnswered || loading || (result?.passed)}
                style={{
                  width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600,
                  background: !allAnswered || loading ? GRAY.bg : NSSA.dark,
                  color: !allAnswered || loading ? GRAY.text : 'white',
                  border: 'none', borderRadius: '8px',
                  cursor: !allAnswered || loading ? 'not-allowed' : 'pointer',
                  opacity: !allAnswered ? 0.7 : 1,
                  marginTop: '0.5rem'
                }}
              >
                {loading ? 'Grading…' : !allAnswered
                  ? `Answer all ${quiz.questions.length} questions to submit`
                  : 'Submit Quiz'}
              </button>
            )}
          </form>

          {/* Success CTA */}
          {result?.passed && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: `1px solid ${GRAY.bg}`, display: 'flex', gap: '12px' }}>
              <Link href="/dashboard" style={{
                padding: '10px 20px', background: NSSA.dark, color: 'white',
                borderRadius: '7px', fontSize: '13px', fontWeight: 600, textDecoration: 'none'
              }}>
                View CE Dashboard
              </Link>
              <Link href="/ce/replays" style={{
                padding: '10px 20px', background: GRAY.bg, color: GRAY.text,
                borderRadius: '7px', fontSize: '13px', fontWeight: 600, textDecoration: 'none',
                border: `1px solid ${GRAY.border}`
              }}>
                More Replays
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
